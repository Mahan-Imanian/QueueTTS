# QueueTTS

QueueTTS is a local-first, static web app that turns article text into continuous text-to-speech playback using a real queue. Add multiple items (paste text, use the bookmarklet, or try a URL), then play through segmented speech-safe chunks like a music playlist.

## Bookmarklet import (CORS-free)

Many sites block direct URL fetching from a static page. The bookmarklet runs on the article page itself, extracts readable text, and opens QueueTTS with the content in the URL fragment. That means no CORS errors and it works on most pages.

1. Drag **“QueueTTS: Import Page”** to your bookmarks bar.
2. Click it on any article page to import the text into QueueTTS.

## Running locally

Open `index.html` directly or serve the folder:

```bash
python -m http.server
```

Then visit `http://localhost:8000`.
