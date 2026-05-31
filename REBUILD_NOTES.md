# QueueTTS Rebuild Notes

## Summary

This version applies the product-quality critique as a correction spec. The extension no longer behaves like a narrow dark web app with stacked cards. The popup is now a compact browser-native queue command center.

The main behavioral rule is simple:

- Empty queue: capture is primary.
- Active queue: playback is primary.
- Unsupported page: paste is primary.
- Queue work: side panel is primary.

## What changed

- Removed the over-carded popup structure.
- Removed full-width Back and Next media controls.
- Removed repeated empty-state messages and meaningless zero-time playback metrics.
- Collapsed manual paste until requested.
- Made the primary capture action change based on browser context.
- Added command palette behavior in the popup.
- Added compact queue rows in the popup.
- Added compact popup speed controls.
- Reduced radius, shadow, border drama, and fake depth.
- Shortened popup copy.
- Preserved all core extension systems from the previous MV3 build.

## Chrome extension architecture

- `manifest.json`: Manifest V3 metadata, permissions, popup, side panel, options page, icons, and service worker.
- `src/background.js`: context menus, page capture coordination, queue writes, badge updates, sleep alarm, and Chrome TTS playback.
- `src/content.js`: selected-text capture, readable page extraction, and current-page context detection.
- `pages/popup.html`, `src/popup.js`, `styles/popup.css`: compact toolbar command surface.
- `pages/sidepanel.html`, `src/sidepanel.js`, `styles/sidepanel.css`: full queue management surface.
- `pages/options.html`, `src/options.js`, `styles/options.css`: voice, behavior, storage, privacy, and keyboard settings.
- `src/shared.js`: storage abstraction, queue normalization, cleanup, segmentation, progress, import/export helpers.

## Permissions used

- `storage`: stores queue, settings, counters, and dictionary locally.
- `contextMenus`: adds right-click capture and queue actions.
- `activeTab`: captures only the active tab after user interaction.
- `scripting`: injects the local content script into the active tab for capture.
- `sidePanel`: opens the full queue manager beside the current page.
- `tts`: plays queued text through Chrome text-to-speech.
- `alarms`: supports sleep timer behavior.

The extension does not request `<all_urls>` and does not declare host permissions.

## Storage approach

QueueTTS uses `chrome.storage.local` under the key `queuetts:v2`.

Stored data includes queue items, local metadata, playback position, settings, pronunciation dictionary, and daily counters.

No data leaves the browser.

## Capture behavior

- Selected text is preferred when available.
- Page capture extracts visible readable text from the current tab.
- Browser-restricted pages fall back to paste.
- Failed or short captures can be repaired from the side panel preview/edit flow.
- Cleanup removes common page chrome and bad accessibility fragments such as avatar, icon, logo, and navigation labels.

## Playback behavior

Playback uses `chrome.tts` from the background service worker.

The popup, side panel, and options page read the same local state. The popup shows playback controls only when there is a playable item.

## Known browser limitations

Chrome blocks capture on internal pages, extension pages, the Chrome Web Store, and other restricted surfaces.

Voice availability and background speech continuity depend on Chrome and the operating system.

## Files changed

- `pages/popup.html`
- `styles/popup.css`
- `src/popup.js`
- `styles/base.css`
- `manifest.json`
- `package.json`
- `package-lock.json`
- `README.md`
- `CHANGELOG.md`
- `REBUILD_NOTES.md`

## Tests run

- `npm run check`
- `npm run build`
- JavaScript syntax validation through the project check script
- Manifest validation through the project check script
- Required-file validation through the project check script
- Extension asset reference validation through the project check script
- Final ZIP structure validation

## Manual QA checklist

- Load unpacked extension in Chrome.
- Open toolbar popup with an empty queue.
- Confirm capture is primary and playback controls are hidden.
- Open a normal webpage and add the current page.
- Select text on a webpage and add the selection.
- Right-click selected text and add it through the context menu.
- Open paste with `P` and add pasted text.
- Open command palette with `Ctrl/Command + K`.
- Play/pause with Space.
- Move previous/next segment.
- Move previous/next item.
- Open side panel queue.
- Search queue.
- Edit, duplicate, delete, reorder, and retry items.
- Change voice and speech rate in options.
- Export and import backup JSON.
- Clear completed items.
- Reset all data.
- Reload Chrome and confirm persistence.
- Test an unsupported tab and confirm paste fallback.
- Navigate popup with keyboard and confirm visible focus.
- Enable reduced motion and confirm motion is restrained.
