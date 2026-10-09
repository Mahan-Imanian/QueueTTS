import { findItem, markDone, markUnplayed, moveQueued, moveToFront, nextAfter, queuedItems, removeItem, updateItem } from "../lib/queue.js";
import { ACTIVE_STATUSES, KEYS, readDoc } from "../lib/store.js";
import { CPS_MAX, CPS_MIN, localDay, planForItem, planKey, progressAt, toSpeech, unitIndex } from "../lib/text.js";
import { preferredVoiceName } from "../lib/voices.js";
import { extendAudioWarmth, warmAudio } from "./audio.js";
import { currentItem, exclusive, persist, playerChanged, savePlayer, saveQueue, setPlayer, state } from "./state.js";
import { resolveVoice, tts, useFallbackVoice, usingFallbackVoice } from "./speech.js";
import { mark, startTrace, traceRunning } from "./trace.js";

const LISTENING_FLUSH_MS = 20000;
const STATS_RETENTION_DAYS = 120;
const START_CONFIRM_MS = 900;
const AUDIO_PATH_WAIT_MS = 800;
const RATE_SAMPLE_MIN_MS = 600;
const RATE_SAMPLE_MIN_CHARS = 40;
const RATE_SAMPLE_WEIGHT = 0.1;
const SPEECH_EVENTS = ["start", "word", "end", "error", "interrupted", "cancelled"];

const speech = { token: 0, plan: null, planKey: "", index: -1, unitStartedAt: 0, pendingMs: 0, lastFlush: 0, pauseTimer: 0, confirmTimer: 0, voiceHasWords: true };

export const ports = new Set();

const broadcast = (message) => {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
};

export const isSpeaking = () => Boolean(speech.unitStartedAt);

export const invalidatePlan = () => {
  speech.planKey = "";
};

export const dropPendingListening = () => {
  speech.pendingMs = 0;
};

export const resetPlayback = () => {
  stopSpeech();
  speech.pendingMs = 0;
  speech.plan = null;
  speech.planKey = "";
};

const loadPlan = async (item) => {
  const key = planKey(item, state.settings);
  if (speech.planKey === key && speech.plan) return speech.plan;
  const doc = await readDoc(item.id);
  if (!doc) return null;
  speech.plan = planForItem(doc, item, state.settings);
  speech.planKey = key;
  return speech.plan;
};

const recordListening = (days, ms) => {
  const day = localDay();
  const previous = days[day] || { ms: 0, finished: 0 };
  const next = { ...days, [day]: { ...previous, ms: previous.ms + ms } };
  for (const key of Object.keys(next).sort().slice(0, -STATS_RETENTION_DAYS)) delete next[key];
  return next;
};

const flushListening = async (force = false) => {
  const item = currentItem();
  const ms = speech.pendingMs;
  if (!force && Date.now() - speech.lastFlush < LISTENING_FLUSH_MS) return;
  speech.lastFlush = Date.now();
  speech.pendingMs = 0;
  const values = {};
  if (item) {
    const plan = speech.plan && speech.planKey === planKey(item, state.settings) ? speech.plan : null;
    const progress = plan && speech.index >= 0 ? progressAt(plan, speech.index) : item.progress;
    state.queue = updateItem(state.queue, item.id, (entry) => ({ listenedMs: entry.listenedMs + ms, pos: state.player.pos, progress }));
    values[KEYS.queue] = state.queue;
  }
  if (ms > 0) {
    state.stats = { days: recordListening(state.stats.days, ms) };
    values[KEYS.stats] = state.stats;
    values[KEYS.settings] = state.settings;
  }
  if (Object.keys(values).length) await persist(values).catch(() => {});
};

export const stopSpeech = () => {
  speech.token += 1;
  clearTimeout(speech.pauseTimer);
  clearTimeout(speech.confirmTimer);
  if (speech.unitStartedAt) speech.pendingMs += Date.now() - speech.unitStartedAt;
  speech.unitStartedAt = 0;
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

export const finishItemManually = async () => {
  await finishItem({ advance: ACTIVE_STATUSES.has(state.player.status) && state.settings.autoAdvance });
  return { ok: true };
};

const speakUnit = async (index, token) => {
  const plan = speech.plan;
  const item = currentItem();
  if (token !== speech.token || !plan || !item) return;
  if (index >= plan.units.length) return finishItem();
  const unit = plan.units[index];
  speech.index = index;
  const spoken = `${unit.lead}${toSpeech(unit.text, state.settings.pronunciations, { lang: item.lang || "en", close: unit.close })}`;
  if (!spoken.replace(/[^\p{L}\p{N}]/gu, "")) return speakUnit(index + 1, token);
  const voice = await resolveVoice(item.lang);
  mark("voice ready", { voice: voice?.voiceName || "default", remote: Boolean(voice?.remote) });
  speech.voiceHasWords = !voice || !Array.isArray(voice.eventTypes) || voice.eventTypes.includes("word");
  if (token !== speech.token) return;
  const options = {
    rate: state.settings.rate,
    pitch: state.settings.pitch,
    volume: state.settings.volume,
    enqueue: false,
    desiredEventTypes: SPEECH_EVENTS,
    onEvent: (event) => exclusive(() => onSpeechEvent(event, token, index, spoken))
  };
  if (voice) options.voiceName = voice.voiceName;
  if (item.lang) options.lang = item.lang;
  const go = () => {
    if (token !== speech.token) return;
    mark("speak called", { text: spoken.slice(0, 40) });
    try {
      tts().speak(spoken, options, () => {
        mark("engine accepted");
        const error = chrome.runtime.lastError;
        if (error) exclusive(() => token === speech.token && onSpeechError(error.message, token, index));
      });
    } catch (error) {
      exclusive(() => onSpeechError(error?.message || String(error), token, index));
    }
  };
  if (unit.pause && state.player.status === "playing") speech.pauseTimer = setTimeout(go, unit.pause);
  else go();
};

const onSpeechError = async (message, token, index) => {
  if (token !== speech.token) return;
  if (preferredVoiceName(state.settings, currentItem()?.lang) && !usingFallbackVoice()) {
    useFallbackVoice(true);
    speech.token += 1;
    return speakUnit(index, speech.token);
  }
  return fail(message ? `Speech failed: ${message}` : "Speech failed. Try another voice in Settings.");
};

const confirmPlaying = async (token) => {
  clearTimeout(speech.confirmTimer);
  if (token !== speech.token || state.player.status === "playing" || !ACTIVE_STATUSES.has(state.player.status)) return;
  await setPlayer({ status: "playing" }).catch(() => {});
};

const learnRate = (spoken, elapsed) => {
  if (elapsed <= RATE_SAMPLE_MIN_MS || spoken.length <= RATE_SAMPLE_MIN_CHARS) return;
  const measured = spoken.length / (elapsed / 1000) / state.settings.rate;
  if (measured <= CPS_MIN || measured >= CPS_MAX) return;
  const cps = state.settings.cps * (1 - RATE_SAMPLE_WEIGHT) + measured * RATE_SAMPLE_WEIGHT;
  state.settings = { ...state.settings, cps: Math.round(cps * 100) / 100 };
};

const onSpeechEvent = async (event, token, index, spoken) => {
  if (token !== speech.token) return;
  const plan = speech.plan;
  const item = currentItem();
  if (!plan || !item) return;
  const unit = plan.units[index];
  if (event.type === "start") {
    mark("start event", { charIndex: event.charIndex ?? 0 });
    speech.unitStartedAt = Date.now();
    const audible = state.player.status === "playing" || !speech.voiceHasWords;
    state.player = { ...state.player, status: audible ? "playing" : state.player.status, error: "", pos: { b: unit.b, s: unit.s }, progress: progressAt(plan, index), updatedAt: Date.now() };
    broadcast({ t: "unit", id: item.id, b: unit.b, s: unit.s });
    await savePlayer().catch(() => {});
    playerChanged();
    if (!audible) {
      clearTimeout(speech.confirmTimer);
      speech.confirmTimer = setTimeout(() => exclusive(() => confirmPlaying(token)), START_CONFIRM_MS);
    }
    extendAudioWarmth();
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
    if (speech.unitStartedAt) {
      const elapsed = Date.now() - speech.unitStartedAt;
      speech.pendingMs += elapsed;
      learnRate(spoken, elapsed);
    }
    speech.unitStartedAt = 0;
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

export const speakCurrent = async ({ recovering = false } = {}) => {
  stopSpeech();
  const token = speech.token;
  const item = currentItem();
  if (!item) return setPlayer({ status: state.queue.items.some((entry) => entry.status === "queued") ? "paused" : "idle", itemId: queuedItems(state.queue)[0]?.id || "", pos: null });
  if (!traceRunning()) startTrace(recovering ? "recover" : "advance");
  mark("previous speech stopped");
  const audio = warmAudio();
  await setPlayer({ status: recovering ? "recovering" : "preparing", error: "" });
  mark("state saved");
  const cached = speech.planKey === planKey(item, state.settings);
  const plan = await loadPlan(item);
  mark("text ready", { cached, units: plan?.units.length || 0 });
  const path = await Promise.race([audio, new Promise((resolve) => setTimeout(() => resolve({ running: false, slow: true }), AUDIO_PATH_WAIT_MS))]);
  mark("audio path ready", { wasWarm: Boolean(path.wasWarm), running: Boolean(path.running) });
  if (token !== speech.token) return;
  if (!plan || !plan.units.length) {
    state.queue = removeItem(state.queue, item.id);
    await saveQueue();
    await setPlayer({ itemId: nextAfter(state.queue, item.id)?.id || "", pos: null, status: "error", error: "That item had no readable text, so it was removed." });
    return;
  }
  useFallbackVoice(false);
  const index = unitIndex(plan, state.player.pos);
  return speakUnit(index, token);
};

export const play = async (itemId = "") => {
  startTrace("play");
  mark("command");
  const target = itemId ? findItem(state.queue, itemId) : currentItem() || queuedItems(state.queue)[0];
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

export const pause = async () => {
  if (!ACTIVE_STATUSES.has(state.player.status)) return { ok: true };
  stopSpeech();
  await flushListening(true);
  await setPlayer({ status: "paused" });
  return { ok: true };
};

export const toggle = async () => (ACTIVE_STATUSES.has(state.player.status) ? pause() : play());

export const skip = async (delta) => {
  const item = currentItem();
  if (!item) return { ok: false, message: "Nothing is playing." };
  const plan = await loadPlan(item);
  if (!plan) return { ok: false };
  const from = speech.planKey === planKey(item, state.settings) && speech.index >= 0 && ACTIVE_STATUSES.has(state.player.status) ? speech.index : unitIndex(plan, state.player.pos);
  const to = Math.max(0, Math.min(plan.units.length - 1, from + delta));
  const unit = plan.units[to];
  if (delta > 0 && from + delta >= plan.units.length) {
    if (ACTIVE_STATUSES.has(state.player.status)) return finishItem();
  }
  const wasActive = ACTIVE_STATUSES.has(state.player.status);
  state.player = { ...state.player, pos: { b: unit.b, s: unit.s }, progress: progressAt(plan, to) };
  if (wasActive) await speakCurrent();
  else {
    speech.index = to;
    await setPlayer({});
    state.queue = updateItem(state.queue, item.id, { pos: state.player.pos, progress: state.player.progress });
    await saveQueue();
  }
  return { ok: true };
};

export const seek = async (itemId, b, s) => {
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

export const skipItem = async () => {
  const item = currentItem();
  if (!item) return { ok: false };
  const wasActive = ACTIVE_STATUSES.has(state.player.status);
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
