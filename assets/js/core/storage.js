const STORAGE_KEY = 'queuetts.v1';

export const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Failed to load state', error);
    return null;
  }
};

export const saveState = (state) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save state', error);
  }
};

export const exportState = (state) => {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
};

export const importState = (raw) => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid JSON');
  }
  if (!parsed.version) {
    throw new Error('Missing version');
  }
  if (parsed.version === 1) {
    return {
      queue: parsed.queue || [],
      prefs: parsed.prefs || {},
      playback: parsed.playback || {},
    };
  }
  throw new Error(`Unsupported version ${parsed.version}`);
};
