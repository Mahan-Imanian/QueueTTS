import { normalizeQueue } from "../lib/store.js";
import { formatDuration } from "../lib/text.js";
import { $, applyTheme, createStore, escape, h, historyItems, icon, isActive, queuedItems, send, speedLabel, toast } from "./common.js";

const els = {
  voice: $("#voice"),
  voiceHint: $("#voiceHint"),
  preview: $("#preview"),
  network: $("#network"),
  rate: $("#rate"),
  rateOut: $("#rateOut"),
  pitch: $("#pitch"),
  pitchOut: $("#pitchOut"),
  volume: $("#volume"),
  volumeOut: $("#volumeOut"),
  autoAdvance: $("#autoAdvance"),
  readCode: $("#readCode"),
  announceHeadings: $("#announceHeadings"),
  shortcuts: $("#shortcuts"),
  pronList: $("#pronList"),
  pronForm: $("#pronForm"),
  pronFrom: $("#pronFrom"),
  pronTo: $("#pronTo"),
  usage: $("#usage"),
  saved: $("#saved"),
  confirm: $("#confirm"),
  voicePrivacy: $("#voicePrivacy")
};

els.preview.innerHTML = `${icon("play", "sm")}<span>Preview</span>`;
let store = await createStore((changed, snapshot) => {
  store = snapshot;
  if (changed.has("settings")) fill();
  if (changed.has("queue")) usage();
});
let voices = [];
let savedTimer = 0;

const save = async (patch, label = "Saved") => {
  const result = await send("settings", patch);
  if (!result.ok) return toast(result.message || "Couldn’t save that setting.");
  clearTimeout(savedTimer);
  els.saved.textContent = label;
  savedTimer = setTimeout(() => (els.saved.textContent = ""), 1600);
};

const renderVoices = () => {
  const local = voices.filter((voice) => !voice.remote);
  const online = voices.filter((voice) => voice.remote);
  const option = (voice) => `<option value="${escape(voice.voiceName)}">${escape(voice.voiceName)}${voice.lang ? ` (${escape(voice.lang)})` : ""}</option>`;
  els.voice.innerHTML = `<option value="">Automatic</option>${local.length ? `<optgroup label="On this computer">${local.map(option).join("")}</optgroup>` : ""}${online.length ? `<optgroup label="Online · text is sent to Google">${online.map(option).join("")}</optgroup>` : ""}`;
  els.voice.value = store.settings.voice;
  if (!local.length && !online.length) els.voiceHint.textContent = "Chrome reports no voices. Install a text-to-speech voice in your operating system settings, then restart Chrome.";
};

const describeVoice = async () => {
  const result = await send("resolvedVoice", "en");
  const voice = result.voice;
  if (!store.settings.voice) els.voiceHint.textContent = voice ? `Automatic picks the best voice for each article’s language. For English that’s ${voice.voiceName}.` : "Automatic picks the best voice for each article’s language.";
  const chosen = voices.find((entry) => entry.voiceName === store.settings.voice);
  const remote = chosen ? chosen.remote : voice?.remote;
  els.voicePrivacy.textContent = remote
    ? "Your current voice is an online Google voice, so the text being read is sent to Google while you listen."
    : "Your current voice runs on this computer, so the text being read never leaves it.";
};

const fill = () => {
  const { settings } = store;
  applyTheme(settings);
  if (voices.length) els.voice.value = settings.voice;
  els.network.checked = settings.allowNetworkVoices;
  els.rate.value = settings.rate;
  els.rateOut.textContent = speedLabel(settings.rate);
  els.pitch.value = settings.pitch;
  els.pitchOut.textContent = Number(settings.pitch).toFixed(1);
  els.volume.value = settings.volume;
  els.volumeOut.textContent = `${Math.round(settings.volume * 100)}%`;
  els.autoAdvance.checked = settings.autoAdvance;
  els.readCode.checked = settings.readCode;
  els.announceHeadings.checked = settings.announceHeadings;
  for (const radio of document.querySelectorAll("[name='theme']")) radio.checked = radio.value === settings.theme;
  renderPronunciations();
  describeVoice();
};

const renderPronunciations = () => {
  const rules = store.settings.pronunciations;
  els.pronList.replaceChildren(...rules.map((rule, index) => h("li", { class: "pron" },
    h("span", { class: "pron-from", text: rule.from }),
    h("span", { class: "pron-arrow", "aria-hidden": "true", text: "→" }),
    h("span", { class: "pron-to", text: rule.to }),
    h("button", { class: "icon-btn", type: "button", "aria-label": `Hear “${rule.to}”`, title: "Hear it", html: icon("play", "sm"), onclick: () => speak(`${rule.to}.`) }),
    h("button", { class: "icon-btn", type: "button", "aria-label": `Remove ${rule.from}`, title: "Remove", html: icon("close", "sm"), onclick: () => save({ pronunciations: rules.filter((_, i) => i !== index) }, "Removed") })
  )));
  if (!rules.length) els.pronList.append(h("li", { class: "meta", text: "None yet." }));
};

const speak = async (text) => {
  if (isActive(store.player)) await send("pause");
  const settings = store.settings;
  const options = { rate: settings.rate, pitch: settings.pitch, volume: settings.volume };
  const chosen = els.voice.value || (await send("resolvedVoice", "en")).voice?.voiceName;
  if (chosen) options.voiceName = chosen;
  chrome.tts.stop();
  chrome.tts.speak(text, options);
};

const usage = async () => {
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const queued = queuedItems(store.queue).length;
  const done = historyItems(store.queue).length;
  const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  els.usage.textContent = `${queued} in the queue, ${done} in history, using ${size} on this computer.`;
};

const ask = (title, text, ok) => new Promise((resolve) => {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmOk").textContent = ok;
  els.confirm.returnValue = "";
  els.confirm.showModal();
  els.confirm.addEventListener("close", () => resolve(els.confirm.returnValue === "ok"), { once: true });
});

els.voice.addEventListener("change", () => {
  const chosen = voices.find((voice) => voice.voiceName === els.voice.value);
  save(chosen?.remote ? { voice: els.voice.value, allowNetworkVoices: true } : { voice: els.voice.value });
});
els.preview.addEventListener("click", () => speak("This is how your articles will sound. Pauses, headings and quotes are read naturally."));
els.network.addEventListener("change", () => save(els.network.checked ? { allowNetworkVoices: true } : { allowNetworkVoices: false, voice: voices.find((voice) => voice.voiceName === store.settings.voice)?.remote ? "" : store.settings.voice }));
for (const [input, key, out, format] of [[els.rate, "rate", els.rateOut, speedLabel], [els.pitch, "pitch", els.pitchOut, (v) => Number(v).toFixed(1)], [els.volume, "volume", els.volumeOut, (v) => `${Math.round(v * 100)}%`]]) {
  input.addEventListener("input", () => (out.textContent = format(Number(input.value))));
  input.addEventListener("change", () => save({ [key]: Number(input.value) }));
}
for (const key of ["autoAdvance", "readCode", "announceHeadings"]) els[key].addEventListener("change", () => save({ [key]: els[key].checked }));
for (const radio of document.querySelectorAll("[name='theme']")) radio.addEventListener("change", () => save({ theme: radio.value }));

els.pronForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const from = els.pronFrom.value.trim();
  const to = els.pronTo.value.trim();
  if (!from || !to) return;
  const rest = store.settings.pronunciations.filter((rule) => rule.from.toLowerCase() !== from.toLowerCase());
  save({ pronunciations: [...rest, { from, to }] }, "Added");
  els.pronFrom.value = "";
  els.pronTo.value = "";
  els.pronFrom.focus();
});

$("#editShortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

$("#export").addEventListener("click", async () => {
  const keys = store.queue.items.map((item) => `doc:${item.id}`);
  const docs = await chrome.storage.local.get(keys);
  const payload = { app: "QueueTTS", schema: 3, exportedAt: new Date().toISOString(), settings: store.settings, queue: store.queue, docs: Object.fromEntries(store.queue.items.map((item) => [item.id, docs[`doc:${item.id}`]]).filter(([, doc]) => doc)) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const link = h("a", { href: url, download: `queuetts-${new Date().toISOString().slice(0, 10)}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${store.queue.items.length} items`);
});

$("#importButton").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async () => {
  const file = $("#importFile").files[0];
  $("#importFile").value = "";
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast("That file isn’t a QueueTTS export.");
  }
  if (data?.app !== "QueueTTS" || !data.queue) return toast("That file isn’t a QueueTTS export.");
  const incoming = normalizeQueue(data.queue);
  const known = new Set(store.queue.items.map((item) => item.id));
  const fresh = incoming.items.filter((item) => !known.has(item.id)).length;
  if (!fresh) return toast("Everything in that file is already here.");
  const keepSettings = await ask("Import queue", `Add ${fresh} ${fresh === 1 ? "item" : "items"} from this file to your queue? Nothing you have now is replaced.`, "Import");
  if (!keepSettings) return;
  const result = await send("importData", { queue: data.queue, docs: data.docs || {} });
  toast(result.ok ? `Imported ${result.added} ${result.added === 1 ? "item" : "items"}` : result.message || "Import failed.");
});

$("#clearHistory").addEventListener("click", async () => {
  const count = historyItems(store.queue).length;
  if (!count) return toast("History is already empty.");
  if (!(await ask("Clear history", `Remove ${count} listened ${count === 1 ? "item" : "items"}? Your queue isn’t affected.`, "Clear history"))) return;
  await send("clearHistory");
  toast("History cleared");
});

$("#reset").addEventListener("click", async () => {
  if (!(await ask("Delete everything", "This removes your whole queue, your history and everything you’ve added. Settings are kept. Export first if you might want it back.", "Delete everything"))) return;
  await send("reset");
  toast("Everything was deleted");
});

const shortcuts = async () => {
  const commands = await chrome.commands.getAll();
  const labels = { "queue-page": "Add this page (or the selected text)", "toggle-playback": "Play or pause", _execute_action: "Open QueueTTS", "skip-forward": "Forward one sentence", "skip-back": "Back one sentence" };
  els.shortcuts.replaceChildren(...commands.flatMap((command) => [
    h("dt", { html: command.shortcut ? command.shortcut.split("+").map((key) => `<kbd>${escape(key)}</kbd>`).join(" ") : `<span class="meta">Not set</span>` }),
    h("dd", { text: labels[command.name] || command.description })
  ]));
};

const loaded = await send("voices");
voices = loaded.voices || [];
renderVoices();
fill();
usage();
shortcuts();
