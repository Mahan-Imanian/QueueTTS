# Changelog

## Unreleased

### Fixed
- Sentence splitting no longer merges two sentences after "etc.", "Inc.", "Jr.", "a.m." or "p.m.", or after the word "no" ("He said no. Then…"). "No." still joins a following number.
- URLs keep the punctuation that follows them when reduced to the host name, so "see https://example.com/a, then…" is read as "see example.com, then…".
- Very long text without spaces (Chinese, Japanese) is split at CJK clause marks, and no longer produces a sentence that is only a closing punctuation mark.
- Import checks the file's schema and rejects files from newer versions with a message, normalises malformed article blocks instead of storing them, skips items without readable text, and counts URL duplicates correctly in the confirmation.
- Import accepts backup files exported by version 2.
- Imports are sent to the service worker in batches of 50 items instead of one message holding the whole file.
- Migrating 2.x data no longer drops items with numeric ids or lets two items with the same id share one article's text.
- If Readability throws on a page, extraction falls back to the visible-DOM extractor instead of failing.
- The sample article named Alt+Shift+A as the add shortcut; the default is Alt+Shift+S.
- The browser-restart end-to-end test removes its temporary Chrome profile and extension copy.

### Changed
- `src/background/index.js` was split into `state`, `playback`, `speech`, `capture`, `audio`, `alarms` and `trace` modules. The service worker is still the only writer and all changes still run through one task chain.
- Shared UI helpers replace duplicated code for the storage warning, word highlighting, reading-plan cache keys and voice previews. Removed the unused `statusText`, `previousDone` and the offscreen page's `cool` action.
- Tuning values in the service worker and UI are named constants, and their rationale is in `docs/architecture.md`.
- `docs/performance.md` separates the reproducible queue benchmark from hand measurements, which are now dated.

## 3.1.0

### Listening workspace
- The side panel is now one continuous workspace instead of three tabs:
  - a deck for the current article;
  - the numbered *Up next* queue on a rail;
  - *Listened* items grouped by day;
  - *Read along* in place of the lists.
- The deck shows the source and author, a reading window (the previous sentence faded, the current one with a moving word underline), a position bar marked with the article's real section headings, elapsed and remaining time, transport, speed and voice.
- Click the position bar to jump. <kbd>PgUp</kbd> and <kbd>PgDn</kbd> on it move between sections.
- Speed and voice are popovers on the deck, with presets and per-voice previews.
- The popup uses the same deck and rows. It shows the page you're on with *Add* and *Listen now*, and the next two items.
- New empty state with a playable sample, and a preview of where the queue will appear.
- Recently added items say so in plain text instead of an accent-coloured dot.

### Speech start
- Every start is instrumented from the click to the first spoken word. *Settings → About* shows the latest measurement.
- Opening the popup or side panel silently warms the speech engine. In hand measurements on the author's Windows 11 machine with Chrome 142, the first word arrived after about 210 ms instead of about 480 ms with a local voice, and speech started after about 400 ms instead of about 720 ms with Google's online voice.
- An offscreen document keeps the audio output awake while you listen, so wireless and Bluetooth headsets don't drop the first words when they wake.
- *Playing* now appears when the engine reports the first spoken word, not when it accepts the request.

### Voices
- Voices are labelled as standard, enhanced or online, with where the text goes.
- A preferred voice is remembered for each language. Missing voices fall back automatically.
- The first-run page offers a choice between a local voice and Google's online voice, with previews.

### Speech pipeline
- ISO dates are read as dates, number ranges as "20 to 60", and "vs.", "approx." and "w/" are expanded.
- Emoji and decorative symbols are dropped.
- Headings and list items end with sentence intonation.
- "km/h" and similar are no longer rewritten.

### Also
- About section in Settings with version, diagnostics, source link and credits.
- New README, screenshots and social preview image.
- 17 new tests: startup and first-word regressions, voice ranking, speech rules, and the deck and popovers.

## 3.0.0

Rebuilt the extension around the queue and a player whose state survives worker and browser restarts.

### Playback
- One playback controller in the service worker owns all playback state. Captures never touch it, so adding something while you listen no longer stops the current article or marks the new one as finished.
- Pausing stops speech and saves the sentence. Resuming re-speaks from there, so it works no matter how long you were away, including across a Chrome restart.
- After a browser restart, playback shows as paused rather than playing, and the first press plays.
- If Chrome suspends the extension mid-sentence, a watchdog resumes from the saved sentence.
- Listening time is measured from actual speech and recorded under your local date.
- Speech errors fall back to the automatic voice once, then show a message with Try again.

### Reading
- Pages are captured as headings, paragraphs, lists, quotes and code instead of flat text, using Mozilla Readability plus dedicated handling for Wikipedia, GitHub and MDN.
- Never says "Heading". Headings get a pause instead, with an optional "Section" announcement.
- Citation markers, URLs, hidden text, captions, cookie banners, newsletter boxes, comments and reference sections are left out. Code is skipped by default.
- Sentence splitting understands abbreviations and initials ("Dr.", "U.C.L.A.", "J. R. R."). Very long sentences are split at natural pauses.
- Pages with no article text, and pages that are lists of links, are declined with a message instead of being queued.

### Queue
- New items go to the end. The item you play moves to the front. Finished items go to History.
- Reorder by dragging or with Alt+↑/↓. Play next, mark as listened or not, remove with undo, search, clear history.
- Adding the same page twice doesn't duplicate it.

### Interface
- New popup, side panel, settings page and welcome page, with a new design system, icon, light and dark themes, and a Reading view that highlights the sentence being read.
- Global shortcuts: Alt+Shift+S adds a page, Alt+Shift+L plays or pauses.
- Keyboard focus is never moved by playback updates. Lists use one tab stop with arrow-key navigation. Dialogs use the native `<dialog>` element. An end-to-end test checks the popup, side panel, settings and welcome pages for serious or critical axe violations in both themes.

### Storage
- The queue index, each item's text and the playback position are stored separately, so a sentence change writes a few hundred bytes instead of the whole library.
- `unlimitedStorage` removes the 10 MB ceiling. Failed writes are reported instead of lost.
- Existing 2.x queues and settings are migrated automatically.

### Removed
- Command palettes, focus mode, duplicate item, summary tiles, the trust panel, the settings status strip, the permission table, the ±15/30-second seek buttons, the raw dictionary editor, the language hint and the reduce-motion switch (the system setting is respected instead).

## 2.4.0

- Settings page reorganised into sections. Pronunciation rules became an editable list.

## 2.3.0

- Popup rebuilt as a fixed-width remote. Queue rows show their source.

## 2.2.0

- First Chrome extension release, replacing the earlier web app.
