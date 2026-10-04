import { rankVoices, shortVoiceName } from "../lib/voices.js";
import { $, applyTheme, connectSpeech, createStore, escape, icon, send } from "./common.js";
import { mountDeck, preview } from "./deck.js";

const deck = mountDeck($("#deck"), { compact: true });
let store = await createStore((changed, snapshot) => {
  store = snapshot;
  applyTheme(store.settings);
  deck.update(store, changed);
  $("#demo").hidden = !$("#deck").hidden;
  syncChoice();
});
applyTheme(store.settings);
deck.update(store);
$("#demo").hidden = !$("#deck").hidden;

const demo = $("#demo");
demo.innerHTML = `${icon("play", "sm")}<span>Hear how it works</span>`;
demo.addEventListener("click", async () => {
  demo.disabled = true;
  const result = await send("addSample");
  demo.disabled = false;
  if (result.ok) {
    demo.hidden = true;
    $("#deck").hidden = false;
  }
});

const voices = (await send("voices")).voices || [];
const lang = (navigator.language || "en").split("-")[0];
const local = rankVoices(voices, { lang, allowNetwork: false })[0];
const online = rankVoices(voices.filter((voice) => voice.remote), { lang, allowNetwork: true })[0];
$("#localVoice").textContent = local ? `Voice: ${shortVoiceName(local)}` : "No local voice found";
$("#onlineVoice").textContent = online ? `Voice: ${shortVoiceName(online)}` : "Not available on this computer";
for (const button of document.querySelectorAll("[data-preview]")) {
  const voice = button.dataset.preview === "local" ? local : online;
  button.innerHTML = `${icon("play", "sm")}<span>Preview</span>`;
  button.disabled = !voice;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    preview(voice?.voiceName, store.settings, store.player);
  });
}
const onlineRadio = document.querySelector("[name='voiceMode'][value='online']");
onlineRadio.disabled = !online;

function syncChoice() {
  const usingOnline = store.settings.allowNetworkVoices && online && Object.values(store.settings.voices).includes(online.voiceName);
  for (const radio of document.querySelectorAll("[name='voiceMode']")) radio.checked = radio.value === (usingOnline ? "online" : "local");
}
syncChoice();

for (const radio of document.querySelectorAll("[name='voiceMode']")) {
  radio.addEventListener("change", async () => {
    const voicesByLang = { ...store.settings.voices };
    if (radio.value === "online" && online) {
      voicesByLang[online.lang.split("-")[0]] = online.voiceName;
      await send("settings", { voices: voicesByLang, allowNetworkVoices: true });
    } else {
      for (const [key, name] of Object.entries(voicesByLang)) if (voices.find((voice) => voice.voiceName === name)?.remote) delete voicesByLang[key];
      await send("settings", { voices: voicesByLang, allowNetworkVoices: false });
    }
  });
}

const keys = (shortcut) => shortcut.split("+").map((key) => `<kbd>${escape(key)}</kbd>`).join(" ");
const commands = Object.fromEntries((await chrome.commands.getAll()).map((command) => [command.name, command.shortcut]));
if (commands["queue-page"]) $("#addHint").innerHTML = `Press ${keys(commands["queue-page"])} on any article. Select text first to add only that part, or right-click the page.`;
if (commands["toggle-playback"]) $("#playHint").innerHTML = `Press ${keys(commands["toggle-playback"])} to play or pause from any tab. Open the side panel to see your queue and read along.`;

$("#finish").addEventListener("click", async () => {
  await send("settings", { onboarded: true });
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) chrome.tabs.remove(tab.id);
});

connectSpeech((message) => deck.onSpeech(message));
