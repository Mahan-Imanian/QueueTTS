import { addItem, findByUrl, queuedItems } from "../lib/queue.js";
import { blocksFromText, docKey, KEYS, metaFromDoc } from "../lib/store.js";
import { canonicalUrl } from "../lib/text.js";
import { currentItem, exclusive, load, persist, setPlayer, state, updateBadge } from "./state.js";

const READABLE_URL = /^https?:|^file:/i;
const PAGE_TOAST_MS = 4200;

const injectExtractor = async (tabId, full) => {
  const files = full ? ["src/vendor/Readability.js", "src/vendor/Readability-readerable.js", "src/content/extract.js"] : ["src/vendor/Readability-readerable.js", "src/content/extract.js"];
  await chrome.scripting.executeScript({ target: { tabId }, files });
};

const runExtractor = async (tabId, mode) => {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: (value) => globalThis.__qtts.run(value), args: [mode] });
  return result?.result;
};

const blockedMessage = (url = "") => {
  if (/^chrome:|^edge:|^about:|^chrome-extension:|^devtools:/i.test(url)) return "Chrome doesn't let extensions read this page.";
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(url)) return "Chrome doesn't let extensions read the Web Store.";
  if (/\.pdf($|\?)/i.test(url)) return "PDFs aren't supported yet. Select text in the PDF and use Paste instead.";
  return "QueueTTS can't read this page. Try selecting the text, or paste it instead.";
};

export const addDoc = async (doc, { source = "page", placement = "end" } = {}) => {
  const url = canonicalUrl(doc.url || "");
  if (source === "page" && url) {
    const existing = findByUrl(state.queue, url);
    if (existing) return { ok: true, duplicate: true, item: existing, position: queuedItems(state.queue).findIndex((entry) => entry.id === existing.id) };
  }
  const meta = metaFromDoc(doc, { source });
  if (source === "selection" && doc.pageTitle) meta.excerpt = doc.pageTitle;
  const current = currentItem();
  const queue = addItem(state.queue, meta, { placement: current ? placement : "end", currentId: current?.id || "" });
  await persist({ [docKey(meta.id)]: { blocks: doc.blocks }, [KEYS.queue]: queue });
  state.queue = queue;
  if (!current) await setPlayer({ itemId: queuedItems(state.queue)[0].id, pos: queuedItems(state.queue)[0].pos, progress: queuedItems(state.queue)[0].progress, status: "paused", error: "" });
  updateBadge();
  return { ok: true, item: meta, position: queuedItems(state.queue).findIndex((entry) => entry.id === meta.id) };
};

export const pageContext = async (tabId) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return { ok: false, reason: "blocked", message: "No page is open." };
  const url = canonicalUrl(tab.url || "");
  const base = { title: tab.title || "", url: tab.url || "", favIconUrl: tab.favIconUrl || "" };
  if (!READABLE_URL.test(tab.url || "")) return { ok: false, reason: "blocked", message: blockedMessage(tab.url), ...base };
  const existing = url ? findByUrl(state.queue, url) : null;
  try {
    await injectExtractor(tabId, false);
    const result = await runExtractor(tabId, "context");
    return { ...base, ...result, existing };
  } catch {
    return { ok: false, reason: "blocked", message: blockedMessage(tab.url), ...base, existing };
  }
};

export const captureTab = async (tabId, mode = "page", placement = "end") => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !READABLE_URL.test(tab.url || "")) return { ok: false, reason: "blocked", message: blockedMessage(tab?.url) };
  let result;
  try {
    await injectExtractor(tabId, mode === "page");
    result = await runExtractor(tabId, mode);
  } catch {
    return { ok: false, reason: "blocked", message: blockedMessage(tab.url) };
  }
  if (!result?.ok) return result || { ok: false, reason: "error", message: "Capture failed." };
  return addDoc(result.doc, { source: mode, placement });
};

export const addText = async (text, title = "") => {
  const blocks = blocksFromText(text);
  if (!blocks.length) return { ok: false, message: "Paste some text first." };
  return addDoc({ blocks, title: title || blocks[0].t.split(/(?<=[.!?])\s/)[0].slice(0, 90), url: "" }, { source: "paste" });
};

const showPageToast = async (tabId, result) => {
  if (!tabId) return;
  const text = !result?.ok ? result?.message || "Couldn't add this page." : result.duplicate ? "Already in your queue" : result.position === 0 ? "Added · plays now" : `Added · #${result.position + 1} in queue`;
  const id = result?.ok && !result.duplicate ? result.item.id : "";
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text, id, Boolean(result?.ok), PAGE_TOAST_MS],
    func: (message, itemId, success, visibleMs) => {
      document.getElementById("qtts-toast-host")?.remove();
      const host = document.createElement("div");
      host.id = "qtts-toast-host";
      host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;";
      const root = host.attachShadow({ mode: "closed" });
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      root.innerHTML = `<style>
        .t{font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;padding:10px 12px 10px 14px;border-radius:10px;
        background:${dark ? "#EDEBE5" : "#1B1A17"};color:${dark ? "#1B1A17" : "#F7F5F0"};box-shadow:0 8px 28px rgba(0,0,0,.28);transform:translateY(8px);opacity:0;transition:transform .18s cubic-bezier(.2,.7,.2,1),opacity .18s}
        .t.in{transform:none;opacity:1}.d{width:8px;height:8px;border-radius:4px;background:${success ? "#E8590C" : "#9B9890"}}
        button{font:inherit;font-weight:600;color:inherit;background:transparent;border:0;padding:4px 6px;border-radius:6px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
        button:focus-visible{outline:2px solid #E8590C;outline-offset:2px}
        @media (prefers-reduced-motion: reduce){.t{transition:none}}</style>
        <div class="t" role="status"><span class="d"></span><span></span></div>`;
      root.querySelector("span:last-child").textContent = `QueueTTS · ${message}`;
      if (itemId) {
        const undo = document.createElement("button");
        undo.textContent = "Undo";
        undo.addEventListener("click", () => {
          chrome.runtime.sendMessage({ type: "cmd", name: "remove", args: [itemId] });
          host.remove();
        });
        root.querySelector(".t").append(undo);
      }
      document.documentElement.append(host);
      requestAnimationFrame(() => root.querySelector(".t").classList.add("in"));
      setTimeout(() => host.remove(), visibleMs);
    }
  }).catch(() => {});
};

export const quickCapture = async (tab, mode) => {
  if (!tab?.id) return;
  const result = await exclusive(async () => {
    await load();
    return captureTab(tab.id, mode);
  });
  await showPageToast(tab.id, result);
};
