import { addItem, clearHistory, findByUrl, findItem, markDone, markUnplayed, mergeQueues, moveQueued, moveToFront, nextAfter, queuedItems, removeItem, updateItem } from "../lib/queue.js";
import { blocksFromText, defaultPlayer, docKey, KEYS, LEGACY_KEY, metaFromDoc, migrateLegacy, normalizeQueue, normalizeSettings, readAll, readDoc, SCHEMA, StorageError, write } from "../lib/store.js";
import { buildPlan, canonicalUrl, localDay, progressAt, toSpeech, unitIndex } from "../lib/text.js";
import { pickVoice, preferredVoiceName } from "../lib/voices.js";

const MENU_PAGE = "qtts-page";
const MENU_SELECTION = "qtts-selection";
const SLEEP_ALARM = "qtts-sleep";
const WATCHDOG_ALARM = "qtts-watchdog";
const STALL_MS = 12000;
const FLUSH_MS = 20000;
const ACTIVE = new Set(["playing", "preparing", "recovering"]);

const tts = () => globalThis.__qttsTTS || chrome.tts;

let state = null;
const runtime = { token: 0, plan: null, planKey: "", index: -1, unitStartedAt: 0, pendingMs: 0, lastFlush: 0, pauseTimer: 0, voiceFallback: false, ports: new Set(), voices: null, trace: null, audioWarmUntil: 0, engineWarmAt: 0, voiceHasWords: true, confirmTimer: 0 };

const startTrace = (reason) => {
  runtime.trace = { reason, at: Date.now(), t0: performance.now(), marks: [], done: false };
};

const mark = (name, extra = {}) => {
  const trace = runtime.trace;
  if (!trace || trace.done) return;
  trace.marks.push({ name, ms: Math.round((performance.now() - trace.t0) * 10) / 10, ...extra });
  if (name === "first word" || name === "error") {
    trace.done = true;
    const { t0, ...saved } = trace;
    chrome.storage.session.set({ lastStart: saved }).catch(() => {});
  }
};

let chain = Promise.resolve();
const exclusive = (task) => {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
};

const load = async () => {
  if (state) return state;
  const stored = await chrome.storage.local.get([KEYS.schema, LEGACY_KEY]);
  if (stored[KEYS.schema] !== SCHEMA && stored[LEGACY_KEY]) {
    const migrated = migrateLegacy(stored[LEGACY_KEY]);
    await chrome.storage.local.set({ [KEYS.settings]: migrated.settings, [KEYS.queue]: migrated.queue, [KEYS.player]: defaultPlayer(), ...migrated.docs, [KEYS.schema]: SCHEMA });
    await chrome.storage.local.remove(LEGACY_KEY);
  } else if (stored[KEYS.schema] !== SCHEMA) {
    await chrome.storage.local.set({ [KEYS.schema]: SCHEMA });
  }
  state = await readAll();
  return state;
};

const setHealth = (message = "") => chrome.storage.session.set({ health: message ? { storage: message, at: Date.now() } : {} }).catch(() => {});

const persist = async (values) => {
  try {
    await write(values);
    if (runtime.healthBad) {
      runtime.healthBad = false;
      await setHealth("");
    }
  } catch (error) {
    runtime.healthBad = true;
    await setHealth(error instanceof StorageError ? error.message : "QueueTTS couldn't save.");
    throw error;
  }
};

const saveQueue = () => persist({ [KEYS.queue]: state.queue });
const savePlayer = () => persist({ [KEYS.player]: state.player });
const saveSettings = () => persist({ [KEYS.settings]: state.settings });

let watchdogOn = null;
const syncWatchdog = () => {
  const wanted = ACTIVE.has(state.player.status);
  if (wanted === watchdogOn) return;
  watchdogOn = wanted;
  if (wanted) chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
  else chrome.alarms.clear(WATCHDOG_ALARM);
};

const setPlayer = async (patch) => {
  state.player = { ...state.player, ...patch, updatedAt: Date.now() };
  await savePlayer();
  syncWatchdog();
  updateBadge();
};

const broadcast = (message) => {
  for (const port of runtime.ports) {
    try {
      port.postMessage(message);
    } catch {
      runtime.ports.delete(port);
    }
  }
};

const currentItem = () => (state.player.itemId ? findItem(state.queue, state.player.itemId) : null);

const updateBadge = () => {
  if (!state) return;
  const count = queuedItems(state.queue).length;
  const playing = state.player.status === "playing" || state.player.status === "preparing";
  chrome.action.setBadgeText({ text: count ? String(Math.min(count, 999)) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: playing ? "#C2410C" : "#1B1A17" }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" })?.catch?.(() => {});
  chrome.action.setTitle({ title: playing ? `QueueTTS · Playing “${currentItem()?.title || ""}”` : count ? `QueueTTS · ${count} in queue` : "QueueTTS" }).catch(() => {});
};

const AUDIO_DOCUMENT = "pages/audio.html";
const AUDIO_WARM_MS = 90000;
let audioCreating = null;

const ensureAudioDocument = async () => {
  if (!chrome.offscreen?.createDocument) return false;
  const existing = await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
  if (existing?.length) return true;
  audioCreating ||= chrome.offscreen.createDocument({
    url: AUDIO_DOCUMENT,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Keeps the audio output awake so the first words of speech are not cut off."
  }).catch((error) => {
    if (!/single offscreen|already/i.test(String(error?.message || error))) throw error;
  }).finally(() => {
    audioCreating = null;
  });
  await audioCreating;
  return true;
};

const warmAudio = async (ms = AUDIO_WARM_MS) => {
  const wasWarm = Date.now() < runtime.audioWarmUntil;
  runtime.audioWarmUntil = Date.now() + ms;
  try {
    if (!(await ensureAudioDocument())) return { wasWarm, running: false };
    const status = await chrome.runtime.sendMessage({ target: "qtts-audio", action: "warm", ms });
    return { wasWarm, ...(status || {}) };
  } catch {
    return { wasWarm, running: false };
  }
};

const warmEngine = async () => {
  if (!state || ACTIVE.has(state.player.status) || Date.now() - runtime.engineWarmAt < 45000) return;
  const item = currentItem() || queuedItems(state.queue)[0];
  const voice = await resolveVoice(item?.lang);
  if (ACTIVE.has(state.player.status)) return;
  runtime.engineWarmAt = Date.now();
  const options = { volume: 0, enqueue: false, onEvent: () => {} };
  if (voice) options.voiceName = voice.voiceName;
  try {
    tts().speak(".", options, () => void chrome.runtime.lastError);
  } catch {}
};

const getVoices = () => new Promise((resolve) => {
  try {
    tts().getVoices((voices) => resolve(Array.isArray(voices) ? voices : []));
  } catch {
    resolve([]);
  }
});

const resolveVoice = async (lang) => {
  const wanted = preferredVoiceName(state.settings, lang);
  const stale = wanted && !runtime.voices?.some((voice) => voice.voiceName === wanted) && Date.now() - (runtime.voicesAt || 0) > 3000;
  if (!runtime.voices?.length || stale) {
    runtime.voices = await getVoices();
    runtime.voicesAt = Date.now();
  }
  const settings = runtime.voiceFallback ? { ...state.settings, voices: {} } : state.settings;
  return pickVoice(runtime.voices, settings, lang || "en").voice;
};

const planKey = (item) => `${item.id}|${state.settings.readCode}|${state.settings.announceHeadings}`;

const loadPlan = async (item) => {
  const key = planKey(item);
  if (runtime.planKey === key && runtime.plan) return runtime.plan;
  const doc = await readDoc(item.id);
  if (!doc) return null;
  runtime.plan = buildPlan(doc, { lang: item.lang || "en", readCode: state.settings.readCode, announceHeadings: state.settings.announceHeadings });
  runtime.planKey = key;
  return runtime.plan;
};

const flushListening = async (force = false) => {
  const item = currentItem();
  const ms = runtime.pendingMs;
  if (!force && Date.now() - runtime.lastFlush < FLUSH_MS) return;
  runtime.lastFlush = Date.now();
  runtime.pendingMs = 0;
  const values = {};
  if (item) {
    const plan = runtime.plan && runtime.planKey === planKey(item) ? runtime.plan : null;
    const progress = plan && runtime.index >= 0 ? progressAt(plan, runtime.index) : item.progress;
    state.queue = updateItem(state.queue, item.id, (entry) => ({ listenedMs: entry.listenedMs + ms, pos: state.player.pos, progress }));
    values[KEYS.queue] = state.queue;
  }
  if (ms > 0) {
    const day = localDay();
    const days = { ...state.stats.days };
    const previous = days[day] || { ms: 0, finished: 0 };
    days[day] = { ...previous, ms: previous.ms + ms };
    for (const key of Object.keys(days).sort().slice(0, -120)) delete days[key];
    state.stats = { days };
    values[KEYS.stats] = state.stats;
    values[KEYS.settings] = state.settings;
  }
  if (Object.keys(values).length) await persist(values).catch(() => {});
};

const stopSpeech = () => {
  runtime.token += 1;
  clearTimeout(runtime.pauseTimer);
  clearTimeout(runtime.confirmTimer);
  if (runtime.unitStartedAt) runtime.pendingMs += Date.now() - runtime.unitStartedAt;
  runtime.unitStartedAt = 0;
  try {
    tts().stop();
  } catch {}
};

const fail = async (message) => {
  stopSpeech();
  await flushListening(true);
  await setPlayer({ status: "error", error: message });
};

const finishItem = async ({ advance = state.settings.autoAdvance } = {}) => {
  const item = currentItem();
  stopSpeech();
  await flushListening(true);
  if (!item) return setPlayer({ status: "idle", itemId: "", pos: null, progress: 0 });
  state.queue = markDone(state.queue, item.id);
  const day = localDay();
  const days = { ...state.stats.days };
  days[day] = { ms: days[day]?.ms || 0, finished: (days[day]?.finished || 0) + 1 };
  state.stats = { days };
  const next = nextAfter(state.queue, item.id);
  const sleepAtEnd = state.player.sleepAt === -1;
  await persist({ [KEYS.queue]: state.queue, [KEYS.stats]: state.stats });
  if (!next) return setPlayer({ status: "completed", itemId: "", pos: null, progress: 0, error: "", sleepAt: sleepAtEnd ? 0 : state.player.sleepAt });
  state.player = { ...state.player, itemId: next.id, pos: next.pos, progress: next.progress, error: "" };
  if (!advance || sleepAtEnd) return setPlayer({ status: "paused", sleepAt: sleepAtEnd ? 0 : state.player.sleepAt });
  return speakCurrent();
};

const speakUnit = async (index, token) => {
  const plan = runtime.plan;
  const item = currentItem();
  if (token !== runtime.token || !plan || !item) return;
  if (index >= plan.units.length) return finishItem();
  const unit = plan.units[index];
  runtime.index = index;
  const spoken = `${unit.lead}${toSpeech(unit.text, state.settings.pronunciations, { lang: item.lang || "en", close: unit.close })}`;
  if (!spoken.replace(/[^\p{L}\p{N}]/gu, "")) return speakUnit(index + 1, token);
  const voice = await resolveVoice(item.lang);
  mark("voice ready", { voice: voice?.voiceName || "default", remote: Boolean(voice?.remote) });
  runtime.voiceHasWords = !voice || !Array.isArray(voice.eventTypes) || voice.eventTypes.includes("word");
  if (token !== runtime.token) return;
  const options = {
    rate: state.settings.rate,
    pitch: state.settings.pitch,
    volume: state.settings.volume,
    enqueue: false,
    desiredEventTypes: ["start", "word", "end", "error", "interrupted", "cancelled"],
    onEvent: (event) => exclusive(() => onSpeechEvent(event, token, index, spoken))
  };
  if (voice) options.voiceName = voice.voiceName;
  if (item.lang) options.lang = item.lang;
  const go = () => {
    if (token !== runtime.token) return;
    mark("speak called", { text: spoken.slice(0, 40) });
    try {
      tts().speak(spoken, options, () => {
        mark("engine accepted");
        const error = chrome.runtime.lastError;
        if (error) exclusive(() => token === runtime.token && onSpeechError(error.message, token, index));
      });
    } catch (error) {
      exclusive(() => onSpeechError(error?.message || String(error), token, index));
    }
  };
  if (unit.pause && state.player.status === "playing") runtime.pauseTimer = setTimeout(go, unit.pause);
  else go();
};

const onSpeechError = async (message, token, index) => {
  if (token !== runtime.token) return;
  if (preferredVoiceName(state.settings, currentItem()?.lang) && !runtime.voiceFallback) {
    runtime.voiceFallback = true;
    runtime.token += 1;
    return speakUnit(index, runtime.token);
  }
  return fail(message ? `Speech failed: ${message}` : "Speech failed. Try another voice in Settings.");
};

const confirmPlaying = async (token) => {
  clearTimeout(runtime.confirmTimer);
  if (token !== runtime.token || state.player.status === "playing" || !ACTIVE.has(state.player.status)) return;
  await setPlayer({ status: "playing" }).catch(() => {});
};

const onSpeechEvent = async (event, token, index, spoken) => {
  if (token !== runtime.token) return;
  const plan = runtime.plan;
  const item = currentItem();
  if (!plan || !item) return;
  const unit = plan.units[index];
  if (event.type === "start") {
    mark("start event", { charIndex: event.charIndex ?? 0 });
    runtime.unitStartedAt = Date.now();
    const audible = state.player.status === "playing" || !runtime.voiceHasWords;
    state.player = { ...state.player, status: audible ? "playing" : state.player.status, error: "", pos: { b: unit.b, s: unit.s }, progress: progressAt(plan, index), updatedAt: Date.now() };
    broadcast({ t: "unit", id: item.id, b: unit.b, s: unit.s });
    await savePlayer().catch(() => {});
    syncWatchdog();
    updateBadge();
    if (!audible) {
      clearTimeout(runtime.confirmTimer);
      runtime.confirmTimer = setTimeout(() => exclusive(() => confirmPlaying(token)), 900);
    }
    if (runtime.audioWarmUntil - Date.now() < AUDIO_WARM_MS / 2) warmAudio();
    return;
  }
  if (event.type === "word") {
    mark("first word", { charIndex: event.charIndex });
    if (state.player.status !== "playing") await confirmPlaying(token);
    broadcast({ t: "word", id: item.id, b: unit.b, s: unit.s, c: event.charIndex, n: event.length || 0, spoken });
    return;
  }
  if (event.type === "end") {
    if (state.player.status !== "playing") await confirmPlaying(token);
    if (runtime.unitStartedAt) {
      const elapsed = Date.now() - runtime.unitStartedAt;
      runtime.pendingMs += elapsed;
      if (elapsed > 600 && spoken.length > 40) {
        const measured = spoken.length / (elapsed / 1000) / state.settings.rate;
        if (measured > 6 && measured < 40) state.settings = { ...state.settings, cps: Math.round((state.settings.cps * 0.9 + measured * 0.1) * 100) / 100 };
      }
    }
    runtime.unitStartedAt = 0;
    await flushListening();
    return speakUnit(index + 1, token);
  }
  if (event.type === "error") return onSpeechError(event.errorMessage, token, index);
  if (event.type === "interrupted" || event.type === "cancelled") {
    stopSpeech();
    await flushListening(true);
    await setPlayer({ status: "paused" });
  }
};

const speakCurrent = async ({ recovering = false } = {}) => {
  stopSpeech();
  const token = runtime.token;
  const item = currentItem();
  if (!item) return setPlayer({ status: state.queue.items.some((entry) => entry.status === "queued") ? "paused" : "idle", itemId: queuedItems(state.queue)[0]?.id || "", pos: null });
  if (!runtime.trace || runtime.trace.done) startTrace(recovering ? "recover" : "advance");
  mark("previous speech stopped");
  const audio = warmAudio();
  await setPlayer({ status: recovering ? "recovering" : "preparing", error: "" });
  mark("state saved");
  const cached = runtime.planKey === planKey(item);
  const plan = await loadPlan(item);
  mark("text ready", { cached, units: plan?.units.length || 0 });
  const path = await Promise.race([audio, new Promise((resolve) => setTimeout(() => resolve({ running: false, slow: true }), 800))]);
  mark("audio path ready", { wasWarm: Boolean(path.wasWarm), running: Boolean(path.running) });
  if (token !== runtime.token) return;
  if (!plan || !plan.units.length) {
    state.queue = removeItem(state.queue, item.id);
    await saveQueue();
    await setPlayer({ itemId: nextAfter(state.queue, item.id)?.id || "", pos: null, status: "error", error: "That item had no readable text, so it was removed." });
    return;
  }
  runtime.voiceFallback = false;
  const index = unitIndex(plan, state.player.pos);
  return speakUnit(index, token);
};

const play = async (itemId = "") => {
  startTrace("play");
  mark("command");
  const target =itemId ? findItem(state.queue, itemId) : currentItem() || queuedItems(state.queue)[0];
  if (!target) return { ok: false, message: "Your queue is empty." };
  if (target.id !== state.player.itemId) {
    stopSpeech();
    await flushListening(true);
    if (target.status === "done") state.queue = markUnplayed(state.queue, target.id);
    state.queue = moveToFront(state.queue, target.id);
    const fresh = findItem(state.queue, target.id);
    state.player = { ...state.player, itemId: fresh.id, pos: fresh.pos, progress: fresh.progress };
    await saveQueue();
  } else if (target.status === "done") {
    state.queue = moveToFront(markUnplayed(state.queue, target.id), target.id);
    state.player = { ...state.player, pos: null, progress: 0 };
    await saveQueue();
  }
  await speakCurrent();
  return { ok: true };
};

const pause = async () => {
  if (!ACTIVE.has(state.player.status)) return { ok: true };
  stopSpeech();
  await flushListening(true);
  await setPlayer({ status: "paused" });
  return { ok: true };
};

const toggle = async () => (ACTIVE.has(state.player.status) ? pause() : play());

const skip = async (delta) => {
  const item = currentItem();
  if (!item) return { ok: false, message: "Nothing is playing." };
  const plan = await loadPlan(item);
  if (!plan) return { ok: false };
  const from = runtime.planKey === planKey(item) && runtime.index >= 0 && ACTIVE.has(state.player.status) ? runtime.index : unitIndex(plan, state.player.pos);
  const to = Math.max(0, Math.min(plan.units.length - 1, from + delta));
  const unit = plan.units[to];
  if (delta > 0 && from + delta >= plan.units.length) {
    if (ACTIVE.has(state.player.status)) return finishItem();
  }
  const wasActive = ACTIVE.has(state.player.status);
  state.player = { ...state.player, pos: { b: unit.b, s: unit.s }, progress: progressAt(plan, to) };
  if (wasActive) await speakCurrent();
  else {
    runtime.index = to;
    await setPlayer({});
    state.queue = updateItem(state.queue, item.id, { pos: state.player.pos, progress: state.player.progress });
    await saveQueue();
  }
  return { ok: true };
};

const seek = async (itemId, b, s) => {
  if (itemId !== state.player.itemId) {
    const item = findItem(state.queue, itemId);
    if (!item) return { ok: false };
    state.queue = updateItem(state.queue, itemId, { pos: { b, s } });
    return play(itemId);
  }
  state.player = { ...state.player, pos: { b, s } };
  await speakCurrent();
  return { ok: true };
};

const skipItem = async () => {
  const item = currentItem();
  if (!item) return { ok: false };
  const wasActive = ACTIVE.has(state.player.status);
  stopSpeech();
  await flushListening(true);
  const next = nextAfter(state.queue, item.id);
  if (!next) return { ok: false, message: "Nothing else is queued." };
  state.queue = moveQueued(state.queue, item.id, Number.MAX_SAFE_INTEGER);
  state.queue = moveToFront(state.queue, next.id);
  state.player = { ...state.player, itemId: next.id, pos: next.pos, progress: next.progress };
  await saveQueue();
  if (wasActive) await speakCurrent();
  else await setPlayer({ status: "paused" });
  return { ok: true };
};

const removeOne = async (id) => {
  const item = findItem(state.queue, id);
  if (!item) return { ok: false };
  const doc = await readDoc(id);
  const index = state.queue.items.indexOf(item);
  if (id === state.player.itemId) {
    stopSpeech();
    runtime.pendingMs = 0;
    const next = nextAfter(state.queue, id);
    state.player = { ...state.player, itemId: next?.id || "", pos: next?.pos || null, progress: next?.progress || 0, status: next ? "paused" : "idle" };
    await savePlayer();
  }
  state.queue = removeItem(state.queue, id);
  await saveQueue();
  await chrome.storage.local.remove(docKey(id));
  updateBadge();
  return { ok: true, removed: { item, doc, index } };
};

const restore = async ({ item, doc, index }) => {
  if (!item || !doc) return { ok: false };
  const items = state.queue.items.filter((entry) => entry.id !== item.id);
  items.splice(Math.min(Math.max(0, index), items.length), 0, item);
  state.queue = { ...state.queue, items };
  await persist({ [KEYS.queue]: state.queue, [docKey(item.id)]: doc });
  if (!state.player.itemId && item.status === "queued") await setPlayer({ itemId: queuedItems(state.queue)[0].id, status: "paused" });
  updateBadge();
  return { ok: true };
};

const addDoc = async (doc, { source = "page", placement = "end" } = {}) => {
  const url = canonicalUrl(doc.url || "");
  if (source === "page" && url) {
    const existing = findByUrl(state.queue, url);
    if (existing) return { ok: true, duplicate: true, item: existing, position: queuedItems(state.queue).findIndex((entry) => entry.id === existing.id) };
  }
  const meta = metaFromDoc(doc, { source });
  if (source === "selection" && doc.pageTitle) meta.excerpt = doc.pageTitle;
  const current = currentItem();
  const queue = addItem(state.queue, meta, { placement: current ? placement : "end", currentId: current?.id || "" });
  await persist({ [docKey(meta.id)]: { blocks: doc.blocks }, [KEYS.queue]: queue });
  state.queue = queue;
  if (!current) await setPlayer({ itemId: queuedItems(state.queue)[0].id, pos: queuedItems(state.queue)[0].pos, progress: queuedItems(state.queue)[0].progress, status: "paused", error: "" });
  updateBadge();
  return { ok: true, item: meta, position: queuedItems(state.queue).findIndex((entry) => entry.id === meta.id) };
};

const injectExtractor = async (tabId, full) => {
  const files = full ? ["src/vendor/Readability.js", "src/vendor/Readability-readerable.js", "src/content/extract.js"] : ["src/vendor/Readability-readerable.js", "src/content/extract.js"];
  await chrome.scripting.executeScript({ target: { tabId }, files });
};

const runExtractor = async (tabId, mode) => {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: (value) => globalThis.__qtts.run(value), args: [mode] });
  return result?.result;
};

const blockedMessage = (url = "") => {
  if (/^chrome:|^edge:|^about:|^chrome-extension:|^devtools:/i.test(url)) return "Chrome doesn't let extensions read this page.";
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) return "Chrome doesn't let extensions read the Web Store.";
  if (/\.pdf($|\?)/i.test(url)) return "PDFs aren't supported yet. Select text in the PDF and use Paste instead.";
  return "QueueTTS can't read this page. Try selecting the text, or paste it instead.";
};

const pageContext = async (tabId) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, reason: "blocked", message: "No page is open." };
  const url = canonicalUrl(tab.url || "");
  const base = { title: tab.title || "", url: tab.url || "", favIconUrl: tab.favIconUrl || "" };
  if (!/^https?:|^file:/i.test(tab.url || "")) return { ok: false, reason: "blocked", message: blockedMessage(tab.url), ...base };
  const existing = url ? findByUrl(state.queue, url) : null;
  try {
    await injectExtractor(tabId, false);
    const result = await runExtractor(tabId, "context");
    return { ...base, ...result, existing };
  } catch {
    return { ok: false, reason: "blocked", message: blockedMessage(tab.url), ...base, existing };
  }
};

const captureTab = async (tabId, mode = "page", placement = "end") => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !/^https?:|^file:/i.test(tab.url || "")) return { ok: false, reason: "blocked", message: blockedMessage(tab?.url) };
  let result;
  try {
    await injectExtractor(tabId, mode === "page");
    result = await runExtractor(tabId, mode);
  } catch {
    return { ok: false, reason: "blocked", message: blockedMessage(tab.url) };
  }
  if (!result?.ok) return result || { ok: false, reason: "error", message: "Capture failed." };
  return addDoc(result.doc, { source: mode, placement });
};

const addText = async (text, title = "") => {
  const blocks = blocksFromText(text);
  if (!blocks.length) return { ok: false, message: "Paste some text first." };
  return addDoc({ blocks, title: title || blocks[0].t.split(/(?<=[.!?])\s/)[0].slice(0, 90), url: "" }, { source: "paste" });
};

const SAMPLE = {
  title: "Welcome to QueueTTS",
  url: "",
  blocks: [
    { k: "p", t: "This is QueueTTS reading to you. Everything you add goes into a queue, and the queue plays in order, one article after another." },
    { k: "h", t: "Adding things", l: 2 },
    { k: "p", t: "Press Alt Shift A on any article to add it. If you select text first, only the selection is added. You can also right-click a page, or open the toolbar button." },
    { k: "h", t: "Picking up where you left off", l: 2 },
    { k: "p", t: "Pause whenever you like. When you come back, even after restarting Chrome, playback resumes from the sentence you stopped on." },
    { k: "p", t: "Your queue, and everything in it, stays on this computer." }
  ]
};

const captureFeedback = async (tabId, result) => {
  if (!tabId) return;
  const text = !result?.ok ? result?.message || "Couldn't add this page." : result.duplicate ? "Already in your queue" : result.position === 0 ? "Added · plays now" : `Added · #${result.position + 1} in queue`;
  const id = result?.ok && !result.duplicate ? result.item.id : "";
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text, id, Boolean(result?.ok)],
    func: (message, itemId, success) => {
      document.getElementById("qtts-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "qtts-toast-host";
      host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;";
      const root = host.attachShadow({ mode: "closed" });
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      root.innerHTML = `<style>
        .t{font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 14px;border-radius:10px;
        background:${dark ? "#EDEBE5" : "#1B1A17"};color:${dark ? "#1B1A17" : "#F7F5F0"};box-shadow:0 8px 28px rgba(0,0,0,.28);transform:translateY(8px);opacity:0;transition:transform .18s cubic-bezier(.2,.7,.2,1),opacity .18s}
        .t.in{transform:none;opacity:1}.d{width:8px;height:8px;border-radius:4px;background:${success ? "#E8590C" : "#9B9890"}}
        button{font:inherit;font-weight:600;color:inherit;background:transparent;border:0;padding:4px 6px;border-radius:6px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
        button:focus-visible{outline:2px solid #E8590C;outline-offset:2px}
        @media (prefers-reduced-motion: reduce){.t{transition:none}}</style>
        <div class="t" role="status"><span class="d"></span><span></span></div>`;
      root.querySelector("span:last-child").textContent = `QueueTTS · ${message}`;
      if (itemId) {
        const undo = document.createElement("button");
        undo.textContent = "Undo";
        undo.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "cmd", name: "remove", args: [itemId] });
          host.remove();
        });
        root.querySelector(".t").append(undo);
      }
      document.documentElement.append(host);
      requestAnimationFrame(() => root.querySelector(".t").classList.add("in"));
      setTimeout(() => host.remove(), 4200);
    }
  }).catch(() => {});
};

const quickCapture = async (tab, mode) => {
  if (!tab?.id) return;
  const result = await exclusive(async () => {
    await load();
    return captureTab(tab.id, mode);
  });
  await captureFeedback(tab.id, result);
};

const setSleep = async (minutes) => {
  await chrome.alarms.clear(SLEEP_ALARM);
  if (minutes === "end") return setPlayer({ sleepAt: -1 });
  const value = Number(minutes) || 0;
  if (value > 0) {
    await chrome.alarms.create(SLEEP_ALARM, { delayInMinutes: value });
    return setPlayer({ sleepAt: Date.now() + value * 60000 });
  }
  return setPlayer({ sleepAt: 0 });
};

const updateSettings = async (patch) => {
  const before = state.settings;
  state.settings = normalizeSettings({ ...before, ...patch });
  await saveSettings();
  if (patch.voices !== undefined || patch.allowNetworkVoices !== undefined) {
    runtime.voiceFallback = false;
    runtime.voices = null;
  }
  const replan = before.readCode !== state.settings.readCode || before.announceHeadings !== state.settings.announceHeadings;
  const respeak = ["rate", "pitch", "volume", "voices", "allowNetworkVoices", "pronunciations"].some((key) => key in patch);
  if (replan) runtime.planKey = "";
  if ((replan || respeak) && ACTIVE.has(state.player.status)) await speakCurrent();
  return { ok: true, settings: state.settings };
};

const importData = async ({ queue, docs, settings }) => {
  const incoming = normalizeQueue(queue);
  const { queue: merged, added } = mergeQueues(state.queue, incoming);
  const usable = added.filter((item) => docs?.[item.id]?.blocks?.length);
  const keep = new Set(usable.map((item) => item.id));
  state.queue = { ...merged, items: merged.items.filter((item) => !added.includes(item) || keep.has(item.id)) };
  const values = { [KEYS.queue]: state.queue };
  for (const item of usable) values[docKey(item.id)] = { blocks: docs[item.id].blocks };
  if (settings) {
    state.settings = normalizeSettings({ ...state.settings, ...settings, onboarded: true });
    values[KEYS.settings] = state.settings;
  }
  await persist(values);
  if (!state.player.itemId && queuedItems(state.queue).length) await setPlayer({ itemId: queuedItems(state.queue)[0].id, status: "paused" });
  updateBadge();
  return { ok: true, added: usable.length, skipped: incoming.items.length - usable.length };
};

const resetAll = async () => {
  stopSpeech();
  runtime.pendingMs = 0;
  runtime.plan = null;
  runtime.planKey = "";
  await chrome.alarms.clear(SLEEP_ALARM);
  const keep = state.settings;
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [KEYS.schema]: SCHEMA, [KEYS.settings]: keep, [KEYS.player]: defaultPlayer(), [KEYS.queue]: { items: [] }, [KEYS.stats]: { days: {} } });
  state = null;
  await load();
  updateBadge();
  return { ok: true };
};

const commands = {
  play: (id) => play(id),
  pause,
  toggle,
  skip: (delta) => skip(Number(delta) || 0),
  seek: (id, b, s) => seek(id, Number(b), Number(s)),
  skipItem,
  done: async (id) => {
    if (id === state.player.itemId) return finishItemManually();
    state.queue = markDone(state.queue, id);
    await saveQueue();
    updateBadge();
    return { ok: true };
  },
  unplayed: async (id) => {
    state.queue = markUnplayed(state.queue, id);
    await saveQueue();
    if (!state.player.itemId) await setPlayer({ itemId: id, status: "paused", pos: null, progress: 0 });
    updateBadge();
    return { ok: true };
  },
  playNext: async (id) => {
    const item = findItem(state.queue, id);
    if (!item) return { ok: false };
    if (item.status === "done") state.queue = markUnplayed(state.queue, id);
    state.queue = state.player.itemId ? moveQueued(state.queue, id, 1) : moveToFront(state.queue, id);
    await saveQueue();
    if (!state.player.itemId) await setPlayer({ itemId: id, status: "paused" });
    return { ok: true };
  },
  move: async (id, toIndex) => {
    const current = state.player.itemId;
    state.queue = moveQueued(state.queue, id, current && id !== current ? Math.max(1, Number(toIndex)) : Number(toIndex));
    await saveQueue();
    return { ok: true };
  },
  remove: removeOne,
  restore,
  clearHistory: async () => {
    const removed = state.queue.items.filter((item) => item.status === "done").map((item) => docKey(item.id));
    state.queue = clearHistory(state.queue);
    await saveQueue();
    if (removed.length) await chrome.storage.local.remove(removed);
    return { ok: true, count: removed.length };
  },
  capture: (tabId, mode, placement) => captureTab(tabId, mode, placement),
  context: (tabId) => pageContext(tabId),
  addText: (text, title) => addText(text, title),
  addSample: async () => {
    const existing = state.queue.items.find((item) => item.source === "sample" && item.status === "queued");
    const result = existing ? { ok: true, item: existing } : await addDoc(SAMPLE, { source: "sample", placement: "now" });
    if (result.ok) await play(result.item.id);
    return result;
  },
  settings: (patch) => updateSettings(patch || {}),
  sleep: (minutes) => setSleep(minutes),
  voices: async () => ({ ok: true, voices: (runtime.voices = await getVoices()) }),
  diagnostics: async () => {
    const { lastStart } = await chrome.storage.session.get("lastStart").catch(() => ({}));
    const live = runtime.trace ? (({ t0, ...rest }) => rest)(runtime.trace) : null;
    return { ok: true, lastStart: lastStart || null, live, voice: state.player.itemId ? (await resolveVoice(currentItem()?.lang))?.voiceName || "" : "" };
  },
  resolvedVoice: async (lang) => ({ ok: true, voice: await resolveVoice(lang) }),
  importData: (payload) => importData(payload || {}),
  reset: resetAll,
  dismissError: async () => {
    await setPlayer({ status: state.player.itemId ? "paused" : "idle", error: "" });
    return { ok: true };
  }
};

const finishItemManually = async () => {
  await finishItem({ advance: ACTIVE.has(state.player.status) && state.settings.autoAdvance });
  return { ok: true };
};

const boot = exclusive(async () => {
  await load();
  const session = await chrome.storage.session.get("booted").catch(() => ({}));
  if (!session.booted) {
    await chrome.storage.session.set({ booted: Date.now() }).catch(() => {});
    if (ACTIVE.has(state.player.status)) await setPlayer({ status: "paused" });
    if (state.player.sleepAt > 0 && state.player.sleepAt < Date.now()) await setPlayer({ sleepAt: 0 });
  } else if (ACTIVE.has(state.player.status)) {
    await speakCurrent({ recovering: true });
  }
  updateBadge();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Add page to QueueTTS", contexts: ["page"] });
    chrome.contextMenus.create({ id: MENU_SELECTION, title: "Add selection to QueueTTS", contexts: ["selection"] });
  });
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
  if (reason === "install") {
    exclusive(async () => {
      await boot;
      if (!state.settings.onboarded) chrome.tabs.create({ url: chrome.runtime.getURL("pages/welcome.html") });
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_PAGE) quickCapture(tab, "page");
  if (info.menuItemId === MENU_SELECTION) quickCapture(tab, "selection");
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "queue-page") {
    let mode = "page";
    if (tab?.id) {
      const context = await exclusive(async () => {
        await load();
        return pageContext(tab.id);
      }).catch(() => null);
      if (context?.selectionWords >= 3) mode = "selection";
    }
    return quickCapture(tab, mode);
  }
  if (command === "toggle-playback") return exclusive(async () => (await load(), toggle()));
  if (command === "skip-forward") return exclusive(async () => (await load(), skip(1)));
  if (command === "skip-back") return exclusive(async () => (await load(), skip(-1)));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SLEEP_ALARM) exclusive(async () => {
    await load();
    await pause();
    await setPlayer({ sleepAt: 0 });
  });
  if (alarm.name === WATCHDOG_ALARM) exclusive(async () => {
    await boot;
    if (!ACTIVE.has(state.player.status)) {
      watchdogOn = false;
      return chrome.alarms.clear(WATCHDOG_ALARM);
    }
    if (!runtime.unitStartedAt && Date.now() - state.player.updatedAt > STALL_MS) await speakCurrent({ recovering: true });
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ui") return;
  runtime.ports.add(port);
  exclusive(async () => {
    await boot;
    if (!ACTIVE.has(state.player.status) && currentItem()) {
      warmAudio(45000);
      await warmEngine();
    }
  });
  port.onDisconnect.addListener(() => runtime.ports.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "cmd" || !commands[message.name]) return false;
  exclusive(async () => {
    await boot;
    await load();
    return commands[message.name](...(Array.isArray(message.args) ? message.args : []));
  }).then((result) => sendResponse(result || { ok: true }), (error) => sendResponse({ ok: false, message: error?.message || String(error) }));
  return true;
});

chrome.runtime.onStartup.addListener(() => {});
