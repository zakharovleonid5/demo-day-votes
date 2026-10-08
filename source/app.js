const tokenKey = "demo-day-voter-token";
const deviceKey = "demo-day-device-id";
const urlParams = new URLSearchParams(location.search);
const urlToken = urlParams.get("token");
const commonEntry = (location.pathname.replace(/\/$/, "") === "/vote" || urlParams.get("public") === "1") && !urlToken;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} }
};
if (commonEntry) {
  storage.remove(tokenKey);
  history.replaceState(null, "", "/vote");
}

if (urlToken) {
  storage.set(tokenKey, urlToken);
}

let token = commonEntry ? null : urlToken || storage.get(tokenKey);
let deviceId = storage.get(deviceKey);
if (!deviceId) {
  deviceId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  storage.set(deviceKey, deviceId);
}
const deviceRemembered = storage.get(deviceKey) === deviceId;

let state = null;
let selectedTalkIds = [];
let commentDraft = "";
let hasDraftSelection = false;
let editingSavedVote = false;
let loadedRound = null;
let loadedEvent = null;

const api = async (path, options = {}) => {
  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Ошибка");
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Нет связи с сервером. Обнови страницу или проверь интернет.");
    throw error;
  }
};

const toast = message => {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
};

const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
})[char]);

function currentLimit() {
  return state?.event?.selectionLimit || (state?.event?.votingMode === "top3" ? 3 : 1);
}

function savedTalkIds() {
  if (!state?.myVote) return [];
  if (Array.isArray(state.myVote.talkIds)) return state.myVote.talkIds;
  return state.myVote.talkId ? [state.myVote.talkId] : [];
}

function talksById() {
  return new Map((state?.talks || []).map(talk => [talk.id, talk]));
}

function modeNote() {
  return currentLimit() === 3
    ? "Выбери три фичи, которые считаешь лучшими. Выбор сохранится для этого устройства."
    : "Выбери один доклад, который считаешь лучшим. Выбор сохранится для этого устройства.";
}

function renderHeading() {
  document.querySelector("#ballotTitle").textContent = state.event.title;
  document.title = `${state.event.title} · Голосование`;
  const completed = state.event.status === "completed";
  document.querySelector("#ballotRound").textContent = completed ? "Завершено" : `Раунд ${state.event.currentRound || 1} · Топ-${currentLimit()}`;
  document.querySelector("#ballotRound").classList.toggle("completed", completed);
  document.querySelector("#modeNote").textContent = state.event.votingIntro || (completed ? "Спасибо за участие! Результаты сохранены." : modeNote());
}

async function load() {
  state = await api("/api/public");
  const limit = currentLimit();
  const round = state.event.currentRound || 1;
  if (loadedRound !== null && (loadedRound !== round || loadedEvent !== state.event.id)) {
    selectedTalkIds = [];
    commentDraft = "";
    hasDraftSelection = false;
    editingSavedVote = false;
  }
  loadedRound = round;
  loadedEvent = state.event.id;
  if (!hasDraftSelection) selectedTalkIds = savedTalkIds().slice(0, limit);
  if (!hasDraftSelection) commentDraft = state.myVote?.comment ?? commentDraft;
  renderHeading();
  renderTalks();
}

function renderResult() {
  const byId = talksById();
  const chosen = savedTalkIds().map((talkId, index) => ({ ...byId.get(talkId), place: index + 1 })).filter(item => item.id);
  const limit = currentLimit();
  const label = state.event.status === "completed" ? "Голосование завершено" : limit === 3 ? "Твой топ-3 сохранен" : "Твой выбор сохранен";

  document.querySelector("#talks").innerHTML = `
    <section class="vote-result">
      <div class="result-card">
        <span class="result-badge">Голос учтен</span>
        <h2>${label}</h2>
        <div class="chosen-list">
          ${chosen.map(item => `
            <article class="chosen-item">
              <span>${limit === 3 ? `Топ-${item.place}` : "Выбор"}</span>
              <strong>${esc(item.title)}</strong>
            </article>
          `).join("")}
        </div>
        ${state.event.status === "completed" ? "" : '<button class="ghost edit-vote" type="button">Изменить выбор</button>'}
      </div>
      <div class="public-leaderboard">
        <h2>Текущий топ-3</h2>
        ${(state.leaderboard || []).map((talk, index) => {
          const value = talk.stats.score ?? talk.stats.votesCount;
          return `
            <article class="public-leader-row">
              <span>#${index + 1}</span>
              <div>
                <strong>${esc(talk.title)}</strong>
              </div>
              <b>${value}</b>
            </article>
          `;
        }).join("") || `<p class="muted">Лидерборд появится после первых голосов.</p>`}
      </div>
    </section>
  `;

  document.querySelector(".edit-vote")?.addEventListener("click", () => {
    editingSavedVote = true;
    hasDraftSelection = true;
    selectedTalkIds = savedTalkIds().slice(0, limit);
    commentDraft = state.myVote?.comment || "";
    renderTalks();
  });
}

function renderTalks() {
  if (state.event.status === "completed") {
    if (state.myVote) renderResult();
    else document.querySelector("#talks").innerHTML = '<section class="result-card"><h2>Голосование завершено</h2><p class="muted">Спасибо за участие! Организатор завершил событие. Приём голосов закрыт.</p></section>';
    return;
  }
  if (token && !state.voter) {
    document.querySelector("#talks").innerHTML = '<section class="result-card"><h2>Это приглашение больше не действует</h2><p class="muted">Возможно, оно относится к прошлому событию или было отозвано. Для личного голосования запросите новое приглашение у организатора. Если вам прислали общую ссылку, откройте общую анкету.</p><a class="ballot-recovery" href="/vote">Открыть общую анкету</a></section>';
    return;
  }
  if (!token && !deviceRemembered) {
    document.querySelector("#talks").innerHTML = '<section class="result-card"><h2>Разрешите сохранение данных сайта</h2><p class="muted">Браузер не позволяет запомнить ваш голос. Откройте эту ссылку в Safari или Chrome и разрешите хранение данных сайта, либо запросите личную ссылку у организатора.</p><button class="ghost retry-storage" type="button">Проверить снова</button></section>';
    document.querySelector(".retry-storage").onclick = () => location.reload();
    return;
  }
  if (!state.talks.length) {
    document.querySelector("#talks").innerHTML = '<section class="result-card"><h2>Программа готовится</h2><p class="muted">Доклады появятся, когда организатор добавит их в голосование.</p></section>';
    return;
  }
  if (state.myVote && !hasDraftSelection && !editingSavedVote) {
    renderResult();
    return;
  }

  const limit = currentLimit();
  const ready = selectedTalkIds.length === limit;
  const showSaveWidget = ready && hasDraftSelection;
  document.querySelector("#talks").innerHTML = `
    ${limit === 3 ? `
      <section class="points-explainer" aria-label="Условия распределения баллов">
        <div>
          <span class="points-kicker">Как считаются баллы</span>
          <strong>Чем выше место, тем больше вклад в итоговый рейтинг.</strong>
        </div>
        <div class="points-grid">
          <span><b>1 место</b><em>2 балла</em></span>
          <span><b>2 место</b><em>1 балл</em></span>
          <span><b>3 место</b><em>1 балл</em></span>
        </div>
      </section>
    ` : ""}
    <div class="best-choice-list">
      ${state.talks.map(talk => {
        const selectedIndex = selectedTalkIds.indexOf(talk.id);
        const isSelected = selectedIndex !== -1;
        return `
          <button class="best-talk ${isSelected ? "selected" : ""}" type="button" data-talk="${talk.id}" aria-pressed="${isSelected}">
            <span class="best-talk-order">${talk.order}</span>
            <span class="best-talk-main">
              <strong>${esc(talk.title)}</strong>
            </span>
            <span class="best-talk-check">${isSelected ? (limit === 3 ? `Топ-${selectedIndex + 1}` : "Выбрано") : "Выбрать"}</span>
          </button>
        `;
      }).join("")}
    </div>
    <div class="save-widget ${showSaveWidget ? "show" : ""}" aria-live="polite">
      <div>
        <span>${ready ? "Выбор готов к сохранению" : `Выбрано ${selectedTalkIds.length} из ${limit}`}</span>
        <strong>${selectedTalkIds.length}/${limit}</strong>
      </div>
      <button class="submit-vote" type="button">${state.myVote ? "Обновить выбор" : "Сохранить выбор"}</button>
    </div>
  `;

  document.querySelectorAll(".best-talk").forEach(button => button.addEventListener("click", () => {
    const talkId = button.dataset.talk;
    const selectedIndex = selectedTalkIds.indexOf(talkId);
    if (limit === 1) {
      selectedTalkIds = [talkId];
    } else if (selectedIndex !== -1) {
      selectedTalkIds = selectedTalkIds.filter(id => id !== talkId);
    } else if (selectedTalkIds.length < limit) {
      selectedTalkIds = [...selectedTalkIds, talkId];
    } else {
      toast(`Уже выбрано ${limit}. Сними один выбор, чтобы заменить.`);
      return;
    }
    hasDraftSelection = true;
    renderTalks();
    [...document.querySelectorAll(".best-talk")].find(item => item.dataset.talk === talkId)?.focus({ preventScroll: true });
  }));
  document.querySelector(".submit-vote")?.addEventListener("click", submitVote);
}

async function submitVote() {
  const limit = currentLimit();
  if (selectedTalkIds.length !== limit) return toast(limit === 3 ? "Выбери ровно 3 инициативы." : "Выбери один лучший доклад.");
  const button = document.querySelector(".submit-vote");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    state = await api("/api/votes", {
      method: "POST",
      body: JSON.stringify({
        eventId: state.event.id,
        round: state.event.currentRound,
        talkId: limit === 1 ? selectedTalkIds[0] : undefined,
        talkIds: limit === 3 ? selectedTalkIds : undefined,
        comment: commentDraft
      })
    });
    hasDraftSelection = false;
    editingSavedVote = false;
    selectedTalkIds = savedTalkIds();
    renderHeading();
    renderResult();
    toast("Выбор сохранен.");
  } catch (error) {
    toast(error.message);
  } finally { if (button) button.disabled = false; }
}

setInterval(() => load().catch(() => {}), 15000);
async function initialLoad() {
  try { await load(); }
  catch (error) {
    document.querySelector("#talks").innerHTML = `<section class="result-card"><h2>Не удалось загрузить голосование</h2><p class="muted">${esc(error.message)}</p><button class="ghost retry-voting" type="button">Повторить</button></section>`;
    document.querySelector(".retry-voting").onclick = initialLoad;
  }
}
initialLoad();
