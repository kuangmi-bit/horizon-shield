#!/usr/bin/env node
// tsunagi_reference_batch.mjs : the batch side of the TSUNAGI contract for this package's own verifier
// (nenrin_verify.mjs). Copy it and replace the verifyProvenance call with yours to put a JavaScript verifier on the
// board; the board and `npx nenrin-tsunagi run` score what it writes.
//
//   node tsunagi_reference_batch.mjs <in.json> <out.json>
//   npx nenrin-tsunagi run nenrin-interop-v0.2-edge -- "node node_modules/nenrin-verify/tsunagi_reference_batch.mjs {in} {out}"
//
// in: [{"name", "bundle"}]; out: {name: {"verdict", "refusals", "findings"} | {"error"}}.
import { readFileSync, writeFileSync } from "node:fs";
import { verifyProvenance, didKeyResolver } from "./nenrin_verify.mjs";
const [inp, outp] = process.argv.slice(2);
if (!inp || !outp) { console.error("usage: node tsunagi_reference_batch.mjs <in.json> <out.json>"); process.exit(2); }
const out = {};
for (const c of JSON.parse(readFileSync(inp, "utf8"))) {
  try {
    const p = verifyProvenance(Object.assign({}, c.bundle, { resolve: didKeyResolver }));
    out[c.name] = { verdict: p.verdict, refusals: p.refusals.map((r) => r.code), findings: p.findings.map((f) => f.code) };
  } catch (e) { out[c.name] = { error: String((e && e.message) || e) }; }
}
writeFileSync(outp, JSON.stringify(out));
console.log("wrote " + Object.keys(out).length + " verdict signatures (nenrin_verify.mjs)");
