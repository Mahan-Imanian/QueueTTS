import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launch, sentences, sleep } from "./harness.mjs";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
let app;

before(async () => {
  app = await launch();
});
after(() => app?.close());
beforeEach(async () => {
  await app.send("reset");
  await app.quietVoice();
});

const fakeSpeech = async () => {
  const worker = await app.worker();
  await worker.evaluate(() => {
    globalThis.__qttsTTS = {
      current: 0,
      speak(text, options, done) {
        const id = ++this.current;
        done?.();
        setTimeout(() => {
          if (this.current !== id) return;
          options.onEvent({ type: "start", charIndex: 0 });
          const words = text.split(" ");
          let offset = 0;
          words.forEach((word, index) => {
            const at = offset;
            setTimeout(() => this.current === id && options.onEvent({ type: "word", charIndex: at, length: word.length }), index * 20);
            offset += word.length + 1;
          });
          setTimeout(() => this.current === id && options.onEvent({ type: "end", charIndex: text.length }), words.length * 20 + 40);
        }, 5);
      },
      stop() {
        this.current = 0;
      },
      getVoices(callback) {
        callback([{ voiceName: "Fake voice", lang: "en-US", remote: false }]);
      }
    };
  });
  return worker;
};

const openPage = async (path, width = 380, height = 800) => {
  const page = await app.browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && !/Failed to load resource/.test(message.text()) && errors.push(message.text()));
  await page.goto(app.url(path), { waitUntil: "domcontentloaded" });
  await sleep(500);
  page.errors = errors;
  return page;
};

const axe = async (page) => {
  await page.evaluate(axeSource);
  return page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => `${violation.id}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(", ")}`));
};

test("keyboard focus stays put in the side panel while playback advances", async () => {
  await fakeSpeech();
  const a = (await app.send("addText", sentences(40, "Focus"), "Focus test")).item;
  await app.send("addText", sentences(5, "Other"), "Second");
  await app.send("addText", sentences(5, "Third"), "Third");
  const panel = await openPage("pages/panel.html");
  await panel.focus("#queueList li:nth-child(2) .row-main");
  await app.send("play", a.id);
  const start = (await app.waitFor(async () => (await app.player()).pos, { label: "first sentence" })).s;
  await app.waitFor(async () => (await app.player()).pos.s > start + 5, { label: "several sentences of progress" });
  const focused = await panel.evaluate(() => document.activeElement?.closest("li")?.querySelector(".row-title")?.textContent);
  assert.equal(focused, "Third");
  assert.deepEqual(panel.errors, []);
  await app.send("pause");
  await panel.close();
});

test("queue can be reordered and played entirely from the keyboard", async () => {
  const a = (await app.send("addText", sentences(3, "A"), "Alpha")).item;
  await app.send("addText", sentences(3, "B"), "Bravo");
  await app.send("addText", sentences(3, "C"), "Charlie");
  await app.send("addText", sentences(3, "D"), "Delta");
  const panel = await openPage("pages/panel.html");
  assert.equal(await panel.$eval(".deck-title", (node) => node.textContent), "Alpha", "the current item lives in the deck, not the list");
  await panel.focus("#queueList li:nth-child(1) .row-main");
  await panel.keyboard.down("Alt");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.up("Alt");
  await sleep(300);
  const titles = await panel.$$eval("#queueList .row-title", (nodes) => nodes.map((node) => node.textContent));
  assert.deepEqual(titles, ["Charlie", "Bravo", "Delta"]);
  const focused = await panel.evaluate(() => document.activeElement?.closest("li")?.querySelector(".row-title")?.textContent);
  assert.equal(focused, "Bravo", "focus follows the moved item");
  await panel.keyboard.press("ArrowUp");
  await panel.keyboard.press("Delete");
  await sleep(300);
  assert.deepEqual(await panel.$$eval("#queueList .row-title", (nodes) => nodes.map((node) => node.textContent)), ["Bravo", "Delta"]);
  assert.ok(await panel.$(".toast"), "removal offers undo");
  await panel.click(".toast .btn");
  await sleep(300);
  assert.equal((await app.queue()).length, 4);
  assert.equal((await app.player()).itemId, a.id);
  await panel.close();
});

test("the deck ruler marks real sections and seeks when clicked", async () => {
  await fakeSpeech();
  const page = await app.fixture("https://github.com/acme/nightline", "github.html");
  const captured = await app.send("capture", await app.tabId(page), "page", "end");
  await page.close();
  const doc = (await app.storage(`doc:${captured.item.id}`))[`doc:${captured.item.id}`];
  const panel = await openPage("pages/panel.html");
  const ticks = await panel.$$eval(".ruler-tick", (nodes) => nodes.length);
  assert.equal(ticks, doc.blocks.filter((block) => block.k === "h").length);
  const box = await panel.$eval(".ruler-track", (node) => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }; });
  await panel.mouse.click(box.x + box.w * 0.8, box.y + box.h / 2);
  await app.waitFor(async () => (await app.player()).pos?.b > 3, { label: "seek from the ruler" });
  await app.send("pause");
  await panel.close();
});

test("speed and voice popovers save choices and disclose online voices", async () => {
  const worker = await fakeSpeech();
  await worker.evaluate(() => {
    globalThis.__qttsTTS.getVoices = (callback) => callback([
      { voiceName: "Fake voice", lang: "en-US", remote: false, eventTypes: ["start", "word", "end"] },
      { voiceName: "Google US English", lang: "en-US", remote: true, eventTypes: ["start", "end"] }
    ]);
  });
  await app.send("settings", { allowNetworkVoices: false, voices: {} });
  await app.send("voices");
  await app.send("addText", sentences(5), "Voice test");
  const panel = await openPage("pages/panel.html");
  await panel.click("[data-act='speed']");
  await panel.click("[data-rate='1.25']");
  await app.waitFor(async () => (await app.storage("settings")).settings.rate === 1.25, { label: "speed preset saved" });
  assert.equal(await panel.$eval("[data-act='speed']", (node) => node.textContent.trim()), "1.25×");
  await panel.keyboard.press("Escape");
  await panel.click("[data-act='voice']");
  const text = await panel.$eval("[data-role='voicePop']", (node) => node.textContent);
  assert.match(text, /text is sent to Google/);
  await panel.click("[data-voice='Google US English']");
  await app.waitFor(async () => (await app.storage("settings")).settings.voices.en === "Google US English", { label: "voice saved per language" });
  assert.equal((await app.storage("settings")).settings.allowNetworkVoices, true, "choosing an online voice explicitly allows it");
  await panel.close();
  await app.send("settings", { allowNetworkVoices: false, voices: {}, rate: 2 });
});

test("the empty workspace explains the product and the sample plays immediately", async () => {
  await fakeSpeech();
  const panel = await openPage("pages/panel.html");
  assert.ok(await panel.$("#welcome:not([hidden])"));
  assert.ok(await panel.$("#ghost:not([hidden])"), "shows where the queue will appear");
  await panel.click("#trySample");
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "sample playing" });
  assert.ok(await panel.$("#deck:not([hidden])"));
  assert.ok(await panel.$("#welcome[hidden]"));
  await app.send("pause");
  await panel.close();
});

test("the popup captures the current page and confirms inline with undo", async () => {
  const article = await app.fixture("https://metroreview.example/cities/night-bus", "news.html");
  await article.bringToFront();
  const worker = await app.worker();
  await worker.evaluate(async () => {
    const [win] = await chrome.windows.getAll({ windowTypes: ["normal"] });
    await chrome.action.openPopup({ windowId: win.id });
  });
  const target = await app.browser.waitForTarget((candidate) => candidate.url().endsWith("pages/popup.html"));
  const popup = await target.asPage();
  await popup.waitForFunction(() => document.querySelector("#hereActions .btn-primary"));
  assert.equal(await popup.$eval("#hereTitle", (node) => node.textContent), "Why Cities Are Rethinking the Night Bus");
  await popup.click("#hereActions .btn-primary");
  await popup.waitForFunction(() => /Added/.test(document.querySelector("#hereMeta").textContent));
  assert.equal((await app.queue()).length, 1);
  assert.ok(await popup.$("#deck:not([hidden])"), "the deck appears once something is queued");
  await popup.click("#hereActions .btn");
  await app.waitFor(async () => (await app.queue()).length === 0, { label: "undo to remove the capture" });
  await article.close();
});

test("every surface passes axe with no serious issues, in light and dark", async () => {
  await app.send("addText", sentences(6, "Accessible"), "Accessible item");
  await app.send("addText", sentences(6, "Second"), "Second item");
  for (const theme of ["light", "dark"]) {
    await app.send("settings", { theme });
    for (const [path, width] of [["pages/panel.html", 380], ["pages/popup.html", 360], ["pages/options.html", 1000], ["pages/welcome.html", 1000]]) {
      const page = await openPage(path, width);
      const violations = await axe(page);
      assert.deepEqual(violations, [], `${theme} ${path}`);
      assert.deepEqual(page.errors, [], `${theme} ${path} console`);
      await page.close();
    }
  }
  await app.send("settings", { theme: "system" });
});

test("light and dark themes use their own surfaces and text colours", async () => {
  const colors = {};
  for (const theme of ["light", "dark"]) {
    await app.send("settings", { theme });
    const page = await openPage("pages/panel.html");
    colors[theme] = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.querySelector(".brand")).color }));
    await page.close();
  }
  assert.notEqual(colors.light.bg, colors.dark.bg);
  assert.notEqual(colors.light.ink, colors.dark.ink);
  assert.equal(colors.light.bg, "rgb(246, 244, 239)");
  assert.equal(colors.dark.bg, "rgb(20, 19, 17)");
  await app.send("settings", { theme: "system" });
});

test("settings controls save immediately, including switches and theme", async () => {
  const options = await openPage("pages/options.html", 1000);
  await options.click("#readCode");
  await options.click("[name='theme'][value='dark'] + span");
  await options.$eval("#rate", (input) => {
    input.value = "1.6";
    input.dispatchEvent(new Event("change"));
  });
  await sleep(400);
  const { settings } = await app.storage("settings");
  assert.equal(settings.readCode, true);
  assert.equal(settings.theme, "dark");
  assert.equal(settings.rate, 1.6);
  const box = await options.$eval("#readCode", (input) => input.getBoundingClientRect().width);
  assert.ok(box < 40, "switches render as switches, not 40px slabs");
  await options.close();
  await app.send("settings", { readCode: false, theme: "system", rate: 2 });
});

test("the reading view highlights the sentence being read and seeks on click", async () => {
  await fakeSpeech();
  const a = (await app.send("addText", sentences(30, "Reader"), "Reading test")).item;
  const panel = await openPage("pages/panel.html?view=reader");
  await app.send("play", a.id);
  await panel.waitForFunction(() => document.querySelector(".reader .s.now"));
  await panel.waitForFunction(() => document.querySelector(".reader .s.now mark"), { timeout: 5000 });
  assert.ok(await panel.$("body.reading"), "read-along mode compacts the deck");
  await app.send("pause");
  await panel.$eval(".reader .s[data-s='20']", (node) => node.scrollIntoView({ block: "center" }));
  await panel.click(".reader .s[data-s='20']");
  await app.waitFor(async () => (await app.player()).pos?.s >= 20, { label: "seek by clicking a sentence" });
  await app.send("pause");
  await panel.close();
});
