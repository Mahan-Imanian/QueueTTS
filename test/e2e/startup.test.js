import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { launch, localVoiceAvailable, sentences, sleep } from "./harness.mjs";

let app;
let realVoices = false;

before(async () => {
  app = await launch();
  realVoices = await localVoiceAvailable(app);
});
after(() => app?.close());
beforeEach(async () => {
  await app.send("reset");
  await app.quietVoice();
  const worker = await app.worker();
  await worker.evaluate(() => delete globalThis.__qttsTTS);
});

const recordingSpeech = async ({ wordDelay = 20, startDelay = 5 } = {}) => {
  const worker = await app.worker();
  await worker.evaluate((wordDelay, startDelay) => {
    globalThis.__qttsTTS = {
      log: [],
      current: 0,
      speak(text, options, done) {
        const id = ++this.current;
        this.log.push({ type: "speak", text, volume: options.volume, at: Date.now() });
        done?.();
        setTimeout(() => {
          if (this.current !== id) return;
          this.log.push({ type: "start", at: Date.now() });
          options.onEvent({ type: "start", charIndex: 0 });
          setTimeout(() => {
            if (this.current !== id) return;
            this.log.push({ type: "word", at: Date.now() });
            options.onEvent({ type: "word", charIndex: 0, length: 5 });
            setTimeout(() => this.current === id && options.onEvent({ type: "end", charIndex: text.length }), 60);
          }, wordDelay);
        }, startDelay);
      },
      stop() {
        this.log.push({ type: "stop", at: Date.now() });
        this.current = 0;
      },
      getVoices(callback) {
        callback([{ voiceName: "Fake voice", lang: "en-US", remote: false, eventTypes: ["start", "word", "end"] }]);
      }
    };
  }, wordDelay, startDelay);
  return worker;
};

test("the first utterance starts at the first word of the article and is never cut short by the player", async () => {
  const worker = await recordingSpeech();
  const item = (await app.send("addText", "Opening words matter most. The second sentence follows.", "First words")).item;
  await app.send("play", item.id);
  await app.waitFor(() => worker.evaluate(() => globalThis.__qttsTTS.log.filter((entry) => entry.type === "speak" && entry.text.length > 2).length >= 2), { label: "second sentence spoken" });
  const log = await worker.evaluate(() => globalThis.__qttsTTS.log);
  const isArticle = (entry) => entry.type === "speak" && entry.text.length > 2;
  const speaks = log.filter(isArticle);
  assert.equal(speaks[0].text, "Opening words matter most.");
  const firstSpeak = log.indexOf(log.find(isArticle));
  const firstWord = log.findIndex((entry, index) => index > firstSpeak && entry.type === "word");
  assert.ok(firstWord > firstSpeak, "the engine reported the first word");
  assert.ok(!log.slice(firstSpeak, firstWord).some((entry) => entry.type === "stop"), "no stop() between speak() and the first word");
  await app.send("pause");
});

test("the player only says Playing once the engine reports the first spoken word", async () => {
  await recordingSpeech({ wordDelay: 700 });
  const item = (await app.send("addText", sentences(4), "Late words")).item;
  await app.send("play", item.id);
  await app.waitFor(async () => (await app.player()).pos != null, { label: "engine start event" });
  await sleep(250);
  const early = await app.player();
  assert.notEqual(early.status, "playing", `status was ${early.status} before any word was spoken`);
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "playing after the first word", timeout: 5000 });
  await app.send("pause");
});

test("voices without word events are confirmed as playing from their start event", async () => {
  const worker = await recordingSpeech({ wordDelay: 5000 });
  await worker.evaluate(() => {
    globalThis.__qttsTTS.getVoices = (callback) => callback([{ voiceName: "Online", lang: "en-US", remote: true, eventTypes: ["start", "end"] }]);
  });
  await app.send("settings", { allowNetworkVoices: true, voices: { en: "Online" } });
  const item = (await app.send("addText", sentences(3), "No words")).item;
  await app.send("play", item.id);
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "playing from start", timeout: 3000 });
  await app.send("pause");
  await app.send("settings", { allowNetworkVoices: false, voices: {} });
});

test("opening QueueTTS warms the speech engine silently without touching playback state", async () => {
  const worker = await recordingSpeech();
  await app.send("addText", sentences(3), "Warm-up");
  const before = await app.player();
  const panel = await app.browser.newPage();
  await panel.goto(app.url("pages/panel.html"));
  await app.waitFor(() => worker.evaluate(() => globalThis.__qttsTTS.log.some((entry) => entry.type === "speak")), { label: "warm-up utterance" });
  const log = await worker.evaluate(() => globalThis.__qttsTTS.log);
  const warm = log.find((entry) => entry.type === "speak");
  assert.equal(warm.volume, 0, "warm-up is silent");
  assert.ok(warm.text.length <= 2, "warm-up never speaks article text");
  await sleep(300);
  const after = await app.player();
  assert.equal(after.status, before.status);
  assert.deepEqual(after.pos, before.pos);
  await panel.close();
});

test("starting playback keeps the audio output awake with an offscreen document", async () => {
  const worker = await recordingSpeech();
  const item = (await app.send("addText", sentences(3), "Audio path")).item;
  await app.send("play", item.id);
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "playing" });
  const contexts = await worker.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).map((context) => context.documentUrl));
  assert.ok(contexts.some((url) => url.endsWith("pages/audio.html")), "audio keep-alive document is open");
  const { lastStart } = await app.session();
  assert.ok(lastStart.marks.some((entry) => entry.name === "audio path ready"));
  await app.send("pause");
});

test("QueueTTS adds almost no delay of its own before speech starts", async () => {
  await recordingSpeech();
  const item = (await app.send("addText", sentences(3), "Budget")).item;
  await app.send("play", item.id);
  await app.send("pause");
  await sleep(200);
  await app.control.evaluate(() => chrome.storage.session.remove("lastStart"));
  await app.send("toggle");
  const trace = await app.waitFor(async () => (await app.session()).lastStart, { label: "trace" });
  const speak = trace.marks.find((entry) => entry.name === "speak called").ms;
  assert.ok(speak < 60, `resume reached speak() after ${speak} ms`);
  await app.send("pause");
});

test("a remembered voice that is no longer installed falls back without an error", async () => {
  await recordingSpeech();
  await app.send("settings", { voices: { en: "Voice That Was Uninstalled" } });
  const item = (await app.send("addText", sentences(3), "Fallback")).item;
  await app.send("play", item.id);
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "playing with the fallback voice" });
  const { lastStart } = await app.session();
  assert.equal(lastStart.marks.find((entry) => entry.name === "voice ready").voice, "Fake voice");
  await app.send("pause");
  await app.send("settings", { voices: {} });
});

test("real voice: first play, resume and next item all start at character 0 and stay fast", async (t) => {
  if (!realVoices) return t.skip("no local voice");
  const first = (await app.send("addText", "First article opens here. It has a second sentence.", "One")).item;
  await app.send("addText", "Second article opens here. Short and sweet.", "Two");
  const traces = [];
  const run = async (command, ...args) => {
    await app.control.evaluate(() => chrome.storage.session.remove("lastStart"));
    await app.send(command, ...args);
    traces.push(await app.waitFor(async () => (await app.session()).lastStart, { label: `${command} trace`, timeout: 10000 }));
  };
  await run("play", first.id);
  await app.send("pause");
  await sleep(500);
  await run("toggle");
  await app.waitFor(async () => (await app.player()).itemId !== first.id, { label: "advance to the second article", timeout: 20000 });
  traces.push(await app.waitFor(async () => {
    const trace = (await app.session()).lastStart;
    return trace?.reason === "advance" ? trace : null;
  }, { label: "advance trace", timeout: 10000 }));
  for (const trace of traces) {
    const word = trace.marks.find((entry) => entry.name === "first word");
    assert.equal(word.charIndex, 0, `${trace.reason}: first word at character 0`);
    assert.ok(word.ms < 2000, `${trace.reason}: first word after ${word.ms} ms`);
  }
  await app.send("pause");
});
