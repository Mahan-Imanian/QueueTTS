<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/cover-dark.png">
  <img alt="QueueTTS: a private listen-later queue for the web. Save articles, hear them read aloud, resume mid-sentence. No host permissions, resumes per sentence, Chrome 116+." src=".github/assets/cover-light.png" width="100%">
</picture>

<p align="center">
  <img alt="Version 3.1.0" src="https://img.shields.io/badge/version-3.1.0-1b1a17?style=flat-square">
  <img alt="Chrome 116 or newer" src="https://img.shields.io/badge/Chrome-116%2B-1b1a17?style=flat-square">
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-6e2626?style=flat-square">
  <img alt="Host permissions: none" src="https://img.shields.io/badge/host_permissions-none-f0702e?style=flat-square">
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#privacy-and-permissions">Privacy</a> ·
  <a href="#voices">Voices</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#development">Development</a>
</p>

<br>

<img alt="Chrome with a blog post open and the QueueTTS popup below its toolbar button: a news article is being read aloud with the current word underlined, the open post is ready to add with Add to queue or Listen now, and the next two items wait under Up next" src=".github/assets/showcase.png" width="100%">

QueueTTS is a Chrome extension that keeps a list of web pages and reads them aloud in order, using the text-to-speech voices Chrome already exposes. You add pages from any tab; the playback position is saved per sentence, so closing the panel, switching tabs or restarting Chrome does not lose your place.

## What it does

### Adding pages

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, use the toolbar button or right-click. With text selected, only the selection is saved, and a small confirmation with *Undo* appears on the page. New items join the end of the queue and do not interrupt what is playing; when an article ends, it moves to *Listened* and the next one starts.

<img alt="A news article with one paragraph selected and the QueueTTS confirmation in the bottom-right corner of the page: Added, number 6 in queue, with an Undo link" src=".github/assets/f-save.png" width="100%">

### Article extraction

Navigation, cookie banners, share buttons, newsletter boxes, comments, captions, citation markers and hidden text are left out. Wikipedia, GitHub and MDN have site adapters; other pages go through Mozilla Readability, then a visible-DOM fallback. Headings get a pause rather than an announcement, and code is skipped unless you turn it on.

### Read-along and resume

The side panel shows the sentence being read with the current word underlined, and a position bar marked at each section heading. *Read along* shows the whole text; click any sentence to jump there. After a pause, including one across a Chrome restart, playback restarts the sentence you stopped on.

<p align="center">
  <img alt="The side panel's reading window: the previous sentence in grey, the current sentence with the word being spoken underlined, and a position bar with a tick at each section heading" src=".github/assets/f-follow.png" width="49%">
  <img alt="Read-along mode in the dark theme: the whole article under a compact player, with the sentence being read highlighted and the current word underlined" src=".github/assets/f-readalong.png" width="49%">
</p>

### Queue controls

Keyboard shortcuts, a numbered queue you can reorder by dragging or with <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>, a sleep timer, search, undo for removals, a voice picker that marks which voices are online, and export and import of the whole queue (including backups made by version 2).

<p align="center">
  <img alt="The Up next queue: four numbered articles with site names and listening times, a drag handle and play button on one row, and a progress bar on a partly listened article" src=".github/assets/f-queue.png" width="49%">
  <img alt="The voice picker: Automatic, then David, Mark and Zira listed as private voices on this computer, then Google voices marked as online with the text going to Google" src=".github/assets/f-voices.png" width="49%">
</p>

## Install

QueueTTS isn't on the Chrome Web Store yet. There's no build step: the folder you clone is the extension.

1. Clone this repository: `git clone https://github.com/Mahan-Imanian/QueueTTS.git`. Don't run `npm install` in it; that's only for development.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the cloned folder.
4. A welcome page opens. Press **Hear how it works**, choose a voice, and pin QueueTTS from the puzzle-piece menu.

Chrome loads the whole folder, including `docs/`, `test/` and any `node_modules/`, so a clean clone is the leanest copy.

## Privacy and permissions

Your queue, article text and position live in `chrome.storage.local`, inside your Chrome profile. There is no server, no analytics and no telemetry. QueueTTS has no host permissions and reads a page only when you add it.

> [!NOTE]
> **The one thing that can leave your computer:** if you choose a voice named "Google …", Chrome's speech engine (`chrome.tts`) sends the sentence being spoken to Google. These voices are off until you pick one and are labelled as online wherever voices appear.

`npm run check` fails if `fetch`, `XMLHttpRequest`, WebSocket or `sendBeacon` appears in `src/` or `pages/` (vendored Readability excepted), or if the manifest gains host permissions.

| Permission | Why |
| --- | --- |
| `activeTab` | Access to the tab you're adding, only at the moment you add it |
| `scripting` | Injecting the extractor into that tab to read the article |
| `storage` | Your queue, positions and settings |
| `unlimitedStorage` | Lifting Chrome's 10 MB cap so large queues fit |
| `tts` | Speaking |
| `offscreen` | Keeping the audio output awake while you listen, so the first words aren't cut off |
| `contextMenus` | The right-click items |
| `sidePanel` | The queue beside the page |
| `alarms` | The sleep timer, and resuming if Chrome suspends the extension mid-sentence |
| `favicon` | Site icons from Chrome's own favicon cache; QueueTTS never fetches them |

## How it works

```mermaid
flowchart LR
  subgraph Page["Web page (on demand)"]
    X["extract.js<br/>adapters → Readability → fallback"]
  end
  subgraph SW["Service worker"]
    C["Playback controller<br/>single writer"]
    Q["Queue operations"]
  end
  subgraph Storage["chrome.storage"]
    L[("local: settings · queue index<br/>doc:id · player")]
    S[("session: boot flag · last start trace")]
  end
  subgraph UI["Extension pages"]
    P["Popup"]
    D["Side panel"]
    O["Settings · Welcome"]
  end
  A["Offscreen document<br/>audio keep-alive"]
  T["chrome.tts"]
  X -- "blocks" --> C
  P & D & O -- "commands" --> C
  C --> Q --> L
  C --> S
  C -- "speak / stop" --> T
  T -- "start · word · end · error" --> C
  C -- "word events (port)" --> D & P
  L -- "storage.onChanged" --> P & D & O
  C -- "warm" --> A
```

The service worker is the only writer of queue and playback state. More in [docs/architecture.md](docs/architecture.md); timings in [docs/performance.md](docs/performance.md).

## Design decisions

- **No network code.** Everything stays in `chrome.storage.local`, enforced by `npm run check` as described above. The cost: no sync between computers, no cloud voices, and site icons come only from Chrome's own favicon cache.
- **`chrome.tts` for speech.** It works from the service worker with no page open (the Web Speech API needs a document), reports word boundaries for highlighting, and lists both local and Google voices. The cost: quality is limited to the voices installed on the machine, Google voices send the spoken text to Google, and SSML is not interpreted (Chrome passed it through as literal text with the voices tested).
- **One writer for all state.** The popup, side panel, settings page, keyboard shortcuts, alarms and speech events can all change playback at the same time. Routing every change through the service worker's serialised task chain means they can't race or overwrite each other. The cost: every UI action is a message round trip, and the worker carries most of the logic (split across `src/background/`).
- **No build step.** The repository folder is the extension: plain ES modules that Chrome loads directly, so what you read is what runs. The cost: no TypeScript or bundling, Readability is vendored by a copy script, and Chrome loads the whole folder, including `docs/` and `test/`.

## Voices

QueueTTS speaks through Chrome's `chrome.tts` API, so it uses whatever voices Chrome exposes.

| Kind | Examples | Quality | Privacy |
| --- | --- | --- | --- |
| Local, standard | Microsoft David, Mark and Zira on Windows | Mechanical | Text never leaves the computer |
| Local, enhanced | macOS "Premium" and "Enhanced" voices | Natural | Text never leaves the computer |
| Online | Google US English, Google UK English | Clearer and more natural | Chrome sends the text being spoken to Google; no word-by-word highlight |

Voices are ranked by the article's language, then quality: enhanced local, online (only if you've allowed them), standard local. An online voice is never chosen unless you've picked one or switched them on.

## Keyboard shortcuts

These work while Chrome is focused. To use them from other apps, set them to **Global** at `chrome://extensions/shortcuts`, where you can also change the keys.

| Shortcut | Action |
| --- | --- |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Add this page, or the selected text |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Play or pause |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd> | Open QueueTTS |
| Not set (assign your own) | Forward one sentence |
| Not set (assign your own) | Back one sentence |

In the popup and side panel: <kbd>Space</kbd> play or pause, <kbd>←</kbd> <kbd>→</kbd> one sentence back or forward, <kbd>N</kbd> next item, <kbd>−</kbd> <kbd>+</kbd> speed, <kbd>R</kbd> read along, <kbd>/</kbd> search, <kbd>?</kbd> list them all.

## Development

Tested on Node 24 and Chrome 142. The end-to-end tests also need at least one local text-to-speech voice, which Windows and macOS include.

```bash
npm install
npm run check
npm test
npm run test:e2e
```

| Command | What it does |
| --- | --- |
| `npm run check` | Manifest, file references, syntax and the no-network rule |
| `npm test` | Unit tests for text processing, the queue, storage, import and voices |
| `npm run test:e2e` | End-to-end tests in your installed Chrome (set `CHROME_PATH` if needed) |
| `node test/perf/bench.mjs` | Queue-size benchmark with 10 to 1,000 articles (see [docs/performance.md](docs/performance.md)) |

After editing, reload QueueTTS in `chrome://extensions`. Extraction fixes need a fixture in `test/fixtures` and a test in `test/e2e/extraction.test.js`.

| Folder | Contents |
| --- | --- |
| `pages/` | Popup, side panel, settings, welcome and offscreen pages |
| `src/` | Service worker, extractor, shared logic, UI, vendored Readability |
| `styles/` | CSS |
| `assets/` | Icons and the social preview image |
| `scripts/` | Check and vendor scripts |
| `test/` | Unit, end-to-end and perf tests, page fixtures |
| `docs/` | Architecture, performance and limitations notes |

## Limitations

No on-page highlighting, PDF support or sync between computers yet; English interface only; not yet tested with a screen reader. See [docs/limitations.md](docs/limitations.md) for supported sites, browsers and the roadmap.

## License

No license has been chosen yet, so all rights are reserved for now. The vendored Mozilla Readability is under the Apache License 2.0 (`src/vendor/READABILITY-LICENSE.md`).
