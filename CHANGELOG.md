# Changelog

## Unreleased

### Fixed

- Sentence splitting handled "etc.", "Inc.", "a.m." and "no." at a sentence end, and long CJK text without spaces.
- Shortened URLs kept the punctuation that follows them.
- Import validated files, rejected newer versions, accepted version 2 backups and sent large files in batches.
- Migration from 2.x kept items with numeric or duplicate ids.
- Extraction fell back to the visible-DOM extractor when Readability throws.
- The sample article named the correct add shortcut.

### Changed

- Split the service worker into modules, removed duplicated UI code and documented tuning constants in [docs/architecture.md](docs/architecture.md).

## 3.1.0

### Added

- An About section in Settings with version, diagnostics and the latest speech start-up timing.
- Voice labels (standard, enhanced, online), per-language voice preference with fallback, and a voice choice on the first-run page.

### Changed

- The side panel became one workspace with the current article, queue, listened items and read-along; the popup shared its player.
- Speed and voice moved to popovers with presets and previews.
- Speech started sooner: opening the popup or side panel loads the voice in advance, and *Playing* appears at the first spoken word.
- Dates, number ranges and common abbreviations were read naturally; emoji were dropped.

### Fixed

- Wireless headsets no longer dropped the first words when their audio link woke up.

## 3.0.0

Rebuilt the extension around the queue and a player whose state survives worker and browser restarts.

### Added

- Resume from the saved sentence after a pause, a Chrome restart or a suspended worker.
- Structured article capture with Mozilla Readability and adapters for Wikipedia, GitHub and MDN.
- Reading view, light and dark themes, and global shortcuts to add a page and to play or pause.
- Queue reordering by drag or keyboard, search, undo for removals and a History list.
- Automatic migration of 2.x queues and settings.

### Changed

- Adding a page while listening no longer interrupted playback.
- Headings got a pause instead of an announcement; code, citations, URLs and page clutter were left out; pages without article text were declined.
- Article text was stored per item, and `unlimitedStorage` removed the 10 MB limit.

### Fixed

- Speech errors fell back to the automatic voice once, then showed *Try again*; adding a page twice no longer duplicated it.

### Removed

- Command palettes, focus mode, duplicating items, summary tiles, the seek buttons, the raw dictionary editor, the language hint and the reduce-motion switch (the system setting is used instead).

## 2.4.0

- Reorganised Settings into sections and made pronunciation rules an editable list.

## 2.3.0

- Rebuilt the popup at a fixed width; queue rows showed their source.

## 2.2.0

- First Chrome extension release, replacing the earlier web app.
