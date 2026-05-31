# QueueTTS

QueueTTS is a local-first Chrome Manifest V3 extension for capturing web text, selected text, and pasted text into a private listening queue.

The extension is designed as a compact browser-native command center: capture first when the queue is empty, playback first when an item is active, and queue management in the side panel.

## Install dependencies

```bash
npm install
```

The project has no runtime package dependencies and no remote scripts.

## Validate

```bash
npm run check
npm run build
```

Both commands run the static extension validation script.

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Select Load unpacked.
4. Choose the project folder containing `manifest.json`.
5. Pin QueueTTS from the extensions menu.

## Use the popup

Open the toolbar popup for the fastest actions.

- If selected text exists, the primary action adds the selection.
- If no text is selected, the primary action adds the current page when Chrome allows capture.
- If the current tab cannot be captured, paste becomes the primary fallback.
- The queue count is always visible.
- Playback controls appear only when there is an item to play.
- Use `Ctrl/Command + K` for commands.
- Use Space to play or pause.
- Use `P` to open paste.
- Use `Q` to open the full queue.

## Use context menus

Right-click selected text on a webpage and choose Add selected text to QueueTTS.

Right-click a page and choose Add current page to QueueTTS.

Use Open QueueTTS queue to open the side panel.

## Use the side panel

The side panel is the full queue manager.

- Preview current page, selected text, or pasted text before adding.
- Search and filter the queue.
- Play, edit, duplicate, reorder, delete, retry, or requeue items.
- Use focus mode for long listening sessions.
- Use the command menu with `Ctrl/Command + K`.
- Configure sleep timer from the playback area.

## Settings

The options page includes:

- Voice selection.
- Speech rate, pitch, volume, and skip interval.
- Heading behavior.
- Theme and reduced motion.
- Auto-play preference.
- Pronunciation dictionary.
- Import/export.
- Clear completed or clear all data.
- Permission and privacy explanation.
- Keyboard shortcut reference.

## Privacy and storage

QueueTTS stores queue items, settings, counters, and pronunciation replacements in `chrome.storage.local`.

QueueTTS has no backend, account system, analytics, tracking pixel, or remote script dependency.

Chrome text-to-speech performs playback. Available voices depend on the user's Chrome and operating system.

## Browser limitations

Chrome blocks script injection on internal pages such as `chrome://` pages and the Chrome Web Store. QueueTTS detects those cases and offers paste as the fallback.

Text-to-speech behavior is controlled by Chrome. Some voices may pause when browser surfaces close depending on platform behavior.
