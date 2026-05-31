# QueueTTS

QueueTTS is a local-first Chrome extension for capturing readable text from the browser, queueing it, and listening later through Chrome text-to-speech.

The extension works from the toolbar popup, right-click context menus, and the side panel queue manager. It does not require a local server, backend account, analytics, or remote JavaScript.

## Install dependencies

```bash
npm install
```

The project has no runtime dependencies. The install step keeps the lockfile available for repeatable checks.

## Validate the extension

```bash
npm run check
npm run build
```

Both commands run the static extension validator in `scripts/check.mjs`. It checks Manifest V3 structure, required files, local asset references, disallowed remote script references, broad host permission avoidance, and JavaScript syntax.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Select Load unpacked.
4. Choose the project folder that contains `manifest.json`.
5. Pin QueueTTS from the Chrome toolbar.

## Use the toolbar popup

The popup is the fast surface.

- It shows the current page title, domain, and selected text count when Chrome allows access.
- If text is selected, the primary action becomes Add selected text.
- If no selection is available, the primary action becomes Add this page.
- Paste is collapsed by default and opens only when needed.
- The mini player shows queue count, current source, elapsed time, remaining time, voice/rate, and up-next items.
- Open queue launches the side panel or full queue page.

## Use context menus

Right-click on any normal webpage:

- Add selected text to QueueTTS
- Add current page to QueueTTS
- Open QueueTTS queue

Selected-text capture uses Chrome's context menu selection payload. Current-page capture runs only after a user action through `activeTab` and `scripting`.

## Use the side panel queue

The side panel is the full product surface.

- Capture current page, selected text, or pasted text.
- Review and edit extracted text before adding it.
- Play, pause, skip segments, move between items, and use a sleep timer.
- Search and filter the queue.
- Edit, duplicate, delete, reorder, retry, or requeue items.
- Use focus mode for long listening sessions.
- Use `Ctrl/⌘ K` for the command menu.

## Settings and privacy

The options page controls voice, language hint, speech rate, pitch, volume, skip interval, heading behavior, sleep defaults, theme, reduced motion, auto-play, pronunciation replacements, import/export, storage clearing, and shortcut reference.

QueueTTS stores only local extension data in `chrome.storage.local`:

- queue items
- source metadata
- settings
- pronunciation dictionary
- daily counters
- playback position

There is no backend, account, analytics, tracking pixel, or remote script. Speech playback uses Chrome text-to-speech. Some Chrome voices may be remote depending on the voice installed in the browser; QueueTTS exposes the voice list Chrome provides.

## Permissions

- `storage`: local queue, settings, counters, dictionary, and playback state.
- `contextMenus`: right-click capture actions.
- `activeTab`: user-triggered capture from the active page only.
- `scripting`: injects the local content script after user action.
- `sidePanel`: opens the queue beside the current page.
- `tts`: browser text-to-speech playback.
- `alarms`: sleep timer.

No host permissions and no `<all_urls>` permission are used.
