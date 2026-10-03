import test from "node:test";
import assert from "node:assert/strict";
import { buildPlan, canonicalUrl, formatDuration, localDay, progressAt, splitSentences, stripCitations, toSpeech, unitIndex, wordIndexAt } from "../../src/lib/text.js";

test("abbreviations do not end sentences", () => {
  const parts = splitSentences("Dr. Samuel Reyes, a researcher at U.C.L.A., cautions against it. It is easy to grow from a low base.");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^Dr\. Samuel Reyes/);
});

test("initials and e.g. stay inside one sentence", () => {
  assert.equal(splitSentences("J. R. R. Tolkien wrote it. Many tools, e.g. Speechify, read aloud.").length, 2);
});

test("decimals, quotes and ellipses", () => {
  const parts = splitSentences("It rose 3.5 percent. \"We were wrong,\" she said. Then… nothing.");
  assert.deepEqual(parts.length, 3);
});

test("very long sentences are split at clause boundaries", () => {
  const long = Array.from({ length: 30 }, (_, i) => `clause number ${i}`).join(", ") + ".";
  const parts = splitSentences(long);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 300));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), long);
});

test("citations, URLs and markup are not spoken", () => {
  assert.equal(stripCitations("Speech synthesis[1] is old.[12][citation needed]"), "Speech synthesis is old.");
  assert.equal(toSpeech("See https://www.example.com/a/b?c=1 for more."), "See example.com for more.");
  assert.equal(toSpeech("Use `npm test`, e.g., daily."), "Use npm test, for example, daily.");
});

test("pronunciations respect word boundaries and unicode", () => {
  const rules = [{ from: "API", to: "A P I" }, { from: "C++", to: "C plus plus" }];
  assert.equal(toSpeech("The API uses C++ and RAPID.", rules), "The A P I uses C plus plus and RAPID.");
});

test("plan never injects the word Heading unless asked", () => {
  const doc = { blocks: [{ k: "h", t: "The hidden ridership", l: 2 }, { k: "p", t: "Ridership rose. Riders came." }, { k: "code", t: "npm i" }] };
  const plan = buildPlan(doc);
  assert.deepEqual(plan.units.map((unit) => unit.lead + unit.text), ["The hidden ridership", "Ridership rose.", "Riders came."]);
  assert.ok(plan.units[1].pause > 0);
  const announced = buildPlan(doc, { announceHeadings: true, readCode: true });
  assert.equal(announced.units[0].lead, "Section: ");
  assert.equal(announced.units.at(-1).text, "npm i");
});

test("unitIndex resumes at or after a saved position", () => {
  const plan = buildPlan({ blocks: [{ k: "p", t: "A one. A two." }, { k: "p", t: "B one." }] });
  assert.equal(unitIndex(plan, null), 0);
  assert.equal(unitIndex(plan, { b: 1, s: 0 }), 2);
  assert.equal(unitIndex(plan, { b: 0, s: 9 }), 2);
  assert.ok(progressAt(plan, 2) > 0.5);
});

test("helpers", () => {
  assert.equal(canonicalUrl("https://www.example.com/post/?utm_source=x&id=2#top"), "https://example.com/post/?id=2");
  assert.equal(canonicalUrl("chrome://newtab"), "");
  assert.equal(formatDuration(30), "< 1 min");
  assert.equal(formatDuration(3720), "1 h 2 min");
  assert.equal(localDay(new Date(2026, 0, 2, 23, 59).getTime()), "2026-01-02");
  assert.equal(wordIndexAt("one two three", 4), 1);
  assert.equal(wordIndexAt("one two three", 0), 0);
});
