# QueueTTS Rebuild Notes

## Summary

This build applies the latest product critique: QueueTTS must stop feeling like a dark card-stack web app and behave like a compact browser-native speech queue command system.

The implementation focuses on:

- Popup-first Chrome extension ergonomics
- Clear capture → review → queue → listen workflow
- Fewer containers and stronger hierarchy
- Queue rows instead of generic cards
- Failed extraction repair paths
- Source metadata and extraction quality
- Local-first privacy clarity

## Architecture

- Manifest V3 Chrome extension
- `manifest.json` defines popup, side panel, options page, service worker, icons, and permissions
- `src/background.js` coordinates capture, context menus, queue playback, sleep timer, and Chrome TTS
- `src/content.js` extracts selected text, page context, and readable page text when invoked
- `src/shared.js` owns storage normalization, item creation, text cleanup, segmentation, estimates, and import/export parsing
- `src/popup.js` renders the compact toolbar remote
- `src/sidepanel.js` renders the full queue and capture surface
- `src/options.js` renders voice, behavior, storage, privacy, and shortcut settings

## Permissions

- `storage`: stores queue, settings, dictionary, counters, and playback state locally
- `contextMenus`: adds right-click capture and queue actions
- `activeTab`: allows capture only after the user invokes the extension
- `scripting`: injects the local content script into the active tab for capture
- `sidePanel`: opens the full queue beside the browser page when available
- `tts`: speaks queued text through Chrome text-to-speech
- `alarms`: powers sleep timer behavior locally

No `<all_urls>` host permission is requested. No remote JavaScript is used. No backend is required.

## Storage approach

QueueTTS uses `chrome.storage.local` through a shared state abstraction. The state contains:

- queue items
- item source metadata
- item extraction quality
- playback state
- voice and behavior settings
- pronunciation dictionary
- daily counters

Exports include a schema version and normalized state. Imports validate through the same normalizer before replacing local state.

## Capture behavior

Capture is user-triggered.

- Selected text is preferred when enough selected words are detected.
- Page capture extracts from article/main/content candidates, removes noisy elements, and filters obvious navigation/cookie/share text.
- Failed or uncertain extraction is preserved as a repairable queue item or preview state.
- Unsupported Chrome/internal pages fall back to paste.

## Playback behavior

Playback uses `chrome.tts` from the background service worker.

The UI supports:

- play/pause
- previous/next item
- previous/next segment
- skip controls in the full queue
- voice/rate controls
- sleep timer
- focus mode

Browser TTS behavior depends on installed Chrome voices and platform support.

## What changed in this pass

- Rebuilt popup density and layout to avoid horizontal scroll.
- Removed empty playback controls when the queue is empty.
- Made the current tab capture action dominant.
- Added a compact command palette in the popup.
- Reworked the full queue into a two-zone cockpit: playback/queue plus capture/trust rail.
- Replaced metric cards with a compact status strip.
- Reworked queue items into dense source-aware rows.
- Added repair hierarchy for failed captures.
- Preserved extraction quality metadata.
- Tightened semantic design tokens and state colors.
- Added controlled atmospheric depth without decorative glassmorphism.

## Files changed

- `manifest.json`
- `package.json`
- `src/background.js`
- `src/content.js`
- `src/shared.js`
- `src/popup.js`
- `src/sidepanel.js`
- `src/options.js`
- `pages/popup.html`
- `pages/sidepanel.html`
- `pages/options.html`
- `styles/base.css`
- `styles/popup.css`
- `styles/sidepanel.css`
- `styles/options.css`
- `README.md`
- `CHANGELOG.md`
- `REBUILD_NOTES.md`

## Tests run

- `npm run check`
- `npm run build`
- JavaScript syntax validation through the checker
- Required file and asset validation
- Manifest V3 validation through the checker
- Chromium headless unpacked-extension smoke launch
- ZIP integrity verification

## Manual QA checklist

- Load unpacked extension in Chrome
- Open popup
- Verify no horizontal popup overflow
- Verify empty popup prioritizes capture
- Capture current page
- Capture selected text through context menu
- Paste text in popup
- Open full queue
- Play/pause
- Move previous/next segment
- Move previous/next item
- Search queue
- Filter queue
- Edit queue item
- Repair failed capture
- Retry failed extraction
- Duplicate queue item
- Reorder queue item
- Delete queue item
- Open focus mode
- Change voice and rate
- Export data
- Import data
- Clear data safely
- Reload extension and confirm queue persistence
- Test Chrome internal page fallback
- Test reduced motion setting
- Test keyboard focus rings and Escape behavior

## Remaining limitations

- Page extraction is practical, not perfect. Complex sites may need selected-text capture or manual paste.
- Chrome TTS voice availability depends on the browser profile and operating system.
- Background audio behavior follows Chrome extension and TTS lifecycle constraints.
