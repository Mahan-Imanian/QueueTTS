import { findItem, queuedItems } from "../lib/queue.js";
import { readDoc } from "../lib/store.js";
import { CPS_DEFAULT, formatClock, formatDuration, planForItem, planKey, unitIndex } from "../lib/text.js";
import { baseLang, describeVoice, rankVoices, shortVoiceName } from "../lib/voices.js";
import { $, displayWordIndex, escape, favicon, h, icon, isActive, openMenu, renderSentence, send, sourceLabel, speedLabel, stepRate, toast } from "./common.js";

const planCache = { key: "", plan: null, doc: null };

export const planFor = async (item, settings) => {
  const key = planKey(item, settings);
  if (planCache.key === key) return planCache;
  const doc = await readDoc(item.id);
  planCache.key = key;
  planCache.doc = doc;
  planCache.plan = doc ? planForItem(doc, item, settings) : null;
  return planCache;
};

const STATUS = {
  playing: "Reading aloud",
  preparing: "Starting…",
  recovering: "Resuming where you left off…",
  stopped: "Stopped",
  completed: "Finished",
  error: "Couldn’t play",
  idle: "Ready"
};

const statusFor =(player, progress) => (player.status === "paused" ? (progress > 0 ? "Paused" : "Ready to play") : STATUS[player.status] || "Ready");

const PRESETS = [0.8, 1, 1.25, 1.5, 2];
const RATE_STEP = 0.1;
const RATE_SAVE_DELAY_MS = 300;
const SAMPLE = "Here’s how this voice sounds. On 4 October 2026, the queue had 12 articles: about 40 minutes of listening.";

let voiceCache = null;
const loadVoices = async (force = false) => {
  if (!voiceCache || force) voiceCache = (await send("voices")).voices || [];
  return voiceCache;
};

export const preview = async (voiceName, settings, player, text = SAMPLE) => {
  if (isActive(player)) await send("pause");
  chrome.tts.stop();
  const options = { rate: settings.rate, pitch: settings.pitch, volume: settings.volume || 1 };
  if (voiceName) options.voiceName = voiceName;
  chrome.tts.speak(text, options);
};

export const mountDeck = (root, { compact = false, onReadAlong = null } = {}) => {
  root.innerHTML = `
    <div class="banner" data-role="error" hidden>${icon("alert", "sm")}<p></p><button class="btn" type="button" data-act="retry">Try again</button><button class="icon-btn" type="button" data-act="dismiss" aria-label="Dismiss">${icon("close", "sm")}</button></div>
    <div class="deck-source"><span data-role="fav"></span><span class="deck-site"></span><span class="deck-position" data-role="position"></span></div>
    <h2 class="deck-title"></h2>
    <div class="deck-read">
      ${compact ? "" : `<p class="deck-prev" aria-hidden="true"></p>`}
      <p class="deck-now"></p>
    </div>
    <div class="ruler">
      <div class="ruler-track" role="slider" tabindex="0" aria-label="Position in this article" aria-valuemin="0" aria-valuemax="100"><div class="ruler-fill"></div><div class="ruler-head"></div></div>
      <div class="ruler-times"><span data-role="elapsed">0:00</span><span data-role="remaining"></span></div>
    </div>
    <div class="deck-controls">
      <div class="transport">
        <button class="icon-btn" type="button" data-act="back" aria-label="Back one sentence" title="Back one sentence (←)">${icon("back", "lg")}</button>
        <button class="play" type="button" data-act="toggle" aria-label="Play">${icon("play")}</button>
        <button class="icon-btn" type="button" data-act="forward" aria-label="Forward one sentence" title="Forward one sentence (→)">${icon("forward", "lg")}</button>
        ${compact ? "" : `<button class="icon-btn" type="button" data-act="skipItem" aria-label="Skip to the next item" title="Next item (N)">${icon("next")}</button>`}
      </div>
      <div class="chips">
        <button class="chip" type="button" data-act="speed" aria-haspopup="dialog" aria-expanded="false" title="Reading speed (− +)"><span data-role="speed">1.0×</span></button>
        <button class="chip" type="button" data-act="voice" aria-haspopup="dialog" aria-expanded="false" title="Voice"><span data-role="voiceIcon">${icon("device")}</span><span class="chip-text" data-role="voice">Voice</span></button>
      </div>
    </div>
    ${compact ? "" : `<div class="deck-foot">
      <span class="deck-status"><span class="signal" aria-hidden="true"><i></i><i></i><i></i></span><span data-role="status"></span></span>
      <span class="spacer"></span>
      <button class="icon-btn" type="button" data-act="sleep" aria-label="Sleep timer" title="Sleep timer">${icon("moon", "sm")}</button>
      <button class="btn btn-quiet" type="button" data-act="read" aria-pressed="false">${icon("reader", "sm")}<span>Read along</span></button>
    </div>`}
    <div class="popover speed-pop" popover="auto" data-role="speedPop" role="dialog" aria-label="Reading speed">
      <div class="speed-row"><button class="icon-btn" type="button" data-act="slower" aria-label="Slower">−</button><output data-role="speedBig">1.0×</output><button class="icon-btn" type="button" data-act="faster" aria-label="Faster">+</button></div>
      <div class="presets">${PRESETS.map((rate) => `<button type="button" data-rate="${rate}" aria-pressed="false">${speedLabel(rate)}</button>`).join("")}</div>
    </div>
    <div class="popover voice-pop" popover="auto" data-role="voicePop" role="dialog" aria-label="Voice"></div>`;

  const els = {
    error: $("[data-role='error']", root),
    fav: $("[data-role='fav']", root),
    site: $(".deck-site", root),
    position: $("[data-role='position']", root),
    title: $(".deck-title", root),
    prev: $(".deck-prev", root),
    now: $(".deck-now", root),
    track: $(".ruler-track", root),
    elapsed: $("[data-role='elapsed']", root),
    remaining: $("[data-role='remaining']", root),
    toggle: $("[data-act='toggle']", root),
    speed: $("[data-role='speed']", root),
    speedChip: $("[data-act='speed']", root),
    speedPop: $("[data-role='speedPop']", root),
    speedBig: $("[data-role='speedBig']", root),
    voice: $("[data-role='voice']", root),
    voiceIcon: $("[data-role='voiceIcon']", root),
    voiceChip: $("[data-act='voice']", root),
    voicePop: $("[data-role='voicePop']", root),
    status: $("[data-role='status']", root),
    sleep: $("[data-act='sleep']", root),
    read: $("[data-act='read']", root)
  };

  let snapshot = null;
  let currentId = "";
  let current = { text: "", pos: null, index: -1, plan: null };
  let ticksKey = "";
  let pendingRate = null;
  let rateTimer = 0;
  let voiceKey = "";
  let readAlong = false;

  const commitRate = (rate) => {
    pendingRate = rate;
    els.speed.textContent = speedLabel(rate);
    els.speedBig.textContent = speedLabel(rate);
    for (const button of els.speedPop.querySelectorAll("[data-rate]")) button.setAttribute("aria-pressed", String(Math.abs(Number(button.dataset.rate) - rate) < 0.01));
    clearTimeout(rateTimer);
    rateTimer = setTimeout(async () => {
      const value = pendingRate;
      pendingRate = null;
      await send("settings", { rate: value });
    }, RATE_SAVE_DELAY_MS);
  };

  const changeRate = (delta) => commitRate(stepRate(pendingRate ?? snapshot.settings.rate, delta));

  const place = (popover, anchor) => {
    const rect = anchor.getBoundingClientRect();
    popover.style.visibility = "hidden";
    popover.showPopover();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    const below = rect.bottom + 6 + height <= window.innerHeight - 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - height - 6)}px`;
    popover.style.visibility = "";
    anchor.setAttribute("aria-expanded", "true");
    popover.addEventListener("toggle", (event) => {
      if (event.newState === "closed") anchor.setAttribute("aria-expanded", "false");
    }, { once: true });
  };

  const renderVoicePop = async () => {
    const item = findItem(snapshot.queue, snapshot.player.itemId);
    const lang = item?.lang || "en";
    const base = baseLang(lang);
    const all = await loadVoices();
    const settings = snapshot.settings;
    const chosen = settings.voices[base] || "";
    const matching = rankVoices(all, { lang, allowNetwork: true }).filter((voice) => baseLang(voice.lang) === base);
    const local = matching.filter((voice) => !voice.remote);
    const online = matching.filter((voice) => voice.remote);
    const option = (voice) => {
      const info = describeVoice(voice);
      return `<div class="voice-option" role="menuitemradio" tabindex="0" aria-checked="${voice.voiceName === chosen}" data-voice="${escape(voice.voiceName)}">
        ${icon("check", "sm").replace('class="i sm"', 'class="i sm check"')}
        <span><span class="voice-name">${escape(info.label)}</span><span class="voice-meta">${escape(info.language)} · ${info.remote ? `<span class="online">${icon("globe", "sm").replace('class="i sm"', 'class="i sm" style="width:11px;height:11px;vertical-align:-1px"')} Online, text goes to Google</span>` : `${info.tierLabel}, on this computer`}${info.highlights ? "" : " · no word highlight"}</span></span>
        <button class="icon-btn" type="button" data-preview="${escape(voice.voiceName)}" aria-label="Preview ${escape(info.label)}" title="Preview">${icon("play", "sm")}</button>
      </div>`;
    };
    els.voicePop.innerHTML = `
      <div class="voice-option" role="menuitemradio" tabindex="0" aria-checked="${!chosen}" data-voice="">${icon("check", "sm").replace('class="i sm"', 'class="i sm check"')}<span><span class="voice-name">Automatic</span><span class="voice-meta">Best voice on this computer${settings.allowNetworkVoices ? ", or online when allowed" : ""}</span></span><span></span></div>
      ${local.length ? `<h3>On this computer · private, works offline</h3>${local.map(option).join("")}` : `<p class="voice-note">No ${escape(base.toUpperCase())} voices are installed on this computer.</p>`}
      ${online.length ? `<h3>Online · clearer, but the text is sent to Google</h3>${online.map(option).join("")}` : ""}
      <p class="voice-note">Chrome provides these voices. Local Windows voices sound mechanical; macOS “Premium” voices and Google’s online voices sound more natural.</p>`;
  };

  const chooseVoice = async (name) => {
    const item = findItem(snapshot.queue, snapshot.player.itemId);
    const base = baseLang(item?.lang || "en");
    const voices = { ...snapshot.settings.voices };
    if (name) voices[base] = name;
    else delete voices[base];
    const all = await loadVoices();
    const picked = all.find((voice) => voice.voiceName === name);
    await send("settings", picked?.remote ? { voices, allowNetworkVoices: true } : { voices });
    els.voicePop.hidePopover();
    toast(picked ? `Voice: ${shortVoiceName(picked)}${picked.remote ? " (online)" : ""}` : "Voice: automatic");
  };

  els.voicePop.addEventListener("click", (event) => {
    const previewButton = event.target.closest("[data-preview]");
    if (previewButton) {
      event.stopPropagation();
      return preview(previewButton.dataset.preview, snapshot.settings, snapshot.player);
    }
    const option = event.target.closest("[data-voice]");
    if (option) chooseVoice(option.dataset.voice);
  });
  els.voicePop.addEventListener("keydown", (event) => {
    const options = Array.from(els.voicePop.querySelectorAll(".voice-option"));
    const index = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && index >= 0) {
      event.preventDefault();
      chooseVoice(options[index].dataset.voice);
    }
  });
  els.speedPop.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-rate]");
    if (preset) commitRate(Number(preset.dataset.rate));
  });

  const act = {
    toggle: () => send("toggle"),
    back: () => send("skip", -1),
    forward: () => send("skip", 1),
    skipItem: async () => {
      const result = await send("skipItem");
      if (!result.ok && result.message) toast(result.message);
    },
    slower: () => changeRate(-RATE_STEP),
    faster: () => changeRate(RATE_STEP),
    retry: () => send("play"),
    dismiss: () => send("dismissError"),
    speed: () => {
      commitRate(pendingRate ?? snapshot.settings.rate);
      clearTimeout(rateTimer);
      pendingRate = null;
      place(els.speedPop, els.speedChip);
      els.speedPop.querySelector("[aria-pressed='true'], [data-rate]")?.focus();
    },
    voice: async () => {
      await renderVoicePop();
      place(els.voicePop, els.voiceChip);
      (els.voicePop.querySelector("[aria-checked='true']") || els.voicePop.querySelector(".voice-option"))?.focus();
    },
    sleep: () => {
      const set =(value, label) => ({ icon: "moon", label, run: async () => {
        await send("sleep", value);
        toast(value ? `Sleep timer: ${label.toLowerCase()}` : "Sleep timer off");
      } });
      openMenu(els.sleep, [set(15, "15 minutes"), set(30, "30 minutes"), set(60, "1 hour"), set("end", "End of this item"), "-", set(0, "Off")]);
    },
    read: () => {
      readAlong = !readAlong;
      els.read?.setAttribute("aria-pressed", String(readAlong));
      onReadAlong?.(readAlong);
    }
  };

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (button && act[button.dataset.act]) act[button.dataset.act]();
  });

  const seekFraction = (fraction) => {
    const plan = current.plan;
    if (!plan?.units.length) return;
    const target = fraction * plan.chars;
    let index = plan.units.findIndex((unit) => unit.start > target) - 1;
    if (index < 0) index = target <= 0 ? 0 : plan.units.length - 1;
    const unit = plan.units[index];
    send("seek", currentId, unit.b, unit.s);
  };

  const seekSection = (direction) => {
    const plan = current.plan;
    if (!plan) return;
    const sections = plan.units.map((unit, index) => (unit.heading || index === 0 ? index : -1)).filter((index) => index >= 0);
    const at = current.index;
    const target = direction > 0 ? sections.find((index) => index > at) : [...sections].reverse().find((index) => index < at - 1) ?? 0;
    if (target == null) return;
    const unit = plan.units[target];
    send("seek", currentId, unit.b, unit.s);
  };

  els.track.addEventListener("click", (event) => {
    const rect = els.track.getBoundingClientRect();
    seekFraction(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  });
  els.track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") send("skip", 1);
    else if (event.key === "ArrowLeft") send("skip", -1);
    else if (event.key === "PageDown") seekSection(1);
    else if (event.key === "PageUp") seekSection(-1);
    else if (event.key === "Home") seekFraction(0);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });

  const drawTicks = (plan) => {
    const key = `${currentId}|${plan?.units.length}`;
    if (key === ticksKey || !plan) return;
    ticksKey = key;
    els.track.querySelectorAll(".ruler-tick").forEach((tick) => tick.remove());
    for (const unit of plan.units) {
      if (!unit.heading || !plan.chars) continue;
      const tick = h("span", { class: "ruler-tick", "aria-hidden": "true" });
      tick.style.left = `${(unit.start / plan.chars) * 100}%`;
      tick.dataset.at = String(unit.start / plan.chars);
      els.track.insertBefore(tick, els.track.lastElementChild);
    }
  };

  const showSentence = async (item, pos, wordIndex = -1) => {
    const { plan } = await planFor(item, snapshot.settings);
    if (!plan || item.id !== currentId) return;
    current.plan = plan;
    drawTicks(plan);
    const index = unitIndex(plan, pos);
    const unit = plan.units[index];
    const advanced = index === current.index + 1;
    const changed = index !== current.index;
    current.index = index;
    current.text = unit?.text || item.excerpt || "";
    current.pos = unit ? { b: unit.b, s: unit.s } : null;
    renderSentence(els.now, current.text, wordIndex);
    if (els.prev) els.prev.textContent = index > 0 ? plan.units[index - 1].text : "";
    if (changed && advanced) {
      for (const node of [els.now, els.prev]) {
        if (!node) continue;
        node.classList.remove("advance");
        void node.offsetWidth;
        node.classList.add("advance");
      }
    }
  };

  const updateVoice = async (item) => {
    const key = `${item.lang}|${JSON.stringify(snapshot.settings.voices)}|${snapshot.settings.allowNetworkVoices}`;
    if (key === voiceKey) return;
    voiceKey = key;
    const result = await send("resolvedVoice", item.lang || "en");
    const voice = result.voice;
    els.voice.textContent = voice ? shortVoiceName(voice) : "Default voice";
    els.voiceIcon.innerHTML = icon(voice?.remote ? "globe" : "device");
    els.voiceChip.title = voice ? `${voice.voiceName}: ${describeVoice(voice).where}` : "Voice";
    els.voiceChip.setAttribute("aria-label", `Voice: ${voice ? `${shortVoiceName(voice)}, ${voice.remote ? "online" : "on this computer"}` : "default"}`);
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
    root.dataset.state = player.status;
    if (item.id !== currentId) {
      currentId = item.id;
      current = { text: "", pos: null, index: -1, plan: null };
      ticksKey = "";
      els.fav.replaceChildren(favicon(item));
      els.title.textContent = item.title;
      els.title.title = item.title;
    }
    const site = [sourceLabel(item), item.author].filter(Boolean).join(" · ");
    els.site.textContent = site;
    const queued = queuedItems(queue);
    const position = queued.findIndex((entry) => entry.id === item.id);
    if (compact) els.position.innerHTML = `<span class="signal" aria-hidden="true" style="vertical-align:-1px"><i></i><i></i><i></i></span> ${escape(statusFor(player, player.progress || item.progress))}`;
    else els.position.textContent = queued.length > 1 && position >= 0 ? `${position + 1} of ${queued.length}` : "";
    const progress = player.progress || item.progress || 0;
    const total = item.chars / ((settings.cps || CPS_DEFAULT) * settings.rate);
    els.elapsed.textContent = formatClock(total * progress);
    els.remaining.textContent = `−${formatClock(total * (1 - progress))}`;
    els.track.style.setProperty("--p", progress.toFixed(4));
    els.track.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
    els.track.setAttribute("aria-valuetext", `${formatClock(total * progress)} of ${formatClock(total)}, ${formatDuration(total * (1 - progress))} left`);
    for (const tick of els.track.querySelectorAll(".ruler-tick")) tick.classList.toggle("read", Number(tick.dataset.at) <= progress);
    const label = active ? "Pause" : progress > 0 ? "Resume" : "Play";
    if (els.toggle.getAttribute("aria-label") !== label) {
      els.toggle.setAttribute("aria-label", label);
      els.toggle.title = `${label} (Space)`;
      els.toggle.innerHTML = icon(active ? "pause" : "play");
    }
    els.toggle.dataset.busy = String(player.status === "preparing" || player.status === "recovering");
    if (pendingRate == null) {
      els.speed.textContent = speedLabel(settings.rate);
      els.speedBig.textContent = speedLabel(settings.rate);
    }
    if (els.status) els.status.textContent = player.sleepAt ? `${statusFor(player, progress)} · ${player.sleepAt === -1 ? "stops after this item" : `stops in ${formatDuration((player.sleepAt - Date.now()) / 1000)}`}` : statusFor(player, progress);
    if (els.sleep) {
      els.sleep.classList.toggle("on", Boolean(player.sleepAt));
      els.sleep.setAttribute("aria-label", player.sleepAt ? "Sleep timer on" : "Sleep timer");
    }
    updateVoice(item);
    const pos = player.pos;
    if (!current.text || changed.has("settings") || !current.pos || !pos || pos.b !== current.pos.b || pos.s !== current.pos.s) showSentence(item, pos);
  };

  const onSpeech = (message) => {
    if (!snapshot || message.id !== currentId) return;
    if (message.t === "unit") {
      const item = findItem(snapshot.queue, message.id);
      if (item) showSentence(item, { b: message.b, s: message.s });
      return;
    }
    if (message.t === "word" && current.pos && message.b === current.pos.b && message.s === current.pos.s) {
      renderSentence(els.now, current.text, displayWordIndex(message.spoken, message.c, current.text));
    }
  };

  const setReadAlong = (value) => {
    readAlong = value;
    els.read?.setAttribute("aria-pressed", String(value));
  };

  return { update, onSpeech, slower: () => changeRate(-RATE_STEP), faster: () => changeRate(RATE_STEP), setReadAlong, refreshVoices: () => loadVoices(true) };
};
