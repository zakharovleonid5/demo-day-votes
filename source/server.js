const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const QRCode = require("qrcode");
const { stripTalkDetails } = require("./talk-privacy");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);

const root = __dirname;
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const dataFile = process.env.DATA_FILE || path.join(root, "data", "db.json");
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const isProduction = process.env.NODE_ENV === "production";
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
const adminSessions = new Map();
const loginAttempts = new Map();
const passwordAttempts = new Map();
const sessionDuration = 86400000;
const votingModes = new Set(["top1", "top3"]);
const roundTwoFinalistsLimit = 6;

const criteria = [
  {
    id: "demo",
    title: "Демонстрируемость",
    shortTitle: "Демо",
    descriptions: [
      "Демо невозможно показать",
      "Только рассказ, без работающего сценария",
      "Есть отдельные экраны, но нет законченного пользовательского пути",
      "Есть демонстрация ключевого сценария",
      "Демо наглядное и понятное без пояснений",
      "WOW-демо, зритель сразу понимает ценность"
    ]
  },
  {
    id: "effectScale",
    title: "Масштаб эффекта",
    shortTitle: "Масштаб",
    descriptions: [
      "Эффект отсутствует",
      "Локальная оптимизация внутри команды",
      "Влияние на десятки пользователей",
      "Влияние на сотни или тысячи пользователей / отдельный сегмент",
      "Влияние на значимую клиентскую группу или заметный бизнес-показатель",
      "Существенное влияние на весь продукт / направление / P&L"
    ]
  },
  {
    id: "evidence",
    title: "Доказанность эффекта",
    shortTitle: "Метрики",
    descriptions: [
      "Метрик нет",
      "Только мнение команды",
      "Есть гипотеза без измерений",
      "Есть измерения, но нет baseline или атрибуции",
      "Есть до/после или качественная аналитика",
      "Есть подтвержденный эффект с понятной методикой расчета"
    ]
  },
  {
    id: "novelty",
    title: "Новизна решения",
    shortTitle: "Новизна",
    descriptions: [
      "Исправление бага",
      "Минорное улучшение",
      "Небольшая новая возможность",
      "Существенное улучшение существующего процесса",
      "Новая функциональность для пользователей",
      "Принципиально новый опыт или решение"
    ]
  }
];

const selectionCriteria = [
  {
    id: "businessValue",
    title: "Ценность для бизнеса",
    description: "Насколько результат влияет на доход, расходы, риски или ключевые показатели банка."
  },
  {
    id: "clientValue",
    title: "Ценность для клиента",
    description: "Насколько результат улучшает опыт, экономит время или решает реальную боль клиента."
  },
  {
    id: "novelty",
    title: "Новизна",
    description: "Насколько решение нестандартно: новый подход, а не доработка существующего."
  },
  {
    id: "wow",
    title: "Wow-эффект",
    description: "Личное впечатление от презентации и демо. Оценивается субъективно, без формального обоснования."
  }
];

const seed = {
  event: {
    title: "Demo Day Voting",
    activeTalkId: null,
    votingMode: "top1",
    currentRound: 1,
    criteria
  },
  talks: [
    {
      "id": "talk-1",
      "title": "Сокращенная анкета",
      "order": 1,
      "status": "planned"
    },
    {
      "id": "talk-2",
      "title": "1.Новый CJ оплаты по QR СБП   2.Льготные курсы обмена валюты на главном экране МАРР",
      "order": 2,
      "status": "planned"
    },
    {
      "id": "talk-3",
      "title": "Редизайн экрана вклада и счёта",
      "order": 3,
      "status": "planned"
    },
    {
      "id": "talk-4",
      "title": "Зарплатные карты с курьерской доставкой",
      "order": 4,
      "status": "planned"
    },
    {
      "id": "talk-5",
      "title": "Витрина продуктов в мобильном приложении",
      "order": 5,
      "status": "planned"
    },
    {
      "id": "talk-6",
      "title": "Новая история операций в мобильном приложении",
      "order": 6,
      "status": "planned"
    },
    {
      "id": "talk-7",
      "title": "Выбор суммы кредита после одобрения",
      "order": 7,
      "status": "planned"
    },
    {
      "id": "talk-8",
      "title": "Рассрочка на перевод свободного лимита по СБП",
      "order": 8,
      "status": "planned"
    },
    {
      "id": "talk-9",
      "title": "Уведомление о сделке через брокера",
      "order": 9,
      "status": "planned"
    },
    {
      "id": "talk-10",
      "title": "Trino — единое окно доступа к данным",
      "order": 10,
      "status": "planned"
    },
    {
      "id": "talk-11",
      "title": "Цифровой процесс трудоустройства (Space)",
      "order": 11,
      "status": "planned"
    },
    {
      "id": "talk-12",
      "title": "QR для бизнес-залов и Fast track",
      "order": 12,
      "status": "planned"
    },
    {
      "id": "talk-13",
      "title": "Витрина персональных акций в ДБО",
      "order": 13,
      "status": "planned"
    },
    {
      "id": "talk-14",
      "title": "Персонализированные категории кешбэка",
      "order": 14,
      "status": "planned"
    },
    {
      "id": "talk-15",
      "title": "Кабинет ПреКлиента (ПреКабинет)",
      "order": 15,
      "status": "planned"
    },
    {
      "id": "talk-16",
      "title": "Онбординг через помощника в ДБО + маскот банка",
      "order": 16,
      "status": "planned"
    },
    {
      "id": "talk-17",
      "title": "Бизнес-карты в ДБО ЮЛ",
      "order": 17,
      "status": "planned"
    },
    {
      "id": "talk-18",
      "title": "Currency Connect",
      "order": 18,
      "status": "planned"
    }
  ],
  voters: [],
  votes: []
};

function loadDb() {
  if (!fs.existsSync(dataFile)) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2), "utf8");
  }
  return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

let db = loadDb();

function normalizeDb() {
  db.event ||= {};
  if (!votingModes.has(db.event.votingMode)) db.event.votingMode = "top1";
  if (![1, 2].includes(Number(db.event.currentRound))) db.event.currentRound = 1;
  if (!Array.isArray(db.event.roundTwoFinalistIds)) db.event.roundTwoFinalistIds = [];
  db.votes ||= [];
  db.history ||= [];
  db.event.id ||= id();
  db.event.status ||= "open";
  if (!Array.isArray(db.organizers) || !db.organizers.length) {
    const salt = crypto.randomBytes(16).toString("hex");
    db.organizers = [{ id: id(), login: (process.env.ADMIN_LOGIN || "admin").trim().toLowerCase(), name: "Организатор", salt,
      passwordHash: crypto.scryptSync(adminPassword, salt, 64).toString("hex"), createdAt: new Date().toISOString() }];
    saveDb();
  }
  if (stripTalkDetails(db)) saveDb();
}

normalizeDb();

function saveDb() {
  const temp = `${dataFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(temp, dataFile);
}

function id() {
  return crypto.randomUUID();
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...securityHeaders(),
    ...headers
  });
  res.end(JSON.stringify(body));
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; "),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  };
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 120_000) throw new Error("Payload too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function safeText(value, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validTeam(value) {
  return value === undefined || (typeof value === "string" && value.trim().length <= 200);
}

function bearer(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

function currentVoter(req) {
  return db.voters.find(voter => voter.token === bearer(req));
}

function deviceId(req) {
  const value = req.headers["x-device-id"];
  return typeof value === "string" && /^[a-f0-9-]{20,80}$/i.test(value) ? value : null;
}

function voteOwner(req) {
  const voter = currentVoter(req);
  if (voter) return { voter, deviceId: null };
  if (bearer(req)) return { voter: null, deviceId: null };
  const currentDeviceId = deviceId(req);
  if (currentDeviceId) return { voter: null, deviceId: currentDeviceId };
  return { voter: null, deviceId: null };
}

function adminToken(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith("admin_session="))
    ?.split("=")[1];
  return token;
}

function currentAdmin(req) {
  const token = adminToken(req);
  const session = adminSessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { adminSessions.delete(token); return null; }
  return db.organizers.find(item => item.id === session.organizerId) || null;
}

function isAdmin(req) {
  return Boolean(currentAdmin(req));
}

function publicOrganizer(item) {
  return { id: item.id, login: item.login, name: item.name, createdAt: item.createdAt };
}

function selectionLimit(mode = db.event.votingMode) {
  return mode === "top3" ? 3 : 1;
}

function currentRound() {
  return Number(db.event.currentRound) === 2 ? 2 : 1;
}

function voteRound(vote) {
  return Number(vote.round) === 2 ? 2 : 1;
}

function roundVotes(round = currentRound()) {
  return db.votes.filter(vote => voteRound(vote) === round);
}

function voteTalkIds(vote) {
  if (Array.isArray(vote.talkIds)) return vote.talkIds;
  return vote.talkId ? [vote.talkId] : [];
}

function voteWeight(vote, talkId) {
  const ids = voteTalkIds(vote);
  const index = ids.indexOf(talkId);
  if (index === -1) return 0;
  if (vote.votingMode === "top3" || ids.length === 3) return index === 0 ? 2 : 1;
  return 1;
}

function talkStats(talkId, round = currentRound()) {
  const votes = roundVotes(round).filter(vote => voteTalkIds(vote).includes(talkId));
  const score = votes.reduce((sum, vote) => sum + voteWeight(vote, talkId), 0);
  const firstPlaces = votes.filter(vote => voteTalkIds(vote).indexOf(talkId) === 0).length;
  const secondPlaces = votes.filter(vote => voteTalkIds(vote).indexOf(talkId) === 1).length;
  const thirdPlaces = votes.filter(vote => voteTalkIds(vote).indexOf(talkId) === 2).length;
  return { votesCount: votes.length, score, total: score, firstPlaces, secondPlaces, thirdPlaces };
}

function leaderboard(round = currentRound()) {
  const finalistIds = round === 2 ? roundTwoFinalistIds() : null;
  return db.talks
    .filter(talk => !finalistIds || finalistIds.includes(talk.id))
    .map(talk => ({ ...talk, stats: talkStats(talk.id, round) }))
    .sort((a, b) =>
      b.stats.score - a.stats.score ||
      b.stats.firstPlaces - a.stats.firstPlaces ||
      b.stats.secondPlaces - a.stats.secondPlaces ||
      a.order - b.order
    );
}

function sameTiebreakBucket(a, b) {
  return a.stats.score === b.stats.score &&
    a.stats.firstPlaces === b.stats.firstPlaces &&
    a.stats.secondPlaces === b.stats.secondPlaces;
}

function calculateRoundTwoFinalists() {
  const firstRound = leaderboard(1).filter(talk => talk.stats.score > 0);
  if (firstRound.length <= roundTwoFinalistsLimit) return firstRound.map(talk => talk.id);
  const cutoff = firstRound[roundTwoFinalistsLimit - 1];
  return firstRound
    .filter((talk, index) => index < roundTwoFinalistsLimit || sameTiebreakBucket(talk, cutoff))
    .map(talk => talk.id);
}

function roundTwoFinalistIds() {
  return Array.isArray(db.event.roundTwoFinalistIds) ? db.event.roundTwoFinalistIds : [];
}

function visibleTalks(round = currentRound()) {
  const talks = [...db.talks].sort((a, b) => a.order - b.order);
  if (round !== 2) return talks;
  const finalistIds = roundTwoFinalistIds();
  return talks.filter(talk => finalistIds.includes(talk.id));
}

function allowedTalkIds(round = currentRound()) {
  return new Set(visibleTalks(round).map(talk => talk.id));
}

function visibleVotes(round = currentRound()) {
  const votes = roundVotes(round);
  if (round !== 2) return votes;
  const allowed = allowedTalkIds(round);
  return votes.filter(vote => voteTalkIds(vote).every(talkId => allowed.has(talkId)));
}

function publicState(owner) {
  const round = currentRound();
  const votes = visibleVotes(round);
  const ownVote = owner?.deviceId
    ? votes.find(vote => vote.deviceId === owner.deviceId)
    : owner?.id
      ? votes.find(vote => vote.voterId === owner.id)
      : owner?.voter
        ? votes.find(vote => vote.voterId === owner.voter.id)
        : null;
  const ownVotes = owner?.deviceId
    ? votes.filter(vote => vote.deviceId === owner.deviceId)
    : owner?.id
      ? votes.filter(vote => vote.voterId === owner.id)
      : owner?.voter
        ? votes.filter(vote => vote.voterId === owner.voter.id)
        : [];
  const voter = owner?.voter || owner;
  return {
    event: { ...db.event, currentRound: round, criteria: selectionCriteria, selectionLimit: selectionLimit() },
    talks: visibleTalks(round),
    leaderboard: leaderboard(round).slice(0, 3),
    allTalksOpen: true,
    voter: voter?.id ? { id: voter.id, name: voter.name } : owner?.deviceId ? { id: owner.deviceId, name: "Это устройство" } : null,
    myVote: ownVote || null,
    myVotes: ownVotes
  };
}

function adminState(req) {
  const round = currentRound();
  const votes = visibleVotes(round);
  const votedVoterIds = new Set(votes.map(vote => vote.voterId).filter(Boolean));
  const pendingVoters = db.voters
    .filter(voter => !votedVoterIds.has(voter.id))
    .map(voter => ({ id: voter.id, name: voter.name }));
  const deviceVotesCount = votes.filter(vote => vote.deviceId).length;
  const votingProgress = {
    total: db.voters.length,
    voted: votedVoterIds.size,
    pending: pendingVoters,
    deviceVotesCount,
    resultsLocked: db.event.status !== "completed" && db.voters.length > 0 && votedVoterIds.size < db.voters.length
  };
  return {
    organizers: db.organizers.map(publicOrganizer),
    currentOrganizer: req && currentAdmin(req) ? publicOrganizer(currentAdmin(req)) : null,
    history: db.history.map(({ snapshot, ...summary }) => summary).reverse(),
    event: { ...db.event, currentRound: round, criteria: selectionCriteria, selectionLimit: selectionLimit() },
    talks: visibleTalks(round),
    allTalks: [...db.talks].sort((a, b) => a.order - b.order),
    voters: db.voters.map(voter => ({
      id: voter.id,
      name: voter.name,
      token: voter.token,
      createdAt: voter.createdAt,
      votesCount: votes.filter(vote => vote.voterId === voter.id).length,
      totalVotesCount: db.votes.filter(vote => vote.voterId === voter.id).length
    })),
    votes,
    votingProgress,
    rounds: [1, 2].map(item => ({
      round: item,
      votesCount: roundVotes(item).length,
      leaderboard: leaderboard(item)
    })),
    leaderboard: leaderboard(round),
    matrix: votes.map(vote => ({
      ...vote,
      voterName: db.voters.find(voter => voter.id === vote.voterId)?.name || (vote.deviceId ? "Общая ссылка" : "Жюри"),
      talkTitle: voteTalkIds(vote)
        .map(talkId => db.talks.find(talk => talk.id === talkId)?.title || "Удаленное выступление")
        .join(", ")
    }))
  };
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/public") return json(res, 200, publicState(voteOwner(req)));

  if (req.method === "POST" && url.pathname === "/api/votes") {
    const input = await body(req);
    if (db.event.status === "completed") return json(res, 409, { error: "Событие завершено. Голосование закрыто." });
    const owner = voteOwner(req);
    if (!owner.voter && !owner.deviceId) return json(res, 401, { error: "Не удалось определить устройство для голосования" });
    if ((input.eventId && input.eventId !== db.event.id) || (input.round && Number(input.round) !== currentRound())) return json(res, 409, { error: "Голосование изменилось. Обновите страницу." });
    const limit = selectionLimit();
    const requestedIds = limit === 1 ? [input.talkId] : Array.isArray(input.talkIds) ? input.talkIds : [];
    const talkIds = [...new Set(requestedIds)].filter(Boolean);
    if (talkIds.length !== limit) return json(res, 400, { error: limit === 1 ? "Выбери один лучший доклад" : "Выбери ровно 3 инициативы" });
    const allowed = allowedTalkIds();
    if (!talkIds.every(talkId => allowed.has(talkId))) return json(res, 404, { error: "Выступление не найдено или не прошло во второй раунд" });
    const comment = safeText(input.comment, 500);
    const round = currentRound();
    const existing = db.votes.find(vote => voteRound(vote) === round && (
      owner.voter ? vote.voterId === owner.voter.id : vote.deviceId === owner.deviceId
    ));
    const payload = {
      round,
      voterId: owner.voter?.id || null,
      deviceId: owner.deviceId,
      votingMode: db.event.votingMode,
      talkId: limit === 1 ? talkIds[0] : null,
      talkIds,
      comment,
      updatedAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, payload);
    else db.votes.push({ id: id(), createdAt: new Date().toISOString(), ...payload });
    saveDb();
    return json(res, 200, publicState(owner));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    const input = await body(req);
    const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "admin";
    const now = Date.now();
    for (const [key, attempt] of loginAttempts) if (attempt.until <= now) loginAttempts.delete(key);
    for (const [key, session] of adminSessions) if (session.expiresAt <= now) adminSessions.delete(key);
    const key = req.socket.remoteAddress;
    const attempt = loginAttempts.get(key) || { count: 0, until: now + 15 * 60000 };
    if (attempt.count >= 15) return json(res, 429, { error: "Слишком много попыток. Попробуйте через 15 минут." });
    attempt.count++;
    loginAttempts.set(key, attempt);
    const organizer = db.organizers.find(item => item.login === login);
    const password = typeof input.password === "string" && input.password.length <= 256 ? input.password : "";
    const hash = await scrypt(password, organizer?.salt || "invalid-account", 64);
    const expected = organizer ? Buffer.from(organizer.passwordHash, "hex") : Buffer.alloc(64);
    if (!organizer || !crypto.timingSafeEqual(hash, expected)) return json(res, 401, { error: "Неверный логин или пароль" });
    loginAttempts.delete(key);
    const token = id();
    adminSessions.set(token, { organizerId: organizer.id, expiresAt: now + sessionDuration });
    return json(res, 200, { ok: true }, {
      "Set-Cookie": `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${isProduction ? "; Secure" : ""}`
    });
  }

  if (url.pathname.startsWith("/api/admin/") && !isAdmin(req)) return json(res, 401, { error: "Нужен вход администратора" });
  if (req.method === "GET" && url.pathname === "/api/admin/state") return json(res, 200, adminState(req));

  if (req.method === "POST" && url.pathname === "/api/admin/qr") {
    const input = await body(req);
    let origin;
    try { origin = new URL(input.origin); } catch { return json(res, 400, { error: "Некорректный адрес сайта" }); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== input.origin || (origin.host !== req.headers.host && origin.origin !== publicOrigin)) {
      return json(res, 400, { error: "Используйте адрес текущего сайта" });
    }
    const voter = input.voterId ? db.voters.find(item => item.id === input.voterId) : null;
    if (input.voterId && !voter) return json(res, 404, { error: "Член жюри не найден" });
    const link = new URL(voter ? "/" : "/vote", origin);
    if (voter) link.searchParams.set("token", voter.token);
    const dataUrl = await QRCode.toDataURL(link.href, { errorCorrectionLevel: "M", margin: 4, scale: 10 });
    if (!currentAdmin(req)) return json(res, 401, { error: "Нужен вход администратора" });
    return json(res, 200, { link: link.href, dataUrl });
  }

  const passwordMatch = url.pathname.match(/^\/api\/admin\/organizers\/([^/]+)\/password$/);
  if (req.method === "POST" && passwordMatch) {
    const input = await body(req);
    const actor = currentAdmin(req);
    if (!actor) return json(res, 401, { error: "Нужен вход администратора" });
    const target = db.organizers.find(item => item.id === passwordMatch[1]);
    if (!target) return json(res, 404, { error: "Организатор не найден" });
    if (typeof input.password !== "string" || input.password.length < 10 || input.password.length > 256) return json(res, 400, { error: "Пароль должен содержать от 10 до 256 символов" });
    const now = Date.now();
    for (const [key, attempt] of passwordAttempts) if (attempt.until <= now) passwordAttempts.delete(key);
    const attempt = passwordAttempts.get(actor.id) || { count: 0, until: now + 15 * 60000 };
    if (attempt.count >= 5) return json(res, 429, { error: "Слишком много попыток. Попробуйте через 15 минут." });
    attempt.count++;
    passwordAttempts.set(actor.id, attempt);
    const actorHash = actor.passwordHash;
    const targetHash = target.passwordHash;
    const currentPassword = typeof input.currentPassword === "string" && input.currentPassword.length <= 256 ? input.currentPassword : "";
    const suppliedHash = await scrypt(currentPassword, actor.salt, 64);
    if (!crypto.timingSafeEqual(suppliedHash, Buffer.from(actorHash, "hex"))) return json(res, 403, { error: "Неверный текущий пароль вашего аккаунта" });
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(input.password, salt, 64)).toString("hex");
    // A reset or revocation during hashing must not authorize a stale request.
    if (currentAdmin(req) !== actor || actor.passwordHash !== actorHash) return json(res, 401, { error: "Войдите в аккаунт заново" });
    if (!db.organizers.includes(target) || target.passwordHash !== targetHash) return json(res, 409, { error: "Аккаунт изменился. Обновите страницу." });
    Object.assign(target, { salt, passwordHash });
    saveDb();
    passwordAttempts.delete(actor.id);
    for (const [token, session] of adminSessions) if (session.organizerId === target.id) adminSessions.delete(token);
    const headers = {};
    if (actor.id === target.id) {
      const token = id();
      adminSessions.set(token, { organizerId: actor.id, expiresAt: Date.now() + sessionDuration });
      headers["Set-Cookie"] = `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${isProduction ? "; Secure" : ""}`;
    }
    return json(res, 200, { ...adminState(req), currentOrganizer: publicOrganizer(actor) }, headers);
  }

  if (req.method === "POST" && url.pathname === "/api/admin/events/complete") {
    if (db.event.status !== "completed") {
      db.event.status = "completed";
      db.event.completedAt = new Date().toISOString();
      const snapshot = adminState();
      snapshot.allVotes = structuredClone(db.votes);
      delete snapshot.organizers;
      delete snapshot.currentOrganizer;
      delete snapshot.history;
      snapshot.voters = snapshot.voters.map(({ token, ...voter }) => voter);
      snapshot.votingProgress.resultsLocked = false;
      db.history.push({ id: db.event.id, title: db.event.title, completedAt: db.event.completedAt,
        talksCount: db.talks.length, votesCount: db.votes.length, snapshot: structuredClone(snapshot) });
      saveDb();
    }
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/events/new") {
    const input = await body(req);
    if (db.event.status !== "completed") return json(res, 409, { error: "Сначала завершите текущее событие" });
    const title = safeText(input.title, 300);
    if (!title) return json(res, 400, { error: "Введите название события" });
    db.event = { id: id(), title, status: "open", votingMode: "top3", currentRound: 1, roundTwoFinalistIds: [], activeTalkId: null };
    db.talks = []; db.voters = []; db.votes = [];
    saveDb();
    return json(res, 201, adminState(req));
  }

  const historyMatch = url.pathname.match(/^\/api\/admin\/history\/([^/]+)$/);
  if (req.method === "GET" && historyMatch) {
    const item = db.history.find(item => item.id === historyMatch[1]);
    return item ? json(res, 200, item) : json(res, 404, { error: "Событие не найдено" });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    adminSessions.delete(adminToken(req));
    return json(res, 200, { ok: true }, { "Set-Cookie": `admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProduction ? "; Secure" : ""}` });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/organizers") {
    const input = await body(req);
    const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9._@+-]{2,99}$/.test(login)) return json(res, 400, { error: "Логин: от 3 до 100 латинских букв, цифр или символов . _ @ + -" });
    if (typeof input.password !== "string" || input.password.length < 10 || input.password.length > 256) return json(res, 400, { error: "Пароль должен содержать от 10 до 256 символов" });
    if (db.organizers.some(item => item.login === login)) return json(res, 409, { error: "Этот логин уже занят" });
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(input.password, salt, 64)).toString("hex");
    // Recheck after asynchronous hashing to prevent duplicate concurrent accounts.
    if (!currentAdmin(req)) return json(res, 401, { error: "Нужен вход администратора" });
    if (db.organizers.some(item => item.login === login)) return json(res, 409, { error: "Этот логин уже занят" });
    db.organizers.push({ id: id(), login, name: safeText(input.name, 100) || login, salt, passwordHash, createdAt: new Date().toISOString() });
    saveDb();
    return json(res, 201, adminState(req));
  }

  const deleteOrganizer = url.pathname.match(/^\/api\/admin\/organizers\/([^/]+)$/);
  if (req.method === "DELETE" && deleteOrganizer) {
    const target = db.organizers.find(item => item.id === deleteOrganizer[1]);
    if (!target) return json(res, 404, { error: "Организатор не найден" });
    if (target.id === currentAdmin(req).id || db.organizers.length === 1) return json(res, 400, { error: "Нельзя удалить собственный аккаунт или последнего организатора" });
    db.organizers = db.organizers.filter(item => item.id !== target.id);
    for (const [token, session] of adminSessions) if (session.organizerId === target.id) adminSessions.delete(token);
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (!["GET", "HEAD"].includes(req.method) && db.event.status === "completed") return json(res, 409, { error: "Событие завершено. Создайте новое голосование." });

  if (req.method === "PATCH" && url.pathname === "/api/admin/event/presentation") {
    const input = await body(req);
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 300) return json(res, 400, { error: "Название: от 1 до 300 символов" });
    if (typeof input.votingIntro !== "string" || input.votingIntro.length > 600) return json(res, 400, { error: "Текст шапки: не более 600 символов" });
    db.event.title = input.title.trim();
    db.event.votingIntro = input.votingIntro.trim();
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/talks/import") {
    const input = await body(req);
    if (db.talks.length || db.votes.length) return json(res, 409, { error: "Импорт доступен в новое пустое событие" });
    if (!Array.isArray(input.talks) || !input.talks.length || input.talks.length > 200) return json(res, 400, { error: "Передайте от 1 до 200 докладов" });
    if (input.talks.some(talk => !talk || typeof talk.title !== "string" || !talk.title.trim())) return json(res, 400, { error: "У каждого доклада должно быть название" });
    if (input.talks.some(talk => !validTeam(talk.team))) return json(res, 400, { error: "Название команды: не более 200 символов" });
    db.talks = input.talks.map((talk, index) => ({ id: id(), title: safeText(talk.title, 300), team: safeText(talk.team, 200), order: index + 1, status: "planned" }));
    db.event.importSource = safeText(input.source, 64);
    saveDb();
    return json(res, 201, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/votes/reset") {
    const round = currentRound();
    db.votes = db.votes.filter(vote => voteRound(vote) !== round);
    if (round === 1) db.event.roundTwoFinalistIds = [];
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/event/round") {
    const input = await body(req);
    const round = Number(input.round);
    if (![1, 2].includes(round)) return json(res, 400, { error: "Неизвестный раунд голосования" });
    if (round === 2) {
      db.event.roundTwoFinalistIds = calculateRoundTwoFinalists();
    }
    db.event.currentRound = round;
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/event/mode") {
    const input = await body(req);
    if (!votingModes.has(input.votingMode)) return json(res, 400, { error: "Неизвестный режим голосования" });
    db.event.votingMode = input.votingMode;
    if (currentRound() === 1) db.event.roundTwoFinalistIds = [];
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/voters") {
    const input = await body(req);
    const name = safeText(input.name, 100);
    if (name.length < 3) return json(res, 400, { error: "Укажи ФИО члена жюри" });
    const voter = { id: id(), token: id(), name, createdAt: new Date().toISOString() };
    db.voters.push(voter);
    saveDb();
    return json(res, 201, adminState(req));
  }

  const deleteVoter = url.pathname.match(/^\/api\/admin\/voters\/([^/]+)$/);
  if (req.method === "DELETE" && deleteVoter) {
    const voterId = deleteVoter[1];
    db.votes = db.votes.filter(vote => vote.voterId !== voterId);
    db.voters = db.voters.filter(voter => voter.id !== voterId);
    saveDb();
    return json(res, 200, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/talks") {
    const input = await body(req);
    const title = safeText(input.title, 300);
    if (!title) return json(res, 400, { error: "Нужно название выступления" });
    if (!validTeam(input.team)) return json(res, 400, { error: "Название команды: не более 200 символов" });
    db.talks.push({
      id: id(),
      title,
      team: safeText(input.team, 200),
      order: db.talks.length + 1,
      status: "planned"
    });
    saveDb();
    return json(res, 201, adminState(req));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/talks/reorder") {
    const input = await body(req);
    const ids = Array.isArray(input.ids) ? input.ids : [];
    const currentIds = db.talks.map(talk => talk.id);
    const hasSameIds = ids.length === currentIds.length && currentIds.every(talkId => ids.includes(talkId));
    if (!hasSameIds) return json(res, 400, { error: "Некорректный порядок выступлений" });
    const byId = new Map(db.talks.map(talk => [talk.id, talk]));
    db.talks = ids.map((talkId, index) => ({ ...byId.get(talkId), order: index + 1 }));
    saveDb();
    return json(res, 200, adminState(req));
  }

  const activeMatch = url.pathname.match(/^\/api\/admin\/talks\/([^/]+)\/active$/);
  if (req.method === "POST" && activeMatch) {
    const talkId = activeMatch[1];
    if (talkId !== "none" && !db.talks.some(talk => talk.id === talkId)) return json(res, 404, { error: "Выступление не найдено" });
    db.event.activeTalkId = talkId === "none" ? null : talkId;
    db.talks.forEach(talk => { talk.status = talk.id === db.event.activeTalkId ? "active" : "planned"; });
    saveDb();
    return json(res, 200, adminState(req));
  }

  const deleteTalk = url.pathname.match(/^\/api\/admin\/talks\/([^/]+)$/);
  if (req.method === "PATCH" && deleteTalk) {
    const input = await body(req);
    if (!input || typeof input !== "object" || Array.isArray(input)) return json(res, 400, { error: "Некорректные данные выступления" });
    if (!isAdmin(req)) return json(res, 401, { error: "Нужен вход администратора" });
    if (db.event.status === "completed") return json(res, 409, { error: "Завершённое событие нельзя редактировать" });
    const talk = db.talks.find(talk => talk.id === deleteTalk[1]);
    if (!talk) return json(res, 404, { error: "Выступление не найдено" });
    const changes = {};
    for (const [field, max] of [["title", 300], ["team", 200]]) {
      if (!(field in input)) continue;
      if (typeof input[field] !== "string" || input[field].trim().length > max) return json(res, 400, { error: "Некорректное или слишком длинное значение поля" });
      changes[field] = safeText(input[field], max);
    }
    if ("title" in changes && !changes.title) return json(res, 400, { error: "Нужно название выступления" });
    if (!Object.keys(changes).length) return json(res, 400, { error: "Нет изменений для сохранения" });
    Object.assign(talk, changes);
    saveDb();
    return json(res, 200, adminState(req));
  }
  if (req.method === "DELETE" && deleteTalk) {
    const talkId = deleteTalk[1];
    db.votes = db.votes.filter(vote => !voteTalkIds(vote).includes(talkId));
    db.talks = db.talks.filter(talk => talk.id !== talkId).map((talk, index) => ({ ...talk, order: index + 1 }));
    if (db.event.activeTalkId === talkId) db.event.activeTalkId = null;
    saveDb();
    return json(res, 200, adminState(req));
  }

  return json(res, 404, { error: "Маршрут не найден" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
      const origin = new URL(req.headers.origin);
      if (origin.host !== req.headers.host && origin.origin !== publicOrigin) return json(res, 403, { error: "Запрос с другого сайта запрещён" });
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const file = ["/", "/vote", "/vote/"].includes(url.pathname) ? "index.html" : url.pathname === "/admin" ? "admin.html" : url.pathname.slice(1);
    const publicFiles = new Set(["index.html", "admin.html", "styles.css", "admin.css", "voting.css", "app.js", "admin.js"]);
    if (!publicFiles.has(file) && !/^fonts\/[A-Za-z0-9_-]+\.ttf$/.test(file)) return json(res, 404, { error: "Не найдено" });
    const resolved = path.resolve(root, file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return json(res, 404, { error: "Не найдено" });
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".ttf": "font/ttf"
    };
    res.writeHead(200, {
      "Content-Type": types[path.extname(resolved)] || "application/octet-stream",
      ...securityHeaders()
    });
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    console.error(error);
    json(res, error instanceof SyntaxError ? 400 : 500, { error: "Ошибка сервера" });
  }
});

if (require.main === module) {
  server.listen(port, host, () => {
    if (adminPassword === "change-me") console.warn("WARNING: set ADMIN_PASSWORD before publishing.");
    console.log(`Demo Day Voting: http://${host}:${port}`);
    console.log(`Admin: http://${host}:${port}/admin`);
  });
}

module.exports = server;
