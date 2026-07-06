let state = null;

const api = async (path, options = {}) => {
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Ошибка");
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
    document.querySelector("#login").hidden = false;
    document.querySelector("#dashboard").hidden = true;
    if (showError) document.querySelector("#loginError").textContent = error.message;
  }
}

function render() {
  const votesCount = state.votes.length;
  const leader = state.leaderboard.find(item => item.stats.votesCount > 0);
  const isTop3 = state.event.votingMode === "top3";
  const round = state.event.currentRound || 1;
  const progress = state.votingProgress || { total: 0, voted: 0, pending: [], deviceVotesCount: 0, resultsLocked: false };
  const showScores = isTop3 || state.leaderboard.some(item => (item.stats.score ?? item.stats.votesCount) !== item.stats.votesCount);
  document.querySelector("#metrics").innerHTML = [
    ["Выступлений", state.talks.length],
    ["Жюри", state.voters.length],
    ["Раунд", round],
    ["Голосов", votesCount],
    ["Лидер", leader?.title || "Пока нет"]
  ].map(([label, value]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");

  document.querySelector("#roundHint").textContent = `Сейчас открыт раунд ${round}. Голоса другого раунда сохраняются отдельно и не попадают в этот лидерборд.`;
  document.querySelectorAll("[data-round]").forEach(button => {
    const active = Number(button.dataset.round) === round;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("#modeHint").textContent = isTop3
    ? "Сейчас каждый член жюри выбирает 3 лучшие инициативы. 1-е место дает 2 балла, 2-е место дает 1 балл, 3-е место дает 1 балл."
    : "Сейчас каждый член жюри выбирает один лучший доклад.";
  document.querySelectorAll("[data-mode]").forEach(button => {
    const active = button.dataset.mode === state.event.votingMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelector("#leaderboardTitle").textContent = `Лидерборд · Раунд ${round}`;
  document.querySelector("#matrixTitle").textContent = `Матрица голосов · Раунд ${round}`;

  const commonLink = `${location.origin}/`;
  const commonInput = document.querySelector("#commonVoteLink");
  const commonButton = document.querySelector("#copyCommonLink");
  if (commonInput && commonButton) {
    commonInput.value = commonLink;
    commonButton.dataset.link = commonLink;
  }

  document.querySelector("#progressBadge").textContent = progress.total
    ? `${progress.voted} из ${progress.total}`
    : `${votesCount} голосов`;
  document.querySelector("#votingProgress").innerHTML = progress.total ? `
    <div class="progress-meter" aria-label="Прогресс голосования">
      <span style="width:${Math.round(progress.voted / Math.max(1, progress.total) * 100)}%"></span>
    </div>
    <p class="muted">Проголосовали ${progress.voted} из ${progress.total}. Результаты скрыты до завершения голосования, чтобы не влиять на независимость выбора.</p>
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

  document.querySelector("#activeTalks").innerHTML = state.talks.map(talk => `
      <div class="active-row draggable" draggable="true" data-talk-id="${talk.id}">
        <div class="drag-handle" title="Перетащить">↕</div>
        <div><strong>${esc(talk.title)}</strong><div class="muted">${esc(talk.speaker || "Команда")}</div></div>
        <span>${state.votes.filter(vote => voteTalkIds(vote).includes(talk.id)).length} голосов</span>
        <button class="ghost danger-text delete-talk" type="button" data-talk="${talk.id}">Удалить</button>
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
        <button class="ghost copy-link" type="button" data-link="${esc(link)}">Скопировать</button>
        <button class="ghost danger-text delete-voter" type="button" data-voter="${voter.id}">Удалить</button>
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
  document.querySelectorAll(".copy-link").forEach(button => button.addEventListener("click", async () => {
    try {
      await copyText(button.dataset.link);
      toast("Ссылка скопирована.");
    } catch {
      const input = button.closest(".voter-row")?.querySelector("input");
      input?.focus();
      input?.select();
      toast("Ссылка выделена. Нажми Ctrl+C или скопируй из поля.");
    }
  }));
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
}

function bindDragSort() {
  const list = document.querySelector("#activeTalks");
  let dragged = null;

  list.querySelectorAll(".active-row.draggable").forEach(row => {
    row.addEventListener("dragstart", event => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.talkId);
    });

    row.addEventListener("dragend", async () => {
      row.classList.remove("dragging");
      dragged = null;
      const ids = [...list.querySelectorAll(".active-row.draggable")].map(item => item.dataset.talkId);
      if (ids.join("|") === state.talks.map(talk => talk.id).join("|")) return;
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
      body: JSON.stringify({ password: new FormData(event.target).get("password") })
    });
    await load(true);
  } catch (error) {
    document.querySelector("#loginError").textContent = error.message;
  }
});

document.querySelector("#talkForm").addEventListener("submit", async event => {
  event.preventDefault();
  const input = Object.fromEntries(new FormData(event.target));
  try {
    state = await api("/api/admin/talks", { method: "POST", body: JSON.stringify(input) });
    event.target.reset();
    render();
    toast("Выступление добавлено.");
  } catch (error) {
    toast(error.message);
  }
});

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
setInterval(() => load().catch(() => {}), 10000);
load();
