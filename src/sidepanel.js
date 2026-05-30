import {
  STORAGE_KEY,
  addItemToState,
  createQueueItem,
  currentItem,
  fmtTime,
  hostFromUrl,
  normalizeItem,
  parseImport,
  progressFor,
  queueSummary,
  readState,
  serializeExport,
  storageBytes,
  updateState,
  wordCount
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const els = {
  onboarding: $("#onboarding"),
  onboardDone: $("#onboardDone"),
  onboardPage: $("#onboardPage"),
  statusBadge: $("#statusBadge"),
  nowTitle: $("#nowTitle"),
  nowMeta: $("#nowMeta"),
  progress: $("#progress"),
  progressFill: $("#progress span"),
  segmentLabel: $("#segmentLabel"),
  segmentText: $("#segmentText"),
  playPause: $("#playPause"),
  prevItem: $("#prevItem"),
  nextItem: $("#nextItem"),
  prevSegment: $("#prevSegment"),
  nextSegment: $("#nextSegment"),
  capturePage: $("#capturePage"),
  captureSelection: $("#captureSelection"),
  pasteInput: $("#pasteInput"),
  pasteStats: $("#pasteStats"),
  addPaste: $("#addPaste"),
  queueSearch: $("#queueSearch"),
  queueList: $("#queueList"),
  summaryItems: $("#summaryItems"),
  summaryQueued: $("#summaryQueued"),
  summaryTime: $("#summaryTime"),
  previewModal: $("#previewModal"),
  previewMode: $("#previewMode"),
  previewTitleInput: $("#previewTitleInput"),
  previewUrlInput: $("#previewUrlInput"),
  previewText: $("#previewText"),
  previewNotice: $("#previewNotice"),
  previewAdd: $("#previewAdd"),
  previewPlay: $("#previewPlay"),
  previewClose: $("#previewClose"),
  focusModal: $("#focusModal"),
  focusOpen: $("#focusOpen"),
  sleepSelect: $("#sleepSelect"),
  focusClose: $("#focusClose"),
  focusItemTitle: $("#focusItemTitle"),
  focusText: $("#focusText"),
  commandModal: $("#commandModal"),
  commandOpen: $("#commandOpen"),
  commandInput: $("#commandInput"),
  commandList: $("#commandList"),
  settingsOpen: $("#settingsOpen"),
  privacyOpen: $("#privacyOpen"),
  importFile: $("#importFile"),
  toasts: $("#toasts")
};

let state = await readState();
let filter = "all";
let previewCapture = null;
let editingItemId = "";
let commandIndex = 0;

const message = (payload) => chrome.runtime.sendMessage(payload);

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 3000);
};

const setBusy = (button, busy) => {
  button.disabled = busy;
  button.dataset.label ||= button.textContent;
  button.textContent = busy ? "Working..." : button.dataset.label;
};

const statusLabel = (status) => status === "playing" ? "Playing" : status === "paused" ? "Paused" : status === "loading" ? "Loading" : status === "error" ? "Error" : "Idle";

const escapeHtml = (value) => String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));

const sourceLabel = (item) => item.sourceUrl ? hostFromUrl(item.sourceUrl) : item.sourceTitle || item.sourceType;

const itemMatches = (item) => {
  const query = els.queueSearch.value.trim().toLowerCase();
  const filterMatch = filter === "all" || (filter === "playing" ? item.state === "playing" || item.state === "paused" : item.state === filter);
  if (!filterMatch) return false;
  if (!query) return true;
  return [item.title, item.text, item.sourceTitle, item.sourceUrl, item.sourceType].some((value) => String(value || "").toLowerCase().includes(query));
};

const renderQueue = () => {
  const item = currentItem(state);
  const rows = state.queue.filter(itemMatches);
  if (!rows.length) {
    const emptyText = state.queue.length ? "No items match the current search or filter." : "Your queue is empty. Capture the current page, selected text, or paste something worth listening to.";
    els.queueList.innerHTML = `<div class="empty-state"><strong>${state.queue.length ? "Nothing found" : "No listening material yet"}</strong><p>${emptyText}</p><button class="button primary" data-command="capture-page" type="button">Capture current page</button></div>`;
    return;
  }
  els.queueList.innerHTML = rows.map((row) => {
    const active = item?.id === row.id;
    const completed = row.state === "completed";
    const failed = row.state === "failed";
    const meta = `${row.sourceType} · ${row.wordCount} words · ${fmtTime(row.estimateSeconds)} · ${new Date(row.capturedAt).toLocaleDateString()}`;
    const source = row.sourceUrl ? `<a class="source-link" href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceLabel(row))}</a>` : `<span class="source-link">${escapeHtml(sourceLabel(row))}</span>`;
    return `<article class="queue-item ${active ? "active" : ""}" data-id="${row.id}" data-state="${row.state}">
      <div class="queue-header-row">
        <div>
          <h3 class="queue-title">${escapeHtml(row.title)}</h3>
          <div class="queue-meta">${source}<span>${escapeHtml(meta)}</span></div>
        </div>
        <span class="status-badge ${row.state}">${row.state}</span>
      </div>
      <p class="queue-text">${escapeHtml(failed ? row.error || "Extraction failed." : row.text)}</p>
      <div class="queue-actions">
        <button class="button primary small" data-action="play" type="button">${active && state.playback.status === "playing" ? "Restart" : "Play"}</button>
        <button class="button secondary small" data-action="edit" type="button">Edit</button>
        <button class="button secondary small" data-action="duplicate" type="button">Duplicate</button>
        <button class="button secondary small" data-action="up" type="button" aria-label="Move up">↑</button>
        <button class="button secondary small" data-action="down" type="button" aria-label="Move down">↓</button>
        ${failed ? "<button class=\"button secondary small\" data-action=\"retry\" type=\"button\">Retry</button>" : ""}
        ${completed ? "<button class=\"button secondary small\" data-action=\"queue\" type=\"button\">Queue again</button>" : ""}
        <button class="button danger small" data-action="delete" type="button">Delete</button>
      </div>
    </article>`;
  }).join("");
};

const renderNow = () => {
  const item = currentItem(state);
  const progress = progressFor(item, state.playback.segmentIndex, state.settings);
  els.statusBadge.className = `status-badge ${state.playback.status}`;
  els.statusBadge.textContent = statusLabel(state.playback.status);
  els.nowTitle.textContent = item?.title || "Nothing queued";
  els.nowMeta.textContent = item ? `${sourceLabel(item)} · ${progress.count} segments · ${fmtTime(progress.elapsed)} / ${fmtTime(progress.total)}` : "Capture a page, selection, or paste text to begin.";
  els.progressFill.style.width = `${progress.percent}%`;
  els.progress.setAttribute("aria-valuenow", String(progress.percent));
  els.segmentLabel.textContent = item ? `Segment ${Math.min(state.playback.segmentIndex + 1, progress.count)} of ${progress.count}` : "Ready";
  els.segmentText.textContent = progress.segment?.text || item?.text?.slice(0, 420) || "No readable segment is active.";
  els.playPause.textContent = state.playback.status === "playing" ? "Ⅱ" : "▶";
  els.sleepSelect.value = String(state.settings.sleepMinutes || 0);
  els.focusItemTitle.textContent = item?.title || "Nothing queued";
  els.focusText.textContent = progress.segment?.text || "No active segment.";
};

const renderSummary = () => {
  const summary = queueSummary(state);
  els.summaryItems.textContent = String(summary.total);
  els.summaryQueued.textContent = String(summary.queued);
  els.summaryTime.textContent = fmtTime(summary.seconds);
};

const renderOnboarding = () => {
  els.onboarding.classList.toggle("hidden", Boolean(state.settings.onboarded));
};

const render = async () => {
  state = await readState();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.reduceMotion ? "reduced" : "full";
  renderOnboarding();
  renderNow();
  renderSummary();
  renderQueue();
};

const control = async (type, payload = {}) => {
  const response = await message({ type, ...payload });
  if (!response?.ok) toast(response?.error || "Action failed", "error");
  await render();
};

const showPreview = (capture, mode = "Capture preview") => {
  previewCapture = capture;
  editingItemId = "";
  els.previewMode.textContent = mode;
  els.previewTitleInput.value = capture.title || capture.sourceTitle || "Captured text";
  els.previewUrlInput.value = capture.url || capture.sourceUrl || "";
  els.previewText.value = capture.text || "";
  const count = wordCount(capture.text || "");
  const quality = capture.quality === "uncertain" ? "Extraction is short. Review before adding." : capture.failed ? capture.error || "Extraction failed. Paste or edit manually." : "Review extraction quality before adding.";
  els.previewNotice.className = `notice ${capture.failed ? "error" : capture.quality === "uncertain" ? "" : "success"}`.trim();
  els.previewNotice.textContent = `${count} words · ${quality}`;
  els.previewModal.classList.remove("hidden");
  els.previewText.focus();
};

const hidePreview = () => {
  els.previewModal.classList.add("hidden");
  previewCapture = null;
  editingItemId = "";
};

const capture = async (mode, button) => {
  setBusy(button, true);
  try {
    const response = await message({ type: "QTTS_CAPTURE_ACTIVE", mode });
    if (response?.capture) showPreview(response.capture, mode === "selection" ? "Selected text" : "Current page");
    else throw new Error(response?.error || "Capture failed.");
  } catch (error) {
    showPreview({ title: "Manual recovery", sourceType: "failed", text: "", failed: true, error: error?.message || "Capture failed." }, "Capture failed");
  } finally {
    setBusy(button, false);
  }
};

const commitPreview = async (play = false) => {
  const capture = {
    ...(previewCapture || {}),
    title: els.previewTitleInput.value.trim() || "Captured text",
    sourceTitle: els.previewTitleInput.value.trim() || previewCapture?.sourceTitle || "Captured text",
    url: els.previewUrlInput.value.trim(),
    sourceUrl: els.previewUrlInput.value.trim(),
    text: els.previewText.value.trim(),
    sourceType: previewCapture?.sourceType === "failed" && wordCount(els.previewText.value) >= 3 ? "paste" : previewCapture?.sourceType || "paste",
    failed: wordCount(els.previewText.value) < 3,
    error: wordCount(els.previewText.value) < 3 ? "Not enough text to add." : ""
  };
  if (editingItemId) {
    await updateState((current) => ({
      ...current,
      queue: current.queue.map((item) => item.id === editingItemId ? normalizeItem({ ...item, title: capture.title, text: capture.text, sourceTitle: capture.sourceTitle || capture.title, sourceUrl: capture.sourceUrl, sourceType: capture.sourceType, state: capture.failed ? "failed" : "queued", error: capture.error || "", updatedAt: Date.now(), rate: current.settings.rate }) : item)
    }));
    toast("Item updated");
    hidePreview();
    await render();
    return;
  }
  const response = await message({ type: "QTTS_ADD_CAPTURE", capture });
  if (!response?.ok) {
    toast(response?.error || "Could not add item", "error");
    return;
  }
  hidePreview();
  toast(play ? "Added and started" : "Added to queue");
  if (play) await control("QTTS_PLAY", { itemId: response.item.id, segmentIndex: 0 });
  await render();
};

const addPaste = async () => {
  const text = els.pasteInput.value.trim();
  if (wordCount(text) < 3) {
    toast("Paste more text before adding.", "error");
    return;
  }
  const item = createQueueItem({ title: "Pasted text", text, sourceType: "paste", sourceTitle: "Side panel paste" }, state.settings);
  await addItemToState(item, { activate: !state.playback.itemId });
  els.pasteInput.value = "";
  els.pasteStats.textContent = "0 words · 0:00";
  toast("Pasted text added");
  await render();
};

const queueAction = async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const command = button.dataset.command;
  if (command === "capture-page") {
    await capture("page", els.capturePage);
    return;
  }
  const action = button.dataset.action;
  const row = button.closest(".queue-item");
  if (!action || !row) return;
  const id = row.dataset.id;
  const item = state.queue.find((candidate) => candidate.id === id);
  if (!item) return;
  if (action === "play") await control("QTTS_PLAY", { itemId: id, segmentIndex: item.segmentIndex || 0 });
  if (action === "delete") {
    await updateState((current) => ({ ...current, queue: current.queue.filter((candidate) => candidate.id !== id), playback: current.playback.itemId === id ? { ...current.playback, itemId: "", segmentIndex: 0, status: "idle" } : current.playback }));
    await render();
  }
  if (action === "duplicate") {
    const copy = createQueueItem({ ...item, title: `${item.title} copy`, state: "queued" }, state.settings);
    await addItemToState(copy);
    await render();
  }
  if (action === "edit") {
    previewCapture = { ...item, url: item.sourceUrl };
    editingItemId = id;
    els.previewMode.textContent = "Edit queue item";
    els.previewTitleInput.value = item.title;
    els.previewUrlInput.value = item.sourceUrl;
    els.previewText.value = item.text;
    els.previewNotice.className = "notice";
    els.previewNotice.textContent = `${item.wordCount} words · Save changes to repair capture quality or metadata.`;
    els.previewModal.classList.remove("hidden");
    els.previewTitleInput.focus();
  }
  if (action === "up" || action === "down") {
    await updateState((current) => {
      const queue = [...current.queue];
      const index = queue.findIndex((candidate) => candidate.id === id);
      const target = action === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= queue.length) return current;
      [queue[index], queue[target]] = [queue[target], queue[index]];
      return { ...current, queue };
    });
    await render();
  }
  if (action === "queue") {
    await updateState((current) => ({ ...current, queue: current.queue.map((candidate) => candidate.id === id ? { ...candidate, state: "queued", segmentIndex: 0, completedAt: 0 } : candidate) }));
    await render();
  }
  if (action === "retry") await capture("page", els.capturePage);
};

const exportData = async () => {
  const blob = new Blob([serializeExport(await readState())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `queuetts-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Export created");
};

const importData = async (file) => {
  try {
    const raw = await file.text();
    await updateState((current) => {
      const imported = parseImport(raw);
      return { ...imported, settings: { ...current.settings, ...imported.settings } };
    });
    toast("Import complete");
    await render();
  } catch (error) {
    toast(error?.message || "Import failed", "error");
  }
};

const clearCompleted = async () => {
  await updateState((current) => ({ ...current, queue: current.queue.filter((item) => item.state !== "completed") }));
  toast("Completed items cleared");
  await render();
};

const clearAll = async () => {
  if (!confirm("Clear the entire QueueTTS queue?")) return;
  await updateState((current) => ({ ...current, queue: [], playback: { ...current.playback, itemId: "", segmentIndex: 0, status: "idle" } }));
  await control("QTTS_STOP");
  toast("Queue cleared");
};

const openOptions = () => chrome.runtime.openOptionsPage();

const commands = [
  { id: "capture-page", title: "Capture current page", detail: "Preview readable text from the active tab", run: () => capture("page", els.capturePage) },
  { id: "capture-selection", title: "Capture selected text", detail: "Preview selected text from the active tab", run: () => capture("selection", els.captureSelection) },
  { id: "play", title: "Play or pause", detail: "Toggle current playback", run: () => control("QTTS_TOGGLE") },
  { id: "next", title: "Next item", detail: "Move to the next queue item", run: () => control("QTTS_NEXT_ITEM") },
  { id: "previous", title: "Previous item", detail: "Move to the previous queue item", run: () => control("QTTS_PREV_ITEM") },
  { id: "focus", title: "Open focus mode", detail: "Use an immersive listening view", run: () => showFocus() },
  { id: "search", title: "Search queue", detail: "Focus the queue search box", run: () => els.queueSearch.focus() },
  { id: "settings", title: "Open settings", detail: "Voice, privacy, storage, and shortcuts", run: openOptions },
  { id: "export", title: "Export data", detail: "Download local QueueTTS data", run: exportData },
  { id: "import", title: "Import data", detail: "Load a QueueTTS JSON export", run: () => els.importFile.click() },
  { id: "clear-completed", title: "Clear completed", detail: "Remove finished queue items", run: clearCompleted },
  { id: "clear-all", title: "Clear queue", detail: "Remove all queue items", run: clearAll }
];

const visibleCommands = () => {
  const query = els.commandInput.value.trim().toLowerCase();
  return commands.filter((command) => !query || `${command.title} ${command.detail}`.toLowerCase().includes(query));
};

const renderCommands = () => {
  const list = visibleCommands();
  commandIndex = Math.min(commandIndex, Math.max(0, list.length - 1));
  els.commandList.innerHTML = list.map((command, index) => `<button class="command-row ${index === commandIndex ? "active" : ""}" data-id="${command.id}" role="option" aria-selected="${index === commandIndex}" type="button"><span>${escapeHtml(command.title)}<br><small>${escapeHtml(command.detail)}</small></span><small>${index === 0 ? "Enter" : ""}</small></button>`).join("") || `<div class="empty-state"><strong>No command found</strong><p>Try capture, play, settings, export, or clear.</p></div>`;
};

const showCommand = () => {
  commandIndex = 0;
  els.commandModal.classList.remove("hidden");
  els.commandInput.value = "";
  renderCommands();
  els.commandInput.focus();
};

const hideCommand = () => els.commandModal.classList.add("hidden");

const runCommand = async (id) => {
  const command = commands.find((entry) => entry.id === id) || visibleCommands()[commandIndex];
  if (!command) return;
  hideCommand();
  await command.run();
};

const showFocus = () => {
  renderNow();
  els.focusModal.classList.remove("hidden");
  els.focusClose.focus();
};

const hideFocus = () => els.focusModal.classList.add("hidden");

$$(".tab[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
  $$(".tab[data-tab]").forEach((item) => {
    item.classList.toggle("active", item === tab);
    item.setAttribute("aria-selected", item === tab ? "true" : "false");
  });
  $$(".capture-pane").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.pane !== tab.dataset.tab));
}));

$$("[data-seek]").forEach((button) => button.addEventListener("click", () => control("QTTS_SEEK", { seconds: Number(button.dataset.seek) })));
els.playPause.addEventListener("click", () => control("QTTS_TOGGLE"));
els.prevItem.addEventListener("click", () => control("QTTS_PREV_ITEM"));
els.nextItem.addEventListener("click", () => control("QTTS_NEXT_ITEM"));
els.prevSegment.addEventListener("click", () => control("QTTS_PREV_SEGMENT"));
els.nextSegment.addEventListener("click", () => control("QTTS_NEXT_SEGMENT"));
els.capturePage.addEventListener("click", () => capture("page", els.capturePage));
els.captureSelection.addEventListener("click", () => capture("selection", els.captureSelection));
els.onboardPage.addEventListener("click", async () => {
  await updateState((current) => ({ ...current, settings: { ...current.settings, onboarded: true } }));
  await render();
  await capture("page", els.capturePage);
});
els.onboardDone.addEventListener("click", async () => {
  await updateState((current) => ({ ...current, settings: { ...current.settings, onboarded: true } }));
  await render();
});
els.addPaste.addEventListener("click", addPaste);
els.pasteInput.addEventListener("input", () => {
  const words = wordCount(els.pasteInput.value);
  els.pasteStats.textContent = `${words} ${words === 1 ? "word" : "words"} · ${fmtTime(Math.round((words / 178) * 60))}`;
});
els.queueSearch.addEventListener("input", renderQueue);
els.queueList.addEventListener("click", queueAction);
els.previewClose.addEventListener("click", hidePreview);
els.previewAdd.addEventListener("click", () => commitPreview(false));
els.previewPlay.addEventListener("click", () => commitPreview(true));
els.focusOpen.addEventListener("click", showFocus);
els.sleepSelect.addEventListener("change", () => control("QTTS_SLEEP", { minutes: Number(els.sleepSelect.value) }));
els.focusClose.addEventListener("click", hideFocus);
els.focusModal.addEventListener("click", (event) => {
  const action = event.target.closest("[data-focus-action]")?.dataset.focusAction;
  if (action === "toggle") control("QTTS_TOGGLE");
  if (action === "prev") control("QTTS_PREV_SEGMENT");
  if (action === "next") control("QTTS_NEXT_SEGMENT");
});
els.commandOpen.addEventListener("click", showCommand);
els.commandInput.addEventListener("input", () => {
  commandIndex = 0;
  renderCommands();
});
els.commandList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-id]");
  if (row) runCommand(row.dataset.id);
});
els.settingsOpen.addEventListener("click", openOptions);
els.privacyOpen.addEventListener("click", openOptions);
els.importFile.addEventListener("change", () => {
  const file = els.importFile.files?.[0];
  if (file) importData(file);
  els.importFile.value = "";
});
$$(".filter-row [data-filter]").forEach((button) => button.addEventListener("click", () => {
  filter = button.dataset.filter;
  $$(".filter-row [data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderQueue();
}));

document.addEventListener("keydown", (event) => {
  const editable = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "");
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    showCommand();
    return;
  }
  if (event.key === "Escape") {
    hidePreview();
    hideFocus();
    hideCommand();
    return;
  }
  if (!els.commandModal.classList.contains("hidden")) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandIndex = Math.min(commandIndex + 1, Math.max(0, visibleCommands().length - 1));
      renderCommands();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commandIndex = Math.max(0, commandIndex - 1);
      renderCommands();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand();
    }
    return;
  }
  if (editable) return;
  if (event.key === " ") {
    event.preventDefault();
    control("QTTS_TOGGLE");
  }
  if (event.key === "j") control("QTTS_NEXT_SEGMENT");
  if (event.key === "k") control("QTTS_PREV_SEGMENT");
  if (event.key === "n") control("QTTS_NEXT_ITEM");
  if (event.key === "p") control("QTTS_PREV_ITEM");
  if (event.key === "/") {
    event.preventDefault();
    els.queueSearch.focus();
  }
  if (event.key === "f") showFocus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

await render();
storageBytes().then((bytes) => {
  if (bytes > 4500000) toast("Local storage is getting large. Export and clear old items soon.", "error");
});
