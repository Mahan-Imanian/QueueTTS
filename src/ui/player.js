import { findItem } from "../lib/queue.js";
import { readDoc } from "../lib/store.js";
import { buildPlan, formatDuration, unitIndex, wordIndexAt } from "../lib/text.js";
import { $, favicon, h, icon, isActive, itemRemaining, renderSentence, send, sourceLabel, speedLabel, statusText, stepRate, toast } from "./common.js";

const planCache = { key: "", plan: null, doc: null };

export const planFor = async (item, settings) => {
  const key = `${item.id}|${settings.readCode}|${settings.announceHeadings}`;
  if (planCache.key === key) return planCache;
  const doc = await readDoc(item.id);
  planCache.key = key;
  planCache.doc = doc;
  planCache.plan = doc ? buildPlan(doc, { lang: item.lang || "en", readCode: settings.readCode, announceHeadings: settings.announceHeadings }) : null;
  return planCache;
};

export const mountPlayer = (root, { full = false } = {}) => {
  root.innerHTML = `
    <div class="banner" data-role="error" hidden>${icon("alert", "sm")}<p></p><button class="btn" type="button" data-act="retry">Try again</button><button class="icon-btn" type="button" data-act="dismiss" aria-label="Dismiss">${icon("close", "sm")}</button></div>
    <div class="np-head">
      <span class="np-fav"></span>
      <div class="np-titles">
        <h2 class="np-title"></h2>
        <p class="meta np-meta"><span class="status"><span class="wave still" aria-hidden="true"><i></i><i></i><i></i></span><span data-role="status"></span></span><span data-role="site"></span><span data-role="left"></span></p>
      </div>
    </div>
    <div class="progress" role="progressbar" aria-label="Progress through this item" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <p class="sentence np-sentence"></p>
    <div class="np-controls">
      <div class="np-transport">
        <button class="icon-btn" type="button" data-act="back" aria-label="Back one sentence" title="Back one sentence (←)">${icon("back", "lg")}</button>
        <button class="play-btn" type="button" data-act="toggle" aria-label="Play">${icon("play")}</button>
        <button class="icon-btn" type="button" data-act="forward" aria-label="Forward one sentence" title="Forward one sentence (→)">${icon("forward", "lg")}</button>
        ${full ? `<button class="icon-btn" type="button" data-act="skipItem" aria-label="Skip to next item" title="Skip to next item (N)">${icon("next")}</button>` : ""}
      </div>
      <div class="np-tools">
        ${full ? `<button class="icon-btn" type="button" data-act="sleep" aria-label="Sleep timer" title="Sleep timer">${icon("moon")}</button>` : ""}
        <div class="speed" role="group" aria-label="Reading speed">
          <button type="button" data-act="slower" aria-label="Slower">−</button>
          <output data-role="speed" aria-live="polite"></output>
          <button type="button" data-act="faster" aria-label="Faster">+</button>
        </div>
      </div>
    </div>`;

  const els = {
    error: $("[data-role='error']", root),
    fav: $(".np-fav", root),
    title: $(".np-title", root),
    wave: $(".wave", root),
    status: $("[data-role='status']", root),
    site: $("[data-role='site']", root),
    left: $("[data-role='left']", root),
    progress: $(".progress", root),
    sentence: $(".np-sentence", root),
    toggle: $("[data-act='toggle']", root),
    speed: $("[data-role='speed']", root),
    sleep: $("[data-act='sleep']", root)
  };
  let snapshot = null;
  let currentId = "";
  let currentText = "";
  let currentPos = null;
  let rateTimer = 0;
  let pendingRate = null;

  const act = {
    toggle: () => send("toggle"),
    back: () => send("skip", -1),
    forward: () => send("skip", 1),
    skipItem: async () => {
      const result = await send("skipItem");
      if (!result.ok && result.message) toast(result.message);
    },
    slower: () => changeRate(-0.1),
    faster: () => changeRate(0.1),
    retry: () => send("play"),
    dismiss: () => send("dismissError"),
    sleep: () => sleepMenu()
  };

  const changeRate = (delta) => {
    pendingRate = stepRate(pendingRate ?? snapshot.settings.rate, delta);
    els.speed.textContent = speedLabel(pendingRate);
    clearTimeout(rateTimer);
    rateTimer = setTimeout(async () => {
      const rate = pendingRate;
      pendingRate = null;
      await send("settings", { rate });
    }, 350);
  };

  const sleepMenu = async () => {
    const { openMenu } = await import("./common.js");
    const set = (value, label) => ({ icon: "moon", label, run: async () => { await send("sleep", value); toast(value ? `Sleep timer: ${label.toLowerCase()}` : "Sleep timer off"); } });
    openMenu(els.sleep, [set(15, "15 minutes"), set(30, "30 minutes"), set(60, "1 hour"), set("end", "End of this item"), "-", set(0, "Off")]);
  };

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (button && act[button.dataset.act]) act[button.dataset.act]();
  });

  const showSentence = async (item, pos, wordIndex = -1) => {
    const { plan } = await planFor(item, snapshot.settings);
    if (!plan || item.id !== currentId) return;
    const unit = plan.units[unitIndex(plan, pos)];
    currentText = unit?.text || item.excerpt || "";
    currentPos = unit ? { b: unit.b, s: unit.s } : null;
    renderSentence(els.sentence, currentText, wordIndex);
  };

  const update = (next, changed = new Set(["player", "queue", "settings"])) => {
    snapshot = next;
    const { player, settings, queue } = next;
    const item = player.itemId ? findItem(queue, player.itemId) : null;
    root.hidden = !item && player.status !== "error";
    els.error.hidden = player.status !== "error";
    if (player.status === "error") $("p", els.error).textContent = player.error || "Playback failed.";
    if (!item) return;
    const active = isActive(player);
    const progress = player.progress || item.progress || 0;
    if (item.id !== currentId) {
      currentId = item.id;
      els.fav.replaceChildren(favicon(item));
      els.title.textContent = item.title;
      els.title.title = item.title;
      currentText = "";
    }
    els.site.textContent = sourceLabel(item);
    els.status.textContent = statusText(player);
    els.wave.classList.toggle("still", player.status !== "playing");
    const left = itemRemaining(item, settings, progress);
    els.left.textContent = progress > 0 ? `${formatDuration(left)} left` : formatDuration(left);
    els.progress.style.setProperty("--p", progress.toFixed(4));
    els.progress.firstElementChild.style.setProperty("--p", progress.toFixed(4));
    els.progress.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    els.progress.setAttribute("aria-valuetext", `${Math.round(progress * 100)} percent, ${formatDuration(left)} left`);
    const label = active ? "Pause" : progress > 0 ? "Resume" : "Play";
    if (els.toggle.getAttribute("aria-label") !== label) {
      els.toggle.setAttribute("aria-label", label);
      els.toggle.title = `${label} (Space)`;
      els.toggle.innerHTML = icon(active ? "pause" : "play");
    }
    els.toggle.dataset.busy = String(player.status === "preparing" || player.status === "recovering");
    if (pendingRate == null) els.speed.textContent = speedLabel(settings.rate);
    if (els.sleep) {
      els.sleep.classList.toggle("on", Boolean(player.sleepAt));
      els.sleep.setAttribute("aria-label", player.sleepAt ? "Sleep timer on" : "Sleep timer");
    }
    const pos = player.pos;
    if (!currentText || changed.has("settings") || !currentPos || !pos || pos.b !== currentPos.b || pos.s !== currentPos.s) showSentence(item, pos);
  };

  const onSpeech = (message) => {
    if (!snapshot || message.id !== currentId) return;
    if (message.t === "unit") {
      const item = findItem(snapshot.queue, message.id);
      if (item) showSentence(item, { b: message.b, s: message.s });
      return;
    }
    if (message.t === "word" && currentPos && message.b === currentPos.b && message.s === currentPos.s) {
      const spokenIndex = wordIndexAt(message.spoken, message.c);
      const spokenWords = (message.spoken.match(/\S+/g) || []).length;
      const displayWords = (currentText.match(/\S+/g) || []).length;
      const index = spokenWords === displayWords ? spokenIndex : Math.round((spokenIndex / Math.max(1, spokenWords)) * displayWords);
      renderSentence(els.sentence, currentText, Math.min(displayWords - 1, index));
    }
  };

  return { update, onSpeech, changeRate };
};
