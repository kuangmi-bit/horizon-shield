// run_edge.mjs : the reference verifier (sdk/nenrin_verify.mjs) over the interop-v0.2/edge corpus. Each fixture's
// verdict signature must equal expected.json, which was cut by an independent implementation (python/verify_edge.py)
// from VERIFIER.md alone. Run: node run_edge.mjs        (python3 python/run_edge.py runs the independent one)
import { readFileSync } from "node:fs";
import { verifyProvenance, didKeyResolver } from "../../sdk/nenrin_verify.mjs";
const root = new URL("./", import.meta.url);
const cases = JSON.parse(readFileSync(new URL("expected.json", root), "utf8")).cases;
const sig = (p) => ({ verdict: p.verdict, refusals: p.refusals.map((r) => r.code).sort(), findings: p.findings.map((f) => f.code).sort() });
let fail = 0;
for (const [name, c] of Object.entries(cases)) {
  const bundle = JSON.parse(readFileSync(new URL("fixtures/" + name + ".json", root), "utf8"));
  const want = { verdict: c.expect.verdict, refusals: [...c.expect.refusals].sort(), findings: [...c.expect.findings].sort() };
  let got; try { got = sig(verifyProvenance(Object.assign({}, bundle, { resolve: didKeyResolver }))); } catch (e) { got = { threw: String(e && e.message || e) }; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : "  expected " + JSON.stringify(want) + " got " + JSON.stringify(got)));
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS (interop-v0.2/edge: the reference reproduces every verdict signature an independent implementation cut from the text)");
process.exit(fail ? 1 : 0);
