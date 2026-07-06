const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-day-voting-"));
process.env.DATA_FILE = path.join(dataDir, "db.json");
process.env.ADMIN_PASSWORD = "secret";

const server = require("./server");

function listen() {
  return new Promise(resolve => {
    server.listen(0, () => resolve(server.address().port));
  });
}

function close() {
  return new Promise(resolve => server.close(resolve));
}

function voteTalkIds(vote) {
  if (Array.isArray(vote.talkIds)) return vote.talkIds;
  return vote.talkId ? [vote.talkId] : [];
}

test("voter can choose one best talk and admin sees leaderboard", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  assert.equal(loginResponse.status, 200);
  const cookie = loginResponse.headers.get("set-cookie");

  const voterResponse = await fetch(`${base}/api/admin/voters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "Ольга Веретенникова" })
  });
  assert.equal(voterResponse.status, 201);
  const voterState = await voterResponse.json();
  const voter = voterState.voters[0];

  const publicState = await fetch(`${base}/api/public`, {
    headers: { Authorization: `Bearer ${voter.token}` }
  }).then(res => res.json());
  const talkId = publicState.talks[0].id;

  const voteResponse = await fetch(`${base}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voter.token}` },
    body: JSON.stringify({
      talkId,
      comment: "Лучший доклад по совокупности критериев"
    })
  });
  assert.equal(voteResponse.status, 200);

  const admin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
  assert.equal(admin.voters.length, 1);
  assert.ok(admin.voters[0].token);
  assert.equal(admin.voters[0].votesCount, 1);
  assert.equal(admin.votes.length, 1);
  assert.equal(admin.leaderboard[0].stats.votesCount, 1);
  assert.equal(admin.matrix[0].talkTitle, publicState.talks[0].title);

  const resetResponse = await fetch(`${base}/api/admin/votes/reset`, {
    method: "POST",
    headers: { cookie }
  });
  assert.equal(resetResponse.status, 200);
  const resetState = await resetResponse.json();
  assert.equal(resetState.votes.length, 0);
  assert.equal(resetState.voters.length, 1);
  assert.equal(resetState.talks.length, publicState.talks.length);
  assert.equal(resetState.leaderboard[0].stats.votesCount, 0);

  await close();
});

test("admin can reorder talks", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  const cookie = loginResponse.headers.get("set-cookie");

  const create = title => fetch(`${base}/api/admin/talks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ title })
  }).then(res => res.json());

  await create("Второе выступление");
  const before = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
  const ids = before.talks.map(talk => talk.id).reverse();

  const reorderResponse = await fetch(`${base}/api/admin/talks/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ ids })
  });
  assert.equal(reorderResponse.status, 200);
  const after = await reorderResponse.json();
  assert.deepEqual(after.talks.map(talk => talk.id), ids);
  assert.deepEqual(after.talks.map(talk => talk.order), ids.map((_, index) => index + 1));

  await close();
});

test("admin can switch to top3 and voter can choose three initiatives", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  const cookie = loginResponse.headers.get("set-cookie");

  const modeResponse = await fetch(`${base}/api/admin/event/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ votingMode: "top3" })
  });
  assert.equal(modeResponse.status, 200);
  const modeState = await modeResponse.json();
  assert.equal(modeState.event.votingMode, "top3");
  assert.equal(modeState.event.selectionLimit, 3);

  const voterResponse = await fetch(`${base}/api/admin/voters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "Тестовый член жюри" })
  });
  assert.equal(voterResponse.status, 201);
  const voterState = await voterResponse.json();
  const voter = voterState.voters.at(-1);

  const publicState = await fetch(`${base}/api/public`, {
    headers: { Authorization: `Bearer ${voter.token}` }
  }).then(res => res.json());
  assert.equal(publicState.event.selectionLimit, 3);
  const talkIds = publicState.talks.slice(0, 3).map(talk => talk.id);

  const voteResponse = await fetch(`${base}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voter.token}` },
    body: JSON.stringify({ talkIds })
  });
  assert.equal(voteResponse.status, 200);

  const admin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
  assert.equal(admin.votes.at(-1).talkIds.length, 3);
  assert.equal(admin.matrix.at(-1).talkTitle.split(", ").length, 3);
  for (const [index, talkId] of talkIds.entries()) {
    const row = admin.leaderboard.find(talk => talk.id === talkId);
    assert.equal(row.stats.votesCount, 1);
    assert.equal(row.stats.score, index === 0 ? 2 : 1);
  }
  assert.equal(admin.leaderboard[0].id, talkIds[0]);

  await fetch(`${base}/api/admin/event/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ votingMode: "top1" })
  });

  await close();
});

test("admin can run a second round without mixing votes", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const loginResponse = await fetch(`${base}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secret" })
  });
  const cookie = loginResponse.headers.get("set-cookie");

  await fetch(`${base}/api/admin/event/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ votingMode: "top1" })
  });
  await fetch(`${base}/api/admin/event/round`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ round: 1 })
  });
  await fetch(`${base}/api/admin/votes/reset`, { method: "POST", headers: { cookie } });

  const voterResponse = await fetch(`${base}/api/admin/voters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ name: "Round Tester" })
  });
  assert.equal(voterResponse.status, 201);
  const voterState = await voterResponse.json();
  const voter = voterState.voters.at(-1);

  const roundOnePublic = await fetch(`${base}/api/public`, {
    headers: { Authorization: `Bearer ${voter.token}` }
  }).then(res => res.json());
  assert.equal(roundOnePublic.event.currentRound, 1);
  const roundOneTalkId = roundOnePublic.talks[0].id;
  const roundTwoTalkId = roundOnePublic.talks[1].id;

  const roundOneVote = await fetch(`${base}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voter.token}` },
    body: JSON.stringify({ talkId: roundOneTalkId })
  });
  assert.equal(roundOneVote.status, 200);

  const switchResponse = await fetch(`${base}/api/admin/event/round`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ round: 2 })
  });
  assert.equal(switchResponse.status, 200);
  const roundTwoAdminEmpty = await switchResponse.json();
  assert.equal(roundTwoAdminEmpty.event.currentRound, 2);
  assert.equal(roundTwoAdminEmpty.voters.find(item => item.id === voter.id).votesCount, 0);
  assert.equal(roundTwoAdminEmpty.leaderboard.find(item => item.id === roundOneTalkId).stats.votesCount, 0);
  assert.deepEqual(roundTwoAdminEmpty.talks.map(talk => talk.id), [roundOneTalkId]);
  assert.equal(roundTwoAdminEmpty.talks.some(talk => talk.id === roundTwoTalkId), false);

  const roundTwoPublic = await fetch(`${base}/api/public`, {
    headers: { Authorization: `Bearer ${voter.token}` }
  }).then(res => res.json());
  assert.equal(roundTwoPublic.event.currentRound, 2);
  assert.equal(roundTwoPublic.myVote, null);
  assert.deepEqual(roundTwoPublic.talks.map(talk => talk.id), [roundOneTalkId]);

  const reloadedRoundTwoPublic = await fetch(`${base}/api/public`, {
    headers: { Authorization: `Bearer ${voter.token}` }
  }).then(res => res.json());
  assert.equal(reloadedRoundTwoPublic.event.currentRound, 2);
  assert.deepEqual(reloadedRoundTwoPublic.talks.map(talk => talk.id), [roundOneTalkId]);

  const eliminatedVote = await fetch(`${base}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voter.token}` },
    body: JSON.stringify({ talkId: roundTwoTalkId })
  });
  assert.equal(eliminatedVote.status, 404);

  const roundTwoVote = await fetch(`${base}/api/votes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${voter.token}` },
    body: JSON.stringify({ talkId: roundOneTalkId })
  });
  assert.equal(roundTwoVote.status, 200);

  const roundTwoAdmin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
  assert.equal(roundTwoAdmin.votes.some(vote => vote.voterId === voter.id && vote.talkId === roundOneTalkId), true);
  assert.equal(roundTwoAdmin.votes.some(vote => vote.voterId === voter.id && vote.talkId === roundTwoTalkId), false);
  assert.equal(roundTwoAdmin.leaderboard.find(item => item.id === roundOneTalkId).stats.votesCount, 1);

  const switchBackResponse = await fetch(`${base}/api/admin/event/round`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ round: 1 })
  });
  const roundOneAdmin = await switchBackResponse.json();
  assert.equal(roundOneAdmin.votes.some(vote => vote.voterId === voter.id && vote.talkId === roundOneTalkId), true);
  assert.equal(roundOneAdmin.votes.some(vote => vote.voterId === voter.id && vote.talkId === roundTwoTalkId), false);

  await close();
});

test("common link stores one vote per device", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const deviceA = "11111111-1111-4111-8111-111111111111";
    const deviceB = "22222222-2222-4222-8222-222222222222";

    const publicState = await fetch(`${base}/api/public`, {
      headers: { "X-Device-Id": deviceA }
    }).then(res => res.json());
    assert.ok(publicState.voter);
    const firstTalk = publicState.talks[0].id;
    const secondTalk = publicState.talks[1].id;

    const firstVote = await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": deviceA },
      body: JSON.stringify({ talkId: firstTalk })
    });
    assert.equal(firstVote.status, 200);

    const updateVote = await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": deviceA },
      body: JSON.stringify({ talkId: secondTalk })
    });
    assert.equal(updateVote.status, 200);

    const secondDeviceVote = await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": deviceB },
      body: JSON.stringify({ talkId: firstTalk })
    });
    assert.equal(secondDeviceVote.status, 200);

    const loginResponse = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = loginResponse.headers.get("set-cookie");
    const admin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
    assert.equal(admin.votes.filter(vote => vote.deviceId === deviceA).length, 1);
    assert.equal(admin.votes.find(vote => vote.deviceId === deviceA).talkId, secondTalk);
    assert.equal(admin.votes.find(vote => vote.deviceId === deviceB).talkId, firstTalk);
  } finally {
    await close();
  }
});

test("admin can delete voted talks and voted jury members", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const loginResponse = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = loginResponse.headers.get("set-cookie");

    const createVoter = name => fetch(`${base}/api/admin/voters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name })
    }).then(res => res.json()).then(data => data.voters.at(-1));

    const voterToDelete = await createVoter("Delete Voter");
    const publicState = await fetch(`${base}/api/public`, {
      headers: { Authorization: `Bearer ${voterToDelete.token}` }
    }).then(res => res.json());
    const firstTalk = publicState.talks[0].id;

    await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voterToDelete.token}` },
      body: JSON.stringify({ talkId: firstTalk })
    });

    const deleteVoterResponse = await fetch(`${base}/api/admin/voters/${voterToDelete.id}`, {
      method: "DELETE",
      headers: { cookie }
    });
    assert.equal(deleteVoterResponse.status, 200);
    const afterVoterDelete = await deleteVoterResponse.json();
    assert.equal(afterVoterDelete.voters.some(voter => voter.id === voterToDelete.id), false);
    assert.equal(afterVoterDelete.votes.some(vote => vote.voterId === voterToDelete.id), false);

    const voterForTalkDelete = await createVoter("Delete Talk Voter");
    const talkState = await fetch(`${base}/api/public`, {
      headers: { Authorization: `Bearer ${voterForTalkDelete.token}` }
    }).then(res => res.json());
    const talkToDelete = talkState.talks[0].id;

    await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voterForTalkDelete.token}` },
      body: JSON.stringify({ talkId: talkToDelete })
    });

    const deleteTalkResponse = await fetch(`${base}/api/admin/talks/${talkToDelete}`, {
      method: "DELETE",
      headers: { cookie }
    });
    assert.equal(deleteTalkResponse.status, 200);
    const afterTalkDelete = await deleteTalkResponse.json();
    assert.equal(afterTalkDelete.talks.some(talk => talk.id === talkToDelete), false);
    assert.equal(afterTalkDelete.votes.some(vote => voteTalkIds(vote).includes(talkToDelete)), false);
  } finally {
    await close();
  }
});

test("top3 leaderboard breaks equal scores by first and second places", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const loginResponse = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = loginResponse.headers.get("set-cookie");

    await fetch(`${base}/api/admin/votes/reset`, { method: "POST", headers: { cookie } });
    await fetch(`${base}/api/admin/event/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ votingMode: "top3" })
    });

    const createVoter = name => fetch(`${base}/api/admin/voters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name })
    }).then(res => res.json()).then(data => data.voters.at(-1));

    const voterA = await createVoter("Tie Voter A");
    const voterB = await createVoter("Tie Voter B");
    const state = await fetch(`${base}/api/public`, {
      headers: { Authorization: `Bearer ${voterA.token}` }
    }).then(res => res.json());
    const [featureA, featureB, featureC, featureD] = state.talks.slice(0, 4).map(talk => talk.id);

    await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voterA.token}` },
      body: JSON.stringify({ talkIds: [featureA, featureB, featureC] })
    });
    await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voterB.token}` },
      body: JSON.stringify({ talkIds: [featureD, featureB, featureC] })
    });

    const admin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
    const rowA = admin.leaderboard.find(talk => talk.id === featureA);
    const rowB = admin.leaderboard.find(talk => talk.id === featureB);
    assert.equal(rowA.stats.score, rowB.stats.score);
    assert.equal(rowA.stats.firstPlaces, 1);
    assert.equal(rowB.stats.firstPlaces, 0);
    assert.ok(admin.leaderboard.findIndex(talk => talk.id === featureA) < admin.leaderboard.findIndex(talk => talk.id === featureB));
  } finally {
    await close();
  }
});

test("admin state exposes voting progress without needing interim results", async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const loginResponse = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" })
    });
    const cookie = loginResponse.headers.get("set-cookie");

    await fetch(`${base}/api/admin/votes/reset`, { method: "POST", headers: { cookie } });
    await fetch(`${base}/api/admin/event/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ votingMode: "top1" })
    });

    const createVoter = name => fetch(`${base}/api/admin/voters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ name })
    }).then(res => res.json()).then(data => data.voters.at(-1));

    const voted = await createVoter("Progress Voted");
    const pending = await createVoter("Progress Pending");
    const publicState = await fetch(`${base}/api/public`, {
      headers: { Authorization: `Bearer ${voted.token}` }
    }).then(res => res.json());

    await fetch(`${base}/api/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${voted.token}` },
      body: JSON.stringify({ talkId: publicState.talks[0].id })
    });

    const admin = await fetch(`${base}/api/admin/state`, { headers: { cookie } }).then(res => res.json());
    assert.ok(admin.votingProgress.total >= 2);
    assert.equal(admin.votingProgress.pending.some(voter => voter.id === pending.id), true);
    assert.equal(admin.votingProgress.pending.some(voter => voter.id === voted.id), false);
    assert.equal(admin.votingProgress.resultsLocked, true);
  } finally {
    await close();
  }
});
