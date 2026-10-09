import { queuedItems } from "../lib/queue.js";
import { ACTIVE_STATUSES } from "../lib/store.js";
import { pickVoice, preferredVoiceName } from "../lib/voices.js";
import { currentItem, state } from "./state.js";

const ENGINE_WARM_INTERVAL_MS = 45000;
const VOICE_LIST_RETRY_MS = 3000;

export const tts = () => globalThis.__qttsTTS || chrome.tts;

const voiceCache = { list: null, at: 0, fallback: false };

const getVoices = () => new Promise((resolve) => {
  try {
    tts().getVoices((voices) => resolve(Array.isArray(voices) ? voices : []));
  } catch {
    resolve([]);
  }
});

export const refreshVoices = async () => {
  voiceCache.list = await getVoices();
  return voiceCache.list;
};

export const forgetVoices = () => {
  voiceCache.fallback = false;
  voiceCache.list = null;
};

export const usingFallbackVoice = () => voiceCache.fallback;

export const useFallbackVoice = (value) => {
  voiceCache.fallback = value;
};

export const resolveVoice = async (lang) => {
  const wanted = preferredVoiceName(state.settings, lang);
  const stale = wanted && !voiceCache.list?.some((voice) => voice.voiceName === wanted) && Date.now() - voiceCache.at > VOICE_LIST_RETRY_MS;
  if (!voiceCache.list?.length || stale) {
    voiceCache.list = await getVoices();
    voiceCache.at = Date.now();
  }
  const settings = voiceCache.fallback ? { ...state.settings, voices: {} } : state.settings;
  return pickVoice(voiceCache.list, settings, lang || "en").voice;
};

let engineWarmAt = 0;

export const warmEngine = async () => {
  if (!state || ACTIVE_STATUSES.has(state.player.status) || Date.now() - engineWarmAt < ENGINE_WARM_INTERVAL_MS) return;
  const item = currentItem() || queuedItems(state.queue)[0];
  const voice = await resolveVoice(item?.lang);
  if (ACTIVE_STATUSES.has(state.player.status)) return;
  engineWarmAt = Date.now();
  const options = { volume: 0, enqueue: false, onEvent: () => {} };
  if (voice) options.voiceName = voice.voiceName;
  try {
    tts().speak(".", options, () => void chrome.runtime.lastError);
  } catch {}
};
