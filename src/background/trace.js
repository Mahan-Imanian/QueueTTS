let trace = null;

export const startTrace = (reason) => {
  trace = { reason, at: Date.now(), t0: performance.now(), marks: [], done: false };
};

export const traceRunning = () => Boolean(trace && !trace.done);

export const mark = (name, extra = {}) => {
  if (!trace || trace.done) return;
  trace.marks.push({ name, ms: Math.round((performance.now() - trace.t0) * 10) / 10, ...extra });
  if (name === "first word" || name === "error") {
    trace.done = true;
    chrome.storage.session.set({ lastStart: liveTrace() }).catch(() => {});
  }
};

export const liveTrace = () => {
  if (!trace) return null;
  const { t0, ...saved } = trace;
  return saved;
};
