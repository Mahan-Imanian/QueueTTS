const AUDIO_DOCUMENT = "pages/audio.html";
const AUDIO_WARM_MS = 90000;

let warmUntil = 0;
let creating = null;

const ensureAudioDocument = async () => {
  if (!chrome.offscreen?.createDocument) return false;
  const existing = await chrome.runtime.getContexts?.({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
  if (existing?.length) return true;
  creating ||= chrome.offscreen.createDocument({
    url: AUDIO_DOCUMENT,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Keeps the audio output awake so the first words of speech are not cut off."
  }).catch((error) => {
    if (!/single offscreen|already/i.test(String(error?.message || error))) throw error;
  }).finally(() => {
    creating = null;
  });
  await creating;
  return true;
};

export const warmAudio = async (ms = AUDIO_WARM_MS) => {
  const wasWarm = Date.now() < warmUntil;
  warmUntil = Date.now() + ms;
  try {
    if (!(await ensureAudioDocument())) return { wasWarm, running: false };
    const status = await chrome.runtime.sendMessage({ target: "qtts-audio", action: "warm", ms });
    return { wasWarm, ...(status || {}) };
  } catch {
    return { wasWarm, running: false };
  }
};

export const extendAudioWarmth = () => {
  if (warmUntil - Date.now() < AUDIO_WARM_MS / 2) warmAudio();
};
