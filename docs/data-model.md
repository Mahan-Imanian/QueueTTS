# Data model

Local storage key: `queuetts:premium:v1`

```json
{
  "settings": {
    "theme": "system",
    "contrast": "normal",
    "motion": "full",
    "voiceURI": "",
    "rate": 1,
    "skip": 15,
    "dictRaw": "",
    "dictPairs": [],
    "compact": false
  },
  "queue": [
    {
      "id": "uuid",
      "title": "Article title",
      "text": "Full source text",
      "createdAt": 1760000000000,
      "source": { "type": "paste" },
      "languageHint": "en-US",
      "headingMode": "cue"
    }
  ],
  "sleep": {
    "mode": "off",
    "endAt": 0,
    "endOfItem": false
  },
  "playback": {
    "itemId": "uuid",
    "sentenceIndex": 0
  }
}
```

Daily counters use `queuetts:daily:v1` and roll over by local ISO date.
