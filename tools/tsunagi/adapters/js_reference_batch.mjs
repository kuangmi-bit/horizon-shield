// TSUNAGI batch adapter for this project's reference JavaScript verifier (sdk/nenrin_verify.mjs, npm nenrin-verify).
// node js_reference_batch.mjs <in.json> <out.json>
// in: [{"name","bundle"}]; out: {name: {"verdict","refusals","findings"} | {"error"}}. The board scores out itself.
import { readFileSync, writeFileSync } from "node:fs";
import { verifyProvenance, didKeyResolver } from "../../../workers/hs-ledger/nenrin/sdk/nenrin_verify.mjs";
const [inp, outp] = process.argv.slice(2);
if (!inp || !outp) { console.error("usage: node js_reference_batch.mjs <in.json> <out.json>"); process.exit(2); }
const out = {};
for (const c of JSON.parse(readFileSync(inp, "utf8"))) {
  try {
    const p = verifyProvenance(Object.assign({}, c.bundle, { resolve: didKeyResolver }));
    out[c.name] = { verdict: p.verdict, refusals: p.refusals.map((r) => r.code).sort(), findings: p.findings.map((f) => f.code).sort() };
  } catch (e) { out[c.name] = { error: String(e && e.message || e) }; }
}
writeFileSync(outp, JSON.stringify(out));
console.log("wrote " + Object.keys(out).length + " verdict signatures (reference JS)");
