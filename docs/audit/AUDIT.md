# QueueTTS v2.4.0 — AAA Product Audit

Audited 2026-10-04. Repository `Mahan-Imanian/QueueTTS` at `ae166e7`, cloned to `D:\just-temp\QueueTTS`.

**How it was tested**
- Loaded as an unpacked extension in Chrome 142 (Windows 11) and driven by automation.
- Tested on a realistic news-article fixture and on live pages: Wikipedia, paulgraham.com, MDN and GitHub.
- 22 voices were available (Microsoft SAPI plus Google network voices).
- Every claim below is tagged **[verified]** (reproduced in the running extension) or **[code]** (read from source, not reproduced). Screenshots are in `shots/`.

> **Test caveat.** Programmatic `chrome.action.openPopup()` does not grant `activeTab`, so capture tests used a copy of the extension with `host_permissions: <all_urls>`. That copy behaves the same as a real toolbar click. The shipped extension in the repo was not modified.

---

## Executive Verdict

QueueTTS is not failing because it looks generic. It fails because **its one job, playing a queue of text reliably, does not work**, and the UI piled on top of that broken loop is template filler.

Three bugs I reproduced each make the product untrustworthy on their own:

1. **Saving something while you listen breaks playback.** Capturing a selection mid-playback silently kills the article that was playing. The new capture is then marked *completed* without a single word being spoken, and its estimated time is credited to "listened" stats. [verified]
2. **Pausing for more than about 30 seconds kills the player.** Chrome terminates the service worker. After Resume the UI shows "Playing" but audio never advances again. [verified]
3. **After a browser restart, the first Play press does nothing.** The persisted state still says "playing", so the button toggles to pause. [verified]

The content pipeline is equally broken:
- On a Paul Graham essay, **300 of 809 spoken segments begin with the word "Heading."** in the middle of a sentence.
- On MDN and GitHub, page capture returns **zero words**.
- On Wikipedia it reads the citation markers and the category footer.

[verified]

Then the surface:
- Every section of the UI has an uppercase letter-spaced kicker label.
- Mint/teal/violet radial glows sit on near-black.
- There are two command palettes for fewer than 12 actions.
- A "Trust" panel repeats the privacy message in three places.
- A permissions table in Settings is dressed up as a feature.
- The light theme is unreadable.
- The checkboxes render as grey 40-pixel slabs.

The repo history shows the cause. There are six rounds of "Update QueueTTS project files", each a "critique pass" (`REBUILD_NOTES.md`: *"applies the latest product-design critique"*). Each pass restyled the surface and none of them tested the playback loop.

**Overall AAA readiness: 2.8 / 10.** Privacy is the one area that is genuinely acceptable.

---

## What the Product Is Today

**Stated purpose.** A local-first MV3 extension that captures selected text, a whole page, or pasted text into a queue. Playback uses `chrome.tts` from the service worker.

**Three surfaces:**
- A 392px toolbar popup ("command remote").
- A side panel or tab ("full queue").
- An options page.

**What a real user experiences**

1. **Install.** Nothing happens: no welcome page and no pin prompt. `onInstalled` only builds the context menus. The onboarding card exists only inside the side panel, which nobody opens first. [code]
2. **Open the popup on an article** (`01-popup-first-run.png`).
   - A context bar repeats the page title.
   - A "READY / Capture this page." card has a big mint button, plus "No selection" (disabled), "Paste" and "⌘K" on Windows.
   - A footer row reads "Default voice · 1×" with speed chips **.9× / 1× / 1.15×**, so the top popup speed is 1.15×.
3. **Click "Add this page"** (`02-popup-after-capture.png`).
   - The popup grows from 371 to 560px.
   - The capture card **stays on top** and still offers "Add this page" for the page you just added.
   - The player appears below it, labelled **"NOW PLAYING … Idle"**.
   - The first spoken line is "Heading. Why Cities Are Rethinking the Night Bus."
   - A toast covers the footer.
4. **Press Play.** It speaks in a Microsoft David/Zira system voice. Each sentence is a separate utterance. Highlighting only shows in the panel's text box; nothing happens on the page.
5. **Keep browsing and capture something else.** Playback dies (see Executive Verdict).
6. **Open the side panel** (`10`, `11`). A 1,437px-tall scroll of modules (sizes are CSS pixels at a 380px-wide panel):

   | Module | What it shows |
   |---|---|
   | Onboarding | Welcome card |
   | Empty player | Five glyph buttons and four seek chips |
   | Capture tabs | Page / Selection / Paste |
   | Search box | — |
   | Filter chips | Five chips |
   | Summary tiles | "ITEMS 0 · QUEUED 0 · TIME 0:00" |
   | Empty state | Another "Capture current page" button |
   | Trust panel | Privacy reassurance |

7. **Look at the queue rows.** Each row shows a letter avatar, the title, the host, "page · 294 words · 1:39 · captured 10/4/2026", "readable", a three-line text clamp, and **six buttons**: Play, Edit, Duplicate, ↑, ↓, Delete.
8. **Open Settings** (`21`). A status strip, seven nav links, voice sliders, giant grey checkboxes, a pronunciation rule editor, "23,439 B" storage, a table of seven permissions, and a shortcut table.

The honest one-line description of today's product: **a single-page system-voice reader with a list attached, which breaks if you use the list.**

---

## Why Users Do Not Keep Using It

| Question | Honest answer today |
|---|---|
| Why install? | The Web Store pitch ("capture, queue, listen with browser TTS") describes what Chrome Reading Mode and Edge Read Aloud already do for free, with better voices and on-page highlighting. |
| Why keep it? | No reason. Nothing accumulates value: no library, no position memory that survives a pause, no history view, no mobile. |
| What recurring problem does it solve? | It *could* solve "I have 12 tabs of articles I'll never read, and I want them to play in order while I cook". Today it does not, because the queue does not advance reliably. |
| Better than Chrome? | No. Chrome Reading Mode (Alt+Shift+R) has natural voices, word/sentence highlighting, and a voice picker with previews. |
| Core loop | It should be: *see article → one keystroke to queue → it plays later in order, resuming where you left off*. The current loop is: open popup → add → play → (it breaks). |
| "Aha" moment | There is none. The only candidate, hearing the next article start automatically, is destroyed by the capture-hijack bug. |
| Habit / retention | None. Daily stats are collected and never shown, apart from "N captured today". |
| Memorable | No. The icon is a generic play triangle. |
| Premium | No. Text-glyph controls, robotic default voice, a 1.15× speed ceiling in the popup. |
| Disposable | Yes, on every axis. |

**The fundamental product problem.** QueueTTS positions itself as a *reader*, which is a solved, commoditised category, instead of a *queue*. The queue is the only wedge no free competitor offers, and it is the part that is broken.

---

## Visual/UI Audit

### Identity

**Icon** (`assets/icons/icon-*.png`)
- A flat mint triangle and an amber arc on a black rounded square. At 16px it reads as "a media player". It is indistinguishable from dozens of video and audio extensions.
- The PNG icon does not match the in-app SVG mark, which has a gradient square and a gradient stroke. There are two different logos.
- *AAA:* one mark built for 16px first. For example, a short stack of three lines with the top one becoming a sound wave ("queue + voice"), drawn on a 16px grid, solid fill, no gradients.

**Wordmark**
- "QueueTTS" next to a kicker that changes per surface: "Private speech queue", "Local speech queue", or none in the popup. "TTS" is jargon in a consumer product name.

**Colour**
- The palette is teal `#4ee3d1` + violet `#9b6cff` + blue `#72b7ff`, with radial glows (`base.css:96–99`) and a teal→blue gradient progress bar (`base.css:447`).
- That combination is the default "dark AI SaaS" palette. Nothing in it is about listening or reading.
- *AAA:* one ink colour plus one accent used only for "the thing playing now". Neutral surfaces. No glows.

**Typography**
- The font is declared as `Inter, ui-sans-serif…`, but **Inter is not bundled**, so Windows users see Segoe UI.
- Six font weights are specified (680/690/700/720/760/780). Segoe UI renders all of them as the same Bold, so the hierarchy collapses into one heavy weight everywhere (visible in `11`).
- Kicker labels are 10px uppercase with 0.11em tracking, on **every** section.

**Surfaces**
- Every module is a bordered 12px-radius panel over a slightly different near-black (`--surface-1/2/3/inset`, plus the hard-coded `rgba(13,17,24,.88)` family).
- The result is cards inside cards: the segment card inside the now panel inside the page; the meta tiles; the "Repair path" box inside the failed card.

**Radius**
- Seven radius tokens plus three literals (6/8/9/10/12/16/20/999). There are four visibly different corner radii in one popup.

### Screen by screen

| Where | What's wrong | Why it reads amateur | AAA instead |
|---|---|---|---|
| Popup, after capture (`02`) | The capture card stays above the player. The primary CTA offers to re-add the page already queued. | The hierarchy ignores state; the most important object (what's playing) sits in the middle. | **State-driven popup.** When something is playing, the player is the top half. The capture action becomes a single row: "Queue this page · 6 min". If the page is already queued, it shows "In queue · #3". |
| Popup player | "NOW PLAYING" next to an "Idle" badge. | The copy contradicts itself. | Label by state: "Up next" when idle, "Playing" when playing, "Paused · 2:14 left" when paused. |
| Popup transport | `‹ − ▶ + ›` text glyphs at 34px. "−/+" mean previous/next *sentence*. | The glyphs don't explain themselves, and the font renders them with uneven optical weight. | An SVG icon set with consistent stroke: back 1 sentence, play/pause (morphing), forward 1 sentence. Item skipping goes in the list. |
| Popup speed chips | .9× / 1× / 1.15×, flush against the right edge (`01`). | Listening power users run at 1.5–2.5×, so the most-used control is missing. | A speed stepper (−/value/+) from 0.75 to 3× in 0.1 steps, plus Shift+scroll on the value. |
| Popup "⌘K" button | A Mac glyph on Windows, opening a palette of seven commands in a 392px popup. | The palette exists because it looks sophisticated, not because seven commands need searching. | Remove. |
| Popup toast | Covers the footer controls (`02`, `07`). | The toast is layered over interactive UI. | Confirm inline in the row that changed ("Queued ✓ Undo"). |
| Popup failed capture (`07`) | A failed capture becomes **"NOW PLAYING: Dashboard – Acme · 0 words · Paused"**. | A broken item is promoted to the hero slot. | Failed captures never become current. Show an inline "Couldn't read this page — Select text, then queue" with a link to the reason. |
| Side panel first run (`10`) | Eight stacked modules; three CTAs with the same intent ("Capture current page" ×2, "Preview current page"); 0/0/0:00 tiles; an empty player with every control live. | Rendering every module regardless of state is the clearest template tell. | Empty panel = one illustration-free sentence, one button, and the shortcut hint. Nothing else until there is content. |
| Side panel rows (`11`) | Six buttons per row; three metadata lines; "readable" on healthy items; "page"/"paste" as raw enum strings; a three-line preview of the article's first sentence. | Low density, high noise. Raw internal values leak into the UI. | One-line rows: favicon · title · source · remaining time. Hover/focus reveals ⋯. Drag handle. Swipe or Delete key to remove, with undo. |
| Side panel letter avatars | "M", "N", "P", "R": the first letter of the host. | A generic dashboard placeholder for a missing favicon. | The real favicon (`chrome://favicon2` or `_favicon/` API, which needs the `favicon` permission). |
| Side panel "Focus mode" (`16`) | A modal that repeats the current sentence already shown in the segment card. | Adds nothing; a feature that exists only because it was easy to generate. | Replace with a real **transcript view**: the full text, current sentence highlighted, auto-scroll, click any sentence to jump. |
| Side panel summary tiles | ITEMS / QUEUED / TIME. | Boxed metrics with no decision attached. | Fold into the list header: "Up next · 4 items · 41 min". |
| Side panel trust panel | "Local by default" card at the bottom of the queue. | Over-reassurance reads as insecurity. | One line in Settings → Privacy. |
| Settings (`21`) | Status strip (Voice/Queue/Storage/Privacy). "Storage 23,439 B". The "6 items · 1…" value is truncated. | Fake-dashboard chrome on a settings page. | Remove the strip. Show storage as "6 articles · 140 KB" inside Data. |
| Settings checkboxes (`21`) | `input{width:100%;min-height:40px;background}` in `base.css:333–347` also hits checkboxes, so they render as **40×40 grey slabs** next to centred two-line labels. | A broken base style; visible in the first screenshot anyone takes. | Scope the input styles to text-like inputs and use a proper switch. |
| Settings permission table | Seven rows of `storage / activeTab / …` with chips like "Browser native" and "Chrome UI". | Developer documentation presented as a feature. | One sentence: "QueueTTS reads a page only when you ask. Text stays on this device." Plus a link to a privacy page. |
| Light theme (`18`) | **Broken.** `sidepanel.css`, `popup.css` and `options.css` hard-code dark `rgba(13,17,24,…)` surfaces, so `--text:#111722` lands on near-black. The title and current sentence are unreadable. | It was never looked at. | Tokens only; no literal colours in component CSS. Follow `prefers-color-scheme` by default. |
| Badge | Background `#8ee8c8` (light mint) with Chrome's white badge text. | Unreadable. | Dark badge colour, or no count. A "▶" or "‖" badge while playing is more useful than a pending count. |

---

## UX Audit

**Information architecture.** There are three surfaces with overlapping, inconsistent jobs:

| Action | Popup | Side panel | Options |
|---|---|---|---|
| Capture page | Adds immediately | Opens a preview modal first | — |
| Paste | Drawer | Tab | — |
| Import / export / clear | — | Yes | Yes (different semantics) |
| Speed | 3 chips | — | Slider |
| Sleep timer | — | Select | "Default" select that actually starts a live timer |

**Specific UX defects**

- **Capture inconsistency.** The popup adds immediately. The side panel forces a review modal with a 14-row textarea before adding. The context menu adds immediately **and force-opens the side panel every time** (`background.js:368–378`) [code]. Queuing "for later" should never open anything.
- **Queue order is inverted** [verified]. New items go to the **top** (`shared.js:213`). Auto-advance goes **down** (`background.js:247`). Every capture is also *activated* (`activate:true`) and hijacks the now-playing pointer.
  - There is no "Up next" concept and no "play next / play last" choice.
  - Result: the list order means nothing to the user.
- **Retry on a failed item re-captures the *active tab*, not the item's URL** (`sidepanel.js:331`) [code]. If you've moved on, "Retry" captures a different page into the edit modal.
- **±15s/±30s seek is fictional** [verified/code]. It walks a word-count estimate (178 wpm) and snaps to sentence boundaries. "+15s" can jump zero sentences or three.
- **Duration estimates disagree.** The same item shows **2:57** in the player and **2:23** in the list. The player sums per-sentence estimates with a 4-second minimum each (`shared.js:61`); the list uses the whole-item estimate. [verified]
- **The sleep timer "default" in Settings is a live timer.** Changing *any* setting calls `QTTS_SLEEP`, which restarts the alarm even when nothing is playing (`options.js:167`). [code]
- **Destructive actions** [code]:
  - Delete has no undo.
  - Import silently replaces the whole queue in Options (`writeState`) but merges settings in the side panel.
  - "Clear queue" in the side panel keeps stats; "Clear all" in Options wipes them.
- **The error copy dumps platform messages.** "Cannot access contents of the page. Extension manifest must request permission to access the respective host." appears verbatim in the popup context bar. [verified, programmatic-open case]
- **Onboarding is in the wrong place.** It sits in the side panel, which first-time users never open, and teaches nothing about the queue.

---

## Functionality Audit

**Broken or unreliable** (all reproduced unless marked)

1. Capturing during playback hijacks the queue and completes the new item unspoken.
2. Resume after a pause longer than about 30s stalls (service worker killed; the in-memory `onEvent` closure and `activeSpeakToken` are lost).
3. "Playing" status persists across restarts, so the first Play press is a no-op.
4. Heading detection (`shared.js:236–246`) treats any short line with a capital and no terminal punctuation as a heading. Results:
   - 300 of 809 segments on a Paul Graham essay start with "Heading.".
   - "Heading. The cities that have succeeded share a few common choices:." in the fixture.
   - The default mode is `cue`, so it is on for everyone.
5. The sentence splitter breaks on "Dr." ("Dr." / "Samuel Reyes…" as separate utterances).
6. Extraction:
   - **0 words on MDN and GitHub.** The likely cause is `BAD_PATTERN` substring-matching class names: `ads` matches "headings"/"downloads", and `header`/`menu`/`share` match layout wrappers. Not confirmed per-element.
   - Wikipedia comes out at 10,313 words, including the reference list, citation markers ("[1]") and maintenance categories.
   - On PG, `<br>` breaks produce mid-sentence line splits and glued words ("July 2023If", "it.Partly").
   - Bylines and photo credits are read aloud.
7. Volume 0 and pitch 0 are impossible: `Number(0) || 1` in `normalizeState` (`shared.js:179–180`).
8. "Listened" stats are credited on completion even when skipped or never spoken. Day keys use UTC (`toISOString`), so they are off by a day in UTC+ evenings.

**Missing (the things that create real value)**

- **A global keyboard shortcut** (no `commands` in the manifest). You can't queue a page or pause without opening UI. Every competitor has one (Edge Ctrl+Shift+U, Read Aloud Alt+P, Chrome Alt+Shift+R).
- **On-page follow-along.** `chrome.tts` emits `word` events (verified: start, sentence, word×5, end), and the extension ignores them. Chrome, Edge, Speechify and Read Aloud all highlight on the page.
- **Click-to-read-from-here** on the page or in a transcript.
- **Reliable resume:** position per item that survives pause, restart and service-worker death.
- **Real queue semantics:** Up next / Play next / Play last, drag reorder, auto-advance, a done/history archive, auto-clear finished items.
- **Duplicate detection** (the same URL can be queued twice; the popup offers it).
- **Per-site handling:** the language from `<html lang>`, voice auto-selected to match.
- **Speed range in the main UI** (0.75–3×) and remembered per voice.
- **PDF support** (every competitor has it). Optional, Phase 4.

**Superficial or redundant (exists because it was easy to generate)**

- Two command palettes.
- Duplicate item.
- Focus mode.
- Summary tiles.
- Trust panels.
- Permission table.
- Status strip.
- The "Advanced raw dictionary" next to the structured editor.
- A reduce-motion toggle that duplicates the OS setting.
- A "Language hint" free-text field.
- A "quality" label on every healthy row.
- The daily stats store that nothing reads.

---

## Chrome Extension Audit

| Area | Finding |
|---|---|
| MV3 / service worker | **State lives in SW memory.** `pauseTimer`, `intentionalStop` and `activeSpeakToken` are module globals (`background.js:20–22`), and so is the `onEvent` closure per utterance. When the SW sleeps (after 30s idle, e.g. while paused) all of it is lost. Resume calls `chrome.tts.resume()` on an utterance whose listener no longer exists. [verified] |
| Startup | `onStartup` only sets the badge. It never resets `playback.status`, so stale "playing" survives restarts. [verified] |
| Permissions | Minimal and sensible: `activeTab` + `scripting`, no host permissions. But `scripts/check.mjs:38–40` **fails the build if any permission is removed**, which inverts permission minimisation. `alarms` exists only for the sleep timer. |
| Injection | Every popup open runs `executeScript(content.js)` into the active page just to read the selection word count. That leaves a persistent `onMessage` listener and a `window.__QueueTTSCaptureInstalled` global in the page's isolated world. A one-shot `executeScript({func})` returning the selection would do the same with no residue. |
| Messaging | One 20-branch `if` chain. No message validation. `sendResponse` after every `await`. Works, but it's a stringly-typed god-function. |
| Storage | One key holds the whole app, including every article's full text. Each sentence does about 3 full writes and about 7 full reads in the SW, and every read re-runs `normalizeState → cleanText` regexes over **all** text. No `unlimitedStorage`, so the 10 MB quota arrives at about 390 typical articles, and `set()` failures are unhandled. [verified size, code for counts] |
| Concurrency | Read-modify-write races between the SW and the UI pages (e.g. a side-panel edit during a background `markSpeechState` write). The last writer wins, so edits can be lost. [code] |
| Side panel | Falls back to opening `sidepanel.html` in a tab. In that mode, "Capture current page" and "Retry" target the extension tab itself. [code] |
| Context menu | Forces the side panel open on every capture. |
| Google network voices | Listed, and selectable as defaults when Chrome picks them. They send text to Google, which conflicts with the "No backend / local only" claim on three screens, and they are subject to Chrome's ~15s cutoff bug (mitigated by sentence segmentation, but undisclosed). |
| CSP / security | Fine: no remote code, and everything rendered is HTML-escaped. `escapeHtml` in the side panel doesn't escape `'` but is only used in double-quoted attributes. Imported `sourceUrl` can be `javascript:` but MV3 CSP blocks it. Low risk. |
| i18n | None. No `_locales`, English hard-coded, no RTL. |
| Update behaviour | No storage migration path (version is fixed at 3 and normalised blindly). The key is still `queuetts:v2`. |

---

## Performance Audit

Measured in the side panel with N articles of 4,320 words each [verified]:

| Articles | Storage | One sentence-advance write | Queue DOM HTML | Long tasks per sentence |
|---|---|---|---|---|
| 10 | 259 KB | 27 ms | 262 KB | — |
| 60 | 1.55 MB | 114 ms | 1.58 MB | — |
| 300 | 7.77 MB | 509 ms | 7.87 MB | **1.2–1.5 s, every sentence** |

**Why**
- Every storage change triggers a full `innerHTML` re-render of every row.
- Each row escapes and dumps the **entire article text** into a three-line CSS clamp.
- The side panel is therefore frozen roughly 1.3 s out of every sentence of speech once the library is big, and the SW burns CPU re-normalising megabytes per sentence. That costs battery on laptops.

**Small queues are fine.** Popup open was about 0.4–0.5 s, but most of that is a blocking `executeScript` round-trip *before first render* (`popup.js:362–363`, top-level await). The first frame should render from storage immediately and fill in page context after.

**Can this architecture support a polished UI?** No. Not because it is vanilla JS (that is a fine choice), but because of three things:
- the single-blob storage model;
- the render-everything-on-every-write pattern;
- per-sentence full-state writes.

Fixing those three is about 300 lines and makes a 60fps UI trivially achievable without a framework.

---

## Accessibility Audit

- **Focus is destroyed on every sentence** [verified]. A button focused in the queue moves to `<body>` after any storage write, i.e. every sentence while playing. Keyboard and screen-reader users cannot operate the queue during playback. This is the worst accessibility defect.
- **The Escape key leaves focus inside the hidden modal input.** After closing the edit modal with Escape, single-key shortcuts (`f`, `j`, `k`, Space) stop working, because `activeElement` is still an INPUT. [verified: `f` failed to open Focus mode after Escape]
- **No focus trap and no focus return** for the three modals. `aria-modal` is set, but the background stays tabbable. [code]
- **Progress bars have no accessible name.** axe flags `aria-progressbar-name` (serious) on the popup and side panel, and `aria-valuenow` is percent-only with no `aria-valuetext` ("2:14 of 5:00"). [verified]
- **Tab cost:** 6 tab stops per queue row, so reaching item 3 takes about 40 Tab presses. Use one tab stop per row with arrow-key navigation (roving tabindex) and a per-row menu. [verified walk]
- **Live regions.** The segment card is `aria-live="polite"`, so a screen reader announces every sentence *on top of* the TTS speaking it. [code]
- **Glyph buttons** (`‹ − + ›`, `⚙`) have aria-labels (good), but the visible meaning is unclear to sighted users.
- **Contrast.** The dark theme mostly passes. Light theme fails catastrophically (dark surfaces with dark text). The badge fails.
- **Reduced motion.** It respects `prefers-reduced-motion` (good), so the custom toggle is redundant.
- **Shortcut conflicts.**
  - `p` means "paste" in the popup but "previous item" in the side panel.
  - The popup palette advertises J/K, which are not bound in the popup.
  - Single-letter shortcuts with no modifier fire for screen-reader users in browse mode.

---

## Engineering Audit

**Good**
- Zero dependencies.
- Readable modern JS.
- HTML escaping applied consistently.
- `activeTab` instead of host permissions.
- A playback token guards against stale TTS callbacks (in principle).

**Problems**
- **No playback state machine.** The status is spread across `playback.status`, `item.state`, `intentionalStop` and `activeSpeakToken`, mutated from about 10 functions that each re-read storage. That is the root cause of the hijack, stale-status and resume bugs.
- **Single-blob persistence** (see Performance). `normalizeState` runs on every read and doubles as a migration, validator and cleaner, at O(total text).
- **Duplication.**
  - `escapeHtml` ×3 (with different behaviour), `toast` ×3, `setBusy` ×2, command palettes ×2, `exportData`/`importData`/`clearAll` ×2 with *different semantics*.
  - `clean()` and `words()` duplicated between `content.js` and `shared.js`.
  - The storage key is hard-coded again in `background.js:386`.
- **Render model.** String templates plus `innerHTML` plus re-binding listeners per render (popup and options). Keyed updates are needed.
- **Error handling.** `try {} catch {}` swallowing (`background.js:189,201,215`). Storage quota errors are unhandled. `chrome.tts.speak` errors go to `failPlayback`, which marks the item "paused" with an error string the UI barely shows.
- **Dead code.** `QTTS_PROGRESS` is never sent. `stats.days.*` is mostly unread. `QUEUE_STATES` includes states the UI renders as raw enums.
- **Tooling.**
  - `npm run build` is the same lint script.
  - The checker bans the strings "TODO" and "placeholder section" (hiding rather than tracking work) and hard-requires all seven permissions.
  - There are no tests at all, and the playback state machine most needs them.
- **Repo hygiene.**
  - `REBUILD_NOTES.md` and `CHANGELOG.md` are LLM critique-pass logs ("human-expert critique pass", "atmospheric but restrained dark surface system").
  - Six commits are titled "Update QueueTTS project files".
  - The `LICENSE` was deleted (it was 0 bytes).
  - The repo was a GitHub Pages web app until commit `2e7fd87`, replaced wholesale in one commit.

---

## AI-Generated / Generic Patterns

What makes it read as AI-made, and what must be **removed** (not supplemented):

1. **Uppercase micro-kickers on every block:** READY, NOW PLAYING, CAPTURE, TRUST, LOCAL-FIRST, PRIMARY CONTROLS, DEFAULTS, DATA, KEYBOARD, LIVE PREVIEW. Delete all of them; the headings already say it.
2. **The teal + violet + blue palette with radial corner glows and a gradient progress bar.** Delete the glows and the gradient.
3. **Cards in cards.** A bordered panel for every module, a segment card inside the now card, meta tiles, a repair box inside a failed card.
4. **Boxed metrics with no decision behind them:** ITEMS/QUEUED/TIME tiles, the Voice/Queue/Storage/Privacy strip, Items/Words/Local size.
5. **Command palettes** in a popup and a side panel with 7 and 12 actions.
6. **Over-reassurance copy repeated three times:** "local-first", "local-only queue", "Local by default", "Ready locally", "No server". Trust is earned by behaviour, not adjectives.
7. **Template copy:** "Add listening material", "Repair path", "Audio, queue, and privacy controls.", "Use an immersive listening view", "Live preview" (for a static sentence), "operational settings surface" (README).
8. **Feature-list padding:** Duplicate, Focus mode, raw dictionary, language hint, reduce-motion toggle, permission table, sleep "default".
9. **Raw internals in the UI:** "page", "paste", "queued", "readable", "23,439 B", "60 segments", "Segment 8 of 60".
10. **Docs that describe intentions instead of behaviour:** the README lists "Failed extraction repair flow" and "Focus mode" as features; REBUILD_NOTES says "QueueTTS must feel like a living, browser-native audio queue system".
11. **Unicode glyphs as icons:** ⚙ ‹ › − + ▶ Ⅱ ×.
12. **Six arbitrary font weights** (680–780), which shows tokens were invented without ever being rendered.

---

## Competitive Benchmark

Sources (researched Oct 2026): CWS listings, vendor help pages, third-party reviews.

| | **QueueTTS** | Chrome Reading Mode | Edge Read Aloud | Read Aloud (OSS) | Speechify | NaturalReader | ElevenReader | Audioread / Listening.com |
|---|---|---|---|---|---|---|---|---|
| Users / rating | 0 | built-in | built-in | 6M · 4.1★ | ~1M · 4.6★ | ~4.2★ | ~9K · 4.0★ | small · 4.3★ (Listening) |
| Price | free | free | free | free (+paid cloud voices) | freemium, aggressive upsell | free + metered premium voices | 10 h/mo free AI voices; $11/mo | $99/yr; $39–156/yr |
| Voices | system + Google network | Google natural (downloaded) | neural (online) | system + cloud | 200+ neural (paid) | neural (metered) | 1,000+ neural | neural |
| On-page highlight | ✗ | word/sentence | ✓ | ✓ | word karaoke | ✓ | in app | in app |
| Global shortcut | ✗ | Alt+Shift+R | Ctrl+Shift+U | Alt+P/O/,/. | ✓ | — | — | — |
| Speed | 0.5–3 (1.15 max in popup) | adjustable | adjustable | adjustable | 4.5× (1.5× free) | adjustable | 4× | adjustable |
| Queue across pages | **broken** | ✗ | ✗ | ✗ | ✗ (unverified) | ✗ | library | **podcast feed / library** |
| Resume position | lost on pause >30s | ✗ | ✗ | ✗ | ✓ | — | ✓ synced | ✓ synced |
| Account / cloud | none | none | MS online voices | for premium | required | required for premium | required | required |
| Privacy | text stays local (except Google voices) | local/Google | MS cloud | discloses PII/content handling | cloud | cloud | cloud | cloud |

**Table stakes in 2026.** On-page highlighting with auto-scroll; clean reader-view extraction; at least some free natural voices; speed up to 3–4×; sentence/paragraph skip; a global shortcut; context-menu read; resume position.

**What users praise elsewhere.** Natural voices, smooth word highlighting (dyslexia/ADHD users), and "just works on any page".

**What users complain about elsewhere.**
- Paywalled voices, word/minute caps, and a 1.5× free speed cap (Speechify).
- Daily minute meters (NaturalReader).
- Skipped sentences and runaway playback (Read Aloud).
- Accounts and cloud upload (every queue product).
- Pocket's shutdown (Jul 2025) left listen-later users without a home.

### Gap analysis: QueueTTS vs the AAA bar

| Dimension | Current | AAA bar | Gap |
|---|---|---|---|
| Functionality | Queue breaks on use; extraction fails on major sites | Reliable ordered queue, Readability-grade extraction | Critical |
| Usability | Three surfaces with conflicting flows | One-keystroke queue, state-driven mini player | Critical |
| Visual design | Generic dark SaaS, broken light theme | Distinct, restrained, works in both themes | High |
| Interaction | Glyph buttons, toasts over controls, focus loss | Morphing play/pause, inline confirmations, undo | High |
| Performance | 1.3 s freezes per sentence at 300 items | Constant-time per sentence | High |
| Reliability | Dies after a pause, stale status after restart | Survives SW death, restarts, tab closes | Critical |
| Onboarding | None on install | Welcome tab with a 20-second demo and shortcut setup | High |
| Customisation | Many knobs, wrong ones | Voice, speed, skip size, shortcuts | Medium |
| Accessibility | Focus destroyed every sentence | WCAG 2.2 AA, screen-reader-friendly player | Critical |
| Trust | Claims "local" but uses Google network voices silently | Honest per-voice disclosure ("this voice sends text to Google") | Medium |
| Retention | Nothing accumulates | Library, history, resume, minutes-listened that's true | Critical |
| Differentiation | None vs Chrome/Edge | Free, private, persistent, cross-tab listen-later queue | Critical |
| Polish | Broken checkboxes, truncation, inconsistent radii | Survives design review | High |

**Where QueueTTS can genuinely win.** Be the **free, private, persistent listen-later queue**: Pocket for your ears, with no cloud and no meters.
- Do not compete on voice quality; Chrome and Edge win that for free.
- Compete on what happens *across* pages and *over time*.

---

## Top 25 Problems

### Critical

**1. Capture during playback hijacks the queue**
- **Evidence:** `addItemToState(...,{activate:true})` (`background.js:94`) moves `playback.itemId`. The old utterance's `end` then advances the *new* item from index 1, and a one-sentence item gets `completeItem` without being spoken. [verified]
- **Why it matters / user impact:** It breaks the core loop: capturing while listening is the main use case.
- **Severity:** Critical.
- **Fix:** Captures never touch the playback cursor. Insert at "end of Up next" (or "play next" as an explicit action). The cursor changes only through a single `play(itemId)` transition.
- **Expected improvement:** The core loop works.

**2. Pause longer than ~30s, then resume, stalls forever**
- **Evidence:** SW terminated (verified it was gone); 15s after resume, 0 segments advanced while the UI said "Playing". [verified]
- **Why it matters:** Any real-world pause (a phone call, making coffee) breaks the product.
- **Severity:** Critical.
- **Fix:** Never rely on `tts.resume()` across SW lifetimes. On resume, re-`speak` from the persisted sentence (and word offset). Treat SW start as "recover": reconcile the persisted status with `chrome.tts.isSpeaking()`.
- **Expected improvement:** Resume is 100% reliable.

**3. Stale "playing" after browser restart**
- **Evidence:** `onStartup` never resets status; the first Play press paused. [verified]
- **Severity:** Critical.
- **Fix:** On `onStartup` / SW boot, if `!isSpeaking()`, set status to paused.
- **Expected improvement:** The first press always plays.

**4. False "Heading." cues**
- **Evidence:** 300 of 809 segments on PG; a colon sentence in the fixture. [verified]
- **Why it matters:** The voice sounds broken within ten seconds of first use.
- **Severity:** Critical.
- **Fix:** Delete the heuristic. Capture structure from the DOM (`h1–h6`) as typed blocks, and default to a pause before headings with no spoken word "Heading".
- **Expected improvement:** Natural listening.

**5. Extraction fails or pollutes**
- **Evidence:** MDN and GitHub return 0 words; Wikipedia includes references, categories and `[1]`; PG has glued words. [verified]
- **Why it matters:** Users stop after the first bad page.
- **Severity:** Critical.
- **Fix:** Vendor Mozilla Readability (Apache-2.0, ~90 KB unminified), plus site-specific rules for Wikipedia (strip `.reference`, `.reflist`, `#catlinks`) and GitHub (`article.markdown-body`). Treat `<br><br>` as a paragraph break. Strip `[n]` citation markers.
- **Expected improvement:** Reads the article and only the article.

**6. No global keyboard shortcuts**
- **Evidence:** No `commands` in the manifest. [code]
- **Why it matters:** The fastest competitors are one keystroke; QueueTTS is three clicks.
- **Severity:** Critical.
- **Fix:** Add `commands`:
  - `queue-page` (Alt+Shift+Q)
  - `toggle-playback` (Alt+Shift+P)
  - `next-sentence`, `prev-sentence`
  - `_execute_action`

  Show the bindings and a link to `chrome://extensions/shortcuts` in onboarding.
- **Expected improvement:** Becomes a habit tool.

**7. Focus destroyed every sentence**
- **Evidence:** `activeElement` became BODY after a write. [verified]
- **Why it matters:** Keyboard and screen-reader users are locked out during playback.
- **Severity:** Critical.
- **Fix:** Keyed row updates (patch only what changed); never re-render the list on cursor changes.
- **Expected improvement:** Usable with a keyboard.

**8. Single-blob storage rewritten per sentence**
- **Evidence:** 7.7 MB per sentence and 1.2–1.5 s long tasks at 300 items; 10 MB quota. [verified]
- **Why it matters:** The library-centric product the extension needs to become is impossible on this model.
- **Severity:** Critical.
- **Fix:** Three layers:
  - `queue:index` (metadata, small);
  - `item:<id>:text` (or IndexedDB);
  - `playback` cursor in `chrome.storage.session`, persisted to local every 5s and on pause.

  Also add `unlimitedStorage` and catch quota errors.
- **Expected improvement:** Constant cost per sentence.

### High

**9. Light theme unreadable**
- **Evidence:** Hard-coded dark rgba surfaces (`18`). [verified]
- **Severity:** High.
- **Fix:** Tokens only; follow the system theme.
- **Expected improvement:** Half of users stop seeing a broken app.

**10. Queue order is meaningless**
- **Evidence:** Inserted at the top, played downward. [verified]
- **Severity:** High.
- **Fix:** A FIFO "Up next" with drag reorder, a "Play next" action, and a separate "Done" archive.
- **Expected improvement:** The queue matches the mental model.

**11. No on-page follow-along**
- **Evidence:** `word` events are ignored. [verified events]
- **Severity:** High.
- **Fix:** A content script highlights the current sentence (CSS Custom Highlight API, which needs no DOM mutation) and auto-scrolls when the source tab is open. Click a paragraph to read from there.
- **Expected improvement:** Matches the table stakes.

**12. The popup ignores state**
- **Evidence:** The capture card stays above the player; "Now playing · Idle"; a failed item becomes the hero. [verified]
- **Severity:** High.
- **Fix:** State-driven layout (see Target).
- **Expected improvement:** A clear next action.

**13. Robotic default voice, buried picker, 1.15× popup speed ceiling**
- **Evidence:** `01` and the voice list. [verified]
- **Severity:** High.
- **Fix:**
  - Auto-select the best local voice for the page language (prefer "Natural"/"Online" Microsoft voices when present).
  - A voice list with ▶ preview per row.
  - A speed stepper up to 3×.
  - Label voices that send text off-device.
- **Expected improvement:** A better first impression.

**14. No onboarding on install**
- **Evidence:** `onInstalled` builds menus only. [code]
- **Severity:** High.
- **Fix:** Open a welcome tab that:
  1. asks you to pin the extension;
  2. reads one sample paragraph with highlighting;
  3. shows the two shortcuts;
  4. queues a demo article.
- **Expected improvement:** An aha moment within 30 seconds.

**15. Options rendering bugs**
- **Evidence:** 40px grey checkbox slabs; truncated status; raw bytes. [verified]
- **Severity:** High.
- **Fix:** Scope the input CSS; delete the strip.
- **Expected improvement:** Basic credibility.

**16. Fake time and seek**
- **Evidence:** 2:57 vs 2:23; ±15s snaps to estimates. [verified]
- **Severity:** High.
- **Fix:**
  - One duration model, calibrated from actual `word` event timing per voice and speed.
  - Replace ±15s with sentence/paragraph skip.
  - Show "remaining" only.
- **Expected improvement:** Numbers you can trust.

**17. The context menu force-opens the side panel**
- **Evidence:** `background.js:368–378`. [code]
- **Severity:** High.
- **Fix:** Confirm with a badge flash ("+1"); don't open UI.
- **Expected improvement:** Frictionless queuing.

### Medium

**18. Sleep "default" restarts a live alarm on every settings change**
- **Evidence:** `options.js:167`. [code]
- **Fix:** The sleep timer lives only in the player. Add "end of current article" as an option.

**19. Volume 0 and pitch 0 impossible**
- **Evidence:** `||` fallback. [verified]
- **Fix:** Use `Number.isFinite`.

**20. Sentence splitting breaks on abbreviations**
- **Evidence:** "Dr." [verified]
- **Fix:** `Intl.Segmenter(lang,{granularity:"sentence"})` plus an abbreviation guard.

**21. Destructive actions without undo; inconsistent import**
- **Evidence:** [code]
- **Fix:** Undo toast for delete and clear. Import as *merge* with a preview of counts. One implementation.

**22. Keyboard model inconsistent; modals don't trap or return focus**
- **Evidence:** [verified/code]
- **Fix:**
  - One keymap shared by all surfaces.
  - The `<dialog>` element (native focus trap and Escape).
  - Restore focus to the opener.

**23. Untrue stats; UTC day boundary**
- **Evidence:** [verified]
- **Fix:** Count real spoken seconds from TTS events; use local dates. Surface the stats only once they're honest.

### Low

**24. Badge contrast and meaning**
- **Evidence:** Mint background with white text. [verified]
- **Fix:** A dark badge, ▶/‖ state, or none.

**25. Repo hygiene**
- **Evidence:** AI process docs, no licence, a checker that enforces all permissions and bans "TODO", no tests, no i18n.
- **Fix:**
  - Replace REBUILD_NOTES with real docs.
  - Add an MIT licence.
  - Vitest for `shared.js` plus a Playwright extension test of the playback state machine.
  - `_locales/en`.

---

## What Must Be Removed

**Delete**
- Popup ⌘K command palette.
- Side-panel command palette (keyboard shortcuts replace both).
- Duplicate action.
- Focus mode modal (replaced by the transcript view).
- Summary tiles.
- Trust panel.
- Options status strip.
- Permission table (one sentence remains).
- "Reduce motion" toggle (use the OS setting).
- "Language hint" field.
- "Heading cue" mode and the `isHeading` heuristic.
- ±15/±30s seek chips.
- "readable" and source-type labels on healthy rows.
- Letter avatars.
- Radial background glows.
- Gradient progress fill.
- All uppercase kickers.
- `REBUILD_NOTES.md` critique logs.
- The permission and TODO checks in `check.mjs`.
- Dead `QTTS_PROGRESS`.
- The unread `stats.days` fields.

**Simplify**
- Queue rows to one line plus a hover ⋯ menu.
- Settings to four groups: Voice, Playback, Shortcuts, Data & privacy.
- The pronunciation editor to a plain list (keep import/export, drop the raw textarea).

**Consolidate**
- One capture path: capture → queue (no mandatory preview modal; "Edit" is available after).
- One import/export/clear implementation, in Settings only.
- One `escapeHtml`, `toast` and keymap module.

**Redesign**
- Popup (a state-driven mini player).
- Side panel (Up next / Library / Transcript).
- Icon.
- Onboarding.
- Empty states.

**Replace**
- Homegrown extraction → Readability plus site rules.
- Regex sentence split → `Intl.Segmenter`.
- Blob storage → index + per-item text + session cursor.
- Glyph icons → an SVG sprite.
- `confirm()` → undo.

**Hide (Advanced)**
- Pitch.
- Pronunciation rules.
- Heading pause length.

**Move**
- The sleep timer from Settings into the player.
- Import/export out of the side panel.

**Rewrite**
- All UI copy (no kickers, no "material", no "repair path").
- The README (what it does, how it's private, shortcuts; no feature catalogue).

---

## What Must Be Added (high value only)

1. **A reliable playback state machine** in the SW with recovery: idle, loading, speaking, paused, error, plus a persisted cursor `{itemId, blockIndex, charIndex}`.
2. **Global shortcuts:** queue page, toggle, next/previous sentence.
3. **Readability-grade extraction** with structured blocks (heading / paragraph / list / quote / code-skip).
4. **On-page follow-along** with the CSS Custom Highlight API, auto-scroll, and click-to-read-from-here.
5. **A transcript view** in the side panel: current sentence highlighted, click to jump.
6. **Up next semantics:** FIFO, drag reorder, "Play next", auto-advance, a Done archive with "listened on" dates, auto-archive.
7. **Resume everywhere:** a per-item position bar on each row ("12 min left").
8. **Duplicate-URL detection** ("Already in queue · #3").
9. **Voice auto-match** to page language; a voice list with preview; honest "sends text to Google/Microsoft" tags.
10. **A welcome tab on install** with a live demo and shortcut setup.
11. **Undo** for delete, clear and import.
12. **True listening stats** (later), e.g. a weekly "3 h 12 m listened · 9 articles", shown in the Library header. That is the retention hook, but only once it's accurate.

**Phase 4, only if the queue proves itself:** PDF reading, an optional "export queue as audio/podcast feed", sync via `storage.sync` for the index only.

---

## What Must Be Redesigned

### 1. Popup → mini player (360 × ≤440 px)

| State | Layout |
|---|---|
| Playing / paused | Source favicon + title (2 lines) · "Paused · 14 min left" · scrubbable progress, in sentences, with a real time tooltip · ⟲ sentence / ▶‖ / ⟳ sentence · speed stepper · "Up next" (3 rows, drag-reorderable) · bottom row "Queue this page · 6 min" or "In queue · #3" |
| Empty queue | One sentence ("Queue articles and listen later, in order."), the primary button "Queue this page", and the shortcut hint "Alt+Shift+Q from any page". |
| Uncapturable page | The button is disabled with a plain reason ("Chrome doesn't let extensions read its own pages") and "Paste text" as the secondary action. |

### 2. Side panel → three views behind a segmented control

- **Up next:** queue list with drag, ⋯ menu, per-row progress.
- **Library:** done/history and search.
- **Now:** transcript with the current sentence highlighted.

A sticky mini player sits at the top in every view. Empty states are one line each.

### 3. Settings

- **Voice:** list with preview, speed, auto-match language.
- **Playback:** skip size sentence/paragraph, pause between articles, auto-archive.
- **Shortcuts:** current bindings plus a link to change them.
- **Data & privacy:** export/import/clear, one sentence of privacy, voice disclosure.

### 4. Icon and wordmark

Rebuilt for 16px first. Consider a name that doesn't say "TTS" (e.g. a "Listen-later" descriptor in the store title).

### 5. Onboarding

A welcome tab (see Feature Set).

---

## AAA Target Architecture

```
manifest
  permissions: storage, unlimitedStorage, activeTab, scripting, sidePanel, tts, contextMenus, favicon
  commands:    _execute_action, queue-page, toggle-playback, next-sentence, prev-sentence
background (SW)
  player.js     single state machine; the only writer of playback state
                boot(): reconcile persisted cursor with tts.isSpeaking()
                speak(cursor) re-issues from the block/char offset (no reliance on tts.resume across lifetimes)
                handles word events → cursor.charIndex (throttled persist 5 s + on pause/stop)
  queue.js      add/move/remove/archive; never touches the cursor except via player.play()
  capture.js    executeScript({func}) one-shot; Readability in an injected file; returns blocks[]
  messages.js   typed handlers table (not an if-chain)
storage
  local:   index  [{id,title,url,host,addedAt,words,blocks,position,state}]   (small)
           text:<id>  blocks[] (structured)  or IndexedDB
           settings
  session: cursor {itemId, block, char, status}   (fast, per-sentence writes go here)
ui (popup, sidepanel, options)
  subscribe to index/cursor separately; keyed row patching; no full innerHTML of lists
  shared ui.js: escape, toast/undo, keymap, icons sprite
content (on demand)
  highlight.js  CSS Custom Highlight API for the current sentence; click-to-read
tests
  vitest: segmentation, extraction fixtures (MDN, GitHub, Wikipedia, PG, news), queue ops
  playwright: load unpacked; play→pause 40 s→resume; capture during playback; restart recovery
```

**Performance budgets**
- Popup first paint under 100 ms (render from the index before page-context lookup).
- Per-sentence work: one `storage.session` write, no list re-render.
- Side panel at 500 items: no long task over 50 ms.
- The SW stays idle when not playing.

---

## AAA Design System

**Personality.** A quiet, confident audio utility for readers, not a dashboard. Think *paper and ink with one live signal*.

### Colour

| Role | Light | Dark |
|---|---|---|
| bg | `#FBFAF7` (warm paper) | `#141413` |
| surface | `#FFFFFF` | `#1C1C1A` |
| line | `rgba(20,20,19,.10)` | `rgba(255,255,255,.09)` |
| text | `#1A1A18` | `#ECEBE6` |
| text-2 | `#6B6A65` | `#A3A29C` |
| **live** (the only accent: what's speaking now, primary action, progress) | `#E4572E` (vermilion) | `#FF7A50` |
| danger | `#B42318` | `#F97066` |

- No secondary accent, no gradients, no glows.
- Semantic status shows as text plus an icon, not as coloured pills.

### Typography

| Use | Spec |
|---|---|
| UI font | One bundled variable sans (e.g. Inter or Geist, woff2, about 100 KB) with **two weights: 450 and 600** |
| Times | `font-variant-numeric: tabular-nums` |
| Transcript / reading text | A bundled serif (e.g. Source Serif 4) at 17/28 |

**Scale (size / line height, px):** 11/16 meta · 13/18 body · 15/20 titles · 20/26 screen title. No uppercase labels.

### Spacing, radius, elevation

| Token | Values |
|---|---|
| Spacing | 4-pt grid; popup gutter 16; row height 44 (one-line), 56 (with progress) |
| Radius | 6 (controls), 10 (sheets/popovers). No pills except the speed stepper |
| Elevation | Borders only in-panel. One shadow, for floating menus and the drag ghost |

### Icons

- One SVG sprite, 20px grid, 1.5px stroke (Lucide-derived): play/pause, skip-sentence ±, queue-add, check, more, drag, undo, external.
- Play/pause is a single morphing path.

### Motion

| Element | Spec |
|---|---|
| State changes | 120 ms ease-out |
| Sheets and menus | 160 ms |
| Row insert / remove | Height plus fade, 180 ms |
| Drag | Spring-free, follows the pointer |
| Progress | Advances with `word` events (continuous), not jumps |
| Play/pause morph | 140 ms |

- No entrance animations on load.
- Reduced motion turns all of it into instant changes.
- Sound and haptics: none (it's an audio product; UI sounds would collide with speech).

### Components

| Component | Spec |
|---|---|
| Buttons | Primary (live), secondary (line), quiet (text) |
| Speed stepper | — |
| Rows | Queue row (favicon, title, host · remaining, progress hairline, ⋯) |
| Mini player | — |
| Transcript block | — |
| Menu | Native `<dialog>`/popover |
| Toast | Undo-only, bottom, never over controls |
| Switch | — |
| Voice row | With ▶ preview |

### Copy rules

- Verbs, not nouns ("Queue this page", not "Add listening material").
- Never expose enums.
- Times as "14 min left".
- Errors say what to do next.

---

## AAA Feature Set

### Core (v3.0)
- One-keystroke queue (page or selection) from anywhere; context menu without opening UI.
- Reliable background playback with auto-advance, resume after pause/restart/SW death, and sentence/paragraph skip.
- Readability-quality extraction with structural pauses and citation stripping; MDN, GitHub, Wikipedia, Substack, Medium and news fixtures pass.
- Mini player popup, side panel (Up next / Library / Now transcript), on-page sentence highlight with click-to-read.
- Voice auto-match, voice preview list, speed 0.75–3×, honest network-voice disclosure.
- Up next ordering, Play next, drag, Done archive, duplicate detection, undo everywhere.
- Global shortcuts, a welcome tab, honest privacy.

### Retention (v3.1)
- Per-item progress, "x min left in queue", a weekly listened summary from real data.
- Auto-archive.
- "Queue all article tabs in this window" (bulk).

### Later (v3.2+, only with evidence of demand)
- PDF.
- Optional on-device Summarizer "listen to summary" (Chrome built-in AI; stays local).
- `storage.sync` for the index.
- Export queue as audio files.

---

## Prioritized Roadmap

**Phase 1 — Critical fixes (about 1 week)**
- Playback state machine with recovery (problems #1–3).
- Captures never move the cursor.
- Startup reconciliation.
- Delete the heading heuristic (#4).
- Fix volume/pitch 0, the sleep alarm, the light-theme literals, and the checkbox CSS.
- Add the Playwright tests for these exact scenarios.
- **Outcome:** the loop of capture, play, pause, resume and auto-advance works every time. Tests prove it.

**Phase 2 — Product reconstruction (1–2 weeks)**
- Storage split and session cursor (#8).
- Keyed rendering (#7).
- FIFO Up next plus a Done archive (#10).
- Readability extraction with blocks and site rules (#5).
- `Intl.Segmenter` (#20).
- Commands and shortcuts (#6).
- Context menu without UI (#17).
- One capture path.
- Delete everything in "Must be removed".
- **Outcome:** a real listen-later queue that scales to 1,000 items with no long tasks and reads MDN, GitHub and Wikipedia cleanly.

**Phase 3 — Visual redesign (1–2 weeks)**
- Implement the design system tokens (both themes).
- SVG sprite icons.
- New icon.
- State-driven popup.
- Three-view side panel.
- Four-group settings.
- All copy rewritten.
- **Outcome:** passes a professional design review in light and dark, at 320–420px panel widths and 1280px tab width.

**Phase 4 — Advanced functionality (2 weeks)**
- On-page highlight and click-to-read.
- Transcript view.
- Voice auto-match and preview list.
- Welcome tab.
- Duplicate detection.
- Undo.
- Per-item progress.
- Bulk "queue tabs".
- **Outcome:** feature parity with Chrome/Edge on reading, and clear superiority on queue/resume/privacy. The aha moment happens in the first 30 seconds.

**Phase 5 — Polish and performance (1 week)**
- Duration model calibrated from word events.
- Motion pass.
- Popup first paint under 100 ms.
- Side panel at 500 items with no long task over 50 ms.
- Quota handling.
- `_locales`.
- Real listening stats.
- **Outcome:** feels instant and honest; numbers are true.

**Phase 6 — Final QA (1 week)**
- WCAG 2.2 AA pass (axe clean, NVDA/VoiceOver walkthrough, keyboard-only run).
- Extraction fixture suite on 30 real sites.
- 8-hour soak playback.
- Chrome update / extension reload / browser restart recovery tests.
- Store listing with real screenshots, privacy policy, MIT licence.
- **Outcome:** ready for a public Chrome Web Store launch.

---

## Final Scorecard

| Category | Score |
|---|---|
| Product concept | 4 |
| Product-market usefulness | 3 |
| Core functionality | 2 |
| Feature depth | 3 |
| UX | 3 |
| UI | 3 |
| Visual identity | 2 |
| Interaction design | 3 |
| Motion | 3 |
| Typography | 2 |
| Information architecture | 3 |
| Accessibility | 2 |
| Performance | 3 |
| Reliability | 1 |
| Privacy/security | 7 |
| Chrome extension architecture | 3 |
| Engineering quality | 4 |
| Onboarding | 1 |
| Retention | 1 |
| Differentiation | 2 |
| Trust | 4 |
| Overall polish | 2 |
| **Overall AAA readiness** | **2.8 / 10 (poor)** |

Overall = unweighted mean (61 / 22 = 2.77).

---

## Brutal Conclusion

QueueTTS feels generic because it was built from the outside in. Each pass restyled the surface (new kickers, new semantic colours, a new settings strip, a "repair path" box) and none of them listened to a queue for ten minutes. If one had, it would have heard:
- "Heading." spoken mid-sentence;
- the article dying the moment something else was saved;
- silence after a coffee-break pause.

The decoration is the symptom; the untested core is the disease.

Making it genuinely AAA does **not** mean more features or a prettier dark theme. It means four things:

1. **Choose the one job nobody free does well:** a private, persistent, cross-tab listen-later queue. Stop competing with Chrome's built-in reader.
2. **Make that job unbreakable:** a single playback state machine that survives the service worker dying, captures that never touch the cursor, extraction that reads MDN and Wikipedia correctly, and tests that prove all three.
3. **Delete about 40% of the UI:** palettes, tiles, trust panels, kickers, focus mode, duplicate, permission tables, seek chips. Then design the three remaining surfaces around state, not modules.
4. **Give it one identity and execute it at the pixel level:** paper and ink with a single live accent, two weights, one icon set, both themes working, focus never lost.

Do that, and the first 30 seconds become:
- press Alt+Shift+Q on three articles;
- hear the first one start in a voice that matches the page, with the sentence lighting up on the page;
- hear the second one begin on its own;
- pause for coffee, come back, and it picks up mid-sentence.

That is the product people keep.
