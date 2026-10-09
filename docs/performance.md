# Performance

These are the author's own measurements, on a Windows 11 machine with Chrome 142. They will differ on other hardware and voices.

## Starting quickly and keeping the first word

Every start is instrumented, and *Settings → About* shows the last measurement. On a Windows 11 test machine with Chrome 142:

| Situation | Play → speech engine starts | Play → first spoken word |
|---|---|---|
| Local voice, cold (no QueueTTS surface opened yet) | 346 ms | 478 ms |
| Local voice, QueueTTS opened first | 76 ms | 210 ms |
| Local voice, resuming | ~36 ms | ~155 ms |
| Google online voice, cold | 722 ms | — |
| Google online voice, QueueTTS opened first | 398 ms | — |

QueueTTS itself takes 1–10 ms from your click to calling the speech engine. The exception is the very first play, which takes about 110 ms because it also starts the audio keep-alive. The rest is the engine loading a voice, or Google's servers, which is why opening the popup or side panel silently warms the engine. Wireless and Bluetooth headsets switch off their audio link when it's quiet and drop the first fraction of a second when it wakes. QueueTTS keeps the output awake with an inaudible stream from an offscreen document while you're listening, and for up to 90 seconds after you pause.

## Large queues

Measured with articles of 4,320 words each, in the side panel at test speed (about 10 sentences a second, roughly 30 times faster than real speech):

| Queued articles | Storage | Capture | Side panel opens | Gap between sentences (median) | Long tasks during playback |
|---|---|---|---|---|---|
| 10 | 0.3 MB | 119 ms | 334 ms | 6 ms | 0 |
| 100 | 2.5 MB | 81 ms | 212 ms | 6 ms | 0 |
| 300 | 7.6 MB | 94 ms | 314 ms | 6 ms | 0 |
| 1,000 | 25.2 MB | 144 ms | 458 ms | 6 ms | 0 |

For comparison, version 2 rewrote the whole library on every sentence: 7.7 MB and 1.2–1.5 seconds of frozen UI per sentence at 300 articles, and it hit Chrome's 10 MB quota at about 390.

`node test/perf/bench.mjs` reruns the queue-size benchmark with 10 to 1,000 queued articles.
