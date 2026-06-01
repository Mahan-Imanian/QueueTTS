# Changelog

## 2.4.0

- Reworked the settings page from a marketing-style dashboard into an operational configuration surface.
- Replaced the oversized settings hero with a compact live status strip for voice, queue, storage, and local privacy state.
- Added sticky settings navigation for Voice, Queue, Pronunciation, Storage, Privacy, and Shortcuts.
- Converted the pronunciation dictionary from a raw textarea-first control into a structured rule editor with inline add, edit, delete, and test actions.
- Added voice preview controls and live range values for rate, pitch, and volume.
- Reframed permissions as live permission rows with why-needed explanations and current role labels.
- Moved destructive storage reset into a separated danger zone with stronger confirmation copy.
- Tightened semantic color use: teal for active/primary, violet for voice tuning, blue for source/info, amber for attention, rose for destructive/error.
- Hid the active item from popup queue preview to avoid repeating the now-playing item.
- Updated documentation and rebuild notes for the latest human-expert critique pass.

## 2.3.0

- Rebuilt popup as a compact Chrome-extension command remote.
- Eliminated popup horizontal overflow risk with fixed-width popup density and contained controls.
- Made capture the dominant empty-state workflow.
- Hid playback deck when no queue item exists.
- Replaced generic card stack with fewer, sharper surfaces.
- Added source glyphs and richer source metadata to queue rows.
- Added extraction quality metadata preservation.
- Redesigned failed captures as repair-first queue rows with review and retry paths.
- Converted boxed metrics into a compact live status strip.
- Reduced teal overuse with stronger semantic color tokens.
- Added atmospheric but restrained dark surface system.
- Improved desktop side panel layout with primary playback column and capture rail.
- Collapsed secondary queue actions behind hover/focus affordances on larger layouts.
- Updated README and rebuild notes for the latest product direction.

## 2.2.0

- Rebuilt QueueTTS into a Manifest V3 Chrome extension.
- Added toolbar popup, side panel, options page, content capture, background service worker, context menus, icons, and local storage persistence.
