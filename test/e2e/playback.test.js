import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { buildCopy, launch, localVoiceAvailable, sentences, sleep } from "./harness.mjs";

let app;
let skip = false;

before(async () => {
  app = await launch();
  skip = !(await localVoiceAvailable(app));
});
after(() => app?.close());
beforeEach(async () => {
  if (!app) return;
  await app.send("reset");
  await app.quietVoice();
});

const add = async (text, title) => {
  const result = await app.send("addText", text, title);
  assert.ok(result.ok, result.message);
  return result.item;
};
const until = (check, label, timeout) => app.waitFor(check, { label, timeout });
const playingAt = async (id, minSentence = 0) => until(async () => {
  const player = await app.player();
  return player.itemId === id && player.status === "playing" && (player.pos?.s ?? 0) + (player.pos?.b ?? 0) * 100 >= minSentence ? player : null;
}, `item ${id} playing past sentence ${minSentence}`, 20000);
const item = async (id) => (await app.queue()).find((entry) => entry.id === id);
const fakeSpeech = async ({ fail = false } = {}) => {
  const worker = await app.worker();
  await worker.evaluate((fail) => {
    globalThis.__qttsTTS = {
      spoken: [],
      current: 0,
      speak(text, options, done) {
        this.spoken.push(text);
        const id = ++this.current;
        done?.();
        setTimeout(() => {
          if (this.current !== id) return;
          if (fail) return options.onEvent({ type: "error", errorMessage: "synthetic engine failure" });
          options.onEvent({ type: "start", charIndex: 0 });
          setTimeout(() => this.current === id && options.onEvent({ type: "end", charIndex: text.length }), 25);
        }, 5);
      },
      stop() {
        this.current = 0;
      },
      getVoices(callback) {
        callback([{ voiceName: "Fake voice", lang: "en-US", remote: false }]);
      }
    };
  }, fail);
  return worker;
};
const realSpeech = async () => {
  const worker = await app.worker();
  await worker.evaluate(() => delete globalThis.__qttsTTS);
};

test("capturing while listening never hijacks the current item or marks the new one finished", { skip }, async () => {
  const a = await add(sentences(14, "Alpha"), "Alpha");
  await app.send("play", a.id);
  await playingAt(a.id, 1);
  const page = await app.fixture("https://metroreview.example/cities/night-bus", "news.html");
  const captured = await app.send("capture", await app.tabId(page), "page", "end");
  await page.close();
  assert.ok(captured.ok);
  const now = await app.player();
  assert.equal(now.itemId, a.id, "the current item did not change");
  assert.equal(now.status, "playing");
  await sleep(2500);
  const later = await app.player();
  assert.equal(later.itemId, a.id);
  assert.ok(later.pos.s > now.pos.s, "playback kept advancing through the original item");
  const b = await item(captured.item.id);
  assert.equal(b.status, "queued");
  assert.equal(b.finishedAt, 0);
  assert.equal(b.listenedMs, 0);
  const { stats } = await app.storage("stats");
  assert.ok(!Object.values(stats?.days || {}).some((day) => day.finished), "nothing was counted as finished");
  await app.send("pause");
});

test("several additions during playback queue up in the order they were added", { skip }, async () => {
  const a = await add(sentences(10, "Alpha"), "Alpha");
  await app.send("play", a.id);
  await playingAt(a.id);
  const b = await add(sentences(3, "Bravo"), "Bravo");
  const c = await add(sentences(3, "Charlie"), "Charlie");
  const d = await add(sentences(3, "Delta"), "Delta");
  const order = (await app.queue()).filter((entry) => entry.status === "queued").map((entry) => entry.id);
  assert.deepEqual(order, [a.id, b.id, c.id, d.id]);
  assert.equal((await app.player()).itemId, a.id);
  await app.send("pause");
});

test("finishing an item records real listening time, moves it to history and plays the next", { skip }, async () => {
  const a = await add("Alpha one is short. Alpha two is short too.", "Alpha");
  const b = await add("Bravo one is here. Bravo two follows it.", "Bravo");
  await app.send("play", a.id);
  await until(async () => (await item(a.id))?.status === "done", "first item finished", 30000);
  const finished = await item(a.id);
  assert.ok(finished.listenedMs > 200 && finished.listenedMs < 60000, `listened ${finished.listenedMs} ms`);
  assert.equal(finished.progress, 1);
  await playingAt(b.id);
  await until(async () => (await app.player()).status === "completed", "queue completed", 30000);
  const player = await app.player();
  assert.equal(player.itemId, "");
  const { stats } = await app.storage("stats");
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(stats.days[key].finished, 2, "counted under today's local date");
  assert.ok(stats.days[key].ms > 400);
});

test("resume works after a pause longer than the service worker's lifetime", { skip, timeout: 120000 }, async () => {
  const a = await add(sentences(30, "Long"), "Long");
  await app.send("play", a.id);
  await playingAt(a.id, 1);
  await app.send("pause");
  const paused = await app.player();
  assert.equal(paused.status, "paused");
  await until(async () => !app.swAlive(), "service worker to be suspended by Chrome", 75000);
  await app.send("toggle");
  const resumed = await playingAt(a.id, paused.pos.s + 1);
  assert.equal(resumed.status, "playing");
  await app.send("pause");
});

test("a service worker killed mid-sentence recovers and keeps reading (watchdog, no UI open)", { skip, timeout: 120000 }, async () => {
  const a = await add(sentences(40, "Steady"), "Steady");
  await app.send("play", a.id);
  const before = await playingAt(a.id, 1);
  await app.stopWorker();
  await until(async () => {
    const player = await app.player();
    return player.itemId === a.id && player.status === "playing" && player.pos.s > before.pos.s + 1 && player.updatedAt > Date.now() - 5000 ? player : null;
  }, "playback to recover after the worker was killed", 70000);
  await app.send("pause");
});

test("the UI never shows Playing after a browser restart, and the first press plays", { skip: false, timeout: 120000 }, async (t) => {
  const extension = buildCopy();
  const profile = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "qtts-restart-"));
  let first = await launch({ extension, profile });
  if (!(await localVoiceAvailable(first))) {
    await first.close({ keepProfile: true });
    return t.skip("no local voice");
  }
  await first.quietVoice();
  const a = (await first.send("addText", sentences(30, "Restart"), "Restart")).item;
  await first.send("play", a.id);
  await first.waitFor(async () => ((await first.player()).pos?.s ?? 0) >= 2, { label: "progress before restart", timeout: 20000 });
  const before = await first.player();
  await first.browser.close();
  const second = await launch({ extension, profile });
  try {
    const restored = await second.waitFor(async () => {
      const player = await second.player();
      return player.status !== "playing" ? player : null;
    }, { label: "stale playing status to be cleared" });
    assert.equal(restored.status, "paused");
    assert.equal(restored.itemId, a.id);
    assert.ok(restored.pos.s >= before.pos.s, "position survived the restart");
    const queue = await second.queue();
    assert.equal(queue.length, 1);
    await second.send("toggle");
    await second.waitFor(async () => (await second.player()).status === "playing", { label: "first press to play", timeout: 15000 });
    await second.send("pause");
  } finally {
    await second.close({ keepProfile: true });
  }
});

test("speech failures fall back once, then surface a clear error instead of pretending to play", async () => {
  await fakeSpeech({ fail: true });
  await app.send("settings", { voice: "Fake voice" });
  const a = await add(sentences(3), "Fails");
  await app.send("play", a.id);
  const player = await until(async () => {
    const value = await app.player();
    return value.status === "error" ? value : null;
  }, "error status");
  assert.match(player.error, /synthetic engine failure/);
  await realSpeech();
  await app.send("dismissError");
  assert.equal((await app.player()).status, "paused");
  await app.send("settings", { voice: "" });
});

test("headings are never spoken as 'Heading' and code is skipped by default", async () => {
  const worker = await fakeSpeech();
  const page = await app.fixture("https://github.com/acme/nightline", "github.html");
  const captured = await app.send("capture", await app.tabId(page), "page", "end");
  await page.close();
  await app.send("play", captured.item.id);
  await until(async () => (await item(captured.item.id))?.status === "done", "fake playback to finish", 20000);
  const spoken = await worker.evaluate(() => globalThis.__qttsTTS.spoken);
  assert.ok(spoken.length > 5);
  assert.ok(!spoken.some((text) => /^(heading|section)\b/i.test(text)), "no artificial heading labels");
  assert.ok(!spoken.some((text) => text.includes("brew install")), "code blocks are skipped");
  assert.ok(spoken.includes("Why another scheduler?"));
  await realSpeech();
});

test("storage write failures are reported and clear once saving works again", async () => {
  const worker = await app.worker();
  await worker.evaluate(() => {
    globalThis.__realSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
  });
  const failed = await app.send("addText", "This should not be saved because storage is full.");
  assert.equal(failed.ok, false);
  assert.match(failed.message, /storage is full/i);
  const session = await app.session();
  assert.match(session.health.storage, /storage is full/i);
  await worker.evaluate(() => (chrome.storage.local.set = globalThis.__realSet));
  const ok = await app.send("addText", "Now there is room again for this text.");
  assert.ok(ok.ok);
  assert.ok(!(await app.session()).health?.storage);
});

test("rapid play and pause presses leave a consistent state", { skip }, async () => {
  const a = await add(sentences(20, "Rapid"), "Rapid");
  await app.send("play", a.id);
  for (let index = 0; index < 16; index += 1) {
    app.send("toggle");
    await sleep(40);
  }
  await sleep(800);
  await app.send("pause");
  await sleep(300);
  const speaking = await app.control.evaluate(() => new Promise((resolve) => chrome.tts.isSpeaking(resolve)));
  assert.equal((await app.player()).status, "paused");
  assert.equal(speaking, false, "no orphaned speech after pausing");
  await app.send("play");
  await playingAt(a.id);
  await app.send("pause");
});

test("sentence skips, item skips and removal behave predictably", async () => {
  await fakeSpeech();
  await app.send("settings", { autoAdvance: false });
  const a = await add(sentences(8, "Alpha"), "Alpha");
  const b = await add(sentences(8, "Bravo"), "Bravo");
  await app.send("skip", 3);
  assert.equal((await app.player()).pos.s, 3);
  await app.send("skip", -2);
  assert.equal((await app.player()).pos.s, 1);
  await app.send("skipItem");
  let queue = (await app.queue()).filter((entry) => entry.status === "queued").map((entry) => entry.id);
  assert.deepEqual(queue, [b.id, a.id], "skipped item goes to the end, keeping its place");
  assert.equal((await item(a.id)).pos.s, 1);
  const removed = await app.send("remove", b.id);
  assert.equal((await app.player()).itemId, a.id);
  await app.send("restore", removed.removed);
  queue = (await app.queue()).map((entry) => entry.id);
  assert.ok(queue.includes(b.id));
  await realSpeech();
});

test("an item whose text is missing is removed with an explanation", async () => {
  const a = await add(sentences(3), "Broken");
  await app.control.evaluate((id) => chrome.storage.local.remove(`doc:${id}`), a.id);
  await app.send("play", a.id);
  const player = await until(async () => {
    const value = await app.player();
    return value.status === "error" ? value : null;
  }, "error for missing text");
  assert.match(player.error, /no readable text/);
  assert.equal(await item(a.id), undefined);
});

test("mark as listened, mark as not listened and reordering", async () => {
  const a = await add(sentences(3, "A"), "A");
  const b = await add(sentences(3, "B"), "B");
  const c = await add(sentences(3, "C"), "C");
  await app.send("move", c.id, 1);
  let order = (await app.queue()).filter((entry) => entry.status === "queued").map((entry) => entry.id);
  assert.deepEqual(order, [a.id, c.id, b.id]);
  await app.send("done", b.id);
  assert.equal((await item(b.id)).status, "done");
  await app.send("unplayed", b.id);
  order = (await app.queue()).filter((entry) => entry.status === "queued").map((entry) => entry.id);
  assert.deepEqual(order, [a.id, c.id, b.id]);
  await app.send("playNext", b.id);
  order = (await app.queue()).filter((entry) => entry.status === "queued").map((entry) => entry.id);
  assert.deepEqual(order, [a.id, b.id, c.id]);
});

test("volume and pitch of zero are kept", async () => {
  await app.send("settings", { volume: 0, pitch: 0 });
  const { settings } = await app.storage("settings");
  assert.equal(settings.volume, 0);
  assert.equal(settings.pitch, 0);
  await app.send("settings", { pitch: 1 });
});
