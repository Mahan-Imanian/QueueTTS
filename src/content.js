(() => {
  if (window.__QueueTTSCaptureInstalled) return;
  window.__QueueTTSCaptureInstalled = true;

  const BAD_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "canvas",
    "iframe",
    "video",
    "audio",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "nav",
    "header",
    "footer",
    "aside",
    "dialog",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "[aria-hidden='true']"
  ].join(",");

  const BAD_PATTERN = /(ad-|ads|advert|affiliate|banner|breadcrumb|cookie|comments?|consent|drawer|footer|header|menu|modal|newsletter|notification|overlay|paywall|promo|related|share|sidebar|signin|signup|sponsor|subscribe|toolbar|tooltip)/i;

  const clean = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const words = (value) => (String(value || "").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

  const visible = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const element = node;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
  };

  const removeNoise = (root) => {
    root.querySelectorAll(BAD_SELECTOR).forEach((node) => node.remove());
    root.querySelectorAll("*").forEach((node) => {
      const value = `${node.id || ""} ${node.className || ""} ${node.getAttribute("role") || ""} ${node.getAttribute("aria-label") || ""}`;
      if (BAD_PATTERN.test(value)) node.remove();
    });
  };

  const candidateScore = (node) => {
    const text = clean(node.innerText || node.textContent || "");
    const count = words(text);
    const paragraphs = node.querySelectorAll("p, li, blockquote, h1, h2, h3").length;
    const linkWords = Array.from(node.querySelectorAll("a")).reduce((sum, anchor) => sum + words(anchor.textContent || ""), 0);
    return count + paragraphs * 35 - linkWords * 0.7;
  };

  const bestCandidate = () => {
    const selectors = ["article", "main", "[role='main']", ".article", ".post", ".entry-content", ".content", "#content"];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter(visible);
    const unique = [...new Set(candidates)];
    if (!unique.length) return document.body;
    unique.sort((a, b) => candidateScore(b) - candidateScore(a));
    return unique[0] || document.body;
  };

  const extractLines = (root) => {
    const lines = [];
    const seen = new Set();
    const nodes = root.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre,td,th,figcaption");
    for (const node of nodes) {
      const text = clean(node.innerText || node.textContent || "");
      if (!text) continue;
      if (text.length < 24 && !/^h[1-4]$/i.test(node.tagName)) continue;
      if (/^(accept|agree|all rights reserved|advertisement|cookies?|log in|menu|next|previous|privacy policy|read more|share|sign up|subscribe)$/i.test(text)) continue;
      const key = text.toLowerCase().slice(0, 180);
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(text);
    }
    return lines;
  };

  const captureSelection = () => {
    const text = clean(String(window.getSelection()?.toString() || ""));
    if (!text) return { ok: false, error: "No selected text was detected on this page." };
    return {
      ok: true,
      capture: {
        title: document.title || "Selected text",
        sourceTitle: document.title || "Selected text",
        sourceType: "selection",
        url: location.href,
        text,
        quality: words(text) >= 8 ? "good" : "short"
      }
    };
  };

  const pageContext = () => {
    const selection = clean(String(window.getSelection()?.toString() || ""));
    return {
      ok: true,
      context: {
        title: document.title || location.hostname || "Current page",
        url: location.href,
        selectionWords: words(selection),
        selectionPreview: selection.slice(0, 180)
      }
    };
  };

  const capturePage = () => {
    try {
      const candidate = bestCandidate();
      const clone = candidate.cloneNode(true);
      removeNoise(clone);
      let lines = extractLines(clone);
      if (lines.join(" ").length < 500) {
        const fallback = document.body.cloneNode(true);
        removeNoise(fallback);
        lines = extractLines(fallback);
      }
      const title = clean(document.querySelector("h1")?.innerText || document.title || "Captured page");
      const text = clean(lines.join("\n\n"));
      const count = words(text);
      if (count < 25) {
        return {
          ok: false,
          error: "QueueTTS could not find enough readable article text on this page.",
          capture: {
            title,
            sourceTitle: document.title || title,
            sourceType: "failed",
            url: location.href,
            text,
            failed: true,
            quality: "failed",
            error: "Extraction found fewer than 25 words. Paste manually or select the text you want to hear."
          }
        };
      }
      return {
        ok: true,
        capture: {
          title,
          sourceTitle: document.title || title,
          sourceType: "page",
          url: location.href,
          text,
          quality: count >= 120 ? "good" : "uncertain",
          wordCount: count
        }
      };
    } catch (error) {
      return { ok: false, error: error?.message || "Page extraction failed." };
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "QTTS_CAPTURE_SELECTION") sendResponse(captureSelection());
    if (message?.type === "QTTS_CAPTURE_PAGE") sendResponse(capturePage());
    if (message?.type === "QTTS_CAPTURE_CONTEXT") sendResponse(pageContext());
    return false;
  });
})();
