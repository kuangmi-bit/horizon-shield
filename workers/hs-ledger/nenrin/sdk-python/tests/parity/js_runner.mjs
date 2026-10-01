// js_runner.mjs <path to nenrin_verify.mjs> : read one bundle per line (JSON text) on stdin, write one result per
// line on stdout: the report and the consume projection in the shared sorted-key form, or that the verifier threw.
// Each bundle is parsed with JSON.parse and verified with did:key resolution, exactly as the CLI does.
// Lines are split on "\n" only. node:readline is not used: from Node 24 it also breaks lines at U+2028 and
// U+2029, which the corpus carries raw inside strings.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { jsCanon } from "./js_canon.mjs";

const N = await import(pathToFileURL(process.argv[2]).href);
for (const line of readFileSync(0, "utf8").split("\n")) {
  if (!line) continue;
  let out;
  try {
    const bundle = JSON.parse(line);
    const input = Object.assign({}, bundle, { resolve: N.didKeyResolver });
    const rep = N.verifyProvenance(input);
    const con = N.consumeEvidence(input);
    out = { threw: false, report: jsCanon(rep), consume: jsCanon(con) };
  } catch (e) {
    out = { threw: true, error: String(e && e.message || e).slice(0, 200) };
  }
  process.stdout.write(JSON.stringify(out) + "\n");
}
