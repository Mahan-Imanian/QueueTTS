# QueueTTS

A listen-later queue for Chrome. Add articles and selected text as you find them, and QueueTTS reads them to you in order with your computer's voices, picking up from the sentence where you stopped. There's no account and no server: the queue lives in your browser.

![QueueTTS popup over a news article: one article is playing, a selected paragraph is ready to add, and three more items are up next](assets/readme/popup.png)

## How it works

Press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> on an article (or use the toolbar button or the right-click menu). QueueTTS pulls out the article itself, leaving behind navigation, cookie banners, share buttons, newsletter boxes, comments, citation markers and anything hidden on the page. If you select text first, only the selection is added.

New items go to the end of the queue. Playing one never interrupts what you're listening to. When an article finishes it moves to History and the next one starts. Pause for a minute or a week, even across a Chrome restart, and playback resumes from the sentence you stopped on.

The side panel shows the whole queue in order and the text being read, with the current sentence highlighted. Click any sentence to jump to it.

![The QueueTTS side panel next to an article, following along in the Reading view with the current sentence highlighted](assets/readme/side-panel.png)

## Install

QueueTTS is not on the Chrome Web Store yet.

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repository folder.
4. A welcome page opens. Press **Hear how it works** to hear a short sample.

It needs Chrome 116 or later. There is no build step.

## Shortcuts

These work in any tab and can be changed at `chrome://extensions/shortcuts`.

| Shortcut | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> | Add this page, or the selected text |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Play or pause |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd> | Open QueueTTS |

You can also assign keys for skipping a sentence forward or back.

Inside the popup and side panel:

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play or pause |
| <kbd>←</kbd> <kbd>→</kbd> | Back or forward one sentence |
| <kbd>−</kbd> <kbd>+</kbd> | Slower or faster |
| <kbd>N</kbd> | Skip to the next item |
| <kbd>/</kbd> | Search the queue |
| <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Enter</kbd>, <kbd>Delete</kbd> | Move through the queue, play, remove (with undo) |
| <kbd>Alt</kbd>+<kbd>↑</kbd> <kbd>↓</kbd> | Reorder the selected item |
| <kbd>?</kbd> | Show all shortcuts |

## Privacy

- Your queue, the text of everything you add, and your settings are stored in `chrome.storage.local` in your browser profile.
- QueueTTS makes no network requests of its own and has no analytics. The build check fails if any `fetch`, `XMLHttpRequest`, WebSocket or beacon call appears in the code.
- Pages are read only when you add them. QueueTTS uses `activeTab` and has no access to sites in general.
- Voices that run on your computer (such as *Microsoft Zira* on Windows) keep everything local. Voices named "Google …" are online voices: Chrome sends the text being spoken to Google. They are off by default, labelled in Settings, and only used if you turn on **Allow online voices**.

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Read the current page when you add it |
| `storage`, `unlimitedStorage` | Keep a large queue without hitting Chrome's 10 MB limit |
| `tts` | Speak |
| `contextMenus` | The right-click items |
| `sidePanel` | The queue view beside the page |
| `alarms` | The sleep timer, and recovering playback if Chrome suspends the extension mid-sentence |
| `favicon` | Show site icons from Chrome's own cache, without fetching them |

## Known limitations

- Voices are whatever your operating system and Chrome provide. On Windows the local voices sound robotic. The natural voices in Chrome's Reading mode aren't available to extensions.
- The highlight follows along in the side panel, not on the original web page.
- PDFs aren't supported yet. Select the text and use **Paste text** instead.
- Pages that need a login, and pages that are mostly lists of links, are declined with a message rather than read.

## Development

Plain JavaScript modules with no runtime dependencies. Page extraction uses [Mozilla Readability](https://github.com/mozilla/readability), vendored into `src/vendor` so the extension loads unpacked.

```
src/background/index.js   service worker: the playback controller, queue, capture, commands, recovery
src/content/extract.js    page and selection extraction into typed blocks
src/lib/                  text segmentation and speech clean-up, queue operations, storage
src/ui/                   popup, side panel, settings and welcome page
styles/ui.css             design tokens and shared components
test/unit, test/e2e       unit tests and real-Chrome end-to-end tests
```

```bash
npm install
```

```bash
npm run check
```

```bash
npm test
```

```bash
npm run test:e2e
```

The end-to-end tests load the extension into your installed Chrome (set `CHROME_PATH` if it's somewhere unusual) and need at least one local text-to-speech voice. `node test/perf/bench.mjs` measures capture, rendering and playback at 10 to 1,000 queued articles.
