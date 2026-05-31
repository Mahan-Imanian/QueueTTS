import {
  STORAGE_KEY,
  createQueueItem,
  currentItem,
  fmtTime,
  hostFromUrl,
  progressFor,
  queueSummary,
  readState,
  todayKey,
  wordCount,
  addItemToState
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  queuePill: $("#queuePill"),
  openOptions: $("#openOptions"),
  contextTitle: $("#contextTitle"),
  contextMeta: $("#contextMeta"),
  statusBadge: $("#statusBadge"),
  nowTitle: $("#nowTitle"),
  nowMeta: $("#nowMeta"),
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
  voiceChip: $("#voiceChip"),
  primaryCapture: $("#primaryCapture"),
  captureSelection: $("#captureSelection"),
  capturePage: $("#capturePage"),
  togglePaste: $("#togglePaste"),
  pasteDrawer: $("#pasteDrawer"),
  pasteInput: $("#pasteInput"),
  pasteStats: $("#pasteStats"),
  addPaste: $("#addPaste"),
  clearPaste: $("#clearPaste"),
  openQueue: $("#openQueue"),
  captureHint: $("#captureHint"),
  selectionState: $("#selectionState"),
  queuePreviewList: $("#queuePreviewList"),
  timeCount: $("#timeCount"),
  statusNotice: $("#statusNotice"),
  toasts: $("#toasts")
};

let state = await readState();
let pageContext = null;
let primaryMode = "page";

const message = (payload) => chrome.runtime.sendMessage(payload);

const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const sourceLabel = (item) => {
  if (!item) return "Local";
  if (item.sourceUrl) return hostFromUrl(item.sourceUrl);
  if (item.sourceType === "paste") return "Pasted text";
  return item.sourceType || "Local";
};

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 2400);
};

const notice = (text, mode = "") => {
  els.statusNotice.textContent = text;
  els.statusNotice.className = `notice ${mode}`.trim();
};

const setBusy = (button, busy) => {
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? "Working..." : button.dataset.label;
};

const statusLabel = (status) => status === "playing" ? "Playing" : status === "paused" ? "Paused" : status === "loading" ? "Loading" : status === "error" ? "Error" : "Idle";

const loadContext = async () => {
  try {
    const response = await message({ type: "QTTS_CONTEXT_ACTIVE" });
    pageContext = response?.ok ? response.context : null;
  } catch {
    pageContext = null;
  }
};

const renderContext = () => {
  const words = Number(pageContext?.selectionWords || 0);
  const title = pageContext?.title || "Current tab unavailable";
  const host = pageContext?.url ? hostFromUrl(pageContext.url) : "No page access";
  primaryMode = words >= 3 ? "selection" : "page";
  els.contextTitle.textContent = title;
  els.contextMeta.textContent = pageContext?.url ? `${host} · ${words ? `${words} selected words` : "no selected text"}` : "Use paste or open a regular webpage.";
  els.selectionState.textContent = words ? `${words} selected` : "No selection";
  els.selectionState.classList.toggle("success", words > 0);
  els.primaryCapture.textContent = primaryMode === "selection" ? "Add selected text" : "Add this page";
  els.captureHint.textContent = primaryMode === "selection" ? "Selection detected. Capture only the highlighted text." : "No selection detected. Capture the readable page or paste manually.";
  els.captureSelection.disabled = words < 3;
};

const renderQueuePreview = (item) => {
  const rows = state.queue.filter((candidate) => candidate.id !== item?.id && candidate.state !== "completed").slice(0, 3);
  if (!rows.length) {
    els.queuePreviewList.innerHTML = `<p class="queue-preview-empty">No upcoming items. Capture text now or use the context menu later.</p>`;
    return;
  }
  els.queuePreviewList.innerHTML = rows.map((row) => `<div class="queue-preview-row"><div><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(sourceLabel(row))} · ${row.wordCount} words</span></div><span>${fmtTime(row.estimateSeconds)}</span></div>`).join("");
};

const render = async () => {
  state = await readState();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.reduceMotion ? "reduced" : "full";
  const item = currentItem(state);
  const summary = queueSummary(state);
  const progress = progressFor(item, state.playback.segmentIndex, state.settings);
  const pending = state.queue.filter((row) => ["queued", "playing", "paused"].includes(row.state)).length;
  els.queuePill.textContent = `${pending} queued`;
  els.statusBadge.className = `status-badge ${state.playback.status}`;
  els.statusBadge.textContent = statusLabel(state.playback.status);
  els.nowTitle.textContent = item?.title || "Queue is empty";
  els.nowMeta.textContent = item ? `${sourceLabel(item)} · ${item.wordCount} words · ${fmtTime(progress.total || item.estimateSeconds)}` : "Capture a page, selected text, or paste text to start listening.";
  els.spokenText.textContent = progress.segment?.text || item?.text?.slice(0, 220) || "Your queue is stored locally in Chrome. No account or server is required.";
  els.progressFill.style.width = `${progress.percent}%`;
  els.progress.setAttribute("aria-valuenow", String(progress.percent));
  els.elapsedTime.textContent = fmtTime(progress.elapsed || 0);
  els.remainingTime.textContent = `${fmtTime(progress.remaining || progress.total || 0)} left`;
  els.playPause.textContent = state.playback.status === "playing" ? "Ⅱ" : "▶";
  els.playPause.setAttribute("aria-label", state.playback.status === "playing" ? "Pause" : "Play");
  els.voiceChip.textContent = `${state.settings.voiceName || "Default voice"} · ${Number(state.settings.rate || 1).toFixed(2).replace(/\.00$/, "")}×`;
  els.timeCount.textContent = `${fmtTime(summary.seconds)} total`;
  const today = state.stats.days[todayKey()] || {};
  if (state.playback.status === "error" && state.playback.lastError) notice(state.playback.lastError, "error");
  else if (today.itemsCaptured) notice(`${today.itemsCaptured} captures added today. Data stays local in Chrome.`, "success");
  renderQueuePreview(item);
  renderContext();
};

const addCapture = async (capture) => {
  const response = await message({ type: "QTTS_ADD_CAPTURE", capture });
  if (!response?.ok) throw new Error(response?.error || "Could not add capture.");
  return response.item;
};

const capture = async (mode, button) => {
  setBusy(button, true);
  try {
    const response = await message({ type: "QTTS_CAPTURE_ACTIVE", mode });
    if (!response?.ok && !response?.capture) throw new Error(response?.error || "Capture failed.");
    const item = await addCapture(response.capture || { failed: true, text: "", sourceType: "failed", error: response.error });
    if (item.state === "failed") {
      notice(item.error || "Capture needs manual repair. Open the queue to edit or paste manually.", "error");
      toast("Capture needs review", "error");
    } else {
      notice(`${item.sourceType === "selection" ? "Selection" : "Page"} added to queue from ${sourceLabel(item)}.`, "success");
      toast("Added to queue");
    }
    await loadContext();
    await render();
  } catch (error) {
    notice(error?.message || "Capture failed.", "error");
  } finally {
    setBusy(button, false);
  }
};

const addPaste = async () => {
  const text = els.pasteInput.value.trim();
  if (wordCount(text) < 3) {
    notice("Paste more text before adding to the queue.", "error");
    return;
  }
  const item = createQueueItem({ title: "Pasted text", text, sourceType: "paste", sourceTitle: "Popup paste" }, state.settings);
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

els.playPause.addEventListener("click", () => control("QTTS_TOGGLE"));
els.prevItem.addEventListener("click", () => control("QTTS_PREV_ITEM"));
els.nextItem.addEventListener("click", () => control("QTTS_NEXT_ITEM"));
els.prevSegment.addEventListener("click", () => control("QTTS_PREV_SEGMENT"));
els.nextSegment.addEventListener("click", () => control("QTTS_NEXT_SEGMENT"));
els.primaryCapture.addEventListener("click", () => capture(primaryMode, els.primaryCapture));
els.captureSelection.addEventListener("click", () => capture("selection", els.captureSelection));
els.capturePage.addEventListener("click", () => capture("page", els.capturePage));
els.togglePaste.addEventListener("click", () => {
  els.pasteDrawer.classList.toggle("hidden");
  if (!els.pasteDrawer.classList.contains("hidden")) els.pasteInput.focus();
});
els.addPaste.addEventListener("click", addPaste);
els.clearPaste.addEventListener("click", () => {
  els.pasteInput.value = "";
  els.pasteStats.textContent = "0 words";
});
els.openQueue.addEventListener("click", async () => {
  await message({ type: "QTTS_OPEN_QUEUE" });
  window.close();
});
els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.pasteInput.addEventListener("input", () => {
  const words = wordCount(els.pasteInput.value);
  els.pasteStats.textContent = `${words} ${words === 1 ? "word" : "words"}`;
});

document.addEventListener("keydown", (event) => {
  const editable = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") addPaste();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    els.openQueue.click();
  }
  if (event.key === " " && !editable) {
    event.preventDefault();
    control("QTTS_TOGGLE");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

await loadContext();
await render();
