// gen_fixtures.mjs : build the trace-span-v0 corpus from trace-bind-v0's bind bundles.
//   node gen_fixtures.mjs            write fixtures/ and expected.json
//   node gen_fixtures.mjs --check    exit 1 if the committed corpus is not what this builds
// A case is {"span": <attributes an exported OpenTelemetry span carries>, "bind_bundle": <a trace-bind-v0 bundle>}.
// The question: does the span name exactly the records of a bound bind (SPEC.md section 7)? Expectations by hand.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spanAttributes } from "../sdk/trace_verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const B = (n) => JSON.parse(readFileSync(join(HERE, "../trace-bind-v0/fixtures", n + ".json"), "utf8"));
const F = ["acted_at_is_stated", "trace_claims_not_appraised"];
const ok = { verdict: "span_bound", refusals: [], findings: F };
const no = (...r) => ({ verdict: "span_not_bound", refusals: r.sort(), findings: F });
const M = (k) => "span_attribute_mismatch:nenrin." + k;
const C = [];
const add = (name, intent, span, bind_bundle, expect) => C.push({ name, intent, bundle: { span, bind_bundle }, expect });

for (const n of ["bound_bernstein_registered_key", "bound_summit_registered_key", "bound_trace_library_record", "bound_iat_300s_after_act", "bound_max_age_zero_same_second", "bound_stale_allowed_by_policy"]) {
  const b = B(n);
  add("span_" + n, "the span carries the attributes spanAttributes() writes for this bound bind", spanAttributes(b.bind), b, ok);
}
const bern = B("bound_bernstein_registered_key"), summit = B("bound_summit_registered_key");
add("span_url_points_elsewhere", "nenrin.trace.url is a convenience link, not an identifier: a span whose url differs still names the records",
  { ...spanAttributes(bern.bind), "nenrin.trace.url": "https://example.org/x" }, bern, ok);
add("span_record_sha_swapped", "the span names another record than the one bound",
  { ...spanAttributes(bern.bind), "nenrin.record.sha256": "0".repeat(64) }, bern, no(M("record.sha256")));
add("span_without_bind_sha", "the span omits nenrin.bind.sha256",
  (() => { const a = spanAttributes(bern.bind); delete a["nenrin.bind.sha256"]; return a; })(), bern, no(M("bind.sha256")));
add("span_other_schema", "nenrin.otel.schema other than nenrin-otel-v0",
  { ...spanAttributes(bern.bind), "nenrin.otel.schema": "nenrin-otel-v1" }, bern, no(M("otel.schema")));
add("span_attributes_of_another_bind", "the summit bind's attributes on the Bernstein bundle: same NENRIN record, different bind and TRACE record",
  spanAttributes(summit.bind), bern, no(M("bind.sha256"), M("trace.sha256"), M("trace.key_thumbprint")));
add("span_thumbprint_case_changed", "the key thumbprint upper-cased in the span",
  { ...spanAttributes(bern.bind), "nenrin.trace.key_thumbprint": spanAttributes(bern.bind)["nenrin.trace.key_thumbprint"].toUpperCase() }, bern, no(M("trace.key_thumbprint")));
add("span_numeric_value", "an identifier exported as a number rather than a string",
  { ...spanAttributes(bern.bind), "nenrin.otel.schema": 0 }, bern, no(M("otel.schema")));
add("span_empty", "a span with no NENRIN attributes at all", {}, bern,
  no(M("otel.schema"), M("bind.sha256"), M("record.sha256"), M("trace.sha256"), M("trace.key_thumbprint")));
const nb = B("binder_not_pinned");
add("span_correct_but_binder_not_pinned", "the span names the bind exactly, but the bind itself is not bound for this relying party", spanAttributes(nb.bind), nb, no("binder_not_pinned"));
const tt = B("trace_claim_tampered");
add("span_correct_but_trace_tampered", "the span names the bind exactly, but the TRACE record was changed after signing", spanAttributes(tt.bind), tt, no("trace:signature_invalid", "trace_sha_mismatch"));

const cases = {}, fixtures = {};
for (const c of C) { cases[c.name] = { intent: c.intent, expect: c.expect }; fixtures[c.name] = JSON.stringify(c.bundle, null, 1) + "\n"; }
const expected = JSON.stringify({ schema: "nenrin-interop-expected-v0", version: "0.1.0",
  verifier: "nenrin-otel-v0 span check (trace-bind-v0/SPEC.md section 7; sdk/trace_verify.mjs checkSpanAttributes, npm: nenrin-verify)",
  note: "does an exported OpenTelemetry span name exactly the records of a bound nenrin-trace-bind-v0 record", cases }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  let bad = 0;
  const same = (p, t) => { let h = null; try { h = readFileSync(p, "utf8"); } catch (_e) {} if (h !== t) { bad++; console.error("differs: " + p); } };
  same(join(HERE, "expected.json"), expected);
  for (const [n, t] of Object.entries(fixtures)) same(join(HERE, "fixtures", n + ".json"), t);
  console.log(bad ? bad + " differences" : "trace-span-v0 matches its generator (" + C.length + " cases)");
  process.exit(bad ? 1 : 0);
}
rmSync(join(HERE, "fixtures"), { recursive: true, force: true }); mkdirSync(join(HERE, "fixtures"));
for (const [n, t] of Object.entries(fixtures)) writeFileSync(join(HERE, "fixtures", n + ".json"), t);
writeFileSync(join(HERE, "expected.json"), expected);
console.log("wrote " + C.length + " cases");
