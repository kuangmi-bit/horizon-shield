// js_sig_runner.mjs <path to nenrin_verify.mjs> : one bundle per line (JSON text) on stdin, one result per line on
// stdout: the verdict signature and the refusals as (code, reason), or that the verifier threw. Parsed with
// JSON.parse and verified with did:key resolution, exactly as the reference CLI does. Lines split on "\n" only.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const N = await import(pathToFileURL(process.argv[2]).href);
const set = (xs) => [...new Set(xs)].sort();
for (const line of readFileSync(0, "utf8").split("\n")) {
  if (!line) continue;
  let out;
  try {
    const bundle = JSON.parse(line);
    const rep = N.verifyProvenance(Object.assign({}, bundle, { resolve: N.didKeyResolver }));
    out = {
      threw: false,
      signature: { verdict: rep.verdict, refusals: set(rep.refusals.map((r) => r.code)), findings: set(rep.findings.map((f) => f.code)) },
      codes: rep.refusals.map((r) => ({ code: r.code, reason: typeof r.reason === "string" ? r.reason : (typeof r.status === "string" ? r.status : "") })),
    };
  } catch (e) {
    out = { threw: true, error: String(e && e.message || e).slice(0, 200) };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}
