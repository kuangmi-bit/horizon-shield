// Regenerates the published sample from the engine: site/us/sample-report.json, the hashes on
// /us/index.html, the canary fixture and the test expectation. Run after any engine change that
// is meant to alter the sample.
import { readFileSync, writeFileSync } from "node:fs";
import { computeReport } from "../src/engine.js";
import { canon, sha256Hex } from "../src/canon.js";
const SITE = "/tmp/claude-0/us/site/us/";
const input = JSON.parse(readFileSync(new URL("../test/fixtures/sample_input.json", import.meta.url)));
const bytes = canon(computeReport(input));
const sha = await sha256Hex(bytes);
writeFileSync(SITE + "sample-report.json", bytes);
writeFileSync(new URL("../test/fixtures/sample_report.json", import.meta.url), bytes);
writeFileSync("/tmp/claude-0/us/sample_report.json", bytes);
let html = readFileSync(SITE + "index.html", "utf8");
const old = html.match(/<span class="hash">([0-9a-f]{64})<\/span>/)[1];
html = html.split(old).join(sha).replace(/sha256 [0-9a-f]{8}&hellip;/, `sha256 ${sha.slice(0, 8)}&hellip;`);
writeFileSync(SITE + "index.html", html);
let t = readFileSync(new URL("../test/engine.test.mjs", import.meta.url), "utf8");
t = t.replace(/assert\.equal\(h, "[0-9a-f]{64}"\)/, `assert.equal(h, "${sha}")`);
writeFileSync(new URL("../test/engine.test.mjs", import.meta.url), t);
writeFileSync("/tmp/claude-0/us/sample_sha.txt", sha);
console.log("sample sha256", sha, "| old", old.slice(0, 8));
