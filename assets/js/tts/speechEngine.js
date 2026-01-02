export class SpeechEngine {
  constructor({ onStart, onEnd, onError, onBoundary }) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.onError = onError;
    this.onBoundary = onBoundary;
    this.currentUtterance = null;
    this.isSpeaking = false;
  }

  speak({ text, voice, rate, pitch, lang }) {
    if (!window.speechSynthesis) {
      this.onError?.(new Error('Speech synthesis not supported'));
      return;
    }
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice || null;
    utterance.rate = rate || 1;
    utterance.pitch = pitch || 1;
    utterance.lang = lang || voice?.lang || 'en-US';
    utterance.onstart = () => {
      this.isSpeaking = true;
      this.onStart?.();
    };
    utterance.onend = () => {
      this.isSpeaking = false;
      this.onEnd?.();
    };
    utterance.onerror = (event) => {
      this.isSpeaking = false;
      this.onError?.(event.error || new Error('Speech error'));
    };
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        this.onBoundary?.(event);
      }
    };
    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  pause() {
    if (window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
    }
  }

  resume() {
    if (window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
    }
  }

  cancel() {
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.paused) {
      window.speechSynthesis.cancel();
    }
  }
}
