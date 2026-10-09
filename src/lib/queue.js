export const emptyQueue = () => ({ items: [] });

export const queuedItems = (queue) => queue.items.filter((item) => item.status === "queued");

export const historyItems = (queue) => queue.items.filter((item) => item.status === "done").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));

export const findItem = (queue, id) => queue.items.find((item) => item.id === id) || null;

export const findByUrl = (queue, url) => (url ? queue.items.find((item) => item.url === url && item.source === "page") || null : null);

const without = (items, id) => items.filter((item) => item.id !== id);

const insertAfterQueuedIndex = (items, item, queuedIndex) => {
  const queued = items.filter((entry) => entry.status === "queued");
  if (queuedIndex >= queued.length) return [...items, item];
  const anchor = queued[Math.max(0, queuedIndex)];
  const at = items.indexOf(anchor);
  return [...items.slice(0, at), item, ...items.slice(at)];
};

export const addItem = (queue, item, { placement = "end", currentId = "" } = {}) => {
  const items = without(queue.items, item.id);
  const entry = { ...item, status: "queued" };
  if (placement === "end") return { ...queue, items: [...items, entry] };
  const queued = items.filter((candidate) => candidate.status === "queued");
  const currentIndex = queued.findIndex((candidate) => candidate.id === currentId);
  if (placement === "now") return { ...queue, items: insertAfterQueuedIndex(items, entry, 0) };
  return { ...queue, items: insertAfterQueuedIndex(items, entry, currentIndex >= 0 ? currentIndex + 1 : 0) };
};

export const moveToFront = (queue, id) => {
  const item = findItem(queue, id);
  if (!item) return queue;
  return { ...queue, items: insertAfterQueuedIndex(without(queue.items, id), { ...item, status: "queued" }, 0) };
};

export const moveQueued = (queue, id, toIndex) => {
  const item = findItem(queue, id);
  if (!item || item.status !== "queued") return queue;
  const rest = without(queue.items, id);
  const limit = rest.filter((entry) => entry.status === "queued").length;
  return { ...queue, items: insertAfterQueuedIndex(rest, item, Math.max(0, Math.min(limit, toIndex))) };
};

export const updateItem = (queue, id, patch) => ({
  ...queue,
  items: queue.items.map((item) => (item.id === id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item))
});

export const markDone = (queue, id, time = Date.now()) => updateItem(queue, id, { status: "done", finishedAt: time, progress: 1, pos: null });

export const markUnplayed = (queue, id) => {
  const item = findItem(queue, id);
  if (!item) return queue;
  return { ...queue, items: [...without(queue.items, id), { ...item, status: "queued", finishedAt: 0, progress: 0, pos: null }] };
};

export const removeItem = (queue, id) => ({ ...queue, items: without(queue.items, id) });

export const clearHistory = (queue) => ({ ...queue, items: queue.items.filter((item) => item.status !== "done") });

export const nextAfter = (queue, currentId) => queuedItems(queue).find((item) => item.id !== currentId) || null;

export const mergeQueues = (base, incoming) => {
  const known = new Set(base.items.map((item) => item.id));
  const urls = new Set(base.items.filter((item) => item.url).map((item) => `${item.source}:${item.url}`));
  const added = incoming.items.filter((item) => !known.has(item.id) && !(item.url && urls.has(`${item.source}:${item.url}`)));
  return { queue: { ...base, items: [...base.items, ...added] }, added };
};
