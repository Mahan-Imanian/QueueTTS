# Changelog

## 3.0.0

A rebuild around one job: a queue of articles that plays reliably, in order, and remembers where you were.

### Playback
- One playback controller in the service worker owns all playback state. Captures never touch it, so adding something while you listen no longer stops the current article or marks the new one as finished.
- Pausing stops speech and saves the sentence. Resuming re-speaks from there, so it works no matter how long you were away, including across a Chrome restart.
- After a browser restart, playback shows as paused rather than playing, and the first press plays.
- If Chrome suspends the extension mid-sentence, a watchdog resumes from the saved sentence.
- Listening time is measured from actual speech and recorded under your local date.
- Speech errors fall back to the automatic voice once, then show a clear message with Try again.

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
- Keyboard focus is never moved by playback updates. Lists use one tab stop with arrow-key navigation. Dialogs use the native `<dialog>` element. Every surface passes axe in both themes.

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
