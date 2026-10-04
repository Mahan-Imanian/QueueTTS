import { normalizeQueue } from "../lib/store.js";
import { baseLang, describeVoice as voiceInfo, languageName, rankVoices } from "../lib/voices.js";
import { $, applyTheme, createStore, escape, h, historyItems, icon, isActive, queuedItems, send, speedLabel, toast } from "./common.js";
import { preview } from "./deck.js";

const els = {
  voiceLang: $("#voiceLang"),
  voiceList: $("#voiceList"),
  diagnostics: $("#diagnostics"),
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

let store = await createStore((changed, snapshot) => {
  store = snapshot;
  if (changed.has("settings")) fill();
  if (changed.has("queue")) usage();
});
let voices = [];
let savedTimer = 0;
let voiceLanguage = baseLang(navigator.language);

const save = async (patch, label = "Saved") => {
  const result = await send("settings", patch);
  if (!result.ok) return toast(result.message || "Couldn’t save that setting.");
  clearTimeout(savedTimer);
  els.saved.textContent = label;
  savedTimer = setTimeout(() => (els.saved.textContent = ""), 1600);
};

const renderLanguages = () => {
  const languages = [...new Set(voices.map((voice) => baseLang(voice.lang)).filter(Boolean))];
  if (!languages.includes(voiceLanguage)) voiceLanguage = languages.includes("en") ? "en" : languages[0] || "en";
  languages.sort((a, b) => (a === voiceLanguage ? -1 : b === voiceLanguage ? 1 : languageName(a).localeCompare(languageName(b))));
  els.voiceLang.innerHTML = languages.map((lang) => `<option value="${lang}">${escape(languageName(lang))}${store.settings.voices[lang] ? " ·  chosen" : ""}</option>`).join("");
  els.voiceLang.value = voiceLanguage;
};

const renderVoiceList = async () => {
  if (!voices.length) {
    els.voiceList.innerHTML = `<p class="field-hint">Chrome reports no voices. Install a text-to-speech voice in your operating system settings, then restart Chrome.</p>`;
    return;
  }
  const chosen = store.settings.voices[voiceLanguage] || "";
  const automatic = (await send("resolvedVoice", voiceLanguage)).voice;
  const inLanguage = rankVoices(voices, { lang: voiceLanguage, allowNetwork: true }).filter((voice) => baseLang(voice.lang) === voiceLanguage);
  const ranked = [...inLanguage.filter((voice) => !voice.remote), ...inLanguage.filter((voice) => voice.remote)];
  const row = (voice) => {
    const info = voiceInfo(voice);
    const blocked = info.remote && !store.settings.allowNetworkVoices;
    return `<label class="voice-row${blocked ? " muted" : ""}">
      <input type="radio" name="voice" value="${escape(voice.voiceName)}" ${voice.voiceName === chosen ? "checked" : ""} />
      <span class="voice-text"><span class="voice-label">${escape(info.label)}</span><span class="voice-detail">${escape(info.language)} · ${info.remote ? `<span class="tier tier-online">Online</span>, text is sent to Google${blocked ? " (turn on online voices below, or pick it to allow)" : ""}` : `<span class="tier tier-${info.tier}">${info.tierLabel}</span>, on this computer`}${info.highlights ? "" : " · no word highlight"}</span></span>
      <button class="btn" type="button" data-preview="${escape(voice.voiceName)}" aria-label="Preview ${escape(info.label)}">${icon("play", "sm")}<span>Preview</span></button>
    </label>`;
  };
  els.voiceList.innerHTML = `<label class="voice-row">
      <input type="radio" name="voice" value="" ${chosen ? "" : "checked"} />
      <span class="voice-text"><span class="voice-label">Automatic</span><span class="voice-detail">${automatic ? `Currently ${escape(voiceInfo(automatic).label)}, ${automatic.remote ? "online" : "on this computer"}` : "No voice available"}</span></span>
      <span></span>
    </label>${ranked.map(row).join("")}`;
};

const describeVoice = async () => {
  const resolved = (await send("resolvedVoice", voiceLanguage)).voice;
  els.voicePrivacy.textContent = resolved?.remote
    ? `Your ${languageName(voiceLanguage)} voice is an online Google voice, so the text being read is sent to Google while you listen.`
    : "Your current voice runs on this computer, so the text being read never leaves it.";
};

const renderDiagnostics = async () => {
  const manifest = chrome.runtime.getManifest();
  $("#version").textContent = `Version ${manifest.version}`;
  const result = await send("diagnostics");
  const start = result.lastStart;
  const at = (name) => start?.marks?.find((entry) => entry.name === name)?.ms;
  const firstSound = at("first word") ?? at("start event");
  const bytes = await chrome.storage.local.getBytesInUse(null);
  const chrome_ = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "unknown";
  const rows = [
    ["Last start", start && firstSound != null ? `${Math.round(firstSound)} ms from Play to the first spoken word${at("text ready") != null ? ` (QueueTTS ${Math.round(at("speak called") ?? 0)} ms, speech engine ${Math.round(firstSound - (at("speak called") ?? 0))} ms)` : ""}` : "Play something to measure"],
    ["Voice", start?.marks?.find((entry) => entry.name === "voice ready")?.voice || "Not used yet"],
    ["Stored", `${bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`} in this browser`],
    ["Chrome", chrome_]
  ];
  els.diagnostics.replaceChildren(...rows.flatMap(([term, value]) => [h("dt", { text: term }), h("dd", { text: value })]));
};

const fill = () => {
  const { settings } = store;
  applyTheme(settings);
  if (voices.length) {
    renderLanguages();
    renderVoiceList();
  }
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
  const options = { rate: settings.rate, pitch: settings.pitch, volume: settings.volume || 1 };
  const chosen = settings.voices[voiceLanguage] || (await send("resolvedVoice", voiceLanguage)).voice?.voiceName;
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

els.voiceLang.addEventListener("change", () => {
  voiceLanguage = els.voiceLang.value;
  renderVoiceList();
  describeVoice();
});
els.voiceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-preview]");
  if (!button) return;
  event.preventDefault();
  preview(button.dataset.preview, store.settings, store.player);
});
els.voiceList.addEventListener("change", (event) => {
  const name = event.target.value;
  const chosen = voices.find((voice) => voice.voiceName === name);
  const map = { ...store.settings.voices };
  if (name) map[voiceLanguage] = name;
  else delete map[voiceLanguage];
  save(chosen?.remote ? { voices: map, allowNetworkVoices: true } : { voices: map }, chosen?.remote ? "Saved · online voice" : "Saved");
});
els.network.addEventListener("change", () => {
  if (els.network.checked) return save({ allowNetworkVoices: true });
  const map = Object.fromEntries(Object.entries(store.settings.voices).filter(([, name]) => !voices.find((voice) => voice.voiceName === name)?.remote));
  save({ allowNetworkVoices: false, voices: map });
});
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
fill();
usage();
shortcuts();
renderDiagnostics();
