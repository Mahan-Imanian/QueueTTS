import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";

const root = process.cwd();
const problems = [];
const read = (path) => readFileSync(join(root, path), "utf8");
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = join(dir, name);
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
});

const manifest = JSON.parse(read("manifest.json"));
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (JSON.stringify(manifest).includes("<all_urls>") || manifest.host_permissions?.length) problems.push("the extension must not request host permissions");
const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean);
for (const file of referenced) if (!existsSync(join(root, file))) problems.push(`manifest points at a missing file: ${file}`);

for (const file of walk("src").filter((name) => extname(name) === ".js")) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
  } catch (error) {
    problems.push(`syntax error in ${file}: ${String(error.stderr).split("\n").slice(0, 4).join(" ")}`);
  }
}

const scriptFiles = new Set(walk("src").map((file) => file.split(sep).join("/")));
for (const html of walk("pages").filter((name) => extname(name) === ".html")) {
  const text = read(html);
  for (const match of text.matchAll(/(?:src|href)="\.\.\/([^"#?]+)"/g)) if (!existsSync(join(root, match[1]))) problems.push(`${html} references a missing file: ${match[1]}`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) problems.push(`${html} has an inline script, which MV3 blocks`);
}
for (const file of walk("src/background").concat(walk("src/ui"))) {
  for (const match of read(file).matchAll(/files:\s*\[([^\]]+)\]/g)) {
    for (const path of match[1].match(/"([^"]+)"/g) || []) if (!scriptFiles.has(path.slice(1, -1))) problems.push(`${file} injects a missing file: ${path}`);
  }
}
for (const file of walk("src").concat(walk("pages"))) {
  if (file.split(sep).join("/").startsWith("src/vendor/")) continue;
  if (/\bfetch\(|XMLHttpRequest|new WebSocket|sendBeacon/.test(read(file))) problems.push(`${file} makes a network request; QueueTTS promises not to`);
}

if (problems.length) {
  console.error(problems.map((problem) => `✗ ${problem}`).join("\n"));
  process.exit(1);
}
console.log("QueueTTS checks passed.");
