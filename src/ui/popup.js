import { findItem } from "../lib/queue.js";
import { wordCount } from "../lib/text.js";
import { $, applyTheme, connectSpeech, createStore, favicon, formatDuration, h, icon, isActive, itemRemaining, keyed, queuedItems, send, sourceLabel, typing } from "./common.js";
import { mountPlayer } from "./player.js";

const els = {
  player: $("#player"),
  intro: $("#intro"),
  page: $("#page"),
  pageFav: $(".page-fav"),
  pageTitle: $("#pageTitle"),
  pageMeta: $("#pageMeta"),
  pageActions: $("#pageActions"),
  next: $("#next"),
  nextList: $("#nextList"),
  nextTotal: $("#nextTotal"),
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
const player = mountPlayer(els.player);
let store = await createStore((changed, snapshot) => render(changed, snapshot));

const openPanel = async () => {
  try {
    await chrome.sidePanel.open({ windowId: tab?.windowId ?? (await chrome.windows.getCurrent()).id });
    window.close();
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("pages/panel.html") });
    window.close();
  }
};

$("#openPanel").addEventListener("click", openPanel);
$("#openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

const pageAction = (label, primary, run, iconName) => h("button", { class: `btn ${primary ? "btn-primary" : ""}`, type: "button", html: `${iconName ? icon(iconName, "sm") : ""}<span>${label}</span>`, onclick: run });

const renderPage = () => {
  const { queue, player: state } = store;
  els.page.setAttribute("aria-busy", String(!context));
  if (!context) return;
  const existing = context.existing ? findItem(queue, context.existing.id) : null;
  els.pageFav.replaceChildren(context.url ? favicon({ url: context.url }) : favicon({ source: "paste" }));
  els.pageActions.replaceChildren();
  if (confirmation) {
    els.pageTitle.textContent = confirmation.title;
    els.pageMeta.textContent = confirmation.message;
    if (confirmation.undo) els.pageActions.append(pageAction("Undo", false, confirmation.undo, "undo"));
    return;
  }
  if (!context.ok) {
    els.pageTitle.textContent = context.title || "This page";
    els.pageMeta.textContent = context.message;
    els.pageActions.append(pageAction("Paste text instead", false, () => togglePaste(true), "text"));
    return;
  }
  els.pageTitle.textContent = context.title;
  if (context.selectionWords >= 3) {
    els.pageMeta.textContent = `${context.selectionWords} words selected`;
    els.pageActions.append(pageAction("Add selection", true, () => capture("selection", "end"), "plus"), pageAction("Listen now", false, () => capture("selection", "now"), "play"));
    return;
  }
  if (existing) {
    const index = queuedItems(queue).findIndex((item) => item.id === existing.id);
    const isCurrent = existing.id === state.itemId;
    if (existing.status === "done") {
      els.pageMeta.textContent = "You’ve listened to this page";
      els.pageActions.append(pageAction("Listen again", false, () => send("play", existing.id), "play"));
    } else if (isCurrent) {
      els.pageMeta.textContent = isActive(state) ? "Playing now" : "Up first in your queue";
    } else {
      els.pageMeta.textContent = `In your queue · #${index + 1}`;
      els.pageActions.append(pageAction("Listen now", false, () => send("play", existing.id), "play"));
    }
    return;
  }
  els.pageMeta.textContent = context.readable ? context.site : `${context.site} · may not be an article`;
  els.pageActions.append(pageAction("Add to queue", true, () => capture("page", "end"), "plus"), pageAction("Listen now", false, () => capture("page", "now"), "play"));
};

const capture = async (mode, placement) => {
  for (const button of els.pageActions.querySelectorAll("button")) button.disabled = true;
  els.pageMeta.textContent = mode === "page" ? "Reading the page…" : "Adding selection…";
  const result = await send("capture", tab.id, mode, placement);
  if (!result.ok) {
    context = { ...context, ok: false, message: result.message || "Couldn’t read this page." };
    renderPage();
    return;
  }
  if (placement === "now") {
    await send("play", result.item.id);
    confirmation = null;
    context = { ...context, existing: result.item, selectionWords: 0 };
    renderPage();
    return;
  }
  const minutes = formatDuration(itemRemaining(result.item, store.settings, 0));
  confirmation = result.duplicate
    ? { title: result.item.title, message: `Already in your queue · #${result.position + 1}` }
    : { title: result.item.title, message: result.position === 0 ? `Added · ${minutes} · plays first` : `Added · ${minutes} · #${result.position + 1} in queue`, undo: async () => { await send("remove", result.item.id); confirmation = null; await refreshContext(); } };
  renderPage();
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
  els.pasteAdd.disabled = count < 3;
});
const addPaste = async () => {
  if (els.pasteAdd.disabled) return;
  const result = await send("addText", els.pasteText.value);
  if (!result.ok) return;
  els.pasteText.value = "";
  els.pasteAdd.disabled = true;
  els.pasteCount.textContent = "";
  togglePaste(false);
  confirmation = { title: result.item.title, message: result.position === 0 ? "Added · plays first" : `Added · #${result.position + 1} in queue`, undo: async () => { await send("remove", result.item.id); confirmation = null; renderPage(); } };
  renderPage();
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
  const { queue, player: state, settings } = store;
  const queued = queuedItems(queue);
  const upcoming = queued.filter((item) => item.id !== state.itemId);
  els.next.hidden = upcoming.length === 0;
  const total = upcoming.reduce((sum, item) => sum + itemRemaining(item, settings), 0);
  els.nextTotal.textContent = upcoming.length ? `${upcoming.length} · ${formatDuration(total)}` : "";
  keyed(els.nextList, upcoming.slice(0, 3), (item) => item.id, (item) => {
    const row = h("li", { class: "row" });
    row.innerHTML = `<span class="row-num"></span><button class="row-main" type="button"><span class="row-fav"></span><span class="row-text"><span class="row-title"></span><span class="meta row-meta"></span></span></button>`;
    row.querySelector(".row-main").addEventListener("click", () => send("play", row.dataset.key));
    return row;
  }, (row, item) => {
    const index = upcoming.indexOf(item);
    row.querySelector(".row-num").textContent = String(index + 1);
    if (row.dataset.title !== item.title) {
      row.dataset.title = item.title;
      row.querySelector(".row-fav").replaceChildren(favicon(item));
      row.querySelector(".row-title").textContent = item.title;
      row.querySelector(".row-main").setAttribute("aria-label", `Play ${item.title}`);
    }
    const left = itemRemaining(item, settings);
    row.querySelector(".row-meta").textContent = `${sourceLabel(item)} · ${item.progress > 0 ? `${formatDuration(left)} left` : formatDuration(left)}`;
  });
  els.more.hidden = upcoming.length <= 3;
  els.more.textContent = `See all ${queued.length} in the queue`;
};

els.more.addEventListener("click", openPanel);

const renderHealth = () => {
  const message = store.health?.storage;
  els.health.hidden = !message;
  if (message) els.health.innerHTML = `${icon("alert", "sm")}<p></p>`;
  if (message) els.health.querySelector("p").textContent = message;
};

function render(changed = new Set(["player", "queue", "settings", "health"]), snapshot = store) {
  store = snapshot;
  applyTheme(store.settings);
  const queued = queuedItems(store.queue);
  const hasCurrent = Boolean(store.player.itemId && findItem(store.queue, store.player.itemId));
  player.update(store, changed);
  els.intro.hidden = hasCurrent || queued.length > 0 || store.player.status === "completed";
  els.caughtUp.hidden = !(store.player.status === "completed" && !hasCurrent && !queued.length);
  if (changed.has("queue") || changed.has("player") || changed.has("settings")) {
    renderNext();
    renderPage();
  }
  if (changed.has("health")) renderHealth();
}

const refreshContext = async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  context = tab ? await send("context", tab.id) : { ok: false, message: "No page is open." };
  renderPage();
};

const setHint = async () => {
  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === "queue-page")?.shortcut;
  els.hint.innerHTML = shortcut ? `${shortcut.split("+").map((key) => `<kbd>${key}</kbd>`).join("")} adds any page` : "";
};

document.addEventListener("keydown", (event) => {
  if (typing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
  const onButton = event.target instanceof HTMLElement && event.target.closest("button");
  if (event.key === " " && !onButton) {
    event.preventDefault();
    send("toggle");
  } else if (event.key === "ArrowLeft") send("skip", -1);
  else if (event.key === "ArrowRight") send("skip", 1);
  else if (event.key === "-" || event.key === "[") player.changeRate(-0.1);
  else if (event.key === "=" || event.key === "+" || event.key === "]") player.changeRate(0.1);
});

connectSpeech((message) => player.onSpeech(message));
render();
renderHealth();
setHint();
refreshContext();
