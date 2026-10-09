// trace_pin_v0.test.mjs: the TRACE pin check against records made by TRACE's own library.
// Fixtures come from agentrust-trace 0.11.0 on PyPI (fixtures/gen_fixtures.py): sign_record, verify_record,
// jwk_thumbprint and rfc8785. So "this ledger reads TRACE" is tested against the other implementation's bytes,
// not against a copy of this file's own assumptions.
// Offline. Run: node nenrin/trace-pin-v0/trace_pin_v0.test.mjs   (in workers/hs-ledger)   exit 1 on any failure.
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { jcs, checkTraceRecord, jwkThumbprint, Refusal, DOES_NOT_ESTABLISH, TRACE_PROFILE_V0_2, TRACE_PRODUCERS, registeredProducer, handleTracePin } from "./trace_pin_v0.mjs";

const FX = JSON.parse(readFileSync(new URL("./fixtures/trace_fixtures.json", import.meta.url), "utf8"));
const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const IAT = FX._about.iat;
async function refusal(rec, now = IAT + 60) {
  try { await checkTraceRecord(rec, now); return null; } catch (e) { return e instanceof Refusal ? e.code : "THREW:" + e.message; }
}

// ---- RFC 8785 against Python's rfc8785 --------------------------------------------------------------------
FX._jcs_vectors.forEach((v, i) => {
  const mine = Buffer.from(jcs(v.value), "utf8").toString("hex");
  t("control", "JCS vector " + i + " is byte identical to Python rfc8785 (key order by UTF-16 unit, number form, escapes)", mine === v.jcs_utf8_hex, Buffer.from(jcs(v.value)).toString());
});

for (const v of FX._jcs_stricter_here) {
  let code = null; try { jcs(v.value); } catch (e) { code = e.code; }
  t("control", "stricter than Python rfc8785 on purpose: " + JSON.stringify(v.value) + " (Python writes " + v.python_rfc8785 + ") is refused as unsafe_integer", code === "unsafe_integer", code);
}

// ---- the three records TRACE's library made ---------------------------------------------------------------
for (const name of ["valid", "nonascii"]) {
  const f = FX[name];
  t("control", name + ": TRACE's own verify_record accepted it (fixture sanity)", f.python_verify_record_at_iat_plus_60 === true);
  let c = null, err = null;
  try { c = await checkTraceRecord(clone(f.record), IAT + 60); } catch (e) { err = e; }
  t("control", name + ": accepted here too", c && !err, err && err.message);
  t("control", name + ": pinned sha == sha256 of Python's RFC 8785 bytes of the whole signed record", c && c.sha === f.jcs_sha256, c && c.sha);
  t("control", name + ": key_thumbprint == agentrust_trace.jwk_thumbprint (RFC 7638)", c && c.key_thumbprint === f.thumbprint, c && c.key_thumbprint);
  t("control", name + ": record_jcs hashes to the pinned sha (what GET ?format=raw will serve)", c && sha(c.record_jcs) === c.sha);
  t("control", name + ": fresh_at_intake true at iat+60", c && c.fresh_at_intake === true && c.age_seconds_at_intake === 60);
}
t("control", "v0.1 profile: TRACE's library refuses it (fixture sanity)", String(FX.v01_profile.python_verify_record_at_iat_plus_60).startsWith("REFUSED"));
t("attack", "v0.1 profile: refused here as superseded_profile, even though its signature is valid", (await refusal(clone(FX.v01_profile.record))) === "superseded_profile");

// ---- attacks on a valid record ----------------------------------------------------------------------------
const V = FX.valid.record;
{
  const r = clone(V); r.subject = "spiffe://example.org/agent/someone-else";
  t("attack", "a changed claim (subject) breaks the signature", (await refusal(r)) === "signature_invalid");
}
{
  const r = clone(V); r.policy.enforcement_mode = "audit";
  t("attack", "a changed nested claim (policy.enforcement_mode) breaks the signature", (await refusal(r)) === "signature_invalid");
}
{
  const r = clone(V); const b = Buffer.from(r.signature, "base64url"); b[10] ^= 1; r.signature = b.toString("base64url");
  t("attack", "one flipped signature bit is refused", (await refusal(r)) === "signature_invalid");
}
{
  const r = clone(V); r.signature = r.signature + "==";
  t("attack", "padded base64url signature is refused (one byte string, one spelling, as agentrust-trace requires)", (await refusal(r)) === "bad_base64url");
}
{
  const r = clone(V); const last = r.signature.slice(-1); const alt = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const i = alt.indexOf(last); r.signature = r.signature.slice(0, -1) + alt[i ^ 1];
  t("attack", "a second spelling of the signature (unused low bits set) is refused, not verified", (await refusal(r)) === "bad_base64url");
}
{
  const r = clone(V); r.signature = r.signature.replace(/-/g, "+").replace(/_/g, "/");
  t("attack", "standard base64 alphabet in the signature is refused", ["bad_base64url", "signature_invalid"].includes(await refusal(r)) && (await refusal(r)) !== null);
}
{
  const r = clone(V); delete r.signature;
  t("attack", "no embedded signature: refused by name (enveloped forms are not read in v0)", (await refusal(r)) === "no_embedded_signature");
}
{
  const r = clone(V); r.cnf.jwk = { kty: "EC", crv: "P-256", x: "AA", y: "AA" };
  t("attack", "a non-Ed25519 confirmation key is refused as unsupported, not verified by accident", (await refusal(r)) === "unsupported_key_type");
}
{
  const r = clone(V); delete r.data_class;
  t("attack", "a missing required member is refused before the signature is read", (await refusal(r)) === "missing_required");
}
{
  const r = clone(V); r.eat_profile = "tag:example.com,2026:trace-v9";
  t("attack", "an unknown profile is refused", (await refusal(r)) === "unsupported_profile");
}
{
  const r = clone(V); r.model.context_window = 9007199254740993;
  t("attack", "an integer outside the safe range is refused (the parser already rounded it)", (await refusal(r)) === "unsafe_integer");
}
{
  const r = clone(V); r.model.model_id = "bad \ud800 surrogate";
  t("attack", "a lone surrogate is refused (no UTF-8 form, Python rfc8785 refuses it too)", (await refusal(r)) === "lone_surrogate");
}
{
  let deep = {}; const r = clone(V); let cur = deep; for (let i = 0; i < 70; i++) { cur.a = {}; cur = cur.a; } r.appraisal.extra = deep;
  t("attack", "nesting past 64 levels is refused", (await refusal(r)) === "too_deep");
}
{
  const r = clone(V); r.appraisal.pad = "x".repeat(70000);
  t("attack", "a record over 64 KiB is refused", (await refusal(r)) === "too_large");
}
t("attack", "an array is not a record", (await refusal([V])) === "record_not_object");

// ---- time -------------------------------------------------------------------------------------------------
t("attack", "postdated: iat 301 s after the ledger clock is refused (TRACE 3.2.2 skew)", (await refusal(clone(V), IAT - 301)) === "iat_in_future");
t("control", "iat 299 s ahead is inside the tolerance and accepted", (await refusal(clone(V), IAT - 299)) === null);
{
  const c = await checkTraceRecord(clone(V), IAT + 90 * 86400);
  t("control", "a 90 day old record is still pinnable (the point of pinning), and says it was not fresh at intake", c.fresh_at_intake === false && c.age_seconds_at_intake === 90 * 86400);
}

// ---- key substitution: the honest limit ------------------------------------------------------------------
{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  const r = clone(V); delete r.signature; r.cnf = { jwk: { kty: "OKP", crv: "Ed25519", x } };
  r.signature = edSign(null, Buffer.from(jcs(r), "utf8"), privateKey).toString("base64url");
  let c = null; try { c = await checkTraceRecord(r, IAT + 60); } catch (_e) {}
  t("control", "limit, stated not hidden: a record re-signed with another key under cnf.jwk verifies (the embedded key is all v0 has)", c !== null);
  t("control", "...its key_thumbprint differs from the original key's, which is how a reader with a trusted key tells them apart", c && c.key_thumbprint !== FX.valid.thumbprint);
  t("control", "...and every answer says the key is not established to belong to the subject", DOES_NOT_ESTABLISH.some((s) => /not authenticity/.test(s) && /key_thumbprint/.test(s)));
}
t("control", "the profile constant is TRACE's v0.2 tag", TRACE_PROFILE_V0_2 === FX.valid.record.eat_profile);
{
  const env = { cmcp_version: "0.1", trace: clone(V), gateway: { id: "gw" }, signature: "AA" };
  t("attack", "a cMCP RuntimeClaim envelope is refused by name (enveloped_form), not as a wrong profile", (await refusal(env)) === "enveloped_form", await refusal(env));
  const r = clone(V); r.cmcp_version = "0.1"; r.trace = {};
  t("control", "...a bare record that merely carries extra cmcp_version and trace members still gets its own check", (await refusal(r)) !== "enveloped_form", await refusal(r));
}

// ---- registered TRACE producers (trace-registry producers/) ------------------------------------------------
// The registry's own records, copied into ../trace-bind-v0/sources with the producer files (CC BY 4.0).
{
  const SRC = new URL("../trace-bind-v0/sources/", import.meta.url);
  const rd = (p) => JSON.parse(readFileSync(new URL(p, SRC), "utf8"));
  for (const p of TRACE_PRODUCERS) {
    const f = rd(p.file);
    t("control", "producer " + p.producer_id + ": the pinned thumbprint is RFC 7638 of the registry file's key, and x matches", (await jwkThumbprint(f.public_key_jwk)) === p.key_thumbprint && f.public_key_jwk.x === p.x && f.producer_id === p.producer_id, await jwkThumbprint(f.public_key_jwk));
  }
  const bern = rd("bernstein-3.20.0-20260920-165918-backend-99365805.json").trace;
  const cb = await checkTraceRecord(bern, bern.iat + 60);
  t("control", "a real Bernstein 3.20.0 record from the registry is pinnable and its key is the registered bernstein/3.20.0 key", registeredProducer(cb.key_thumbprint) && registeredProducer(cb.key_thumbprint).producer_id === "bernstein/3.20.0", cb.key_thumbprint);
  const summit = rd("summit-demo-record.json");
  const cs = await checkTraceRecord(summit, summit.iat + 60);
  t("control", "the registry's summit demo record is under the registered verifiable-agent-summit-demo/0.1.0 key", registeredProducer(cs.key_thumbprint) && registeredProducer(cs.key_thumbprint).producer_id === "verifiable-agent-summit-demo/0.1.0", cs.key_thumbprint);
  t("control", "...and the listing points at the registry file at a fixed commit", /trace-registry\/blob\/[0-9a-f]{40}\/producers\//.test(registeredProducer(cs.key_thumbprint).listed_in));
  const cl = await checkTraceRecord(V, IAT + 60);
  t("attack", "a record under a key the registry does not list gets registered_producer null, never a near match", registeredProducer(cl.key_thumbprint) === null);
  t("attack", "a thumbprint is matched exactly: one character changed is not a registered producer", registeredProducer(cb.key_thumbprint.slice(0, -1) + (cb.key_thumbprint.endsWith("A") ? "B" : "A")) === null);
  const res = await handleTracePin("/evidence/trace/producers", new Request("https://ledger.example/evidence/trace/producers"), new URL("https://ledger.example/evidence/trace/producers"), {}, "https://ledger.example");
  const body = await res.json();
  t("control", "GET /evidence/trace/producers lists the pinned producers with the registry commit", res.status === 200 && body.producers.length === TRACE_PRODUCERS.length && /^[0-9a-f]{40}$/.test(body.source.commit), res.status);
}

// ---- report -----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(8) + " " + kinds[k][0] + " / " + kinds[k][1]);
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log((passed === R.length ? "ALL PASS" : (R.length - passed) + " FAILED") + " (nenrin-trace-pin-v0: " + passed + " / " + R.length + ")");
process.exit(passed === R.length ? 0 : 1);
