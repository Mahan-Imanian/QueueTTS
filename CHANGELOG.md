# Changelog

## 2.1.0

- Rebuilt the toolbar popup into a compact, queue-first Chrome extension surface.
- Removed gradient CTA styling, heavy glass panels, excessive radii, and decorative glow patterns.
- Added current-tab context state with page title, domain, and selected text count.
- Made the primary capture action context-aware: selected text when available, page capture otherwise.
- Collapsed Quick Paste behind an explicit action to prevent popup clipping and visual overload.
- Added queue count, source/domain metadata, elapsed/remaining playback time, voice/rate display, and up-next preview.
- Clarified transport controls with Back and Next labels for segment movement.
- Added active-tab context probing via the content script and background service worker.
- Added cleanup for common extracted accessibility junk such as avatar/logo/icon-only text.
- Flattened the design system into a restrained dark utility interface with solid accents and stricter spacing.
- Updated README and rebuild notes with testing and permission details.

## 2.0.0

- Converted QueueTTS from a static local web app into a Manifest V3 Chrome extension.
- Added popup, side panel, options page, service worker, content script, context menus, Chrome storage, Chrome TTS playback, local import/export, and extension icons.
