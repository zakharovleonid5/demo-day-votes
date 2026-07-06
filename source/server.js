const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const dataFile = process.env.DATA_FILE || path.join(root, "data", "db.json");
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const isProduction = process.env.NODE_ENV === "production";
const adminSessions = new Set();
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
    { id: "talk-1", title: "Сокращенная анкета", speaker: "Спикер уточняется", description: "Дебетовые карты.", order: 1, status: "planned" },
    { id: "talk-2", title: "1.Новый CJ оплаты по QR СБП   2.Льготные курсы обмена валюты на главном экране МАРР", speaker: "Щипков Михаил Николаевич", description: "Daily Banking. 1) Обновлённый путь оплаты по QR — быстрее, без лишних шагов. 2) Льготный курс вынесен на главный экран — доступ ускорен в 7 раз.", order: 2, status: "planned" },
    { id: "talk-3", title: "Редизайн экрана вклада и счёта", speaker: "Ковалева Елена Сергеевна", description: "Daily Banking. Новый клиентский путь: договор, условия, FAQ в одном месте.", order: 3, status: "planned" },
    { id: "talk-4", title: "Зарплатные карты с курьерской доставкой", speaker: "Прокофьева Ксения Сергеевна", description: "Daily Banking. Упрощённый процесс открытия зарплатных карт ЮЛ.", order: 4, status: "planned" },
    { id: "talk-5", title: "Витрина продуктов в мобильном приложении", speaker: "Капоте Кирилл Робертович", description: "Digital Channel. Сегментированная витрина: эффективность +43%, трафик в VAS — в 9 раз.", order: 5, status: "planned" },
    { id: "talk-6", title: "Новая история операций в мобильном приложении", speaker: "Ниязметова Любовь Викторовна", description: "Digital Channel. Переосмысленный UI с AI-аналитикой по категориям и поиском.", order: 6, status: "planned" },
    { id: "talk-7", title: "Выбор суммы кредита после одобрения", speaker: "Попова Юлия Сергеевна", description: "Credit Area. Клиент может скорректировать сумму кредита наличными.", order: 7, status: "planned" },
    { id: "talk-8", title: "Рассрочка на перевод свободного лимита по СБП", speaker: "Липин Александр Вадимович", description: "Credit Cards Value Area. Новый механизм рассрочки на лимит карты через СБП.", order: 8, status: "planned" },
    { id: "talk-9", title: "Уведомление о сделке через брокера", speaker: "Шеломенцева Дарья", description: "Lending. Сотрудник мгновенно узнаёт о сделке — обработка сократится с 90 до 20 минут.", order: 9, status: "planned" },
    { id: "talk-10", title: "Trino — единое окно доступа к данным", speaker: "Кучерова Екатерина Николаевна", description: "IT / Data. Путь от идеи до результата сократится с 30 до 2 дней — трансформация работы с данными всего банка.", order: 10, status: "planned" },
    { id: "talk-11", title: "Цифровой процесс трудоустройства (Space)", speaker: "Елена Когут", description: "HR Tech. Безбумажное оформление сотрудника удалённо, с первого дня.", order: 11, status: "planned" },
    { id: "talk-12", title: "QR для бизнес-залов и Fast track", speaker: "Кромский Семён Дмитриевич", description: "Premium & Private. Единый раздел привилегий — QR-код без перехода в другие приложения.", order: 12, status: "planned" },
    { id: "talk-13", title: "Витрина персональных акций в ДБО", speaker: "Орлов Ростислав Дмитриевич", description: "CVM. Все доступные клиенту акции собраны в одном месте.", order: 13, status: "planned" },
    { id: "talk-14", title: "Персонализированные категории кешбэка", speaker: "Дукарт Иван Александрович", description: "CVM. Программа лояльности подбирает категории кешбэка под клиента.", order: 14, status: "planned" },
    { id: "talk-15", title: "Кабинет ПреКлиента (ПреКабинет)", speaker: "Герасименко Антон Юрьевич", description: "Corporate & SME. Self-service для потенциальных клиентов без визита в офис.", order: 15, status: "planned" },
    { id: "talk-16", title: "Онбординг через помощника в ДБО + маскот банка", speaker: "Тананаев Дмитрий Денисович", description: "Corporate & SME. Триггерные сообщения от персонажа-помощника пользователю.", order: 16, status: "planned" },
    { id: "talk-17", title: "Бизнес-карты в ДБО ЮЛ", speaker: "Курч Виктор Александрович", description: "Corporate & SME. Дистанционное управление бизнес-картой в кабинете.", order: 17, status: "planned" },
    { id: "talk-18", title: "Currency Connect", speaker: "Сафонов Олег Дмитриевич", description: "Corporate & SME. Ускорение валютного платежа ЮЛ — график роста за 5 месяцев.", order: 18, status: "planned" }
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
    "Referrer-Policy": "same-origin",
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
  return typeof value === "string" ? value.trim().slice(0, max).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]) : "";
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
  const currentDeviceId = deviceId(req);
  if (currentDeviceId) return { voter: null, deviceId: currentDeviceId };
  return { voter: null, deviceId: null };
}

function isAdmin(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .find(item => item.startsWith("admin_session="))
    ?.split("=")[1];
  return token && adminSessions.has(token);
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

function adminState() {
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
    resultsLocked: db.voters.length > 0 && votedVoterIds.size < db.voters.length
  };
  return {
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
    const owner = voteOwner(req);
    if (!owner.voter && !owner.deviceId) return json(res, 401, { error: "Не удалось определить устройство для голосования" });
    const input = await body(req);
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
    const digest = value => crypto.createHash("sha256").update(String(value)).digest();
    const valid = crypto.timingSafeEqual(digest(input.password || ""), digest(adminPassword));
    if (!valid) return json(res, 401, { error: "Неверный пароль" });
    const token = id();
    adminSessions.add(token);
    return json(res, 200, { ok: true }, {
      "Set-Cookie": `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${isProduction ? "; Secure" : ""}`
    });
  }

  if (url.pathname.startsWith("/api/admin/") && !isAdmin(req)) return json(res, 401, { error: "Нужен вход администратора" });
  if (req.method === "GET" && url.pathname === "/api/admin/state") return json(res, 200, adminState());

  if (req.method === "POST" && url.pathname === "/api/admin/votes/reset") {
    const round = currentRound();
    db.votes = db.votes.filter(vote => voteRound(vote) !== round);
    if (round === 1) db.event.roundTwoFinalistIds = [];
    saveDb();
    return json(res, 200, adminState());
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
    return json(res, 200, adminState());
  }

  if (req.method === "POST" && url.pathname === "/api/admin/event/mode") {
    const input = await body(req);
    if (!votingModes.has(input.votingMode)) return json(res, 400, { error: "Неизвестный режим голосования" });
    db.event.votingMode = input.votingMode;
    if (currentRound() === 1) db.event.roundTwoFinalistIds = [];
    saveDb();
    return json(res, 200, adminState());
  }

  if (req.method === "POST" && url.pathname === "/api/admin/voters") {
    const input = await body(req);
    const name = safeText(input.name, 100);
    if (name.length < 3) return json(res, 400, { error: "Укажи ФИО члена жюри" });
    const voter = { id: id(), token: id(), name, createdAt: new Date().toISOString() };
    db.voters.push(voter);
    saveDb();
    return json(res, 201, adminState());
  }

  const deleteVoter = url.pathname.match(/^\/api\/admin\/voters\/([^/]+)$/);
  if (req.method === "DELETE" && deleteVoter) {
    const voterId = deleteVoter[1];
    db.votes = db.votes.filter(vote => vote.voterId !== voterId);
    db.voters = db.voters.filter(voter => voter.id !== voterId);
    saveDb();
    return json(res, 200, adminState());
  }

  if (req.method === "POST" && url.pathname === "/api/admin/talks") {
    const input = await body(req);
    const title = safeText(input.title, 140);
    if (!title) return json(res, 400, { error: "Нужно название выступления" });
    db.talks.push({
      id: id(),
      title,
      speaker: safeText(input.speaker, 80),
      description: safeText(input.description, 300),
      order: db.talks.length + 1,
      status: "planned"
    });
    saveDb();
    return json(res, 201, adminState());
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
    return json(res, 200, adminState());
  }

  const activeMatch = url.pathname.match(/^\/api\/admin\/talks\/([^/]+)\/active$/);
  if (req.method === "POST" && activeMatch) {
    const talkId = activeMatch[1];
    if (talkId !== "none" && !db.talks.some(talk => talk.id === talkId)) return json(res, 404, { error: "Выступление не найдено" });
    db.event.activeTalkId = talkId === "none" ? null : talkId;
    db.talks.forEach(talk => { talk.status = talk.id === db.event.activeTalkId ? "active" : "planned"; });
    saveDb();
    return json(res, 200, adminState());
  }

  const deleteTalk = url.pathname.match(/^\/api\/admin\/talks\/([^/]+)$/);
  if (req.method === "DELETE" && deleteTalk) {
    const talkId = deleteTalk[1];
    db.votes = db.votes.filter(vote => !voteTalkIds(vote).includes(talkId));
    db.talks = db.talks.filter(talk => talk.id !== talkId).map((talk, index) => ({ ...talk, order: index + 1 }));
    if (db.event.activeTalkId === talkId) db.event.activeTalkId = null;
    saveDb();
    return json(res, 200, adminState());
  }

  return json(res, 404, { error: "Маршрут не найден" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const file = url.pathname === "/" ? "index.html" : url.pathname === "/admin" ? "admin.html" : url.pathname.slice(1);
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
