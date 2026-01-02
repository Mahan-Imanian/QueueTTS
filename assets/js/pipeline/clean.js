const ABBREVIATIONS = {
  'e.g.': 'for example',
  'i.e.': 'that is',
  'vs.': 'versus',
  'etc.': 'et cetera',
  'w/': 'with',
  'w/o': 'without',
};

export const normalizeWhitespace = (text) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
};

export const expandAbbreviations = (text, customMap = {}) => {
  let updated = text;
  const map = { ...ABBREVIATIONS, ...customMap };
  Object.keys(map).forEach((key) => {
    const value = map[key];
    updated = updated.replace(new RegExp(key.replace('.', '\\.'), 'gi'), value);
  });
  return updated;
};

export const applyDictionary = (text, dictionary = {}) => {
  let updated = text;
  Object.entries(dictionary).forEach(([key, value]) => {
    updated = updated.replace(new RegExp(`\\b${key}\\b`, 'gi'), value);
  });
  return updated;
};

export const quickClean = (text) => {
  return normalizeWhitespace(text)
    .replace(/\s([?.!,;:])/g, '$1')
    .replace(/([?.!])\s*(\p{Lu})/gu, '$1 $2');
};

export const cleanText = ({ text, dictionary, cleanup }) => {
  if (!text) {
    return '';
  }
  let output = text;
  if (cleanup) {
    output = quickClean(output);
  }
  output = expandAbbreviations(output, dictionary);
  output = normalizeWhitespace(output);
  return output;
};
