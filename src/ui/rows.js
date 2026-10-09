import { DAY_MS, favicon, formatDuration, h, icon, isActive, itemRemaining, sourceLabel } from "./common.js";

const FRESH_MS = 15 * 60 * 1000;

export const createRow = () => {
  const row = h("li", { class: "row" });
  row.innerHTML = `<span class="row-mark" aria-hidden="true"><span class="num"></span><span class="grip">${icon("grip", "sm")}</span></span><button class="row-main" type="button" tabindex="-1"><span class="row-fav"></span><span class="row-title"></span><span class="row-meta"></span><span class="row-bar" hidden><span></span></span></button><span class="row-side"><span class="row-time"></span><span class="row-tools"><button class="icon-btn" type="button" data-act="play" tabindex="-1"></button><button class="icon-btn" type="button" data-act="menu" tabindex="-1" aria-label="More actions" title="More actions">${icon("more", "sm")}</button></span></span>`;
  return row;
};

const dayLabel = (time) => {
  const date = new Date(time);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(date.toDateString())) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
};

export const historyDay = (item) => dayLabel(item.finishedAt || item.addedAt);

export const updateRow = (row, item, { kind = "next", index = 0, store, draggable = false }) => {
  const { player, settings } = store;
  const current = item.id === player.itemId;
  const playing = current && isActive(player);
  const done = kind === "done";
  const progress = current ? player.progress || item.progress : item.progress;
  const fresh = !done && !current && progress === 0 && Date.now() - item.addedAt < FRESH_MS;
  row.classList.toggle("done", done);
  row.classList.toggle("current", current && !done);
  row.classList.toggle("fresh", fresh);
  row.draggable = draggable;
  const num = row.querySelector(".num");
  if (done) num.innerHTML = icon("check", "sm");
  else num.textContent = String(index);
  if (row.dataset.title !== item.title) {
    row.dataset.title = item.title;
    row.querySelector(".row-fav").replaceChildren(favicon(item));
    row.querySelector(".row-title").textContent = item.title;
  }
  const left = itemRemaining(item, settings, progress);
  const time = done
    ? new Date(item.finishedAt || item.addedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : progress > 0 ? `${formatDuration(left)} left` : formatDuration(left);
  const source = [sourceLabel(item), item.author].filter(Boolean).join(" · ");
  const minutesAgo = Math.max(0, Math.round((Date.now() - item.addedAt) / 60000));
  const added = fresh ? ` · added ${minutesAgo < 1 ? "just now" : `${minutesAgo} min ago`}` : "";
  row.querySelector(".row-meta").textContent = done ? `${source} · ${formatDuration(itemRemaining(item, settings, 0))}` : `${source}${added}`;
  row.querySelector(".row-time").textContent = time;
  const bar = row.querySelector(".row-bar");
  bar.hidden = done || progress <= 0;
  bar.firstElementChild.style.setProperty("--p", progress.toFixed(3));
  const main = row.querySelector(".row-main");
  const label = done
    ? `${item.title}. ${source}. Listened ${historyDay(item)} at ${time}.`
    : `${index}. ${item.title}. ${source}. ${time}.${fresh ? " Added recently." : ""}`;
  main.setAttribute("aria-label", label);
  const play = row.querySelector("[data-act='play']");
  const playLabel = playing ? "Pause" : done ? "Play again" : progress > 0 ? "Resume" : "Play now";
  if (play.getAttribute("aria-label") !== playLabel) {
    play.setAttribute("aria-label", playLabel);
    play.title = playLabel;
    play.innerHTML = icon(playing ? "pause" : done ? "undo" : "play", "sm");
  }
};
