# QueueTTS Rebuild Notes

## Summary

This build applies the latest product-design critique: QueueTTS must feel like a living, browser-native audio queue system, not a dark dashboard with attractive controls. The pass focuses on settings maturity, semantic color, queue/player hierarchy, extension-native density, and replacing raw advanced settings with designed workflows.

## Architecture

- Manifest V3 Chrome extension
- `manifest.json` defines popup, side panel, options page, service worker, icons, and permissions
- `src/background.js` coordinates capture, context menus, queue playback, sleep timer, and Chrome TTS
- `src/content.js` extracts selected text, current page context, and readable page text when invoked
- `src/shared.js` owns storage normalization, item creation, text cleanup, segmentation, estimates, and import/export parsing
- `src/popup.js` renders the toolbar command remote
- `src/sidepanel.js` renders the full queue, playback deck, preview, repair, focus, and capture surface
- `src/options.js` renders operational settings, structured pronunciation rules, storage, privacy, and shortcuts

## Permissions

- `storage`: local queue, settings, pronunciation rules, counters, and playback state
- `contextMenus`: right-click selected-text and page capture
- `activeTab`: active page access only after a user action
- `scripting`: injects the bundled capture script into the active tab
- `sidePanel`: opens the queue beside the current page
- `tts`: speaks queued text through Chrome text-to-speech
- `alarms`: local sleep timer behavior

No `<all_urls>` host permission is requested. No remote JavaScript is used. No backend is required.

## Storage approach

QueueTTS uses `chrome.storage.local` through a shared state abstraction. State includes queue items, source metadata, extraction quality, playback status, voice/playback settings, pronunciation rules, and daily counters. Exported backups include a schema version and normalized state. Imports validate through the same normalizer before replacing local state.

## Capture behavior

Capture is user-triggered. Selected text is preferred when enough selected words are detected. Page capture extracts from article/main/content candidates, removes noisy elements, and filters obvious navigation, cookie, share, and subscription text. Failed or uncertain extraction remains visible as repairable state. Unsupported Chrome/internal pages fall back to paste.

## Playback behavior

Playback uses `chrome.tts` from the background service worker. The UI supports play/pause, previous/next item, previous/next segment, skip controls, voice/rate settings, sleep timer, focus mode, and a compact popup remote. Chrome TTS voice availability depends on the user profile and operating system.

## What changed in this pass

- Replaced the oversized settings hero with a live operational status strip.
- Added sticky section navigation to settings.
- Rebuilt the pronunciation dictionary as a structured rule editor with inline testing.
- Added voice sample testing and live values for audio controls.
- Converted permission copy into compact status rows.
- Separated destructive reset into a danger zone with stronger confirmation.
- Strengthened semantic color discipline across base tokens.
- Kept violet constrained to voice/audio tuning controls.
- Hid the active now-playing item from popup queue preview to reduce duplicated hierarchy.
- Updated README, changelog, and rebuild notes.

## Files changed

- `manifest.json`
- `package.json`
- `package-lock.json`
- `pages/options.html`
- `styles/base.css`
- `styles/options.css`
- `src/options.js`
- `src/popup.js`
- `README.md`
- `CHANGELOG.md`
- `REBUILD_NOTES.md`

## Tests run

- `npm run check`
- `npm run build`
- JavaScript syntax validation through the checker
- Manifest V3 validation through the checker
- Required file and asset validation
- Extension-safe path/static reference validation
- Chromium headless unpacked-extension smoke launch attempted with the rebuilt unpacked directory
- ZIP integrity verification

The Chromium headless smoke launch produced container-level DBus/inotify warnings typical of headless Linux. The extension directory was still passed through Chrome with `--load-extension` and no project checker failure occurred.

## Manual QA checklist

- Load unpacked extension in Chrome
- Open popup and confirm no horizontal overflow
- Verify capture-first empty state
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
- Open command palette
- Change voice, rate, pitch, and volume
- Test voice sample
- Add/edit/delete/test pronunciation rules
- Export backup
- Import backup
- Clear completed items
- Clear all data with confirmation
- Reload extension and confirm persistence
- Test Chrome internal page fallback
- Test reduced motion setting
- Test keyboard focus rings and Escape behavior

## Remaining limitations

- Page extraction is practical, not perfect. Complex sites may need selected-text capture or manual paste.
- Chrome TTS voice availability depends on the browser profile and operating system.
- Background audio behavior follows Chrome extension and TTS lifecycle constraints.
- Keyboard shortcut remapping itself remains handled by Chrome extension shortcut settings rather than an in-extension remapper.
