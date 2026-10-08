// run_trace_tests_vectors.mjs: run this ledger's TRACE intake against the shared vectors in agentrust-io/trace-tests
// (tests/vectors, 33 JSON files), as the spec maintainers asked (agentrust-io Discussion #47). The same vectors also
// live under agentrust-io/trace-spec conformance/tests/vectors (60 files with anchor-inclusion). They are read from a
// checkout you point at, not copied here.
//   git clone --depth 1 https://github.com/agentrust-io/trace-tests.git /tmp/trace-tests
//   node run_trace_tests_vectors.mjs /tmp/trace-tests/tests/vectors      exit 1 if any outcome differs from EXPECT
// now is pinned to the record's own iat + 60 s, so freshness never decides an outcome here.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { checkTraceRecord, Refusal } from "./trace_pin_v0.mjs";

// What this intake is meant to do with each file, and why. "accept" = signature verified and the record pinned.
const SIGNED_REFUSALS = { // the vector says the record must be refused; the reason must be the matching one
  "invalid_canonical_integer_out_of_range.json": "unsafe_integer",
  "invalid_canonical_lone_surrogate.json": "lone_surrogate",
  "invalid_canonical_non_finite_float.json": "non_finite_number",
  "invalid_canonical_plain_trace.json": "unsafe_integer",
  "invalid_missing_runtime.json": "missing_required",
  "invalid_wrong_profile.json": "unsupported_profile",
};
const EXPECT = {
  "canonicalization/01-non-ascii-values.json": "accept",
  "canonicalization/02-non-bmp-values.json": "accept",
  "canonicalization/03-utf16-key-order.json": "accept",
  "canonicalization/04-utf16-key-order-nested.json": "accept",
  "signed_root.json": "accept",
  "signed_delegated_hop.json": "accept",
  ...SIGNED_REFUSALS,
  // Valid TRACE without an embedded signature: a pin attests a verified signature, so these are out of scope, not wrong.
  "valid_level0.json": "no_embedded_signature",
  "valid_level0_with_transcript.json": "no_embedded_signature",
  "valid_appraisal_full.json": "no_embedded_signature",
  "valid_openshell_import.json": "no_embedded_signature",
  "valid_cmcp_runtime.json": "enveloped_form",
};
for (let i = 1; i <= 11; i++) EXPECT["policy-resolution/" + String(i).padStart(2, "0")] = "no_embedded_signature"; // prefix match below
// Not Trust Records submitted for intake: the policy bundles and resolution table, and (in the copy under
// trace-spec/conformance) the anchor-inclusion vectors, which test registry inclusion proofs (registry-anchor-v1), a
// different check from this intake.
const NOT_RECORDS = /^(policy-resolution\/(policies\/|resolutions\.json$)|anchor-inclusion\/)/;

const root = process.argv[2];
if (!root) { console.error("usage: node run_trace_tests_vectors.mjs <trace-tests>/tests/vectors"); process.exit(2); }
const files = [];
(function walk(d) { for (const n of readdirSync(d).sort()) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".json")) files.push(p); } })(root);
let bad = 0, n = 0;
for (const f of files) {
  const rel = path.relative(root, f).split(path.sep).join("/");
  n++;
  if (NOT_RECORDS.test(rel)) { console.log("n/a     " + rel + "  (not a Trust Record)"); continue; }
  const d = JSON.parse(readFileSync(f, "utf8"));
  const rec = d && typeof d === "object" && "record" in d && typeof d.record === "object" ? d.record : d;
  const now = rec && Number.isInteger(rec.iat) && rec.iat < 1e12 ? rec.iat + 60 : Math.floor(Date.now() / 1000);
  let got;
  try { await checkTraceRecord(rec, now); got = "accept"; } catch (e) { got = e instanceof Refusal ? e.code : "THREW " + e.message; }
  const key = Object.keys(EXPECT).find((k) => rel === k || (k.startsWith("policy-resolution/") && rel.startsWith(k)));
  const want = key ? EXPECT[key] : "(no expectation)";
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? "ok      " : "DIFFER  ") + rel + "  " + got + (ok ? "" : "  (expected " + want + ")"));
}
console.log((bad ? bad + " DIFFER" : "ALL AS EXPECTED") + " (" + n + " files)");
process.exit(bad ? 1 : 0);
