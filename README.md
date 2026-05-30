# QueueTTS Chrome Extension

QueueTTS is a Manifest V3 Chrome extension for capturing readable text from the browser, organizing it into a local queue, and listening with Chrome text-to-speech.

## What it does

- Capture selected text from a webpage through the right-click menu or toolbar popup.
- Capture the current page through the toolbar popup, side panel, or context menu.
- Paste text directly into the popup or side panel.
- Review and edit extracted page text before adding it to the queue from the side panel.
- Listen with play, pause, previous item, next item, previous segment, next segment, and skip controls.
- Manage queue items with search, filters, edit, duplicate, delete, reorder, retry, and queue-again actions.
- Use focus mode for a cleaner long-listening view.
- Configure voice, language, rate, pitch, volume, skip interval, headings, sleep timer, theme, motion, and pronunciation replacements.
- Export, import, clear completed items, or clear all QueueTTS data.

## Install dependencies

No runtime dependencies are required.

```bash
npm install
```

## Build and checks

There is no bundling step. The build command validates the extension structure, manifest, JavaScript syntax, required files, and asset references.

```bash
npm run check
npm run build
```

## Load as an unpacked Chrome extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select this project folder.
6. Pin QueueTTS from the extensions menu for fast toolbar access.

## Use the toolbar popup

- Click the QueueTTS toolbar icon.
- Use Add selected text after selecting text on a webpage.
- Use Add this page to capture readable text from the active tab.
- Paste short text directly into Quick paste.
- Use the mini player controls for immediate playback.
- Open queue to move into the side panel/full queue experience.

## Use context menus

Right-click on a webpage to use:

- Add selected text to QueueTTS.
- Add current page to QueueTTS.
- Open QueueTTS queue.

Selected-text capture is the most reliable capture path because Chrome provides the selection directly to the extension after the user chooses the menu item.

## Use the side panel or full queue

The side panel is the daily-use interface. It includes now playing, capture previews, queue search and filters, item editing, reorder controls, focus mode, trust copy, and settings access. If Chrome cannot open a side panel in a context, QueueTTS opens the full queue page in a tab.

## Settings and storage

Open Settings from the side panel to configure voice and playback behavior, pronunciation replacements, import/export, privacy copy, and keyboard shortcuts.

QueueTTS stores queue items, source metadata, settings, pronunciation replacements, and listening counters in `chrome.storage.local`. The extension has no account system, no backend, no analytics, and no tracking code. Text-to-speech is handled by Chrome through the `chrome.tts` extension API.

## Browser limitations

QueueTTS can only capture pages where Chrome allows user-triggered extension scripting. Chrome blocks capture on restricted pages such as `chrome://` URLs, the Chrome Web Store, some internal pages, and pages where browser policy prevents script injection. When extraction fails, use selected-text capture or paste manually.

Article extraction is practical, not perfect. QueueTTS removes common page chrome such as navigation, ads, forms, scripts, cookie prompts, and sidebars, then extracts headings, paragraphs, list items, blockquotes, captions, and table text. Review long or unusual captures before adding.

## Keyboard shortcuts

- Space: play or pause.
- J / K: next or previous segment.
- N / P: next or previous item.
- `/`: search queue.
- F: focus mode.
- Ctrl/Command K: command menu.
- Ctrl/Command Enter: add pasted text in popup.
