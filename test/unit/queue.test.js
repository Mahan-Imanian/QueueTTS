import test from "node:test";
import assert from "node:assert/strict";
import { addItem, clearHistory, emptyQueue, historyItems, markDone, markUnplayed, mergeQueues, moveQueued, moveToFront, nextAfter, queuedItems, removeItem } from "../../src/lib/queue.js";

const item = (id, extra = {}) => ({ id, title: id, status: "queued", ...extra });
const ids = (list) => list.map((entry) => entry.id);

test("captures append to the end and never displace the current item", () => {
  let q = emptyQueue();
  q = addItem(q, item("a"));
  q = addItem(q, item("b"), { currentId: "a" });
  q = addItem(q, item("c"), { currentId: "a" });
  assert.deepEqual(ids(queuedItems(q)), ["a", "b", "c"]);
  assert.equal(nextAfter(q, "a").id, "b");
});

test("play next inserts right after the current item", () => {
  let q = { items: [item("a"), item("b"), item("c")] };
  q = addItem(q, item("n"), { placement: "next", currentId: "a" });
  assert.deepEqual(ids(queuedItems(q)), ["a", "n", "b", "c"]);
});

test("playing an item moves it to the front and keeps the rest in order", () => {
  const q = moveToFront({ items: [item("a"), item("b"), item("c")] }, "c");
  assert.deepEqual(ids(queuedItems(q)), ["c", "a", "b"]);
});

test("finished items leave the queue and land in history, newest first", () => {
  let q = { items: [item("a"), item("b"), item("c")] };
  q = markDone(q, "a", 1);
  q = markDone(q, "b", 2);
  assert.deepEqual(ids(queuedItems(q)), ["c"]);
  assert.deepEqual(ids(historyItems(q)), ["b", "a"]);
  assert.equal(nextAfter(q, "b").id, "c");
  q = markUnplayed(q, "a");
  assert.deepEqual(ids(queuedItems(q)), ["c", "a"]);
  assert.equal(q.items.find((entry) => entry.id === "a").progress, 0);
  q = clearHistory(q);
  assert.deepEqual(ids(q.items), ["c", "a"]);
});

test("reordering only touches queued items", () => {
  let q = { items: [item("a"), item("d", { status: "done" }), item("b"), item("c")] };
  q = moveQueued(q, "c", 1);
  assert.deepEqual(ids(queuedItems(q)), ["a", "c", "b"]);
  q = moveQueued(q, "a", 99);
  assert.deepEqual(ids(queuedItems(q)), ["c", "b", "a"]);
  assert.equal(moveQueued(q, "d", 0), q);
});

test("remove and merge", () => {
  const q = removeItem({ items: [item("a"), item("b")] }, "a");
  assert.deepEqual(ids(q.items), ["b"]);
  const merged = mergeQueues({ items: [item("a", { url: "u1", source: "page" })] }, { items: [item("a"), item("x", { url: "u1", source: "page" }), item("y")] });
  assert.deepEqual(ids(merged.added), ["y"]);
});
