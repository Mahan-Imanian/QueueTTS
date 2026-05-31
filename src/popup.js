import {
  STORAGE_KEY,
  addItemToState,
  createQueueItem,
  currentItem,
  fmtTime,
  hostFromUrl,
  progressFor,
  queueSummary,
  readState,
  todayKey,
  updateState,
  wordCount
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  openQueueFromBrand: $("#openQueueFromBrand"),
  openQueue: $("#openQueue"),
  openOptions: $("#openOptions"),
  contextBar: $("#contextBar"),
  contextTitle: $("#contextTitle"),
  contextMeta: $("#contextMeta"),
  emptyCommand: $("#emptyCommand"),
  emptyTitle: $("#emptyTitle"),
  emptyCopy: $("#emptyCopy"),
  playerPanel: $("#playerPanel"),
  nowTitle: $("#nowTitle"),
  nowMeta: $("#nowMeta"),
  statusBadge: $("#statusBadge"),
  progress: $("#progress"),
  progressFill: $("#progress span"),
  elapsedTime: $("#elapsedTime"),
  remainingTime: $("#remainingTime"),
  spokenText: $("#spokenText"),
  playPause: $("#playPause"),
  prevItem: $("#prevItem"),
  nextItem: $("#nextItem"),
  prevSegment: $("#prevSegment"),
  nextSegment: $("#nextSegment"),
  primaryCapture: $("#primaryCapture"),
  captureSelection: $("#captureSelection"),
  togglePaste: $("#togglePaste"),
  pasteDrawer: $("#pasteDrawer"),
  pasteInput: $("#pasteInput"),
  pasteStats: $("#pasteStats"),
  addPaste: $("#addPaste"),
  clearPaste: $("#clearPaste"),
  queuePreview: $("#queuePreview"),
  queuePreviewList: $("#queuePreviewList"),
  timeCount: $("#timeCount"),
  voiceChip: $("#voiceChip"),
  statusNotice: $("#statusNotice"),
  commandOpen: $("#commandOpen"),
  commandModal: $("#commandModal"),
  commandInput: $("#commandInput"),
  commandList: $("#commandList"),
  toasts: $("#toasts")
};

let state = await readState();
let pageContext = null;
let contextError = "";
let primaryMode = "page";
let commandIndex = 0;

const message = (payload) => chrome.runtime.sendMessage(payload);
const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const isCapturableUrl = (url) => /^https?:\/\//i.test(String(url || ""));
const sourceLabel = (item) => item?.sourceUrl ? hostFromUrl(item.sourceUrl) : item?.sourceType === "paste" ? "Pasted text" : item?.sourceTitle || "Local text";
const sourceInitial = (item) => (sourceLabel(item).trim()[0] || "Q").toUpperCase();
const statusLabel = (status) => status === "playing" ? "Playing" : status === "paused" ? "Paused" : status === "loading" ? "Loading" : status === "error" ? "Error" : "Idle";

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 2400);
};

const notice = (text, mode = "") => {
  els.statusNotice.textContent = text;
  els.statusNotice.className = `notice-line ${mode}`.trim();
};

const setBusy = (button, busy) => {
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? "Working…" : button.dataset.label;
};

const loadContext = async () => {
  try {
    const response = await message({ type: "QTTS_CONTEXT_ACTIVE" });
    pageContext = response?.context || null;
    contextError = response?.ok ? "" : response?.error || "Page context unavailable.";
  } catch (error) {
    pageContext = null;
    contextError = error?.message || "Page context unavailable.";
  }
};

const renderContext = () => {
  const url = pageContext?.url || "";
  const words = Number(pageContext?.selectionWords || 0);
  const capturable = isCapturableUrl(url);
  const title = pageContext?.title || "Current tab unavailable";
  const host = capturable ? hostFromUrl(url) : "Paste is available";
  primaryMode = words >= 3 ? "selection" : capturable ? "page" : "paste";

  els.contextBar.className = `context-bar ${!capturable ? "warning" : words >= 3 ? "success" : ""}`.trim();
  els.contextTitle.textContent = capturable ? title : "This tab can’t be captured";
  els.contextMeta.textContent = capturable ? `${host} · ${words ? `${words} selected words` : "no selection"}` : `${contextError || "Chrome pages and extension pages block capture."} Use paste instead.`;
  els.primaryCapture.textContent = primaryMode === "selection" ? "Add selected text" : primaryMode === "page" ? "Add this page" : "Paste text";
  els.captureSelection.disabled = words < 3;
  els.captureSelection.textContent = words >= 3 ? `Selection · ${words}` : "No selection";
  els.emptyTitle.textContent = primaryMode === "selection" ? "Selection ready." : primaryMode === "page" ? "Capture this page." : "Paste text to queue.";
  els.emptyCopy.textContent = capturable ? "Preview readable text before queueing, or use paste for precise control." : "Chrome blocks this surface. Paste manually or use a normal webpage.";
};

const renderPlayer = (item, progress) => {
  const hasItem = Boolean(item);
  els.emptyCommand.classList.remove("hidden");
  els.playerPanel.classList.toggle("hidden", !hasItem);
  if (!hasItem) return;

  els.statusBadge.className = `status-badge ${state.playback.status}`;
  els.statusBadge.textContent = statusLabel(state.playback.status);
  els.nowTitle.textContent = item.title || "Untitled capture";
  els.nowMeta.textContent = `${sourceLabel(item)} · ${item.wordCount} words · ${fmtTime(progress.total || item.estimateSeconds)}`;
  els.spokenText.textContent = progress.segment?.text || item.text?.slice(0, 220) || "No active segment.";
  els.progressFill.style.width = `${progress.percent}%`;
  els.progress.setAttribute("aria-valuenow", String(progress.percent));
  els.elapsedTime.textContent = fmtTime(progress.elapsed || 0);
  els.remainingTime.textContent = `${fmtTime(progress.remaining || progress.total || 0)} left`;
  els.playPause.textContent = state.playback.status === "playing" ? "Ⅱ" : "▶";
  els.playPause.setAttribute("aria-label", state.playback.status === "playing" ? "Pause" : "Play");
};

const renderQueuePreview = (item) => {
  const activeIds = new Set(item ? [item.id] : []);
  const rows = state.queue.filter((candidate) => candidate.state !== "completed").slice(0, 4);
  els.queuePreview.classList.toggle("hidden", rows.length === 0);
  if (!rows.length) {
    els.queuePreviewList.innerHTML = "";
    return;
  }
  els.queuePreviewList.innerHTML = rows.map((row) => {
    const active = activeIds.has(row.id);
    const meta = `${sourceLabel(row)} · ${row.wordCount} words · ${fmtTime(row.estimateSeconds)}`;
    return `<div class="queue-preview-row ${active ? "active" : ""}"><span class="source-glyph" aria-hidden="true">${escapeHtml(sourceInitial(row))}</span><div><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(meta)}</span></div><button class="button secondary small" data-play-id="${escapeHtml(row.id)}" type="button">${active ? "Open" : "Play"}</button></div>`;
  }).join("");
  $$('[data-play-id]').forEach((button) => button.addEventListener("click", () => control("QTTS_PLAY", { itemId: button.dataset.playId, segmentIndex: 0 })));
};

const renderRate = () => {
  const rate = Number(state.settings.rate || 1);
  els.voiceChip.textContent = `${state.settings.voiceName || "Default voice"} · ${rate.toFixed(2).replace(/\.00$/, "")}×`;
  $$(".rate-chip").forEach((button) => {
    const value = Number(button.dataset.rate);
    button.classList.toggle("active", Math.abs(value - rate) < 0.01);
  });
};

const render = async () => {
  state = await readState();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.reduceMotion ? "reduced" : "full";
  const item = currentItem(state);
  const summary = queueSummary(state);
  const progress = progressFor(item, state.playback.segmentIndex, state.settings);
  const pending = state.queue.filter((row) => ["queued", "playing", "paused"].includes(row.state)).length;

  els.openQueue.textContent = `${pending} queued`;
  els.timeCount.textContent = fmtTime(summary.seconds);
  renderContext();
  renderPlayer(item, progress);
  renderQueuePreview(item);
  renderRate();

  const today = state.stats.days[todayKey()] || {};
  if (state.playback.status === "error" && state.playback.lastError) notice(state.playback.lastError, "error");
  else if (today.itemsCaptured) notice(`${today.itemsCaptured} captured today · local-only queue`, "success");
  else notice("Right-click selected text for the fastest capture.");
};

const addCapture = async (capture) => {
  const response = await message({ type: "QTTS_ADD_CAPTURE", capture });
  if (!response?.ok) throw new Error(response?.error || "Could not add capture.");
  return response.item;
};

const capture = async (mode, button) => {
  if (mode === "paste") {
    openPaste();
    return;
  }
  setBusy(button, true);
  try {
    const response = await message({ type: "QTTS_CAPTURE_ACTIVE", mode });
    if (!response?.ok && !response?.capture) throw new Error(response?.error || "Capture failed.");
    const item = await addCapture(response.capture || { failed: true, text: "", sourceType: "failed", error: response.error });
    if (item.state === "failed") {
      notice(item.error || "Capture needs review. Open the queue to repair it.", "error");
      toast("Capture needs review", "error");
    } else {
      notice(`${item.sourceType === "selection" ? "Selection" : "Page"} added from ${sourceLabel(item)}.`, "success");
      toast("Added to queue");
    }
    await loadContext();
    await render();
  } catch (error) {
    notice(error?.message || "Capture failed. Paste text manually.", "error");
    openPaste();
  } finally {
    setBusy(button, false);
  }
};

const openPaste = () => {
  els.pasteDrawer.classList.remove("hidden");
  els.pasteInput.focus();
};

const addPaste = async () => {
  const text = els.pasteInput.value.trim();
  if (wordCount(text) < 3) {
    notice("Paste more text before adding.", "error");
    return;
  }
  const item = createQueueItem({ title: "Pasted text", text, sourceType: "paste", sourceTitle: "Popup paste", quality: "manual" }, state.settings);
  await addItemToState(item, { activate: !state.playback.itemId });
  els.pasteInput.value = "";
  els.pasteDrawer.classList.add("hidden");
  notice("Pasted text added locally.", "success");
  toast("Added to queue");
  await render();
};

const control = async (type, payload = {}) => {
  const response = await message({ type, ...payload });
  if (!response?.ok) notice(response?.error || "Action failed.", "error");
  await render();
};

const openQueueSurface = async () => {
  await message({ type: "QTTS_OPEN_QUEUE" });
  window.close();
};

const updateRate = async (rate) => {
  await updateState((current) => ({ ...current, settings: { ...current.settings, rate: Number(rate) || 1 } }));
  toast(`Speed ${Number(rate).toFixed(2).replace(/\.00$/, "")}×`);
  await render();
};

const commands = () => [
  { title: primaryMode === "selection" ? "Add selected text" : primaryMode === "page" ? "Add current page" : "Paste text", detail: "Best current action", run: () => capture(primaryMode, els.primaryCapture) },
  { title: "Open paste box", detail: "Manual text capture", run: openPaste },
  { title: "Play or pause", detail: "Space", run: () => control("QTTS_TOGGLE") },
  { title: "Next segment", detail: "J", run: () => control("QTTS_NEXT_SEGMENT") },
  { title: "Previous segment", detail: "K", run: () => control("QTTS_PREV_SEGMENT") },
  { title: "Open full queue", detail: "Queue manager", run: openQueueSurface },
  { title: "Open settings", detail: "Voice, speed, storage", run: () => chrome.runtime.openOptionsPage() }
];

const renderCommands = () => {
  const query = els.commandInput.value.trim().toLowerCase();
  const rows = commands().filter((command) => !query || `${command.title} ${command.detail}`.toLowerCase().includes(query));
  commandIndex = Math.min(commandIndex, Math.max(0, rows.length - 1));
  els.commandList.innerHTML = rows.map((command, index) => `<button class="command-row ${index === commandIndex ? "active" : ""}" data-command-index="${index}" type="button" role="option"><span>${escapeHtml(command.title)}</span><small>${escapeHtml(command.detail)}</small></button>`).join("");
  $$('[data-command-index]').forEach((button) => button.addEventListener("click", () => runCommand(rows[Number(button.dataset.commandIndex)])));
};

const openCommand = () => {
  commandIndex = 0;
  els.commandInput.value = "";
  els.commandModal.classList.remove("hidden");
  renderCommands();
  els.commandInput.focus();
};

const closeCommand = () => els.commandModal.classList.add("hidden");
const runCommand = async (command) => {
  if (!command) return;
  closeCommand();
  await command.run();
};

els.playPause.addEventListener("click", () => control("QTTS_TOGGLE"));
els.prevItem.addEventListener("click", () => control("QTTS_PREV_ITEM"));
els.nextItem.addEventListener("click", () => control("QTTS_NEXT_ITEM"));
els.prevSegment.addEventListener("click", () => control("QTTS_PREV_SEGMENT"));
els.nextSegment.addEventListener("click", () => control("QTTS_NEXT_SEGMENT"));
els.primaryCapture.addEventListener("click", () => capture(primaryMode, els.primaryCapture));
els.captureSelection.addEventListener("click", () => capture("selection", els.captureSelection));
els.togglePaste.addEventListener("click", openPaste);
els.addPaste.addEventListener("click", addPaste);
els.clearPaste.addEventListener("click", () => {
  els.pasteInput.value = "";
  els.pasteStats.textContent = "0 words";
});
els.openQueue.addEventListener("click", openQueueSurface);
els.openQueueFromBrand.addEventListener("click", openQueueSurface);
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.voiceChip.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.commandOpen.addEventListener("click", openCommand);
els.commandModal.addEventListener("click", (event) => {
  if (event.target === els.commandModal) closeCommand();
});
els.commandInput.addEventListener("input", () => {
  commandIndex = 0;
  renderCommands();
});
els.commandInput.addEventListener("keydown", (event) => {
  const rows = commands().filter((command) => !els.commandInput.value.trim() || `${command.title} ${command.detail}`.toLowerCase().includes(els.commandInput.value.trim().toLowerCase()));
  if (event.key === "ArrowDown") {
    event.preventDefault();
    commandIndex = Math.min(rows.length - 1, commandIndex + 1);
    renderCommands();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    commandIndex = Math.max(0, commandIndex - 1);
    renderCommands();
  }
  if (event.key === "Enter") {
    event.preventDefault();
    runCommand(rows[commandIndex]);
  }
  if (event.key === "Escape") closeCommand();
});
els.pasteInput.addEventListener("input", () => {
  const words = wordCount(els.pasteInput.value);
  els.pasteStats.textContent = `${words} ${words === 1 ? "word" : "words"}`;
});
$$(".rate-chip").forEach((button) => button.addEventListener("click", () => updateRate(button.dataset.rate)));

document.addEventListener("keydown", (event) => {
  const editable = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "");
  if (event.key === "Escape" && !els.commandModal.classList.contains("hidden")) closeCommand();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") addPaste();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommand();
  }
  if (event.key === " " && !editable) {
    event.preventDefault();
    control("QTTS_TOGGLE");
  }
  if (!editable && event.key.toLowerCase() === "p") openPaste();
  if (!editable && event.key.toLowerCase() === "q") openQueueSurface();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

await loadContext();
await render();
