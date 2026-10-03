import test from "node:test";
import assert from "node:assert/strict";
import { blocksFromText, migrateLegacy, normalizePlayer, normalizeSettings } from "../../src/lib/store.js";

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
  assert.equal(out.settings.voice, "Zira");
  assert.deepEqual(out.settings.pronunciations, [{ from: "API", to: "A P I" }]);
});
