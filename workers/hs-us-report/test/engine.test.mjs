// Canary: the sample input must reproduce the published sample report byte for byte.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { computeReport, summarize, buildQuestions } from "../src/engine.js";
import { canon, sha256Hex } from "../src/canon.js";

const input = JSON.parse(readFileSync(new URL("./fixtures/sample_input.json", import.meta.url)));
const published = readFileSync(new URL("./fixtures/sample_report.json", import.meta.url), "utf8");
const report = computeReport(input);
const bytes = canon(report);
assert.equal(bytes, published, "sample report bytes differ from the published file");
const h = await sha256Hex(bytes);
assert.equal(h, "5f59307d0da2ab5179fab418045cd0b1177658777aff37cc360d3b86f762b4f9");
const s = summarize(report);
assert.deepEqual([s.total, s.above_count, s.above_usd, s.no_data_count, s.ask_count], [19872, 2, 4288, 2, 1]);
const qs = buildQuestions(report);
assert.equal(qs.length, 6);
assert.ok(qs.every((q) => !/[‒-―−]/.test(q.text)), "no dash characters");
// detailed estimate: no quoted amounts, totals from references
const de = computeReport({ ...input, sample: false, kind: "detailed_estimate", lines: input.lines.map(({ quoted, ...l }) => l) });
assert.deepEqual(de.estimate_total_usd, [2120 + 3121, 2304 + 4308]);
assert.equal(de.lines.find((l) => l.item.startsWith("Labor")).status, "estimate");
assert.equal(de.quote_total, undefined);
// unloaded labor when no DOT markup is on file
const ul = computeReport({ ...input, sample: false, lines: [{ item: "Labor", quoted: 5000, kind: "labor", labor: { hours: 40, wage_mean_usd_h: 25, wage_p90_usd_h: 35 } }] });
assert.equal(ul.lines[0].reference_kind, "unloaded_wage");
assert.deepEqual(ul.lines[0].reference_usd, [1000, 1400]);
console.log("engine ok", h.slice(0, 16));
