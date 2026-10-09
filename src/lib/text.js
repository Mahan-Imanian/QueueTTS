const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "vs", "e.g", "i.e", "cf", "fig", "figs",
  "approx", "dept", "est", "vol", "ed", "eds", "pp", "op", "gen", "gov", "rep", "sen", "mt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "u.s", "u.k", "u.n", "e.u", "ph.d", "b.a", "m.a", "d.c"
]);

const NUMBER_ABBREVIATIONS = new Set(["no", "nos"]);

const MAX_SENTENCE_CHARS = 280;
const MIN_CLAUSE_CUT_CHARS = 120;
const MIN_WORD_CUT_CHARS = 80;
const CLAUSE_BREAK = /(?<=[;:,])\s|\s(?=[–—]\s)|(?<=[，；：、])/g;

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

const abbreviationBefore = (sentence) => sentence.trimEnd().match(/(?:^|[\s("'“‘])([\p{L}][\p{L}.]*)\.$/u)?.[1] || "";

const shouldJoin = (previous, next) => {
  const start = next.trimStart();
  if (/^\p{Ll}/u.test(start)) return true;
  const token = abbreviationBefore(previous);
  if (!token) return false;
  const lower = token.toLowerCase();
  if (NUMBER_ABBREVIATIONS.has(lower)) return /^\p{N}/u.test(start);
  return ABBREVIATIONS.has(lower) || /^\p{Lu}$/u.test(token);
};

const splitLong = (sentence) => {
  if (sentence.length <= MAX_SENTENCE_CHARS) return [sentence];
  const window = sentence.slice(MIN_CLAUSE_CUT_CHARS, MAX_SENTENCE_CHARS);
  const clause = [...window.matchAll(CLAUSE_BREAK)].at(-1);
  const space = sentence.lastIndexOf(" ", MAX_SENTENCE_CHARS);
  const cut = clause ? MIN_CLAUSE_CUT_CHARS + clause.index : space > MIN_WORD_CUT_CHARS ? space : MAX_SENTENCE_CHARS;
  const rest = sentence.slice(cut).trim();
  if (!/[\p{L}\p{N}]/u.test(rest)) return [sentence];
  return [sentence.slice(0, cut).trim(), ...splitLong(rest)];
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

const dateFormatters = new Map();
const spokenDate = (year, month, day, lang) => {
  const key = lang || "en";
  if (!dateFormatters.has(key)) {
    try {
      dateFormatters.set(key, new Intl.DateTimeFormat(key, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }));
    } catch {
      dateFormatters.set(key, new Intl.DateTimeFormat("en", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }));
    }
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(day) ? null : dateFormatters.get(key).format(date);
};

export const toSpeech = (text, pronunciations = [], { lang = "en", close = false } = {}) => {
  const english = /^en\b/i.test(lang || "en");
  let spoken = stripCitations(text)
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\bhttps?:\/\/(?:www\.)?([^\s/?#]+?)(?:[/?#]\S*?)?(?=[.,;:!?)\]}"'”’]*(?:\s|$))/gi, "$1")
    .replace(/\bwww\.([^\s/?#]+?)(?:[/?#]\S*?)?(?=[.,;:!?)\]}"'”’]*(?:\s|$))/gi, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match, year, month, day) => spokenDate(year, month, day, lang) || match)
    .replace(/(\d)\s*[–—]\s*(\d)/g, english ? "$1 to $2" : "$1–$2")
    .replace(/\s+[—–]\s+|—/g, ", ")
    .replace(/\s*[|•·▪►]\s*/g, ", ")
    .replace(/[*_#~^]{2,}|(?<=\s)[*_#^]+(?=\s)/g, " ")
    .replace(/(^|\s)#(\d)/g, english ? "$1number $2" : "$1$2")
    .replace(/(\d)\s*[×x]\s*(\d)/g, english ? "$1 by $2" : "$1 × $2")
    .replace(/→|⇒|->/g, english ? " to " : " → ");
  if (english) {
    spoken = spoken
      .replace(/\be\.g\.,?/gi, "for example,")
      .replace(/\bi\.e\.,?/gi, "that is,")
      .replace(/\bvs\.?(?=\s)/gi, "versus")
      .replace(/\bapprox\.(?=\s)/gi, "approximately")
      .replace(/(^|\s)w\/(?=\s)/gi, "$1with")
      .replace(/\band\/or\b/gi, "and or")
      .replace(/(^|\s)~(?=\d)/g, "$1about ")
      .replace(/±/g, " plus or minus ")
      .replace(/\s&\s/g, " and ");
  }
  for (const rule of parsePronunciations(pronunciations)) {
    spoken = spoken.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(rule.from)}(?![\\p{L}\\p{N}])`, "giu"), rule.to);
  }
  spoken = normalizeSpace(spoken.replace(/,\s*,/g, ",").replace(/^\s*,\s*/, ""));
  if (close && spoken && !/[.!?…:;]["'”’)\]]*$/.test(spoken)) spoken += ".";
  return spoken;
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
      units.push({ b, s, text, lead, pause: units.length ? pause : 0, start: chars, heading: block.k === "h", close: block.k === "h" || block.k === "li" });
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
