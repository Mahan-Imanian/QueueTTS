import {
  STORAGE_KEY,
  createQueueItem,
  currentItem,
  fmtTime,
  progressFor,
  queueSummary,
  readState,
  todayKey,
  wordCount,
  addItemToState
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  statusBadge: $("#statusBadge"),
  nowTitle: $("#nowTitle"),
  nowMeta: $("#nowMeta"),
  progress: $("#progress"),
  progressFill: $("#progress span"),
  spokenText: $("#spokenText"),
  playPause: $("#playPause"),
  prevItem: $("#prevItem"),
  nextItem: $("#nextItem"),
  prevSegment: $("#prevSegment"),
  nextSegment: $("#nextSegment"),
  captureSelection: $("#captureSelection"),
  capturePage: $("#capturePage"),
  openQueue: $("#openQueue"),
  pasteInput: $("#pasteInput"),
  pasteStats: $("#pasteStats"),
  addPaste: $("#addPaste"),
  clearPaste: $("#clearPaste"),
  queueCount: $("#queueCount"),
  todayCount: $("#todayCount"),
  timeCount: $("#timeCount"),
  statusNotice: $("#statusNotice"),
  toasts: $("#toasts")
};

let state = await readState();

const message = (payload) => chrome.runtime.sendMessage(payload);

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 2600);
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

const render = async () => {
  state = await readState();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.reduceMotion ? "reduced" : "full";
  const item = currentItem(state);
  const summary = queueSummary(state);
  const progress = progressFor(item, state.playback.segmentIndex, state.settings);
  els.statusBadge.className = `status-badge ${state.playback.status}`;
  els.statusBadge.textContent = statusLabel(state.playback.status);
  els.nowTitle.textContent = item?.title || "Nothing queued";
  els.nowMeta.textContent = item ? `${item.sourceType} · ${item.wordCount} words · ${fmtTime(item.estimateSeconds)}` : "Capture selected text, this page, or paste text.";
  els.spokenText.textContent = progress.segment?.text || item?.text?.slice(0, 220) || "QueueTTS stores captures locally and speaks through Chrome text-to-speech.";
  els.progressFill.style.width = `${progress.percent}%`;
  els.progress.setAttribute("aria-valuenow", String(progress.percent));
  els.playPause.textContent = state.playback.status === "playing" ? "Ⅱ" : "▶";
  els.playPause.setAttribute("aria-label", state.playback.status === "playing" ? "Pause" : "Play");
  els.queueCount.textContent = String(summary.total);
  els.timeCount.textContent = fmtTime(summary.seconds);
  const today = state.stats.days[todayKey()] || {};
  els.todayCount.textContent = String(today.itemsCompleted || 0);
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
    notice(item.state === "failed" ? item.error : `${item.sourceType === "selection" ? "Selected text" : "Page"} added to queue.`, item.state === "failed" ? "error" : "success");
    toast(item.state === "failed" ? "Capture needs manual recovery" : "Added to queue");
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
  notice("Pasted text added locally.", "success");
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
els.captureSelection.addEventListener("click", () => capture("selection", els.captureSelection));
els.capturePage.addEventListener("click", () => capture("page", els.capturePage));
els.addPaste.addEventListener("click", addPaste);
els.clearPaste.addEventListener("click", () => {
  els.pasteInput.value = "";
  els.pasteStats.textContent = "0 words";
});
els.openQueue.addEventListener("click", async () => {
  await message({ type: "QTTS_OPEN_QUEUE" });
  window.close();
});
els.pasteInput.addEventListener("input", () => {
  const words = wordCount(els.pasteInput.value);
  els.pasteStats.textContent = `${words} ${words === 1 ? "word" : "words"}`;
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") addPaste();
  if (event.key === " ") {
    event.preventDefault();
    control("QTTS_TOGGLE");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

await render();
