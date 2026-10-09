// build_corpus.mjs : make the trace-intake-v0 corpus from the TRACE conformance vectors.
//
//   git clone https://github.com/agentrust-io/trace-spec /tmp/trace-spec
//   node build_corpus.mjs /tmp/trace-spec            write fixtures/, expected.json, SOURCE.json
//   node build_corpus.mjs /tmp/trace-spec --check    exit 1 if the committed corpus is not what the vectors build
//
// Each fixture is {"now": N, "vector": <the vector file's exact text>}: the vector is spliced in as text, never
// re-serialised, because the canonicalization vectors depend on the exact digits (100000000000000000000, 1e400) and
// escapes (\ud800) of the file. now is the record's own iat + 60 when it has a usable iat, so freshness never decides
// an outcome; otherwise a fixed 1790000000.
//
// The expectations below are written from what each vector says it is, not from running any implementation: the
// signed records are pinnable, each invalid_* record is refused with the matching reason, valid records without an
// embedded signature and the cMCP envelope are out of scope for a pin (which attests a verified signature). The policy
// bundles, the resolution table and the anchor-inclusion vectors are not Trust Records and are not cases.
// The vectors are Apache-2.0 (agentrust-io/trace-spec conformance/LICENSE); see NOTICE.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const R = (code, why) => ({ verdict: "refused", refusals: [code], findings: [], why });
const P = (why) => ({ verdict: "pinnable", refusals: [], findings: [], why });
const EXPECT = {
  "canonicalization/01-non-ascii-values.json": P("signed record with non-ASCII values; pinned only if the RFC 8785 bytes are right"),
  "canonicalization/02-non-bmp-values.json": P("signed record with characters outside the BMP"),
  "canonicalization/03-utf16-key-order.json": P("signed record whose key order differs between UTF-16 and code point order"),
  "canonicalization/04-utf16-key-order-nested.json": P("the same, nested"),
  "signed_root.json": P("a signed root record"),
  "signed_delegated_hop.json": P("a signed delegated hop"),
  "invalid_canonical_integer_out_of_range.json": R("unsafe_integer", "an integer beyond 2^53 - 1 inside a cMCP envelope; the canonical form is checked before the envelope"),
  "invalid_canonical_lone_surrogate.json": R("lone_surrogate", "a lone surrogate inside a cMCP envelope"),
  "invalid_canonical_non_finite_float.json": R("non_finite_number", "1e400, which parses to Infinity, inside a cMCP envelope"),
  "invalid_canonical_plain_trace.json": R("unsafe_integer", "iat of 1e20 in a bare record"),
  "invalid_missing_runtime.json": R("missing_required", "no runtime member"),
  "invalid_wrong_profile.json": R("unsupported_profile", "an eat_profile that is not TRACE v0.2"),
  "valid_level0.json": R("no_embedded_signature", "valid TRACE, no embedded signature: out of scope for a pin"),
  "valid_level0_with_transcript.json": R("no_embedded_signature", "valid TRACE, no embedded signature"),
  "valid_appraisal_full.json": R("no_embedded_signature", "valid TRACE, no embedded signature"),
  "valid_openshell_import.json": R("no_embedded_signature", "valid TRACE, no embedded signature"),
  "valid_cmcp_runtime.json": R("enveloped_form", "a valid cMCP RuntimeClaim; the outer signature is the gateway's"),
};
for (let i = 1; i <= 11; i++) EXPECT["policy-resolution/" + String(i).padStart(2, "0")] = R("no_embedded_signature", "a policy-resolution vector; its record carries no embedded signature");
const NOT_RECORDS = /^(policy-resolution\/(policies\/|resolutions\.json$)|anchor-inclusion\/)/;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const caseName = (rel) => rel.replace(/\.json$/, "").replace(/\//g, "__");

export function build(spec) {
  const root = join(spec, "conformance", "tests", "vectors");
  const files = [];
  (function walk(d) { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith(".json")) files.push(p); } })(root);
  const cases = {}, fixtures = {}, sources = {};
  for (const f of files) {
    const rel = relative(root, f).split(sep).join("/");
    if (NOT_RECORDS.test(rel)) continue;
    const key = Object.keys(EXPECT).find((k) => rel === k || (k.startsWith("policy-resolution/") && rel.startsWith(k)));
    if (!key) throw new Error("no expectation written for " + rel + "; add one before building");
    const text = readFileSync(f, "utf8");
    const v = JSON.parse(text);
    const rec = v && typeof v === "object" && !Array.isArray(v) && v.record && typeof v.record === "object" && !Array.isArray(v.record) ? v.record : v;
    const now = rec && Number.isInteger(rec.iat) && rec.iat >= 1700000000 && rec.iat < 1e11 ? rec.iat + 60 : 1790000000;
    const name = caseName(rel);
    const { why, ...expect } = EXPECT[key];
    cases[name] = { intent: why, source: "conformance/tests/vectors/" + rel, expect };
    fixtures[name] = '{"now":' + now + ',"vector":' + text.trim() + "}\n";
    sources[name] = { path: "conformance/tests/vectors/" + rel, sha256: sha(text) };
  }
  return { cases, fixtures, sources };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const spec = process.argv[2];
  if (!spec) { console.error("usage: node build_corpus.mjs <trace-spec checkout> [--check]"); process.exit(2); }
  const commit = execFileSync("git", ["-C", spec, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { cases, fixtures, sources } = build(spec);
  const expected = JSON.stringify({
    schema: "nenrin-interop-expected-v0", version: "0.1.0",
    verifier: "TRACE intake (trace-bind-v0/SPEC.md section 2; sdk/trace_verify.mjs and trace-pin-v0, npm: nenrin-verify)",
    note: "one case per TRACE Trust Record among the agentrust-io/trace-spec conformance vectors; the verdict signature the ledger's intake must give it",
    cases,
  }, null, 2) + "\n";
  const source = JSON.stringify({ repository: "https://github.com/agentrust-io/trace-spec", commit, license: "Apache-2.0 (conformance/LICENSE)", files: sources }, null, 2) + "\n";
  if (process.argv.includes("--check")) {
    let bad = 0;
    const same = (p, t) => { let have = null; try { have = readFileSync(p, "utf8"); } catch (_e) {} if (have !== t) { bad++; console.error("differs: " + relative(HERE, p)); } };
    same(join(HERE, "expected.json"), expected);
    for (const [n, t] of Object.entries(fixtures)) same(join(HERE, "fixtures", n + ".json"), t);
    const committed = JSON.parse(readFileSync(join(HERE, "SOURCE.json"), "utf8"));
    for (const [n, s] of Object.entries(sources)) if (!committed.files[n] || committed.files[n].sha256 !== s.sha256) { bad++; console.error("vector changed upstream: " + s.path); }
    console.log(bad ? bad + " differences (vectors at " + commit.slice(0, 12) + ")" : "trace-intake-v0 matches the vectors at " + commit.slice(0, 12) + " (" + Object.keys(cases).length + " cases)");
    process.exit(bad ? 1 : 0);
  }
  rmSync(join(HERE, "fixtures"), { recursive: true, force: true });
  mkdirSync(join(HERE, "fixtures"));
  for (const [n, t] of Object.entries(fixtures)) writeFileSync(join(HERE, "fixtures", n + ".json"), t);
  writeFileSync(join(HERE, "expected.json"), expected);
  writeFileSync(join(HERE, "SOURCE.json"), source);
  console.log("wrote " + Object.keys(cases).length + " cases from trace-spec " + commit.slice(0, 12));
}
