const NOISE_LEVEL = 0.00004;

let context = null;
let source = null;
let until = 0;
let timer = 0;

const start = async () => {
  if (!context) {
    context = new AudioContext({ latencyHint: "playback" });
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = (Math.random() * 2 - 1) * NOISE_LEVEL;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination);
    source.start();
  }
  if (context.state !== "running") await context.resume();
  return { running: context.state === "running", outputLatency: Math.round((context.outputLatency || context.baseLatency || 0) * 1000) };
};

const stop = async () => {
  clearTimeout(timer);
  if (!context) return;
  const closing = context;
  context = null;
  source = null;
  await closing.close().catch(() => {});
};

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => (Date.now() >= until ? stop() : schedule()), Math.max(250, until - Date.now()));
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "qtts-audio") return false;
  if (message.action === "warm") {
    until = Math.max(until, Date.now() + (Number(message.ms) || 30000));
    schedule();
    start().then(sendResponse, (error) => sendResponse({ running: false, error: String(error) }));
    return true;
  }
  if (message.action === "cool") {
    until = 0;
    stop().then(() => sendResponse({ running: false }));
    return true;
  }
  sendResponse({ running: Boolean(context && context.state === "running") });
  return false;
});
