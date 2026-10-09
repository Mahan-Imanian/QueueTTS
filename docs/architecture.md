# Architecture

The diagram is in the [README](../README.md#how-it-works). This page describes the rules behind it and where each part lives.

## Single writer

The service worker is the only code that changes the queue, the player state or the settings. Extension pages send commands with `chrome.runtime.sendMessage` and render from `chrome.storage.onChanged`. Every command, speech event and alarm runs through one promise chain (`exclusive` in `src/background/state.js`), so two state transitions never interleave. Pages keep a read-only snapshot and never write storage themselves.

## Saved position and resume

The position is a block index and a sentence index, saved each time a sentence starts. Pausing stops speech and saves that position. Resuming speaks the saved sentence again instead of calling `chrome.tts.resume()`, so it behaves the same whether the worker was suspended for seconds or days.

## Browser and worker restarts

At startup the worker checks a `booted` flag in `chrome.storage.session`, which survives worker restarts but not browser restarts:

- After a browser restart, a stored `playing` status becomes `paused`.
- After a worker restart in the middle of a sentence, playback resumes from the saved sentence.

A watchdog alarm runs every 30 seconds, only while playback is active. If no sentence is being spoken and the player state has not changed for `STALL_MS` (12 seconds), it restarts the current sentence. An empty `chrome.runtime.onStartup` listener is registered, which makes Chrome start the worker when the browser launches.

## When the UI shows Playing

The status changes to `playing` when the engine reports the first `word` event. Voices that declare no word events are confirmed by their `start` event. For other voices, if no word event arrives within 900 ms of the start event (`START_CONFIRM_MS`), the start event counts. If a voice you chose fails, playback retries once with the automatic voice; any other speech error stops playback and shows the message with *Try again*.

## Storage layout

| Key | Contents | Written |
| --- | --- | --- |
| `player` | current item, position, status | at every sentence start |
| `queue` | item metadata, no article text | on queue changes; during playback at most every 20 s (`LISTENING_FLUSH_MS`) and on pause |
| `doc:<id>` | the article's blocks | once, when the item is added |
| `settings` | voices, rate, pronunciations, learned reading speed | on change, and with the listening flush |
| `stats` | listening time and finished count per local day, last 120 days | with the listening flush and when an item finishes |

Because article text is stored per item, a sentence change writes a few hundred bytes regardless of queue size. Lists update row by row, so playback does not re-render the queue or move keyboard focus.

## Extraction

Extraction runs only when you add something. `chrome.scripting.executeScript` injects `src/content/extract.js` (and Readability for full-page captures) into the active tab, gets typed blocks back (`p`, `h`, `li`, `q`, `code`), and leaves no listener behind. A site adapter (Wikipedia, GitHub, MDN) runs first when one matches. If it finds fewer than 60 words (`ENOUGH_WORDS`), Mozilla Readability runs, and if that also finds fewer than 60, the largest visible `article`, `main` or content element is used; whichever result has more words wins. If Readability throws, extraction continues with the fallback. Pages under 30 words (`MIN_ARTICLE_WORDS`) are declined, and so are pages under 180 words (`LISTING_MAX_WORDS`) with at least as many headings as paragraphs of 12 or more words (`PROSE_PARAGRAPH_WORDS`), which is what section fronts and link lists look like. These thresholds were set by hand against the pages in `test/fixtures`; the extraction tests pin the resulting behaviour.

## Preparing text for speech

`src/lib/text.js` splits sentences with `Intl.Segmenter`, then merges segments the segmenter split too eagerly:

- after title-like abbreviations ("Dr.", "e.g.", "U.S.", "Jan.") and single initials;
- after "No." only when a number follows;
- whenever the next segment starts with a lowercase letter.

Abbreviations that often end a sentence ("etc.", "Inc.", "Jr.", "p.m.") are not merged when the next word is capitalised. The trade-off: "moved to the U.S. Then he left" stays one sentence, because "U.S." is more often followed by a capitalised noun ("the U.S. Senate").

Sentences longer than 280 characters (`MAX_SENTENCE_CHARS`) are split at the last clause break (`;`, `:`, `,`, a spaced dash, or the CJK marks `，；：、`) after the first 120 characters, otherwise at the last space, otherwise hard at 280. A remainder with no letters or digits stays with the previous part. These limits were picked by hand to keep one unit to a few seconds of speech, so skipping and resuming stay fine-grained; they were not tuned against measurements.

Before speaking, citation markers, URLs (reduced to the host name, keeping the punctuation that follows), emoji and markdown symbols are removed. ISO dates become spoken dates, number ranges are read as "20 to 60", and in English "e.g.", "i.e.", "vs.", "approx." and "w/" are expanded. Headings and list items get closing punctuation so the voice ends them like sentences. "km/h", "TCP/IP", email addresses and decimals are left alone.

## Remaining-time estimate

Remaining time is characters left divided by characters per second (`cps`, default 15) times the rate. After each sentence longer than 40 characters and 600 ms, the worker measures the actual speed. Values between 6 and 40 cps (`CPS_MIN`, `CPS_MAX`) are blended into the stored value with a weight of 0.1, so one odd sentence moves the estimate only slightly (`RATE_SAMPLE_MIN_CHARS`, `RATE_SAMPLE_MIN_MS` and `RATE_SAMPLE_WEIGHT` in `src/background/playback.js`). The default, the bounds and the weight were chosen by hand with the author's voices, not derived from a study of other voices.

## Project structure

```
manifest.json
pages/                       popup, side panel, settings, welcome, and the offscreen audio page
src/background/index.js      command table, queue commands, boot, Chrome event listeners
src/background/state.js      in-memory state, the serialised task chain, persistence, badge
src/background/playback.js   reading plan, speaking, speech events, play/pause/skip/seek
src/background/speech.js     chrome.tts access, voice resolution and fallback, engine warm-up
src/background/capture.js    extractor injection, adding pages and text, on-page confirmation
src/background/audio.js      offscreen document that keeps the audio output awake
src/background/alarms.js     alarm names and the playback watchdog
src/background/trace.js      start-up timing marks shown in Settings → About
src/content/extract.js       site adapters, Readability, visible-DOM fallback, junk filtering
src/audio/keepalive.js       the offscreen page's inaudible audio stream
src/lib/text.js              sentence segmentation, speech normalisation, reading plan
src/lib/voices.js            voice tiers, ranking, per-language preference
src/lib/queue.js             pure queue operations
src/lib/store.js             storage schema, validation, import, migration from 2.x
src/ui/common.js             helpers shared by the extension pages
src/ui/deck.js               the player: reading window, section ruler, transport, popovers
src/ui/rows.js               queue and history rows
src/ui/panel.js              side panel and read-along view
src/ui/popup.js              toolbar popup
src/ui/options.js            settings, import/export and About
src/ui/welcome.js            first-run page
src/vendor/                  Mozilla Readability (Apache License 2.0)
styles/                      design tokens, shared components, per-page styles
scripts/check.mjs            manifest, file-reference, syntax and no-network checks
scripts/vendor.mjs           copies Readability into src/vendor
test/unit, test/e2e          unit tests, and end-to-end tests in real Chrome
test/fixtures                offline copies of real page layouts
test/perf/bench.mjs          queue-size benchmark
docs/                        architecture, performance and limitations notes
```
