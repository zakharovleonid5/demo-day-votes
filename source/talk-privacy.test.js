const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

test("title-only migration removes speaker metadata from storage, archives and APIs without changing votes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "talk-privacy-"));
  process.env.DATA_FILE = path.join(dir, "db.json");
  process.env.NODE_ENV = "test";
  const password = "test-admin-password";
  const organizer = { id: "admin", login: "admin", name: "Organizer", salt: "test-salt", passwordHash: crypto.scryptSync(password, "test-salt", 64).toString("hex") };
  const talk = { id: "talk", title: "Presentation title", team: "Product team", order: 1, status: "planned", speaker: "PRIVATE_SPEAKER", description: "PRIVATE_TEAM" };
  const cleanTalk = { id: "talk", title: "Presentation title", team: "Product team", order: 1, status: "planned" };
  const ranked = { ...talk, stats: { score: 1, votesCount: 1, firstPlaces: 1 } };
  const vote = { id: "vote", voterId: "jury", talkId: "talk", round: 1, votingMode: "top1" };
  const voter = { id: "jury", token: "jury-token", name: "Jury Member" };
  const initial = {
    event: { id: "event", title: "Event", status: "open", currentRound: 1, votingMode: "top1", roundTwoFinalistIds: ["talk"] },
    talks: [talk], votes: [vote], voters: [voter], organizers: [organizer],
    history: [{ id: "old", title: "Old event", snapshot: { talks: [talk], allTalks: [talk], leaderboard: [ranked], rounds: [{ round: 1, leaderboard: [ranked] }, { round: 2, leaderboard: [ranked] }], allVotes: [vote], voters: [voter] } }]
  };
  fs.writeFileSync(process.env.DATA_FILE, JSON.stringify(initial));
  let server;
  const start = async () => {
    delete require.cache[require.resolve("./server")];
    server = require("./server");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  let base = await start();
  let cookie;
  const request = (route, method = "GET", data) => fetch(base + route, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const assertPrivate = value => {
    const serialized = JSON.stringify(value);
    assert.equal(serialized.includes("PRIVATE_"), false);
    assert.equal(serialized.includes('"speaker"'), false);
  };
  try {
    const migrated = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
    assertPrivate(migrated);
    assert.deepEqual(migrated.talks, [cleanTalk]);
    for (const key of ["event", "votes", "voters", "organizers"]) assert.deepEqual(migrated[key], initial[key]);
    assert.deepEqual(migrated.history[0].snapshot.allVotes, [vote]);
    assert.deepEqual(migrated.history[0].snapshot.rounds[0].leaderboard[0].stats, ranked.stats);
    cookie = (await request("/api/admin/login", "POST", { login: "admin", password })).headers.get("set-cookie");
    for (const route of ["/api/public", "/api/admin/state", "/api/admin/history/old"]) {
      const response = await request(route);
      assert.equal(response.status, 200);
      assertPrivate(await response.json());
    }
    const input = { title: "Updated title", team: "Team & <text>", speaker: "PRIVATE_SPEAKER", description: "PRIVATE_TEAM" };
    for (const team of [null, 42, "a".repeat(201)]) {
      assert.equal((await request("/api/admin/talks", "POST", { ...input, team })).status, 400);
      assert.equal((await request("/api/admin/talks/talk", "PATCH", { team })).status, 400);
    }
    assert.equal((await request("/api/admin/talks/talk", "PATCH", { team: "" })).status, 200);
    assert.equal((await (await request("/api/public")).json()).talks[0].team, "");
    assert.equal((await request("/api/admin/talks/talk", "PATCH", input)).status, 200);
    assert.equal((await request("/api/admin/talks/talk", "PATCH", { speaker: "PRIVATE_SPEAKER" })).status, 400);
    assert.equal((await request("/api/admin/talks", "POST", input)).status, 201);
    const after = JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8"));
    assertPrivate(after);
    assert.equal(after.talks[0].team, input.team);
    assert.equal(after.talks[1].team, input.team);
    assert.deepEqual(after.votes, [vote]);
    await request("/api/admin/events/complete", "POST");
    const archive = await (await request("/api/admin/history/event")).json();
    assert.equal(archive.snapshot.allTalks[0].team, input.team);
    assert.equal(archive.snapshot.rounds[0].leaderboard[0].team, input.team);
    await request("/api/admin/events/new", "POST", { title: "New event" });
    assert.equal((await request("/api/admin/talks/import", "POST", { talks: [{ ...input, team: 42 }] })).status, 400);
    assert.equal((await request("/api/admin/talks/import", "POST", { talks: [input] })).status, 201);
    assertPrivate(JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8")));
    await new Promise(resolve => server.close(resolve));
    base = await start();
    const restored = await (await request("/api/public")).json();
    assertPrivate(restored);
    assert.equal(restored.talks[0].team, input.team);
    assertPrivate(JSON.parse(fs.readFileSync(process.env.DATA_FILE, "utf8")));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
