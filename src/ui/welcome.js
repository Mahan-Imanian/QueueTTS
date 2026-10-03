import { $, applyTheme, connectSpeech, createStore, escape, icon, send } from "./common.js";
import { mountPlayer } from "./player.js";

const player = mountPlayer($("#player"));
let store = await createStore((changed, snapshot) => {
  store = snapshot;
  applyTheme(store.settings);
  player.update(store, changed);
});
applyTheme(store.settings);
player.update(store);

const demo = $("#demo");
demo.innerHTML = `${icon("play", "sm")}<span>Hear how it works</span>`;
demo.addEventListener("click", async () => {
  demo.disabled = true;
  const result = await send("addSample");
  demo.hidden = result.ok;
  demo.disabled = false;
  $("#player").hidden = false;
});

const keys = (shortcut) => shortcut.split("+").map((key) => `<kbd>${escape(key)}</kbd>`).join(" ");
const commands = Object.fromEntries((await chrome.commands.getAll()).map((command) => [command.name, command.shortcut]));
if (commands["queue-page"]) $("#addHint").innerHTML = `Press ${keys(commands["queue-page"])} on any article. Select text first to add just that part, or right-click the page.`;
if (commands["toggle-playback"]) $("#playHint").innerHTML = `Press ${keys(commands["toggle-playback"])} to play or pause from any tab. Open the side panel to see the queue and follow along.`;

$("#finish").addEventListener("click", async () => {
  await send("settings", { onboarded: true });
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) chrome.tabs.remove(tab.id);
});

connectSpeech((message) => player.onSpeech(message));
