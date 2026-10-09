# Performance

Two kinds of numbers are on this page: a queue-size benchmark that anyone can rerun from the repository, and speech start-up times that were measured by hand and depend on the machine's voices and audio hardware.

## Queue size (reproducible)

```bash
node test/perf/bench.mjs              # 10, 100, 300, 500 and 1,000 articles
node test/perf/bench.mjs 10,100       # or any list of sizes
```

The benchmark launches your installed Chrome (set `CHROME_PATH` if needed), imports articles of 4,320 words each, captures `test/fixtures/news.html`, opens the side panel and plays for 5 seconds with a fake speech engine that "speaks" each sentence in 30 ms, about 10 sentences a second. It measures QueueTTS's own work, not a real voice.

Run on 9 October 2026: Windows 11, Intel Core i5-9300H, 16 GB RAM, Chrome 142.0.7444.134, Node 24.12.0. Other development servers and browser instances were running at the same time, so treat the timings as an upper bound for this machine and expect a few tens of milliseconds of run-to-run variation.

| Articles | Storage | Capture | Side panel shows the queue | Play → playing | Gap between sentences (median / p95) | Long tasks in the panel during 5 s of playback | Reorder |
|---|---|---|---|---|---|---|---|
| 10 | 0.3 MB | 129 ms | 415 ms | 135 ms | 17 / 280 ms | 0 | 8 ms |
| 100 | 2.5 MB | 158 ms | 330 ms | 146 ms | 6 / 277 ms | 0 | 26 ms |
| 300 | 7.6 MB | 205 ms | 464 ms | 175 ms | 6 / 280 ms | 0 | 77 ms |
| 500 | 12.6 MB | 236 ms | 611 ms | 162 ms | 8 / 285 ms | 1 (57 ms) | 138 ms |
| 1,000 | 25.2 MB | 235 ms | 1,104 ms | 212 ms | 7 / 282 ms | 2 (max 101 ms) | 437 ms |

The p95 gap of about 280 ms is the deliberate pause before a new paragraph (260 ms), not delay. Storage grows linearly because each article's text is its own `doc:<id>` key; a sentence change writes only the small `player` key, so the gap between sentences does not grow with the queue. Opening the side panel and reordering do grow with queue size, because the panel renders every queued row and a reorder rewrites the `queue` index.

Version 2 kept the whole library under one storage key, rewrote it on every sentence and had no `unlimitedStorage` permission, so Chrome's 10 MB quota applied. At this benchmark's article size that is roughly 390 articles.

## Speech start (measured by hand)

Every start is traced from the click to the first spoken word, and *Settings → About* shows the latest trace. The table below was read from that trace by hand on 4 October 2026, on the author's Windows 11 machine with Chrome 142, Microsoft's built-in voices and Google's online voices, and a wireless headset. It cannot be reproduced by a script because it depends on the installed voices, the audio device and Google's servers.

| Situation | Play → speech engine starts | Play → first spoken word |
|---|---|---|
| Local voice, cold (no QueueTTS page opened yet) | 346 ms | 478 ms |
| Local voice, QueueTTS opened first | 76 ms | 210 ms |
| Local voice, resuming | ~36 ms | ~155 ms |
| Google online voice, cold | 722 ms | — (no word events) |
| Google online voice, QueueTTS opened first | 398 ms | — (no word events) |

Most of that time is the engine loading a voice, or Google's servers. Opening the popup or side panel speaks a silent "." to load the voice in advance, which is the difference between the first two rows.

What the repository does check: the end-to-end test "QueueTTS adds almost no delay of its own before speech starts" (`test/e2e/startup.test.js`) fails if resuming takes 60 ms or more to reach `chrome.tts.speak()` with a fake engine, and "real voice: first play, resume and next item…" fails if an installed local voice takes 2 seconds or more to speak its first word.

Wireless and Bluetooth headsets switch their audio link off when it is quiet and can drop the first part of a second when it wakes. While you listen, and for up to 90 seconds after you pause, an offscreen document plays an inaudible noise stream to keep the output awake (`src/background/audio.js`, `src/audio/keepalive.js`). Whether this helps depends on the device; it was not measured, because no loopback device on the test machine carries `chrome.tts` output.
