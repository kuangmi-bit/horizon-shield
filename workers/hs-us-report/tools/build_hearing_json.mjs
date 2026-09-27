// Writes the hearing questions (src/hearing.js) into the page, between the markers
// <script id="hq" type="application/json"> and </script>, so the form and the worker
// always ask the same questions. Run after editing hearing.js:
//   node tools/build_hearing_json.mjs ../../us/index.html
import fs from "node:fs";
import { pageDefinition } from "../src/hearing.js";

const target = process.argv[2] || new URL("../../../us/index.html", import.meta.url).pathname;
const html = fs.readFileSync(target, "utf8");
const open = '<script id="hq" type="application/json">';
const a = html.indexOf(open), b = html.indexOf("</script>", a);
if (a < 0 || b < 0) { console.error("markers not found in " + target); process.exit(2); }
const json = JSON.stringify(pageDefinition()).replace(/</g, "\\u003c");
const out = html.slice(0, a + open.length) + json + html.slice(b);
fs.writeFileSync(target, out);
console.log(`wrote ${json.length} bytes of hearing JSON into ${target}`);
