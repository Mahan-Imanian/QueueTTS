export const loadVoices = () => {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis?.getVoices() || [];
    if (voices.length) {
      resolve(voices);
      return;
    }
    window.speechSynthesis?.addEventListener('voiceschanged', () => {
      resolve(window.speechSynthesis.getVoices());
    }, { once: true });
  });
};

export const filterVoices = (voices, query) => {
  if (!query) {
    return voices;
  }
  const lowered = query.toLowerCase();
  return voices.filter((voice) => `${voice.name} ${voice.lang}`.toLowerCase().includes(lowered));
};

export const findVoice = (voices, uri) => {
  return voices.find((voice) => voice.voiceURI === uri) || null;
};
