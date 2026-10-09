import { findItem } from "../lib/queue.js";
import { MIN_SELECTION_WORDS, wordCount } from "../lib/text.js";
import { $, applyTheme, connectSpeech, createStore, escape, favicon, formatDuration, h, historyItems, icon, isActive, itemRemaining, keyed, queuedItems, renderHealth, send, typing } from "./common.js";
import { mountDeck } from "./deck.js";
import { createRow, updateRow } from "./rows.js";

const els = {
  deck: $("#deck"),
  welcome: $("#welcome"),
  here: $("#here"),
  hereFav: $("#hereFav"),
  hereTitle: $("#hereTitle"),
  hereMeta: $("#hereMeta"),
  hereActions: $("#hereActions"),
  next: $("#next"),
  nextList: $("#nextList"),
  nextMeta: $("#nextMeta"),
  more: $("#more"),
  caughtUp: $("#caughtUp"),
  paste: $("#paste"),
  pasteText: $("#pasteText"),
  pasteCount: $("#pasteCount"),
  pasteAdd: $("#pasteAdd"),
  pasteCancel: $("#pasteCancel"),
  pasteToggle: $("#pasteToggle"),
  health: $("#health"),
  hint: $("#shortcutHint")
};

$("#openPanel").innerHTML = icon("panel");
$("#openSettings").innerHTML = icon("sliders");
els.pasteToggle.innerHTML = `${icon("text", "sm")}<span>Paste text</span>`;

let tab = null;
let context = null;
let confirmation = null;
const deck = mountDeck(els.deck, { compact: true });
let store = await createStore((changed, snapshot) => render(changed, snapshot));

const openPanel = async () => {
  try {
    await chrome.sidePanel.open({ windowId: tab?.windowId ?? (await chrome.windows.getCurrent()).id });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("pages/panel.html") });
  }
  window.close();
};

$("#openPanel").addEventListener("click", openPanel);
$("#openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

const action = (label, primary, run, iconName) => h("button", { class: `btn ${primary ? "btn-primary" : ""}`, type: "button", html: `${iconName ? icon(iconName, "sm") : ""}<span>${escape(label)}</span>`, onclick: run });

const renderHere = () => {
  const { queue, player } = store;
  els.here.setAttribute("aria-busy", String(!context));
  if (!context) return;
  const existing = context.existing ? findItem(queue, context.existing.id) : null;
  els.hereFav.replaceChildren(favicon(context.url ? { url: context.url } : { source: "paste" }));
  els.hereActions.replaceChildren();
  els.hereMeta.classList.remove("ok");
  if (confirmation) {
    els.hereTitle.textContent = confirmation.title;
    els.hereMeta.textContent = confirmation.message;
    els.hereMeta.classList.add("ok");
    if (confirmation.undo) els.hereActions.append(action("Undo", false, confirmation.undo, "undo"));
    return;
  }
  if (!context.ok) {
    els.hereTitle.textContent = context.title || "This page";
    els.hereMeta.textContent = context.message;
    els.hereActions.append(action("Paste text instead", false, () => togglePaste(true), "text"));
    return;
  }
  els.hereTitle.textContent = context.title;
  if (context.selectionWords >= MIN_SELECTION_WORDS) {
    els.hereMeta.textContent = `${context.selectionWords} words selected on this page`;
    els.hereActions.append(action("Add selection", true, () => capture("selection", "end"), "plus"), action("Listen now", false, () => capture("selection", "now"), "play"));
    return;
  }
  if (existing) {
    const index = queuedItems(queue).findIndex((item) => item.id === existing.id);
    if (existing.status === "done") {
      els.hereMeta.textContent = "You’ve listened to this page";
      els.hereActions.append(action("Listen again", false, () => send("play", existing.id), "play"));
    } else if (existing.id === player.itemId) {
      els.hereMeta.textContent = isActive(player) ? "Playing now" : "Up first in your queue";
    } else {
      els.hereMeta.textContent = `In your queue · #${index + 1}`;
      els.hereActions.append(action("Listen now", false, () => send("play", existing.id), "play"));
    }
    return;
  }
  els.hereMeta.textContent = context.readable ? context.site : `${context.site} · may not be an article`;
  els.hereActions.append(action("Add to queue", true, () => capture("page", "end"), "plus"), action("Listen now", false, () => capture("page", "now"), "play"));
};

const capture = async (mode, placement) => {
  for (const button of els.hereActions.querySelectorAll("button")) button.disabled = true;
  els.hereMeta.textContent = mode === "page" ? "Reading the page…" : "Adding the selection…";
  const result = await send("capture", tab.id, mode, placement);
  if (!result.ok) {
    context = { ...context, ok: false, message: result.message || "Couldn’t read this page." };
    renderHere();
    return;
  }
  if (placement === "now") {
    await send("play", result.item.id);
    confirmation = null;
    context = { ...context, existing: result.item, selectionWords: 0 };
    renderHere();
    return;
  }
  const minutes = formatDuration(itemRemaining(result.item, store.settings, 0));
  confirmation = result.duplicate
    ? { title: result.item.title, message: `Already in your queue · #${result.position + 1}` }
    : {
        title: result.item.title,
        message: result.position === 0 ? `Added · ${minutes} · plays first` : `Added · ${minutes} · #${result.position + 1} in the queue`,
        undo: async () => {
          await send("remove", result.item.id);
          confirmation = null;
          await refreshContext();
        }
      };
  renderHere();
};

const togglePaste = (open = els.paste.hidden) => {
  els.paste.hidden = !open;
  els.pasteToggle.setAttribute("aria-expanded", String(open));
  if (open) els.pasteText.focus();
};

els.pasteToggle.addEventListener("click", () => togglePaste());
els.pasteCancel.addEventListener("click", () => togglePaste(false));
els.pasteText.addEventListener("input", () => {
  const count = wordCount(els.pasteText.value);
  els.pasteCount.textContent = count ? `${count} words` : "";
  els.pasteAdd.disabled = count < MIN_SELECTION_WORDS;
});
const addPaste = async () => {
  if (els.pasteAdd.disabled) return;
  const result = await send("addText", els.pasteText.value);
  if (!result.ok) return;
  els.pasteText.value = "";
  els.pasteAdd.disabled = true;
  els.pasteCount.textContent = "";
  togglePaste(false);
  confirmation = { title: result.item.title, message: result.position === 0 ? "Added · plays first" : `Added · #${result.position + 1} in the queue`, undo: async () => { await send("remove", result.item.id); confirmation = null; renderHere(); } };
  renderHere();
};
els.pasteAdd.addEventListener("click", addPaste);
els.pasteText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") addPaste();
  if (event.key === "Escape") {
    event.stopPropagation();
    togglePaste(false);
  }
});

const renderNext = () => {
  const queued = queuedItems(store.queue);
  const upcoming = queued.filter((item) => item.id !== store.player.itemId);
  els.next.hidden = upcoming.length === 0;
  const total = upcoming.reduce((sum, item) => sum + itemRemaining(item, store.settings), 0);
  els.nextMeta.textContent = upcoming.length ? `${upcoming.length} · ${formatDuration(total)}` : "";
  keyed(els.nextList, upcoming.slice(0, 2), (item) => item.id, createRow, (row, item) => updateRow(row, item, { kind: "next", index: upcoming.indexOf(item) + 1, store }));
  els.nextList.classList.toggle("rail", Math.min(2, upcoming.length) > 1);
  els.more.hidden = upcoming.length <= 2;
  els.more.textContent = `All ${upcoming.length}`;
};

els.nextList.addEventListener("click", (event) => {
  const row = event.target.closest(".row");
  if (!row) return;
  const id = row.dataset.key;
  if (event.target.closest("[data-act='menu']")) return openPanel();
  send("play", id);
});
els.more.addEventListener("click", openPanel);

function render(changed = new Set(["player", "queue", "settings", "health"]), snapshot = store) {
  store = snapshot;
  applyTheme(store.settings);
  const queued = queuedItems(store.queue);
  const hasCurrent = Boolean(store.player.itemId && findItem(store.queue, store.player.itemId));
  deck.update(store, changed);
  els.welcome.hidden = hasCurrent || queued.length > 0 || historyItems(store.queue).length > 0;
  els.caughtUp.hidden = hasCurrent || queued.length > 0 || historyItems(store.queue).length === 0;
  if (!els.caughtUp.hidden) els.caughtUp.textContent = "You’re all caught up. Add this page, or anything else, and it plays next.";
  if (changed.has("queue") || changed.has("player") || changed.has("settings")) {
    renderNext();
    renderHere();
  }
  if (changed.has("health")) renderHealth(els.health, store.health);
}

const refreshContext = async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  context = tab ? await send("context", tab.id) : { ok: false, message: "No page is open." };
  renderHere();
};

const setHint = async () => {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === "queue-page")?.shortcut;
  els.hint.innerHTML = shortcut ? `${shortcut.split("+").map((key) => `<kbd>${escape(key)}</kbd>`).join("")} adds any page` : "";
};

document.addEventListener("keydown", (event) => {
  if (typing(event) || event.altKey || event.ctrlKey || event.metaKey || document.querySelector(":popover-open")) return;
  const onButton = event.target instanceof HTMLElement && event.target.closest("button, [role='slider']");
  if (event.key === " " && !onButton) {
    event.preventDefault();
    send("toggle");
  } else if (event.key === "ArrowLeft") send("skip", -1);
  else if (event.key === "ArrowRight") send("skip", 1);
  else if (event.key === "-" || event.key === "[") deck.slower();
  else if (event.key === "=" || event.key === "+" || event.key === "]") deck.faster();
});

connectSpeech((message) => deck.onSpeech(message));
render();
renderHealth(els.health, store.health);
setHint();
refreshContext();
