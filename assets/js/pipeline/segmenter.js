const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z0-9“"'])/g;
const MAX_SEGMENT_LENGTH = 260;

const detectHeadings = (text) => {
  const lines = text.split(/\n+/);
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length < 3) {
      return null;
    }
    const isHeading = /^#{1,4}\s/.test(trimmed) || (trimmed === trimmed.toUpperCase() && trimmed.length < 80);
    return isHeading ? trimmed.replace(/^#{1,4}\s*/, '') : null;
  });
};

const splitSentences = (text) => {
  return text.split(SENTENCE_BOUNDARY).filter(Boolean);
};

const buildSegments = (sentences) => {
  const segments = [];
  let buffer = '';
  sentences.forEach((sentence) => {
    if (buffer.length + sentence.length + 1 > MAX_SEGMENT_LENGTH) {
      if (buffer) {
        segments.push(buffer.trim());
      }
      buffer = sentence;
    } else {
      buffer = `${buffer} ${sentence}`.trim();
    }
  });
  if (buffer) {
    segments.push(buffer.trim());
  }
  return segments;
};

export const segmentText = ({ text, headingMode = 'cue' }) => {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const headingHints = detectHeadings(text);
  const segments = [];
  let headingIndex = 0;

  lines.forEach((line) => {
    const heading = headingHints[headingIndex];
    if (heading && headingMode !== 'off') {
      if (headingMode === 'cue') {
        segments.push({ text: `Heading. ${heading}`, heading: true });
      } else if (headingMode === 'pause') {
        segments.push({ text: '', heading: true });
      }
      headingIndex += 1;
      return;
    }
    const sentences = splitSentences(line);
    const built = buildSegments(sentences);
    built.forEach((segment) => {
      segments.push({ text: segment, heading: false });
    });
    headingIndex += 1;
  });

  return segments.filter((segment) => segment.text || segment.heading);
};

export const estimateSegmentDurations = (segments, rate = 1) => {
  const wordsPerSecond = 2.2 * rate;
  return segments.map((segment) => {
    const words = segment.text ? segment.text.split(/\s+/).length : 0;
    const seconds = words ? Math.max(1, words / wordsPerSecond) : 0.4;
    return { words, seconds };
  });
};
