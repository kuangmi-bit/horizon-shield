// strict_rules.test.mjs : the two rules VERIFIER.md section 5 made strict in 0.4.1, checked on the reference.
// 1. timestamps: a real calendar instant (no 2026-02-30, no hour 24, no year 0000, no second 60);
// 2. signatures: canonical standard base64 only (padding present, no url-safe letters, no whitespace, zero trailing bits).
// Each signature case is a freshly signed, otherwise valid bundle, so only the rule under test can refuse it.
import { isRfc3339Utc } from "../task-execution-bind-v0/bind_exec.mjs";
import { sigBytes } from "../task-delegation-bind-v0/bind.mjs";
import { verifyProvenance, didKeyResolver } from "../sdk/nenrin_verify.mjs";
import { readFileSync } from "node:fs";
let fail = 0;
const chk = (n, c, x = "") => { console.log((c ? "PASS  " : "FAIL  ") + n + (c ? "" : "  <<< " + x)); if (!c) fail++; };
for (const s of ["2026-10-04T00:30:00Z", "2024-02-29T00:00:00Z", "2026-10-04T23:59:59.999Z", "0001-01-01T00:00:00Z"]) chk("accepts " + s, isRfc3339Utc(s));
for (const s of ["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-10-04T24:00:00Z", "0000-01-01T00:00:00Z", "2026-10-04T23:59:60Z", "2026-04-31T00:00:00Z", "2026-10-04T00:30:00+00:00", "2026-10-04t00:30:00z", "2026-10-04T00:30:00Z\n"]) chk("rejects " + JSON.stringify(s), !isRfc3339Utc(s));
const pass = JSON.parse(readFileSync(new URL("../interop-v0/fixtures/pass.json", import.meta.url)));
const good = pass.receipt.provider_sig;
chk("canonical signature decodes to 64 bytes", sigBytes(good) && sigBytes(good).length === 64);
const variants = {
  "missing padding": good.replace(/=+$/, ""),
  "url-safe letters": good.includes("+") || good.includes("/") ? good.replace(/\+/g, "-").replace(/\//g, "_") : null,
  "embedded whitespace": good.slice(0, 10) + " " + good.slice(10),
  "trailing newline": good + "\n",
};
// non-canonical trailing bits: the last data character before "==" carries 4 unused bits; set one
{ const i = good.length - 3; const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; const v = alphabet.indexOf(good[i]); if (good.endsWith("==") && (v & 15) === 0) variants["non-canonical trailing bits"] = good.slice(0, i) + alphabet[v | 1] + good.slice(i + 1); }
for (const [name, v] of Object.entries(variants)) {
  if (v === null || v === undefined) continue;
  chk("sigBytes refuses " + name, sigBytes(v) === null);
  const b = JSON.parse(JSON.stringify(pass)); b.receipt.provider_sig = v;
  const p = verifyProvenance(Object.assign({}, b, { resolve: didKeyResolver }));
  chk("bundle with " + name + " provider_sig is refused (execution_signature_invalid)", p.verdict === "refused" && p.refusals.some((r) => r.code === "execution_signature_invalid"), JSON.stringify(p.refusals.map((r) => r.code)));
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS (strict timestamp and signature-encoding rules, VERIFIER.md section 5)");
process.exit(fail ? 1 : 0);
