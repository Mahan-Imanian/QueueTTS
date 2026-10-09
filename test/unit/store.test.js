import test from "node:test";
import assert from "node:assert/strict";
import { blocksFromText, migrateLegacy, normalizeBlocks, normalizePlayer, normalizeQueue, normalizeSettings, parseExport, planImport, SCHEMA } from "../../src/lib/store.js";

const exported = (extra = {}) => JSON.stringify({
  app: "QueueTTS",
  schema: SCHEMA,
  queue: { items: [{ id: "a", title: "A", url: "https://a.example/1", source: "page" }, { id: "b", title: "B" }] },
  docs: { a: { blocks: [{ k: "p", t: "Alpha text." }] }, b: { blocks: [{ k: "p", t: "Beta text." }] } },
  ...extra
});

test("volume and pitch can be zero", () => {
  const settings = normalizeSettings({ volume: 0, pitch: 0, rate: 9 });
  assert.equal(settings.volume, 0);
  assert.equal(settings.pitch, 0);
  assert.equal(settings.rate, 3);
});

test("unknown player status falls back to idle", () => {
  assert.equal(normalizePlayer({ status: "weird" }).status, "idle");
  assert.equal(normalizePlayer({ status: "playing", pos: { b: 1, s: 2 } }).pos.s, 2);
});

test("pasted text keeps paragraphs and joins wrapped lines", () => {
  assert.deepEqual(blocksFromText("First line\nwraps here.\n\nSecond para."), [{ k: "p", t: "First line wraps here." }, { k: "p", t: "Second para." }]);
});

test("legacy v2 data migrates and drops failed captures", () => {
  const out = migrateLegacy({
    settings: { voiceName: "Zira", rate: 1.2, theme: "light", dictionary: "API => A P I" },
    queue: [
      { id: "x", title: "Done one", text: "Para one.\n\nPara two.", state: "completed", sourceType: "page", sourceUrl: "https://www.a.com/p?utm_source=z", completedAt: 5 },
      { id: "y", title: "Failed", text: "", state: "failed" },
      { id: "z", title: "Queued", text: "Hello there.", state: "queued", sourceType: "paste" }
    ]
  });
  assert.deepEqual(out.queue.items.map((entry) => [entry.id, entry.status]), [["x", "done"], ["z", "queued"]]);
  assert.equal(out.queue.items[0].url, "https://a.com/p");
  assert.equal(out.docs["doc:x"].blocks.length, 2);
  assert.deepEqual(out.settings.voices, { en: "Zira" });
  assert.deepEqual(out.settings.pronunciations, [{ from: "API", to: "A P I" }]);
});

test("an export file is rejected when it is malformed, foreign or from another schema", () => {
  assert.equal(parseExport("{not json").ok, false);
  assert.equal(parseExport("null").ok, false);
  assert.equal(parseExport(JSON.stringify({ app: "Other", schema: SCHEMA, queue: { items: [] } })).ok, false);
  assert.match(parseExport(exported({ schema: SCHEMA + 1 })).message, /newer version/);
  assert.equal(parseExport(exported({ schema: undefined })).ok, false);
  assert.equal(parseExport(exported({ queue: "nope" })).ok, false);
  const good = parseExport(exported());
  assert.equal(good.ok, true);
  assert.deepEqual(good.queue.items.map((item) => item.id), ["a", "b"]);
});

test("a 2.x backup file imports through the legacy migration", () => {
  const parsed = parseExport(JSON.stringify({ product: "QueueTTS", exportedAt: "2026-06-01T00:00:00Z", state: { settings: { rate: 2 }, queue: [{ id: "old", title: "Old one", text: "Kept text.", state: "queued", sourceType: "paste" }] } }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.queue.items.map((item) => item.id), ["old"]);
  assert.deepEqual(parsed.docs.old.blocks, [{ k: "p", t: "Kept text." }]);
  assert.equal(parsed.settings, undefined);
});

test("importing skips duplicates, items without text and malformed blocks", () => {
  const current = { items: [{ id: "a", url: "https://a.example/1", source: "page", status: "queued" }] };
  const payload = {
    queue: { items: [{ id: "a" }, { id: "dup-url", url: "https://a.example/1", source: "page" }, { id: "c" }, { id: "c" }, { id: "empty" }, { id: "bad" }, { id: 7 }] },
    docs: { a: { blocks: [{ k: "p", t: "x" }] }, "dup-url": { blocks: [{ k: "p", t: "x" }] }, c: { blocks: [null, { k: "p", t: "Gamma." }, { k: "weird", t: "y" }, { k: "h", t: "Head" }] }, empty: { blocks: [{ k: "p", t: "   " }] }, bad: { blocks: "nope" } }
  };
  const plan = planImport(normalizeQueue(current), payload);
  assert.deepEqual(plan.queue.items.map((item) => item.id), ["a", "c"]);
  assert.equal(plan.added, 1);
  assert.equal(plan.skipped, 4);
  assert.deepEqual(plan.docs.get("c").blocks, [{ k: "p", t: "" }, { k: "p", t: "Gamma." }, { k: "p", t: "" }, { k: "h", t: "Head", l: 2 }]);
});

test("block normalisation keeps indices stable so saved positions stay valid", () => {
  assert.deepEqual(normalizeBlocks([{ k: "code", t: "npm i" }, 5, { k: "li", t: 3 }]), [{ k: "code", t: "npm i" }, { k: "p", t: "" }, { k: "p", t: "" }]);
  assert.deepEqual(normalizeBlocks(undefined), []);
});

test("legacy items with missing, numeric or repeated ids keep their own text", () => {
  const out = migrateLegacy({
    queue: [
      { id: "same", text: "First text." },
      { id: "same", text: "Second text." },
      { id: 42, text: "Numbered text." },
      { text: "No id, no title, no state." }
    ]
  });
  const ids = out.queue.items.map((item) => item.id);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => typeof id === "string"));
  assert.deepEqual(out.queue.items.map((item) => out.docs[`doc:${item.id}`].blocks[0].t), ["First text.", "Second text.", "Numbered text.", "No id, no title, no state."]);
  assert.equal(normalizeQueue(out.queue).items.length, 4);
  assert.equal(out.queue.items[3].title, "No id, no title, no state.");
  assert.equal(out.queue.items[3].status, "queued");
  assert.equal(out.settings.onboarded, true);
  assert.deepEqual(migrateLegacy(null).queue.items, []);
});

test("stored records with missing fields are filled with safe defaults", () => {
  const [item] = normalizeQueue({ items: [{ id: "x" }] }).items;
  assert.equal(item.title, "Untitled");
  assert.equal(item.status, "queued");
  assert.equal(item.pos, null);
  assert.equal(item.progress, 0);
  assert.deepEqual(normalizeQueue(undefined).items, []);
  assert.equal(normalizeSettings(null).rate, 1);
  assert.equal(normalizePlayer(undefined).status, "idle");
});
