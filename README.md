# QueueTTS

QueueTTS is a local-first static web application for turning pasted text and readable URLs into a continuous text-to-speech queue. It uses the browser Web Speech API, stores queue data locally, and requires no backend service.

## Run locally

```bash
npm install
npm run start
```

Open `http://localhost:4173`.

The project also works by serving the directory with any static file server.

## Verify

```bash
npm run check
npm run build
```

The verification script checks the HTML shell, required source files, selector coverage, and JavaScript syntax.

## Features

- Paste long-form text into a sentence-safe listening queue.
- Fetch simple readable pages when browser CORS rules allow it.
- Choose installed system voices, rate, skip interval, heading behavior, and pronunciation replacements.
- Play through items continuously with keyboard controls, sleep timer, focus mode, import/export, editing, duplication, reordering, and queue search.
- Stores queue, settings, and daily listening counters in localStorage.
