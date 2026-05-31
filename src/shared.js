export const STORAGE_KEY = "queuetts:v2";
export const MIN_TEXT_LENGTH = 16;
export const DEFAULT_RATE = 1;
export const QUEUE_STATES = ["queued", "playing", "paused", "completed", "failed"];

export const defaultSettings = () => ({
  voiceName: "",
  lang: "",
  rate: DEFAULT_RATE,
  pitch: 1,
  volume: 1,
  skipSeconds: 15,
  headingMode: "cue",
  sleepMinutes: 0,
  theme: "dark",
  dictionary: "",
  autoPlayCaptured: false,
  onboarded: false,
  reduceMotion: false
});

export const defaultPlayback = () => ({
  itemId: "",
  segmentIndex: 0,
  status: "idle",
  lastError: "",
  updatedAt: Date.now()
});

export const defaultState = () => ({
  version: 2,
  queue: [],
  settings: defaultSettings(),
  playback: defaultPlayback(),
  stats: {
    days: {}
  }
});

export const uid = (prefix = "qt") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const todayKey = () => new Date().toISOString().slice(0, 10);

export const fmtTime = (seconds) => {
  const raw = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(raw / 3600);
  const m = Math.floor((raw % 3600) / 60);
  const s = raw % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const wordCount = (text) => (String(text || "").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

export const estimateSeconds = (text, rate = DEFAULT_RATE) => {
  const words = wordCount(text);
  if (!words) return 0;
  const wpm = 178 * clamp(Number(rate) || DEFAULT_RATE, 0.5, 3);
  return Math.max(4, Math.round((words / wpm) * 60));
};

export const compactWhitespace = (value) => String(value || "")
  .replace(/\u00a0/g, " ")
  .replace(/[\t ]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/[ \t]+\n/g, "\n")
  .trim();

export const cleanupLines = (value) => String(value || "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => {
    if (!line) return true;
    if (/^(heading\.?\s*)?(owner|author|user|profile)?\s*(avatar|logo|icon|image|photo)$/i.test(line)) return false;
    if (/^(share|menu|close|open|search|previous|next|subscribe|sign in|sign up|advertisement|sponsored)$/i.test(line)) return false;
    return true;
  })
  .join("\n");

export const cleanText = (value) => compactWhitespace(cleanupLines(String(value || "")
  .replace(/\r/g, "")
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/\s+([,.!?;:])/g, "$1")));

export const parseDictionary = (raw) => String(raw || "")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const index = line.indexOf("=>");
    if (index === -1) return null;
    const from = line.slice(0, index).trim();
    const to = line.slice(index + 2).trim();
    if (!from || !to) return null;
    return { from, to };
  })
  .filter(Boolean);

export const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const applyDictionary = (text, raw) => {
  let output = String(text || "");
  for (const pair of parseDictionary(raw)) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(pair.from)}\\b`, "gi"), pair.to);
  }
  return output;
};

export const deriveTitle = (text, fallback = "Untitled capture") => {
  const firstLine = String(text || "").split("\n").map((line) => line.trim()).find(Boolean) || fallback;
  return firstLine.length > 84 ? `${firstLine.slice(0, 81).trim()}...` : firstLine;
};

export const hostFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Local text";
  }
};

export const normalizeItem = (raw) => {
  const text = cleanText(raw?.text || "");
  const title = cleanText(raw?.title || raw?.sourceTitle || deriveTitle(text));
  const state = QUEUE_STATES.includes(raw?.state) ? raw.state : "queued";
  const sourceUrl = typeof raw?.sourceUrl === "string" ? raw.sourceUrl : "";
  const sourceTitle = cleanText(raw?.sourceTitle || title);
  const sourceType = ["selection", "page", "paste", "import", "failed"].includes(raw?.sourceType) ? raw.sourceType : "paste";
  const rate = Number(raw?.rate) || DEFAULT_RATE;
  const item = {
    id: typeof raw?.id === "string" ? raw.id : uid("item"),
    title: title || "Untitled capture",
    text,
    sourceType,
    sourceTitle: sourceTitle || title || "Untitled source",
    sourceUrl,
    capturedAt: Number(raw?.capturedAt) || Date.now(),
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    completedAt: Number(raw?.completedAt) || 0,
    state,
    error: typeof raw?.error === "string" ? raw.error : "",
    segmentIndex: Math.max(0, Number(raw?.segmentIndex) || 0),
    wordCount: Number(raw?.wordCount) || wordCount(text),
    estimateSeconds: Number(raw?.estimateSeconds) || estimateSeconds(text, rate),
    headingMode: ["cue", "pause", "off"].includes(raw?.headingMode) ? raw.headingMode : "cue",
    lang: typeof raw?.lang === "string" ? raw.lang : ""
  };
  if (item.state !== "failed" && item.text.length < MIN_TEXT_LENGTH) item.state = "failed";
  if (item.state === "failed" && !item.error) item.error = "Capture did not contain enough readable text.";
  return item;
};

export const createQueueItem = ({ title, text, sourceType = "paste", sourceTitle = "", sourceUrl = "", headingMode = "cue", lang = "", state = "queued", error = "" }, settings = defaultSettings()) => normalizeItem({
  id: uid("item"),
  title: title || deriveTitle(text, sourceTitle || "Untitled capture"),
  text,
  sourceType,
  sourceTitle: sourceTitle || title || deriveTitle(text),
  sourceUrl,
  headingMode: headingMode || settings.headingMode || "cue",
  lang: lang || settings.lang || "",
  state,
  error,
  rate: settings.rate,
  capturedAt: Date.now(),
  updatedAt: Date.now()
});

export const normalizeState = (raw) => {
  const base = defaultState();
  if (!raw || typeof raw !== "object") return base;
  const settings = { ...base.settings, ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {}) };
  settings.rate = clamp(Number(settings.rate) || DEFAULT_RATE, 0.5, 3);
  settings.pitch = clamp(Number(settings.pitch) || 1, 0, 2);
  settings.volume = clamp(Number(settings.volume) || 1, 0, 1);
  settings.skipSeconds = [10, 15, 30, 45, 60].includes(Number(settings.skipSeconds)) ? Number(settings.skipSeconds) : 15;
  settings.sleepMinutes = clamp(Number(settings.sleepMinutes) || 0, 0, 180);
  settings.headingMode = ["cue", "pause", "off"].includes(settings.headingMode) ? settings.headingMode : "cue";
  settings.theme = ["dark", "light"].includes(settings.theme) ? settings.theme : "dark";
  const queue = Array.isArray(raw.queue) ? raw.queue.map((item) => normalizeItem(item)) : [];
  const playback = { ...base.playback, ...(raw.playback && typeof raw.playback === "object" ? raw.playback : {}) };
  if (!queue.some((item) => item.id === playback.itemId)) playback.itemId = queue.find((item) => item.state !== "completed" && item.state !== "failed")?.id || queue[0]?.id || "";
  playback.segmentIndex = Math.max(0, Number(playback.segmentIndex) || 0);
  playback.status = ["idle", "playing", "paused", "loading", "error"].includes(playback.status) ? playback.status : "idle";
  const stats = raw.stats && typeof raw.stats === "object" ? raw.stats : base.stats;
  return { version: 2, queue, settings, playback, stats: { days: stats.days && typeof stats.days === "object" ? stats.days : {} } };
};

export const readState = async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(data[STORAGE_KEY]);
};

export const writeState = async (state) => {
  const normalized = normalizeState(state);
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
};

export const updateState = async (updater) => {
  const current = await readState();
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  return writeState(next);
};

export const addItemToState = async (item, options = {}) => updateState((state) => {
  const normalized = normalizeItem(item);
  const queue = [normalized, ...state.queue];
  const playback = state.playback.itemId ? state.playback : { ...state.playback, itemId: normalized.id, segmentIndex: 0, status: "idle" };
  const day = todayKey();
  const previous = state.stats.days[day] || { itemsCaptured: 0, itemsCompleted: 0, wordsCaptured: 0, secondsListened: 0 };
  return {
    ...state,
    queue,
    playback: options.activate ? { ...playback, itemId: normalized.id, segmentIndex: 0 } : playback,
    stats: {
      days: {
        ...state.stats.days,
        [day]: {
          ...previous,
          itemsCaptured: Number(previous.itemsCaptured || 0) + 1,
          wordsCaptured: Number(previous.wordsCaptured || 0) + normalized.wordCount
        }
      }
    }
  };
});

export const currentItem = (state) => state.queue.find((item) => item.id === state.playback.itemId) || state.queue.find((item) => item.state === "playing" || item.state === "paused") || state.queue.find((item) => item.state === "queued") || state.queue[0] || null;

export const isHeading = (line) => {
  const value = String(line || "").trim();
  if (!value) return false;
  if (/^#{1,6}\s+\S+/.test(value)) return true;
  if (value.length <= 96 && value.length >= 3 && !/[.!?]$/.test(value) && /^[\p{L}\p{N}][\p{L}\p{N}\s:'"()&,.\-/]+$/u.test(value)) {
    const words = value.split(/\s+/).length;
    const caps = (value.match(/[A-Z]/g) || []).length;
    return words <= 12 && caps >= 1;
  }
  return false;
};

export const splitSentences = (text) => {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[.!?…])\s+(?=["“‘'([\p{L}\p{N}])/gu).map((part) => part.trim()).filter(Boolean);
  if (parts.length) return parts;
  const chunks = [];
  for (let index = 0; index < normalized.length; index += 240) chunks.push(normalized.slice(index, index + 240).trim());
  return chunks.filter(Boolean);
};

export const segmentText = (text, headingMode = "cue") => {
  const lines = cleanText(text).split("\n");
  const segments = [];
  let buffer = [];
  const flush = () => {
    const value = buffer.join(" ").trim();
    buffer = [];
    for (const sentence of splitSentences(value)) segments.push({ type: "speech", text: sentence });
  };
  for (const line of lines) {
    const value = line.trim();
    if (!value) {
      flush();
      continue;
    }
    if (headingMode !== "off" && isHeading(value)) {
      flush();
      const heading = value.replace(/^#{1,6}\s+/, "").trim();
      if (headingMode === "cue") segments.push({ type: "speech", text: `Heading. ${heading}.` });
      if (headingMode === "pause") {
        segments.push({ type: "speech", text: heading });
        segments.push({ type: "pause", text: "", duration: 650 });
      }
      continue;
    }
    buffer.push(value);
  }
  flush();
  return segments.length ? segments : [{ type: "speech", text: cleanText(text) }];
};

export const segmentEstimate = (segment, rate = DEFAULT_RATE) => segment.type === "pause" ? Math.max(0.4, Number(segment.duration || 650) / 1000) : estimateSeconds(segment.text, rate);

export const timeline = (segments, rate = DEFAULT_RATE) => {
  let offset = 0;
  return segments.map((segment, index) => {
    const duration = segmentEstimate(segment, rate);
    const row = { index, start: offset, duration, end: offset + duration };
    offset += duration;
    return row;
  });
};

export const progressFor = (item, segmentIndex, settings = defaultSettings()) => {
  if (!item) return { percent: 0, elapsed: 0, total: 0, remaining: 0 };
  const segments = segmentText(item.text, item.headingMode || settings.headingMode);
  const rows = timeline(segments, settings.rate);
  const total = rows.at(-1)?.end || estimateSeconds(item.text, settings.rate);
  const safeIndex = clamp(Number(segmentIndex) || 0, 0, Math.max(0, segments.length - 1));
  const elapsed = rows[safeIndex]?.start || 0;
  return { percent: total ? Math.round((elapsed / total) * 100) : 0, elapsed, total, remaining: Math.max(0, total - elapsed), segment: segments[safeIndex] || null, count: segments.length };
};

export const queueSummary = (state) => {
  const queued = state.queue.filter((item) => item.state === "queued").length;
  const completed = state.queue.filter((item) => item.state === "completed").length;
  const failed = state.queue.filter((item) => item.state === "failed").length;
  const words = state.queue.reduce((sum, item) => sum + item.wordCount, 0);
  const seconds = state.queue.reduce((sum, item) => sum + item.estimateSeconds, 0);
  return { total: state.queue.length, queued, completed, failed, words, seconds };
};

export const serializeExport = (state) => JSON.stringify({ exportedAt: new Date().toISOString(), product: "QueueTTS", state: normalizeState(state) }, null, 2);

export const parseImport = (raw) => {
  const data = JSON.parse(raw);
  if (data?.state) return normalizeState(data.state);
  return normalizeState(data);
};

export const storageBytes = async () => {
  if (!chrome.storage.local.getBytesInUse) return 0;
  return chrome.storage.local.getBytesInUse(null);
};
