# Supported content, limitations and roadmap

## Supported content

| Works well | Declined, with a message |
|---|---|
| News articles and blogs | Pages that are mostly lists of links, such as section fronts |
| Wikipedia, without references, infoboxes or citation markers | Pages with almost no text, such as dashboards and login walls |
| GitHub READMEs, with code kept as code | Chrome's own pages and the Web Store, which extensions can't read |
| MDN reference pages, old and 2025 layouts | PDFs; select the text and use *Paste text* instead |
| Documentation sites, essays, table-layout pages | |
| Any selection, and any pasted text | |

Checked by hand on live pages before the 3.1.0 release (October 2026): Wikipedia, paulgraham.com, MDN, two GitHub READMEs, martinfowler.com and Guardian articles. Sites change their markup, so treat that as a snapshot. The end-to-end tests cover the same layouts with offline fixtures in `test/fixtures`.

## Browser compatibility

Developed and tested on Chrome 142 on Windows 11. It needs Chrome 116 or later for the side panel API. Other Chromium browsers (Edge, Brave, Arc) should work but haven't been tested, and their voice lists differ. Firefox and Safari aren't supported.

## Known limitations

- Voice quality depends on your system. On Windows, private local voices sound mechanical; the more natural options are Google's online voices or macOS's enhanced voices. Chrome doesn't give extensions the natural voices built into its Reading mode.
- Highlighting follows along in the side panel and popup, not on the original web page.
- No PDF support yet.
- The queue lives in one Chrome profile; there's no sync between computers.
- The interface is English only, though speech follows each article's language.
- Accessibility has been checked with axe and keyboard-only use, but not yet with a screen reader such as NVDA or VoiceOver.

## Why there's no premium cloud voice

Paid providers (ElevenLabs, OpenAI, Azure) sound far better. Using them would mean sending everything you save to a third party under an API key you manage, paying per character, adding host permissions, and losing word timing with some providers. Local neural engines that run in the browser need large model downloads, and the common phonemiser is GPL-licensed. Neither fits a free, private extension today. That decision is revisited in the roadmap below.

## Roadmap

1. **Screen reader pass** with NVDA and VoiceOver, fixing whatever it finds.
2. **On-page highlighting** for the article you just added while its tab is still open.
3. **PDF support** through Chrome's PDF viewer text layer.
4. **Better voices without giving up privacy.** Revisit local neural voices as browser-side models get smaller and permissively licensed phonemisers appear. Any cloud voice would be opt-in, per voice, with your own key and a clear notice.
5. **More extraction adapters** (Substack, Medium, newsletters), each with a fixture and a test.
6. **Localisation** of the interface.
7. **Optional sync** of the queue index (not article text) through `chrome.storage.sync`.
