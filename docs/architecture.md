# Architecture

The diagram is in the [README](../README.md#how-it-works). This page covers the rules behind it.

- **One writer.** The service worker is the only code that changes the queue or playback state. Pages send commands and render from `storage.onChanged`, and the worker serialises every change through one promise chain.
- **Durable playback.** Position is a block and sentence index saved on every sentence start. Pausing stops speech and saves the position. Resuming speaks that sentence again rather than relying on `tts.resume()`, so it works whether the worker has been suspended for seconds or days.
- **Recovering from the browser lifecycle.** At startup the worker checks a flag in `chrome.storage.session`, which survives worker restarts but not browser restarts. After a browser restart, "playing" becomes "paused". After a worker restart mid-sentence, it resumes. A watchdog alarm runs only while playing.
- **Honest state.** The UI says *Playing* only after the engine reports the first spoken word, or its start event for voices without word events. Errors fall back to the automatic voice once, then show a message with *Try again*.
- **Cheap persistence.** A sentence change writes the small `player` key. Article text lives in its own `doc:<id>` key and is written once. Lists update row by row, so playback never re-renders the queue or moves keyboard focus.
- **Extraction** runs only when you add something: `scripting.executeScript` injects the extractor, gets typed blocks back, and leaves no listener behind.

## How text is prepared for speech

Sentences are split with `Intl.Segmenter`, with guards for abbreviations and initials ("Dr.", "U.C.L.A.", "J. R. R."). Citation markers, URLs, emoji and markdown symbols are dropped. ISO dates become spoken dates, number ranges are read as "20 to 60", and "e.g.", "vs." and "w/" are expanded. Headings and list items get closing punctuation so the voice ends them like sentences. Things that could change meaning, such as "km/h" and "TCP/IP", are left alone.

## Project structure

```
manifest.json
pages/                    popup, side panel, settings, welcome, and the offscreen audio page
src/background/index.js   playback controller, queue, capture, commands, recovery, warm-up
src/content/extract.js    site adapters, Readability, visible-DOM fallback, junk filtering
src/audio/keepalive.js    offscreen document that keeps the audio output awake
src/lib/text.js           sentence segmentation, speech normalisation, reading plan
src/lib/voices.js         voice tiers, ranking, per-language preference
src/lib/queue.js          pure queue operations
src/lib/store.js          storage schema, validation, migration from 2.x
src/ui/common.js          helpers shared by the extension pages
src/ui/deck.js            the player: reading window, section ruler, transport, popovers
src/ui/rows.js            queue and history rows
src/ui/panel.js           side panel workspace and read-along view
src/ui/popup.js           toolbar popup
src/ui/options.js         settings and About
src/ui/welcome.js         first-run page
src/vendor/               Mozilla Readability (Apache License 2.0)
styles/ui.css             design tokens and shared components
styles/workspace.css      popup and side panel
styles/settings.css       settings page
styles/welcome.css        first-run page
assets/                   icons, README screenshots, social preview image
scripts/check.mjs         manifest, file-reference, syntax and no-network checks
scripts/vendor.mjs        copies Readability into src/vendor
test/unit, test/e2e       unit tests, and end-to-end tests in real Chrome
test/fixtures             offline copies of real page layouts
test/perf/bench.mjs       queue-size benchmark
docs/                     architecture, performance and limitations notes
```
