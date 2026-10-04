import test from "node:test";
import assert from "node:assert/strict";
import { describeVoice, pickVoice, rankVoices, shortVoiceName } from "../../src/lib/voices.js";

const voices = [
  { voiceName: "Microsoft David - English (United States)", lang: "en-US", remote: false, eventTypes: ["start", "word", "end"] },
  { voiceName: "Microsoft Zira - English (United States)", lang: "en-US", remote: false, eventTypes: ["start", "word", "end"] },
  { voiceName: "Google US English", lang: "en-US", remote: true, eventTypes: ["start", "end"] },
  { voiceName: "Google UK English Female", lang: "en-GB", remote: true, eventTypes: ["start", "end"] },
  { voiceName: "Google Deutsch", lang: "de-DE", remote: true, eventTypes: ["start", "end"] },
  { voiceName: "Ava (Premium)", lang: "en-US", remote: false, eventTypes: ["start", "word", "end"] },
  { voiceName: "Microsoft Hedda - German (Germany)", lang: "de-DE", remote: false }
];

test("voices are labelled honestly: online, enhanced or standard", () => {
  assert.equal(describeVoice(voices[0]).tier, "standard");
  assert.equal(describeVoice(voices[2]).tier, "online");
  assert.match(describeVoice(voices[2]).where, /sent to Google/);
  assert.equal(describeVoice(voices[5]).tier, "enhanced");
  assert.equal(describeVoice(voices[2]).highlights, false);
  assert.equal(describeVoice(voices[0]).highlights, true);
  assert.equal(shortVoiceName(voices[1]), "Zira");
});

test("online voices are never chosen unless allowed", () => {
  const ranked = rankVoices(voices, { lang: "en-US", allowNetwork: false });
  assert.ok(ranked.every((voice) => !voice.remote));
  assert.equal(ranked[0].voiceName, "Ava (Premium)");
  assert.equal(pickVoice(voices, { allowNetworkVoices: false, voices: { en: "Google US English" } }, "en").voice.voiceName, "Ava (Premium)");
});

test("ranking prefers the article's language, then quality", () => {
  const local = voices.filter((voice) => voice.voiceName !== "Ava (Premium)");
  assert.equal(rankVoices(local, { lang: "de", allowNetwork: false })[0].voiceName, "Microsoft Hedda - German (Germany)");
  assert.equal(rankVoices(local, { lang: "en-GB", allowNetwork: true })[0].voiceName, "Google UK English Female");
  assert.equal(rankVoices(local, { lang: "en-US", allowNetwork: true })[0].voiceName, "Google US English");
});

test("a remembered voice is used per language and falls back when missing", () => {
  const settings = { allowNetworkVoices: true, voices: { en: "Microsoft Zira - English (United States)", de: "Not installed" } };
  assert.deepEqual([pickVoice(voices, settings, "en-US").voice.voiceName, pickVoice(voices, settings, "en-US").reason], ["Microsoft Zira - English (United States)", "preferred"]);
  const german = pickVoice(voices, settings, "de-DE");
  assert.equal(german.reason, "preferred unavailable");
  assert.equal(german.voice.voiceName, "Google Deutsch");
  assert.equal(pickVoice([], settings, "en").voice, null);
});
