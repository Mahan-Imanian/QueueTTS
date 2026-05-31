# QueueTTS 2.1 Rebuild Notes

## Summary

This pass applies the attached product critique as a rebuild spec. The popup was rebuilt from a roomy AI-template panel into a compact extension-native utility. The new version prioritizes queue state, current browser context, playback clarity, and fast capture instead of visual decoration.

## What changed

- Removed the gradient primary CTA and replaced it with a single restrained accent color.
- Reduced radii, removed glassmorphism, removed decorative background grids, and flattened internal surfaces.
- Rebuilt the popup IA around four focused zones: current tab context, mini player, capture, and up-next queue.
- Added current tab title, domain, and selected-text count.
- Made the primary capture action context-aware.
- Collapsed Quick Paste by default.
- Added elapsed and remaining time around the progress bar.
- Added voice/rate visibility.
- Added queue count in the header.
- Added up-next preview rows.
- Replaced ambiguous minus/plus segment controls with Back and Next labels.
- Added cleanup logic for common extraction junk such as standalone avatar/logo/icon/image labels.
- Preserved side panel queue management, preview/edit flow, focus mode, command menu, options, import/export, and local-first storage.

## Chrome extension architecture

- `manifest.json`: Manifest V3 metadata, permissions, popup, side panel, options page, icons, and service worker.
- `src/background.js`: context menus, active-tab capture, selected-page context probing, Chrome TTS playback, sleep timer, badge state, and side panel opening.
- `src/content.js`: selection capture, page extraction, and current-page context reporting.
- `src/shared.js`: local state normalization, queue item creation, cleanup, segmentation, progress, import/export, and storage helpers.
- `pages/popup.html`, `src/popup.js`, `styles/popup.css`: compact toolbar mini player and capture surface.
- `pages/sidepanel.html`, `src/sidepanel.js`, `styles/sidepanel.css`: full queue manager, capture review, focus mode, search/filter, command menu, and queue editing.
- `pages/options.html`, `src/options.js`, `styles/options.css`: voice, playback, storage, privacy, and shortcut settings.

## Permissions used

- `storage`: stores queue, settings, dictionary, playback state, and counters locally.
- `contextMenus`: enables selected text, current page, and open queue actions.
- `activeTab`: allows capture of the active page only after user action.
- `scripting`: injects the local content script into the active tab after user action.
- `sidePanel`: opens the full queue manager beside the browser page.
- `tts`: speaks queue text through Chrome text-to-speech.
- `alarms`: powers the sleep timer.

No host permissions are requested. `<all_urls>` is not used.

## Storage approach

All product data is stored in `chrome.storage.local` under `queuetts:v2`. The service worker never uses `localStorage`. Export/import serializes a normalized schema so the user can back up local data.

## Capture behavior

- Selected text can be captured from the context menu or popup.
- Current page capture injects `src/content.js` only after user action.
- The content script prefers `article`, `main`, and role-main content, removes common UI noise, deduplicates lines, and returns a reviewable capture.
- If extraction fails or finds too little text, the queue item is marked failed and can be edited or retried from the side panel.

## Playback behavior

Playback uses `chrome.tts`. The service worker tracks item, segment, state, sleep timer, and badge count. Browser TTS behavior can vary by installed voices and Chrome platform behavior. QueueTTS does not claim continuous background audio beyond what Chrome TTS permits.

## Known browser limitations

- Chrome blocks content-script injection on internal browser pages, extension pages, and some protected sites.
- Page extraction is practical but not perfect. Users can review, edit, retry, or paste manually.
- Voice availability depends on Chrome and the operating system.
- Some voices reported by Chrome may be remote voices.

## Files changed

- `manifest.json`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `REBUILD_NOTES.md`
- `src/background.js`
- `src/content.js`
- `src/shared.js`
- `src/popup.js`
- `styles/base.css`
- `styles/popup.css`
- `styles/sidepanel.css`
- `styles/options.css`
- `pages/popup.html`

## Tests run

- `npm run check`
- `npm run build`
- `node --check` through the project validator for all source files
- Chromium unpacked-extension smoke launch with `--load-extension`
- Final ZIP structure verification

Chromium emitted Linux container DBus/inotify warnings during smoke launch. Those are environment-level headless browser warnings, not extension validation failures.

## Manual QA checklist

- Load unpacked extension in Chrome Developer Mode.
- Open popup.
- Confirm popup does not clip at 390px width.
- Confirm selected text count appears on normal web pages.
- Select text on a page and confirm primary action changes to Add selected text.
- Add selected text from popup.
- Add selected text from context menu.
- Add current page from popup.
- Add current page from context menu.
- Open side panel.
- Review/edit captured text before adding from side panel.
- Add pasted text.
- Play/pause.
- Previous/next item.
- Previous/next segment.
- Skip forward/backward from side panel.
- Set sleep timer.
- Change voice/rate in options.
- Edit queue item.
- Duplicate queue item.
- Delete queue item.
- Reorder queue item.
- Search queue.
- Export JSON.
- Import JSON.
- Clear completed.
- Clear all data.
- Reload extension and confirm persistence.
- Test empty queue state.
- Test failed extraction state on a protected/internal page.
- Test long article capture.
- Test keyboard navigation and focus rings.
- Test reduced motion setting.

## Remaining limitations

The queue and settings are local to the installed Chrome profile. There is no account sync, backend, analytics, or cloud processing by design.
