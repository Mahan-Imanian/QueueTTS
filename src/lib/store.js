import { emptyQueue } from "./queue.js";
import { canonicalUrl, CPS_DEFAULT, normalizeSpace, siteFromUrl, wordCount } from "./text.js";

export const SCHEMA = 3;
export const KEYS = { settings: "settings", queue: "queue", player: "player", stats: "stats", schema: "schema" };
export const docKey = (id) => `doc:${id}`;
export const LEGACY_KEY = "queuetts:v2";

export const PLAYER_STATUS = ["idle", "preparing", "playing", "paused", "stopped", "completed", "error", "recovering"];

export const defaultSettings = () => ({
  voices: {},
  allowNetworkVoices: false,
  rate: 1,
  pitch: 1,
  volume: 1,
  autoAdvance: true,
  readCode: false,
  announceHeadings: false,
  theme: "system",
  pronunciations: [],
  cps: CPS_DEFAULT,
  onboarded: false
});

export const defaultPlayer = () => ({ itemId: "", pos: null, status: "idle", error: "", updatedAt: 0, sleepAt: 0 });

const finite = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const normalizeSettings = (raw = {}) => {
  const base = defaultSettings();
  const value = raw && typeof raw === "object" ? raw : {};
  const voices = {};
  if (value.voices && typeof value.voices === "object") {
    for (const [lang, name] of Object.entries(value.voices)) if (/^[a-z]{2,3}$/.test(lang) && typeof name === "string" && name) voices[lang] = name;
  }
  if (typeof value.voice === "string" && value.voice && !voices.en) voices.en = value.voice;
  return {
    voices,
    allowNetworkVoices: Boolean(value.allowNetworkVoices),
    rate: finite(value.rate, base.rate, 0.5, 3),
    pitch: finite(value.pitch, base.pitch, 0, 2),
    volume: finite(value.volume, base.volume, 0, 1),
    autoAdvance: value.autoAdvance !== false,
    readCode: Boolean(value.readCode),
    announceHeadings: Boolean(value.announceHeadings),
    theme: ["system", "light", "dark"].includes(value.theme) ? value.theme : base.theme,
    pronunciations: Array.isArray(value.pronunciations) ? value.pronunciations.filter((rule) => rule && rule.from && rule.to).map((rule) => ({ from: String(rule.from), to: String(rule.to) })) : [],
    cps: finite(value.cps, base.cps, 6, 40),
    onboarded: Boolean(value.onboarded)
  };
};

export const normalizePlayer = (raw = {}) => {
  const base = defaultPlayer();
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    itemId: typeof value.itemId === "string" ? value.itemId : "",
    pos: value.pos && Number.isInteger(value.pos.b) && Number.isInteger(value.pos.s) ? { b: value.pos.b, s: value.pos.s } : null,
    status: PLAYER_STATUS.includes(value.status) ? value.status : base.status,
    error: typeof value.error === "string" ? value.error : "",
    updatedAt: Number(value.updatedAt) || 0,
    sleepAt: Number(value.sleepAt) || 0
  };
};

export const normalizeQueue = (raw) => {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set();
  return {
    items: items.filter((item) => item && typeof item.id === "string" && !seen.has(item.id) && seen.add(item.id)).map((item) => ({
      id: item.id,
      url: typeof item.url === "string" ? item.url : "",
      title: normalizeSpace(item.title) || "Untitled",
      site: typeof item.site === "string" ? item.site : siteFromUrl(item.url),
      author: typeof item.author === "string" ? item.author : "",
      published: typeof item.published === "string" ? item.published : "",
      lang: typeof item.lang === "string" ? item.lang : "",
      source: ["page", "selection", "paste", "sample"].includes(item.source) ? item.source : "paste",
      words: Number(item.words) || 0,
      chars: Number(item.chars) || 0,
      status: item.status === "done" ? "done" : "queued",
      addedAt: Number(item.addedAt) || Date.now(),
      finishedAt: Number(item.finishedAt) || 0,
      pos: item.pos && Number.isInteger(item.pos.b) && Number.isInteger(item.pos.s) ? { b: item.pos.b, s: item.pos.s } : null,
      progress: finite(item.progress, 0, 0, 1),
      listenedMs: Number(item.listenedMs) || 0,
      excerpt: typeof item.excerpt === "string" ? item.excerpt.slice(0, 240) : ""
    }))
  };
};

export const normalizeStats = (raw) => ({ days: raw?.days && typeof raw.days === "object" ? raw.days : {} });

export const readAll = async () => {
  const data = await chrome.storage.local.get([KEYS.settings, KEYS.queue, KEYS.player, KEYS.stats]);
  return {
    settings: normalizeSettings(data.settings),
    queue: normalizeQueue(data.queue || emptyQueue()),
    player: normalizePlayer(data.player),
    stats: normalizeStats(data.stats)
  };
};

export const readDoc = async (id) => {
  const key = docKey(id);
  const data = await chrome.storage.local.get(key);
  return data[key] || null;
};

export class StorageError extends Error {
  constructor(cause) {
    const text = String(cause?.message || cause || "");
    super(/quota|QUOTA_BYTES|space/i.test(text) ? "Storage is full. Export your queue, then clear listened items." : "QueueTTS couldn't save. Try again, or reload the extension.");
    this.name = "StorageError";
    this.quota = /quota|QUOTA_BYTES|space/i.test(text);
  }
}

export const write = async (values) => {
  try {
    await chrome.storage.local.set(values);
  } catch (error) {
    throw new StorageError(error);
  }
};

export const blocksFromText = (text) => String(text ?? "")
  .replace(/\r/g, "")
  .split(/\n\s*\n+/)
  .map((chunk) => normalizeSpace(chunk.replace(/\n/g, " ")))
  .filter(Boolean)
  .map((t) => ({ k: "p", t }));

export const metaFromDoc = (doc, extra = {}) => {
  const text = doc.blocks.map((block) => block.t).join(" ");
  const url = canonicalUrl(extra.url || doc.url || "");
  return {
    id: extra.id || `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    url,
    title: normalizeSpace(extra.title || doc.title) || (doc.blocks.find((block) => block.k === "p")?.t || "Untitled").slice(0, 80),
    site: extra.site || doc.site || siteFromUrl(url),
    author: doc.byline || "",
    published: doc.published || "",
    lang: doc.lang || "",
    source: extra.source || "page",
    words: wordCount(text),
    chars: text.length,
    status: "queued",
    addedAt: Date.now(),
    finishedAt: 0,
    pos: null,
    progress: 0,
    listenedMs: 0,
    excerpt: doc.blocks.find((block) => block.k === "p")?.t.slice(0, 240) || ""
  };
};

export const migrateLegacy = (legacy) => {
  const settings = legacy?.settings || {};
  const items = [];
  const docs = {};
  for (const old of Array.isArray(legacy?.queue) ? legacy.queue : []) {
    if (!old || old.state === "failed" || !old.text) continue;
    const blocks = blocksFromText(old.text);
    if (!blocks.length) continue;
    const meta = metaFromDoc({ blocks }, { id: old.id, url: old.sourceUrl, title: old.title, source: ["selection", "page"].includes(old.sourceType) ? old.sourceType : "paste" });
    meta.addedAt = Number(old.capturedAt) || Date.now();
    if (old.state === "completed") Object.assign(meta, { status: "done", finishedAt: Number(old.completedAt) || meta.addedAt, progress: 1 });
    items.push(meta);
    docs[docKey(meta.id)] = { blocks };
  }
  const pronunciations = String(settings.dictionary || "").split("\n").map((line) => line.split("=>")).filter((pair) => pair.length === 2).map(([from, to]) => ({ from: from.trim(), to: to.trim() }));
  return {
    settings: normalizeSettings({ voice: settings.voiceName, rate: settings.rate, pitch: settings.pitch, volume: settings.volume, theme: settings.theme, pronunciations, onboarded: true }),
    queue: { items },
    docs
  };
};
