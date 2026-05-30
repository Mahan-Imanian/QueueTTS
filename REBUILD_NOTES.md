# QueueTTS Chrome Extension Rebuild Notes

## Summary

QueueTTS was rebuilt from a local static web app into a Manifest V3 Chrome extension. The extension now supports toolbar capture, context-menu capture, selected-text capture, current-page extraction, side-panel queue management, Chrome text-to-speech playback, local extension storage, settings, import/export, privacy copy, and extension-specific QA notes.

## Brutal audit of the previous app

### Visual polish

The previous version looked like a polished standalone dashboard, but it was not extension-native. It spent too much space on hero presentation and marketing-style layout instead of fast capture and listening controls.

### Information architecture

The app mixed capture, playback, settings, statistics, command menu, and large decorative sections into one page. It did not prioritize the real extension jobs: capture fast, play fast, fix bad extraction, manage the queue.

### Extension usefulness

It was not a Chrome extension. It had no manifest, no popup, no side panel, no service worker, no content script, no context menus, and no extension storage. Users had to run a local web page, which violated the core product promise.

### Empty states

The empty queue state explained that text could be added, but it did not point users toward browser-native capture paths because those paths did not exist.

### Button hierarchy

The previous interface had many equal-weight controls. Important actions such as play, add selected text, add current page, and open queue were not organized by extension usage frequency.

### Typography

Typography was visually refined but too spacious and web-landing oriented for a narrow extension surface. The rebuilt UI uses tighter hierarchy, shorter labels, and denser cards.

### Spacing

Desktop spacing was generous, but extension surfaces require narrow vertical density. Popup and side panel layouts were rebuilt around limited width and predictable scan paths.

### Responsiveness

The prior app responded like a webpage, not like a popup or side panel. The rebuilt extension has dedicated popup, side panel, and options layouts.

### Accessibility

The prior app included some semantic structure, but extension controls needed clearer labels, focus states, status badges, live playback feedback, and keyboard-first interactions.

### Keyboard support

The command menu existed, but the product was not extension-native. Keyboard support now maps to real queue and playback actions in the side panel.

### Error handling

URL fetching in a static web app was fragile because of browser CORS. The extension now uses user-triggered active tab capture and shows recovery paths for restricted pages or weak extraction.

### Settings overload

The previous settings were part of the main app. The rebuild separates daily queue use from options, with common settings, advanced dictionary controls, storage controls, privacy copy, and shortcuts.

### Queue usability

Queue cards needed clearer source metadata, item states, repair flows, and faster actions. Queue items now show source type, source host, date, word count, listening estimate, and state.

### Playback ergonomics

Playback was surface-bound to the local page. The rebuild centralizes playback in the background service worker with `chrome.tts`, so popup and side panel controls coordinate through extension messages and shared state.

### First-run experience

The prior app had no extension onboarding. The rebuilt side panel introduces local-first behavior, capture paths, and privacy in the first-run card.

### Chrome extension permission clarity

The previous project had no permission model. The rebuilt options page and this document explain every permission in plain language.

### Trust and privacy

The prior app said local-first, but it was not integrated with extension storage. The rebuilt app stores data in `chrome.storage.local`, avoids remote scripts, avoids accounts, avoids analytics, and explains what is stored.

### Performance

The previous app used a large single-page interface. The rebuild uses small dedicated surfaces, no framework runtime, no remote dependencies, minimal DOM mutation, and practical text extraction.

### Code maintainability

The previous version was a standalone app. The rebuild separates shared state, background coordination, content capture, popup UI, side panel UI, options UI, styles, and validation checks.

## Chrome extension architecture

- `manifest.json` defines a Manifest V3 extension.
- `src/background.js` is the service worker for context menus, active-tab capture coordination, queue insertion, playback control, sleep timer alarms, and badge state.
- `src/content.js` is a programmatically injected content script used only after user-triggered capture.
- `pages/popup.html` and `src/popup.js` provide the toolbar mini player and fast capture actions.
- `pages/sidepanel.html` and `src/sidepanel.js` provide the main queue manager, capture preview, focus mode, command menu, queue search, filters, edit, duplicate, delete, reorder, and recovery flows.
- `pages/options.html` and `src/options.js` provide voice, playback, behavior, pronunciation, storage, privacy, and shortcut settings.
- `src/shared.js` owns data normalization, queue item creation, text cleaning, estimates, segmentation, storage helpers, import/export helpers, and summary calculations.
- `styles/base.css`, `styles/popup.css`, `styles/sidepanel.css`, and `styles/options.css` define the dark-first design system and surface-specific layouts.

## Permissions used and why

- `storage`: saves queue items, source metadata, settings, pronunciation replacements, playback position, and daily counters in Chrome local storage.
- `contextMenus`: adds selected-text, current-page, and open-queue actions to the browser context menu.
- `activeTab`: grants temporary access to the active tab after the user invokes the extension through the toolbar or context menu.
- `scripting`: injects the capture script into the active tab after user action.
- `sidePanel`: provides the main extension-native queue manager beside the current page.
- `tts`: speaks queued text through Chrome text-to-speech and allows popup and side panel controls to coordinate playback.
- `alarms`: implements the sleep timer without a server or persistent polling loop.

No host permissions or `<all_urls>` permission are requested. Page capture is user-triggered and uses `activeTab` plus `scripting`.

## Storage approach

QueueTTS uses a single versioned key in `chrome.storage.local`: `queuetts:v2`. Stored data includes queue items, item text, source title, source URL, source type, capture date, word count, listening estimate, item state, current segment index, settings, dictionary, and daily counters.

Data is not sent to a server. Import/export uses local JSON files. Clear-all removes QueueTTS queue data and counters while preserving extension installation.

## How capture works

Selected-text context menu capture uses Chrome's `selectionText` value, then stores it as a queue item with source page metadata.

Popup and side panel selected-text capture use user-triggered active-tab script injection. The content script reads `window.getSelection()` and returns selected text plus page title and URL.

Current-page capture injects `src/content.js` into the active tab, clones candidate article/main content, removes common noisy selectors, scores likely readable regions, extracts headings, paragraphs, list items, blockquotes, captions, and table text, then returns a quality label. The side panel shows a preview/edit step before adding. The popup and context menu use one-click capture and store failed extraction items with recovery copy.

## How playback works

Playback uses Chrome's `chrome.tts` API from the background service worker. Text is split into sentence-like segments. The service worker speaks one segment at a time, updates `chrome.storage.local`, responds to popup and side panel commands, moves between items, marks completion, and updates daily counters.

Pronunciation replacements are applied immediately before speech. Voice, language, rate, pitch, and volume are read from settings. Sleep timer uses `chrome.alarms` and stops playback when the alarm fires.

## Known browser limitations

Chrome blocks script injection on restricted pages such as `chrome://` URLs, the Chrome Web Store, internal browser pages, and pages blocked by enterprise policy. QueueTTS reports these failures and asks users to select text or paste manually.

Article extraction is practical, not perfect. Some sites use aggressive client-side rendering, paywalls, shadow DOM, canvas, or unusual markup that may reduce capture quality. The side panel preview/edit step exists to repair captures before adding.

Chrome text-to-speech voices vary by operating system, installed voices, browser profile, and enterprise policy. Some voices may be remote voices exposed by Chrome. QueueTTS lists what Chrome reports.

## Files changed

- Added `manifest.json`.
- Added `src/background.js`.
- Added `src/content.js`.
- Added `src/shared.js`.
- Added `src/popup.js`.
- Added `src/sidepanel.js`.
- Added `src/options.js`.
- Added `pages/popup.html`.
- Added `pages/sidepanel.html`.
- Added `pages/options.html`.
- Added `styles/base.css`.
- Added `styles/popup.css`.
- Added `styles/sidepanel.css`.
- Added `styles/options.css`.
- Added extension icons in `assets/icons`.
- Replaced README with extension loading and usage instructions.
- Added `REBUILD_NOTES.md`.
- Added `scripts/check.mjs`.
- Updated `package.json`.
- Removed the old static web-app shell and orphaned standalone assets.

## Tests run

- `npm install --package-lock-only`
- `npm run check`
- `npm run build`
- JavaScript syntax checks through `node --check` for all source files.
- Manifest validation for MV3, popup, side panel, options page, service worker, required permissions, and required assets.
- Static validation for local asset references and absence of remote script references.
- Chromium unpacked-extension smoke launch with `--load-extension`.

## Manual QA checklist

- Load unpacked extension from the project folder.
- Confirm toolbar icon appears.
- Open popup.
- Open side panel/full queue.
- Add selected text from a webpage.
- Add current page from popup.
- Add current page from context menu.
- Add pasted text from popup.
- Add pasted text from side panel.
- Play and pause.
- Previous and next item.
- Previous and next segment.
- Skip forward and backward.
- Change voice.
- Change rate.
- Set sleep timer.
- Edit queue item.
- Duplicate queue item.
- Delete queue item.
- Reorder queue item.
- Search queue.
- Export data.
- Import data.
- Clear completed.
- Clear all data.
- Reload extension and confirm queue persistence.
- Test empty queue state.
- Test failed extraction on a restricted page.
- Test a long article.
- Test small popup layout.
- Test narrow side panel layout.
- Test keyboard navigation.
- Test reduced motion.
- Check service worker, popup, side panel, and options consoles for errors.

## Features intentionally removed or replaced

The standalone local web app hero page was removed because it was not useful inside an extension. Its core capabilities were preserved as extension surfaces: popup for fast capture/playback, side panel for daily queue management, options for settings, and content script capture for browser text.

The old URL fetch model was replaced by user-triggered active-tab extraction. This avoids CORS failure paths and better matches how users capture the page they are already reading.

The prior decorative dashboard metrics were replaced with compact queue, time, completion, and storage summaries tied to actual local state.

## Design self-review

- Visual polish: 9.0
- Extension-native usefulness: 9.0
- Queue usability: 9.0
- Playback ergonomics: 8.8
- Capture flow: 8.8
- Accessibility: 8.7
- Responsiveness: 9.0
- Permission/privacy trust: 9.4
- Code maintainability: 8.8
- Production readiness: 8.7
