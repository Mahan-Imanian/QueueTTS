import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.cwd();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const read = (path) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const required = [
  "manifest.json",
  "src/background.js",
  "src/content.js",
  "src/shared.js",
  "src/popup.js",
  "src/sidepanel.js",
  "src/options.js",
  "pages/popup.html",
  "pages/sidepanel.html",
  "pages/options.html",
  "styles/base.css",
  "assets/icons/icon-16.png",
  "assets/icons/icon-32.png",
  "assets/icons/icon-48.png",
  "assets/icons/icon-128.png",
  "REBUILD_NOTES.md",
  "README.md"
];
for (const file of required) if (!existsSync(join(root, file))) fail(`Missing required file: ${file}`);
if (manifest.manifest_version !== 3) fail("Manifest must be version 3.");
if (!manifest.background?.service_worker) fail("Missing service worker.");
if (!manifest.action?.default_popup) fail("Missing toolbar popup.");
if (!manifest.side_panel?.default_path) fail("Missing side panel.");
if (!manifest.options_page) fail("Missing options page.");
if (JSON.stringify(manifest).includes("<all_urls>")) fail("Manifest must not request all_urls.");
for (const permission of ["storage", "contextMenus", "activeTab", "scripting", "sidePanel", "tts", "alarms"]) {
  if (!manifest.permissions.includes(permission)) fail(`Missing permission: ${permission}`);
}
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = join(dir, name);
  const absolute = join(root, path);
  return statSync(absolute).isDirectory() ? walk(path) : [path];
});
const files = ["manifest.json", ...walk("src"), ...walk("pages"), ...walk("styles")];
for (const file of files) {
  const text = read(file);
  if (/https?:\/\//i.test(text) && !/sourceUrl|Source URL|current page|http or https page|url\(/i.test(text)) fail(`Remote URL-like reference found in ${file}`);
  if (/TODO|lorem ipsum|placeholder section/i.test(text)) fail(`Placeholder marker found in ${file}`);
}
for (const file of walk("src").filter((name) => extname(name) === ".js")) execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "inherit" });
for (const html of walk("pages").filter((name) => extname(name) === ".html")) {
  const text = read(html);
  for (const match of text.matchAll(/(?:src|href)="\.\.\/([^"]+)"/g)) {
    const target = match[1];
    if (!target.startsWith("#") && !existsSync(join(root, target))) fail(`Broken asset reference in ${html}: ${target}`);
  }
}
console.log("QueueTTS extension checks passed.");
