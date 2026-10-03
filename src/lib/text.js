const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "cf", "al", "no", "nos", "fig", "figs",
  "approx", "inc", "ltd", "co", "corp", "dept", "est", "vol", "ed", "eds", "pp", "op", "gen", "gov", "rep", "sen", "mt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "u.s", "u.k", "u.n", "e.u", "a.m", "p.m", "ph.d", "b.a", "m.a", "d.c"
]);

const MAX_SENTENCE = 280;

export const CPS_DEFAULT = 15;

export const normalizeSpace = (value) => String(value ?? "").replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();

export const wordCount = (text) => (String(text ?? "").match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;

const segmenters = new Map();
const segmenterFor = (lang) => {
  const key = lang || "en";
  if (!segmenters.has(key)) {
    try {
      segmenters.set(key, new Intl.Segmenter(key, { granularity: "sentence" }));
    } catch {
      segmenters.set(key, new Intl.Segmenter("en", { granularity: "sentence" }));
    }
  }
  return segmenters.get(key);
};

const endsWithAbbreviation = (sentence) => {
  const match = sentence.trimEnd().match(/(?:^|[\s("'“‘])([\p{L}][\p{L}.]*)\.$/u);
  if (!match) return false;
  const token = match[1];
  return ABBREVIATIONS.has(token.toLowerCase()) || /^\p{Lu}$/u.test(token);
};

const shouldJoin = (previous, next) => endsWithAbbreviation(previous) || /^[\p{Ll}]/u.test(next.trimStart());

const splitLong = (sentence) => {
  if (sentence.length <= MAX_SENTENCE) return [sentence];
  const window = sentence.slice(120, MAX_SENTENCE);
  const breakAt = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "), window.lastIndexOf(" – "), window.lastIndexOf(" — "));
  const cut = breakAt >= 0 ? 120 + breakAt + 1 : sentence.lastIndexOf(" ", MAX_SENTENCE) > 80 ? sentence.lastIndexOf(" ", MAX_SENTENCE) : MAX_SENTENCE;
  return [sentence.slice(0, cut).trim(), ...splitLong(sentence.slice(cut).trim())].filter(Boolean);
};

export const splitSentences = (text, lang = "en") => {
  const clean = normalizeSpace(text);
  if (!clean) return [];
  const merged = [];
  for (const { segment } of segmenterFor(lang).segment(clean)) {
    if (merged.length && shouldJoin(merged[merged.length - 1], segment)) merged[merged.length - 1] += segment;
    else merged.push(segment);
  }
  return merged.map((sentence) => sentence.trim()).filter(Boolean).flatMap(splitLong);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const parsePronunciations = (list) => (Array.isArray(list) ? list : [])
  .map((rule) => ({ from: normalizeSpace(rule?.from), to: normalizeSpace(rule?.to) }))
  .filter((rule) => rule.from && rule.to);

export const stripCitations = (text) => String(text ?? "")
  .replace(/\[(?:\d+(?:\s*[,–-]\s*\d+)*|[a-z]|[ivx]+|note \d+|nb \d+|citation needed|clarification needed|when\?|who\?|according to whom\?|edit|update)\]/gi, "")
  .replace(/\s+([,.;:!?])/g, "$1");

export const toSpeech = (text, pronunciations = []) => {
  let spoken = stripCitations(text)
    .replace(/\bhttps?:\/\/(?:www\.)?([^\s/?#]+)[^\s]*/gi, "$1")
    .replace(/\bwww\.([^\s/?#]+)[^\s]*/gi, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\be\.g\.,?/gi, "for example,")
    .replace(/\bi\.e\.,?/gi, "that is,")
    .replace(/(\p{L})\/(\p{L})/gu, "$1 or $2")
    .replace(/\s*[|•·]\s*/g, ", ")
    .replace(/[*_#~^]+/g, " ");
  for (const rule of parsePronunciations(pronunciations)) {
    spoken = spoken.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(rule.from)}(?![\\p{L}\\p{N}])`, "giu"), rule.to);
  }
  return normalizeSpace(spoken.replace(/,\s*,/g, ","));
};

export const PAUSE = { sentence: 0, paragraph: 260, heading: 480, list: 160 };

export const buildPlan = (doc, { lang = "en", readCode = false, announceHeadings = false } = {}) => {
  const units = [];
  let chars = 0;
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  blocks.forEach((block, b) => {
    if (block.k === "code" && !readCode) return;
    const sentences = block.k === "code" ? [normalizeSpace(block.t)] : splitSentences(block.t, lang);
    sentences.forEach((text, s) => {
      const first = s === 0;
      const pause = !first ? PAUSE.sentence : block.k === "h" ? PAUSE.heading : block.k === "li" ? PAUSE.list : PAUSE.paragraph;
      const lead = first && block.k === "h" && announceHeadings ? "Section: " : "";
      units.push({ b, s, text, lead, pause: units.length ? pause : 0, start: chars, heading: block.k === "h" });
      chars += text.length + 1;
    });
  });
  return { units, chars };
};

export const unitIndex = (plan, pos) => {
  if (!plan.units.length) return -1;
  if (!pos) return 0;
  const exact = plan.units.findIndex((unit) => unit.b === pos.b && unit.s === pos.s);
  if (exact >= 0) return exact;
  const after = plan.units.findIndex((unit) => unit.b > pos.b || (unit.b === pos.b && unit.s > pos.s));
  return after >= 0 ? after : plan.units.length - 1;
};

export const progressAt = (plan, index) => (plan.chars ? Math.min(1, (plan.units[index]?.start ?? plan.chars) / plan.chars) : 0);

export const remainingSeconds = (chars, progress, rate = 1, cps = CPS_DEFAULT) => Math.max(0, Math.round((chars * (1 - progress)) / (Math.max(4, cps) * Math.max(0.5, rate))));

export const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return total <= 0 ? "0 min" : "< 1 min";
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

export const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

export const localDay = (time = Date.now()) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const canonicalUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|si$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.replace(/^www\./, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
};

export const siteFromUrl = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const wordIndexAt = (text, charIndex) => {
  const prefix = String(text).slice(0, Math.max(0, charIndex));
  return (prefix.match(/\S+/g) || []).length - (/\S$/.test(prefix) ? 1 : 0);
};
