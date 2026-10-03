import { findItem } from "../lib/queue.js";
import { wordCount, wordIndexAt } from "../lib/text.js";
import { $, announce, applyTheme, connectSpeech, createStore, escape, favicon, formatDuration, h, historyItems, icon, isActive, itemRemaining, keyed, openMenu, queuedItems, send, sourceLabel, toast, typing, weekSummary } from "./common.js";
import { mountPlayer, planFor } from "./player.js";

const els = {
  player: $("#player"),
  health: $("#health"),
  queueList: $("#queueList"),
  queueEmpty: $("#queueEmpty"),
  queueNote: $("#queueNote"),
  queueCount: $("#queueCount"),
  historyList: $("#historyList"),
  historyEmpty: $("#historyEmpty"),
  weekStats: $("#weekStats"),
  clearHistory: $("#clearHistory"),
  reader: $("#reader"),
  readerEmpty: $("#readerEmpty"),
  search: $("#search"),
  searchBar: $("#searchBar"),
  searchToggle: $("#searchToggle"),
  pasteDialog: $("#pasteDialog"),
  pasteText: $("#pasteText"),
  pasteAdd: $("#pasteAdd"),
  pasteCount: $("#pasteCount"),
  keysDialog: $("#keysDialog")
};

$("#addMenu").innerHTML = icon("plus");
$("#openSettings").innerHTML = icon("sliders");
els.searchToggle.innerHTML = icon("search", "sm");
$("#emptyAdd").innerHTML = `${icon("text", "sm")}<span>Paste text to start</span>`;

const player = mountPlayer(els.player, { full: true });
let store = await createStore((changed, snapshot) => render(changed, snapshot));
let view = "queue";
let query = "";
let readerKey = "";
let readerNow = null;
let userScrolledAt = 0;
let dragId = "";
let lastRendered = { itemId: "", status: "" };

const matches = (item) => !query || `${item.title} ${item.site} ${item.url} ${item.excerpt}`.toLowerCase().includes(query);

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
    entries.push({ icon: "undo", label: "Mark as not listened", run: async () => { await send("unplayed", item.id); announce("Moved back to the queue"); } });
  }
  if (item.url) entries.push({ icon: "external", label: "Open page", run: () => chrome.tabs.create({ url: item.url }) });
  entries.push("-", { icon: "trash", label: "Remove", danger: true, run: () => remove(item.id) });
  openMenu(anchor, entries);
};

const createRow = (item) => {
  const row = h("li", { class: "row" });
  row.innerHTML = `<span class="row-num" aria-hidden="true"></span><button class="row-main" type="button" tabindex="-1"><span class="row-fav"></span><span class="row-text"><span class="row-title"></span><span class="meta row-meta"></span></span></button><span class="row-tools"><button class="icon-btn" type="button" data-act="play" tabindex="-1"></button><button class="icon-btn" type="button" data-act="menu" tabindex="-1" aria-label="More actions">${icon("more", "sm")}</button></span><span class="row-progress"><span></span></span>`;
  return row;
};

const updateRow = (row, item, index, kind) => {
  const current = item.id === store.player.itemId && kind === "queue";
  const active = current && isActive(store.player);
  row.classList.toggle("current", current);
  row.draggable = kind === "queue" && !current && !query;
  const num = row.querySelector(".row-num");
  if (current) num.innerHTML = `<span class="wave ${store.player.status === "playing" ? "" : "still"}"><i></i><i></i><i></i></span>`;
  else num.textContent = kind === "queue" ? String(index) : "";
  if (row.dataset.title !== item.title) {
    row.dataset.title = item.title;
    row.querySelector(".row-fav").replaceChildren(favicon(item));
    row.querySelector(".row-title").textContent = item.title;
  }
  const progress = current ? store.player.progress || item.progress : item.progress;
  const left = itemRemaining(item, store.settings, progress);
  let meta;
  if (kind === "history") {
    const when = new Date(item.finishedAt);
    const today = new Date();
    const day = when.toDateString() === today.toDateString() ? "Today" : when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    meta = `${sourceLabel(item)} · ${day}`;
  } else meta = `${sourceLabel(item)} · ${progress > 0 ? `${formatDuration(left)} left` : formatDuration(left)}`;
  row.querySelector(".row-meta").textContent = meta;
  row.querySelector(".row-progress > span").style.setProperty("--p", kind === "queue" ? progress.toFixed(3) : 0);
  row.querySelector(".row-progress").hidden = kind !== "queue" || progress <= 0;
  const main = row.querySelector(".row-main");
  const label = `${current ? "Now: " : kind === "queue" ? `${index}. ` : ""}${item.title}, ${meta}`;
  main.setAttribute("aria-label", label);
  const play = row.querySelector("[data-act='play']");
  const playLabel = active ? "Pause" : kind === "history" ? "Play again" : progress > 0 ? "Resume" : "Play";
  if (play.getAttribute("aria-label") !== playLabel) {
    play.setAttribute("aria-label", playLabel);
    play.title = playLabel;
    play.innerHTML = icon(active ? "pause" : "play", "sm");
  }
};

const ensureTabStop = (list) => {
  const buttons = Array.from(list.querySelectorAll(".row-main"));
  if (!buttons.length) return;
  if (!buttons.some((button) => button.tabIndex === 0)) buttons[0].tabIndex = 0;
};

const renderQueue = () => {
  const queued = queuedItems(store.queue);
  const visible = queued.filter(matches);
  els.queueCount.textContent = queued.length ? String(queued.length) : "";
  els.queueEmpty.hidden = queued.length > 0;
  els.queueNote.hidden = !(query && queued.length);
  els.queueNote.textContent = query ? `${visible.length} of ${queued.length} match “${query}”` : "";
  const total = queued.reduce((sum, item) => sum + itemRemaining(item, store.settings, item.id === store.player.itemId ? store.player.progress : item.progress), 0);
  els.queueList.dataset.total = queued.length ? formatDuration(total) : "";
  const currentId = store.player.itemId;
  keyed(els.queueList, visible, (item) => item.id, createRow, (row, item) => {
    updateRow(row, item, queued.filter((entry) => entry.id !== currentId).indexOf(item) + 1, "queue");
  });
  ensureTabStop(els.queueList);
};

const renderHistory = () => {
  const items = historyItems(store.queue);
  const visible = items.filter(matches);
  els.historyEmpty.hidden = items.length > 0;
  els.clearHistory.hidden = items.length === 0;
  const week = weekSummary(store.stats);
  els.weekStats.textContent = week.ms > 60000 || week.finished ? `This week: ${formatDuration(week.ms / 1000)} listened · ${week.finished} finished` : "";
  keyed(els.historyList, visible, (item) => item.id, createRow, (row, item) => updateRow(row, item, 0, "history"));
  ensureTabStop(els.historyList);
};

const renderReader = async () => {
  const item = store.player.itemId ? findItem(store.queue, store.player.itemId) : null;
  els.readerEmpty.hidden = Boolean(item);
  els.reader.hidden = !item;
  if (!item) {
    readerKey = "";
    els.reader.replaceChildren();
    return;
  }
  const cache = await planFor(item, store.settings);
  const key = `${item.id}|${store.settings.readCode}|${store.settings.announceHeadings}`;
  if (key !== readerKey && cache.doc && cache.plan) {
    readerKey = key;
    const byBlock = new Map();
    for (const unit of cache.plan.units) {
      if (!byBlock.has(unit.b)) byBlock.set(unit.b, []);
      byBlock.get(unit.b).push(unit);
    }
    const parts = [`<header class="reader-head"><h2>${escape(item.title)}</h2><p class="meta">${escape([sourceLabel(item), item.author, formatDuration(itemRemaining(item, store.settings, 0))].filter(Boolean).join(" · "))}</p></header>`];
    cache.doc.blocks.forEach((block, b) => {
      const units = byBlock.get(b) || [];
      const sentences = units.map((unit) => `<span class="s" data-b="${unit.b}" data-s="${unit.s}">${escape(unit.text)}</span>`).join(" ");
      if (block.k === "h") parts.push(`<h3>${sentences || escape(block.t)}</h3>`);
      else if (block.k === "code") parts.push(units.length ? `<pre>${sentences}</pre>` : `<pre class="skipped" title="Code is skipped while reading. You can change this in Settings.">${escape(block.t)}</pre>`);
      else if (block.k === "li") parts.push(`<p class="li">${sentences}</p>`);
      else if (block.k === "q") parts.push(`<blockquote>${sentences}</blockquote>`);
      else parts.push(`<p>${sentences}</p>`);
    });
    els.reader.innerHTML = parts.join("");
    readerNow = null;
  }
  markReader(store.player.pos);
};

const markReader = (pos, wordIndex = -1, spoken = "") => {
  if (!pos || els.reader.hidden) return;
  const target = els.reader.querySelector(`.s[data-b="${pos.b}"][data-s="${pos.s}"]`) || els.reader.querySelector(".s");
  if (!target) return;
  if (readerNow && readerNow !== target) {
    readerNow.classList.remove("now");
    readerNow.textContent = readerNow.textContent;
  }
  target.classList.add("now");
  if (readerNow !== target) {
    readerNow = target;
    if (view === "reader" && Date.now() - userScrolledAt > 3500) target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  if (wordIndex >= 0) {
    const text = target.textContent;
    const words = text.split(/(\s+)/);
    const spokenWords = (spoken.match(/\S+/g) || []).length;
    const displayWords = (text.match(/\S+/g) || []).length;
    const index = Math.min(displayWords - 1, spokenWords === displayWords ? wordIndex : Math.round((wordIndex / Math.max(1, spokenWords)) * displayWords));
    let count = -1;
    target.innerHTML = words.map((part) => {
      if (!part.trim()) return escape(part);
      count += 1;
      return count === index ? `<mark>${escape(part)}</mark>` : escape(part);
    }).join("");
  }
};

els.reader.addEventListener("click", (event) => {
  const sentence = event.target.closest(".s");
  if (!sentence || !store.player.itemId) return;
  send("seek", store.player.itemId, Number(sentence.dataset.b), Number(sentence.dataset.s));
});
for (const type of ["wheel", "touchmove", "keydown"]) document.querySelector("main").addEventListener(type, () => (userScrolledAt = Date.now()), { passive: true });

const listFor = (element) => element.closest("#queueList") ? "queue" : "history";

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
    if (id === store.player.itemId) return selectTab("reader");
    return send("play", id);
  }
};

const focusRow = (row) => {
  const list = row.parentElement;
  for (const button of list.querySelectorAll(".row-main")) button.tabIndex = -1;
  const main = row.querySelector(".row-main");
  main.tabIndex = 0;
  main.focus({ preventScroll: false });
};

const onListKey = async (event) => {
  const row = event.target.closest(".row");
  if (!row || !event.target.classList.contains("row-main")) return;
  const rows = Array.from(row.parentElement.children);
  const index = rows.indexOf(row);
  const id = row.dataset.key;
  const item = findItem(store.queue, id);
  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && listFor(row) === "queue" && id !== store.player.itemId && !query) {
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
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) focusRow(next);
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
  if (!row || row.classList.contains("current")) return;
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
  const count = historyItems(store.queue).length;
  const snapshot = historyItems(store.queue);
  const docs = await chrome.storage.local.get(snapshot.map((item) => `doc:${item.id}`));
  await send("clearHistory");
  toast(`Cleared ${count} listened ${count === 1 ? "item" : "items"}`, {
    label: "Undo",
    run: async () => {
      for (const item of snapshot.reverse()) await send("restore", { item, doc: docs[`doc:${item.id}`], index: store.queue.items.length });
    }
  });
});

const tabs = Array.from(document.querySelectorAll("[role='tab']"));
const selectTab = (name, focus = false) => {
  view = name;
  for (const tab of tabs) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const panel of document.querySelectorAll("[role='tabpanel']")) panel.hidden = panel.id !== `view-${name}`;
  els.searchToggle.hidden = name === "reader";
  if (name === "reader") {
    userScrolledAt = 0;
    renderReader().then(() => readerNow?.scrollIntoView({ block: "center" }));
  }
};
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab.id.replace("tab-", "")));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      selectTab(next.id.replace("tab-", ""), true);
    }
  });
}

const toggleSearch = (open = els.searchBar.hidden) => {
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
$("#addMenu").addEventListener("click", openPaste);
$("#emptyAdd").addEventListener("click", openPaste);
els.pasteText.addEventListener("input", () => {
  const count = wordCount(els.pasteText.value);
  els.pasteCount.textContent = count ? `${count} words` : "";
  els.pasteAdd.disabled = count < 3;
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
  if (result.ok) toast(result.position === 0 ? "Added · plays first" : `Added · #${result.position + 1} in queue`, { label: "Undo", run: () => send("remove", result.item.id) });
});
$("#openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#keysClose").addEventListener("click", () => els.keysDialog.close());

document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]") || document.querySelector(".menu")) return;
  if (typing(event) || event.ctrlKey || event.metaKey) return;
  if (event.altKey) return;
  const onButton = event.target instanceof HTMLElement && event.target.closest("button, [role='tab']");
  const inList = event.target instanceof HTMLElement && event.target.closest(".rows");
  if (event.key === " " && !onButton) {
    event.preventDefault();
    send("toggle");
  } else if (event.key === "ArrowLeft" && !event.target.closest?.("[role='tab']")) send("skip", -1);
  else if (event.key === "ArrowRight" && !event.target.closest?.("[role='tab']")) send("skip", 1);
  else if (event.key.toLowerCase() === "n" && !inList) send("skipItem").then((result) => !result.ok && result.message && toast(result.message));
  else if (event.key === "-" || event.key === "[") player.changeRate(-0.1);
  else if (event.key === "=" || event.key === "+" || event.key === "]") player.changeRate(0.1);
  else if (event.key === "/") {
    event.preventDefault();
    if (view === "reader") selectTab("queue");
    toggleSearch(true);
  } else if (event.key === "1") selectTab("queue", true);
  else if (event.key === "2") selectTab("history", true);
  else if (event.key === "3") selectTab("reader", true);
  else if (event.key === "?") els.keysDialog.showModal();
});

const renderHealth = () => {
  const message = store.health?.storage;
  els.health.hidden = !message;
  if (message) {
    els.health.innerHTML = `${icon("alert", "sm")}<p></p>`;
    els.health.querySelector("p").textContent = message;
  }
};

function render(changed = new Set(["player", "queue", "settings", "stats", "health"]), snapshot = store) {
  store = snapshot;
  applyTheme(store.settings);
  player.update(store, changed);
  const playerOnly = changed.has("player") && !changed.has("queue") && !changed.has("settings");
  const sameItem = lastRendered.itemId === store.player.itemId && lastRendered.status === store.player.status;
  if (playerOnly && sameItem && !query) {
    const row = store.player.itemId && els.queueList.querySelector(`[data-key="${CSS.escape(store.player.itemId)}"]`);
    const item = row && findItem(store.queue, store.player.itemId);
    if (item) updateRow(row, item, 0, "queue");
  } else if (changed.has("queue") || changed.has("settings") || changed.has("player")) {
    renderQueue();
    if (changed.has("queue") || changed.has("settings")) renderHistory();
  }
  lastRendered = { itemId: store.player.itemId, status: store.player.status };
  if (changed.has("stats")) renderHistory();
  if (changed.has("health")) renderHealth();
  if (view === "reader" && (changed.has("player") || changed.has("queue") || changed.has("settings"))) renderReader();
}

connectSpeech((message) => {
  player.onSpeech(message);
  if (view !== "reader" || message.id !== store.player.itemId) return;
  if (message.t === "unit") markReader({ b: message.b, s: message.s });
  if (message.t === "word") markReader({ b: message.b, s: message.s }, wordIndexAt(message.spoken, message.c), message.spoken);
});

const commands = await chrome.commands.getAll();
const shortcuts = Object.fromEntries(commands.map((command) => [command.name, command.shortcut]));
$("#hintShortcut").innerHTML = shortcuts["queue-page"] ? `Press ${shortcuts["queue-page"].split("+").map((key) => `<kbd>${escape(key)}</kbd>`).join("")} on any article` : "Set a shortcut in chrome://extensions/shortcuts";
$("#globalKeys").innerHTML = [shortcuts["queue-page"] && `${shortcuts["queue-page"]} adds the current page`, shortcuts["toggle-playback"] && `${shortcuts["toggle-playback"]} plays or pauses`].filter(Boolean).map(escape).join(" · ") + (shortcuts["queue-page"] ? " — anywhere in Chrome." : "");

new ResizeObserver(() => document.body.style.setProperty("--np-h", els.player.hidden ? "0px" : `${els.player.offsetHeight}px`)).observe(els.player);
render();
renderHealth();
const params = new URLSearchParams(location.search);
if (params.get("view")) selectTab(params.get("view"));
