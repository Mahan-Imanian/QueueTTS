import { historyItems, queuedItems } from "../lib/queue.js";
import { KEYS, normalizePlayer, normalizeQueue, normalizeSettings, normalizeStats, readAll } from "../lib/store.js";
import { CPS_DEFAULT, formatDuration, localDay, remainingSeconds } from "../lib/text.js";

export { formatDuration, historyItems, queuedItems };

export const $ = (selector, root = document) => root.querySelector(selector);

export const send = async (name, ...args) => {
  try {
    return (await chrome.runtime.sendMessage({ type: "cmd", name, args })) || { ok: false };
  } catch (error) {
    return { ok: false, message: error?.message || "QueueTTS isn't responding. Reload the extension." };
  }
};

export const icon = (name, size = "") => `<svg class="i ${size}" aria-hidden="true"><use href="../assets/icons.svg#${name}"></use></svg>`;

export const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
};

export const faviconUrl = (url) => {
  if (!url) return "";
  const target = new URL(chrome.runtime.getURL("/_favicon/"));
  target.searchParams.set("pageUrl", url);
  target.searchParams.set("size", "32");
  return target.toString();
};

export const favicon = (item) => {
  if (item?.url) {
    const image = h("img", { class: "favicon", src: faviconUrl(item.url), alt: "", width: 16, height: 16, loading: "lazy" });
    return image;
  }
  return h("span", { class: "favicon blank", html: icon(item?.source === "sample" ? "reader" : "text", "sm") });
};

export const applyTheme = (settings) => {
  const theme = settings?.theme || "system";
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};

export const itemRemaining = (item, settings, playerProgress) => {
  const progress = playerProgress ?? item.progress ?? 0;
  return remainingSeconds(item.chars, progress, settings.rate, settings.cps || CPS_DEFAULT);
};

export const sourceLabel = (item) => (item.source === "selection" ? "Selection" : item.source === "paste" ? "Pasted text" : item.source === "sample" ? "QueueTTS" : item.site || "Web page");

export const statusText = (player) => ({
  playing: "Playing",
  preparing: "Starting…",
  recovering: "Resuming…",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Finished",
  error: "Couldn’t play",
  idle: "Ready"
})[player.status] || "Ready";

export const isActive = (player) => ["playing", "preparing", "recovering"].includes(player.status);

export const weekSummary = (stats) => {
  const now = new Date();
  let ms = 0;
  let finished = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = stats.days[localDay(now.getTime() - offset * 86400000)];
    if (day) {
      ms += day.ms || 0;
      finished += day.finished || 0;
    }
  }
  return { ms, finished };
};

export const createStore = async (onChange) => {
  const snapshot = await readAll();
  const session = await chrome.storage.session.get("health").catch(() => ({}));
  snapshot.health = session.health || {};
  chrome.storage.onChanged.addListener((changes, area) => {
    const changed = new Set();
    if (area === "local") {
      if (changes[KEYS.settings]) {
        snapshot.settings = normalizeSettings(changes[KEYS.settings].newValue);
        changed.add("settings");
      }
      if (changes[KEYS.queue]) {
        snapshot.queue = normalizeQueue(changes[KEYS.queue].newValue);
        changed.add("queue");
      }
      if (changes[KEYS.player]) {
        snapshot.player = normalizePlayer(changes[KEYS.player].newValue);
        snapshot.player.progress = Number(changes[KEYS.player].newValue?.progress) || 0;
        changed.add("player");
      }
      if (changes[KEYS.stats]) {
        snapshot.stats = normalizeStats(changes[KEYS.stats].newValue);
        changed.add("stats");
      }
    }
    if (area === "session" && changes.health) {
      snapshot.health = changes.health.newValue || {};
      changed.add("health");
    }
    if (changed.size) onChange(changed, snapshot);
  });
  const raw = await chrome.storage.local.get(KEYS.player);
  snapshot.player.progress = Number(raw[KEYS.player]?.progress) || 0;
  return snapshot;
};

export const connectSpeech = (onMessage) => {
  let port;
  const open = () => {
    port = chrome.runtime.connect({ name: "ui" });
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => setTimeout(open, 500));
  };
  open();
};

export const keyed = (container, items, key, create, update) => {
  const existing = new Map();
  for (const child of Array.from(container.children)) if (child.dataset.key) existing.set(child.dataset.key, child);
  let cursor = container.firstElementChild;
  const seen = new Set();
  for (const item of items) {
    const id = key(item);
    seen.add(id);
    let node = existing.get(id);
    if (!node) {
      node = create(item);
      node.dataset.key = id;
      node.classList.add("enter");
    }
    update(node, item);
    if (node !== cursor) container.insertBefore(node, cursor);
    else cursor = cursor.nextElementSibling;
  }
  for (const [id, node] of existing) {
    if (!seen.has(id)) {
      if (node.contains(document.activeElement)) {
        const fallback = node.nextElementSibling || node.previousElementSibling;
        node.remove();
        fallback?.querySelector("button, [tabindex='0']")?.focus({ preventScroll: true });
      } else node.remove();
    }
  }
};

let toastTimer = 0;
export const toast = (message, action) => {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const node = h("div", { class: "toast", role: "status" }, h("span", { text: message }));
  if (action) node.append(h("button", { class: "btn", type: "button", text: action.label, onclick: () => { node.remove(); action.run(); } }));
  document.body.append(node);
  toastTimer = setTimeout(() => node.remove(), action ? 6000 : 2800);
  announce(message);
};

export const announce = (message) => {
  let region = document.getElementById("live");
  if (!region) {
    region = h("div", { id: "live", class: "sr-only", "aria-live": "polite" });
    document.body.append(region);
  }
  region.textContent = "";
  setTimeout(() => (region.textContent = message), 30);
};

export const openMenu = (anchor, entries) => {
  closeMenu();
  const menu = h("div", { class: "menu", role: "menu" });
  for (const entry of entries) {
    if (entry === "-") {
      menu.append(h("hr"));
      continue;
    }
    menu.append(h("button", { type: "button", role: "menuitem", class: entry.danger ? "danger" : "", html: `${icon(entry.icon, "sm")}<span>${escape(entry.label)}</span>`, onclick: () => { closeMenu(); anchor.focus({ preventScroll: true }); entry.run(); } }));
  }
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
  menu.style.top = `${rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4}px`;
  const buttons = Array.from(menu.querySelectorAll("button"));
  buttons[0]?.focus();
  menu.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown") buttons[(index + 1) % buttons.length].focus();
    else if (event.key === "ArrowUp") buttons[(index - 1 + buttons.length) % buttons.length].focus();
    else if (event.key === "Escape" || event.key === "Tab") {
      closeMenu();
      anchor.focus({ preventScroll: true });
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });
  setTimeout(() => document.addEventListener("pointerdown", outside, { once: true }));
  function outside(event) {
    if (!menu.contains(event.target)) closeMenu();
  }
};

export const closeMenu = () => document.querySelector(".menu")?.remove();

export const typing = (event) => {
  const target = event.target;
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
};

export const speedLabel = (rate) => `${(Math.round(Number(rate) * 10) / 10).toFixed(1)}×`;

export const stepRate = (rate, delta) => Math.round(Math.min(3, Math.max(0.5, rate + delta)) * 10) / 10;

export const renderSentence = (container, text, wordIndex = -1) => {
  if (wordIndex < 0) {
    container.textContent = text;
    return;
  }
  const parts = String(text).split(/(\s+)/);
  let count = -1;
  container.innerHTML = parts.map((part) => {
    if (!part.trim()) return escape(part);
    count += 1;
    return count === wordIndex ? `<mark>${escape(part)}</mark>` : escape(part);
  }).join("");
};
