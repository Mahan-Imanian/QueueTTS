import { clearHistory, findItem, markDone, markUnplayed, moveQueued, moveToFront, nextAfter, queuedItems, removeItem } from "../lib/queue.js";
import { ACTIVE_STATUSES, defaultPlayer, docKey, KEYS, normalizeSettings, planImport, readDoc, SCHEMA } from "../lib/store.js";
import { MIN_SELECTION_WORDS } from "../lib/text.js";
import { SLEEP_ALARM, stopWatchdog, WATCHDOG_ALARM } from "./alarms.js";
import { warmAudio } from "./audio.js";
import { addDoc, addText, captureTab, pageContext, quickCapture } from "./capture.js";
import { dropPendingListening, finishItemManually, invalidatePlan, isSpeaking, pause, play, ports, resetPlayback, seek, skip, skipItem, speakCurrent, stopSpeech, toggle } from "./playback.js";
import { forgetVoices, refreshVoices, resolveVoice, warmEngine } from "./speech.js";
import { currentItem, exclusive, load, persist, reload, savePlayer, saveQueue, saveSettings, setPlayer, state, updateBadge } from "./state.js";
import { liveTrace } from "./trace.js";

const MENU_PAGE = "qtts-page";
const MENU_SELECTION = "qtts-selection";
const STALL_MS = 12000;
const UI_AUDIO_WARM_MS = 45000;
const RESPEAK_SETTINGS = ["rate", "pitch", "volume", "voices", "allowNetworkVoices", "pronunciations"];

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

const removeOne = async (id) => {
  const item = findItem(state.queue, id);
  if (!item) return { ok: false };
  const doc = await readDoc(id);
  const index = state.queue.items.indexOf(item);
  if (id === state.player.itemId) {
    stopSpeech();
    dropPendingListening();
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
  if (patch.voices !== undefined || patch.allowNetworkVoices !== undefined) forgetVoices();
  const replan = before.readCode !== state.settings.readCode || before.announceHeadings !== state.settings.announceHeadings;
  const respeak = RESPEAK_SETTINGS.some((key) => key in patch);
  if (replan) invalidatePlan();
  if ((replan || respeak) && ACTIVE_STATUSES.has(state.player.status)) await speakCurrent();
  return { ok: true, settings: state.settings };
};

const importData = async (payload) => {
  const plan = planImport(state.queue, payload);
  state.queue = plan.queue;
  const values = { [KEYS.queue]: state.queue };
  for (const [id, doc] of plan.docs) values[docKey(id)] = doc;
  await persist(values);
  if (!state.player.itemId && queuedItems(state.queue).length) await setPlayer({ itemId: queuedItems(state.queue)[0].id, status: "paused" });
  updateBadge();
  return { ok: true, added: plan.added, skipped: plan.skipped };
};

const resetAll = async () => {
  resetPlayback();
  await chrome.alarms.clear(SLEEP_ALARM);
  const keep = state.settings;
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [KEYS.schema]: SCHEMA, [KEYS.settings]: keep, [KEYS.player]: defaultPlayer(), [KEYS.queue]: { items: [] }, [KEYS.stats]: { days: {} } });
  await reload();
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
  voices: async () => ({ ok: true, voices: await refreshVoices() }),
  diagnostics: async () => {
    const { lastStart } = await chrome.storage.session.get("lastStart").catch(() => ({}));
    return { ok: true, lastStart: lastStart || null, live: liveTrace(), voice: state.player.itemId ? (await resolveVoice(currentItem()?.lang))?.voiceName || "" : "" };
  },
  resolvedVoice: async (lang) => ({ ok: true, voice: await resolveVoice(lang) }),
  importData: (payload) => importData(payload || {}),
  reset: resetAll,
  dismissError: async () => {
    await setPlayer({ status: state.player.itemId ? "paused" : "idle", error: "" });
    return { ok: true };
  }
};

const boot = exclusive(async () => {
  await load();
  const session = await chrome.storage.session.get("booted").catch(() => ({}));
  if (!session.booted) {
    await chrome.storage.session.set({ booted: Date.now() }).catch(() => {});
    if (ACTIVE_STATUSES.has(state.player.status)) await setPlayer({ status: "paused" });
    if (state.player.sleepAt > 0 && state.player.sleepAt < Date.now()) await setPlayer({ sleepAt: 0 });
  } else if (ACTIVE_STATUSES.has(state.player.status)) {
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
      if (context?.selectionWords >= MIN_SELECTION_WORDS) mode = "selection";
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
    if (!ACTIVE_STATUSES.has(state.player.status)) return stopWatchdog();
    if (!isSpeaking() && Date.now() - state.player.updatedAt > STALL_MS) await speakCurrent({ recovering: true });
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ui") return;
  ports.add(port);
  exclusive(async () => {
    await boot;
    if (!ACTIVE_STATUSES.has(state.player.status) && currentItem()) {
      warmAudio(UI_AUDIO_WARM_MS);
      await warmEngine();
    }
  });
  port.onDisconnect.addListener(() => ports.delete(port));
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
