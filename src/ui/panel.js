import { findItem } from "../lib/queue.js";
import { docKey } from "../lib/store.js";
import { localDay, MIN_SELECTION_WORDS, planKey, wordCount } from "../lib/text.js";
import { $, announce, applyTheme, connectSpeech, createStore, displayWordIndex, escape, formatDuration, h, historyItems, icon, isActive, itemRemaining, keyed, openMenu, queuedItems, renderHealth, renderSentence, send, sourceLabel, toast, typing, weekSummary } from "./common.js";
import { mountDeck, planFor } from "./deck.js";
import { createRow, historyDay, updateRow } from "./rows.js";

const els = {
  deck: $("#deck"),
  welcome: $("#welcome"),
  caughtUp: $("#caughtUp"),
  caughtText: $("#caughtText"),
  health: $("#health"),
  lane: $("#lane"),
  nextHead: $("#nextHead"),
  nextMeta: $("#nextMeta"),
  nextEmpty: $("#nextEmpty"),
  queueList: $("#queueList"),
  doneHead: $("#doneHead"),
  doneMeta: $("#doneMeta"),
  historyList: $("#historyList"),
  moreHistory: $("#moreHistory"),
  clearHistory: $("#clearHistory"),
  readerWrap: $("#readerWrap"),
  reader: $("#reader"),
  search: $("#search"),
  searchBar: $("#searchBar"),
  searchToggle: $("#searchToggle"),
  pasteDialog: $("#pasteDialog"),
  pasteText: $("#pasteText"),
  pasteAdd: $("#pasteAdd"),
  pasteCount: $("#pasteCount"),
  keysDialog: $("#keysDialog")
};

els.searchToggle.innerHTML = icon("search", "sm");
$("#addText").innerHTML = icon("plus");
$("#openSettings").innerHTML = icon("sliders");
$("#trySample").innerHTML = `${icon("play", "sm")}<span>Hear a short sample</span>`;
$("#wayMenu").innerHTML = icon("doc", "sm");
$("#wayShortcut").innerHTML = icon("plus", "sm");

const HISTORY_PAGE = 30;
const SUMMARY_MIN_MS = 60000;
const MANUAL_SCROLL_HOLD_MS = 3500;
let store = null;
let query = "";
let readAlong = false;
let readerKey = "";
let readerNow = null;
let userScrolledAt = 0;
let dragId = "";
let historyLimit = HISTORY_PAGE;
let last = { itemId: "", status: "" };

const deck = mountDeck(els.deck, { onReadAlong: (value) => setReadAlong(value) });
store = await createStore((changed, snapshot) => render(changed, snapshot));

const matches = (item) => !query || `${item.title} ${item.site} ${item.url} ${item.author} ${item.excerpt}`.toLowerCase().includes(query);

const remove = async (id) => {
  const item = findItem(store.queue, id);
  const result = await send("remove", id);
  if (result.ok && result.removed) toast(`Removed “${item?.title || "item"}”`, { label: "Undo", run: () => send("restore", result.removed) });
};

const rowMenu = (anchor, item) => {
  const current = item.id === store.player.itemId;
  const entries = [];
  if (item.status === "queued") {
    if (!current) entries.push({ icon: "play", label: "Play now", run: () => send("play", item.id) });
    if (!current && store.player.itemId) entries.push({ icon: "queue", label: "Play next", run: () => send("playNext", item.id) });
    entries.push({ icon: "check", label: "Mark as listened", run: async () => { await send("done", item.id); announce("Marked as listened"); } });
  } else {
    entries.push({ icon: "play", label: "Play again", run: () => send("play", item.id) });
    entries.push({ icon: "undo", label: "Back to the queue", run: async () => { await send("unplayed", item.id); announce("Moved back to the queue"); } });
  }
  if (item.url) entries.push({ icon: "external", label: "Open page", run: () => chrome.tabs.create({ url: item.url }) });
  entries.push("-", { icon: "trash", label: "Remove", danger: true, run: () => remove(item.id) });
  openMenu(anchor, entries);
};

const ensureTabStop = (list) => {
  const buttons = Array.from(list.querySelectorAll(".row-main"));
  if (buttons.length && !buttons.some((button) => button.tabIndex === 0)) buttons[0].tabIndex = 0;
};

const renderTop = () => {
  const queued = queuedItems(store.queue);
  const history = historyItems(store.queue);
  const hasCurrent = Boolean(store.player.itemId && findItem(store.queue, store.player.itemId));
  els.welcome.hidden = hasCurrent || queued.length > 0 || history.length > 0;
  $("#ghost").hidden = els.welcome.hidden;
  els.caughtUp.hidden = hasCurrent || queued.length > 0 || history.length === 0;
  if (!els.caughtUp.hidden) {
    const week = weekSummary(store.stats);
    const today = store.stats.days[localDay()] || {};
    const parts = [];
    if (today.finished) parts.push(`${today.finished} finished today`);
    if (week.ms > SUMMARY_MIN_MS) parts.push(`${formatDuration(week.ms / 1000)} listened this week`);
    els.caughtText.textContent = `${parts.length ? `${parts.join(" · ")}. ` : ""}Add a page and it plays next.`;
  }
};

const renderQueue = () => {
  const queued = queuedItems(store.queue);
  const currentId = store.player.itemId;
  const upcoming = queued.filter((item) => item.id !== currentId);
  const visible = upcoming.filter(matches);
  const total = upcoming.reduce((sum, item) => sum + itemRemaining(item, store.settings), 0);
  els.nextHead.hidden = !queued.length;
  els.nextMeta.textContent = upcoming.length ? `${upcoming.length} · ${formatDuration(total)}` : "";
  els.nextEmpty.hidden = !(queued.length && !upcoming.length) || Boolean(query);
  if (!els.nextEmpty.hidden) els.nextEmpty.textContent = `Nothing else is queued. ${els.nextEmpty.dataset.hint || ""}`;
  els.queueList.classList.toggle("rail", visible.length > 1);
  keyed(els.queueList, visible, (item) => item.id, createRow, (row, item) => updateRow(row, item, { kind: "next", index: upcoming.indexOf(item) + 1, store, draggable: !query }));
  ensureTabStop(els.queueList);
};

const renderHistory = () => {
  const items = historyItems(store.queue).filter(matches);
  const total = historyItems(store.queue).length;
  els.doneHead.hidden = total === 0;
  const week = weekSummary(store.stats);
  els.doneMeta.textContent = week.ms > SUMMARY_MIN_MS ? `${formatDuration(week.ms / 1000)} this week` : total ? String(total) : "";
  const shown = items.slice(0, historyLimit);
  const entries = [];
  let day = "";
  for (const item of shown) {
    const label = historyDay(item);
    if (label !== day) {
      day = label;
      entries.push({ day: label });
    }
    entries.push(item);
  }
  keyed(els.historyList, entries, (entry) => (entry.day ? `day:${entry.day}` : entry.id), (entry) => (entry.day ? h("li", { class: "day", "aria-hidden": "true" }) : createRow()), (node, entry) => {
    if (entry.day) node.textContent = entry.day;
    else updateRow(node, entry, { kind: "done", store });
  });
  els.moreHistory.hidden = items.length <= historyLimit;
  els.moreHistory.textContent = `Show ${Math.min(HISTORY_PAGE, items.length - historyLimit)} more`;
  ensureTabStop(els.historyList);
};

els.moreHistory.addEventListener("click", () => {
  historyLimit += HISTORY_PAGE;
  renderHistory();
});

const renderReader = async () => {
  const item = store.player.itemId ? findItem(store.queue, store.player.itemId) : null;
  if (!item) {
    els.reader.innerHTML = `<p class="meta">Nothing is playing. Choose something from your queue.</p>`;
    readerKey = "";
    return;
  }
  const cache = await planFor(item, store.settings);
  const key = planKey(item, store.settings);
  if (key !== readerKey && cache.doc && cache.plan) {
    readerKey = key;
    const byBlock = new Map();
    for (const unit of cache.plan.units) {
      if (!byBlock.has(unit.b)) byBlock.set(unit.b, []);
      byBlock.get(unit.b).push(unit);
    }
    const parts = [`<div class="reader-head"><button class="btn btn-quiet" type="button" data-act="back">${icon("arrow-left", "sm")}<span>Queue</span></button><span class="meta">${escape(sourceLabel(item))}</span></div>`];
    cache.doc.blocks.forEach((block, b) => {
      const units = byBlock.get(b) || [];
      const sentences = units.map((unit) => `<span class="s" data-b="${unit.b}" data-s="${unit.s}">${escape(unit.text)}</span>`).join(" ");
      if (block.k === "h") parts.push(`<h3>${sentences || escape(block.t)}</h3>`);
      else if (block.k === "code") parts.push(units.length ? `<pre>${sentences}</pre>` : `<pre class="skipped" title="Code is skipped while reading aloud. You can change this in Settings.">${escape(block.t)}</pre>`);
      else if (block.k === "li") parts.push(`<p class="li">${sentences}</p>`);
      else if (block.k === "q") parts.push(`<blockquote>${sentences}</blockquote>`);
      else parts.push(`<p>${sentences}</p>`);
    });
    els.reader.innerHTML = parts.join("");
    readerNow = null;
  }
  markReader(store.player.pos);
};

const markReader = (pos, word = null) => {
  if (!pos || !readAlong) return;
  const target = els.reader.querySelector(`.s[data-b="${pos.b}"][data-s="${pos.s}"]`) || els.reader.querySelector(".s");
  if (!target) return;
  if (readerNow !== target) {
    if (readerNow) {
      readerNow.classList.remove("now");
      readerNow.textContent = readerNow.textContent;
    }
    let passed = true;
    for (const sentence of els.reader.querySelectorAll(".s")) {
      if (sentence === target) passed = false;
      sentence.classList.toggle("read", passed);
    }
    target.classList.add("now");
    readerNow = target;
    if (Date.now() - userScrolledAt > MANUAL_SCROLL_HOLD_MS) target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  if (word) {
    const text = target.textContent;
    renderSentence(target, text, displayWordIndex(word.spoken, word.c, text));
  }
};

els.reader.addEventListener("click", (event) => {
  if (event.target.closest("[data-act='back']")) return setReadAlong(false);
  const sentence = event.target.closest(".s");
  if (!sentence || !store.player.itemId) return;
  send("seek", store.player.itemId, Number(sentence.dataset.b), Number(sentence.dataset.s));
});
for (const type of ["wheel", "touchmove"]) els.readerWrap.addEventListener(type, () => (userScrolledAt = Date.now()), { passive: true });

function setReadAlong(value) {
  readAlong = value;
  document.body.classList.toggle("reading", value);
  deck.setReadAlong(value);
  els.lane.hidden = value;
  els.searchBar.hidden = value || els.searchBar.hidden;
  els.readerWrap.hidden = !value;
  if (value) {
    userScrolledAt = 0;
    renderReader().then(() => readerNow?.scrollIntoView({ block: "center" }));
  }
}

const focusRow = (row) => {
  if (!row) return;
  for (const button of row.parentElement.querySelectorAll(".row-main")) button.tabIndex = -1;
  const main = row.querySelector(".row-main");
  main.tabIndex = 0;
  main.focus();
};

const onListClick = (event) => {
  const row = event.target.closest(".row");
  if (!row) return;
  const id = row.dataset.key;
  const item = findItem(store.queue, id);
  if (!item) return;
  const action = event.target.closest("[data-act]")?.dataset.act;
  if (action === "menu") return rowMenu(event.target.closest("[data-act]"), item);
  if (action === "play") return id === store.player.itemId && isActive(store.player) ? send("pause") : send("play", id);
  if (event.target.closest(".row-main")) {
    focusRow(row);
    send("play", id);
  }
};

const onListKey = async (event) => {
  const row = event.target.closest(".row");
  if (!row || !event.target.classList.contains("row-main")) return;
  const rows = Array.from(row.parentElement.querySelectorAll(".row"));
  const index = rows.indexOf(row);
  const id = row.dataset.key;
  const item = findItem(store.queue, id);
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && row.parentElement === els.queueList && !query) {
    event.preventDefault();
    const upcoming = queuedItems(store.queue).filter((entry) => entry.id !== store.player.itemId);
    const position = upcoming.findIndex((entry) => entry.id === id);
    const target = position + (event.key === "ArrowUp" ? -1 : 1);
    if (target < 0 || target >= upcoming.length) return;
    await send("move", id, target + (store.player.itemId ? 1 : 0));
    announce(`Moved to position ${target + 1}`);
    requestAnimationFrame(() => focusRow(els.queueList.querySelector(`[data-key="${CSS.escape(id)}"]`)));
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focusRow(rows[index + (event.key === "ArrowDown" ? 1 : -1)]);
    return;
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    focusRow(event.key === "Home" ? rows[0] : rows[rows.length - 1]);
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    const fallback = rows[index + 1] || rows[index - 1];
    await remove(id);
    if (fallback) requestAnimationFrame(() => fallback.isConnected && focusRow(fallback));
    return;
  }
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || event.key === ".") {
    event.preventDefault();
    if (item) rowMenu(row.querySelector("[data-act='menu']"), item);
  }
};

for (const list of [els.queueList, els.historyList]) {
  list.addEventListener("click", onListClick);
  list.addEventListener("keydown", onListKey);
}

els.queueList.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".row");
  if (!row?.draggable) return event.preventDefault();
  dragId = row.dataset.key;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", dragId);
});
els.queueList.addEventListener("dragover", (event) => {
  if (!dragId) return;
  const row = event.target.closest(".row");
  if (!row) return;
  event.preventDefault();
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  for (const other of els.queueList.querySelectorAll(".drop-before, .drop-after")) other.classList.remove("drop-before", "drop-after");
  row.classList.add(after ? "drop-after" : "drop-before");
});
els.queueList.addEventListener("dragend", () => {
  dragId = "";
  for (const other of els.queueList.querySelectorAll(".dragging, .drop-before, .drop-after")) other.classList.remove("dragging", "drop-before", "drop-after");
});
els.queueList.addEventListener("drop", async (event) => {
  event.preventDefault();
  const row = event.target.closest(".row");
  const id = dragId;
  if (!row || !id || row.dataset.key === id) return;
  const after = row.classList.contains("drop-after");
  const upcoming = queuedItems(store.queue).filter((entry) => entry.id !== store.player.itemId && entry.id !== id);
  let target = upcoming.findIndex((entry) => entry.id === row.dataset.key);
  if (after) target += 1;
  await send("move", id, target + (store.player.itemId ? 1 : 0));
  announce("Queue reordered");
});

els.clearHistory.addEventListener("click", async () => {
  const snapshot = historyItems(store.queue);
  const docs = await chrome.storage.local.get(snapshot.map((item) => docKey(item.id)));
  await send("clearHistory");
  toast(`Cleared ${snapshot.length} listened ${snapshot.length === 1 ? "item" : "items"}`, {
    label: "Undo",
    run: async () => {
      for (const item of [...snapshot].reverse()) await send("restore", { item, doc: docs[docKey(item.id)], index: store.queue.items.length });
    }
  });
});

const toggleSearch = (open = els.searchBar.hidden) => {
  if (open && readAlong) setReadAlong(false);
  els.searchBar.hidden = !open;
  els.searchToggle.setAttribute("aria-expanded", String(open));
  if (open) els.search.focus();
  else {
    els.search.value = "";
    query = "";
    renderQueue();
    renderHistory();
  }
};
els.searchToggle.addEventListener("click", () => toggleSearch());
els.search.addEventListener("input", () => {
  query = els.search.value.trim().toLowerCase();
  renderQueue();
  renderHistory();
});
els.search.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.stopPropagation();
    toggleSearch(false);
    els.searchToggle.focus();
  }
});

const openPaste = () => {
  els.pasteText.value = "";
  els.pasteAdd.disabled = true;
  els.pasteCount.textContent = "";
  els.pasteDialog.showModal();
  els.pasteText.focus();
};
$("#addText").addEventListener("click", openPaste);
$("#emptyPaste").addEventListener("click", openPaste);
$("#trySample").addEventListener("click", () => send("addSample"));
els.pasteText.addEventListener("input", () => {
  const count = wordCount(els.pasteText.value);
  els.pasteCount.textContent = count ? `${count} words` : "";
  els.pasteAdd.disabled = count < MIN_SELECTION_WORDS;
});
els.pasteText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !els.pasteAdd.disabled) {
    event.preventDefault();
    els.pasteDialog.close("add");
  }
});
els.pasteDialog.addEventListener("close", async () => {
  if (els.pasteDialog.returnValue !== "add") return;
  const result = await send("addText", els.pasteText.value);
  if (result.ok) toast(result.position === 0 ? "Added · plays first" : `Added · #${result.position + 1} in the queue`, { label: "Undo", run: () => send("remove", result.item.id) });
});
$("#openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#keysClose").addEventListener("click", () => els.keysDialog.close());

document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || document.querySelector(".menu") || document.querySelector(":popover-open")) return;
  if (typing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
  const onButton = event.target instanceof HTMLElement && event.target.closest("button, [role='slider']");
  const inList = event.target instanceof HTMLElement && event.target.closest(".queue");
  const key = event.key.toLowerCase();
  if (event.key === " " && !onButton) {
    event.preventDefault();
    send("toggle");
  } else if (event.key === "ArrowLeft" && !inList) send("skip", -1);
  else if (event.key === "ArrowRight" && !inList) send("skip", 1);
  else if (key === "n" && !inList) send("skipItem").then((result) => !result.ok && result.message && toast(result.message));
  else if (event.key === "-" || event.key === "[") deck.slower();
  else if (event.key === "=" || event.key === "+" || event.key === "]") deck.faster();
  else if (key === "r" && store.player.itemId) setReadAlong(!readAlong);
  else if (event.key === "/") {
    event.preventDefault();
    toggleSearch(true);
  } else if (event.key === "?") els.keysDialog.showModal();
  else if (event.key === "Escape" && readAlong) setReadAlong(false);
});

function render(changed = new Set(["player", "queue", "settings", "stats", "health"]), snapshot = store) {
  store = snapshot;
  applyTheme(store.settings);
  deck.update(store, changed);
  const itemChanged = last.itemId !== store.player.itemId || last.status !== store.player.status;
  if (changed.has("queue") || changed.has("settings") || changed.has("stats") || itemChanged) {
    renderTop();
    renderQueue();
    renderHistory();
  }
  last = { itemId: store.player.itemId, status: store.player.status };
  if (changed.has("health")) renderHealth(els.health, store.health);
  if (readAlong && (changed.has("player") || changed.has("queue") || changed.has("settings"))) {
    if (!store.player.itemId) setReadAlong(false);
    else renderReader();
  }
}

connectSpeech((message) => {
  deck.onSpeech(message);
  if (!readAlong || message.id !== store.player.itemId) return;
  if (message.t === "unit") markReader({ b: message.b, s: message.s });
  if (message.t === "word") markReader({ b: message.b, s: message.s }, message);
});

const shortcuts = Object.fromEntries((await chrome.commands.getAll()).map((command) => [command.name, command.shortcut]));
const keycaps = (shortcut) => shortcut.split("+").map((part) => `<kbd>${escape(part)}</kbd>`).join("");
$("#wayShortcutText").innerHTML = shortcuts["queue-page"] ? `Press ${keycaps(shortcuts["queue-page"])} on any article to add it.` : "Use the toolbar button on any article to add it.";
els.nextEmpty.dataset.hint = shortcuts["queue-page"] ? `Press ${shortcuts["queue-page"]} on an article to add it.` : "Use the toolbar button on an article to add it.";
$("#globalKeys").textContent = [shortcuts["queue-page"] && `${shortcuts["queue-page"]} adds the current page`, shortcuts["toggle-playback"] && `${shortcuts["toggle-playback"]} plays or pauses`].filter(Boolean).join(" · ") + (shortcuts["queue-page"] ? ", from any tab." : "");

render();
renderHealth(els.health, store.health);
if (new URLSearchParams(location.search).get("view") === "reader") setReadAlong(true);
