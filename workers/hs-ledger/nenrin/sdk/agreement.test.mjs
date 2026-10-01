// agreement.test.mjs : the agreement verifier as shipped in this package is the repository's, and its command prints
// what the Python command prints.
//
//   node agreement.test.mjs
//
// 1. agreement_verify.mjs, agreement_canonical.mjs and key_succession.mjs are byte-identical to
//    ../agreement-v0/, where agreement_verify_test.mjs scores them against all 5,286 frozen Python reports.
// 2. agreement_cli.mjs, run on the inputs listed in agreement_cli_expected.json, prints stdout whose sha256 is the
//    sha256 of the Python command's stdout on the same input, with the same exit code. That file was written by
//    agreement_cli_parity.py from the Python verifier (agreement-v0/agreement_verify.py), so this test needs no Python.
//    The one documented difference, the text of a JSON parse error, is checked with "why" removed.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGR = path.join(HERE, "..", "agreement-v0");
let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("FAIL " + name + (detail ? "  " + detail : "")); }
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

for (const f of ["agreement_verify.mjs", "agreement_canonical.mjs", "key_succession.mjs"]) {
  const a = readFileSync(path.join(HERE, f)), b = readFileSync(path.join(AGR, f));
  t(f + " is byte-identical to agreement-v0/" + f, sha(a) === sha(b), sha(a).slice(0, 12) + " vs " + sha(b).slice(0, 12));
}

const exp = JSON.parse(readFileSync(path.join(HERE, "agreement_cli_expected.json"), "utf8"));
const tmp = mkdtempSync(path.join(tmpdir(), "agr-"));
const fixed = {
  "bad.json": '{"schema": "a2a-agreement-v1.1", ',
  "dup.json": '{"a": 1, "a": 2}',
  "array.json": "[1, 2, 3]",
};
for (const [n, s] of Object.entries(fixed)) writeFileSync(path.join(tmp, n), s);

function argsFor(name, e) {
  if (/^case \d+/.test(name)) {
    const id = name.replace(/\D+/g, "_");
    const rp = path.join(tmp, id + ".json");
    writeFileSync(rp, e.text, "utf8");
    const out = [rp];
    if (e.keys) { const kp = path.join(tmp, id + ".keys.json"); writeFileSync(kp, JSON.stringify(e.keys)); out.push("--keys", kp); }
    return out.concat(e.flags);
  }
  return e.args.map((a) => (fixed[a] !== undefined ? path.join(tmp, a) : /\.json$/.test(a) ? path.join(AGR, a) : a));
}

let same = 0, n = 0, first = null;
for (const [name, e] of Object.entries(exp.cases)) {
  n++;
  const p = spawnSync(process.execPath, [path.join(HERE, "agreement_cli.mjs"), ...argsFor(name, e)]);
  const ok = name === "bad_json"
    ? p.status === e.exit && JSON.parse(p.stdout.toString()).refusals[0].code === "bad_json"
    : p.status === e.exit && sha(p.stdout) === e.stdout_sha256;
  if (ok) same++; else if (!first) first = name + " (exit " + p.status + ", want " + e.exit + ")";
}
t("nenrin-agreement-verify prints the Python command's output on " + n + " inputs", same === n, same + " / " + n + "; first difference: " + first);

console.log("\n=== " + pass + " / " + (pass + fail) + (fail ? " FAILED ===" : " passed ==="));
process.exitCode = fail ? 1 : 0;
