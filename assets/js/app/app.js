import { createId } from '../core/ids.js';
import { loadState, saveState, exportState, importState } from '../core/storage.js';
import { cleanText } from '../pipeline/clean.js';
import { segmentText, estimateSegmentDurations } from '../pipeline/segmenter.js';
import { loadVoices, filterVoices, findVoice } from '../tts/voices.js';
import { SpeechEngine } from '../tts/speechEngine.js';
import { qs, qsa } from '../ui/dom.js';
import { showToast } from '../ui/toast.js';
import { renderQueue, renderUpNext } from '../ui/render.js';

const DEFAULT_PREFS = {
  theme: 'light',
  contrast: 'normal',
  motion: 'full',
  rate: 1,
  voiceURI: null,
  skipInterval: 15,
  dictionary: {},
  headingMode: 'cue',
  language: 'en-US',
};

const DEFAULT_PLAYBACK = {
  currentId: null,
  segmentIndex: 0,
  offsetSeconds: 0,
  elapsedSeconds: 0,
  isPlaying: false,
  sleepTimer: null,
};

const PAGES_URL = 'https://mahan-imanian.github.io/QueueTTS/';

const appState = {
  queue: [],
  prefs: { ...DEFAULT_PREFS },
  playback: { ...DEFAULT_PLAYBACK },
  voices: [],
  timers: {},
  flags: {
    ignoreCancelError: false,
  },
};

const dom = {};

const saveAppState = () => {
  saveState({
    queue: appState.queue,
    prefs: appState.prefs,
    playback: appState.playback,
  });
};

const debounce = (fn, delay) => {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
};

const scheduleSave = debounce(saveAppState, 400);

const applyPrefsToDom = () => {
  document.documentElement.dataset.theme = appState.prefs.theme;
  document.documentElement.dataset.contrast = appState.prefs.contrast;
  document.documentElement.dataset.motion = appState.prefs.motion;
  dom.rateRange.value = appState.prefs.rate;
  dom.skipSelect.value = String(appState.prefs.skipInterval);
};

const markIntentionalCancel = () => {
  appState.flags.ignoreCancelError = true;
  window.clearTimeout(appState.timers.cancelReset);
  appState.timers.cancelReset = window.setTimeout(() => {
    appState.flags.ignoreCancelError = false;
  }, 500);
};

const setAriaLive = (message) => {
  dom.ariaLive.textContent = message;
};

const getCurrentItem = () => appState.queue.find((item) => item.id === appState.playback.currentId) || null;

const updateItemState = (id, updates) => {
  const item = appState.queue.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  Object.assign(item, updates, { updatedAt: Date.now() });
  scheduleSave();
};

const updateNowPlaying = () => {
  const item = getCurrentItem();
  if (!item) {
    dom.nowTitle.textContent = 'Nothing queued';
    dom.nowStatus.textContent = 'Add text or a URL to begin.';
    dom.nowSpeaking.textContent = 'Ready.';
    dom.progressFill.style.width = '0%';
    dom.elapsed.textContent = '0:00';
    dom.remaining.textContent = '-0:00';
    dom.playPause.textContent = 'Play';
    return;
  }
  dom.nowTitle.textContent = item.title || item.url || 'Untitled';
  dom.nowStatus.textContent = `State: ${item.state}`;
  dom.playPause.textContent = appState.playback.isPlaying ? 'Pause' : 'Play';
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};

const computeDurations = (item) => {
  if (!item?.segments) {
    return [];
  }
  item.durations = estimateSegmentDurations(item.segments, appState.prefs.rate);
  return item.durations;
};

const getTotalDuration = (item) => {
  if (!item?.durations) {
    return 0;
  }
  return item.durations.reduce((sum, seg) => sum + seg.seconds, 0);
};

const updateProgress = () => {
  const item = getCurrentItem();
  if (!item || !item.segments) {
    return;
  }
  const durations = item.durations || computeDurations(item);
  const elapsed = appState.playback.elapsedSeconds;
  const total = getTotalDuration(item) || 1;
  const progress = Math.min(100, (elapsed / total) * 100);
  dom.progressFill.style.width = `${progress}%`;
  dom.elapsed.textContent = formatTime(elapsed);
  dom.remaining.textContent = `-${formatTime(Math.max(0, total - elapsed))}`;
};

const updateUpNext = () => {
  const currentIndex = appState.queue.findIndex((entry) => entry.id === appState.playback.currentId);
  renderUpNext({ container: dom.upNext, queue: appState.queue, currentIndex });
};

const updateQueueUI = () => {
  renderQueue({
    container: dom.queueList,
    queue: appState.queue,
    currentId: appState.playback.currentId,
    onAction: handleQueueAction,
    onPaste: handlePasteForItem,
  });
  qsa('.queue-item', dom.queueList).forEach((row) => {
    row.tabIndex = 0;
  });
  updateUpNext();
};

const refreshUI = () => {
  updateNowPlaying();
  updateQueueUI();
  updateProgress();
  scheduleSave();
};

const parseDictionary = (value) => {
  const lines = value.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const dictionary = {};
  lines.forEach((line) => {
    const [key, replacement] = line.split(/=>/).map((part) => part.trim());
    if (key && replacement) {
      dictionary[key] = replacement;
    }
  });
  return dictionary;
};

const handleQueueAction = (action, id) => {
  if (action === 'remove') {
    appState.queue = appState.queue.filter((item) => item.id !== id);
    if (appState.playback.currentId === id) {
      appState.playback.currentId = appState.queue[0]?.id || null;
      appState.playback.segmentIndex = 0;
      appState.playback.elapsedSeconds = 0;
      appState.playback.offsetSeconds = 0;
    }
    refreshUI();
    return;
  }
  if (action === 'play') {
    setCurrentItem(id);
    startPlayback();
  }
};

const setCurrentItem = (id) => {
  const previous = getCurrentItem();
  if (previous && previous.state === 'playing') {
    previous.state = 'paused';
  }
  const item = appState.queue.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  markIntentionalCancel();
  speechEngine.cancel();
  appState.playback.currentId = id;
  appState.playback.segmentIndex = 0;
  appState.playback.offsetSeconds = 0;
  appState.playback.elapsedSeconds = 0;
  if (item.state === 'finished') {
    item.state = 'ready';
  }
  refreshUI();
};

const addToast = (message, variant = 'info') => {
  showToast(dom.toastStack, { message, variant });
};

const handlePasteForItem = (id, text) => {
  const item = appState.queue.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  if (!text.trim()) {
    addToast('Paste the article text before saving.', 'error');
    return;
  }
  item.text = text;
  item.notice = '';
  item.state = 'queued';
  processItemText(item, { cleanup: true });
};

const processItemText = (item, { cleanup }) => {
  item.state = 'extracting';
  item.error = '';
  item.notice = '';
  refreshUI();

  const cleaned = cleanText({ text: item.text, dictionary: appState.prefs.dictionary, cleanup });
  if (!cleaned) {
    item.state = 'error';
    item.error = 'Extract failed';
    addToast('Extract failed: no text found.', 'error');
    refreshUI();
    return;
  }
  const segments = segmentText({ text: cleaned, headingMode: item.headingMode || appState.prefs.headingMode });
  item.cleanedText = cleaned;
  if (!item.title) {
    item.title = cleaned.split(/[\n.]/)[0].slice(0, 80).trim();
  }
  item.segments = segments;
  item.durations = estimateSegmentDurations(segments, appState.prefs.rate);
  item.state = 'ready';
  refreshUI();
};

const createItem = ({ text, url, sourceType, languageHint, headingMode }) => {
  return {
    id: createId(),
    title: '',
    text,
    url,
    sourceType,
    languageHint: languageHint || appState.prefs.language,
    headingMode: headingMode || appState.prefs.headingMode,
    state: 'queued',
    error: '',
    notice: '',
    cleanedText: '',
    segments: [],
    durations: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

const addSampleItem = () => {
  const text = `QueueTTS demo: This is a sample article to preview continuous playback.\n\nPaste or import more items to build a playlist. Each sentence becomes a safe speech segment, and the player will auto-advance through the queue.`;
  const item = createItem({ text, sourceType: 'sample' });
  item.title = 'Sample: QueueTTS demo';
  appState.queue.push(item);
  if (!appState.playback.currentId) {
    appState.playback.currentId = item.id;
  }
  processItemText(item, { cleanup: true });
};

const addPasteItem = () => {
  const text = dom.pasteInput.value.trim();
  if (!text) {
    addToast('Paste some text to add.', 'error');
    return;
  }
  const item = createItem({
    text,
    sourceType: 'paste',
    languageHint: dom.languageHint.value.trim(),
    headingMode: dom.headingMode.value,
  });
  appState.queue.push(item);
  if (!appState.playback.currentId) {
    appState.playback.currentId = item.id;
  }
  processItemText(item, { cleanup: dom.cleanupToggle.checked });
  dom.pasteInput.value = '';
  dom.languageHint.value = '';
  refreshUI();
};

const getReadableText = (html, url) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim() || url;
  const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'form'];
  removeSelectors.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => node.remove());
  });
  const main = doc.querySelector('article') || doc.querySelector('main') || doc.body;
  const text = main?.textContent || '';
  return { text, title };
};

const addUrlItem = async () => {
  const url = dom.urlInput.value.trim();
  if (!url) {
    addToast('Add a URL to fetch.', 'error');
    return;
  }
  const item = createItem({
    url,
    sourceType: 'url',
    languageHint: dom.languageHintUrl.value.trim(),
    headingMode: dom.headingModeUrl.value,
  });
  item.state = 'extracting';
  appState.queue.push(item);
  if (!appState.playback.currentId) {
    appState.playback.currentId = item.id;
  }
  refreshUI();

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Fetch failed (${response.status})`);
    }
    const html = await response.text();
    const { text, title } = getReadableText(html, url);
    item.title = title;
    item.text = text;
    if (!text || text.trim().length < 40) {
      item.state = 'needs_paste';
      item.notice = 'This site can’t be fetched from a static page. Use the bookmarklet or paste text below.';
      refreshUI();
      return;
    }
    processItemText(item, { cleanup: true });
  } catch (error) {
    item.state = 'needs_paste';
    item.notice = 'This site can’t be fetched from a static page. Use the bookmarklet or paste text below.';
    refreshUI();
  } finally {
    dom.urlInput.value = '';
    dom.languageHintUrl.value = '';
  }
};

const updateVoices = async () => {
  appState.voices = await loadVoices();
  if (!appState.voices.length) {
    addToast('No voices available', 'error');
  }
  renderVoiceOptions();
};

const renderVoiceOptions = () => {
  const filtered = filterVoices(appState.voices, dom.voiceSearch.value.trim());
  dom.voiceSelect.innerHTML = '';
  filtered.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    dom.voiceSelect.append(option);
  });
  if (appState.prefs.voiceURI) {
    dom.voiceSelect.value = appState.prefs.voiceURI;
  }
};

const speechEngine = new SpeechEngine({
  onStart: () => {
    const item = getCurrentItem();
    if (item) {
      item.state = 'playing';
      refreshUI();
    }
  },
  onEnd: () => {
    handleSegmentEnd();
  },
  onError: (error) => {
    const item = getCurrentItem();
    const errorMessage = error?.message || error?.error || '';
    if (errorMessage.toString().toLowerCase().includes('cancel') && appState.flags.ignoreCancelError) {
      return;
    }
    if (item) {
      item.state = 'error';
      item.error = errorMessage.toString().toLowerCase().includes('cancel') ? 'Speech cancelled' : 'Speech error';
      refreshUI();
    }
    addToast(item?.error || 'Speech error', 'error');
  },
  onBoundary: (event) => {
    const item = getCurrentItem();
    if (!item) {
      return;
    }
    const segment = item.segments[appState.playback.segmentIndex];
    if (!segment?.text) {
      return;
    }
    const words = segment.text.split(/\s+/);
    const wordIndex = Math.min(words.length - 1, Math.floor((event.charIndex / segment.text.length) * words.length));
    dom.nowSpeaking.textContent = `Now speaking: ${words[wordIndex]}`;
  },
});

const speakCurrentSegment = () => {
  const item = getCurrentItem();
  if (!item || !item.segments?.length) {
    return;
  }
  const segment = item.segments[appState.playback.segmentIndex];
  if (!segment) {
    handleItemEnd();
    return;
  }
  const voice = findVoice(appState.voices, appState.prefs.voiceURI);
  if (!voice) {
    addToast('No voices available', 'error');
    updateItemState(item.id, { state: 'error', error: 'No voices available' });
    return;
  }

  if (!segment.text && segment.heading && item.headingMode === 'pause') {
    appState.timers.headingPause = window.setTimeout(() => {
      handleSegmentEnd();
    }, 700);
    return;
  }

  const trimmedText = trimSegmentText(segment.text, appState.playback.offsetSeconds, item);
  speechEngine.speak({
    text: trimmedText,
    voice,
    rate: appState.prefs.rate,
    lang: item.languageHint || appState.prefs.language,
  });
  appState.playback.segmentStartedAt = Date.now();
};

const trimSegmentText = (text, offsetSeconds, item) => {
  if (!offsetSeconds || offsetSeconds <= 0) {
    return text;
  }
  const duration = item.durations?.[appState.playback.segmentIndex]?.seconds || 1;
  const ratio = Math.min(0.9, offsetSeconds / duration);
  const words = text.split(/\s+/);
  const startIndex = Math.floor(words.length * ratio);
  return words.slice(startIndex).join(' ');
};

const updateElapsedFromSegment = () => {
  const item = getCurrentItem();
  if (!item) {
    return;
  }
  const now = Date.now();
  const segmentElapsed = appState.playback.segmentStartedAt ? (now - appState.playback.segmentStartedAt) / 1000 : 0;
  const priorDurations = (item.durations || []).slice(0, appState.playback.segmentIndex).reduce((sum, seg) => sum + seg.seconds, 0);
  appState.playback.elapsedSeconds = Math.max(0, priorDurations + segmentElapsed + appState.playback.offsetSeconds);
};

const handleSegmentEnd = () => {
  const item = getCurrentItem();
  if (!item) {
    return;
  }
  appState.playback.segmentIndex += 1;
  appState.playback.offsetSeconds = 0;
  scheduleSave();
  if (appState.playback.segmentIndex >= item.segments.length) {
    handleItemEnd();
    return;
  }
  speakCurrentSegment();
};

const handleItemEnd = () => {
  const item = getCurrentItem();
  if (item) {
    item.state = 'finished';
  }
  appState.playback.isPlaying = false;
  refreshUI();
  const stopped = handleSleepTimerEndOfItem();
  if (!stopped) {
    goToNextItem(true);
  }
};

const startPlayback = () => {
  const item = getCurrentItem();
  if (!item) {
    addToast('Queue is empty', 'error');
    return;
  }
  if (item.state === 'needs_paste') {
    addToast('Paste text to continue', 'error');
    return;
  }
  if (item.state === 'error') {
    addToast('Fix the error before playing', 'error');
    return;
  }
  if (!item.segments?.length) {
    processItemText(item, { cleanup: true });
  }
  appState.playback.isPlaying = true;
  item.state = 'playing';
  refreshUI();
  speakCurrentSegment();
};

const pausePlayback = () => {
  const item = getCurrentItem();
  if (!item) {
    return;
  }
  updateElapsedFromSegment();
  speechEngine.pause();
  item.state = 'paused';
  appState.playback.isPlaying = false;
  refreshUI();
};

const togglePlayback = () => {
  if (appState.playback.isPlaying) {
    pausePlayback();
  } else {
    speechEngine.resume();
    if (window.speechSynthesis?.paused) {
      appState.playback.isPlaying = true;
      const item = getCurrentItem();
      if (item) {
        item.state = 'playing';
      }
      refreshUI();
    } else {
      startPlayback();
    }
  }
};

const goToNextItem = (autoplay = false) => {
  const currentIndex = appState.queue.findIndex((entry) => entry.id === appState.playback.currentId);
  const next = appState.queue[currentIndex + 1];
  if (!next) {
    addToast('Reached end of queue', 'info');
    return;
  }
  setCurrentItem(next.id);
  if (autoplay) {
    startPlayback();
  }
};

const goToPrevItem = () => {
  const currentIndex = appState.queue.findIndex((entry) => entry.id === appState.playback.currentId);
  const prev = appState.queue[currentIndex - 1];
  if (!prev) {
    addToast('This is the first item', 'info');
    return;
  }
  setCurrentItem(prev.id);
  startPlayback();
};

const skipSentence = (direction) => {
  const item = getCurrentItem();
  if (!item) {
    return;
  }
  markIntentionalCancel();
  speechEngine.cancel();
  const nextIndex = Math.min(Math.max(0, appState.playback.segmentIndex + direction), item.segments.length - 1);
  appState.playback.segmentIndex = nextIndex;
  appState.playback.offsetSeconds = 0;
  startPlayback();
  scheduleSave();
};

const seekBySeconds = (deltaSeconds) => {
  const item = getCurrentItem();
  if (!item) {
    return;
  }
  const durations = item.durations || computeDurations(item);
  const total = getTotalDuration(item);
  const target = Math.min(Math.max(0, appState.playback.elapsedSeconds + deltaSeconds), total);

  let cumulative = 0;
  let segmentIndex = 0;
  let offsetSeconds = 0;
  for (let i = 0; i < durations.length; i += 1) {
    const seg = durations[i];
    if (cumulative + seg.seconds >= target) {
      segmentIndex = i;
      offsetSeconds = target - cumulative;
      break;
    }
    cumulative += seg.seconds;
  }

  appState.playback.segmentIndex = segmentIndex;
  appState.playback.offsetSeconds = offsetSeconds;
  appState.playback.elapsedSeconds = target;
  markIntentionalCancel();
  speechEngine.cancel();
  startPlayback();
  scheduleSave();
};

const setupLongPress = (button, action) => {
  let interval = null;
  const start = () => {
    action();
    interval = window.setInterval(action, 300);
  };
  const stop = () => {
    window.clearInterval(interval);
    interval = null;
  };
  button.addEventListener('mousedown', start);
  button.addEventListener('touchstart', start);
  button.addEventListener('mouseup', stop);
  button.addEventListener('mouseleave', stop);
  button.addEventListener('touchend', stop);
};

const handleDropReorder = (fromIndex, toIndex) => {
  if (fromIndex === toIndex) {
    return;
  }
  const item = appState.queue.splice(fromIndex, 1)[0];
  appState.queue.splice(toIndex, 0, item);
  setAriaLive(`Moved ${item.title || 'item'} to position ${toIndex + 1}`);
  refreshUI();
};

const setupDragAndDrop = () => {
  dom.queueList.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.queue-item');
    if (!row) {
      return;
    }
    row.classList.add('dragging');
    event.dataTransfer.setData('text/plain', row.dataset.index);
  });
  dom.queueList.addEventListener('dragend', (event) => {
    const row = event.target.closest('.queue-item');
    if (row) {
      row.classList.remove('dragging');
    }
  });
  dom.queueList.addEventListener('dragover', (event) => {
    event.preventDefault();
    const row = event.target.closest('.queue-item');
    if (!row) {
      return;
    }
    row.classList.add('drag-over');
  });
  dom.queueList.addEventListener('dragleave', (event) => {
    const row = event.target.closest('.queue-item');
    if (row) {
      row.classList.remove('drag-over');
    }
  });
  dom.queueList.addEventListener('drop', (event) => {
    event.preventDefault();
    const row = event.target.closest('.queue-item');
    if (!row) {
      return;
    }
    row.classList.remove('drag-over');
    const fromIndex = Number(event.dataTransfer.getData('text/plain'));
    const toIndex = Number(row.dataset.index);
    handleDropReorder(fromIndex, toIndex);
  });
};

const handleKeyboardReorder = (event) => {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
    return;
  }
  const row = event.target.closest('.queue-item');
  if (!row) {
    return;
  }
  event.preventDefault();
  const fromIndex = Number(row.dataset.index);
  const toIndex = event.key === 'ArrowUp' ? Math.max(0, fromIndex - 1) : Math.min(appState.queue.length - 1, fromIndex + 1);
  handleDropReorder(fromIndex, toIndex);
};

const setupKeyboardShortcuts = () => {
  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      togglePlayback();
    }
    if (event.key.toLowerCase() === 'j') {
      skipSentence(-1);
    }
    if (event.key.toLowerCase() === 'k') {
      skipSentence(1);
    }
    if (event.key.toLowerCase() === 'n') {
      goToNextItem(true);
    }
    if (event.key.toLowerCase() === 'p') {
      goToPrevItem();
    }
    if (event.key === ',') {
      seekBySeconds(-appState.prefs.skipInterval);
    }
    if (event.key === '.') {
      seekBySeconds(appState.prefs.skipInterval);
    }
    if (event.key.toLowerCase() === 'f') {
      toggleFocusMode();
    }
    if (event.key === '?') {
      dom.shortcuts.classList.toggle('hidden');
    }
    if (event.key === 'Escape') {
      exitFocusMode();
    }
  });
};

const updateSleepTimer = () => {
  const timer = appState.playback.sleepTimer;
  if (!timer) {
    dom.sleepTimer.textContent = 'Sleep timer: off';
    return;
  }
  if (timer.mode === 'end') {
    dom.sleepTimer.textContent = 'Sleep timer: end of item';
    return;
  }
  const remaining = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
  dom.sleepTimer.textContent = `Sleep timer: ${formatTime(remaining)}`;
  if (remaining <= 0) {
    pausePlayback();
    appState.playback.sleepTimer = null;
    addToast('Sleep timer ended', 'info');
  }
};

const handleSleepTimerEndOfItem = () => {
  const timer = appState.playback.sleepTimer;
  if (timer?.mode === 'end') {
    pausePlayback();
    appState.playback.sleepTimer = null;
    addToast('Sleep timer ended at item end', 'info');
    return true;
  }
  return false;
};

const toggleFocusMode = () => {
  dom.app.classList.toggle('focus-mode');
  if (dom.app.classList.contains('focus-mode')) {
    dom.app.requestFullscreen?.().catch(() => undefined);
  }
};

const exitFocusMode = () => {
  dom.app.classList.remove('focus-mode');
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => undefined);
  }
};

const setupImportExport = () => {
  dom.exportQueue.addEventListener('click', () => {
    const data = exportState({ queue: appState.queue, prefs: appState.prefs, playback: appState.playback });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'queuetts-export.json';
    link.click();
    URL.revokeObjectURL(url);
  });

  dom.importQueue.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    try {
      const imported = importState(text);
      appState.queue = imported.queue;
      appState.prefs = { ...DEFAULT_PREFS, ...imported.prefs };
      appState.playback = { ...DEFAULT_PLAYBACK, ...imported.playback, isPlaying: false };
      applyPrefsToDom();
      refreshUI();
      addToast('Import successful', 'success');
    } catch (error) {
      addToast(`Import failed: ${error.message}`, 'error');
    }
  });

  ['dragenter', 'dragover'].forEach((type) => {
    document.addEventListener(type, (event) => {
      event.preventDefault();
    });
  });
  document.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file?.type === 'application/json') {
      const text = await file.text();
      try {
        const imported = importState(text);
        appState.queue = imported.queue;
        appState.prefs = { ...DEFAULT_PREFS, ...imported.prefs };
        appState.playback = { ...DEFAULT_PLAYBACK, ...imported.playback, isPlaying: false };
        applyPrefsToDom();
        refreshUI();
        addToast('Import successful', 'success');
      } catch (error) {
        addToast(`Import failed: ${error.message}`, 'error');
      }
    }
  });
};

const setupBookmarklets = () => {
  const buildBookmarklet = () => {
    const script = `(function(){try{var selection=window.getSelection&&window.getSelection().toString();var text='';if(selection&&selection.length>80){text=selection;}else{var article=document.querySelector('article');if(article&&article.innerText){text=article.innerText;}else{var parts=[];document.querySelectorAll('p').forEach(function(p){var t=p.innerText.trim();if(t.length>80){parts.push(t);}});text=parts.join('\\n\\n');}}if(!text||text.length<80){alert('QueueTTS: No readable text found. Try selecting the article text first.');return;}var max=200000;var truncated=false;if(text.length>max){text=text.slice(0,max);truncated=true;}var url='${PAGES_URL}#paste='+encodeURIComponent(text);window.open(url,'_blank','noopener');if(truncated){alert('QueueTTS: Long page truncated for safe import.');}}catch(e){alert('QueueTTS: Import failed.');}})();`;
    return `javascript:${script}`;
  };
  const href = buildBookmarklet();
  dom.bookmarkletHero.href = href;
  dom.bookmarkletHeroLink.href = href;
  dom.bookmarkletSettings.href = href;
};

const handleHashImport = () => {
  if (!window.location.hash.startsWith('#paste=')) {
    return;
  }
  const encoded = window.location.hash.slice(7);
  const text = decodeURIComponent(encoded || '');
  if (!text.trim()) {
    return;
  }
  dom.pasteInput.value = text;
  const item = createItem({ text, sourceType: 'paste' });
  appState.queue.push(item);
  if (!appState.playback.currentId) {
    appState.playback.currentId = item.id;
  }
  processItemText(item, { cleanup: true });
  addToast('Imported from page', 'success');
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
};

const initControls = () => {
  dom.playPause.addEventListener('click', togglePlayback);
  dom.nextItem.addEventListener('click', () => goToNextItem(true));
  dom.prevItem.addEventListener('click', goToPrevItem);
  dom.addPaste.addEventListener('click', addPasteItem);
  dom.addUrl.addEventListener('click', addUrlItem);
  dom.clearQueue.addEventListener('click', () => {
    speechEngine.cancel();
    appState.queue = [];
    appState.playback.currentId = null;
    refreshUI();
  });

  setupLongPress(dom.prevSentence, () => skipSentence(-1));
  setupLongPress(dom.nextSentence, () => skipSentence(1));

  dom.seekButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const value = Number(button.dataset.seek);
      seekBySeconds(value);
    });
  });

  dom.voiceSearch.addEventListener('input', renderVoiceOptions);
  dom.voiceSelect.addEventListener('change', () => {
    appState.prefs.voiceURI = dom.voiceSelect.value;
    scheduleSave();
  });

  dom.rateRange.addEventListener('input', () => {
    appState.prefs.rate = Number(dom.rateRange.value);
    const item = getCurrentItem();
    if (item) {
      computeDurations(item);
    }
    scheduleSave();
  });

  dom.rateTicks.forEach((button) => {
    button.addEventListener('click', () => {
      const rate = Number(button.dataset.rate);
      dom.rateRange.value = rate;
      appState.prefs.rate = rate;
      const item = getCurrentItem();
      if (item) {
        computeDurations(item);
      }
      scheduleSave();
    });
  });

  dom.skipSelect.addEventListener('change', () => {
    appState.prefs.skipInterval = Number(dom.skipSelect.value);
    scheduleSave();
  });

  dom.themeToggle.addEventListener('click', () => {
    appState.prefs.theme = appState.prefs.theme === 'dark' ? 'light' : 'dark';
    applyPrefsToDom();
    scheduleSave();
  });
  dom.contrastToggle.addEventListener('click', () => {
    appState.prefs.contrast = appState.prefs.contrast === 'high' ? 'normal' : 'high';
    applyPrefsToDom();
    scheduleSave();
  });
  dom.motionToggle.addEventListener('click', () => {
    appState.prefs.motion = appState.prefs.motion === 'reduced' ? 'full' : 'reduced';
    applyPrefsToDom();
    scheduleSave();
  });

  dom.sleepStart.addEventListener('click', () => {
    const value = dom.sleepSelect.value;
    if (value === 'off') {
      appState.playback.sleepTimer = null;
      updateSleepTimer();
      return;
    }
    if (value === 'end') {
      appState.playback.sleepTimer = { mode: 'end' };
      updateSleepTimer();
      return;
    }
    const minutes = Number(value);
    appState.playback.sleepTimer = {
      mode: 'time',
      endsAt: Date.now() + minutes * 60 * 1000,
    };
    updateSleepTimer();
  });

  dom.sleepCancel.addEventListener('click', () => {
    appState.playback.sleepTimer = null;
    updateSleepTimer();
  });

  dom.saveDict.addEventListener('click', () => {
    appState.prefs.dictionary = parseDictionary(dom.dictInput.value);
    scheduleSave();
    addToast('Dictionary saved', 'success');
  });

  dom.focusMode.addEventListener('click', toggleFocusMode);
  dom.queueList.addEventListener('keydown', handleKeyboardReorder);
  dom.sampleChip.addEventListener('click', addSampleItem);

  setupImportExport();
  setupBookmarklets();
};

const setupTabs = () => {
  dom.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      dom.tabs.forEach((btn) => btn.classList.remove('tab--active'));
      tab.classList.add('tab--active');
      const mode = tab.dataset.mode;
      dom.panes.forEach((pane) => {
        pane.classList.toggle('hidden', pane.dataset.pane !== mode);
      });
    });
  });
};

const hydrateState = () => {
  const saved = loadState();
  if (!saved) {
    return;
  }
  appState.queue = saved.queue || [];
  appState.prefs = { ...DEFAULT_PREFS, ...saved.prefs };
  appState.playback = { ...DEFAULT_PLAYBACK, ...saved.playback, isPlaying: false };
  appState.queue.forEach((item) => {
    if (item.state === 'playing') {
      item.state = 'paused';
    }
  });
};

const startTicker = () => {
  window.setInterval(() => {
    if (appState.playback.isPlaying) {
      updateElapsedFromSegment();
      scheduleSave();
    }
    updateProgress();
    updateSleepTimer();
  }, 1000);
};

const initDom = () => {
  dom.app = qs('#app');
  dom.playPause = qs('#playPause');
  dom.prevItem = qs('#prevItem');
  dom.nextItem = qs('#nextItem');
  dom.prevSentence = qs('#prevSentence');
  dom.nextSentence = qs('#nextSentence');
  dom.seekButtons = qsa('[data-seek]');
  dom.voiceSearch = qs('#voiceSearch');
  dom.voiceSelect = qs('#voiceSelect');
  dom.rateRange = qs('#rateRange');
  dom.rateTicks = qsa('.pill');
  dom.skipSelect = qs('#skipSelect');
  dom.nowTitle = qs('#nowTitle');
  dom.nowStatus = qs('#nowStatus');
  dom.progressFill = qs('#progressFill');
  dom.elapsed = qs('#elapsed');
  dom.remaining = qs('#remaining');
  dom.nowSpeaking = qs('#nowSpeaking');
  dom.sleepTimer = qs('#sleepTimer');
  dom.addPaste = qs('#addPaste');
  dom.addUrl = qs('#addUrl');
  dom.pasteInput = qs('#pasteInput');
  dom.cleanupToggle = qs('#cleanupToggle');
  dom.urlInput = qs('#urlInput');
  dom.queueList = qs('#queueList');
  dom.clearQueue = qs('#clearQueue');
  dom.toastStack = qs('#toastStack');
  dom.themeToggle = qs('#themeToggle');
  dom.contrastToggle = qs('#contrastToggle');
  dom.motionToggle = qs('#motionToggle');
  dom.exportQueue = qs('#exportQueue');
  dom.importQueue = qs('#importQueue');
  dom.tabs = qsa('.tab');
  dom.panes = qsa('.add-pane');
  dom.sleepSelect = qs('#sleepSelect');
  dom.sleepStart = qs('#sleepStart');
  dom.sleepCancel = qs('#sleepCancel');
  dom.dictInput = qs('#dictInput');
  dom.saveDict = qs('#saveDict');
  dom.focusMode = qs('#focusMode');
  dom.upNext = qs('#upNext');
  dom.shortcuts = qs('#shortcuts');
  dom.ariaLive = qs('#ariaLive');
  dom.sampleChip = qs('#sampleChip');
  dom.bookmarkletHero = qs('#bookmarkletHero');
  dom.bookmarkletHeroLink = qs('#bookmarkletHeroLink');
  dom.bookmarkletSettings = qs('#bookmarkletSettings');
  dom.languageHint = qs('#languageHint');
  dom.headingMode = qs('#headingMode');
  dom.languageHintUrl = qs('#languageHintUrl');
  dom.headingModeUrl = qs('#headingModeUrl');
};

export const initApp = async () => {
  initDom();
  hydrateState();
  applyPrefsToDom();
  updateQueueUI();
  updateNowPlaying();
  dom.dictInput.value = Object.entries(appState.prefs.dictionary).map(([key, value]) => `${key} => ${value}`).join('\n');

  setupTabs();
  initControls();
  setupDragAndDrop();
  setupKeyboardShortcuts();
  await updateVoices();
  startTicker();
  handleHashImport();

  if (appState.queue.length && !appState.playback.currentId) {
    appState.playback.currentId = appState.queue[0].id;
  }
  if (appState.playback.currentId) {
    updateNowPlaying();
    updateProgress();
    addToast('Playback restored. Press play to resume.', 'info');
  }
  refreshUI();
};
