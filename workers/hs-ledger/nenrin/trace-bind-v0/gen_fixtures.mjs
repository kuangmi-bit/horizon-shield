// gen_fixtures.mjs : build the trace-bind-v0 corpus (fixtures/ and expected.json).
//
//   node gen_fixtures.mjs           write
//   node gen_fixtures.mjs --check   exit 1 if the committed corpus is not what this builds
//
// Real TRACE records, not made up here:
//   sources/bernstein-...json      a record Bernstein 3.20.0 submitted to agentrust-io/trace-registry (staging/processed)
//   sources/summit-demo-record.json the registry's summit demo record
//   sources/producers/*.json       the producer keys the registry lists (trace-registry at 58850e9d, CC BY 4.0, see NOTICE)
//   ../trace-pin-v0/fixtures       records signed by TRACE's own library (agentrust-trace 0.11.0) under a test key
//   ../trace-intake-v0/fixtures    the cMCP envelope and an unsigned level 0 record from the TRACE conformance vectors
// The NENRIN record is MUSUBI's first settled execution record (../musubi-v0/run0002/exec_19c44a79.json).
// Binder keys are derived from fixed public phrases: test keys only.
//
// Every expectation is written below by hand from SPEC.md; nothing is copied from a verifier's output.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signTraceBind, jwkThumbprint, jcs, sha256hex, unwrapVector, bindSigningBytes } from "../sdk/trace_verify.mjs";
import { createPrivateKey, sign as edSign } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const rd = (p) => JSON.parse(readFileSync(join(HERE, p), "utf8"));
const seed = (phrase) => createHash("sha256").update(phrase).digest();
const A = seed("nenrin-trace-bind-v0 test binder A");
const B = seed("nenrin-trace-bind-v0 test binder B");
const privOf = (s) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), s]), format: "der", type: "pkcs8" });
const resign = (bind, s) => { const b = { ...bind }; delete b.sig_b64; b.sig_b64 = edSign(null, bindSigningBytes(b), privOf(s)).toString("base64"); return b; };

const bernstein = rd("sources/bernstein-3.20.0-20260920-165918-backend-99365805.json").trace;
const summit = rd("sources/summit-demo-record.json");
const libValid = rd("../trace-pin-v0/fixtures/trace_fixtures.json").valid.record;
const cmcp = unwrapVector(rd("../trace-intake-v0/fixtures/valid_cmcp_runtime.json").vector);
const level0 = unwrapVector(rd("../trace-intake-v0/fixtures/valid_level0.json").vector);
const exec = rd("../musubi-v0/run0002/exec_19c44a79.json");
const producers = Object.fromEntries(readdirSync(join(HERE, "sources/producers")).sort().map((f) => {
  const p = rd("sources/producers/" + f); return [p.producer_id, jwkThumbprint(p.public_key_jwk)];
}));
const KT_BERN = producers["bernstein/3.20.0"], KT_SUMMIT = producers["verifiable-agent-summit-demo/0.1.0"];
const KT_LIB = jwkThumbprint(libValid.cnf.jwk);

const keyB64 = (s) => signTraceBind({ record: {}, trace: libValid, actedAt: 1790000000, seed32: s }).binder_public_key_ed25519_b64;
const KA = keyB64(A), KB = keyB64(B);
const policy = (extra = {}) => ({ binder_keys: [KA], trace_key_thumbprints: [KT_BERN, KT_SUMMIT, KT_LIB], ...extra });
const bind = (trace, actedAt, s = A, record = exec) => signTraceBind({ record, trace, actedAt, seed32: s, traceKeyThumbprint: trace.cnf && trace.cnf.jwk ? undefined : KT_LIB });
const F = ["acted_at_is_stated", "trace_claims_not_appraised"];
const ok = { verdict: "bound", refusals: [], findings: F };
const no = (...r) => ({ verdict: "not_bound", refusals: r.sort(), findings: F });

const C = [];
const add = (name, intent, bundle, expect) => C.push({ name, intent, bundle, expect });

// bound
add("bound_bernstein_registered_key", "a real Bernstein 3.20.0 record; its key is the one trace-registry lists for bernstein/3.20.0, pinned by the relying party",
  { bind: bind(bernstein, bernstein.iat + 120), trace: bernstein, record: exec, policy: policy() }, ok);
add("bound_summit_registered_key", "the registry's summit demo record under the key listed for verifiable-agent-summit-demo/0.1.0",
  { bind: bind(summit, summit.iat + 600), trace: summit, record: exec, policy: policy() }, ok);
add("bound_trace_library_record", "a record signed by agentrust-trace 0.11.0",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: exec, policy: policy() }, ok);
add("bound_iat_300s_after_act", "TRACE issued exactly 300 seconds after the act: inside TRACE's clock skew",
  { bind: bind(libValid, libValid.iat - 300), trace: libValid, record: exec, policy: policy() }, ok);
add("bound_max_age_zero_same_second", "max_age_seconds 0 and the act in the same second as iat",
  { bind: bind(libValid, libValid.iat), trace: libValid, record: exec, policy: policy({ max_age_seconds: 0 }) }, ok);
add("bound_stale_allowed_by_policy", "the act is 25 hours after iat and the relying party allows 100000 seconds",
  { bind: bind(libValid, libValid.iat + 90000), trace: libValid, record: exec, policy: policy({ max_age_seconds: 100000 }) }, ok);

// stage B refusals
add("binder_not_pinned", "a valid bind by a binder the relying party did not pin",
  { bind: bind(libValid, libValid.iat + 60, B), trace: libValid, record: exec, policy: policy() }, no("binder_not_pinned"));
add("bind_signed_by_other_key", "binder A's key, binder B's signature",
  { bind: { ...bind(libValid, libValid.iat + 60), sig_b64: bind(libValid, libValid.iat + 60, B).sig_b64 }, trace: libValid, record: exec, policy: policy() }, no("bind_signature_invalid"));
{
  const b = bind(libValid, libValid.iat + 60); const body = { ...b }; delete body.sig_b64;
  const noCtx = edSign(null, new TextEncoder().encode(jcs(body)), privOf(A)).toString("base64");
  add("bind_signature_without_context", "signed over the canonical body without the nenrin-trace-bind-v0 context line: a signature made for another purpose",
    { bind: { ...b, sig_b64: noCtx }, trace: libValid, record: exec, policy: policy() }, no("bind_signature_invalid"));
}
add("record_changed_after_bind", "the NENRIN record differs from the one bound (one action added)",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: { ...exec, performed_actions: [...exec.performed_actions, "delete"] }, policy: policy() }, no("record_sha_mismatch"));
add("trace_claim_tampered", "data_class changed in the TRACE record after it was signed and bound",
  { bind: bind(libValid, libValid.iat + 60), trace: { ...libValid, data_class: "public" }, record: exec, policy: policy() }, no("trace:signature_invalid", "trace_sha_mismatch"));
add("trace_key_not_pinned", "a valid record whose key the relying party did not pin",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: exec, policy: policy({ trace_key_thumbprints: [KT_BERN] }) }, no("trace_key_not_pinned"));
add("bind_states_other_thumbprint", "the bind names the Bernstein thumbprint for a record signed by another key",
  { bind: resign({ ...bind(libValid, libValid.iat + 60), trace_key_thumbprint: KT_BERN }, A), trace: libValid, record: exec, policy: policy() }, no("trace_key_thumbprint_mismatch"));
add("trace_issued_after_act", "TRACE issued 301 seconds after the act it is said to attest",
  { bind: bind(libValid, libValid.iat - 301), trace: libValid, record: exec, policy: policy() }, no("trace:iat_in_future"));
add("trace_stale_at_act", "the act is 25 hours after iat under the default 86400 second maximum age",
  { bind: bind(libValid, libValid.iat + 90000), trace: libValid, record: exec, policy: policy() }, no("trace_stale_at_act"));
add("trace_enveloped", "the cMCP RuntimeClaim from the TRACE vectors: the outer signature is the gateway's, so no key of the record is checked",
  { bind: bind(cmcp, 1790000000), trace: cmcp, record: exec, policy: policy() }, no("trace:enveloped_form"));
add("trace_unsigned_level0", "a valid level 0 TRACE record with no embedded signature",
  { bind: bind(level0, level0.iat + 60), trace: level0, record: exec, policy: policy() }, no("trace:no_embedded_signature"));
add("three_independent_failures", "binder not pinned, TRACE key not pinned and stale: every stage B failure is listed",
  { bind: bind(libValid, libValid.iat + 90000, B), trace: libValid, record: exec, policy: policy({ trace_key_thumbprints: [] }) }, no("binder_not_pinned", "trace_key_not_pinned", "trace_stale_at_act"));

// stage A refusals
add("bind_schema_other", "a bind record of another schema",
  { bind: resign({ ...bind(libValid, libValid.iat + 60), schema: "nenrin-trace-bind-v1" }, A), trace: libValid, record: exec, policy: policy() }, no("bind_schema"));
add("bind_extra_member", "a ninth member no verifier reads",
  { bind: resign({ ...bind(libValid, libValid.iat + 60), note: "trust me" }, A), trace: libValid, record: exec, policy: policy() }, no("bind_malformed"));
add("bind_other_relation", "relation other than performed_under",
  { bind: resign({ ...bind(libValid, libValid.iat + 60), relation: "observed" }, A), trace: libValid, record: exec, policy: policy() }, no("bind_malformed"));
add("bind_sig_unpadded", "sig_b64 without its padding: one byte string, one spelling",
  { bind: (() => { const b = bind(libValid, libValid.iat + 60); return { ...b, sig_b64: b.sig_b64.replace(/=+$/, "") }; })(), trace: libValid, record: exec, policy: policy() }, no("bind_malformed"));
add("bind_acted_at_fraction", "acted_at that is not a whole second",
  { bind: { ...bind(libValid, libValid.iat + 60), acted_at: libValid.iat + 60.5 }, trace: libValid, record: exec, policy: policy() }, no("bind_malformed"));
add("bind_uppercase_sha", "record_sha256 in upper case hex",
  { bind: (() => { const b = bind(libValid, libValid.iat + 60); return resign({ ...b, record_sha256: b.record_sha256.toUpperCase() }, A); })(), trace: libValid, record: exec, policy: policy() }, no("bind_malformed"));
add("policy_binder_keys_not_list", "a policy whose binder_keys is a string",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: exec, policy: { ...policy(), binder_keys: KA } }, no("policy_malformed"));
add("policy_max_age_negative", "a negative maximum age",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: exec, policy: policy({ max_age_seconds: -1 }) }, no("policy_malformed"));
add("record_lone_surrogate", "the NENRIN record holds a lone surrogate, which has no RFC 8785 form",
  { bind: bind(libValid, libValid.iat + 60), trace: libValid, record: { ...exec, note: "\ud800" }, policy: policy() }, no("lone_surrogate"));
add("trace_unsafe_integer", "the TRACE record carries an integer past 2^53 - 1",
  { bind: bind(libValid, libValid.iat + 60), trace: { ...libValid, iat: 2 ** 60 }, record: exec, policy: policy() }, no("unsafe_integer"));

export function build() {
  const cases = {}, fixtures = {};
  for (const c of C) {
    cases[c.name] = { intent: c.intent, expect: c.expect };
    fixtures[c.name] = JSON.stringify(c.bundle, null, 1) + "\n";
  }
  const expected = JSON.stringify({
    schema: "nenrin-interop-expected-v0", version: "0.1.0",
    verifier: "nenrin-trace-bind-v0 (trace-bind-v0/SPEC.md section 4; sdk/trace_verify.mjs, npm: nenrin-verify)",
    note: "the verdict signature each bind bundle must reproduce: verdict, sorted refusal codes, sorted finding codes",
    producers_pinned: producers,
    cases,
  }, null, 2) + "\n";
  return { expected, fixtures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { expected, fixtures } = build();
  if (process.argv.includes("--check")) {
    let bad = 0;
    const same = (p, t) => { let h = null; try { h = readFileSync(p, "utf8"); } catch (_e) {} if (h !== t) { bad++; console.error("differs: " + p); } };
    same(join(HERE, "expected.json"), expected);
    for (const [n, t] of Object.entries(fixtures)) same(join(HERE, "fixtures", n + ".json"), t);
    console.log(bad ? bad + " differences" : "trace-bind-v0 matches its generator (" + Object.keys(fixtures).length + " cases)");
    process.exit(bad ? 1 : 0);
  }
  rmSync(join(HERE, "fixtures"), { recursive: true, force: true });
  mkdirSync(join(HERE, "fixtures"));
  for (const [n, t] of Object.entries(fixtures)) writeFileSync(join(HERE, "fixtures", n + ".json"), t);
  writeFileSync(join(HERE, "expected.json"), expected);
  console.log("wrote " + Object.keys(fixtures).length + " cases");
}
