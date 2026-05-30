import {
  STORAGE_KEY,
  fmtTime,
  parseImport,
  queueSummary,
  readState,
  serializeExport,
  storageBytes,
  updateState,
  writeState
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const els = {
  voiceSelect: $("#voiceSelect"),
  voiceStatus: $("#voiceStatus"),
  langInput: $("#langInput"),
  rateInput: $("#rateInput"),
  pitchInput: $("#pitchInput"),
  volumeInput: $("#volumeInput"),
  skipSelect: $("#skipSelect"),
  headingMode: $("#headingMode"),
  sleepMinutes: $("#sleepMinutes"),
  theme: $("#theme"),
  reduceMotion: $("#reduceMotion"),
  autoPlayCaptured: $("#autoPlayCaptured"),
  dictionary: $("#dictionary"),
  playSample: $("#playSample"),
  stopSample: $("#stopSample"),
  exportData: $("#exportData"),
  importFile: $("#importFile"),
  clearCompleted: $("#clearCompleted"),
  clearAll: $("#clearAll"),
  storageItems: $("#storageItems"),
  storageWords: $("#storageWords"),
  storageBytes: $("#storageBytes"),
  openQueue: $("#openQueue"),
  toasts: $("#toasts")
};

let state = await readState();
let voices = [];
let saving = 0;

const message = (payload) => chrome.runtime.sendMessage(payload);

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 2800);
};

const loadVoices = async () => {
  const response = await message({ type: "QTTS_GET_VOICES" });
  voices = response?.voices || [];
  els.voiceStatus.className = `status-badge ${voices.length ? "completed" : "failed"}`;
  els.voiceStatus.textContent = voices.length ? `${voices.length} voices` : "No voices";
  const options = [`<option value="">Chrome default voice</option>`].concat(voices.map((voice) => `<option value="${voice.voiceName}">${voice.voiceName}${voice.lang ? ` · ${voice.lang}` : ""}${voice.remote ? " · remote" : ""}</option>`));
  els.voiceSelect.innerHTML = options.join("");
};

const render = async () => {
  state = await readState();
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.motion = state.settings.reduceMotion ? "reduced" : "full";
  els.voiceSelect.value = state.settings.voiceName || "";
  els.langInput.value = state.settings.lang || "";
  els.rateInput.value = state.settings.rate;
  els.pitchInput.value = state.settings.pitch;
  els.volumeInput.value = state.settings.volume;
  els.skipSelect.value = String(state.settings.skipSeconds);
  els.headingMode.value = state.settings.headingMode;
  els.sleepMinutes.value = String(state.settings.sleepMinutes);
  els.theme.value = state.settings.theme;
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
  els.autoPlayCaptured.checked = Boolean(state.settings.autoPlayCaptured);
  els.dictionary.value = state.settings.dictionary || "";
  const summary = queueSummary(state);
  els.storageItems.textContent = String(summary.total);
  els.storageWords.textContent = String(summary.words);
  els.storageBytes.textContent = String(await storageBytes());
};

const saveSettings = async () => {
  clearTimeout(saving);
  saving = setTimeout(async () => {
    await updateState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        voiceName: els.voiceSelect.value,
        lang: els.langInput.value.trim(),
        rate: Number(els.rateInput.value),
        pitch: Number(els.pitchInput.value),
        volume: Number(els.volumeInput.value),
        skipSeconds: Number(els.skipSelect.value),
        headingMode: els.headingMode.value,
        sleepMinutes: Number(els.sleepMinutes.value),
        theme: els.theme.value,
        reduceMotion: els.reduceMotion.checked,
        autoPlayCaptured: els.autoPlayCaptured.checked,
        dictionary: els.dictionary.value
      }
    }));
    await message({ type: "QTTS_SLEEP", minutes: Number(els.sleepMinutes.value) });
    await render();
  }, 120);
};

const exportData = async () => {
  const blob = new Blob([serializeExport(await readState())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `queuetts-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Export created");
};

const importData = async (file) => {
  try {
    const raw = await file.text();
    await writeState(parseImport(raw));
    toast("Import complete");
    await render();
  } catch (error) {
    toast(error?.message || "Import failed", "error");
  }
};

const clearCompleted = async () => {
  await updateState((current) => ({ ...current, queue: current.queue.filter((item) => item.state !== "completed") }));
  toast("Completed items cleared");
  await render();
};

const clearAll = async () => {
  if (!confirm("Clear all QueueTTS data? This removes the queue, counters, and playback state.")) return;
  await message({ type: "QTTS_STOP" });
  await updateState((current) => ({ ...current, queue: [], playback: { ...current.playback, itemId: "", segmentIndex: 0, status: "idle" }, stats: { days: {} } }));
  toast("All QueueTTS data cleared");
  await render();
};

const playSample = async () => {
  const options = {
    rate: Number(els.rateInput.value),
    pitch: Number(els.pitchInput.value),
    volume: Number(els.volumeInput.value)
  };
  if (els.voiceSelect.value) options.voiceName = els.voiceSelect.value;
  if (els.langInput.value.trim()) options.lang = els.langInput.value.trim();
  chrome.tts.stop();
  chrome.tts.speak("QueueTTS is ready to capture text from the browser and read it back locally.", options);
};

[els.voiceSelect, els.langInput, els.rateInput, els.pitchInput, els.volumeInput, els.skipSelect, els.headingMode, els.sleepMinutes, els.theme, els.reduceMotion, els.autoPlayCaptured, els.dictionary].forEach((input) => input.addEventListener("input", saveSettings));
els.playSample.addEventListener("click", playSample);
els.stopSample.addEventListener("click", () => chrome.tts.stop());
els.exportData.addEventListener("click", exportData);
els.clearCompleted.addEventListener("click", clearCompleted);
els.clearAll.addEventListener("click", clearAll);
els.importFile.addEventListener("change", () => {
  const file = els.importFile.files?.[0];
  if (file) importData(file);
  els.importFile.value = "";
});
els.openQueue.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("pages/sidepanel.html") }));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

await loadVoices();
await render();
