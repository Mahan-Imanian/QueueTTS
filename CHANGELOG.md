# Changelog

## 2.2.0

- Rebuilt the popup as a compact queue command center.
- Removed the stacked-card empty state and repeated zero-value metrics.
- Hid full playback controls when the queue is empty.
- Replaced full-width Back and Next controls with a compact transport row.
- Made capture the primary empty-state workflow.
- Added context-aware primary action behavior for selected text, current page, and paste fallback.
- Added popup command palette with capture, queue, playback, and settings actions.
- Added visible shortcut hints through command behavior and compact copy.
- Added compact speech-rate controls in the popup.
- Tightened popup spacing, radius, borders, hierarchy, and copy.
- Reduced decorative surface effects and fake premium styling.
- Strengthened unsupported-tab recovery with direct paste fallback.
- Preserved side panel queue management, context menus, local storage, import/export, pronunciation dictionary, focus mode, and Chrome TTS playback.

## 2.1.0

- Converted QueueTTS into a Manifest V3 Chrome extension.
- Added toolbar popup, side panel, options page, service worker, content script, context menus, and extension icons.
- Added local-first queue persistence through `chrome.storage.local`.
- Added browser text-to-speech playback through `chrome.tts`.
