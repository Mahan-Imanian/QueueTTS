# QueueTTS

QueueTTS is a local-first Chrome Manifest V3 extension for capturing readable browser text, queueing it, and listening with Chrome text-to-speech.

## Install for development

```bash
npm install
npm run check
npm run build
```

## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder.
5. Pin QueueTTS from the Chrome toolbar.

## Use the popup

The popup is a compact command remote.

- It shows current tab capture readiness and selected-text availability.
- The primary action changes to the best capture path: selected text, current page, or paste.
- Playback controls appear only when there is a playable queue item.
- Queue preview rows show upcoming items only, not a duplicated now-playing row.
- `Ctrl/⌘ K` opens the command palette.
- `P` opens paste, `Q` opens the full queue, and `Space` toggles playback.

## Use the side panel / full queue

Open the queue from the popup, context menu, or command palette.

The full queue surface includes:

- Playback deck
- Capture preview before queueing
- Dense source-aware queue rows
- Failed extraction repair flow
- Search and filters
- Focus mode
- Import/export
- Local privacy controls

## Context menus

Right-click on a page or selected text:

- **Add selected text to QueueTTS**
- **Add current page to QueueTTS**
- **Open QueueTTS queue**

## Options

The options page is an operational settings surface, not a marketing page.

It includes:

- Live status strip for voice, queue, storage, and local privacy
- Sticky settings navigation
- Voice selection
- Language hint
- Speech rate, pitch, and volume with live values
- Voice sample playback
- Skip interval
- Sleep timer default
- Heading behavior
- Theme and reduced motion
- Structured pronunciation rule editor with rule testing
- Advanced raw dictionary mode
- Import/export backup flows
- Data clearing with a separated reset zone
- Permission status rows
- Keyboard shortcut reference

## Privacy and storage

QueueTTS is local-first.

- Queue items and settings are stored in `chrome.storage.local`.
- Speech is handled by Chrome text-to-speech.
- No backend is required.
- No account is required.
- No analytics or tracking are included.
- Active tab access is used only after the user invokes capture.

## Validation

```bash
npm run check
npm run build
```

The checker validates Manifest V3 shape, required files, missing assets, remote script references, syntax, and extension-safe source paths.
