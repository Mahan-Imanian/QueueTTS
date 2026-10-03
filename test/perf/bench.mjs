import { launch, sleep } from "../e2e/harness.mjs";

const SIZES = (process.argv[2] || "10,100,300,500,1000").split(",").map(Number);
const app = await launch();
await app.quietVoice();

const worker = await app.worker();
await worker.evaluate(() => {
  globalThis.__speakTimes = [];
  globalThis.__qttsTTS = {
    current: 0,
    speak(text, options, done) {
      globalThis.__speakTimes.push(performance.now());
      const id = ++this.current;
      done?.();
      setTimeout(() => {
        if (this.current !== id) return;
        options.onEvent({ type: "start", charIndex: 0 });
        setTimeout(() => this.current === id && options.onEvent({ type: "end", charIndex: text.length }), 30);
      }, 0);
    },
    stop() {
      this.current = 0;
    },
    getVoices(callback) {
      callback([{ voiceName: "Fake voice", lang: "en-US", remote: false }]);
    }
  };
});

const seed = async (count) => {
  const started = Date.now();
  for (let from = 0; from < count; from += 100) {
    await app.control.evaluate(async (from, to) => {
      const paragraph = "Transit agencies treated the night bus as a cost to be minimized rather than a network to be designed, and riders noticed the difference every single evening. ";
      const blocks = Array.from({ length: 40 }, () => ({ k: "p", t: paragraph.repeat(4).trim() }));
      const chars = blocks.reduce((sum, block) => sum + block.t.length + 1, 0);
      const items = [];
      const docs = {};
      for (let index = from; index < to; index += 1) {
        const id = `bench${index}`;
        items.push({ id, url: `https://bench.example/${index}`, title: `Benchmark article ${index}`, site: "bench.example", source: "page", words: 4320, chars, status: index % 5 === 4 ? "done" : "queued", addedAt: Date.now() - index, finishedAt: index % 5 === 4 ? Date.now() - index : 0, progress: 0, listenedMs: 0 });
        docs[id] = { blocks };
      }
      return chrome.runtime.sendMessage({ type: "cmd", name: "importData", args: [{ queue: { items }, docs }] });
    }, from, Math.min(count, from + 100));
  }
  const importMs = Date.now() - started;
  const bytes = await app.control.evaluate(() => chrome.storage.local.getBytesInUse(null));
  return { bytes, importMs };
};

const rows = [];
for (const size of SIZES) {
  await app.send("reset");
  await app.quietVoice();
  const { bytes, importMs } = await seed(size);

  const page = await app.fixture("https://metroreview.example/cities/night-bus", "news.html");
  const tabId = await app.tabId(page);
  const t0 = Date.now();
  const capture = await app.send("capture", tabId, "page", "end");
  const captureMs = Date.now() - t0;
  await page.close();
  if (!capture.ok) throw new Error(`capture failed at ${size}: ${capture.message}`);

  const panel = await app.browser.newPage();
  await panel.setViewport({ width: 380, height: 860 });
  const cdp = await panel.createCDPSession();
  await cdp.send("Performance.enable");
  const renderStart = Date.now();
  await panel.goto(app.url("pages/panel.html"), { waitUntil: "domcontentloaded" });
  const expected = Math.ceil(size * 0.8) + 1;
  await panel.waitForFunction((expected) => document.querySelectorAll("#queueList > li").length >= expected, { timeout: 60000 }, expected);
  const renderMs = Date.now() - renderStart;
  await panel.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => list.getEntries().forEach((entry) => window.__long.push(entry.duration))).observe({ type: "longtask", buffered: false });
  });

  await worker.evaluate(() => (globalThis.__speakTimes = []));
  const before = await cdp.send("Performance.getMetrics");
  const p0 = Date.now();
  await app.send("play", "bench0");
  await app.waitFor(async () => (await app.player()).status === "playing", { label: "playing" });
  const startMs = Date.now() - p0;
  await sleep(5000);
  await app.send("pause");
  const after = await cdp.send("Performance.getMetrics");
  const times = await worker.evaluate(() => globalThis.__speakTimes);
  const gaps = times.slice(1).map((time, index) => time - times[index] - 30).filter((gap) => gap >= 0 && gap < 2000);
  gaps.sort((a, b) => a - b);
  const metric = (set, name) => set.metrics.find((entry) => entry.name === name)?.value || 0;
  const taskMs = (metric(after, "TaskDuration") - metric(before, "TaskDuration")) * 1000;
  const longTasks = await panel.evaluate(() => window.__long);
  const heap = metric(after, "JSHeapUsedSize") / 1048576;

  const t1 = Date.now();
  await app.send("move", "bench3", 1);
  const reorderMs = Date.now() - t1;

  rows.push({
    items: size,
    storage: `${(bytes / 1048576).toFixed(1)} MB`,
    importMs,
    captureMs,
    panelRenderMs: renderMs,
    playStartMs: startMs,
    sentencesIn5s: times.length,
    sentenceGapP50: `${Math.round(gaps[Math.floor(gaps.length / 2)] || 0)} ms`,
    sentenceGapP95: `${Math.round(gaps[Math.floor(gaps.length * 0.95)] || 0)} ms`,
    panelCpuPerSec: `${Math.round(taskMs / 5)} ms`,
    longTasks: longTasks.length ? `${longTasks.length} (max ${Math.round(Math.max(...longTasks))} ms)` : "0",
    panelHeap: `${heap.toFixed(1)} MB`,
    reorderMs
  });
  await panel.close();
  console.log(JSON.stringify(rows.at(-1)));
}

console.table(rows);
await app.close();
