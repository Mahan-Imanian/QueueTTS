import {
  addItemToState,
  applyDictionary,
  createQueueItem,
  currentItem,
  fmtTime,
  progressFor,
  readState,
  segmentText,
  timeline,
  todayKey,
  updateState,
  writeState
} from "./shared.js";

const MENU_SELECTION = "queuetts-add-selection";
const MENU_PAGE = "queuetts-add-page";
const MENU_OPEN = "queuetts-open-queue";
const SLEEP_ALARM = "queuetts-sleep";
const CONTENT_FILE = "src/content.js";
let pauseTimer = 0;
let intentionalStop = false;
let activeSpeakToken = 0;

const openQueue = async (windowId) => {
  try {
    if (chrome.sidePanel?.open && windowId) await chrome.sidePanel.open({ windowId });
    else await chrome.tabs.create({ url: chrome.runtime.getURL("pages/sidepanel.html") });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL("pages/sidepanel.html") });
  }
};

const buildMenus = async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_SELECTION, title: "Add selected text to QueueTTS", contexts: ["selection"] });
  chrome.contextMenus.create({ id: MENU_PAGE, title: "Add current page to QueueTTS", contexts: ["page"] });
  chrome.contextMenus.create({ id: MENU_OPEN, title: "Open QueueTTS queue", contexts: ["action", "page", "selection"] });
};

const setBadge = async () => {
  const state = await readState();
  const pending = state.queue.filter((item) => item.state === "queued" || item.state === "playing" || item.state === "paused").length;
  const text = pending ? String(Math.min(99, pending)) : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: state.playback.status === "playing" ? "#8ee8c8" : "#6d7183" });
};

const sendTabCaptureMessage = async (tabId, type) => {
  await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] });
  return chrome.tabs.sendMessage(tabId, { type });
};

const captureTab = async (tabId, mode = "page") => {
  try {
    const response = await sendTabCaptureMessage(tabId, mode === "selection" ? "QTTS_CAPTURE_SELECTION" : "QTTS_CAPTURE_PAGE");
    if (!response?.ok) return { ok: false, error: response?.error || "Capture failed.", capture: response?.capture || null };
    return { ok: true, capture: response.capture };
  } catch (error) {
    return { ok: false, error: error?.message || "Chrome blocked access to this page. Try a normal http or https page, use selected-text capture, or paste manually." };
  }
};

const readTabContext = async (tabId) => {
  try {
    const response = await sendTabCaptureMessage(tabId, "QTTS_CAPTURE_CONTEXT");
    if (response?.ok) return { ok: true, context: response.context };
    return { ok: false, error: response?.error || "Could not read this page context." };
  } catch (error) {
    return { ok: false, error: error?.message || "Chrome blocked access to this page context." };
  }
};

const activeTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
};

const addCapture = async (capture, settingsOverride = {}) => {
  const state = await readState();
  const settings = { ...state.settings, ...settingsOverride };
  const item = createQueueItem({
    title: capture.title || capture.sourceTitle || "Captured text",
    text: capture.text || "",
    sourceType: capture.sourceType || "page",
    sourceTitle: capture.sourceTitle || capture.title || "Browser page",
    sourceUrl: capture.url || capture.sourceUrl || "",
    headingMode: settings.headingMode,
    lang: capture.lang || settings.lang || "",
    state: capture.failed ? "failed" : "queued",
    error: capture.error || "",
    quality: capture.quality || (capture.failed ? "failed" : "good")
  }, settings);
  await addItemToState(item, { activate: true });
  await setBadge();
  if (settings.autoPlayCaptured && item.state !== "failed") await playItem(item.id, 0);
  return item;
};

const markSpeechState = async (status, itemId, segmentIndex, error = "") => updateState((state) => {
  const queue = state.queue.map((item) => {
    if (item.id === itemId) return { ...item, state: status === "playing" ? "playing" : status === "paused" ? "paused" : item.state, segmentIndex, error, updatedAt: Date.now() };
    if ((item.state === "playing" || item.state === "paused") && item.state !== "completed" && item.state !== "failed") return { ...item, state: "queued", updatedAt: Date.now() };
    return item;
  });
  return { ...state, queue, playback: { ...state.playback, itemId, segmentIndex, status, lastError: error, updatedAt: Date.now() } };
});

const speakSegment = async () => {
  clearTimeout(pauseTimer);
  const token = ++activeSpeakToken;
  const state = await readState();
  const item = currentItem(state);
  if (!item || !state.playback.itemId) {
    chrome.tts.stop();
    await updateState((current) => ({ ...current, playback: { ...current.playback, status: "idle", itemId: "", segmentIndex: 0, updatedAt: Date.now() } }));
    await setBadge();
    return;
  }
  const segments = segmentText(item.text, item.headingMode || state.settings.headingMode);
  const index = Math.max(0, Math.min(state.playback.segmentIndex, Math.max(0, segments.length - 1)));
  const segment = segments[index];
  if (!segment) {
    await completeItem(item.id);
    return;
  }
  await markSpeechState("playing", item.id, index);
  await setBadge();
  if (segment.type === "pause") {
    pauseTimer = setTimeout(() => {
      if (token === activeSpeakToken) advanceSegment(1, true);
    }, Math.max(250, segment.duration || 650));
    return;
  }
  const text = applyDictionary(segment.text, state.settings.dictionary);
  const options = {
    enqueue: false,
    rate: state.settings.rate,
    pitch: state.settings.pitch,
    volume: state.settings.volume,
    onEvent: (event) => {
      if (token !== activeSpeakToken) return;
      if (event.type === "end") advanceSegment(1, true);
      if (event.type === "error") failPlayback(event.errorMessage || "Chrome text-to-speech reported an error.");
      if ((event.type === "interrupted" || event.type === "cancelled") && !intentionalStop) updateState((current) => ({ ...current, playback: { ...current.playback, status: "paused", updatedAt: Date.now() } })).then(setBadge);
    }
  };
  if (state.settings.voiceName) options.voiceName = state.settings.voiceName;
  if (item.lang || state.settings.lang) options.lang = item.lang || state.settings.lang;
  intentionalStop = false;
  try {
    chrome.tts.speak(text.slice(0, 32000), options, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) failPlayback(lastError.message || "Chrome text-to-speech could not start playback.");
    });
  } catch (error) {
    await failPlayback(error?.message || "Chrome text-to-speech could not start playback.");
  }
};

const playItem = async (itemId = "", segmentIndex = null) => {
  activeSpeakToken += 1;
  intentionalStop = true;
  chrome.tts.stop();
  intentionalStop = false;
  const state = await readState();
  const item = itemId ? state.queue.find((candidate) => candidate.id === itemId) : currentItem(state);
  if (!item) {
    await updateState((current) => ({ ...current, playback: { ...current.playback, status: "idle", itemId: "", segmentIndex: 0, updatedAt: Date.now() } }));
    await setBadge();
    return { ok: false, error: "Queue is empty." };
  }
  if (item.state === "failed") return { ok: false, error: "This item failed extraction. Edit it before playback." };
  const index = segmentIndex === null ? item.segmentIndex || 0 : Math.max(0, Number(segmentIndex) || 0);
  await updateState((current) => ({
    ...current,
    queue: current.queue.map((candidate) => {
      if (candidate.id === item.id) return { ...candidate, state: "playing", segmentIndex: index, updatedAt: Date.now() };
      if (candidate.state === "playing" || candidate.state === "paused") return { ...candidate, state: candidate.state === "completed" ? "completed" : "queued", updatedAt: Date.now() };
      return candidate;
    }),
    playback: { ...current.playback, itemId: item.id, segmentIndex: index, status: "loading", lastError: "", updatedAt: Date.now() }
  }));
  await speakSegment();
  return { ok: true };
};

const pausePlayback = async () => {
  try {
    chrome.tts.pause();
  } catch {}
  const state = await readState();
  const item = currentItem(state);
  if (item) await markSpeechState("paused", item.id, state.playback.segmentIndex);
  else await updateState((current) => ({ ...current, playback: { ...current.playback, status: "paused", updatedAt: Date.now() } }));
  await setBadge();
  return { ok: true };
};

const resumePlayback = async () => {
  try {
    chrome.tts.resume();
  } catch {}
  const state = await readState();
  const item = currentItem(state);
  if (!item) return playItem();
  await markSpeechState("playing", item.id, state.playback.segmentIndex);
  await setBadge();
  return { ok: true };
};

const stopPlayback = async (status = "idle") => {
  clearTimeout(pauseTimer);
  intentionalStop = true;
  activeSpeakToken += 1;
  try {
    chrome.tts.stop();
  } catch {}
  intentionalStop = false;
  await updateState((state) => ({
    ...state,
    queue: state.queue.map((item) => item.state === "playing" || item.state === "paused" ? { ...item, state: item.state === "completed" ? "completed" : "queued", updatedAt: Date.now() } : item),
    playback: { ...state.playback, status, updatedAt: Date.now() }
  }));
  await chrome.alarms.clear(SLEEP_ALARM);
  await setBadge();
  return { ok: true };
};

const togglePlayback = async () => {
  const state = await readState();
  if (state.playback.status === "playing") return pausePlayback();
  if (state.playback.status === "paused") return resumePlayback();
  return playItem(state.playback.itemId || "", state.playback.segmentIndex || 0);
};

const completeItem = async (itemId) => {
  activeSpeakToken += 1;
  intentionalStop = true;
  chrome.tts.stop();
  intentionalStop = false;
  const state = await readState();
  const item = state.queue.find((candidate) => candidate.id === itemId);
  const day = todayKey();
  const previous = state.stats.days[day] || { itemsCaptured: 0, itemsCompleted: 0, wordsCaptured: 0, secondsListened: 0 };
  const currentIndex = state.queue.findIndex((candidate) => candidate.id === itemId);
  const next = state.queue.slice(currentIndex + 1).find((candidate) => candidate.state === "queued") || state.queue.find((candidate) => candidate.state === "queued" && candidate.id !== itemId);
  await writeState({
    ...state,
    queue: state.queue.map((candidate) => candidate.id === itemId ? { ...candidate, state: "completed", completedAt: Date.now(), segmentIndex: segmentText(candidate.text, candidate.headingMode).length - 1, updatedAt: Date.now() } : candidate),
    playback: { ...state.playback, itemId: next?.id || itemId, segmentIndex: 0, status: next ? "loading" : "idle", updatedAt: Date.now() },
    stats: {
      days: {
        ...state.stats.days,
        [day]: {
          ...previous,
          itemsCompleted: Number(previous.itemsCompleted || 0) + 1,
          secondsListened: Number(previous.secondsListened || 0) + (item?.estimateSeconds || 0)
        }
      }
    }
  });
  await setBadge();
  if (next) await playItem(next.id, 0);
};

const failPlayback = async (message) => {
  activeSpeakToken += 1;
  intentionalStop = true;
  try {
    chrome.tts.stop();
  } catch {}
  intentionalStop = false;
  await updateState((state) => ({
    ...state,
    queue: state.queue.map((item) => item.id === state.playback.itemId ? { ...item, state: "paused", error: message, updatedAt: Date.now() } : item),
    playback: { ...state.playback, status: "error", lastError: message, updatedAt: Date.now() }
  }));
  await setBadge();
};

const advanceSegment = async (delta, autoplay = false) => {
  clearTimeout(pauseTimer);
  activeSpeakToken += 1;
  intentionalStop = true;
  chrome.tts.stop();
  intentionalStop = false;
  const state = await readState();
  const item = currentItem(state);
  if (!item) return { ok: false, error: "Queue is empty." };
  const segments = segmentText(item.text, item.headingMode || state.settings.headingMode);
  const nextIndex = Number(state.playback.segmentIndex || 0) + delta;
  if (nextIndex >= segments.length) {
    await completeItem(item.id);
    return { ok: true };
  }
  const safeIndex = Math.max(0, nextIndex);
  await updateState((current) => ({
    ...current,
    queue: current.queue.map((candidate) => candidate.id === item.id ? { ...candidate, segmentIndex: safeIndex, state: autoplay || current.playback.status === "playing" ? "playing" : "paused", updatedAt: Date.now() } : candidate),
    playback: { ...current.playback, itemId: item.id, segmentIndex: safeIndex, status: autoplay || current.playback.status === "playing" ? "loading" : "paused", updatedAt: Date.now() }
  }));
  if (autoplay || state.playback.status === "playing") await speakSegment();
  await setBadge();
  return { ok: true };
};

const moveItem = async (direction) => {
  const state = await readState();
  const item = currentItem(state);
  if (!item) return { ok: false, error: "Queue is empty." };
  const index = state.queue.findIndex((candidate) => candidate.id === item.id);
  const next = direction > 0 ? state.queue.slice(index + 1).find((candidate) => candidate.state !== "failed") : [...state.queue.slice(0, index)].reverse().find((candidate) => candidate.state !== "failed");
  if (!next) return { ok: false, error: direction > 0 ? "No next item." : "No previous item." };
  await playItem(next.id, next.segmentIndex || 0);
  return { ok: true };
};

const seekSeconds = async (seconds) => {
  const state = await readState();
  const item = currentItem(state);
  if (!item) return { ok: false, error: "Queue is empty." };
  const segments = segmentText(item.text, item.headingMode || state.settings.headingMode);
  const rows = timeline(segments, state.settings.rate);
  const current = rows[Math.min(state.playback.segmentIndex || 0, Math.max(0, rows.length - 1))];
  const target = Math.max(0, (current?.start || 0) + Number(seconds || 0));
  const next = rows.find((row) => row.end >= target) || rows.at(-1);
  return advanceSegment((next?.index || 0) - (state.playback.segmentIndex || 0), state.playback.status === "playing");
};

const setSleepTimer = async (minutes) => {
  await chrome.alarms.clear(SLEEP_ALARM);
  const value = Math.max(0, Number(minutes) || 0);
  if (value > 0) await chrome.alarms.create(SLEEP_ALARM, { delayInMinutes: value });
  await updateState((state) => ({ ...state, settings: { ...state.settings, sleepMinutes: value } }));
  return { ok: true, label: value ? `Stops in ${fmtTime(value * 60)}` : "Sleep timer off" };
};

const getVoices = () => new Promise((resolve) => {
  try {
    chrome.tts.getVoices((voices) => resolve(Array.isArray(voices) ? voices : []));
  } catch {
    resolve([]);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await buildMenus();
  try {
    await chrome.sidePanel.setOptions({ path: "pages/sidepanel.html", enabled: true });
  } catch {}
  await setBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await setBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  (async () => {
    if (info.menuItemId === MENU_OPEN) {
      await openQueue(tab?.windowId);
      return;
    }
    if (info.menuItemId === MENU_SELECTION) {
      const text = String(info.selectionText || "").trim();
      if (text) {
        await addCapture({ title: tab?.title || "Selected text", text, sourceType: "selection", sourceTitle: tab?.title || "Selected text", url: tab?.url || "" });
        await openQueue(tab?.windowId);
      }
      return;
    }
    if (info.menuItemId === MENU_PAGE && tab?.id) {
      const result = await captureTab(tab.id, "page");
      if (result.ok) await addCapture(result.capture);
      else await addCapture({ title: tab.title || "Failed page capture", text: "", sourceType: "failed", sourceTitle: tab.title || "Current page", url: tab.url || "", failed: true, error: result.error });
      await openQueue(tab.windowId);
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SLEEP_ALARM) stopPlayback("paused");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["queuetts:v2"]) setBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "QTTS_OPEN_QUEUE") {
      const tab = sender.tab || await activeTab();
      return sendResponse(await openQueue(message.windowId || tab?.windowId).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message })));
    }
    if (message?.type === "QTTS_CONTEXT_ACTIVE") {
      const tab = await activeTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab is available." });
      const result = await readTabContext(tab.id);
      if (!result.ok) return sendResponse({ ok: false, error: result.error, context: { title: tab.title || "Current tab", url: tab.url || "", selectionWords: 0, selectionPreview: "" } });
      return sendResponse(result);
    }
    if (message?.type === "QTTS_CAPTURE_ACTIVE") {
      const tab = await activeTab();
      if (!tab?.id) return sendResponse({ ok: false, error: "No active tab is available." });
      const result = await captureTab(tab.id, message.mode || "page");
      return sendResponse(result);
    }
    if (message?.type === "QTTS_ADD_CAPTURE") return sendResponse({ ok: true, item: await addCapture(message.capture || {}, message.settings || {}) });
    if (message?.type === "QTTS_PLAY") return sendResponse(await playItem(message.itemId || "", message.segmentIndex ?? null));
    if (message?.type === "QTTS_TOGGLE") return sendResponse(await togglePlayback());
    if (message?.type === "QTTS_PAUSE") return sendResponse(await pausePlayback());
    if (message?.type === "QTTS_RESUME") return sendResponse(await resumePlayback());
    if (message?.type === "QTTS_STOP") return sendResponse(await stopPlayback("idle"));
    if (message?.type === "QTTS_NEXT_ITEM") return sendResponse(await moveItem(1));
    if (message?.type === "QTTS_PREV_ITEM") return sendResponse(await moveItem(-1));
    if (message?.type === "QTTS_NEXT_SEGMENT") return sendResponse(await advanceSegment(1, (await readState()).playback.status === "playing"));
    if (message?.type === "QTTS_PREV_SEGMENT") return sendResponse(await advanceSegment(-1, (await readState()).playback.status === "playing"));
    if (message?.type === "QTTS_SEEK") return sendResponse(await seekSeconds(message.seconds || 0));
    if (message?.type === "QTTS_SLEEP") return sendResponse(await setSleepTimer(message.minutes || 0));
    if (message?.type === "QTTS_GET_VOICES") return sendResponse({ ok: true, voices: await getVoices() });
    if (message?.type === "QTTS_PROGRESS") {
      const state = await readState();
      return sendResponse({ ok: true, progress: progressFor(currentItem(state), state.playback.segmentIndex, state.settings) });
    }
    return sendResponse({ ok: false, error: "Unknown QueueTTS message." });
  })();
  return true;
});
