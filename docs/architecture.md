# Architecture

QueueTTS is intentionally static and dependency-free.

## Runtime layers

- `index.html` defines the complete accessible application shell.
- `assets/css/app.css` provides the design system, responsive layout, motion, focus styles, and component styling.
- `assets/js/app.js` owns state, queue operations, speech playback, URL extraction, local persistence, dialogs, keyboard shortcuts, and rendering.
- `assets/img/mark.svg` provides the product mark.

## Data flow

1. The user adds text through paste or URL fetch.
2. Text is normalized, titled, segmented into heading-aware speech units, and inserted into the local queue.
3. Playback uses `SpeechSynthesisUtterance` for each speech unit, with estimated timelines for progress and seeking.
4. Queue, preferences, sleep timer, and current position are persisted in `localStorage`.
5. UI is re-rendered from the single in-memory state object after each state transition.

## Constraints

QueueTTS has no backend, account system, analytics, or remote persistence. Browser CORS rules may prevent URL extraction for some sites; paste mode remains the reliable path.
