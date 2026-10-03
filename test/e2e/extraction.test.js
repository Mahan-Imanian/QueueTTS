import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./harness.mjs";

let app;
before(async () => {
  app = await launch();
  await app.quietVoice();
});
after(() => app?.close());

const capture = async (url, fixture, mode = "page") => {
  const page = await app.fixture(url, fixture);
  const tabId = await app.tabId(page);
  if (mode === "selection") await page.evaluate(() => {
    const paragraphs = document.querySelectorAll("article > p:not(.kicker):not(.byline)");
    const range = document.createRange();
    range.setStartBefore(paragraphs[0]);
    range.setEndAfter(paragraphs[1]);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  const result = await app.send("capture", tabId, mode, "end");
  await page.close();
  if (!result.ok) return { result };
  const stored = await app.storage(`doc:${result.item.id}`);
  const doc = stored[`doc:${result.item.id}`];
  return { result, item: result.item, doc, text: doc.blocks.map((block) => block.t).join("\n"), kinds: doc.blocks.map((block) => block.k) };
};

const contains = (text, needles) => needles.forEach((needle) => assert.ok(text.includes(needle), `expected to find: ${needle}`));
const excludes = (text, needles) => needles.forEach((needle) => assert.ok(!text.includes(needle), `should not contain: ${needle}`));

test("Wikipedia: article body only, no citations, edit links, references or categories", async () => {
  const { item, text, doc } = await capture("https://en.wikipedia.org/wiki/Night_bus", "wikipedia.html");
  assert.equal(item.title, "Night bus");
  contains(text, ["A night bus is a bus service that operates between the evening and the early morning", "Early night services were introduced", "Services usually run every 20 to 60 minutes."]);
  excludes(text, ["[1]", "[2]", "citation needed", "[edit]", "For the 2008 film", "Smith, J.", "Categories", "Contents", "Owl service", "Tram", "waiting at a terminus", "Jump to content", "Creative Commons"]);
  assert.deepEqual(doc.blocks.filter((block) => block.k === "h").map((block) => block.t), ["History", "Operation"]);
});

test("MDN: reads the reference page, keeps code as code, drops chrome and compat tables", async () => {
  const { item, text, doc } = await capture("https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis", "mdn.html");
  assert.equal(item.title, "SpeechSynthesis");
  contains(text, ["controller interface for the speech service", "returns true if the speech queue is in a paused state", "Inside the submit handler"]);
  excludes(text, ["Skip to main content", "Chrome 33", "Was this page helpful", "last modified", "Copy to Clipboard", "Baseline", "In this article", "Search MDN", "blueprint"]);
  assert.ok(doc.blocks.some((block) => block.k === "code" && block.t.includes("speechSynthesis")));
  assert.ok(!doc.blocks.some((block) => block.k === "h" && /Specifications|Browser compatibility/.test(block.t)), "empty sections are dropped");
});

test("MDN (2025 layout): content inside a display:contents <main> is not mistaken for hidden text", async () => {
  const { item, text } = await capture("https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance", "mdn-2025.html");
  assert.equal(item.title, "SpeechSynthesisUtterance");
  contains(text, ["represents a speech request", "Listen to the boundary event"]);
  excludes(text, ["Log in", "Chrome 33", "In this article", "Baseline", "blueprint", "Web Speech API\nSpeechSynthesis"]);
});

test("GitHub: README content, not the repository chrome", async () => {
  const { item, text, doc } = await capture("https://github.com/acme/nightline", "github.html");
  assert.equal(item.title, "nightline");
  contains(text, ["Nightline runs small jobs on a schedule while your laptop sleeps", "Missed jobs run once at the next wake"]);
  excludes(text, ["Sign in", "Fork 12", "Fix retry backoff", "Go 96.1%", "Skip to content", "Permalink", "About", "Pricing"]);
  assert.ok(doc.blocks.some((block) => block.k === "code" && block.t.includes("brew install nightline")));
  assert.ok(doc.blocks.some((block) => block.k === "h" && block.t === "Why another scheduler?"));
});

test("Table-layout essay: paragraphs split at <br><br>, wrapped lines joined, notes cut", async () => {
  const { item, text, doc } = await capture("https://essays.example/quiet.html", "essay.html");
  assert.equal(item.title, "Quiet Hours");
  contains(text, ["If you watch how people do their best work, a pattern shows up. The work happens in long stretches when nobody needs anything from them", "Partly this is about attention."]);
  excludes(text, ["2026If", "attention.A", "This is less true for work", "Thanks to Ada", "Essays | RSS"]);
  assert.ok(doc.blocks.some((block) => block.k === "h" && block.t === "Mornings"), "bold one-line paragraphs become headings");
  assert.ok(doc.blocks.filter((block) => block.k === "p").length >= 4);
});

test("News article: byline is just the author; cookie banner, newsletter, related and comments are dropped", async () => {
  const { item, text, kinds } = await capture("https://metroreview.example/cities/night-bus", "news.html");
  assert.equal(item.title, "Why Cities Are Rethinking the Night Bus");
  assert.equal(item.author, "Lena Okafor");
  contains(text, ["Dr. Samuel Reyes, a transport researcher at U.C.L.A.", "Timed transfers at a small number of well-lit hubs."]);
  excludes(text, ["We use cookies", "Get the Cities newsletter", "delivered every Friday", "Comments (214)", "exactly what my city needs", "Most read", "Ten cities that got cycling", "All rights reserved", "Photograph:"]);
  assert.ok(kinds.includes("q") && kinds.includes("li") && kinds.includes("h"));
});

test("Docs site: guide body without edit links, pagination or feedback widgets", async () => {
  const { item, text } = await capture("https://docs.relay.example/guides/retries", "docs.html");
  assert.equal(item.title, "Configuring retries");
  contains(text, ["A failed message is retried five times", "Changes take effect for new messages only."]);
  excludes(text, ["Edit this page", "Was this page helpful", "Getting started", "Docs › Guides", "Skip to content", "Copyright"]);
});

test("Blog post: subscription widgets, captions, comments and recommendations are dropped", async () => {
  const { item, text } = await capture("https://fieldnotes.example/p/tiny-app", "blog.html");
  assert.equal(item.title, "What I learned shipping a tiny app");
  assert.equal(item.author, "Priya Raman");
  contains(text, ["The hard part was deciding what not to build.", "Scope is a feature"]);
  excludes(text, ["Thanks for reading Field Notes", "Type your email", "17 Comments", "Recommended", "Why I stopped adding settings", "The first version of the reminder screen", "Restack"]);
});

test("Hidden text is never read", async () => {
  const { text } = await capture("https://coastline.example/tidal", "hidden.html");
  excludes(text, ["HIDDEN-DISPLAY-NONE", "HIDDEN-SR-ONLY", "HIDDEN-ARIA", "HIDDEN-VISIBILITY"]);
  contains(text, ["Tidal power turns the rise and fall", "The main obstacle is cost."]);
});

test("A page with no article text fails honestly and adds nothing", async () => {
  const before = (await app.queue()).length;
  const { result } = await capture("https://app.acme.io/dashboard", "thin.html");
  assert.equal(result.ok, false);
  assert.match(result.message, /no article text/i);
  assert.equal((await app.queue()).length, before);
});

test("A section front full of headlines is declined instead of read as headline soup", async () => {
  const { result } = await capture("https://ledger.example/technology", "front.html");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "listing");
  assert.match(result.message, /list of articles/);
});

test("Selected text keeps its paragraphs and gets a readable title", async () => {
  const { item, doc } = await capture("https://metroreview.example/selection-test", "news.html", "selection");
  assert.equal(item.source, "selection");
  assert.equal(doc.blocks.length, 2);
  assert.match(item.title, /^For most of the twentieth century/);
});

test("Adding the same page twice does not duplicate it", async () => {
  const first = await capture("https://metroreview.example/dupe?utm_source=x", "news.html");
  const second = await capture("https://metroreview.example/dupe", "news.html");
  assert.equal(second.result.duplicate, true);
  assert.equal(second.result.item.id, first.item.id);
});
