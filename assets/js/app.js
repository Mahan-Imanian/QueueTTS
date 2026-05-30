const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const STORAGE_KEY = "queuetts:premium:v1";
const DAILY_KEY = "queuetts:daily:v1";
const MIN_TEXT_LENGTH = 8;

const storage = (() => {
  try {
    const key = "queuetts:storage-test";
    window.storage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return window.localStorage;
  } catch {
    const memory = new Map();
    return {
      getItem: (key) => memory.has(key) ? memory.get(key) : null,
      setItem: (key, value) => { memory.set(key, String(value)); },
      removeItem: (key) => { memory.delete(key); }
    };
  }
})();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const data = new Uint32Array(4);
  crypto.getRandomValues(data);
  return Array.from(data, (n) => n.toString(16)).join("-");
};
const now = () => Date.now();
const htmlEscape = (text) => String(text).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
const debounce = (fn, wait) => {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const defaultState = () => ({
  settings: {
    theme: "system",
    contrast: "normal",
    motion: "full",
    voiceURI: "",
    rate: 1,
    skip: 15,
    dictRaw: "",
    dictPairs: [],
    compact: false
  },
  queue: [],
  playback: {
    status: "idle",
    itemId: "",
    sentenceIndex: 0,
    elapsed: 0,
    total: 0,
    spoken: "Add an item to start listening.",
    active: false,
    error: ""
  },
  sleep: {
    mode: "off",
    endAt: 0,
    endOfItem: false
  },
  ui: {
    addMode: "paste",
    query: "",
    editItemId: ""
  }
});

const safeJSON = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

const dayKey = () => new Date().toISOString().slice(0, 10);

const defaultDaily = () => ({
  day: dayKey(),
  listened: 0,
  finished: 0,
  history: []
});

const loadDaily = () => {
  const stored = safeJSON(storage.getItem(DAILY_KEY), null);
  const d = stored && typeof stored === "object" ? { ...defaultDaily(), ...stored } : defaultDaily();
  if (d.day !== dayKey()) {
    const history = Array.isArray(d.history) ? d.history.slice(-20) : [];
    history.push({ day: d.day, listened: Number(d.listened) || 0, finished: Number(d.finished) || 0 });
    return { ...defaultDaily(), history: history.slice(-30) };
  }
  d.listened = Number(d.listened) || 0;
  d.finished = Number(d.finished) || 0;
  d.history = Array.isArray(d.history) ? d.history.slice(-30) : [];
  return d;
};

const saveDaily = () => storage.setItem(DAILY_KEY, JSON.stringify(daily));

const parseDict = (raw) => {
  const pairs = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=>");
    if (idx === -1) continue;
    const left = trimmed.slice(0, idx).trim();
    const right = trimmed.slice(idx + 2).trim();
    if (left) pairs.push([left, right]);
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyDict = (text, pairs) => {
  let output = String(text || "");
  for (const [from, to] of pairs) {
    try {
      output = output.replace(new RegExp(escapeRegExp(from), "g"), to);
    } catch {
      output = output.split(from).join(to);
    }
  }
  return output;
};

const normalizeItem = (item) => ({
  id: typeof item.id === "string" ? item.id : uid(),
  title: String(item.title || "Untitled").trim() || "Untitled",
  text: String(item.text || "").trim(),
  createdAt: Number(item.createdAt) || now(),
  source: item.source && typeof item.source === "object" ? item.source : { type: "paste" },
  languageHint: typeof item.languageHint === "string" ? item.languageHint : "",
  headingMode: ["cue", "pause", "off"].includes(item.headingMode) ? item.headingMode : "cue"
});

const loadState = () => {
  const base = defaultState();
  const stored = safeJSON(storage.getItem(STORAGE_KEY), null);
  if (!stored || typeof stored !== "object") return base;
  if (stored.settings && typeof stored.settings === "object") base.settings = { ...base.settings, ...stored.settings };
  if (Array.isArray(stored.queue)) base.queue = stored.queue.map(normalizeItem).filter((item) => item.text.length >= MIN_TEXT_LENGTH);
  if (stored.sleep && typeof stored.sleep === "object") base.sleep = { ...base.sleep, ...stored.sleep };
  if (stored.playback && typeof stored.playback === "object") {
    base.playback.itemId = typeof stored.playback.itemId === "string" ? stored.playback.itemId : "";
    base.playback.sentenceIndex = Number(stored.playback.sentenceIndex) || 0;
  }
  base.settings.rate = clamp(Number(base.settings.rate) || 1, 0.75, 2);
  base.settings.skip = [10, 15, 30].includes(Number(base.settings.skip)) ? Number(base.settings.skip) : 15;
  base.settings.dictPairs = parseDict(base.settings.dictRaw || "");
  base.playback.status = "idle";
  base.playback.active = false;
  base.playback.spoken = "Add an item to start listening.";
  return base;
};

let state = loadState();
let daily = loadDaily();
let saveTimer = 0;
let sleepTimer = 0;
let activityTimer = 0;
let voices = [];
let confirmHandler = null;

const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snapshot = {
      settings: state.settings,
      queue: state.queue,
      sleep: state.sleep,
      playback: {
        itemId: state.playback.itemId,
        sentenceIndex: state.playback.sentenceIndex
      }
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, 140);
};

const setState = (updater, render = true) => {
  state = typeof updater === "function" ? updater(state) : { ...state, ...updater };
  persist();
  if (render) renderAll();
};

const fmtTime = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
};

const wordCount = (text) => (String(text || "").match(/[\p{L}\p{N}]+/gu) || []).length;

const estimateSpeechSeconds = (text, rate = 1) => {
  const words = wordCount(text);
  const wpm = 182 * clamp(rate, 0.75, 2);
  return clamp((words / Math.max(60, wpm)) * 60, 0.35, 180);
};

const isHeadingLine = (line) => {
  const value = line.trim();
  if (!value) return false;
  if (/^#{1,6}\s+\S+/.test(value)) return true;
  if (value.length < 76 && /^[A-Z0-9][A-Z0-9\s:;,.&()'"\-]+$/.test(value) && /[A-Z]/.test(value)) return true;
  return false;
};

const splitSentences = (text) => String(text || "")
  .replace(/\s+/g, " ")
  .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“‘([\p{L}])/gu)
  .map((part) => part.trim())
  .filter(Boolean);

const segmentText = (text, headingMode = "cue") => {
  const lines = String(text || "").replace(/\r/g, "").split("\n").map((line) => line.replace(/[ \t]+/g, " ").trim());
  const units = [];
  let buffer = [];
  const flush = () => {
    const value = buffer.join(" ").trim();
    buffer = [];
    if (!value) return;
    for (const sentence of splitSentences(value)) units.push({ type: "speech", text: sentence });
  };
  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (headingMode !== "off" && isHeadingLine(line)) {
      flush();
      const clean = line.replace(/^#{1,6}\s+/, "").trim();
      if (headingMode === "cue") units.push({ type: "speech", text: `Heading. ${clean}.` });
      if (headingMode === "pause") {
        units.push({ type: "speech", text: clean });
        units.push({ type: "pause", ms: 700 });
      }
      continue;
    }
    buffer.push(line);
  }
  flush();
  return units.length ? units : [{ type: "speech", text: String(text || "").trim() }];
};

const timelineFor = (units, rate = 1) => {
  let start = 0;
  return units.map((unit, index) => {
    const duration = unit.type === "pause" ? clamp((unit.ms || 0) / 1000, 0.15, 3) : estimateSpeechSeconds(unit.text, rate);
    const row = { index, start, duration, end: start + duration };
    start += duration;
    return row;
  });
};

const itemUnits = (item) => segmentText(applyDict(item.text, state.settings.dictPairs), item.headingMode);
const itemEstimate = (item) => timelineFor(itemUnits(item), state.settings.rate).reduce((sum, row) => sum + row.duration, 0);

const cleanText = (input) => String(input || "")
  .replace(/\r/g, "")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{4,}/g, "\n\n\n")
  .replace(/[ \t]{2,}/g, " ")
  .replace(/\u00a0/g, " ")
  .trim();

const titleFromText = (text) => {
  const first = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || "Untitled";
  return first.length > 86 ? `${first.slice(0, 83)}...` : first;
};

const titleFromUrl = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "URL item"; }
};

const activeItem = () => state.queue.find((item) => item.id === state.playback.itemId) || null;
const activeIndex = () => state.queue.findIndex((item) => item.id === state.playback.itemId);

const toast = (() => {
  const timers = new Map();
  const remove = (id) => {
    const node = $(`[data-toast-id="${id}"]`);
    if (node) node.remove();
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const push = ({ title, message = "", kind = "success", timeout = 3600 }) => {
    const host = $("#toastStack");
    const id = uid();
    const node = document.createElement("div");
    node.className = `toast toast--${kind}`;
    node.dataset.toastId = id;
    node.innerHTML = `<div class="toast__row"><div><div class="toast__title">${htmlEscape(title)}</div><div class="toast__msg">${htmlEscape(message)}</div></div><button class="button button--ghost" type="button">Dismiss</button></div>`;
    $("button", node).addEventListener("click", () => remove(id));
    host.append(node);
    if (timeout > 0) timers.set(id, setTimeout(() => remove(id), timeout));
    return id;
  };
  return { push, remove };
})();

const say = (message) => {
  const live = $("#ariaLive");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
};

class SpeechQueueEngine {
  constructor() {
    this.units = [];
    this.timeline = [];
    this.item = null;
    this.index = 0;
    this.active = false;
    this.paused = false;
    this.intentionalCancel = false;
    this.startedAt = 0;
    this.pauseTimer = 0;
    this.raf = 0;
    this.utterance = null;
  }

  supports() {
    return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  cancelTick() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop(silent = true) {
    this.intentionalCancel = true;
    clearTimeout(this.pauseTimer);
    this.cancelTick();
    if (this.supports()) window.speechSynthesis.cancel();
    this.active = false;
    this.paused = false;
    this.utterance = null;
    if (!silent) {
      state.playback.active = false;
      state.playback.status = "idle";
      state.playback.spoken = "Stopped.";
      renderAll();
    }
    setTimeout(() => { this.intentionalCancel = false; }, 120);
  }

  play(item, index = 0) {
    if (!item) return;
    if (!this.supports()) {
      state.playback.status = "error";
      state.playback.error = "SpeechSynthesis is not available in this browser.";
      renderAll();
      toast.push({ kind: "error", title: "Speech unavailable", message: "Use a browser with Web Speech support." });
      return;
    }
    this.stop(true);
    this.item = item;
    this.units = itemUnits(item);
    this.timeline = timelineFor(this.units, state.settings.rate);
    this.index = clamp(Math.floor(index) || 0, 0, Math.max(0, this.units.length - 1));
    this.active = true;
    this.paused = false;
    state.playback = {
      status: "playing",
      itemId: item.id,
      sentenceIndex: this.index,
      elapsed: this.timeline[this.index]?.start || 0,
      total: this.timeline.at(-1)?.end || 0,
      spoken: this.units[this.index]?.text || "Playing.",
      active: true,
      error: ""
    };
    renderAll();
    say(`Playing ${item.title}`);
    this.runCurrent();
  }

  runCurrent() {
    if (!this.active || !this.item) return;
    if (this.index >= this.units.length) {
      this.finishItem();
      return;
    }
    const unit = this.units[this.index];
    state.playback.sentenceIndex = this.index;
    state.playback.elapsed = this.timeline[this.index]?.start || 0;
    state.playback.total = this.timeline.at(-1)?.end || 0;
    state.playback.spoken = unit.type === "pause" ? "Pause." : unit.text;
    state.playback.status = "playing";
    state.playback.active = true;
    renderAll();
    if (unit.type === "pause") {
      this.pauseTimer = setTimeout(() => {
        this.index += 1;
        this.runCurrent();
      }, unit.ms || 650);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(unit.text);
    const selected = voices.find((voice) => voice.voiceURI === state.settings.voiceURI);
    if (selected) utterance.voice = selected;
    utterance.rate = clamp(Number(state.settings.rate) || 1, 0.75, 2);
    if (this.item.languageHint) utterance.lang = this.item.languageHint;
    utterance.onstart = () => {
      this.startedAt = performance.now();
      this.startTick();
    };
    utterance.onboundary = (event) => {
      if (!this.active || this.paused) return;
      const row = this.timeline[this.index];
      const ratio = unit.text.length ? clamp((Number(event.charIndex) || 0) / unit.text.length, 0, 1) : 0;
      state.playback.elapsed = (row?.start || 0) + (row?.duration || 0) * ratio;
      renderProgressOnly();
    };
    utterance.onend = () => {
      this.cancelTick();
      if (!this.active) return;
      this.index += 1;
      this.runCurrent();
    };
    utterance.onerror = (event) => {
      this.cancelTick();
      if (this.intentionalCancel || ["canceled", "interrupted"].includes(event.error)) return;
      this.active = false;
      state.playback.status = "error";
      state.playback.active = false;
      state.playback.error = event.error || "Speech failed.";
      renderAll();
      toast.push({ kind: "error", title: "Playback failed", message: state.playback.error });
    };
    this.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  startTick() {
    this.cancelTick();
    const tick = () => {
      if (!this.active || this.paused) return;
      const row = this.timeline[this.index];
      if (row) {
        const played = (performance.now() - this.startedAt) / 1000;
        state.playback.elapsed = clamp(row.start + played, row.start, row.end);
        renderProgressOnly();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.active || this.paused) return;
    this.paused = true;
    clearTimeout(this.pauseTimer);
    if (this.supports()) window.speechSynthesis.pause();
    state.playback.status = "paused";
    state.playback.active = false;
    renderAll();
    say("Paused");
  }

  resume() {
    if (!this.active || !this.paused) return;
    this.paused = false;
    if (this.supports()) window.speechSynthesis.resume();
    state.playback.status = "playing";
    state.playback.active = true;
    renderAll();
    say("Playing");
    this.startTick();
  }

  seekSeconds(delta) {
    const item = activeItem();
    if (!item) return;
    const units = itemUnits(item);
    const timeline = timelineFor(units, state.settings.rate);
    const current = state.playback.elapsed || timeline[state.playback.sentenceIndex]?.start || 0;
    const target = clamp(current + delta, 0, timeline.at(-1)?.end || 0);
    const found = timeline.find((row) => target >= row.start && target <= row.end) || timeline.at(-1);
    if (this.active && !this.paused) this.play(item, found?.index || 0);
    else {
      state.playback.itemId = item.id;
      state.playback.sentenceIndex = found?.index || 0;
      state.playback.elapsed = found?.start || 0;
      state.playback.total = timeline.at(-1)?.end || 0;
      state.playback.spoken = units[found?.index || 0]?.text || item.title;
      renderAll();
    }
  }

  jumpSentence(offset) {
    const item = activeItem();
    if (!item) return;
    const units = itemUnits(item);
    const next = clamp((state.playback.sentenceIndex || 0) + offset, 0, Math.max(0, units.length - 1));
    if (this.active && !this.paused) this.play(item, next);
    else {
      const timeline = timelineFor(units, state.settings.rate);
      state.playback.sentenceIndex = next;
      state.playback.elapsed = timeline[next]?.start || 0;
      state.playback.total = timeline.at(-1)?.end || 0;
      state.playback.spoken = units[next]?.text || item.title;
      renderAll();
    }
  }

  finishItem() {
    this.active = false;
    this.paused = false;
    const finishedId = this.item?.id || "";
    daily.finished += 1;
    saveDaily();
    state.playback.status = "idle";
    state.playback.active = false;
    state.playback.elapsed = state.playback.total;
    state.playback.spoken = "Item finished.";
    renderAll();
    if (state.sleep.endOfItem) {
      setSleepOff();
      toast.push({ kind: "success", title: "Sleep timer complete", message: "Playback stopped at the end of the item." });
      return;
    }
    const idx = state.queue.findIndex((item) => item.id === finishedId);
    const next = state.queue[idx + 1];
    if (next) this.play(next, 0);
    else toast.push({ title: "Queue complete", message: "All items have finished." });
  }
}

const engine = new SpeechQueueEngine();

const setStatus = (stateName, label) => {
  const chip = $("#statusChip");
  chip.dataset.state = stateName;
  chip.textContent = label;
};

const renderProgressOnly = () => {
  const total = Math.max(0, Number(state.playback.total) || 0);
  const elapsed = clamp(Number(state.playback.elapsed) || 0, 0, total || 0);
  const pct = total ? clamp((elapsed / total) * 100, 0, 100) : 0;
  $("#progressFill").style.width = `${pct}%`;
  $("#progressBar").setAttribute("aria-valuenow", String(Math.round(pct)));
  $("#elapsedTime").textContent = fmtTime(elapsed);
  $("#remainingTime").textContent = `-${fmtTime(Math.max(0, total - elapsed))}`;
};

const renderNowPlaying = () => {
  const item = activeItem();
  $("#heroQueueCount").textContent = String(state.queue.length);
  $("#heroDone").textContent = String(daily.finished);
  const totalEstimate = state.queue.reduce((sum, entry) => sum + itemEstimate(entry), 0);
  $("#heroEstimate").textContent = fmtTime(totalEstimate);
  $("#nowTitle").textContent = item?.title || "Nothing queued";
  $("#nowStatus").textContent = item ? `${wordCount(item.text).toLocaleString()} words · ${fmtTime(itemEstimate(item))} estimate` : "Add text or fetch a URL to begin.";
  $("#spokenText").textContent = state.playback.spoken || "Add an item to start listening.";
  const unitCount = item ? itemUnits(item).length : 0;
  $("#sentenceLabel").textContent = item ? `Segment ${Math.min((state.playback.sentenceIndex || 0) + 1, unitCount)} of ${unitCount}` : "Ready";
  $("#playPause").textContent = state.playback.status === "playing" ? "Pause" : "Play";
  if (state.playback.status === "playing") setStatus("playing", "Playing");
  else if (state.playback.status === "paused") setStatus("paused", "Paused");
  else if (state.playback.status === "error") setStatus("error", "Error");
  else setStatus("idle", "Idle");
  renderProgressOnly();
};

const queueItemNode = (item, index) => {
  const units = itemUnits(item);
  const est = timelineFor(units, state.settings.rate).at(-1)?.end || 0;
  const node = document.createElement("article");
  node.className = `queue-item${item.id === state.playback.itemId ? " is-active" : ""}`;
  node.role = "listitem";
  node.tabIndex = 0;
  node.draggable = true;
  node.dataset.id = item.id;

  const sourceLabel = item.source?.type === "url" ? "URL" : "Paste";
  node.innerHTML = `
    <div class="queue-item__head">
      <div>
        <h3>${htmlEscape(item.title)}</h3>
        <div class="queue-item__meta">
          <span>${index + 1}</span>
          <span>${sourceLabel}</span>
          <span>${wordCount(item.text).toLocaleString()} words</span>
          <span>${units.length} segments</span>
          <span>${fmtTime(est)}</span>
        </div>
      </div>
      <button class="button button--primary" type="button" data-action="play">Play</button>
    </div>
    <p>${htmlEscape(item.text.replace(/\s+/g, " ").slice(0, 280))}</p>
    <div class="queue-item__actions" aria-label="Actions for ${htmlEscape(item.title)}">
      <button class="button button--ghost" type="button" data-action="edit">Edit</button>
      <button class="button button--ghost" type="button" data-action="duplicate">Duplicate</button>
      <button class="button button--ghost" type="button" data-action="up">Up</button>
      <button class="button button--ghost" type="button" data-action="down">Down</button>
      <button class="button button--danger" type="button" data-action="remove">Remove</button>
    </div>`;

  node.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "play") playItem(item.id);
    if (action === "edit") openEdit(item.id);
    if (action === "duplicate") duplicateItem(item.id);
    if (action === "up") moveItem(item.id, -1);
    if (action === "down") moveItem(item.id, 1);
    if (action === "remove") removeItem(item.id);
  });

  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      playItem(item.id);
    }
  });

  node.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
  });

  node.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  node.addEventListener("drop", (event) => {
    event.preventDefault();
    const from = event.dataTransfer.getData("text/plain");
    if (from && from !== item.id) moveItemTo(from, item.id);
  });

  return node;
};

const renderQueue = () => {
  const host = $("#queueList");
  const empty = $("#queueEmpty");
  const query = state.ui.query.trim().toLowerCase();
  const list = query ? state.queue.filter((item) => `${item.title} ${item.text}`.toLowerCase().includes(query)) : state.queue;
  host.textContent = "";
  $(".queue-card").classList.toggle("is-compact", Boolean(state.settings.compact));
  empty.classList.toggle("hidden", list.length > 0);
  if (!list.length) return;
  const cap = state.settings.compact ? 240 : 120;
  list.slice(0, cap).forEach((item, index) => host.append(queueItemNode(item, state.queue.indexOf(item))));
  if (list.length > cap) {
    const more = document.createElement("div");
    more.className = "empty-state";
    more.innerHTML = `<strong>${list.length - cap} more items hidden</strong><span>Use search or compact mode to refine the rendered queue.</span>`;
    host.append(more);
  }
};

const renderStats = () => {
  const totalWords = state.queue.reduce((sum, item) => sum + wordCount(item.text), 0);
  const totalSegments = state.queue.reduce((sum, item) => sum + itemUnits(item).length, 0);
  $("#listenedToday").textContent = fmtTime(daily.listened);
  $("#finishedToday").textContent = String(daily.finished);
  $("#wordsQueued").textContent = totalWords.toLocaleString();
  $("#segmentsQueued").textContent = totalSegments.toLocaleString();
  $("#dailyDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
};

const renderSparkline = () => {
  const svg = $("#sparkline");
  const values = state.queue.slice(0, 18).map((item) => itemEstimate(item));
  svg.textContent = "";
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `<linearGradient id="sparkGradient" x1="0" y1="0" x2="1" y2="0"><stop stop-color="var(--primary)"/><stop offset=".55" stop-color="var(--primary-2)"/><stop offset="1" stop-color="var(--primary-3)"/></linearGradient>`;
  svg.append(defs);
  if (!values.length) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "160");
    text.setAttribute("y", "50");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "currentColor");
    text.setAttribute("opacity", ".45");
    text.textContent = "Queue activity appears here";
    svg.append(text);
    return;
  }
  const max = Math.max(...values, 1);
  const width = 320;
  const height = 92;
  const pad = 10;
  const step = values.length === 1 ? 0 : (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : pad + index * step;
    const y = height - pad - (value / max) * (height - pad * 2);
    return [x, y];
  });
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" "));
  svg.append(path);
  for (const [x, y] of points) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", x.toFixed(2));
    circle.setAttribute("cy", y.toFixed(2));
    circle.setAttribute("r", "3.2");
    svg.append(circle);
  }
};

const applyTheme = () => {
  const root = document.documentElement;
  const theme = state.settings.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : state.settings.theme;
  root.dataset.theme = theme;
  root.dataset.contrast = state.settings.contrast;
  root.dataset.motion = state.settings.motion;
  $("#themeToggle").textContent = state.settings.theme === "system" ? "Theme: System" : `Theme: ${state.settings.theme}`;
  $("#contrastToggle").textContent = state.settings.contrast === "high" ? "Contrast: High" : "Contrast";
  $("#motionToggle").textContent = state.settings.motion === "reduced" ? "Motion: Reduced" : "Motion";
};

const renderControls = () => {
  $("#rateRange").value = String(state.settings.rate);
  $("#rateValue").textContent = `${Number(state.settings.rate).toFixed(2)}x`;
  $("#skipSelect").value = String(state.settings.skip);
  $("#dictInput").value = state.settings.dictRaw || "";
  $("#toggleCompact").textContent = state.settings.compact ? "Comfort" : "Compact";
  $("#sleepSelect").value = state.sleep.endOfItem ? "end" : state.sleep.mode === "minutes" ? String(Math.max(5, Math.round((state.sleep.endAt - now()) / 60000))) : "off";
  if (state.sleep.endOfItem) $("#sleepLabel").textContent = "Sleep timer: end of item";
  else if (state.sleep.mode === "minutes" && state.sleep.endAt > now()) $("#sleepLabel").textContent = `Sleep timer: ${fmtTime((state.sleep.endAt - now()) / 1000)}`;
  else $("#sleepLabel").textContent = "Sleep timer off";
};

const renderTabs = () => {
  const pasteActive = state.ui.addMode === "paste";
  $("#tabPaste").classList.toggle("is-active", pasteActive);
  $("#tabPaste").setAttribute("aria-selected", String(pasteActive));
  $("#pastePane").classList.toggle("hidden", !pasteActive);
  $("#tabUrl").classList.toggle("is-active", !pasteActive);
  $("#tabUrl").setAttribute("aria-selected", String(!pasteActive));
  $("#urlPane").classList.toggle("hidden", pasteActive);
};

const renderPasteStats = () => {
  const raw = $("#pasteInput").value;
  const text = $("#cleanupToggle").checked ? cleanText(raw) : raw.trim();
  $("#pasteStats").textContent = `${text.length.toLocaleString()} characters · ${fmtTime(estimateSpeechSeconds(text, state.settings.rate))} estimate`;
};

const renderAll = () => {
  applyTheme();
  renderTabs();
  renderControls();
  renderNowPlaying();
  renderQueue();
  renderStats();
  renderSparkline();
  renderPasteStats();
};

const loadVoices = () => new Promise((resolve) => {
  if (!engine.supports()) {
    resolve([]);
    return;
  }
  const done = () => resolve(window.speechSynthesis.getVoices() || []);
  const current = window.speechSynthesis.getVoices();
  if (current.length) {
    resolve(current);
    return;
  }
  window.speechSynthesis.onvoiceschanged = done;
  setTimeout(done, 1000);
});

const renderVoiceOptions = (query = "") => {
  const select = $("#voiceSelect");
  const needle = query.trim().toLowerCase();
  const filtered = needle ? voices.filter((voice) => `${voice.name} ${voice.lang}`.toLowerCase().includes(needle)) : voices;
  select.textContent = "";
  if (!filtered.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = voices.length ? "No matching voices" : "No browser voices available";
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const voice of filtered) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    select.append(option);
  }
  if (state.settings.voiceURI && filtered.some((voice) => voice.voiceURI === state.settings.voiceURI)) select.value = state.settings.voiceURI;
  else {
    const preferred = filtered.find((voice) => /^en[-_]/i.test(voice.lang)) || filtered[0];
    state.settings.voiceURI = preferred.voiceURI;
    select.value = preferred.voiceURI;
    persist();
  }
};

const initVoices = async () => {
  voices = await loadVoices();
  renderVoiceOptions($("#voiceSearch").value || "");
  if (!voices.length && engine.supports()) toast.push({ kind: "warning", title: "No voices loaded", message: "Browser voices may appear after the page is reloaded." });
};

const setAddMode = (mode) => {
  state.ui.addMode = mode === "url" ? "url" : "paste";
  persist();
  renderTabs();
};

const createItem = ({ text, title, source, languageHint, headingMode }) => normalizeItem({
  id: uid(),
  title,
  text,
  createdAt: now(),
  source,
  languageHint,
  headingMode
});

const addPaste = () => {
  const source = $("#pasteInput").value;
  const text = $("#cleanupToggle").checked ? cleanText(source) : source.trim();
  if (text.length < MIN_TEXT_LENGTH) {
    toast.push({ kind: "error", title: "Text is too short", message: "Paste at least a sentence before adding it to the queue." });
    $("#pasteInput").focus();
    return;
  }
  const item = createItem({
    text,
    title: titleFromText(text),
    source: { type: "paste" },
    languageHint: $("#pasteLanguage").value.trim(),
    headingMode: $("#pasteHeadingMode").value
  });
  state.queue.push(item);
  if (!state.playback.itemId) state.playback.itemId = item.id;
  $("#pasteInput").value = "";
  setState((s) => s);
  toast.push({ title: "Added to queue", message: item.title });
  say("Item added to queue");
};

const extractReadableText = (html, url) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, svg, canvas, iframe, form, nav, footer, aside").forEach((node) => node.remove());
  const title = doc.querySelector("title")?.textContent?.trim() || titleFromUrl(url);
  const candidates = [doc.querySelector("article"), doc.querySelector("main"), doc.body].filter(Boolean);
  const best = candidates.sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
  const text = cleanText((best?.textContent || "").replace(/\n\s*\n/g, "\n\n"));
  return { title: title.length > 90 ? `${title.slice(0, 87)}...` : title, text };
};

const addUrl = async () => {
  const input = $("#urlInput");
  const url = input.value.trim();
  let parsed;
  try { parsed = new URL(url); } catch {
    toast.push({ kind: "error", title: "Invalid URL", message: "Enter a complete http or https URL." });
    input.focus();
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    toast.push({ kind: "error", title: "Unsupported URL", message: "Only http and https URLs can be fetched." });
    input.focus();
    return;
  }
  const button = $("#addUrl");
  const status = $("#urlStatus");
  button.disabled = true;
  status.textContent = "Fetching article...";
  try {
    const response = await fetch(parsed.href, { mode: "cors" });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    const html = await response.text();
    const extracted = extractReadableText(html, parsed.href);
    if (extracted.text.length < MIN_TEXT_LENGTH) throw new Error("No readable article text was found.");
    const item = createItem({
      text: extracted.text,
      title: extracted.title,
      source: { type: "url", url: parsed.href },
      languageHint: $("#urlLanguage").value.trim(),
      headingMode: $("#urlHeadingMode").value
    });
    state.queue.push(item);
    if (!state.playback.itemId) state.playback.itemId = item.id;
    input.value = "";
    status.textContent = "Added.";
    setState((s) => s);
    toast.push({ title: "URL added", message: item.title });
  } catch (error) {
    status.textContent = "Fetch failed. Paste the article text instead.";
    toast.push({ kind: "error", title: "Could not fetch URL", message: error.message || "The site may block browser extraction." });
  } finally {
    button.disabled = false;
  }
};

const playItem = (id) => {
  const item = state.queue.find((entry) => entry.id === id) || state.queue[0];
  if (!item) {
    toast.push({ kind: "warning", title: "Queue is empty", message: "Add an item before playing." });
    return;
  }
  engine.play(item, item.id === state.playback.itemId ? state.playback.sentenceIndex : 0);
};

const togglePlay = () => {
  if (engine.active && !engine.paused) {
    engine.pause();
    return;
  }
  if (engine.active && engine.paused) {
    engine.resume();
    return;
  }
  playItem(state.playback.itemId || state.queue[0]?.id || "");
};

const nextItem = () => {
  if (!state.queue.length) return;
  const idx = activeIndex();
  const item = state.queue[clamp(idx + 1, 0, state.queue.length - 1)] || state.queue[0];
  engine.play(item, 0);
};

const prevItem = () => {
  if (!state.queue.length) return;
  const idx = activeIndex();
  const item = state.queue[clamp(idx - 1, 0, state.queue.length - 1)] || state.queue[0];
  engine.play(item, 0);
};

const moveItem = (id, direction) => {
  const index = state.queue.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.queue.length) return;
  const queue = state.queue.slice();
  const [item] = queue.splice(index, 1);
  queue.splice(target, 0, item);
  setState((s) => ({ ...s, queue }));
};

const moveItemTo = (fromId, toId) => {
  const from = state.queue.findIndex((item) => item.id === fromId);
  const to = state.queue.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const queue = state.queue.slice();
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item);
  setState((s) => ({ ...s, queue }));
};

const duplicateItem = (id) => {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return;
  const copy = normalizeItem({ ...item, id: uid(), title: `${item.title} copy`, createdAt: now() });
  const index = state.queue.findIndex((entry) => entry.id === id);
  const queue = state.queue.slice();
  queue.splice(index + 1, 0, copy);
  setState((s) => ({ ...s, queue }));
  toast.push({ title: "Duplicated", message: copy.title });
};

const removeItem = (id) => {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return;
  askConfirm({
    title: "Remove item?",
    message: `Remove "${item.title}" from the queue?`,
    actionLabel: "Remove",
    onConfirm: () => {
      if (state.playback.itemId === id) engine.stop(true);
      const queue = state.queue.filter((entry) => entry.id !== id);
      const nextId = state.playback.itemId === id ? queue[0]?.id || "" : state.playback.itemId;
      setState((s) => ({ ...s, queue, playback: { ...s.playback, itemId: nextId, status: "idle", active: false } }));
      toast.push({ title: "Removed", message: item.title });
    }
  });
};

const clearQueue = () => {
  if (!state.queue.length) return;
  askConfirm({
    title: "Clear queue?",
    message: "Remove every queued item and stop playback.",
    actionLabel: "Clear queue",
    onConfirm: () => {
      engine.stop(true);
      setState((s) => ({ ...s, queue: [], playback: { ...defaultState().playback } }));
      toast.push({ title: "Queue cleared", message: "All items were removed." });
    }
  });
};

const openEdit = (id) => {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return;
  state.ui.editItemId = id;
  $("#editTitleInput").value = item.title;
  $("#editTextInput").value = item.text;
  const dialog = $("#editDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
};

const saveEdit = () => {
  const id = state.ui.editItemId;
  const title = $("#editTitleInput").value.trim() || "Untitled";
  const text = cleanText($("#editTextInput").value);
  if (text.length < MIN_TEXT_LENGTH) {
    toast.push({ kind: "error", title: "Text is too short", message: "The item was not changed." });
    state.ui.editItemId = "";
    renderAll();
    return;
  }
  const queue = state.queue.map((item) => item.id === id ? { ...item, title, text } : item);
  if (id === state.playback.itemId) engine.stop(true);
  setState((s) => ({ ...s, queue, ui: { ...s.ui, editItemId: "" }, playback: id === s.playback.itemId ? { ...s.playback, status: "idle", active: false, sentenceIndex: 0, elapsed: 0, spoken: "Item updated. Press play to resume." } : s.playback }));
  toast.push({ title: "Saved", message: title });
};

const exportQueue = () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "QueueTTS",
    version: 1,
    settings: { rate: state.settings.rate, skip: state.settings.skip, dictRaw: state.settings.dictRaw },
    queue: state.queue
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `queuetts-export-${dayKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  toast.push({ title: "Export ready", message: "Queue JSON downloaded." });
};

const importQueue = async (file) => {
  const raw = await file.text();
  const data = safeJSON(raw, null);
  const incoming = Array.isArray(data) ? data : Array.isArray(data?.queue) ? data.queue : [];
  if (!incoming.length) throw new Error("The file does not contain a QueueTTS queue.");
  const normalized = incoming.map(normalizeItem).filter((item) => item.text.length >= MIN_TEXT_LENGTH);
  if (!normalized.length) throw new Error("No valid queue items were found.");
  setState((s) => ({ ...s, queue: [...s.queue, ...normalized], playback: { ...s.playback, itemId: s.playback.itemId || normalized[0].id } }));
  toast.push({ title: "Imported", message: `${normalized.length} items added.` });
};

const saveDictionary = () => {
  const raw = $("#dictInput").value;
  state.settings.dictRaw = raw;
  state.settings.dictPairs = parseDict(raw);
  setState((s) => s);
  toast.push({ title: "Dictionary saved", message: `${state.settings.dictPairs.length} replacements active.` });
};

const setRate = (value) => {
  state.settings.rate = clamp(Number(value) || 1, 0.75, 2);
  if (activeItem()) {
    const item = activeItem();
    const units = itemUnits(item);
    const timeline = timelineFor(units, state.settings.rate);
    state.playback.total = timeline.at(-1)?.end || 0;
    state.playback.elapsed = timeline[state.playback.sentenceIndex]?.start || 0;
  }
  setState((s) => s);
};

const setSkip = (value) => {
  state.settings.skip = [10, 15, 30].includes(Number(value)) ? Number(value) : 15;
  setState((s) => s);
};

const setSleepOff = () => {
  clearTimeout(sleepTimer);
  state.sleep = { mode: "off", endAt: 0, endOfItem: false };
  persist();
  renderControls();
};

const startSleepTicker = () => {
  clearTimeout(sleepTimer);
  if (state.sleep.mode === "minutes" && state.sleep.endAt > now()) {
    sleepTimer = setTimeout(() => {
      engine.pause();
      setSleepOff();
      toast.push({ title: "Sleep timer complete", message: "Playback paused." });
    }, state.sleep.endAt - now());
  } else if (state.sleep.mode === "minutes") {
    setSleepOff();
  }
  renderControls();
};

const setSleep = () => {
  const value = $("#sleepSelect").value;
  if (value === "off") {
    setSleepOff();
    toast.push({ title: "Sleep timer off" });
    return;
  }
  if (value === "end") {
    clearTimeout(sleepTimer);
    state.sleep = { mode: "end", endAt: 0, endOfItem: true };
    persist();
    renderControls();
    toast.push({ title: "Sleep timer set", message: "Playback will stop after the current item." });
    return;
  }
  const minutes = Number(value);
  state.sleep = { mode: "minutes", endAt: now() + minutes * 60000, endOfItem: false };
  persist();
  startSleepTicker();
  toast.push({ title: "Sleep timer set", message: `${minutes} minutes.` });
};

const cycleTheme = () => {
  const order = ["system", "dark", "light"];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  setState((s) => s);
};

const toggleContrast = () => {
  state.settings.contrast = state.settings.contrast === "high" ? "normal" : "high";
  setState((s) => s);
};

const toggleMotion = () => {
  state.settings.motion = state.settings.motion === "reduced" ? "full" : "reduced";
  setState((s) => s);
};

const toggleFocusMode = () => {
  document.body.classList.toggle("focus-mode");
  toast.push({ title: document.body.classList.contains("focus-mode") ? "Focus mode on" : "Focus mode off" });
};

const toggleShortcuts = () => {
  const panel = $("#shortcuts");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) $("#shortcutsClose").focus();
};

const askConfirm = ({ title, message, actionLabel, onConfirm }) => {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmAccept").textContent = actionLabel || "Continue";
  confirmHandler = onConfirm;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else if (window.confirm(message)) onConfirm();
};

const actions = [
  { label: "Play or pause", keys: "Space", run: togglePlay },
  { label: "Next item", keys: "N", run: nextItem },
  { label: "Previous item", keys: "P", run: prevItem },
  { label: "Next sentence", keys: "K", run: () => engine.jumpSentence(1) },
  { label: "Previous sentence", keys: "J", run: () => engine.jumpSentence(-1) },
  { label: "Toggle focus mode", keys: "F", run: toggleFocusMode },
  { label: "Export queue", keys: "", run: exportQueue },
  { label: "Clear queue", keys: "", run: clearQueue },
  { label: "Save dictionary", keys: "", run: saveDictionary },
  { label: "Toggle theme", keys: "", run: cycleTheme },
  { label: "Toggle contrast", keys: "", run: toggleContrast },
  { label: "Toggle motion", keys: "", run: toggleMotion }
];

const renderCommands = () => {
  const query = $("#cmdkSearch").value.trim().toLowerCase();
  const host = $("#cmdkList");
  const list = query ? actions.filter((item) => item.label.toLowerCase().includes(query)) : actions;
  host.textContent = "";
  for (const action of list) {
    const button = document.createElement("button");
    button.className = "command-item";
    button.type = "button";
    button.innerHTML = `<strong>${htmlEscape(action.label)}</strong><span>${htmlEscape(action.keys)}</span>`;
    button.addEventListener("click", () => {
      $("#cmdkDialog").close();
      action.run();
    });
    host.append(button);
  }
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<strong>No matching commands</strong><span>Try a different action name.</span>";
    host.append(empty);
  }
};

const openCommands = () => {
  renderCommands();
  const dialog = $("#cmdkDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  $("#cmdkSearch").value = "";
  renderCommands();
  setTimeout(() => $("#cmdkSearch").focus(), 30);
};

const isTypingTarget = (node) => {
  if (!node) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) || node.isContentEditable;
};

const recordListening = () => {
  clearInterval(activityTimer);
  activityTimer = setInterval(() => {
    if (state.playback.status !== "playing") return;
    daily.listened += 1;
    saveDaily();
    $("#listenedToday").textContent = fmtTime(daily.listened);
  }, 1000);
};

const wire = () => {
  $("#themeToggle").addEventListener("click", cycleTheme);
  $("#contrastToggle").addEventListener("click", toggleContrast);
  $("#motionToggle").addEventListener("click", toggleMotion);
  $("#shortcutsToggle").addEventListener("click", toggleShortcuts);
  $("#shortcutsClose").addEventListener("click", toggleShortcuts);
  $("#cmdkOpen").addEventListener("click", openCommands);
  $("#cmdkSearch").addEventListener("input", renderCommands);

  $("#playPause").addEventListener("click", togglePlay);
  $("#nextItem").addEventListener("click", nextItem);
  $("#prevItem").addEventListener("click", prevItem);
  $("#nextSentence").addEventListener("click", () => engine.jumpSentence(1));
  $("#prevSentence").addEventListener("click", () => engine.jumpSentence(-1));
  $$(".seekers [data-seek]").forEach((button) => button.addEventListener("click", () => engine.seekSeconds(Number(button.dataset.seek) || 0)));

  $("#tabPaste").addEventListener("click", () => setAddMode("paste"));
  $("#tabUrl").addEventListener("click", () => setAddMode("url"));
  $("#pasteInput").addEventListener("input", renderPasteStats);
  $("#cleanupToggle").addEventListener("change", renderPasteStats);
  $("#addPaste").addEventListener("click", addPaste);
  $("#addUrl").addEventListener("click", addUrl);

  $("#voiceSearch").addEventListener("input", debounce((event) => renderVoiceOptions(event.target.value || ""), 120));
  $("#voiceSelect").addEventListener("change", (event) => {
    state.settings.voiceURI = event.target.value;
    setState((s) => s);
  });
  $("#rateRange").addEventListener("input", (event) => setRate(event.target.value));
  $$(".rate-ticks [data-rate]").forEach((button) => button.addEventListener("click", () => setRate(button.dataset.rate)));
  $("#skipSelect").addEventListener("change", (event) => setSkip(event.target.value));
  $("#sleepStart").addEventListener("click", setSleep);
  $("#sleepCancel").addEventListener("click", () => { setSleepOff(); toast.push({ title: "Sleep timer off" }); });
  $("#saveDict").addEventListener("click", saveDictionary);

  $("#queueSearch").addEventListener("input", debounce((event) => {
    state.ui.query = event.target.value || "";
    renderQueue();
  }, 80));
  $("#toggleCompact").addEventListener("click", () => {
    state.settings.compact = !state.settings.compact;
    setState((s) => s);
  });
  $("#exportQueue").addEventListener("click", exportQueue);
  $("#importQueue").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { await importQueue(file); } catch (error) { toast.push({ kind: "error", title: "Import failed", message: error.message || "Invalid file." }); }
  });
  $("#clearQueue").addEventListener("click", clearQueue);
  $("#focusMode").addEventListener("click", toggleFocusMode);

  $("#editDialog").addEventListener("close", () => {
    if ($("#editDialog").returnValue === "save") saveEdit();
    else {
      state.ui.editItemId = "";
      renderAll();
    }
  });

  $("#confirmDialog").addEventListener("close", () => {
    const handler = confirmHandler;
    confirmHandler = null;
    if ($("#confirmDialog").returnValue === "confirm" && typeof handler === "function") handler();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!$("#shortcuts").classList.contains("hidden")) $("#shortcuts").classList.add("hidden");
      if (document.body.classList.contains("focus-mode")) document.body.classList.remove("focus-mode");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommands();
      return;
    }
    if (isTypingTarget(document.activeElement) || $("#cmdkDialog").open || $("#editDialog").open || $("#confirmDialog").open) return;
    if (event.key === " ") { event.preventDefault(); togglePlay(); }
    if (event.key.toLowerCase() === "j") { event.preventDefault(); engine.jumpSentence(-1); }
    if (event.key.toLowerCase() === "k") { event.preventDefault(); engine.jumpSentence(1); }
    if (event.key.toLowerCase() === "n") { event.preventDefault(); nextItem(); }
    if (event.key.toLowerCase() === "p") { event.preventDefault(); prevItem(); }
    if (event.key === ",") { event.preventDefault(); engine.seekSeconds(-state.settings.skip); }
    if (event.key === ".") { event.preventDefault(); engine.seekSeconds(state.settings.skip); }
    if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFocusMode(); }
    if (event.key === "?") { event.preventDefault(); toggleShortcuts(); }
  });

  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (state.settings.theme === "system") applyTheme();
  });
};

const boot = async () => {
  if (!engine.supports()) {
    state.playback.status = "error";
    state.playback.error = "SpeechSynthesis is not available in this browser.";
    state.playback.spoken = "SpeechSynthesis is not available in this browser.";
  }
  wire();
  renderAll();
  startSleepTicker();
  recordListening();
  await initVoices();
  renderAll();
};

boot().catch((error) => {
  console.error(error);
  toast.push({ kind: "error", title: "App failed to start", message: error.message || "Unexpected startup error." });
});
