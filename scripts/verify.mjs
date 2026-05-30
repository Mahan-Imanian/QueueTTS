import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const required = [
  "index.html",
  "404.html",
  "assets/css/app.css",
  "assets/js/app.js",
  "assets/img/mark.svg",
  "README.md",
  "docs/architecture.md",
  "docs/data-model.md",
  "docs/keyboard.md"
];

for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const html = readFileSync("index.html", "utf8");
const js = readFileSync("assets/js/app.js", "utf8");
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
const selectorIds = [...js.matchAll(/\$\("#([^" ]+)"\)/g)].map((match) => match[1]);
const missing = selectorIds.filter((id) => !ids.has(id));
if (missing.length) throw new Error(`Missing HTML ids for JS selectors: ${[...new Set(missing)].join(", ")}`);

execFileSync(process.execPath, ["--check", "assets/js/app.js"], { stdio: "inherit" });

if (!html.includes('type="module" src="assets/js/app.js"')) throw new Error("index.html does not load the app module.");
if (!html.includes('href="assets/css/app.css"')) throw new Error("index.html does not load the stylesheet.");
if (!html.includes('id="main"')) throw new Error("Missing main landmark target.");

console.log("QueueTTS verification passed.");
