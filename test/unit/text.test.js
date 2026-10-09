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

test("abbreviations that often end a sentence do not swallow the next one", () => {
  assert.deepEqual(splitSentences("They met at 5 p.m. The sun had set."), ["They met at 5 p.m.", "The sun had set."]);
  assert.deepEqual(splitSentences("Apples, pears, etc. Then we left."), ["Apples, pears, etc.", "Then we left."]);
  assert.deepEqual(splitSentences("Apples, pears, etc. and more."), ["Apples, pears, etc. and more."]);
  assert.deepEqual(splitSentences("He said no. Then he left."), ["He said no.", "Then he left."]);
  assert.deepEqual(splitSentences("See No. 5 for details. Done."), ["See No. 5 for details.", "Done."]);
  assert.deepEqual(splitSentences("Dr. Smith arrived. He sat."), ["Dr. Smith arrived.", "He sat."]);
  assert.deepEqual(splitSentences("The U.S. Senate voted. Then it adjourned."), ["The U.S. Senate voted.", "Then it adjourned."]);
});

test("numbers, brackets, emails and URLs do not break sentences", () => {
  assert.deepEqual(splitSentences("Pi is 3.14 and the bill was $1,234.56 in total. Next."), ["Pi is 3.14 and the bill was $1,234.56 in total.", "Next."]);
  assert.deepEqual(splitSentences("Wait... what happened? Nothing."), ["Wait... what happened?", "Nothing."]);
  assert.deepEqual(splitSentences("(It was late.) \"Stop.\" Then dawn."), ["(It was late.)", "\"Stop.\"", "Then dawn."]);
  assert.deepEqual(splitSentences("Mail a.b@example.co.uk or see https://example.com/a.b?x=1 today. Done."), ["Mail a.b@example.co.uk or see https://example.com/a.b?x=1 today.", "Done."]);
});

test("empty, whitespace-only and CJK text", () => {
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences(" \n\t "), []);
  assert.deepEqual(splitSentences("这是第一句。这是第二句！", "zh"), ["这是第一句。", "这是第二句！"]);
  const plan = buildPlan({ blocks: [{ k: "p", t: "   " }, { k: "p", t: "" }, { k: "p" }, { k: "p", t: "Real text." }] });
  assert.deepEqual(plan.units.map((unit) => [unit.b, unit.text]), [[3, "Real text."]]);
});

test("long text without spaces splits at CJK clause marks and never leaves a punctuation-only part", () => {
  const unbroken = "这是一个非常长的句子没有空格".repeat(40) + "。";
  const parts = splitSentences(unbroken, "zh");
  assert.ok(parts.every((part) => /[\p{L}\p{N}]/u.test(part)));
  assert.equal(parts.join(""), unbroken);
  const clauses = Array.from({ length: 30 }, (_, i) => `第${i}个分句的内容`).join("，") + "。";
  const split = splitSentences(clauses, "zh");
  assert.ok(split.length > 1);
  assert.ok(split.slice(0, -1).every((part) => part.endsWith("，")));
  assert.equal(split.join(""), clauses);
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

test("URLs keep the punctuation that follows them", () => {
  assert.equal(toSpeech("Visit https://example.com/path, then go."), "Visit example.com, then go.");
  assert.equal(toSpeech("See www.example.com/foo."), "See example.com.");
  assert.equal(toSpeech("Open (https://example.com/a.b?c=1)."), "Open (example.com).");
  assert.equal(toSpeech("Visit https://example.com."), "Visit example.com.");
  assert.equal(toSpeech("Write to john.doe@example.com today."), "Write to john.doe@example.com today.");
  assert.equal(toSpeech("It costs 1,234.56 dollars, about 3.14 each."), "It costs 1,234.56 dollars, about 3.14 each.");
  assert.equal(toSpeech("   "), "");
});

test("speech clean-up handles dates, ranges, symbols, emoji and abbreviations without changing meaning", () => {
  assert.equal(toSpeech("Released on 2026-10-04 for 20–60 users."), "Released on October 4, 2026 for 20 to 60 users.");
  assert.equal(toSpeech("Fast 🚀 and cheap ✨"), "Fast and cheap");
  assert.equal(toSpeech("Cats vs. dogs, approx. 30 each, w/ treats & toys."), "Cats versus dogs, approximately 30 each, with treats and toys.");
  assert.equal(toSpeech("A 1920x1080 screen → better."), "A 1920 by 1080 screen to better.");
  assert.equal(toSpeech("It works — mostly."), "It works, mostly.");
  assert.equal(toSpeech("Speed in km/h and TCP/IP stay as written."), "Speed in km/h and TCP/IP stay as written.");
  assert.equal(toSpeech("Ranked #1 overall."), "Ranked number 1 overall.");
  assert.equal(toSpeech("Not a date: 2026-13-45."), "Not a date: 2026-13-45.");
  assert.equal(toSpeech("Die Zahl 20–60 bleibt.", [], { lang: "de" }), "Die Zahl 20–60 bleibt.");
});

test("headings and list items get closing punctuation for natural intonation", () => {
  assert.equal(toSpeech("The hidden ridership", [], { close: true }), "The hidden ridership.");
  assert.equal(toSpeech("Is it worth it?", [], { close: true }), "Is it worth it?");
  assert.equal(toSpeech("Plain sentence", [], { close: false }), "Plain sentence");
  const plan = buildPlan({ blocks: [{ k: "h", t: "Title" }, { k: "li", t: "Item one" }, { k: "p", t: "Body text here." }] });
  assert.deepEqual(plan.units.map((unit) => unit.close), [true, true, false]);
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
