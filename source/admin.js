let state = null;
let currentOrganizer = null;
let sorting = false;
let openHistory = null;
let editingTalkId = null;
let passwordOrganizerId = null;
let qrVoterId = "";
let qrRequestId = 0;
const tabLabels = { talks: "Выступления", jury: "Жюри", events: "События", organizers: "Организаторы" };

function selectTab(name, focus = false) {
  if (name === "results") document.querySelector("#currentStatistics").open = true;
  if (name === "results" || name === "history") name = "events";
  if (!tabLabels[name]) name = "talks";
  document.querySelectorAll("[data-tab]").forEach(button => {
    const active = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    document.querySelector(`#panel-${button.dataset.tab}`).hidden = !active;
    if (active && focus) button.focus();
  });
  document.querySelector("#breadcrumb").textContent = tabLabels[name];
  document.querySelector("#pageDescription").textContent = { talks: "Программа выступлений и настройки голосования.", jury: "Персональные приглашения и общая ссылка.", events: "Управление событиями, статистика и сохранённые результаты.", organizers: "Команда, которая управляет Demo Day." }[name];
  history.replaceState(null, "", `#${name}`);
}

const api = async (path, options = {}) => {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || "Ошибка"); error.status = response.status; throw error; }
    return result;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Нет связи с сервером. Запусти сайт через npm start.");
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

const askConfirm = ({ title, message, okText = "ОК", danger = false }) => new Promise(resolve => {
  const dialog = document.querySelector("#confirmDialog");
  const titleEl = document.querySelector("#confirmTitle");
  const messageEl = document.querySelector("#confirmMessage");
  const ok = document.querySelector("#confirmOk");
  const cancel = document.querySelector("#confirmCancel");

  titleEl.textContent = title;
  messageEl.textContent = message;
  ok.textContent = okText;
  ok.classList.toggle("danger", danger);

  let settled = false;
  const cleanup = result => {
    if (settled) return;
    settled = true;
    ok.onclick = null;
    cancel.onclick = null;
    dialog.oncancel = null;
    dialog.onclose = null;
    resolve(result);
  };

  ok.onclick = event => {
    event.preventDefault();
    dialog.close();
    cleanup(true);
  };
  cancel.onclick = () => {
    dialog.close();
    cleanup(false);
  };
  dialog.oncancel = event => {
    event.preventDefault();
    dialog.close();
    cleanup(false);
  };
  dialog.onclose = () => cleanup(false);
  dialog.showModal();
});

const voteTalkIds = vote => Array.isArray(vote.talkIds) ? vote.talkIds : vote.talkId ? [vote.talkId] : [];

const copyText = async text => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to legacy copy paths below.
    }
  }

  const onCopy = event => {
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  const copiedByEvent = document.execCommand("copy");
  document.removeEventListener("copy", onCopy);
  if (copiedByEvent) return;

  const input = document.activeElement?.closest?.(".voter-row")?.querySelector("input");
  if (input) {
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "0";
  textarea.style.top = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
};

async function load(showError = false) {
  try {
    state = await api("/api/admin/state");
    document.querySelector("#login").hidden = true;
    document.querySelector("#dashboard").hidden = false;
    render();
  } catch (error) {
    if (state && error.status !== 401) { toast(error.message); return; }
    state = null;
    document.querySelector("#login").hidden = false;
    document.querySelector("#dashboard").hidden = true;
    if (showError) document.querySelector("#loginError").textContent = error.message;
  }
}

function render() {
  currentOrganizer = state.currentOrganizer || currentOrganizer;
  const completed = state.event.status === "completed";
  const allTalks = state.allTalks || state.talks;
  document.querySelector("#currentUser").textContent = currentOrganizer?.name || "Организатор";
  document.querySelector("#userAvatar").textContent = (currentOrganizer?.name || "О").slice(0, 1).toUpperCase();
  document.querySelector("#eventTitle").textContent = state.event.title;
  document.querySelector("#eventStatus").textContent = completed ? "Событие завершено" : "Голосование открыто";
  document.querySelector("#eventStatus").classList.toggle("completed", completed);
  document.querySelector("#eventRound").textContent = `Раунд ${state.event.currentRound || 1}`;
  document.querySelector("#completeEvent").hidden = completed;
  document.querySelector("#newEvent").disabled = !completed;
  document.querySelector("#newEventHint").textContent = completed ? "Можно создать новое событие. Результаты завершённых событий сохраняются ниже." : "Чтобы создать новое событие, завершите текущее.";
  document.querySelector("#programCount").textContent = allTalks.length;
  document.querySelector("#editEventPresentation").disabled = completed;
  document.querySelector("#ballotIntroPreview").textContent = state.event.votingIntro || "Стандартная инструкция для выбранного режима голосования.";
  document.querySelectorAll("[data-round], [data-mode], #addTalk, #resetVotes, #voterForm button, #voterForm input").forEach(item => { item.disabled = completed; });
  const votesCount = state.votes.length;
  const isTop3 = state.event.votingMode === "top3";
  const round = state.event.currentRound || 1;
  const progress = state.votingProgress || { total: 0, voted: 0, pending: [], deviceVotesCount: 0, resultsLocked: false };
  const showScores = isTop3 || state.leaderboard.some(item => (item.stats.score ?? item.stats.votesCount) !== item.stats.votesCount);
  document.querySelector("#metrics").innerHTML = [
    ["Выступлений в раунде", state.talks.length],
    ["Жюри", state.voters.length],
    ["Раунд", round],
    ["Голосов", votesCount]
  ].map(([label, value]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");

  document.querySelector("#roundHint").textContent = round === 1 ? "В финал проходят топ-6 и все с полным равенством на границе. Голоса раундов считаются отдельно." : `Финалистов: ${state.talks.length}. Учитываются только голоса второго раунда.`;
  document.querySelectorAll("[data-round]").forEach(button => {
    const active = Number(button.dataset.round) === round;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("#modeHint").textContent = isTop3
    ? "1-е место: 2 балла. 2-е и 3-е места: по 1 баллу."
    : "Сейчас каждый член жюри выбирает один лучший доклад.";
  document.querySelectorAll("[data-mode]").forEach(button => {
    const active = button.dataset.mode === state.event.votingMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("#leaderboardTitle").textContent = `Лидерборд · Раунд ${round}`;
  document.querySelector("#matrixTitle").textContent = `Матрица голосов · Раунд ${round}`;

  const commonLink = `${location.origin}/vote`;
  const commonInput = document.querySelector("#commonVoteLink");
  const commonButton = document.querySelector("#copyCommonLink");
  if (commonInput && commonButton) {
    commonInput.value = commonLink;
    commonButton.dataset.link = commonLink;
  }

  document.querySelector("#progressBadge").textContent = progress.total
    ? `${progress.voted} из ${progress.total}`
    : `${votesCount} голосов`;
  document.querySelector("#eventProgress").textContent = progress.total ? `Проголосовали ${progress.voted} из ${progress.total}` : `Получено голосов: ${votesCount}`;
  document.querySelector("#votingProgress").innerHTML = progress.total ? `
    <div class="progress-meter" aria-label="Прогресс голосования">
      <span style="width:${Math.round(progress.voted / Math.max(1, progress.total) * 100)}%"></span>
    </div>
    <p class="muted">Проголосовали ${progress.voted} из ${progress.total}. ${progress.resultsLocked ? "Результаты скрыты до завершения голосования." : "Результаты доступны."}</p>
    ${progress.pending.length ? `
      <div class="pending-voters">
        <strong>Ждём голос:</strong>
        ${progress.pending.map(voter => `<span>${esc(voter.name)}</span>`).join("")}
      </div>
    ` : `<p class="muted">Все заведенные члены жюри проголосовали. Результаты открыты ниже.</p>`}
    ${progress.deviceVotesCount ? `<p class="muted">Голосов с общей ссылки: ${progress.deviceVotesCount}. По ним нельзя понять, кто именно голосовал.</p>` : ""}
  ` : `
    <p class="muted">Члены жюри не заведены. Если голосуете по общей ссылке, можно видеть только количество голосов с устройств: ${progress.deviceVotesCount || votesCount}.</p>
  `;

  document.querySelector("#activeTalks").innerHTML = allTalks.map((talk, index) => `
      <div class="active-row ${completed ? "" : "draggable"}" draggable="${!completed}" data-talk-id="${talk.id}">
        <div class="drag-handle" title="Перетащить">${index + 1}</div>
        <div><strong>${esc(talk.title)}</strong>${round === 2 ? `<span class="status-tag">${state.talks.some(item => item.id === talk.id) ? "Финалист" : "Раунд 1"}</span>` : ""}</div>
        <div class="move-actions"><button class="ghost icon-button move-talk" data-move="-1" data-talk="${talk.id}" ${completed || index === 0 ? "disabled" : ""} title="Поднять доклад" aria-label="Поднять доклад">↑</button><button class="ghost icon-button move-talk" data-move="1" data-talk="${talk.id}" ${completed || index === allTalks.length - 1 ? "disabled" : ""} title="Опустить доклад" aria-label="Опустить доклад">↓</button></div>
        <div class="talk-actions"><button class="ghost edit-talk" type="button" data-talk="${talk.id}" ${completed ? "disabled" : ""}>Редактировать</button><button class="ghost danger-text delete-talk" type="button" data-talk="${talk.id}" ${completed ? "disabled" : ""}>Удалить</button></div>
      </div>
    `).join("") || `<p class="muted">Пока нет докладов.</p>`;

  document.querySelector("#voters").innerHTML = state.voters.map(voter => {
    const link = `${location.origin}/?token=${encodeURIComponent(voter.token)}`;
    const totalVotes = voter.totalVotesCount ?? voter.votesCount ?? 0;
    return `
      <article class="voter-row">
        <div>
          <strong>${esc(voter.name)}</strong>
          <div class="muted">${voter.votesCount || 0} голосов в раунде${totalVotes !== voter.votesCount ? ` · всего ${totalVotes}` : ""}</div>
        </div>
        <input readonly value="${esc(link)}" aria-label="Индивидуальная ссылка для ${esc(voter.name)}">
        <div class="link-actions"><button class="ghost copy-link" type="button" data-link="${esc(link)}">Скопировать</button><button class="ghost show-qr" type="button" data-voter="${esc(voter.id)}">QR-код</button></div>
        <button class="ghost danger-text delete-voter" type="button" data-voter="${voter.id}" ${completed ? "disabled" : ""}>Удалить</button>
      </article>`;
  }).join("") || `<p class="muted">Пока нет членов жюри. Добавь ФИО, и здесь появится индивидуальная ссылка.</p>`;

  document.querySelector("#leaderboard").innerHTML = progress.resultsLocked ? `
    <div class="results-locked">
      <strong>Промежуточные результаты скрыты</strong>
      <p>Сейчас виден только статус голосования: ${progress.voted} из ${progress.total}. Лидерборд откроется, когда проголосуют все заведенные члены жюри.</p>
    </div>
  ` : state.leaderboard.map((talk, index) => {
    const value = showScores ? (talk.stats.score ?? talk.stats.votesCount) : talk.stats.votesCount;
    const maxValue = Math.max(1, ...state.leaderboard.map(item => item.stats.score ?? item.stats.votesCount));
    const percent = Math.max(4, Math.min(100, value / maxValue * 100));
    return `
      <div class="leader-row">
        <strong>#${index + 1}</strong>
        <div>
          <strong>${esc(talk.title)}</strong>
          ${isTop3 ? `<small>1 мест: ${talk.stats.firstPlaces || 0} · 2 мест: ${talk.stats.secondPlaces || 0} · 3 мест: ${talk.stats.thirdPlaces || 0}</small>` : ""}
          <div class="bar"><span style="width:${percent}%"></span></div>
        </div>
        <span>${value}</span>
        <span>${showScores ? "баллов" : value === 1 ? "голос" : "голосов"}</span>
      </div>`;
  }).join("") || `<p class="muted">Пока нет выступлений.</p>`;

  document.querySelector("#votesHead").innerHTML = `
    <tr>
      <th>Жюри</th>
      <th>${isTop3 ? "Выбранные инициативы" : "Выбранный доклад"}</th>
      <th>Комментарий</th>
    </tr>`;
  document.querySelector("#votesBody").innerHTML = progress.resultsLocked ? `
      <tr><td colspan="3">Промежуточная матрица скрыта до завершения голосования.</td></tr>
  ` : state.matrix.map(vote => `
      <tr>
        <td>${esc(vote.voterName)}</td>
        <td>${esc(vote.talkTitle)}</td>
        <td>${esc(vote.comment || "")}</td>
      </tr>
  `).join("") || `<tr><td colspan="3">Голосов пока нет.</td></tr>`;

  document.querySelectorAll(".delete-talk:not(:disabled)").forEach(button => button.addEventListener("click", async () => {
    const row = button.closest(".active-row");
    const title = row?.querySelector("strong")?.textContent || "доклад";
    const agreed = await askConfirm({
      title: "Удалить доклад?",
      message: `«${title}» исчезнет из списка выступлений. Если по нему были голоса, они тоже будут удалены из результатов.`,
      okText: "Удалить",
      danger: true
    });
    if (!agreed) return;
    try {
      state = await api(`/api/admin/talks/${button.dataset.talk}`, { method: "DELETE" });
      render();
      toast("Доклад удален.");
    } catch (error) {
      toast(error.message);
    }
  }));
  document.querySelectorAll(".copy-link").forEach(button => button.onclick = async () => {
    try {
      await copyText(button.dataset.link);
      toast("Ссылка скопирована.");
    } catch {
      const input = button.closest(".voter-row")?.querySelector("input");
      input?.focus();
      input?.select();
      toast("Ссылка выделена. Нажми Ctrl+C или скопируй из поля.");
    }
  });
  document.querySelectorAll(".show-qr").forEach(button => button.onclick = () => openQr(button.dataset.voter));
  document.querySelectorAll(".delete-voter:not(:disabled)").forEach(button => button.addEventListener("click", async () => {
    const agreed = await askConfirm({
      title: "Удалить члена жюри?",
      message: "Индивидуальная ссылка перестанет работать. Если человек уже голосовал по персональной ссылке, его голоса тоже будут удалены из результатов.",
      okText: "Удалить",
      danger: true
    });
    if (!agreed) return;
    try {
      state = await api(`/api/admin/voters/${button.dataset.voter}`, { method: "DELETE" });
      render();
      toast("Член жюри удален.");
    } catch (error) {
      toast(error.message);
    }
  }));
  document.querySelectorAll("[data-mode]").forEach(button => button.onclick = async () => {
    const votingMode = button.dataset.mode;
    if (votingMode === state.event.votingMode) return;
    if (state.votes.length) {
      const agreed = await askConfirm({
        title: "Сменить режим голосования?",
        message: "Уже собранные голоса останутся в результатах. Если это тестовые данные, сбрось их кнопкой над лидербордом.",
        okText: "Сменить"
      });
      if (!agreed) return;
    }
    try {
      state = await api("/api/admin/event/mode", { method: "POST", body: JSON.stringify({ votingMode }) });
      render();
      toast(votingMode === "top3" ? "Включен режим топ-3 инициатив." : "Включен режим топ-1.");
    } catch (error) {
      toast(error.message);
    }
  });
  document.querySelectorAll("[data-round]").forEach(button => button.onclick = async () => {
    const nextRound = Number(button.dataset.round);
    if (nextRound === (state.event.currentRound || 1)) return;
    const agreed = await askConfirm({
      title: `Переключить на раунд ${nextRound}?`,
      message: `Голоса раунда ${state.event.currentRound || 1} сохранятся. На странице жюри откроется раунд ${nextRound}, а лидерборд покажет только его результаты.`,
      okText: "Переключить"
    });
    if (!agreed) return;
    try {
      state = await api("/api/admin/event/round", { method: "POST", body: JSON.stringify({ round: nextRound }) });
      render();
      toast(`Открыт раунд ${nextRound}.`);
    } catch (error) {
      toast(error.message);
    }
  });
  bindDragSort();
  document.querySelectorAll(".edit-talk").forEach(button => button.onclick = () => openTalkEditor(allTalks.find(talk => talk.id === button.dataset.talk)));
  renderOrganizers();
  renderHistoryList();
  document.querySelectorAll(".move-talk").forEach(button => button.onclick = async () => {
    const ids = allTalks.map(talk => talk.id);
    const from = ids.indexOf(button.dataset.talk);
    const to = from + Number(button.dataset.move);
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    try { state = await api("/api/admin/talks/reorder", { method: "POST", body: JSON.stringify({ ids }) }); render(); }
    catch (error) { toast(error.message); }
  });
}

function bindDragSort() {
  const list = document.querySelector("#activeTalks");
  let dragged = null;

  list.querySelectorAll(".active-row.draggable").forEach(row => {
    row.addEventListener("dragstart", event => {
      dragged = row;
      sorting = true;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.talkId);
    });

    row.addEventListener("dragend", async () => {
      row.classList.remove("dragging");
      dragged = null;
      sorting = false;
      const ids = [...list.querySelectorAll(".active-row.draggable")].map(item => item.dataset.talkId);
      if (ids.join("|") === (state.allTalks || state.talks).map(talk => talk.id).join("|")) return;
      try {
        state = await api("/api/admin/talks/reorder", { method: "POST", body: JSON.stringify({ ids }) });
        render();
        toast("Порядок выступлений сохранен.");
      } catch (error) {
        toast(error.message);
        await load();
      }
    });

    row.addEventListener("dragover", event => {
      event.preventDefault();
      if (!dragged || dragged === row) return;
      const rect = row.getBoundingClientRect();
      const afterMiddle = event.clientY > rect.top + rect.height / 2;
      row.parentNode.insertBefore(dragged, afterMiddle ? row.nextSibling : row);
    });
  });
}

document.querySelector("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.target)))
    });
    await load(true);
    event.target.reset();
  } catch (error) {
    document.querySelector("#loginError").textContent = error.message;
  }
});

document.querySelector("#talkForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const input = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  const talkId = editingTalkId;
  submit.disabled = true;
  form.querySelector("[data-form-error]").textContent = "";
  try {
    state = await api(talkId ? `/api/admin/talks/${talkId}` : "/api/admin/talks", { method: talkId ? "PATCH" : "POST", body: JSON.stringify(input) });
    form.reset();
    document.querySelector("#talkDialog").close();
    render();
    toast(talkId ? "Изменения сохранены." : "Выступление добавлено.");
  } catch (error) {
    form.querySelector("[data-form-error]").textContent = error.message;
  } finally { submit.disabled = false; }
});

function openTalkEditor(talk = null) {
  editingTalkId = talk?.id || null;
  const form = document.querySelector("#talkForm");
  form.reset();
  form.elements.title.value = talk?.title || "";
  form.querySelector("[data-form-error]").textContent = "";
  document.querySelector("#talkDialogTitle").textContent = talk ? "Редактировать выступление" : "Новое выступление";
  form.querySelector('[type="submit"]').textContent = talk ? "Сохранить изменения" : "Добавить";
  document.querySelector("#talkDialog").showModal();
}

document.querySelector("#voterForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.target));
  try {
    state = await api("/api/admin/voters", { method: "POST", body: JSON.stringify(input) });
    event.target.reset();
    render();
    toast("Член жюри добавлен, ссылка создана.");
  } catch (error) {
    toast(error.message);
  }
});

document.querySelector("#refresh").addEventListener("click", () => load().then(() => toast("Данные обновлены.")));
document.querySelector("#resetVotes").addEventListener("click", async () => {
  const round = state?.event?.currentRound || 1;
  if (!state?.votes?.length) {
    toast(`В раунде ${round} голосов пока нет, сбрасывать нечего.`);
    return;
  }

  const agreed = await askConfirm({
    title: `Сбросить голоса раунда ${round}?`,
    message: `Будет удалено голосов в текущем раунде: ${state.votes.length}. Голоса другого раунда, доклады, порядок и члены жюри останутся.`,
    okText: "Сбросить",
    danger: true
  });
  if (!agreed) return;

  try {
    state = await api("/api/admin/votes/reset", { method: "POST" });
    render();
    toast(`Голоса раунда ${round} сброшены.`);
  } catch (error) {
    toast(error.message);
  }
});

document.querySelectorAll("[data-tab]").forEach(button => {
  button.onclick = () => selectTab(button.dataset.tab);
  button.onkeydown = event => {
    const tabs = [...document.querySelectorAll("[data-tab]")];
    const index = tabs.indexOf(button);
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowDown: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowUp: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next].dataset.tab, true); }
  };
});
window.addEventListener("hashchange", () => selectTab(location.hash.slice(1)));
document.querySelector("#addTalk").onclick = () => openTalkEditor();
for (const [buttonId, dialogId] of [["addOrganizer", "organizerDialog"], ["newEvent", "eventDialog"]]) {
  document.getElementById(buttonId).onclick = () => {
    const dialog = document.getElementById(dialogId);
    dialog.querySelector("[data-form-error]").textContent = "";
    dialog.showModal();
  };
}
document.querySelectorAll("[data-close]").forEach(button => button.onclick = () => document.getElementById(button.dataset.close).close());
document.querySelector("#organizerDialog").addEventListener("close", () => document.querySelector("#organizerForm").reset());

document.querySelector("#editEventPresentation").onclick = () => {
  const form = document.querySelector("#presentationForm");
  form.elements.title.value = state.event.title;
  form.elements.votingIntro.value = state.event.votingIntro || "";
  form.querySelector("[data-form-error]").textContent = "";
  document.querySelector("#presentationDialog").showModal();
};
document.querySelector("#presentationForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  form.querySelector("[data-form-error]").textContent = "";
  try {
    state = await api("/api/admin/event/presentation", { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    render();
    document.querySelector("#presentationDialog").close();
    toast("Название и текст шапки сохранены.");
  } catch (error) { form.querySelector("[data-form-error]").textContent = error.message; }
  finally { submit.disabled = false; }
};

document.querySelector("#passwordDialog").addEventListener("close", () => {
  document.querySelector("#passwordForm").reset();
  passwordOrganizerId = null;
});
document.querySelector("#passwordForm").onsubmit = async event => {
  event.preventDefault();
  const form = event.target;
  const input = Object.fromEntries(new FormData(form));
  const errorEl = form.querySelector("[data-form-error]");
  errorEl.textContent = "";
  if (input.password !== input.confirmation) { errorEl.textContent = "Новые пароли не совпадают"; return; }
  const submit = form.querySelector('[type="submit"]');
  const targetId = passwordOrganizerId;
  submit.disabled = true;
  try {
    state = await api(`/api/admin/organizers/${targetId}/password`, { method: "POST", body: JSON.stringify({ currentPassword: input.currentPassword, password: input.password }) });
    document.querySelector("#passwordDialog").close();
    render();
    toast("Пароль изменён. Остальные сессии аккаунта завершены.");
  } catch (error) { errorEl.textContent = error.message; }
  finally { submit.disabled = false; }
};

async function openQr(voterId = "") {
  qrVoterId = voterId;
  const requestId = ++qrRequestId;
  const voter = state.voters.find(item => item.id === voterId);
  const dialog = document.querySelector("#qrDialog");
  const img = document.querySelector("#qrImage");
  const status = document.querySelector("#qrStatus");
  document.querySelector("#qrDescription").textContent = voter ? `${voter.name}. Персональный QR-код: передайте только этому члену жюри.` : "Общая ссылка. Можно показать на экране или отправить участникам.";
  document.querySelector("#qrLink").value = "";
  document.querySelector("#qrLocalWarning").hidden = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  img.hidden = true;
  img.removeAttribute("src");
  document.querySelector("#qrDownload").disabled = true;
  document.querySelector("#qrRetry").hidden = true;
  status.textContent = "Создаём QR-код…";
  if (!dialog.open) dialog.showModal();
  try {
    const result = await api("/api/admin/qr", { method: "POST", body: JSON.stringify({ origin: location.origin, voterId }) });
    if (requestId !== qrRequestId || !dialog.open) return;
    img.src = result.dataUrl;
    img.hidden = false;
    document.querySelector("#qrLink").value = result.link;
    document.querySelector("#qrDownload").disabled = false;
    status.textContent = "";
  } catch (error) {
    if (requestId !== qrRequestId || !dialog.open) return;
    status.textContent = error.message;
    document.querySelector("#qrRetry").hidden = false;
  }
}
document.querySelector("#qrDialog").addEventListener("close", () => {
  qrRequestId++;
  document.querySelector("#qrImage").removeAttribute("src");
  document.querySelector("#qrLink").value = "";
});
document.querySelector("#qrRetry").onclick = () => openQr(qrVoterId);
document.querySelector("#qrDownload").onclick = () => {
  const link = document.createElement("a");
  link.href = document.querySelector("#qrImage").src;
  link.download = qrVoterId ? "demo-day-jury-qr.png" : "demo-day-voting-qr.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

document.querySelector("#logout").onclick = async () => {
  try { await api("/api/admin/logout", { method: "POST" }); state = null; currentOrganizer = null; await load(); }
  catch (error) { toast(error.message); }
};

function renderOrganizers() {
  document.querySelector("#organizers").innerHTML = (state.organizers || []).map(item => `
    <article class="person-row"><span class="user-avatar" aria-hidden="true">${esc(item.name.slice(0, 1).toUpperCase())}</span>
    <div><strong>${esc(item.name)}</strong><small>${esc(item.login)}</small></div>
    ${item.id === currentOrganizer?.id ? '<span class="status-tag">Это вы</span>' : ""}
    <div class="person-actions"><button type="button" class="ghost change-password" data-id="${item.id}">Сменить пароль</button>${item.id === currentOrganizer?.id ? "" : `<button type="button" class="ghost danger-text revoke-organizer" data-id="${item.id}">Отозвать доступ</button>`}</div></article>
  `).join("");
  document.querySelectorAll(".change-password").forEach(button => button.onclick = () => {
    const item = state.organizers.find(item => item.id === button.dataset.id);
    passwordOrganizerId = item.id;
    const form = document.querySelector("#passwordForm");
    form.reset();
    form.querySelector("[data-form-error]").textContent = "";
    document.querySelector("#passwordAccount").textContent = `${item.name} · ${item.login}`;
    document.querySelector("#passwordDialog").showModal();
  });
  document.querySelectorAll(".revoke-organizer").forEach(button => button.onclick = async () => {
    const item = state.organizers.find(item => item.id === button.dataset.id);
    if (!await askConfirm({ title: "Отозвать доступ?", message: `${item.name} больше не сможет входить в кабинет. Текущие сессии будут завершены.`, okText: "Отозвать", danger: true })) return;
    try { state = await api(`/api/admin/organizers/${item.id}`, { method: "DELETE" }); render(); toast("Доступ отозван."); }
    catch (error) { toast(error.message); }
  });
}

for (const [formId, endpoint, dialogId, message] of [
  ["organizerForm", "/api/admin/organizers", "organizerDialog", "Аккаунт организатора создан."],
  ["eventForm", "/api/admin/events/new", "eventDialog", "Новое голосование создано."]
]) {
  document.getElementById(formId).onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type="submit"]');
    const input = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    form.querySelector("[data-form-error]").textContent = "";
    try {
      state = await api(endpoint, { method: "POST", body: JSON.stringify(input) });
      document.getElementById(dialogId).close(); form.reset(); render(); toast(message);
      if (formId === "eventForm") {
        openHistory = null;
        document.querySelector("#historyDetail").hidden = true;
        document.querySelector("#currentStatistics").open = false;
        selectTab("talks");
      }
    } catch (error) { form.querySelector("[data-form-error]").textContent = error.message; }
    finally { submit.disabled = false; }
  };
}

document.querySelector("#completeEvent").onclick = async () => {
  if (!await askConfirm({ title: "Завершить событие?", message: "Голосование закроется. Программа, жюри и результаты обоих раундов сохранятся в истории. После этого можно создать новое голосование.", okText: "Завершить событие" })) return;
  try { state = await api("/api/admin/events/complete", { method: "POST" }); render(); toast("Событие сохранено в истории."); }
  catch (error) { toast(error.message); }
};

function renderHistoryList() {
  document.querySelector("#historyList").innerHTML = (state.history || []).map(item => `
    <article class="history-row"><div><strong>${esc(item.title)}</strong><small>${new Date(item.completedAt).toLocaleDateString("ru-RU")} · ${item.talksCount} докладов · ${item.votesCount} голосов</small></div><button type="button" class="ghost open-history" data-id="${item.id}">Посмотреть результаты</button></article>
  `).join("") || '<p class="muted">Здесь появятся события после завершения голосования.</p>';
  document.querySelectorAll(".open-history").forEach(button => button.onclick = async () => {
    button.disabled = true;
    try { openHistory = await api(`/api/admin/history/${button.dataset.id}`); renderHistoryRound(1); document.querySelector("#historyDetail").scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
}

function renderHistoryRound(round) {
  const report = openHistory.snapshot;
  const result = report.rounds.find(item => item.round === round);
  const byId = new Map(report.allTalks.map(talk => [talk.id, talk]));
  const voters = new Map(report.voters.map(voter => [voter.id, voter.name]));
  const votes = report.allVotes.filter(vote => (Number(vote.round) === 2 ? 2 : 1) === round);
  const detail = document.querySelector("#historyDetail");
  detail.hidden = false;
  detail.innerHTML = `<h2>${esc(openHistory.title)}</h2><p class="muted history-caption">Завершено ${new Date(openHistory.completedAt).toLocaleString("ru-RU")}. Результаты сохранены на момент завершения.</p>
    <div class="history-rounds" role="group" aria-label="Архивный раунд">${[1, 2].map(value => `<button type="button" data-history-round="${value}" aria-pressed="${value === round}" class="ghost ${value === round ? "active" : ""}">Раунд ${value}</button>`).join("")}</div>
    <p class="muted">Голосов: ${result.votesCount}</p><div class="leaderboard">${result.leaderboard.map((talk, index) => `<div class="leader-row"><strong>${index + 1}</strong><div><strong>${esc(talk.title)}</strong><small>1-е: ${talk.stats.firstPlaces} · 2-е: ${talk.stats.secondPlaces} · 3-е: ${talk.stats.thirdPlaces}</small></div><span>${talk.stats.score}</span><span>баллов</span></div>`).join("") || '<p class="muted">В этом раунде нет участников.</p>'}</div>
    <h2>Голоса раунда ${round}</h2><div class="table-scroll"><table><thead><tr><th>Жюри</th><th>Выбор по местам</th><th>Комментарий</th></tr></thead><tbody>${votes.map(vote => `<tr><td>${esc(voters.get(vote.voterId) || "Общая ссылка")}</td><td>${voteTalkIds(vote).map((id, i) => `${i + 1}. ${esc(byId.get(id)?.title || "Удалённый доклад")}`).join("<br>")}</td><td>${esc(vote.comment || "")}</td></tr>`).join("") || '<tr><td colspan="3">Голосов не было.</td></tr>'}</tbody></table></div>
    <details class="report-section"><summary>Вся программа · ${report.allTalks.length} докладов</summary>${report.allTalks.map(talk => `<div class="person-row"><div><strong>${esc(talk.title)}</strong></div></div>`).join("")}</details>`;
  detail.querySelectorAll("[data-history-round]").forEach(button => button.onclick = () => renderHistoryRound(Number(button.dataset.historyRound)));
}
setInterval(() => {
  if (!document.hidden && state && !sorting && !document.querySelector("dialog[open]") && !document.activeElement?.matches("input, textarea")) load().catch(() => {});
}, 10000);
selectTab(location.hash.slice(1));
load();
