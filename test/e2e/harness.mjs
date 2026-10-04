import puppeteer from "puppeteer-core";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((path) => existsSync(path));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const buildCopy = ({ hostAccess = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "qtts-ext-"));
  for (const part of ["manifest.json", "src", "pages", "styles", "assets"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  if (hostAccess) {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    manifest.host_permissions = ["<all_urls>"];
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  }
  return dir;
};

export const launch = async ({ extension, profile, headless = process.env.HEADFUL ? false : "new", args = [], reuseInstalled = false } = {}) => {
  const ext = extension || buildCopy();
  const userDataDir = profile || mkdtempSync(join(tmpdir(), "qtts-profile-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    pipe: true,
    enableExtensions: reuseInstalled ? true : [ext],
    userDataDir,
    defaultViewport: null,
    ignoreDefaultArgs: ["--disable-component-extensions-with-background-pages", "--mute-audio"],
    targetFilter: (target) => target.type() !== "service_worker",
    args: ["--window-size=1280,860", "--no-first-run", "--no-default-browser-check", ...(headless ? ["--window-position=-2400,0"] : []), ...args]
  });
  let id = "";
  for (let attempt = 0; attempt < 60 && !id; attempt += 1) {
    const worker = browser.targets().find((target) => target.type() === "service_worker" && target.url().endsWith("/src/background/index.js"));
    if (worker) id = new URL(worker.url()).host;
    else await sleep(150);
  }
  if (!id) throw new Error("QueueTTS service worker never started");
  const control = await browser.newPage();
  await control.goto(`chrome-extension://${id}/pages/options.html`, { waitUntil: "domcontentloaded" });
  const app = {
    browser,
    id,
    ext,
    userDataDir,
    control,
    url: (path) => `chrome-extension://${id}/${path}`,
    send: (name, ...args) => control.evaluate((name, args) => chrome.runtime.sendMessage({ type: "cmd", name, args }), name, args),
    storage: (keys = null) => control.evaluate((keys) => chrome.storage.local.get(keys), keys),
    session: () => control.evaluate(() => chrome.storage.session.get(null)),
    setStorage: (values) => control.evaluate((values) => chrome.storage.local.set(values), values),
    player: async () => (await control.evaluate(() => chrome.storage.local.get("player"))).player || {},
    queue: async () => (await control.evaluate(() => chrome.storage.local.get("queue"))).queue?.items || [],
    swAlive: () => browser.targets().some((target) => target.type() === "service_worker" && target.url().includes(id)),
    stopWorker: async () => {
      const session = await control.createCDPSession();
      await session.send("ServiceWorker.enable");
      await session.send("ServiceWorker.stopAllWorkers");
      await session.detach();
    },
    worker: async () => {
      const target = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().includes(id));
      return target.worker();
    },
    async waitFor(check, { timeout = 15000, interval = 100, label = "condition" } = {}) {
      const started = Date.now();
      let last;
      while (Date.now() - started < timeout) {
        last = await check();
        if (last) return last;
        await sleep(interval);
      }
      throw new Error(`Timed out waiting for ${label}`);
    },
    async fixture(url, file, page) {
      const tab = page || (await browser.newPage());
      await tab.setRequestInterception(true);
      tab.removeAllListeners("request");
      tab.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === tab.mainFrame()) {
          request.respond({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(join(FIXTURES, file)) });
        } else if (/favicon|\.png|\.jpg|\.svg/.test(request.url())) request.respond({ status: 404, body: "" });
        else request.continue();
      });
      await tab.goto(url, { waitUntil: "domcontentloaded" });
      return tab;
    },
    async tabId(page) {
      const url = page.url();
      return control.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, url);
    },
    async quietVoice() {
      await app.send("settings", { volume: 0, rate: 2, autoAdvance: true, onboarded: true });
    },
    async close({ keepProfile = false } = {}) {
      await browser.close().catch(() => {});
      if (!extension) rmSync(ext, { recursive: true, force: true });
      if (!keepProfile && !profile) rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5 });
    }
  };
  for (const page of await browser.pages()) if (page !== control && page.url().includes("welcome.html")) await page.close();
  return app;
};

export const localVoiceAvailable = async (app) => {
  const voices = await app.control.evaluate(() => new Promise((resolve) => chrome.tts.getVoices(resolve)));
  return voices.some((voice) => !voice.remote);
};

export const sentences = (count, prefix = "Sentence") => Array.from({ length: count }, (_, index) => `${prefix} number ${index + 1} is here and it is short.`).join(" ");
