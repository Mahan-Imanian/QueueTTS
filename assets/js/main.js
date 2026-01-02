const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const uid = () => crypto.getRandomValues(new Uint32Array(4)).join("-");
const now = () => Date.now();

const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};

const isTypingTarget = (el) => {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

const debounce = (fn, ms) => {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const STORAGE_KEY = "queuetts:v3";
const DAILY_KEY = "queuetts:daily:v1";

const defaultState = () => ({
  v: 3,
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
    isPlaying: false,
    itemId: "",
    sentenceIndex: 0,
    estElapsed: 0,
    estTotal: 0,
    spoken: "Ready.",
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
    focusedItemId: "",
    editItemId: "",
    sessionListenedSec: 0
  }
});

const safeParseJSON = (txt) => {
  try { return { ok: true, value: JSON.parse(txt) }; } catch { return { ok: false, value: null }; }
};

const loadState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  const p = safeParseJSON(raw);
  if (!p.ok || !p.value || typeof p.value !== "object") return defaultState();
  const d = defaultState();
  const s = p.value;

  const out = d;
  if (s && typeof s === "object") {
    if (s.settings && typeof s.settings === "object") out.settings = { ...out.settings, ...s.settings };
    if (Array.isArray(s.queue)) out.queue = s.queue.filter(isValidItem).map(normalizeItem);
    if (s.sleep && typeof s.sleep === "object") out.sleep = { ...out.sleep, ...s.sleep };
  }
  out.settings.dictPairs = parseDict(out.settings.dictRaw || "");
  return out;
};

const saveState = (state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const isValidItem = (x) => {
  if (!x || typeof x !== "object") return false;
  if (typeof x.id !== "string" || typeof x.title !== "string" || typeof x.text !== "string") return false;
  return true;
};

const normalizeItem = (it) => ({
  id: it.id,
  title: it.title,
  text: it.text,
  createdAt: typeof it.createdAt === "number" ? it.createdAt : now(),
  source: it.source && typeof it.source === "object" ? it.source : { type: "paste" },
  languageHint: typeof it.languageHint === "string" ? it.languageHint : "",
  headingMode: it.headingMode === "cue" || it.headingMode === "pause" || it.headingMode === "off" ? it.headingMode : "cue"
});

const createStore = (initial) => {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set: (updater) => {
      const next = typeof updater === "function" ? updater(state) : updater;
      state = next;
      subs.forEach((fn) => fn(state));
    },
    patch: (partial) => {
      state = { ...state, ...partial };
      subs.forEach((fn) => fn(state));
    },
    sub: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    }
  };
};

const toasts = (() => {
  const host = $("#toastStack");
  const timers = new Map();

  const remove = (id) => {
    const el = host.querySelector(`[data-toast-id="${id}"]`);
    if (el) el.remove();
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
  };

  const push = ({ title, message, kind = "success", timeout = 3200, actions = [] }) => {
    const id = uid();
    const el = document.createElement("div");
    el.className = `toast toast--${kind}`;
    el.dataset.toastId = id;

    const row = document.createElement("div");
    row.className = "toast__row";

    const left = document.createElement("div");
    const t = document.createElement("div");
    t.className = "toast__title";
    t.textContent = title || "";
    const m = document.createElement("div");
    m.className = "toast__msg";
    m.textContent = message || "";
    left.appendChild(t);
    left.appendChild(m);

    const close = document.createElement("button");
    close.className = "button button--ghost";
    close.type = "button";
    close.textContent = "Dismiss";
    close.addEventListener("click", () => remove(id));

    row.appendChild(left);
    row.appendChild(close);

    el.appendChild(row);

    if (actions.length) {
      const act = document.createElement("div");
      act.className = "toast__actions";
      for (const a of actions) {
        const b = document.createElement("button");
        b.className = "button button--ghost";
        b.type = "button";
        b.textContent = a.label;
        b.addEventListener("click", () => {
          try { a.onClick?.(); } finally { remove(id); }
        });
        act.appendChild(b);
      }
      el.appendChild(act);
    }

    host.appendChild(el);
    if (timeout > 0) timers.set(id, setTimeout(() => remove(id), timeout));
    return id;
  };

  return { push, remove };
})();

const ariaSay = (txt) => {
  const el = $("#ariaLive");
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = txt; });
};

const parseDict = (raw) => {
  const lines = String(raw || "").split(/\r?\n/);
  const pairs = [];
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    const idx = s.indexOf("=>");
    if (idx === -1) continue;
    const from = s.slice(0, idx).trim();
    const to = s.slice(idx + 2).trim();
    if (!from) continue;
    pairs.push([from, to]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const applyDict = (text, dictPairs) => {
  let out = text;
  for (const [from, to] of dictPairs) {
    try {
      const re = new RegExp(escapeRegExp(from), "g");
      out = out.replace(re, to);
    } catch {
      out = out.split(from).join(to);
    }
  }
  return out;
};

const quickCleanup = (text) => {
  let t = String(text || "");
  t = t.replace(/\r/g, "");
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{4,}/g, "\n\n\n");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t.trim();
};

const guessTitleFromText = (text) => {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "Untitled";
  const first = lines[0].replace(/\s+/g, " ").trim();
  return first.length > 80 ? first.slice(0, 77) + "…" : first;
};

const safeUrlTitle = (url) => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "URL item";
  }
};

const isHeadingLine = (line) => {
  const s = line.trim();
  if (!s) return false;
  if (/^#{1,6}\s+\S+/.test(s)) return true;
  if (s.length <= 72 && /^[A-Z0-9][A-Z0-9\s:;,.&()'"-]+$/.test(s) && /[A-Z]/.test(s)) return true;
  return false;
};

const splitIntoUnits = (text, headingMode) => {
  const rawLines = String(text || "").split(/\r?\n/);
  const lines = rawLines.map((l) => l.replace(/\s+/g, " ").trim());
  const units = [];
  const pushSpeech = (t) => {
    const s = t.trim();
    if (!s) return;
    const parts = s
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“‘(\[])/g)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) units.push({ type: "speech", text: p });
  };

  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    pushSpeech(buf.join(" "));
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) {
      flush();
      continue;
    }
    if (headingMode !== "off" && isHeadingLine(ln)) {
      flush();
      const clean = ln.replace(/^#{1,6}\s+/, "").trim();
      if (headingMode === "cue") {
        units.push({ type: "speech", text: `Heading. ${clean}.` });
      } else if (headingMode === "pause") {
        units.push({ type: "speech", text: clean });
        units.push({ type: "pause", ms: 650 });
      }
      continue;
    }
    buf.push(ln);
  }
  flush();

  const filtered = [];
  for (const u of units) {
    if (u.type === "speech") {
      const t = String(u.text || "").trim();
      if (!t) continue;
      filtered.push({ type: "speech", text: t });
    } else if (u.type === "pause") {
      const ms = typeof u.ms === "number" ? u.ms : 500;
      filtered.push({ type: "pause", ms: clamp(ms, 120, 2500) });
    }
  }
  return filtered.length ? filtered : [{ type: "speech", text: "" }];
};

const estimateSecondsForSpeech = (text, rate) => {
  const t = String(text || "");
  const words = (t.match(/\b\w+\b/g) || []).length;
  const wpmBase = 185;
  const wpm = wpmBase * clamp(rate || 1, 0.75, 2);
  const minutes = words / Math.max(60, wpm);
  const s = minutes * 60;
  return clamp(s, 0.25, 120);
};

const estimateUnitSeconds = (unit, rate) => {
  if (unit.type === "pause") return clamp((unit.ms || 0) / 1000, 0.12, 2.5);
  return estimateSecondsForSpeech(unit.text, rate);
};

class TTSEngine {
  constructor({ onEvent }) {
    this.onEvent = onEvent;
    this.voices = [];
    this.voiceByURI = new Map();
    this.ready = false;

    this.active = false;
    this.paused = false;

    this.item = null;
    this.units = [];
    this.timeline = [];
    this.total = 0;

    this.unitIndex = 0;
    this.unitStartedAt = 0;
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;

    this._sleepDelayTimer = 0;
    this._tickRaf = 0;
  }

  supports() {
    return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  async initVoices() {
    if (!this.supports()) {
      this.ready = false;
      return [];
    }
    const synth = window.speechSynthesis;
    const read = () => {
      const v = synth.getVoices() || [];
      this.voices = v.slice().sort((a, b) => (a.lang || "").localeCompare(b.lang || "") || (a.name || "").localeCompare(b.name || ""));
      this.voiceByURI.clear();
      for (const x of this.voices) this.voiceByURI.set(x.voiceURI, x);
      this.ready = true;
      return this.voices;
    };

    const initial = read();
    if (initial.length) return initial;

    await new Promise((res) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; res(); } }, 1200);
      synth.onvoiceschanged = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res();
      };
    });
    return read();
  }

  pickVoice(uri) {
    if (!uri) return null;
    return this.voiceByURI.get(uri) || null;
  }

  stop() {
    this._clearTimers();
    this.active = false;
    this.paused = false;
    this.item = null;
    this.units = [];
    this.timeline = [];
    this.total = 0;
    this.unitIndex = 0;
    this.unitStartedAt = 0;
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;
    if (this.supports()) window.speechSynthesis.cancel();
    this.onEvent({ type: "stopped" });
  }

  pause() {
    if (!this.supports()) return;
    if (!this.active) return;
    window.speechSynthesis.pause();
    this.paused = true;
    this.onEvent({ type: "paused" });
  }

  resume() {
    if (!this.supports()) return;
    if (!this.active) return;
    window.speechSynthesis.resume();
    this.paused = false;
    this.onEvent({ type: "resumed" });
  }

  prepare({ item, rate, dictPairs }) {
    const cleaned = applyDict(item.text || "", dictPairs || []);
    const units = splitIntoUnits(cleaned, item.headingMode || "cue");
    const timeline = units.map((u) => estimateUnitSeconds(u, rate));
    const total = timeline.reduce((a, b) => a + b, 0);
    return { units, timeline, total };
  }

  play({ item, startIndex, voiceURI, rate }) {
    if (!this.supports()) {
      this.onEvent({ type: "error", message: "SpeechSynthesis is not available in this browser." });
      return;
    }
    this._clearTimers();
    window.speechSynthesis.cancel();

    this.active = true;
    this.paused = false;
    this.item = item;
    this.unitIndex = clamp(startIndex || 0, 0, Math.max(0, this.units.length - 1));
    this.unitStartedAt = 0;
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;

    this.onEvent({ type: "playing" });

    this._speakCurrent(voiceURI, rate);
    this._tick();
  }

  _tick() {
    cancelAnimationFrame(this._tickRaf);
    const step = () => {
      if (!this.active) return;
      this.onEvent({ type: "tick", payload: this.progress() });
      this._tickRaf = requestAnimationFrame(step);
    };
    this._tickRaf = requestAnimationFrame(step);
  }

  _clearTimers() {
    clearTimeout(this._sleepDelayTimer);
    cancelAnimationFrame(this._tickRaf);
    this._sleepDelayTimer = 0;
    this._tickRaf = 0;
  }

  progress() {
    const base = this.timeline.slice(0, this.unitIndex).reduce((a, b) => a + b, 0);
    const curEst = this.timeline[this.unitIndex] || 0;
    let within = 0;

    if (this.units[this.unitIndex]?.type === "speech") {
      if (this.boundaryTextLen > 0) within = clamp((this.boundaryChar / this.boundaryTextLen) * curEst, 0, curEst);
      else if (this.unitStartedAt > 0) within = clamp((now() - this.unitStartedAt) / 1000, 0, curEst);
    } else if (this.units[this.unitIndex]?.type === "pause") {
      if (this.unitStartedAt > 0) within = clamp((now() - this.unitStartedAt) / 1000, 0, curEst);
    }

    const elapsed = clamp(base + within, 0, this.total || 0);
    const remaining = Math.max(0, (this.total || 0) - elapsed);
    return { elapsed, remaining, total: this.total || 0, unitIndex: this.unitIndex, unitCount: this.units.length };
  }

  seekBySeconds(delta, voiceURI, rate) {
    if (!this.active || !this.item) return;
    const p = this.progress();
    const target = clamp((p.elapsed || 0) + delta, 0, this.total || 0);

    let acc = 0;
    let idx = 0;
    for (let i = 0; i < this.timeline.length; i++) {
      const next = acc + this.timeline[i];
      if (target <= next) { idx = i; break; }
      acc = next;
      idx = i;
    }
    this.unitIndex = clamp(idx, 0, Math.max(0, this.units.length - 1));
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;
    window.speechSynthesis.cancel();
    this._speakCurrent(voiceURI, rate);
    this.onEvent({ type: "seeked", payload: this.progress() });
  }

  nextUnit(voiceURI, rate) {
    if (!this.active) return;
    this.unitIndex = clamp(this.unitIndex + 1, 0, Math.max(0, this.units.length - 1));
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;
    window.speechSynthesis.cancel();
    this._speakCurrent(voiceURI, rate);
  }

  prevUnit(voiceURI, rate) {
    if (!this.active) return;
    this.unitIndex = clamp(this.unitIndex - 1, 0, Math.max(0, this.units.length - 1));
    this.boundaryChar = 0;
    this.boundaryTextLen = 0;
    window.speechSynthesis.cancel();
    this._speakCurrent(voiceURI, rate);
  }

  _speakCurrent(voiceURI, rate) {
    const u = this.units[this.unitIndex];
    if (!u) {
      this._finishItem();
      return;
    }

    this.unitStartedAt = now();

    if (u.type === "pause") {
      this.onEvent({ type: "unit", payload: { text: "…" } });
      this._sleepDelayTimer = setTimeout(() => {
        if (!this.active) return;
        this.unitIndex = this.unitIndex + 1;
        if (this.unitIndex >= this.units.length) this._finishItem();
        else this._speakCurrent(voiceURI, rate);
      }, clamp(u.ms || 0, 120, 2500));
      return;
    }

    const utter = new SpeechSynthesisUtterance(u.text);
    utter.rate = clamp(rate || 1, 0.75, 2);

    const v = this.pickVoice(voiceURI);
    if (v) utter.voice = v;

    const hint = this.item?.languageHint || "";
    if (hint) utter.lang = hint;

    this.boundaryChar = 0;
    this.boundaryTextLen = (u.text || "").length;

    utter.onstart = () => {
      this.onEvent({ type: "unit", payload: { text: u.text } });
    };

    utter.onboundary = (e) => {
      if (!this.active) return;
      if (typeof e.charIndex === "number") this.boundaryChar = e.charIndex;
    };

    utter.onerror = () => {
      if (!this.active) return;
      this.onEvent({ type: "error", message: "Speech failed. Try a different voice." });
      this.stop();
    };

    utter.onend = () => {
      if (!this.active) return;
      this.unitIndex = this.unitIndex + 1;
      if (this.unitIndex >= this.units.length) this._finishItem();
      else this._speakCurrent(voiceURI, rate);
    };

    window.speechSynthesis.speak(utter);
  }

  _finishItem() {
    this.onEvent({ type: "itemEnd" });
  }
}

const extractFromUrl = async (url) => {
  const res = await fetch(url, { method: "GET", mode: "cors", redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();

  if (ct.includes("text/plain")) {
    const t = txt.trim();
    if (t.length < 200) throw new Error("Text is too short.");
    return { title: safeUrlTitle(url), text: t };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(txt, "text/html");

  $$("script,style,noscript,nav,header,footer,aside,form", doc).forEach((n) => n.remove());

  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
  const ti = doc.querySelector("title")?.textContent || "";
  const title = (og || ti || safeUrlTitle(url)).replace(/\s+/g, " ").trim();

  const pick =
    doc.querySelector("article") ||
    doc.querySelector("main") ||
    doc.querySelector('[role="main"]') ||
    doc.body;

  const text = (pick?.innerText || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 400) throw new Error("Extraction yielded too little text.");
  return { title: title || safeUrlTitle(url), text };
};

const dialogs = (() => {
  const supports = typeof HTMLDialogElement !== "undefined";

  const show = (id) => {
    const d = $(id);
    if (!d) return false;
    if (supports && typeof d.showModal === "function") { d.showModal(); return true; }
    return false;
  };

  const close = (id) => {
    const d = $(id);
    if (!d) return;
    if (supports && typeof d.close === "function") d.close();
  };

  const confirm = async ({ title, text, okLabel = "OK", kind = "primary" }) => {
    const d = $("#confirmDialog");
    if (!d || !supports) return window.confirm(text || "Confirm?");
    $("#confirmTitle").textContent = title || "Confirm";
    $("#confirmText").textContent = text || "";
    const ok = $("#confirmOk");
    ok.textContent = okLabel;
    ok.className = kind === "danger" ? "button button--primary" : "button button--primary";

    const p = new Promise((res) => {
      const onClose = () => {
        d.removeEventListener("close", onClose);
        res(d.returnValue === "ok");
      };
      d.addEventListener("close", onClose);
    });

    d.showModal();
    return await p;
  };

  return { show, close, confirm, supports };
})();

const state = createStore(loadState());

const persistDebounced = debounce((s) => saveState(s), 250);
state.sub((s) => persistDebounced(s));

const engine = new TTSEngine({
  onEvent: (e) => {
    const s = state.get();
    if (e.type === "error") {
      state.set((p) => ({
        ...p,
        playback: { ...p.playback, status: "error", isPlaying: false, error: e.message || "Error", spoken: p.playback.spoken },
      }));
      setStatusChip("error", "Error");
      $("#progressBar").dataset.active = "false";
      toasts.push({ kind: "error", title: "Playback error", message: e.message || "Speech failed." });
      ariaSay(e.message || "Playback error");
      return;
    }

    if (e.type === "playing") {
      state.set((p) => ({
        ...p,
        playback: { ...p.playback, status: "speaking", isPlaying: true, error: "" }
      }));
      setStatusChip("speaking", "Speaking");
      $("#progressBar").dataset.active = "true";
      return;
    }

    if (e.type === "paused") {
      state.set((p) => ({ ...p, playback: { ...p.playback, status: "paused", isPlaying: false } }));
      setStatusChip("paused", "Paused");
      $("#progressBar").dataset.active = "false";
      return;
    }

    if (e.type === "resumed") {
      state.set((p) => ({ ...p, playback: { ...p.playback, status: "speaking", isPlaying: true } }));
      setStatusChip("speaking", "Speaking");
      $("#progressBar").dataset.active = "true";
      return;
    }

    if (e.type === "stopped") {
      state.set((p) => ({
        ...p,
        playback: { ...p.playback, status: "idle", isPlaying: false, error: "", spoken: "Ready.", estElapsed: 0 },
      }));
      setStatusChip("idle", "Idle");
      $("#progressBar").dataset.active = "false";
      return;
    }

    if (e.type === "unit") {
      const txt = e.payload?.text || "";
      state.set((p) => ({
        ...p,
        playback: { ...p.playback, spoken: txt || "…" }
      }));
      return;
    }

    if (e.type === "seeked") {
      const pr = e.payload || { elapsed: 0, total: 0 };
      state.set((p) => ({
        ...p,
        playback: { ...p.playback, estElapsed: pr.elapsed || 0, estTotal: pr.total || p.playback.estTotal }
      }));
      return;
    }

    if (e.type === "tick") {
      const pr = e.payload || { elapsed: 0, remaining: 0, total: 0, unitIndex: 0 };
      state.set((p) => ({
        ...p,
        playback: {
          ...p.playback,
          estElapsed: pr.elapsed || 0,
          estTotal: pr.total || p.playback.estTotal,
          sentenceIndex: pr.unitIndex || 0
        }
      }));
      return;
    }

    if (e.type === "itemEnd") {
      onItemEnd();
      return;
    }
  }
});

const setBodyTheme = (theme) => {
  if (theme === "dark" || theme === "light") document.body.setAttribute("data-theme", theme);
  else document.body.removeAttribute("data-theme");
};

const setBodyContrast = (contrast) => {
  if (contrast === "high") document.body.setAttribute("data-contrast", "high");
  else document.body.removeAttribute("data-contrast");
};

const setBodyMotion = (motion) => {
  if (motion === "reduced") document.body.setAttribute("data-motion", "reduced");
  else document.body.removeAttribute("data-motion");
};

const themeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

const applyTheme = () => {
  const s = state.get();
  const t = s.settings.theme;
  if (t === "system") setBodyTheme(themeMedia && themeMedia.matches ? "light" : "dark");
  else setBodyTheme(t);
  setBodyContrast(s.settings.contrast);
  setBodyMotion(s.settings.motion);
};

if (themeMedia) themeMedia.addEventListener?.("change", () => applyTheme());

const setStatusChip = (kind, text) => {
  const el = $("#statusChip");
  const tx = $("#statusChipText");
  el.dataset.state = kind;
  tx.textContent = text;
};

const setToggleLabels = () => {
  const s = state.get();
  const themeLabel = s.settings.theme === "system" ? "Theme: system" : s.settings.theme === "dark" ? "Theme: dark" : "Theme: light";
  $("#themeToggle").textContent = themeLabel;
  $("#contrastToggle").textContent = s.settings.contrast === "high" ? "High contrast: on" : "High contrast: off";
  $("#motionToggle").textContent = s.settings.motion === "reduced" ? "Reduce motion: on" : "Reduce motion: off";
};

const computeItemStats = (text, rate) => {
  const words = (String(text || "").match(/\b\w+\b/g) || []).length;
  const sec = estimateSecondsForSpeech(String(text || ""), rate);
  return { words, sec };
};

const computeQueueRemaining = (queue, rate, dictPairs) => {
  let total = 0;
  for (const it of queue) {
    const t = applyDict(it.text || "", dictPairs);
    const units = splitIntoUnits(t, it.headingMode || "cue");
    const sec = units.reduce((a, u) => a + estimateUnitSeconds(u, rate), 0);
    total += sec;
  }
  return total;
};

const daily = (() => {
  const key = new Date().toISOString().slice(0, 10);
  const raw = localStorage.getItem(DAILY_KEY);
  const p = safeParseJSON(raw || "{}");
  const map = p.ok && p.value && typeof p.value === "object" ? p.value : {};
  const getToday = () => Number(map[key] || 0);
  const add = (sec) => {
    map[key] = Number(map[key] || 0) + Math.max(0, sec || 0);
    localStorage.setItem(DAILY_KEY, JSON.stringify(map));
  };
  return { getToday, add };
})();

let sleepTickTimer = 0;

const startSleepTicker = () => {
  clearInterval(sleepTickTimer);
  sleepTickTimer = setInterval(() => {
    const s = state.get();
    if (s.sleep.mode !== "minutes" || !s.sleep.endAt) return;
    if (now() >= s.sleep.endAt) {
      stopPlayback("Sleep timer ended.");
      state.set((p) => ({ ...p, sleep: { mode: "off", endAt: 0, endOfItem: false } }));
      renderAll();
    } else {
      renderSleep();
    }
  }, 500);
};

const setSleep = (mode, value) => {
  if (mode === "off") {
    state.set((p) => ({ ...p, sleep: { mode: "off", endAt: 0, endOfItem: false } }));
    startSleepTicker();
    renderSleep();
    return;
  }
  if (mode === "end") {
    state.set((p) => ({ ...p, sleep: { mode: "end", endAt: 0, endOfItem: true } }));
    startSleepTicker();
    renderSleep();
    return;
  }
  const min = Number(value || 0);
  const endAt = now() + Math.max(1, min) * 60_000;
  state.set((p) => ({ ...p, sleep: { mode: "minutes", endAt, endOfItem: false } }));
  startSleepTicker();
  renderSleep();
};

const stopPlayback = (reason) => {
  engine.stop();
  if (reason) {
    $("#nowStatus").textContent = reason;
    toasts.push({ kind: "warning", title: "Stopped", message: reason, timeout: 2200 });
    ariaSay(reason);
  }
};

const ensurePlayableItem = () => {
  const s = state.get();
  if (s.queue.length === 0) return null;
  if (s.playback.itemId) {
    const found = s.queue.find((x) => x.id === s.playback.itemId);
    if (found) return found;
  }
  return s.queue[0];
};

const prepareAndPlay = (item, startIndex = 0) => {
  const s = state.get();
  const dictPairs = s.settings.dictPairs || [];
  const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
  const prepared = engine.prepare({ item, rate, dictPairs });
  engine.units = prepared.units;
  engine.timeline = prepared.timeline;
  engine.total = prepared.total;

  state.set((p) => ({
    ...p,
    playback: {
      ...p.playback,
      itemId: item.id,
      sentenceIndex: clamp(startIndex, 0, Math.max(0, prepared.units.length - 1)),
      estElapsed: 0,
      estTotal: prepared.total || 0,
      spoken: "…",
      error: "",
      status: "speaking",
      isPlaying: true
    }
  }));

  engine.play({
    item,
    startIndex,
    voiceURI: s.settings.voiceURI,
    rate
  });

  renderNowPlaying();
  renderQueue();
  renderChart();
};

const togglePlayPause = () => {
  const s = state.get();
  if (s.queue.length === 0) {
    toasts.push({ kind: "warning", title: "Queue is empty", message: "Add text or a URL first.", timeout: 2200 });
    return;
  }
  if (!engine.active) {
    const item = ensurePlayableItem();
    if (!item) return;
    prepareAndPlay(item, s.playback.sentenceIndex || 0);
    return;
  }
  if (engine.paused) engine.resume();
  else engine.pause();
  renderNowPlaying();
};

const nextItem = () => {
  const s = state.get();
  if (s.queue.length === 0) return;
  const curId = s.playback.itemId;
  const idx = s.queue.findIndex((x) => x.id === curId);
  const next = s.queue[clamp(idx + 1, 0, s.queue.length - 1)] || s.queue[0];
  prepareAndPlay(next, 0);
};

const prevItem = () => {
  const s = state.get();
  if (s.queue.length === 0) return;
  const curId = s.playback.itemId;
  const idx = s.queue.findIndex((x) => x.id === curId);
  const prev = s.queue[clamp(idx - 1, 0, s.queue.length - 1)] || s.queue[0];
  prepareAndPlay(prev, 0);
};

const nextSentence = () => {
  const s = state.get();
  if (!engine.active) { togglePlayPause(); return; }
  const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
  engine.nextUnit(s.settings.voiceURI, rate);
};

const prevSentence = () => {
  const s = state.get();
  if (!engine.active) { togglePlayPause(); return; }
  const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
  engine.prevUnit(s.settings.voiceURI, rate);
};

const seekBy = (delta) => {
  const s = state.get();
  if (!engine.active) return;
  const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
  engine.seekBySeconds(delta, s.settings.voiceURI, rate);
};

const onItemEnd = () => {
  const s = state.get();
  const pr = engine.progress();
  const elapsed = pr.total || 0;
  daily.add(elapsed);
  state.set((p) => ({ ...p, ui: { ...p.ui, sessionListenedSec: (p.ui.sessionListenedSec || 0) + elapsed } }));

  if (s.sleep.endOfItem) {
    stopPlayback("Sleep timer ended at item end.");
    state.set((p) => ({ ...p, sleep: { mode: "off", endAt: 0, endOfItem: false } }));
    renderAll();
    return;
  }

  const curIdx = s.queue.findIndex((x) => x.id === s.playback.itemId);
  const nxt = s.queue[curIdx + 1];
  if (nxt) {
    prepareAndPlay(nxt, 0);
  } else {
    stopPlayback("Queue finished.");
    state.set((p) => ({ ...p, playback: { ...p.playback, itemId: "", sentenceIndex: 0 } }));
    renderAll();
  }
};

const exportQueue = () => {
  const s = state.get();
  const payload = { v: 1, exportedAt: now(), queue: s.queue };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `queuetts-queue-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toasts.push({ kind: "success", title: "Exported", message: "Queue JSON downloaded.", timeout: 1800 });
};

const importQueueFromFile = async (file) => {
  const txt = await file.text();
  const p = safeParseJSON(txt);
  if (!p.ok) throw new Error("Invalid JSON.");
  const obj = p.value;

  let q = null;
  if (obj && typeof obj === "object" && Array.isArray(obj.queue)) q = obj.queue;
  else if (Array.isArray(obj)) q = obj;

  if (!q) throw new Error("No queue found.");
  const items = q.filter(isValidItem).map(normalizeItem);
  state.set((s) => ({ ...s, queue: items, playback: { ...s.playback, itemId: "", sentenceIndex: 0, isPlaying: false, status: "idle" } }));
  engine.stop();
  renderAll();
  toasts.push({ kind: "success", title: "Imported", message: `${items.length} items loaded.`, timeout: 2200 });
};

const setAddMode = (mode) => {
  const m = mode === "url" ? "url" : "paste";
  state.set((p) => ({ ...p, ui: { ...p.ui, addMode: m } }));
  const isPaste = m === "paste";
  $("#tabPaste").classList.toggle("tab--active", isPaste);
  $("#tabPaste").setAttribute("aria-selected", String(isPaste));
  $("#tabUrl").classList.toggle("tab--active", !isPaste);
  $("#tabUrl").setAttribute("aria-selected", String(!isPaste));
  $("#panePaste").classList.toggle("hidden", !isPaste);
  $("#paneUrl").classList.toggle("hidden", isPaste);
};

const addPaste = () => {
  const raw = $("#pasteInput").value || "";
  const cleaned = $("#cleanupToggle").checked ? quickCleanup(raw) : raw.trim();
  if (!cleaned) {
    toasts.push({ kind: "warning", title: "Nothing to add", message: "Paste some text first.", timeout: 2200 });
    return;
  }
  const item = normalizeItem({
    id: uid(),
    title: guessTitleFromText(cleaned),
    text: cleaned,
    createdAt: now(),
    source: { type: "paste" },
    languageHint: ($("#languageHint").value || "").trim(),
    headingMode: $("#headingMode").value || "cue"
  });

  state.set((s) => ({ ...s, queue: [item, ...s.queue] }));
  $("#pasteInput").value = "";
  renderAll();
  toasts.push({ kind: "success", title: "Added", message: "Item added to queue.", timeout: 1600 });
};

const addUrl = async () => {
  const url = ($("#urlInput").value || "").trim();
  if (!url) {
    toasts.push({ kind: "warning", title: "Missing URL", message: "Enter an article URL.", timeout: 2200 });
    return;
  }

  const btn = $("#addUrl");
  const sp = $("#urlSpinner");
  sp.classList.remove("hidden");
  btn.disabled = true;

  try {
    const { title, text } = await extractFromUrl(url);
    const item = normalizeItem({
      id: uid(),
      title: title || safeUrlTitle(url),
      text: quickCleanup(text),
      createdAt: now(),
      source: { type: "url", url },
      languageHint: ($("#languageHintUrl").value || "").trim(),
      headingMode: $("#headingModeUrl").value || "cue"
    });
    state.set((s) => ({ ...s, queue: [item, ...s.queue] }));
    $("#urlInput").value = "";
    renderAll();
    toasts.push({ kind: "success", title: "Added", message: "URL item added.", timeout: 1800 });
  } catch (err) {
    const msg = String(err?.message || err || "Fetch failed.");
    toasts.push({
      kind: "error",
      title: "URL fetch failed",
      message: msg,
      timeout: 5200,
      actions: [{ label: "Retry", onClick: () => addUrl() }]
    });
    $("#nowStatus").textContent = "URL fetch failed (CORS is common). Paste text instead.";
    ariaSay("URL fetch failed");
  } finally {
    sp.classList.add("hidden");
    btn.disabled = false;
  }
};

const queueMove = (id, dir) => {
  state.set((s) => {
    const idx = s.queue.findIndex((x) => x.id === id);
    if (idx === -1) return s;
    const j = clamp(idx + dir, 0, s.queue.length - 1);
    if (j === idx) return s;
    const q = s.queue.slice();
    const [it] = q.splice(idx, 1);
    q.splice(j, 0, it);
    return { ...s, queue: q };
  });
  renderQueue();
  renderChart();
};

const queueRemove = async (id) => {
  const s = state.get();
  const it = s.queue.find((x) => x.id === id);
  const ok = await dialogs.confirm({ title: "Remove item", text: `Remove “${it?.title || "this item"}” from the queue?`, okLabel: "Remove", kind: "danger" });
  if (!ok) return;

  const wasCurrent = s.playback.itemId === id;
  state.set((p) => ({ ...p, queue: p.queue.filter((x) => x.id !== id) }));
  if (wasCurrent) stopPlayback("Current item removed.");
  renderAll();
};

const openEdit = (id) => {
  const s = state.get();
  const it = s.queue.find((x) => x.id === id);
  if (!it) return;
  state.set((p) => ({ ...p, ui: { ...p.ui, editItemId: id } }));
  $("#editTitle").value = it.title || "";
  $("#editText").value = it.text || "";
  if (dialogs.supports) $("#editDialog").showModal();
  else toasts.push({ kind: "warning", title: "Unsupported", message: "Dialog not supported in this browser.", timeout: 2200 });
};

const saveEdit = () => {
  const s = state.get();
  const id = s.ui.editItemId;
  if (!id) return;

  const title = ($("#editTitle").value || "").trim() || "Untitled";
  const text = ($("#editText").value || "").trim();
  if (!text) {
    toasts.push({ kind: "warning", title: "Empty text", message: "Text cannot be empty.", timeout: 2200 });
    return;
  }

  state.set((p) => ({
    ...p,
    queue: p.queue.map((x) => x.id === id ? { ...x, title, text } : x),
    ui: { ...p.ui, editItemId: "" }
  }));

  if (engine.active && s.playback.itemId === id) {
    const item = state.get().queue.find((x) => x.id === id);
    if (item) prepareAndPlay(item, 0);
  }

  renderAll();
  toasts.push({ kind: "success", title: "Saved", message: "Item updated.", timeout: 1600 });
};

const clearQueue = async () => {
  const ok = await dialogs.confirm({ title: "Clear queue", text: "Remove all items from the queue?", okLabel: "Clear", kind: "danger" });
  if (!ok) return;
  stopPlayback("Queue cleared.");
  state.set((s) => ({ ...s, queue: [], playback: { ...s.playback, itemId: "", sentenceIndex: 0, status: "idle", isPlaying: false } }));
  renderAll();
};

const toggleFocusMode = () => {
  const on = document.body.classList.toggle("focus-mode");
  if (on) ariaSay("Focus mode enabled");
  else ariaSay("Focus mode disabled");
};

const toggleShortcuts = () => {
  const el = $("#shortcuts");
  const next = el.classList.toggle("hidden") === false;
  ariaSay(next ? "Shortcuts shown" : "Shortcuts hidden");
};

const toggleTheme = () => {
  state.set((s) => {
    const cur = s.settings.theme;
    const next = cur === "system" ? "dark" : cur === "dark" ? "light" : "system";
    return { ...s, settings: { ...s.settings, theme: next } };
  });
  applyTheme();
  setToggleLabels();
};

const toggleContrast = () => {
  state.set((s) => {
    const next = s.settings.contrast === "high" ? "normal" : "high";
    return { ...s, settings: { ...s.settings, contrast: next } };
  });
  applyTheme();
  setToggleLabels();
};

const toggleMotion = () => {
  state.set((s) => {
    const next = s.settings.motion === "reduced" ? "full" : "reduced";
    return { ...s, settings: { ...s.settings, motion: next } };
  });
  applyTheme();
  setToggleLabels();
};

const setRate = (v) => {
  const rate = clamp(Number(v || 1), 0.75, 2);
  state.set((s) => ({ ...s, settings: { ...s.settings, rate } }));
  $("#rateRange").value = String(rate);
  if (engine.active && state.get().playback.itemId) {
    const item = state.get().queue.find((x) => x.id === state.get().playback.itemId);
    if (item) prepareAndPlay(item, state.get().playback.sentenceIndex || 0);
  }
  renderChart();
};

const setSkip = (v) => {
  const skip = Number(v || 15);
  const next = skip === 10 || skip === 15 || skip === 30 ? skip : 15;
  state.set((s) => ({ ...s, settings: { ...s.settings, skip: next } }));
  $("#skipSelect").value = String(next);
};

const saveDictRaw = () => {
  const raw = $("#dictInput").value || "";
  const pairs = parseDict(raw);
  state.set((s) => ({ ...s, settings: { ...s.settings, dictRaw: raw, dictPairs: pairs } }));
  toasts.push({ kind: "success", title: "Saved", message: "Dictionary updated.", timeout: 1600 });
  renderChart();
};

const queueFilter = debounce((q) => {
  state.set((s) => ({ ...s, ui: { ...s.ui, query: q } }));
  renderQueue();
}, 120);

const cmdk = (() => {
  const dialog = $("#cmdkDialog");
  const input = $("#cmdkInput");
  const list = $("#cmdkList");

  const actions = () => {
    const s = state.get();
    const canPlay = s.queue.length > 0;
    const playing = engine.active && !engine.paused;
    const paused = engine.active && engine.paused;

    const base = [
      { name: playing ? "Pause" : paused ? "Resume" : "Play", hint: "Toggle playback", keys: ["Space"], run: () => togglePlayPause(), enabled: canPlay },
      { name: "Next item", hint: "Advance queue", keys: ["N"], run: () => nextItem(), enabled: canPlay },
      { name: "Previous item", hint: "Go back", keys: ["P"], run: () => prevItem(), enabled: canPlay },
      { name: "Next sentence", hint: "Skip forward", keys: ["K"], run: () => nextSentence(), enabled: canPlay },
      { name: "Previous sentence", hint: "Skip back", keys: ["J"], run: () => prevSentence(), enabled: canPlay },
      { name: "Seek forward", hint: "By skip interval", keys: ["."], run: () => seekBy(Number(state.get().settings.skip || 15)), enabled: engine.active },
      { name: "Seek backward", hint: "By skip interval", keys: [","], run: () => seekBy(-Number(state.get().settings.skip || 15)), enabled: engine.active },
      { name: "Focus mode", hint: "Hide secondary UI", keys: ["F"], run: () => toggleFocusMode(), enabled: true },
      { name: "Theme toggle", hint: "System / Dark / Light", keys: [], run: () => toggleTheme(), enabled: true },
      { name: "High contrast", hint: "Toggle contrast", keys: [], run: () => toggleContrast(), enabled: true },
      { name: "Reduce motion", hint: "Toggle motion", keys: [], run: () => toggleMotion(), enabled: true },
      { name: "Export queue JSON", hint: "Download", keys: [], run: () => exportQueue(), enabled: true },
      { name: "Toggle shortcuts", hint: "Show help", keys: ["?"], run: () => toggleShortcuts(), enabled: true }
    ];
    return base.filter((a) => a.enabled !== false);
  };

  let items = [];
  let index = 0;

  const render = () => {
    const q = (input.value || "").trim().toLowerCase();
    const all = actions();
    items = q ? all.filter((x) => (x.name + " " + x.hint).toLowerCase().includes(q)) : all;
    index = clamp(index, 0, Math.max(0, items.length - 1));
    list.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "cmdk__item";
      empty.innerHTML = `<div class="cmdk__left"><div class="cmdk__name">No matches</div><div class="cmdk__hint">Try a different query</div></div>`;
      list.appendChild(empty);
      return;
    }

    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "cmdk__item";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(i === index));
      row.tabIndex = -1;

      const left = document.createElement("div");
      left.className = "cmdk__left";
      const name = document.createElement("div");
      name.className = "cmdk__name";
      name.textContent = it.name;
      const hint = document.createElement("div");
      hint.className = "cmdk__hint";
      hint.textContent = it.hint || "";
      left.appendChild(name);
      left.appendChild(hint);

      const keys = document.createElement("div");
      keys.className = "cmdk__keys";
      (it.keys || []).forEach((k) => {
        const kk = document.createElement("span");
        kk.className = "kbd";
        kk.textContent = k;
        keys.appendChild(kk);
      });

      row.appendChild(left);
      row.appendChild(keys);

      row.addEventListener("click", () => run(i));
      row.addEventListener("mousemove", () => { index = i; sync(); });

      list.appendChild(row);
    });
  };

  const sync = () => {
    const rows = $$(".cmdk__item[role='option']", list);
    rows.forEach((r, i) => r.setAttribute("aria-selected", String(i === index)));
    const active = rows[index];
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  const run = (i) => {
    const it = items[i];
    if (!it) return;
    dialog.close();
    it.run();
  };

  const open = () => {
    if (!dialogs.supports) return;
    input.value = "";
    dialog.showModal();
    render();
    setTimeout(() => input.focus(), 0);
  };

  const close = () => {
    if (!dialogs.supports) return;
    dialog.close();
  };

  dialog.addEventListener("close", () => { input.value = ""; });
  input.addEventListener("input", () => render());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); index = clamp(index + 1, 0, items.length - 1); sync(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = clamp(index - 1, 0, items.length - 1); sync(); }
    else if (e.key === "Enter") { e.preventDefault(); run(index); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  $("#cmdkClose").addEventListener("click", () => close());

  return { open, close };
})();

const renderSleep = () => {
  const s = state.get();
  const el = $("#sleepTimer");
  if (s.sleep.mode === "off") {
    el.textContent = "Sleep timer: off";
    return;
  }
  if (s.sleep.mode === "end") {
    el.textContent = "Sleep timer: end of item";
    return;
  }
  const rem = Math.max(0, Math.ceil((s.sleep.endAt - now()) / 1000));
  el.textContent = `Sleep timer: ${fmtTime(rem)} remaining`;
};

const renderNowPlaying = () => {
  const s = state.get();
  const item = s.queue.find((x) => x.id === s.playback.itemId) || null;

  $("#nowTitle").textContent = item ? item.title : "Nothing queued";

  if (s.playback.status === "error") $("#nowStatus").textContent = s.playback.error || "Error";
  else if (engine.active && engine.paused) $("#nowStatus").textContent = "Paused.";
  else if (engine.active) $("#nowStatus").textContent = "Speaking.";
  else if (s.queue.length === 0) $("#nowStatus").textContent = "Add text or a URL to begin.";
  else $("#nowStatus").textContent = "Ready.";

  $("#nowSpeaking").textContent = s.playback.spoken || "Ready.";
  $("#elapsed").textContent = fmtTime(s.playback.estElapsed || 0);
  const rem = Math.max(0, (s.playback.estTotal || 0) - (s.playback.estElapsed || 0));
  $("#remaining").textContent = `-${fmtTime(rem)}`;

  const pct = s.playback.estTotal > 0 ? clamp((s.playback.estElapsed / s.playback.estTotal) * 100, 0, 100) : 0;
  $("#progressFill").style.width = `${pct.toFixed(2)}%`;
  $("#progressBar").setAttribute("aria-valuenow", String(Math.round(pct)));

  const curIdx = s.queue.findIndex((x) => x.id === s.playback.itemId);
  const next = curIdx >= 0 ? s.queue.slice(curIdx + 1, curIdx + 4) : s.queue.slice(0, 3);
  const ol = $("#upNext");
  ol.innerHTML = "";
  next.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x.title;
    ol.appendChild(li);
  });
  renderSleep();

  $("#playPause").textContent = engine.active ? (engine.paused ? "Resume" : "Pause") : "Play";
};

const renderQueueStats = () => {
  const s = state.get();
  $("#queueCount").textContent = String(s.queue.length);

  const total = computeQueueRemaining(s.queue, clamp(Number(s.settings.rate || 1), 0.75, 2), s.settings.dictPairs || []);
  const curItem = s.queue.find((x) => x.id === s.playback.itemId) || null;
  const curTotal = s.playback.estTotal || 0;
  const curElapsed = s.playback.estElapsed || 0;
  const remaining = total - (curItem ? clamp(curElapsed, 0, curTotal) : 0);
  $("#queueTime").textContent = fmtTime(Math.max(0, remaining));

  const today = daily.getToday();
  $("#todayListened").textContent = fmtTime(today);
  $("#sessionListened").textContent = fmtTime(state.get().ui.sessionListenedSec || 0);
};

const drawChart = () => {
  const c = $("#queueChart");
  const tip = $("#chartTip");
  const s = state.get();
  const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
  const dictPairs = s.settings.dictPairs || [];

  const rect = c.getBoundingClientRect();
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const w = Math.max(320, Math.floor(rect.width));
  const h = 120;

  c.width = w * dpr;
  c.height = h * dpr;

  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const items = s.queue.slice(0, 60);
  const durations = items.map((it) => {
    const t = applyDict(it.text || "", dictPairs);
    const units = splitIntoUnits(t, it.headingMode || "cue");
    return units.reduce((a, u) => a + estimateUnitSeconds(u, rate), 0);
  });

  const max = Math.max(1, ...durations);
  const pad = 10;
  const baseY = h - pad;
  const topY = pad;
  const usableH = baseY - topY;
  const gap = 2;
  const n = durations.length || 1;
  const barW = Math.max(3, Math.floor((w - pad * 2 - gap * (n - 1)) / n));
  const curId = s.playback.itemId;

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "rgba(74,215,255,.8)");
  grad.addColorStop(.55, "rgba(142,107,255,.75)");
  grad.addColorStop(1, "rgba(255,79,216,.7)");

  for (let i = 0; i < n; i++) {
    const x = pad + i * (barW + gap);
    const v = durations[i] || 0;
    const bh = clamp((v / max) * usableH, 2, usableH);
    const y = baseY - bh;

    const it = items[i];
    const isActive = it && it.id === curId;

    ctx.globalAlpha = isActive ? 1 : 0.72;
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, bh);

    ctx.globalAlpha = isActive ? 0.9 : 0.35;
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, barW - 1, bh - 1);
  }

  ctx.globalAlpha = 1;

  const pickIndexFromX = (clientX) => {
    const r = c.getBoundingClientRect();
    const x = clientX - r.left;
    const i = Math.floor((x - pad) / (barW + gap));
    return clamp(i, 0, items.length - 1);
  };

  const showTip = (i, clientX, clientY) => {
    const it = items[i];
    if (!it) return;
    const sec = durations[i] || 0;
    tip.textContent = `${it.title} · ~${fmtTime(sec)}`;
    tip.classList.remove("hidden");

    const wrap = c.parentElement.getBoundingClientRect();
    const x = clientX - wrap.left;
    const y = clientY - wrap.top;
    tip.style.left = `${clamp(x + 12, 12, wrap.width - 12)}px`;
    tip.style.top = `${clamp(y + 12, 12, wrap.height - 12)}px`;
  };

  const hideTip = () => tip.classList.add("hidden");

  c.onpointermove = (e) => {
    if (!items.length) return;
    const i = pickIndexFromX(e.clientX);
    showTip(i, e.clientX, e.clientY);
  };
  c.onpointerleave = () => hideTip();
  c.onclick = (e) => {
    if (!items.length) return;
    const i = pickIndexFromX(e.clientX);
    const it = items[i];
    if (it) prepareAndPlay(it, 0);
  };
};

const renderChart = () => {
  renderQueueStats();
  drawChart();
};

const renderQueue = () => {
  const s = state.get();
  const host = $("#queueList");
  const empty = $("#queueEmpty");
  const footer = $("#queueFooter");

  const q = (s.ui.query || "").trim().toLowerCase();
  const list = q
    ? s.queue.filter((it) => (it.title + "\n" + it.text).toLowerCase().includes(q))
    : s.queue.slice();

  empty.classList.toggle("hidden", list.length !== 0);
  host.innerHTML = "";

  const useCompact = s.settings.compact || s.queue.length >= 180;
  footer.classList.toggle("hidden", s.queue.length < 80);

  const activeId = s.playback.itemId;

  const renderItem = (it) => {
    const rate = clamp(Number(s.settings.rate || 1), 0.75, 2);
    const stats = computeItemStats(it.text, rate);
    const meta = [
      it.source?.type === "url" ? "URL" : "Paste",
      `~${fmtTime(stats.sec)}`,
      `${stats.words.toLocaleString()} words`
    ];

    const card = document.createElement("div");
    card.className = useCompact ? "qitem qitem--compact" : "qitem";
    card.setAttribute("role", "listitem");
    card.tabIndex = 0;
    card.dataset.id = it.id;
    card.dataset.active = String(it.id === activeId);

    const top = document.createElement("div");
    top.className = "qitem__top";

    const left = document.createElement("div");
    left.className = "qitem__row";

    const handle = document.createElement("div");
    handle.className = "qitem__handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", it.id);
      e.dataTransfer.effectAllowed = "move";
    });

    const title = document.createElement("h3");
    title.className = "qitem__title";
    title.textContent = it.title;

    left.appendChild(handle);
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "qitem__meta";
    meta.forEach((m) => {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = m;
      right.appendChild(b);
    });

    top.appendChild(left);
    top.appendChild(right);

    const snippet = document.createElement("div");
    snippet.className = "qitem__snippet";
    const sn = (it.text || "").replace(/\s+/g, " ").trim();
    snippet.textContent = sn.length > 180 ? sn.slice(0, 177) + "…" : sn;

    const actions = document.createElement("div");
    actions.className = "qitem__actions";

    const bPlay = document.createElement("button");
    bPlay.className = "button button--ghost";
    bPlay.type = "button";
    bPlay.textContent = "Play";
    bPlay.addEventListener("click", (e) => { e.stopPropagation(); prepareAndPlay(it, 0); });

    const bEdit = document.createElement("button");
    bEdit.className = "button button--ghost";
    bEdit.type = "button";
    bEdit.textContent = "Edit";
    bEdit.addEventListener("click", (e) => { e.stopPropagation(); openEdit(it.id); });

    const bUp = document.createElement("button");
    bUp.className = "button button--ghost";
    bUp.type = "button";
    bUp.textContent = "Up";
    bUp.addEventListener("click", (e) => { e.stopPropagation(); queueMove(it.id, -1); });

    const bDn = document.createElement("button");
    bDn.className = "button button--ghost";
    bDn.type = "button";
    bDn.textContent = "Down";
    bDn.addEventListener("click", (e) => { e.stopPropagation(); queueMove(it.id, +1); });

    const bRm = document.createElement("button");
    bRm.className = "button button--ghost";
    bRm.type = "button";
    bRm.textContent = "Remove";
    bRm.addEventListener("click", (e) => { e.stopPropagation(); queueRemove(it.id); });

    actions.appendChild(bPlay);
    actions.appendChild(bEdit);
    actions.appendChild(bUp);
    actions.appendChild(bDn);
    actions.appendChild(bRm);

    card.appendChild(top);
    if (!useCompact) card.appendChild(snippet);
    if (!useCompact) card.appendChild(actions);

    card.addEventListener("click", () => {
      state.set((p) => ({ ...p, ui: { ...p.ui, focusedItemId: it.id } }));
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); prepareAndPlay(it, 0); }
    });

    card.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("text/plain");
      if (!fromId || fromId === it.id) return;
      state.set((s0) => {
        const q0 = s0.queue.slice();
        const from = q0.findIndex((x) => x.id === fromId);
        const to = q0.findIndex((x) => x.id === it.id);
        if (from === -1 || to === -1) return s0;
        const [moved] = q0.splice(from, 1);
        q0.splice(to, 0, moved);
        return { ...s0, queue: q0 };
      });
      renderQueue();
      renderChart();
    });

    return card;
  };

  const maxRender = useCompact ? Math.min(list.length, 220) : Math.min(list.length, 90);
  for (let i = 0; i < maxRender; i++) host.appendChild(renderItem(list[i]));

  if (list.length > maxRender) {
    const more = document.createElement("div");
    more.className = "empty";
    more.innerHTML = `<div class="empty__title">${list.length - maxRender} more not rendered</div><div class="empty__text">Enable compact mode for large queues or refine search.</div>`;
    host.appendChild(more);
  }
};

const renderAll = () => {
  applyTheme();
  setToggleLabels();
  renderNowPlaying();
  renderQueue();
  renderChart();
  $("#dictInput").value = state.get().settings.dictRaw || "";
  $("#rateRange").value = String(state.get().settings.rate || 1);
  $("#skipSelect").value = String(state.get().settings.skip || 15);
};

const initVoicesUI = async () => {
  const sk = $("#voiceSkeleton");
  const sel = $("#voiceSelect");
  const search = $("#voiceSearch");
  sk.classList.remove("hidden");
  sel.innerHTML = "";
  sel.disabled = true;

  const voices = await engine.initVoices();
  sk.classList.add("hidden");
  sel.disabled = false;

  if (!voices.length) {
    sel.innerHTML = `<option value="">No voices available</option>`;
    sel.disabled = true;
    toasts.push({ kind: "error", title: "No voices", message: "SpeechSynthesis voices not available.", timeout: 4200 });
    return;
  }

  const render = (q) => {
    const s = state.get();
    const query = (q || "").trim().toLowerCase();
    const filtered = query
      ? voices.filter((v) => `${v.name} ${v.lang}`.toLowerCase().includes(query))
      : voices;

    sel.innerHTML = "";
    filtered.forEach((v) => {
      const o = document.createElement("option");
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      sel.appendChild(o);
    });

    if (s.settings.voiceURI && filtered.some((v) => v.voiceURI === s.settings.voiceURI)) {
      sel.value = s.settings.voiceURI;
    } else if (!s.settings.voiceURI) {
      const preferred = voices.find((v) => /en-|en_/i.test(v.lang)) || voices[0];
      state.set((p) => ({ ...p, settings: { ...p.settings, voiceURI: preferred.voiceURI } }));
      sel.value = preferred.voiceURI;
    } else {
      const fallback = filtered[0] || voices[0];
      state.set((p) => ({ ...p, settings: { ...p.settings, voiceURI: fallback.voiceURI } }));
      sel.value = fallback.voiceURI;
    }
  };

  render(search.value || "");

  search.addEventListener("input", debounce(() => render(search.value || ""), 90));
  sel.addEventListener("change", () => {
    state.set((s) => ({ ...s, settings: { ...s.settings, voiceURI: sel.value } }));
    if (engine.active && state.get().playback.itemId) {
      const item = state.get().queue.find((x) => x.id === state.get().playback.itemId);
      if (item) prepareAndPlay(item, state.get().playback.sentenceIndex || 0);
    }
  });
};

const wireUI = () => {
  $("#cmdkOpen").addEventListener("click", () => cmdk.open());

  $("#themeToggle").addEventListener("click", () => toggleTheme());
  $("#contrastToggle").addEventListener("click", () => toggleContrast());
  $("#motionToggle").addEventListener("click", () => toggleMotion());

  $("#playPause").addEventListener("click", () => togglePlayPause());
  $("#nextItem").addEventListener("click", () => nextItem());
  $("#prevItem").addEventListener("click", () => prevItem());
  $("#nextSentence").addEventListener("click", () => nextSentence());
  $("#prevSentence").addEventListener("click", () => prevSentence());

  $$(".seekers [data-seek]").forEach((b) => {
    b.addEventListener("click", () => seekBy(Number(b.dataset.seek || 0)));
  });

  $("#rateRange").addEventListener("input", (e) => setRate(e.target.value));
  $$(".rate__ticks [data-rate]").forEach((b) => b.addEventListener("click", () => setRate(b.dataset.rate)));

  $("#skipSelect").addEventListener("change", (e) => setSkip(e.target.value));

  $("#tabPaste").addEventListener("click", () => setAddMode("paste"));
  $("#tabUrl").addEventListener("click", () => setAddMode("url"));

  $("#addPaste").addEventListener("click", () => addPaste());
  $("#addUrl").addEventListener("click", () => addUrl());

  $("#focusMode").addEventListener("click", () => toggleFocusMode());
  $("#exportQueue").addEventListener("click", () => exportQueue());
  $("#importQueue").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { await importQueueFromFile(f); } catch (err) {
      toasts.push({ kind: "error", title: "Import failed", message: String(err?.message || err), timeout: 4200 });
    }
  });

  $("#clearQueue").addEventListener("click", () => clearQueue());

  $("#sleepStart").addEventListener("click", () => {
    const v = $("#sleepSelect").value;
    if (v === "off") setSleep("off");
    else if (v === "end") setSleep("end");
    else setSleep("minutes", Number(v));
  });
  $("#sleepCancel").addEventListener("click", () => setSleep("off"));

  $("#saveDict").addEventListener("click", () => saveDictRaw());

  $("#queueSearch").addEventListener("input", (e) => queueFilter(e.target.value || ""));

  $("#toggleCompact").addEventListener("click", () => {
    state.set((s) => ({ ...s, settings: { ...s.settings, compact: !s.settings.compact } }));
    renderQueue();
  });

  $("#editDialog").addEventListener("close", () => {
    const rv = $("#editDialog").returnValue;
    if (rv === "save") saveEdit();
    else state.set((s) => ({ ...s, ui: { ...s.ui, editItemId: "" } }));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.body.classList.contains("focus-mode")) document.body.classList.remove("focus-mode");
      if (!$("#shortcuts").classList.contains("hidden")) $("#shortcuts").classList.add("hidden");
      if (dialogs.supports) {
        if ($("#cmdkDialog").open) $("#cmdkDialog").close();
        if ($("#editDialog").open) $("#editDialog").close();
        if ($("#confirmDialog").open) $("#confirmDialog").close();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      cmdk.open();
      return;
    }

    if (dialogs.supports && ($("#cmdkDialog").open || $("#editDialog").open || $("#confirmDialog").open)) return;
    if (isTypingTarget(document.activeElement)) return;

    if (e.key === " ") { e.preventDefault(); togglePlayPause(); return; }
    if (e.key === "j" || e.key === "J") { e.preventDefault(); prevSentence(); return; }
    if (e.key === "k" || e.key === "K") { e.preventDefault(); nextSentence(); return; }
    if (e.key === "n" || e.key === "N") { e.preventDefault(); nextItem(); return; }
    if (e.key === "p" || e.key === "P") { e.preventDefault(); prevItem(); return; }
    if (e.key === "," ) { e.preventDefault(); seekBy(-Number(state.get().settings.skip || 15)); return; }
    if (e.key === "." ) { e.preventDefault(); seekBy(Number(state.get().settings.skip || 15)); return; }
    if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFocusMode(); return; }
    if (e.key === "?" ) { e.preventDefault(); toggleShortcuts(); return; }

    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const s = state.get();
      const id = s.ui.focusedItemId || s.playback.itemId || "";
      if (!id) return;
      queueMove(id, e.key === "ArrowUp" ? -1 : 1);
      return;
    }
  });

  window.addEventListener("resize", debounce(() => renderChart(), 120));
};

const boot = async () => {
  applyTheme();
  setToggleLabels();

  const s = state.get();
  $("#rateRange").value = String(s.settings.rate || 1);
  $("#skipSelect").value = String(s.settings.skip || 15);
  $("#dictInput").value = s.settings.dictRaw || "";
  setAddMode(s.ui.addMode || "paste");

  if (!engine.supports()) {
    setStatusChip("error", "Unsupported");
    $("#nowStatus").textContent = "SpeechSynthesis is not available in this browser.";
    toasts.push({ kind: "error", title: "Unsupported", message: "SpeechSynthesis is not available.", timeout: 5200 });
  } else {
    setStatusChip("idle", "Idle");
  }

  wireUI();
  startSleepTicker();
  renderAll();
  await initVoicesUI();
};

boot();
