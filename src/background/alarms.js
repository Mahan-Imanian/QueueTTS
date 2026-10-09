import { ACTIVE_STATUSES } from "../lib/store.js";

export const SLEEP_ALARM = "qtts-sleep";
export const WATCHDOG_ALARM = "qtts-watchdog";
const WATCHDOG_PERIOD_MINUTES = 0.5;

let watchdogOn = null;

export const syncWatchdog = (status) => {
  const wanted = ACTIVE_STATUSES.has(status);
  if (wanted === watchdogOn) return;
  watchdogOn = wanted;
  if (wanted) chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MINUTES });
  else chrome.alarms.clear(WATCHDOG_ALARM);
};

export const stopWatchdog = () => {
  watchdogOn = false;
  return chrome.alarms.clear(WATCHDOG_ALARM);
};
