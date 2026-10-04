const ENHANCED = /\b(natural|neural|enhanced|premium|siri|wavenet|studio|journey)\b/i;

export const baseLang = (lang) => String(lang || "en").toLowerCase().split(/[-_]/)[0];

const displayNames = new Map();
export const languageName = (lang, uiLang = "en") => {
  if (!lang) return "";
  try {
    if (!displayNames.has(uiLang)) displayNames.set(uiLang, new Intl.DisplayNames([uiLang], { type: "language" }));
    return displayNames.get(uiLang).of(lang) || lang;
  } catch {
    return lang;
  }
};

export const shortVoiceName = (voice) => String(voice?.voiceName || "")
  .replace(/\s+-\s+.*$/, "")
  .replace(/^Microsoft\s+/, "")
  .replace(/^Google\s+/, "Google ")
  .trim() || "System default";

export const describeVoice = (voice) => {
  const remote = Boolean(voice?.remote);
  const tier = remote ? "online" : ENHANCED.test(voice?.voiceName || "") ? "enhanced" : "standard";
  return {
    name: voice?.voiceName || "",
    label: shortVoiceName(voice),
    lang: voice?.lang || "",
    language: languageName(voice?.lang),
    remote,
    tier,
    tierLabel: tier === "online" ? "Online" : tier === "enhanced" ? "Enhanced" : "Standard",
    where: remote ? "Online: the text being read is sent to Google" : "On this computer",
    highlights: !Array.isArray(voice?.eventTypes) || voice.eventTypes.includes("word")
  };
};

const tierScore = (voice, allowNetwork) => {
  const { tier } = describeVoice(voice);
  if (tier === "enhanced") return 0;
  if (tier === "online") return allowNetwork ? 1 : 9;
  return 2;
};

export const rankVoices = (voices, { lang = "en", allowNetwork = false } = {}) => {
  const base = baseLang(lang);
  const exact = String(lang || "").toLowerCase();
  return (Array.isArray(voices) ? voices : [])
    .filter((voice) => !voice.remote || allowNetwork)
    .map((voice) => {
      const voiceLang = String(voice.lang || "").toLowerCase();
      const langScore = voiceLang === exact ? 0 : baseLang(voiceLang) === base ? 1 : 5;
      return { voice, score: langScore * 10 + tierScore(voice, allowNetwork) };
    })
    .sort((a, b) => a.score - b.score || String(a.voice.voiceName).localeCompare(String(b.voice.voiceName)))
    .map((entry) => entry.voice);
};

export const preferredVoiceName = (settings, lang) => settings?.voices?.[baseLang(lang)] || "";

export const pickVoice = (voices, settings, lang) => {
  const allowNetwork = Boolean(settings?.allowNetworkVoices);
  const wanted = preferredVoiceName(settings, lang);
  if (wanted) {
    const chosen = (voices || []).find((voice) => voice.voiceName === wanted);
    if (chosen && (!chosen.remote || allowNetwork)) return { voice: chosen, reason: "preferred" };
  }
  const ranked = rankVoices(voices, { lang, allowNetwork });
  const best = ranked[0] || null;
  if (best && baseLang(best.lang) === baseLang(lang)) return { voice: best, reason: wanted ? "preferred unavailable" : "automatic" };
  return { voice: best, reason: best ? "no voice for language" : "none" };
};
