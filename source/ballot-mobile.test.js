const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, webkit, expect } = require("@playwright/test");

for (const [name, engine, viewport] of [
  ["small-phone", chromium, { width: 320, height: 568 }],
  ["iphone", webkit, { width: 390, height: 844 }],
  ["android", chromium, { width: 412, height: 915 }]
]) {
  test(`${name}: common link recovery, touch ballot, persistence and storage restrictions`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ballot-mobile-"));
    process.env.DATA_FILE = path.join(dir, "db.json");
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.NODE_ENV = "test";
    fs.writeFileSync(process.env.DATA_FILE, JSON.stringify({
      event: { title: "Demo Day", votingMode: "top3", currentRound: 1 },
      talks: Array.from({ length: 6 }, (_, i) => ({ id: `talk-${i}`, title: `Инициатива ${i + 1}: удобное управление регулярными платежами`, speaker: "Имя спикера / Команда", order: i + 1 })),
      voters: [{ id: "jury", token: "valid-personal-token", name: "Jury" }], votes: []
    }));
    delete require.cache[require.resolve("./server")];
    const server = require("./server");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
      browser = await engine.launch();
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + "/");
      await page.evaluate(() => localStorage.setItem("demo-day-voter-token", "expired-token"));
      await page.reload();
      await expect(page.getByRole("heading", { name: "Это приглашение больше не действует" })).toBeVisible();
      await expect(page.locator(".best-talk")).toHaveCount(0);
      await page.getByRole("link", { name: "Открыть общую анкету" }).tap();
      await expect(page).toHaveURL(base + "/vote");
      await expect(page.locator(".best-talk")).toHaveCount(6);
      assert.equal(await page.evaluate(() => localStorage.getItem("demo-day-voter-token")), null);
      for (let i = 0; i < 3; i++) await page.locator(".best-talk").nth(i).tap();
      await expect(page.locator(".save-widget.show")).toBeVisible();
      const button = await page.locator(".submit-vote").boundingBox();
      assert.ok(button.height >= 44 && button.y + button.height <= viewport.height);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      fs.mkdirSync("test-results", { recursive: true });
      await page.screenshot({ path: `test-results/mobile-selected-${name}.png`, fullPage: true });
      await page.locator(".submit-vote").tap();
      await expect(page.locator(".chosen-item")).toHaveCount(3);
      await page.reload();
      await expect(page.locator(".chosen-item")).toHaveCount(3);
      await page.getByRole("button", { name: "Изменить выбор" }).tap();
      await page.locator(".best-talk").nth(2).tap();
      await page.locator(".best-talk").nth(3).tap();
      await page.locator(".submit-vote").tap();
      await expect(page.locator(".chosen-item").last()).toContainText("Инициатива 4");
      assert.equal(JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8")).votes.length, 1);
      await page.screenshot({ path: `test-results/mobile-result-${name}.png`, fullPage: true });
      await page.goto(base + "/?public=1");
      await expect(page).toHaveURL(base + "/vote");
      await expect(page.locator(".chosen-item")).toHaveCount(3);

      // A rejected personal token must never silently become a device vote.
      await page.goto(base + "/?token=expired-token");
      await expect(page.locator(".ballot-recovery")).toBeVisible();
      await page.goto(base + "/?token=valid-personal-token");
      await expect(page.locator(".best-talk")).toHaveCount(6);
      await page.reload();
      await expect(page).toHaveURL(base + "/?token=valid-personal-token");
      await expect(page.locator(".best-talk")).toHaveCount(6);
      await page.goto(base + "/vote/");
      await expect(page.locator(".chosen-item")).toHaveCount(3);

      const restricted = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      await restricted.addInitScript(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
      });
      const locked = await restricted.newPage();
      locked.on("pageerror", error => errors.push(error.message));
      await locked.goto(base + "/vote");
      await expect(locked.getByRole("heading", { name: "Разрешите сохранение данных сайта" })).toBeVisible();
      await expect(locked.locator(".best-talk")).toHaveCount(0);
      await locked.goto(base + "/?token=valid-personal-token");
      await expect(locked.locator(".best-talk")).toHaveCount(6);
      for (let i = 0; i < 3; i++) await locked.locator(".best-talk").nth(i).tap();
      await locked.locator(".submit-vote").tap();
      await expect(locked.locator(".chosen-item")).toHaveCount(3);
      await locked.reload();
      await expect(locked.locator(".chosen-item")).toHaveCount(3);
      assert.equal(JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8")).votes.length, 2);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
