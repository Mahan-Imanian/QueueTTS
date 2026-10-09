(() => {
  if (globalThis.__qtts) return;

  const BLOCK = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL", "CENTER"]);
  const ALWAYS_SKIP = "script,style,noscript,template,svg,canvas,iframe,video,audio,picture,img,button,input,select,textarea,form,nav,dialog,math,[hidden],[aria-hidden='true'],[role='navigation'],[role='button'],[role='toolbar'],[role='search'],[role='dialog'],[role='complementary'],.sr-only,.visually-hidden,.screen-reader-text";
  const UI_LABEL = /^(was this (page|article|doc|guide) helpful( to you)?\??|did (you find this|this) help(ful)?\??|share|share this( article| story)?|tweet|print|email|copy link|save|skip to (main )?content|skip navigation|advertisement|sponsored( content)?|read more|continue reading|subscribe( now)?|sign up|sign in|log in|cookie settings?|accept( all)?( cookies)?|reject all|manage (cookies|preferences)|menu|close|loading\.*|back to top|table of contents|contents|edit|edit this page|view source|listen to (this )?article|related( articles| stories)?|more from .*|follow us|advertisement\s*-\s*scroll to continue)$/i;
  const END_SECTION = /^(references|notes|footnotes|citations|sources|bibliography|external links|see also|further reading|related articles|works cited)$/i;

  const space = (value) => String(value || "").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/[ \t\r\f\v]+/g, " ");
  const tidy = (value) => space(value).replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?)\]])/g, "$1").replace(/([(\[])\s+/g, "$1").trim();
  const words = (value) => (String(value || "").match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
  const citation = /\[(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z]|note \d+|citation needed|clarification needed|edit)\]/gi;

  const visible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "contents") return element.parentElement ? visible(element.parentElement) : true;
    if (typeof element.checkVisibility === "function") return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const toBlocks = (root, { live = false, skip = "" } = {}) => {
    const blocks = [];
    const skipSelector = skip ? `${ALWAYS_SKIP},${skip}` : ALWAYS_SKIP;
    let run = { text: "", link: 0 };
    let stopped = false;

    const pushParagraphs = (text, kind, linkChars) => {
      const total = text.replace(/\s/g, "").length;
      for (const chunk of text.split(/\n\s*\n/)) {
        const value = tidy(chunk.replace(citation, ""));
        if (!value || stopped) continue;
        if (END_SECTION.test(value)) {
          stopped = true;
          return;
        }
        if (UI_LABEL.test(value)) continue;
        if (words(value) < 3 && kind !== "li" && !/[.!?]$/.test(value)) continue;
        if (total && linkChars / total > 0.7 && words(value) < 40) continue;
        blocks.push({ k: kind, t: value });
      }
    };

    const flush = (kind = "p") => {
      if (run.text.trim()) pushParagraphs(run.text, kind, run.link);
      run = { text: "", link: 0 };
    };

    const skipped = (element) => element.matches(skipSelector) || (live && !visible(element));

    const inline = (node, inLink) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = space(node.nodeValue).replace(/\n/g, " ");
        run.text += value;
        if (inLink) run.link += value.replace(/\s/g, "").length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || skipped(node)) return;
      if (node.matches("sup.reference, sup[id^='cite_ref'], .mw-editsection, .reference, a.anchor, .footnote-ref, sup.footnote")) return;
      if (node.tagName === "BR") {
        run.text += "\n";
        return;
      }
      const link = inLink || node.tagName === "A";
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName)) {
          walk(child);
        } else {
          inline(child, link);
        }
      }
    };

    const heading = (element) => {
      const text = tidy(element.textContent.replace(citation, ""));
      if (END_SECTION.test(text)) {
        stopped = true;
        return;
      }
      if (text && !UI_LABEL.test(text)) blocks.push({ k: "h", t: text, l: Number(element.tagName[1]) });
    };

    const layoutTable = (table) => {
      const cells = table.querySelectorAll("td, th");
      const longest = Math.max(0, ...Array.from(cells, (cell) => (cell.textContent || "").length));
      return cells.length <= 12 && longest > 400;
    };

    const walk = (element) => {
      if (stopped || skipped(element)) return;
      const tag = element.tagName;
      if (/^H[1-6]$/.test(tag)) {
        flush();
        heading(element);
        return;
      }
      if (tag === "P" && element.children.length === 1 && /^(B|STRONG)$/.test(element.firstElementChild.tagName)) {
        const label = tidy(element.textContent);
        if (label === tidy(element.firstElementChild.textContent) && words(label) <= 8 && !/[.!?:,;]$/.test(label)) {
          flush();
          heading(element);
          return;
        }
      }
      if (tag === "PRE") {
        flush();
        const code = element.textContent.replace(/\n{3,}/g, "\n\n").trim();
        if (code) blocks.push({ k: "code", t: code });
        return;
      }
      if (tag === "TABLE" && !layoutTable(element)) {
        flush();
        return;
      }
      if (tag === "FIGCAPTION" || tag === "FIGURE" && !element.querySelector("p, blockquote")) {
        flush();
        return;
      }
      if (tag === "LI" || tag === "DT" || tag === "DD") {
        flush();
        for (const child of element.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName) && !["P", "DIV", "SPAN"].includes(child.tagName)) {
            flush("li");
            walk(child);
          } else if (child.nodeType === Node.ELEMENT_NODE && ["P", "DIV"].includes(child.tagName)) {
            inline(child, false);
            run.text += "\n\n";
          } else {
            inline(child, false);
          }
        }
        flush("li");
        return;
      }
      if (tag === "BLOCKQUOTE") {
        flush();
        const start = blocks.length;
        for (const child of element.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName)) {
            flush();
            walk(child);
          } else inline(child, false);
        }
        flush();
        for (let index = start; index < blocks.length; index += 1) if (blocks[index].k === "p") blocks[index].k = "q";
        return;
      }
      const startsBlock = BLOCK.has(tag);
      if (startsBlock) flush();
      for (const child of element.childNodes) {
        if (stopped) return;
        if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(child.tagName)) {
          walk(child);
        } else {
          inline(child, false);
        }
      }
      if (startsBlock) flush();
    };

    walk(root);
    flush();
    return blocks;
  };

  const meta = (selector, attribute = "content") => document.querySelector(selector)?.getAttribute(attribute)?.trim() || "";

  const siteName = () => meta("meta[property='og:site_name']") || location.hostname.replace(/^www\./, "");

  const cleanTitle = (raw) => {
    const site = siteName();
    let title = space(raw).trim();
    const parts = title.split(/\s+[|·–—-]\s+/);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last.length <= 40 && (parts[0].length > last.length || last.toLowerCase().includes(site.split(".")[0].toLowerCase()))) title = parts.slice(0, -1).join(" – ");
    }
    return title.replace(/^GitHub - /, "");
  };

  const byline = (fromReadability) => {
    const raw = fromReadability || meta("meta[name='author']") || meta("meta[property='article:author']") || document.querySelector("[rel='author'], [itemprop='author'] [itemprop='name'], [itemprop='author']")?.textContent || "";
    const value = tidy(raw).replace(/^by\s+/i, "").split(/\s+[·|•–—]\s+|\s+(?:updated|published|posted)\b|,\s*(?:updated|published)/i)[0].trim();
    return value.length > 2 && value.length < 90 && !/^https?:/i.test(value) ? value : "";
  };

  const published = (fromReadability) => meta("meta[property='article:published_time']") || meta("meta[name='date']") || document.querySelector("article time[datetime], main time[datetime], time[datetime]")?.getAttribute("datetime") || fromReadability || "";

  const JUNK_HEADING = /^(get (the|our) .*newsletter|sign up for .*|subscribe( to .*)?|newsletter|related( articles| stories| posts)?|recommended( for you)?|more (from|on) .*|most (read|popular)|you (may|might) also like|read (more|next)|comments?( \(\d+\))?|share this( article| story)?|about the author|advertisement|sponsored)$/i;
  const JUNK_TEXT = /\b(newsletter|inbox|subscribe|sign up|unsubscribe)\b/i;

  const scrub = (blocks) => {
    const out = [];
    let skipping = false;
    for (const block of blocks) {
      if (block.k === "h") {
        skipping = JUNK_HEADING.test(block.t);
        if (!skipping) out.push(block);
        continue;
      }
      if (skipping && words(block.t) < 60) continue;
      skipping = false;
      if (block.k === "p" && words(block.t) < 30 && JUNK_TEXT.test(block.t)) continue;
      out.push(block);
    }
    return out.filter((block, index) => {
      if (block.k !== "h") return true;
      const next = out[index + 1];
      return next && (next.k !== "h" || (next.l || 2) > (block.l || 2));
    });
  };

  const dropLeadingTitle = (blocks, title) => {
    const first = blocks[0];
    if (first && first.k === "h" && tidy(first.t).toLowerCase() === tidy(title).toLowerCase()) blocks.shift();
    return blocks;
  };

  const adapters = [
    {
      test: () => /(^|\.)wikipedia\.org$/.test(location.hostname),
      root: () => document.querySelector("#mw-content-text .mw-parser-output"),
      title: () => document.querySelector("#firstHeading")?.textContent,
      skip: ".reference,.reflist,.references,.navbox,.vertical-navbox,.infobox,.sidebar,.metadata,.ambox,.hatnote,.mw-editsection,#toc,.toc,.thumb,figure,.gallery,.noprint,.mw-empty-elt,.shortdescription,.mw-references-wrap,.navigation-not-searchable,.side-box,.portalbox,.authority-control,.catlinks,.sistersitebox,.mw-heading .mw-editsection"
    },
    {
      test: () => location.hostname === "github.com",
      root: () => document.querySelector("article.markdown-body") || document.querySelector(".markdown-body"),
      title: () => {
        const parts = location.pathname.split("/").filter(Boolean);
        const heading = document.querySelector("article.markdown-body h1")?.textContent;
        return heading ? tidy(heading) : parts.slice(0, 2).join("/");
      },
      skip: ".anchor,.octicon,clipboard-copy,.zeroclipboard-container,.js-clipboard-copy"
    },
    {
      test: () => location.hostname === "developer.mozilla.org",
      root: () => document.querySelector("main#content article.main-page-content") || document.querySelector(".main-page-content") || document.querySelector("main article") || document.querySelector("main#content"),
      title: () => document.querySelector("main h1")?.textContent,
      skip: ".bc-data,.bc-table,.metadata,.last-modified-date,.document-toc-container,.on-github,.article-footer,.baseline-indicator,.copy-icon,.play-button,.interactive,[class*='sidebar'],[class*='toc'],[class*='breadcrumb'],[class*='article-footer'],[class*='baseline'],[class*='compat'],mdn-dropdown,mdn-toggle-sidebar,mdn-copy-button,mdn-play-button,mdn-compat-table-lazy"
    }
  ];

  const readable = () => {
    try {
      return typeof isProbablyReaderable === "function" ? isProbablyReaderable(document) : false;
    } catch {
      return false;
    }
  };

  const clippedAway = (element) => {
    const style = getComputedStyle(element);
    if (style.position !== "absolute" && style.position !== "fixed") return false;
    const rect = element.getBoundingClientRect();
    return (rect.width <= 2 || rect.height <= 2) && (style.overflow === "hidden" || style.clip !== "auto" || style.clipPath !== "none");
  };

  const markHidden = () => {
    const marked = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (element) => {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|HEAD)$/i.test(element.tagName)) return NodeFilter.FILTER_REJECT;
        if (!visible(element) || clippedAway(element)) {
          marked.push(element);
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) {}
    for (const element of marked) element.setAttribute("data-qtts-hidden", "");
    return () => marked.forEach((element) => element.removeAttribute("data-qtts-hidden"));
  };

  const viaReadability = () => {
    if (typeof Readability !== "function") return null;
    const unmark = markHidden();
    let clone;
    try {
      clone = document.cloneNode(true);
    } finally {
      unmark();
    }
    clone.querySelectorAll("[data-qtts-hidden]").forEach((element) => element.remove());
    try {
      const article = new Readability(clone, { charThreshold: 300, keepClasses: false }).parse();
      if (!article?.content) return null;
      const container = new DOMParser().parseFromString(`<div>${article.content}</div>`, "text/html").body.firstElementChild;
      return { article, blocks: toBlocks(container) };
    } catch {
      return null;
    }
  };

  const viaFallback = () => {
    const candidates = Array.from(document.querySelectorAll("article, main, [role='main'], .post-content, .entry-content, .article-body, .content, #content")).filter((element) => visible(element));
    const best = candidates.sort((a, b) => words(b.innerText) - words(a.innerText))[0] || document.body;
    return toBlocks(best, { live: true, skip: "header,footer,aside,[class*='comment'],[id*='comment'],[class*='newsletter'],[class*='related'],[class*='share'],[class*='cookie'],[class*='promo']" });
  };

  const countWords = (blocks) => blocks.reduce((sum, block) => sum + (block.k === "code" ? 0 : words(block.t)), 0);

  const capturePage = () => {
    if (document.contentType && !/html|xml/.test(document.contentType)) return { ok: false, reason: "unsupported", message: "This isn't a web page QueueTTS can read." };
    const site = siteName();
    const lang = (document.documentElement.lang || navigator.language || "en").split(/[_]/)[0];
    let blocks = [];
    let title = "";
    let readabilityMeta = null;
    const adapter = adapters.find((entry) => entry.test());
    if (adapter) {
      const root = adapter.root();
      if (root) {
        blocks = toBlocks(root, { live: true, skip: adapter.skip });
        title = adapter.title() || "";
      }
    }
    if (countWords(blocks) < 60) {
      const result = viaReadability();
      if (result && countWords(result.blocks) >= countWords(blocks)) {
        blocks = result.blocks;
        readabilityMeta = result.article;
        title = title || result.article.title;
      }
    }
    if (countWords(blocks) < 60) {
      const fallback = viaFallback();
      if (countWords(fallback) > countWords(blocks)) blocks = fallback;
    }
    title = cleanTitle(title || meta("meta[property='og:title']") || document.querySelector("h1")?.textContent || document.title || location.hostname);
    blocks = scrub(dropLeadingTitle(blocks, title));
    const total = countWords(blocks);
    if (total < 30) return { ok: false, reason: "empty", message: "There's no article text on this page to read." };
    const headings = blocks.filter((block) => block.k === "h").length;
    const prose = blocks.filter((block) => (block.k === "p" || block.k === "q") && words(block.t) >= 12).length;
    if (total < 180 && headings >= prose) return { ok: false, reason: "listing", message: "This looks like a list of articles. Open the one you want, then add it." };
    return {
      ok: true,
      doc: {
        url: location.href,
        title,
        site,
        byline: byline(readabilityMeta?.byline),
        published: published(readabilityMeta?.publishedTime),
        lang,
        blocks,
        quality: total >= 150 || readable() ? "good" : "low"
      }
    };
  };

  const captureSelection = () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return { ok: false, reason: "no-selection", message: "Select some text on the page first." };
    const container = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) container.append(selection.getRangeAt(index).cloneContents());
    let blocks = toBlocks(container);
    if (!blocks.length) blocks = tidy(selection.toString()).split(/\n\s*\n/).map((t) => ({ k: "p", t: tidy(t) })).filter((block) => block.t);
    if (!blocks.length) return { ok: false, reason: "no-selection", message: "Select some text on the page first." };
    const first = blocks.find((block) => block.k !== "code")?.t || blocks[0].t;
    const sentence = first.split(/(?<=[.!?])\s/)[0];
    return {
      ok: true,
      doc: {
        url: location.href,
        title: sentence.length > 90 ? `${sentence.slice(0, 87).trimEnd()}…` : sentence,
        site: siteName(),
        pageTitle: cleanTitle(document.title),
        byline: "",
        published: "",
        lang: (document.documentElement.lang || "en").split(/[_]/)[0],
        blocks,
        quality: "good"
      }
    };
  };

  const context = () => {
    const selection = getSelection();
    const text = selection && !selection.isCollapsed ? selection.toString() : "";
    return { ok: true, title: cleanTitle(document.title || location.hostname), site: siteName(), url: location.href, selectionWords: words(text), readable: readable() };
  };

  globalThis.__qtts = {
    run(mode) {
      try {
        if (mode === "selection") return captureSelection();
        if (mode === "context") return context();
        return capturePage();
      } catch (error) {
        return { ok: false, reason: "error", message: `Capture failed: ${error?.message || error}` };
      }
    }
  };
})();
