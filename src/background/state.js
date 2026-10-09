import { findItem, queuedItems } from "../lib/queue.js";
import { KEYS, readAll, StorageError, upgradeStorage, write } from "../lib/store.js";
import { syncWatchdog } from "./alarms.js";

const BADGE_MAX_COUNT = 999;
const BADGE_PLAYING_COLOR = "#C2410C";
const BADGE_IDLE_COLOR = "#1B1A17";

export let state = null;

let chain = Promise.resolve();
export const exclusive = (task) => {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
};

export const load = async () => {
  if (state) return state;
  await upgradeStorage();
  state = await readAll();
  return state;
};

export const reload = async () => {
  state = null;
  return load();
};

let healthBad = false;
const setHealth = (message = "") => chrome.storage.session.set({ health: message ? { storage: message, at: Date.now() } : {} }).catch(() => {});

export const persist = async (values) => {
  try {
    await write(values);
    if (healthBad) {
      healthBad = false;
      await setHealth("");
    }
  } catch (error) {
    healthBad = true;
    await setHealth(error instanceof StorageError ? error.message : "QueueTTS couldn't save.");
    throw error;
  }
};

export const saveQueue = () => persist({ [KEYS.queue]: state.queue });
export const savePlayer = () => persist({ [KEYS.player]: state.player });
export const saveSettings = () => persist({ [KEYS.settings]: state.settings });

export const currentItem = () => (state.player.itemId ? findItem(state.queue, state.player.itemId) : null);

export const updateBadge = () => {
  if (!state) return;
  const count = queuedItems(state.queue).length;
  const playing = state.player.status === "playing" || state.player.status === "preparing";
  chrome.action.setBadgeText({ text: count ? String(Math.min(count, BADGE_MAX_COUNT)) : "" }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: playing ? BADGE_PLAYING_COLOR : BADGE_IDLE_COLOR }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" })?.catch?.(() => {});
  chrome.action.setTitle({ title: playing ? `QueueTTS · Playing “${currentItem()?.title || ""}”` : count ? `QueueTTS · ${count} in queue` : "QueueTTS" }).catch(() => {});
};

export const playerChanged = () => {
  syncWatchdog(state.player.status);
  updateBadge();
};

export const setPlayer = async (patch) => {
  state.player = { ...state.player, ...patch, updatedAt: Date.now() };
  await savePlayer();
  playerChanged();
};
