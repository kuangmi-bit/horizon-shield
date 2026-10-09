// TSUNAGI batch adapter for the ledger's own TRACE intake (workers/hs-ledger/nenrin/trace-pin-v0/trace_pin_v0.mjs, the code
// behind POST /evidence/trace), so the board holds the production module to the same corpus as the SDK ports.
//   node js_trace_pin_batch.mjs <in.json> <out.json>        corpus nenrin-trace-intake-v0
import { readFileSync, writeFileSync } from "node:fs";
import { checkTraceRecord, Refusal } from "../../../workers/hs-ledger/nenrin/trace-pin-v0/trace_pin_v0.mjs";

const [inp, outp] = process.argv.slice(2);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const out = {};
for (const c of JSON.parse(readFileSync(inp, "utf8"))) {
  const b = c.bundle;
  try {
    if (!isObj(b) || !Number.isInteger(b.now)) throw new Error("an intake bundle is {now, vector}");
    const v = b.vector;
    const rec = isObj(v) && Object.prototype.hasOwnProperty.call(v, "record") && isObj(v.record) ? v.record : v;
    try { await checkTraceRecord(rec, b.now); out[c.name] = { verdict: "pinnable", refusals: [], findings: [] }; }
    catch (e) { if (e instanceof Refusal) out[c.name] = { verdict: "refused", refusals: [e.code], findings: [] }; else throw e; }
  } catch (e) { out[c.name] = { error: String((e && e.message) || e).slice(0, 160) }; }
}
writeFileSync(outp, JSON.stringify(out));
console.log("wrote " + Object.keys(out).length + " verdict signatures (ledger trace-pin-v0 intake)");
