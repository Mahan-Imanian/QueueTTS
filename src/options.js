import {
  STORAGE_KEY,
  fmtTime,
  parseDictionary,
  parseImport,
  queueSummary,
  readState,
  serializeExport,
  storageBytes,
  updateState,
  writeState
} from "./shared.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const els = {
  saveState: $("#saveState"),
  statusVoice: $("#statusVoice"),
  statusQueue: $("#statusQueue"),
  statusStorage: $("#statusStorage"),
  voiceSelect: $("#voiceSelect"),
  voiceStatus: $("#voiceStatus"),
  langInput: $("#langInput"),
  rateInput: $("#rateInput"),
  pitchInput: $("#pitchInput"),
  volumeInput: $("#volumeInput"),
  rateValue: $("#rateValue"),
  pitchValue: $("#pitchValue"),
  volumeValue: $("#volumeValue"),
  skipSelect: $("#skipSelect"),
  headingMode: $("#headingMode"),
  sleepMinutes: $("#sleepMinutes"),
  theme: $("#theme"),
  reduceMotion: $("#reduceMotion"),
  autoPlayCaptured: $("#autoPlayCaptured"),
  ruleFrom: $("#ruleFrom"),
  ruleTo: $("#ruleTo"),
  addRule: $("#addRule"),
  ruleList: $("#ruleList"),
  dictionaryRaw: $("#dictionaryRaw"),
  applyRaw: $("#applyRaw"),
  dictionaryCount: $("#dictionaryCount"),
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
let rules = parseDictionary(state.settings.dictionary || "");
let saving = 0;

const message = (payload) => chrome.runtime.sendMessage(payload);
const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const dictionaryText = () => rules.map((rule) => `${rule.from} => ${rule.to}`).join("\n");
const niceRate = (value) => `${Number(value || 1).toFixed(2).replace(/\.00$/, "")}×`;

const toast = (text, mode = "") => {
  const node = document.createElement("div");
  node.className = `toast ${mode}`.trim();
  node.textContent = text;
  els.toasts.append(node);
  setTimeout(() => node.remove(), 2600);
};

const setSaveState = (label = "Saved", mode = "completed") => {
  els.saveState.className = `status-badge ${mode}`.trim();
  els.saveState.textContent = label;
};

const loadVoices = async () => {
  const response = await message({ type: "QTTS_GET_VOICES" });
  voices = response?.voices || [];
  els.voiceStatus.className = `status-badge ${voices.length ? "completed" : "failed"}`;
  els.voiceStatus.textContent = voices.length ? `${voices.length} voices` : "No voices";
  const options = [`<option value="">Chrome default voice</option>`].concat(voices.map((voice) => `<option value="${escapeHtml(voice.voiceName)}">${escapeHtml(voice.voiceName)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ""}${voice.remote ? " · remote" : ""}</option>`));
  els.voiceSelect.innerHTML = options.join("");
};

const renderRules = () => {
  els.dictionaryCount.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  els.dictionaryRaw.value = dictionaryText();
  if (!rules.length) {
    els.ruleList.innerHTML = `<div class="empty-rule"><strong>No pronunciation rules yet.</strong><span>Add words, acronyms, names, or product terms that Chrome TTS should speak differently.</span></div>`;
    return;
  }
  els.ruleList.innerHTML = rules.map((rule, index) => `<article class="rule-row" data-rule-index="${index}">
    <input class="rule-input" data-rule-field="from" value="${escapeHtml(rule.from)}" aria-label="Text to replace" />
    <span class="rule-arrow">→</span>
    <input class="rule-input" data-rule-field="to" value="${escapeHtml(rule.to)}" aria-label="Spoken form" />
    <button class="button secondary small" data-rule-test="${index}" type="button">Test</button>
    <button class="button danger small" data-rule-delete="${index}" type="button">Delete</button>
  </article>`).join("");
  $$('[data-rule-field]').forEach((input) => input.addEventListener("input", () => {
    const row = input.closest(".rule-row");
    const index = Number(row.dataset.ruleIndex);
    const field = input.dataset.ruleField;
    rules[index] = { ...rules[index], [field]: input.value.trim() };
    scheduleSave();
  }));
  $$('[data-rule-delete]').forEach((button) => button.addEventListener("click", () => {
    rules.splice(Number(button.dataset.ruleDelete), 1);
    renderRules();
    saveSettingsNow("Rule removed");
  }));
  $$('[data-rule-test]').forEach((button) => button.addEventListener("click", () => testRule(Number(button.dataset.ruleTest))));
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
  els.rateValue.value = niceRate(state.settings.rate);
  els.pitchValue.value = Number(state.settings.pitch || 1).toFixed(2).replace(/\.00$/, "");
  els.volumeValue.value = `${Math.round(Number(state.settings.volume || 1) * 100)}%`;
  els.skipSelect.value = String(state.settings.skipSeconds);
  els.headingMode.value = state.settings.headingMode;
  els.sleepMinutes.value = String(state.settings.sleepMinutes);
  els.theme.value = state.settings.theme;
  els.reduceMotion.checked = Boolean(state.settings.reduceMotion);
  els.autoPlayCaptured.checked = Boolean(state.settings.autoPlayCaptured);
  rules = parseDictionary(state.settings.dictionary || "");
  renderRules();
  const summary = queueSummary(state);
  const bytes = await storageBytes();
  els.storageItems.textContent = String(summary.total);
  els.storageWords.textContent = String(summary.words);
  els.storageBytes.textContent = `${bytes.toLocaleString()} B`;
  els.statusVoice.textContent = state.settings.voiceName || "Default";
  els.statusQueue.textContent = `${summary.total} ${summary.total === 1 ? "item" : "items"} · ${fmtTime(summary.seconds)}`;
  els.statusStorage.textContent = `${bytes.toLocaleString()} B`;
  setSaveState();
};

const settingsFromControls = () => ({
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
  dictionary: dictionaryText()
});

const saveSettingsNow = async (confirmation = "Saved") => {
  clearTimeout(saving);
  setSaveState("Saving", "queued");
  await updateState((current) => ({ ...current, settings: { ...current.settings, ...settingsFromControls() } }));
  await message({ type: "QTTS_SLEEP", minutes: Number(els.sleepMinutes.value) });
  state = await readState();
  const summary = queueSummary(state);
  const bytes = await storageBytes();
  els.statusVoice.textContent = state.settings.voiceName || "Default";
  els.statusQueue.textContent = `${summary.total} ${summary.total === 1 ? "item" : "items"} · ${fmtTime(summary.seconds)}`;
  els.statusStorage.textContent = `${bytes.toLocaleString()} B`;
  setSaveState(confirmation, "completed");
};

const scheduleSave = () => {
  clearTimeout(saving);
  setSaveState("Saving", "queued");
  saving = setTimeout(() => saveSettingsNow(), 180);
};

const exportData = async () => {
  const blob = new Blob([serializeExport(await readState())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `queuetts-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Backup exported");
};

const importData = async (file) => {
  try {
    const raw = await file.text();
    await writeState(parseImport(raw));
    toast("Backup imported");
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
  if (!confirm("Export a backup first if you need it. Clear all QueueTTS queue items, counters, and playback state now?")) return;
  await message({ type: "QTTS_STOP" });
  await updateState((current) => ({ ...current, queue: [], playback: { ...current.playback, itemId: "", segmentIndex: 0, status: "idle" }, stats: { days: {} } }));
  toast("All local data cleared");
  await render();
};

const speak = (text) => {
  const options = { rate: Number(els.rateInput.value), pitch: Number(els.pitchInput.value), volume: Number(els.volumeInput.value) };
  if (els.voiceSelect.value) options.voiceName = els.voiceSelect.value;
  if (els.langInput.value.trim()) options.lang = els.langInput.value.trim();
  chrome.tts.stop();
  chrome.tts.speak(text, options);
};

const playSample = () => speak("QueueTTS is ready to capture text from the browser and read it locally.");
const testRule = (index) => {
  const rule = rules[index];
  if (!rule?.from || !rule?.to) return toast("Complete both sides of the rule first", "error");
  speak(`${rule.from}. ${rule.to}.`);
};

const addRule = async () => {
  const from = els.ruleFrom.value.trim();
  const to = els.ruleTo.value.trim();
  if (!from || !to) return toast("Add both the source text and spoken form", "error");
  if (rules.some((rule) => rule.from.toLowerCase() === from.toLowerCase())) return toast("That source text already has a rule", "error");
  rules.push({ from, to });
  els.ruleFrom.value = "";
  els.ruleTo.value = "";
  renderRules();
  await saveSettingsNow("Rule added");
};

const applyRaw = async () => {
  rules = parseDictionary(els.dictionaryRaw.value);
  renderRules();
  await saveSettingsNow("Dictionary updated");
};

[els.voiceSelect, els.langInput, els.rateInput, els.pitchInput, els.volumeInput, els.skipSelect, els.headingMode, els.sleepMinutes, els.theme, els.reduceMotion, els.autoPlayCaptured].forEach((input) => input.addEventListener("input", scheduleSave));
[els.rateInput, els.pitchInput, els.volumeInput].forEach((input) => input.addEventListener("input", () => {
  els.rateValue.value = niceRate(els.rateInput.value);
  els.pitchValue.value = Number(els.pitchInput.value || 1).toFixed(2).replace(/\.00$/, "");
  els.volumeValue.value = `${Math.round(Number(els.volumeInput.value || 1) * 100)}%`;
}));
els.playSample.addEventListener("click", playSample);
els.stopSample.addEventListener("click", () => chrome.tts.stop());
els.addRule.addEventListener("click", addRule);
els.ruleTo.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addRule();
});
els.applyRaw.addEventListener("click", applyRaw);
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
