import { copyFileSync } from "node:fs";

const from = "node_modules/@mozilla/readability/";
for (const [source, target] of [["Readability.js", "Readability.js"], ["Readability-readerable.js", "Readability-readerable.js"], ["LICENSE.md", "READABILITY-LICENSE.md"]]) copyFileSync(`${from}${source}`, `src/vendor/${target}`);
console.log("Vendored @mozilla/readability into src/vendor.");
