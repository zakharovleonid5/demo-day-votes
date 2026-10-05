const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PNG } = require("pngjs");
const decodeQR = require("jsqr");

process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "account-tools-")), "db.json");
process.env.ADMIN_PASSWORD = "initial-password";
process.env.PUBLIC_ORIGIN = "https://demo-day-votes.vercel.app";
let server = require("./server");
let base;
let adminCookie;
let adminId;
const request = (route, input, cookie = adminCookie) => fetch(base + route, {
  method: input === undefined ? "GET" : "POST",
  headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  ...(input === undefined ? {} : { body: JSON.stringify(input) })
});
const login = (login, password) => request("/api/admin/login", { login, password }, null);
test.before(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = (await login("admin", "initial-password")).headers.get("set-cookie");
  adminId = (await (await request("/api/admin/state")).json()).currentOrganizer.id;
});
test.after(() => new Promise(resolve => server.close(resolve)));

test("password change requires reauthentication, rotates sessions and persists only a hash", async () => {
  const endpoint = `/api/admin/organizers/${adminId}/password`;
  const input = { currentPassword: "initial-password", password: "changed-password" };
  const secondCookie = (await login("admin", input.currentPassword)).headers.get("set-cookie");
  assert.equal((await request(endpoint, input, null)).status, 401);
  assert.equal((await request(endpoint, { ...input, password: "short" })).status, 400);
  assert.equal((await request(endpoint, { ...input, currentPassword: "wrong" })).status, 403);
  const before = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
  const response = await request(endpoint, input);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.currentOrganizer.id, adminId);
  assert.equal(JSON.stringify(result).includes("passwordHash"), false);
  assert.equal((await request("/api/admin/state", undefined, adminCookie)).status, 401);
  assert.equal((await request("/api/admin/state", undefined, secondCookie)).status, 401);
  adminCookie = response.headers.get("set-cookie");
  assert.equal((await request("/api/admin/state")).status, 200);
  assert.equal((await login("admin", input.currentPassword)).status, 401);
  assert.equal((await login("admin", input.password)).status, 200);
  const after = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
  assert.notEqual(before.organizers[0].salt, after.organizers[0].salt);
  assert.notEqual(before.organizers[0].passwordHash, after.organizers[0].passwordHash);
  assert.equal(JSON.stringify(after).includes(input.password), false);
  for (const key of ["talks", "votes", "history", "event"]) assert.deepEqual(after[key], before[key]);
});

test("organizer can reset a colleague's password using own credentials, including after completion", async () => {
  const created = await (await request("/api/admin/organizers", { name: "Colleague", login: "colleague", password: "colleague-password" })).json();
  const targetId = created.organizers.find(item => item.login === "colleague").id;
  const cookie = (await login("colleague", "colleague-password")).headers.get("set-cookie");
  const endpoint = `/api/admin/organizers/${targetId}/password`;
  assert.equal((await request(endpoint, { currentPassword: "colleague-password", password: "reset-password" })).status, 403);
  await request("/api/admin/events/complete", {});
  assert.equal((await request(endpoint, { currentPassword: "changed-password", password: "reset-password" })).status, 200);
  assert.equal((await request("/api/admin/state", undefined, cookie)).status, 401);
  assert.equal((await login("colleague", "colleague-password")).status, 401);
  assert.equal((await login("colleague", "reset-password")).status, 200);
  assert.equal((await request("/api/admin/state")).status, 200);
  assert.equal((await request("/api/admin/organizers/missing/password", { currentPassword: "changed-password", password: "reset-password" })).status, 404);
});

test("password confirmation is rate limited per organizer", async () => {
  const cookie = (await login("colleague", "reset-password")).headers.get("set-cookie");
  const endpoint = `/api/admin/organizers/${adminId}/password`;
  for (let i = 0; i < 5; i++) assert.equal((await request(endpoint, { currentPassword: "wrong", password: "new-password" }, cookie)).status, 403);
  assert.equal((await request(endpoint, { currentPassword: "reset-password", password: "new-password" }, cookie)).status, 429);
});

test("QR images decode to common and personal ballot links and require organizer access", async () => {
  assert.equal((await request("/api/admin/qr", { origin: base }, null)).status, 401);
  for (const origin of ["https://external.example", "javascript:alert(1)", base + "/admin", "not-a-url"]) {
    assert.equal((await request("/api/admin/qr", { origin })).status, 400);
  }
  assert.equal((await request("/api/admin/qr", { origin: base, voterId: "missing" })).status, 404);
  const proxied = await fetch(base + "/api/admin/qr", { method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie, Origin: process.env.PUBLIC_ORIGIN }, body: JSON.stringify({ origin: process.env.PUBLIC_ORIGIN }) });
  assert.equal(proxied.status, 200);
  assert.equal((await proxied.json()).link, process.env.PUBLIC_ORIGIN + "/?public=1");
  const spoofed = await fetch(base + "/api/admin/qr", { method: "POST", headers: { "Content-Type": "application/json", cookie: adminCookie, Origin: "https://attacker.example", "X-Forwarded-Host": "demo-day-votes.vercel.app" }, body: JSON.stringify({ origin: process.env.PUBLIC_ORIGIN }) });
  assert.equal(spoofed.status, 403);
  await request("/api/admin/events/new", { title: "QR event" });
  const state = await (await request("/api/admin/voters", { name: "QR Jury" })).json();
  const voter = state.voters[0];
  for (const [voterId, link] of [["", `${base}/?public=1`], [voter.id, `${base}/?token=${encodeURIComponent(voter.token)}`]]) {
    const response = await request("/api/admin/qr", { origin: base, voterId });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.link, link);
    assert.match(result.dataUrl, /^data:image\/png;base64,/);
    const png = PNG.sync.read(Buffer.from(result.dataUrl.split(",")[1], "base64"));
    const decoded = decodeQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.equal(decoded.data, link);
  }
});

test("ballot presentation is validated, persists across restart, and is frozen in the archive", async () => {
  const endpoint = "/api/admin/event/presentation";
  const update = (input, cookie = adminCookie) => fetch(base + endpoint, { method: "PATCH", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(input) });
  const input = { title: "Demo Day <script>test</script>", votingIntro: "Choose your favourites.\nSecond line." };
  assert.equal((await update(input, null)).status, 401);
  for (const invalid of [{ ...input, title: " " }, { ...input, title: "a".repeat(301) }, { ...input, votingIntro: null }, { ...input, votingIntro: "a".repeat(601) }]) assert.equal((await update(invalid)).status, 400);
  const before = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
  const response = await update({ ...input, status: "completed", currentRound: 2 });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.event.status, "open");
  assert.equal(state.event.currentRound, 1);
  assert.equal(state.event.title, input.title);
  assert.equal(state.event.votingIntro, input.votingIntro);
  const after = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
  for (const key of ["talks", "votes", "voters", "history"]) assert.deepEqual(after[key], before[key]);
  await new Promise(resolve => server.close(resolve));
  delete require.cache[require.resolve("./server")];
  server = require("./server");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const restored = await (await request("/api/public", undefined, null)).json();
  assert.equal(restored.event.title, input.title);
  assert.equal(restored.event.votingIntro, input.votingIntro);
  adminCookie = (await login("admin", "changed-password")).headers.get("set-cookie");
  assert.ok(adminCookie);
  const completed = await (await request("/api/admin/events/complete", {})).json();
  assert.equal((await update({ ...input, title: "No changes allowed" })).status, 409);
  const archive = await (await request(`/api/admin/history/${completed.event.id}`)).json();
  assert.equal(archive.snapshot.event.votingIntro, input.votingIntro);
  await request("/api/admin/events/new", { title: "Fresh event" });
  const fresh = await (await request("/api/public", undefined, null)).json();
  assert.equal(fresh.event.votingIntro, undefined);
  assert.equal((await update({ title: "Fresh event", votingIntro: "" })).status, 200);
});
