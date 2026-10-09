#!/usr/bin/env node
// trace_verify.mjs : TRACE intake and the nenrin-trace-bind-v0 link, offline (nenrin-verify).
//
// The normative text is workers/hs-ledger/nenrin/trace-bind-v0/SPEC.md. This file is the reference; the Python port
// (nenrin_verify/trace.py) and the Go port (sdk-go/nenrinverify/trace.go) are held to it by the corpora
// trace-intake-v0 (the TRACE conformance vectors) and trace-bind-v0, on the TSUNAGI board every night.
//
//   npx nenrin-trace-verify intake <record.json> [--now <seconds>]     is this TRACE record one the ledger pins?
//   npx nenrin-trace-verify bind <bundle.json>                          {"bind","trace","record","policy"}
//   npx nenrin-trace-verify sign-bind --record r.json --trace t.json --acted-at <s> --key key.json
//                                     key.json: {"private_key_ed25519_b64": "<32 byte seed>"}
//   npx nenrin-trace-verify span <attrs.json> <bundle.json>             does an exported span name this bound bind?
//   npx nenrin-trace-verify --batch intake|bind|span <in> <out>         the TSUNAGI batch contract
//
// Exit 0 when the verdict is pinnable / bound, 1 otherwise, 2 on an input error.
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TRACE_PROFILE_V0_2 = "tag:agentrust-io.com,2026:trace-v0.2";
export const TRACE_PROFILE_V0_1 = "tag:agentrust.io,2026:trace-v0.1";
export const TRACE_REQUIRED = ["eat_profile", "iat", "subject", "model", "runtime", "policy", "data_class", "build_provenance", "appraisal", "cnf"];
export const MAX_RECORD_BYTES = 65536;
export const FUTURE_SKEW_SECONDS = 300;
export const DEFAULT_MAX_AGE_SECONDS = 86400;
export const BIND_SCHEMA = "nenrin-trace-bind-v0";
export const BIND_CONTEXT = "nenrin-trace-bind-v0\n";
export const BIND_KEYS = ["acted_at", "binder_public_key_ed25519_b64", "record_sha256", "relation", "schema", "sig_b64", "trace_key_thumbprint", "trace_sha256"];
export const BIND_FINDINGS = ["acted_at_is_stated", "trace_claims_not_appraised"];
const MAX_DEPTH = 64;
const SAFE = 9007199254740991;
const enc = new TextEncoder();

export class Refusal extends Error {
  constructor(code, why) { super(why); this.code = code; }
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- RFC 8785 ---------------------------------------------------------------------------------------------
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export function jcs(v, depth = 0, path = "$") {
  if (depth > MAX_DEPTH) throw new Refusal("too_deep", path + " nests deeper than " + MAX_DEPTH);
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Refusal("non_finite_number", path + " is not finite");
    if (Number.isInteger(v) && Math.abs(v) > SAFE) throw new Refusal("unsafe_integer", path + " is outside the safe integer range");
    return JSON.stringify(v);
  }
  if (typeof v === "string") {
    if (LONE_SURROGATE.test(v)) throw new Refusal("lone_surrogate", path + " holds a lone surrogate");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return "[" + v.map((x, i) => jcs(x, depth + 1, path + "[" + i + "]")).join(",") + "]";
  if (typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => {
      if (LONE_SURROGATE.test(k)) throw new Refusal("lone_surrogate", path + " has a member name with a lone surrogate");
      return JSON.stringify(k) + ":" + jcs(v[k], depth + 1, path + "." + k);
    }).join(",") + "}";
  }
  throw new Refusal("not_json", path + " is not a JSON value");
}
export const sha256hex = (s) => createHash("sha256").update(enc.encode(s)).digest("hex");

// ---- base64 -------------------------------------------------------------------------------------------------
function b64urlCanonical(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const b = Buffer.from(s, "base64url");
  return b.toString("base64url") === s ? new Uint8Array(b) : null;
}
function b64StdCanonical(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const b = Buffer.from(s, "base64");
  return b.toString("base64") === s ? new Uint8Array(b) : null;
}
function ed25519Verify(pub32, sig64, msgBytes) {
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub32).toString("base64url") }, format: "jwk" });
    return edVerify(null, msgBytes, key, sig64) === true;
  } catch (_e) { return false; }
}
export function jwkThumbprint(jwk) {
  const m = '{"crv":' + JSON.stringify(jwk.crv) + ',"kty":' + JSON.stringify(jwk.kty) + ',"x":' + JSON.stringify(jwk.x) + "}";
  return createHash("sha256").update(enc.encode(m)).digest("base64url");
}

// ---- intake (SPEC section 2) --------------------------------------------------------------------------------
/** Throws Refusal; returns {sha, key_thumbprint, iat, subject} when the record is one the ledger pins at nowSec. */
export function checkTraceRecord(R, nowSec) {
  if (!isObj(R)) throw new Refusal("record_not_object", "the record is not a JSON object");
  const rj = jcs(R);
  if (enc.encode(rj).length > MAX_RECORD_BYTES) throw new Refusal("too_large", "the RFC 8785 form is larger than " + MAX_RECORD_BYTES + " bytes");
  if (own(R, "cmcp_version") && own(R, "trace") && !own(R, "eat_profile")) throw new Refusal("enveloped_form", "a cMCP RuntimeClaim envelope; submit the inner record if it carries its own signature");
  if (R.eat_profile === TRACE_PROFILE_V0_1) throw new Refusal("superseded_profile", "the v0.1 profile identifier, which TRACE v0.2 requires verifiers to reject");
  if (R.eat_profile !== TRACE_PROFILE_V0_2) throw new Refusal("unsupported_profile", "eat_profile is not " + TRACE_PROFILE_V0_2);
  const missing = TRACE_REQUIRED.filter((k) => !own(R, k));
  if (missing.length) throw new Refusal("missing_required", "missing " + missing.join(", "));
  if (!Number.isInteger(R.iat) || R.iat < 1700000000) throw new Refusal("bad_iat", "iat is not integer epoch seconds from 1700000000");
  if (typeof R.subject !== "string" || !R.subject) throw new Refusal("bad_subject", "subject is not a non-empty string");
  if (!own(R, "signature")) throw new Refusal("no_embedded_signature", "no embedded signature member");
  const sig = b64urlCanonical(R.signature);
  if (!sig) throw new Refusal("bad_base64url", "signature is not canonical unpadded base64url");
  if (sig.length !== 64) throw new Refusal("bad_signature_length", "the signature is not 64 bytes");
  const jwk = isObj(R.cnf) && isObj(R.cnf.jwk) ? R.cnf.jwk : null;
  if (!jwk) throw new Refusal("no_confirmation_key", "cnf.jwk is not an object");
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519") throw new Refusal("unsupported_key_type", "cnf.jwk is not OKP / Ed25519");
  const pub = b64urlCanonical(jwk.x);
  if (!pub) throw new Refusal("bad_base64url", "cnf.jwk.x is not canonical unpadded base64url");
  if (pub.length !== 32) throw new Refusal("bad_key_length", "cnf.jwk.x is not 32 bytes");
  const body = {};
  for (const k of Object.keys(R)) if (k !== "signature") body[k] = R[k];
  if (!ed25519Verify(pub, sig, enc.encode(jcs(body)))) throw new Refusal("signature_invalid", "the signature does not verify under cnf.jwk");
  if (R.iat > nowSec + FUTURE_SKEW_SECONDS) throw new Refusal("iat_in_future", "iat is more than " + FUTURE_SKEW_SECONDS + " seconds after now");
  return { sha: sha256hex(rj), key_thumbprint: jwkThumbprint(jwk), iat: R.iat, subject: R.subject };
}

export function unwrapVector(vector) {
  return isObj(vector) && own(vector, "record") && isObj(vector.record) ? vector.record : vector;
}

/** Verdict signature for an intake bundle {"now", "vector"}. */
export function verifyTraceIntake(bundle) {
  if (!isObj(bundle) || !Number.isInteger(bundle.now)) throw new Error("an intake bundle is {\"now\": <integer>, \"vector\": <value>}");
  try {
    const c = checkTraceRecord(unwrapVector(bundle.vector), bundle.now);
    return { verdict: "pinnable", refusals: [], findings: [], sha: c.sha, key_thumbprint: c.key_thumbprint };
  } catch (e) {
    if (e instanceof Refusal) return { verdict: "refused", refusals: [e.code], findings: [], why: e.message };
    throw e;
  }
}

// ---- bind (SPEC sections 3 and 4) ---------------------------------------------------------------------------
export function bindSigningBytes(bind) {
  const body = {};
  for (const k of Object.keys(bind)) if (k !== "sig_b64") body[k] = bind[k];
  return enc.encode(BIND_CONTEXT + jcs(body));
}

const HEX64 = /^[0-9a-f]{64}$/;
const THUMB = /^[A-Za-z0-9_-]{43}$/;
const strArray = (a) => Array.isArray(a) && a.every((x) => typeof x === "string");

/** Verdict signature for a bind bundle {"bind", "trace", "record", "policy"}. */
export function verifyTraceBind(bundle) {
  if (!isObj(bundle) || !["bind", "trace", "record", "policy"].every((k) => isObj(bundle[k])))
    throw new Error("a bind bundle is {\"bind\", \"trace\", \"record\", \"policy\"}, each an object");
  const { bind, trace, record, policy } = bundle;
  const stop = (code) => ({ verdict: "not_bound", refusals: [code], findings: [...BIND_FINDINGS] });
  // Stage A
  try { jcs(bind); jcs(trace); jcs(record); } catch (e) { if (e instanceof Refusal) return stop(e.code); throw e; }
  const maxAge = own(policy, "max_age_seconds") ? policy.max_age_seconds : DEFAULT_MAX_AGE_SECONDS;
  if (!strArray(policy.binder_keys) || !strArray(policy.trace_key_thumbprints) || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > 31536000)
    return stop("policy_malformed");
  if (bind.schema !== BIND_SCHEMA) return stop("bind_schema");
  const keys = Object.keys(bind).sort();
  const shapeOk = keys.length === BIND_KEYS.length && keys.every((k, i) => k === BIND_KEYS[i])
    && bind.relation === "performed_under"
    && typeof bind.record_sha256 === "string" && HEX64.test(bind.record_sha256)
    && typeof bind.trace_sha256 === "string" && HEX64.test(bind.trace_sha256)
    && typeof bind.trace_key_thumbprint === "string" && THUMB.test(bind.trace_key_thumbprint)
    && Number.isInteger(bind.acted_at) && bind.acted_at >= 1700000000 && bind.acted_at <= SAFE;
  const binderKey = shapeOk ? b64StdCanonical(bind.binder_public_key_ed25519_b64) : null;
  const bindSig = shapeOk ? b64StdCanonical(bind.sig_b64) : null;
  if (!shapeOk || !binderKey || binderKey.length !== 32 || !bindSig || bindSig.length !== 64) return stop("bind_malformed");
  // Stage B
  const refusals = [];
  if (!ed25519Verify(binderKey, bindSig, bindSigningBytes(bind))) refusals.push("bind_signature_invalid");
  if (!policy.binder_keys.includes(bind.binder_public_key_ed25519_b64)) refusals.push("binder_not_pinned");
  if (sha256hex(jcs(record)) !== bind.record_sha256) refusals.push("record_sha_mismatch");
  if (sha256hex(jcs(trace)) !== bind.trace_sha256) refusals.push("trace_sha_mismatch");
  let c = null;
  try { c = checkTraceRecord(trace, bind.acted_at); } catch (e) { if (e instanceof Refusal) refusals.push("trace:" + e.code); else throw e; }
  if (c) {
    if (c.key_thumbprint !== bind.trace_key_thumbprint) refusals.push("trace_key_thumbprint_mismatch");
    if (!policy.trace_key_thumbprints.includes(c.key_thumbprint)) refusals.push("trace_key_not_pinned");
    if (bind.acted_at - c.iat > maxAge) refusals.push("trace_stale_at_act");
  }
  return { verdict: refusals.length ? "not_bound" : "bound", refusals: [...refusals].sort(), findings: [...BIND_FINDINGS] };
}

/** Make a signed bind record. seed32: the binder's Ed25519 private seed (32 bytes). traceKeyThumbprint: only for a
 *  record without cnf.jwk (the verifier will refuse it anyway); otherwise the thumbprint is computed from the record. */
export function signTraceBind({ record, trace, actedAt, seed32, traceKeyThumbprint }) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed32)]);
  const priv = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const pubJwk = createPublicKey(priv).export({ format: "jwk" });
  const bind = {
    schema: BIND_SCHEMA,
    relation: "performed_under",
    record_sha256: sha256hex(jcs(record)),
    trace_sha256: sha256hex(jcs(trace)),
    trace_key_thumbprint: traceKeyThumbprint || jwkThumbprint(trace.cnf.jwk),
    acted_at: actedAt,
    binder_public_key_ed25519_b64: Buffer.from(pubJwk.x, "base64url").toString("base64"),
  };
  bind.sig_b64 = edSign(null, bindSigningBytes(bind), priv).toString("base64");
  return bind;
}

// ---- OpenTelemetry (SPEC section 7) -------------------------------------------------------------------------
// An agent already emits OpenTelemetry GenAI spans (gen_ai.operation.name "execute_tool" or "invoke_agent") to its
// tracing backend. These helpers put the bind's identifiers on that span, so the trace in the backend names records
// anyone can recompute, and check a span exported later against the bind bundle. No OpenTelemetry dependency: any span
// with setAttributes(object) works.
export const OTEL_SCHEMA = "nenrin-otel-v0";
export const OTEL_KEYS = ["nenrin.otel.schema", "nenrin.bind.sha256", "nenrin.record.sha256", "nenrin.trace.sha256", "nenrin.trace.key_thumbprint"];
export function spanAttributes(bind, { ledgerOrigin = "https://ledger.horizonshield.dev" } = {}) {
  return {
    "nenrin.otel.schema": OTEL_SCHEMA,
    "nenrin.bind.sha256": sha256hex(jcs(bind)),
    "nenrin.record.sha256": bind.record_sha256,
    "nenrin.trace.sha256": bind.trace_sha256,
    "nenrin.trace.key_thumbprint": bind.trace_key_thumbprint,
    "nenrin.trace.url": ledgerOrigin + "/evidence/trace/" + bind.trace_sha256,
  };
}
export function annotateSpan(span, bind, opts) { span.setAttributes(spanAttributes(bind, opts)); return span; }
/** Does an exported span name exactly the records of a bound bind bundle? The bind verdict, plus one
 *  span_attribute_mismatch:<key> per identifier the span states differently (or not at all). */
export function checkSpanAttributes(attrs, bundle) {
  const v = verifyTraceBind(bundle);
  let want = {};
  try { want = spanAttributes(bundle.bind); } catch (e) { if (!(e instanceof Refusal)) throw e; }
  const refusals = [...v.refusals];
  const a = isObj(attrs) ? attrs : {};
  for (const k of OTEL_KEYS) if (typeof a[k] !== "string" || typeof want[k] !== "string" || a[k] !== want[k]) refusals.push("span_attribute_mismatch:" + k);
  return { verdict: refusals.length ? "span_not_bound" : "span_bound", refusals: refusals.sort(), findings: v.findings };
}

export const sig = (r) => ({ verdict: r.verdict, refusals: r.refusals, findings: r.findings });

// ---- CLI ------------------------------------------------------------------------------------------------------
function batch(kind, inPath, outPath) {
  const span = (b) => { if (!isObj(b)) throw new Error("a span case is {span, bind_bundle}"); return checkSpanAttributes(b.span, b.bind_bundle); };
  const fn = kind === "intake" ? verifyTraceIntake : kind === "bind" ? verifyTraceBind : kind === "span" ? span : null;
  if (!fn) { console.error("batch kind is intake, bind or span"); return 2; }
  const out = {};
  for (const c of JSON.parse(readFileSync(inPath, "utf8"))) {
    try { out[c.name] = sig(fn(c.bundle)); } catch (e) { out[c.name] = { error: String((e && e.message) || e).slice(0, 160) }; }
  }
  writeFileSync(outPath, JSON.stringify(out));
  console.log("wrote " + Object.keys(out).length + " verdict signatures (trace " + kind + ")");
  return 0;
}

function main(a) {
  if (a[0] === "--batch" && a.length === 4) return batch(a[1], a[2], a[3]);
  if (a[0] === "intake" && a[1]) {
    const v = JSON.parse(readFileSync(a[1], "utf8"));
    const i = a.indexOf("--now");
    const R = unwrapVector(v);
    const now = i > 0 ? Number(a[i + 1]) : Math.floor(Date.now() / 1000);
    const r = verifyTraceIntake({ now, vector: R });
    console.log(JSON.stringify(r, null, 2));
    return r.verdict === "pinnable" ? 0 : 1;
  }
  if (a[0] === "bind" && a[1]) {
    const r = verifyTraceBind(JSON.parse(readFileSync(a[1], "utf8")));
    console.log(JSON.stringify(r, null, 2));
    return r.verdict === "bound" ? 0 : 1;
  }
  if (a[0] === "span" && a[2]) {
    const r = checkSpanAttributes(JSON.parse(readFileSync(a[1], "utf8")), JSON.parse(readFileSync(a[2], "utf8")));
    console.log(JSON.stringify(r, null, 2));
    return r.verdict === "span_bound" ? 0 : 1;
  }
  if (a[0] === "sign-bind") {
    const opt = (n) => { const i = a.indexOf(n); return i > 0 ? a[i + 1] : null; };
    const key = JSON.parse(readFileSync(opt("--key"), "utf8"));
    const seed = Buffer.from(key.private_key_ed25519_b64, "base64");
    if (seed.length !== 32) { console.error("private_key_ed25519_b64 must be a 32 byte seed"); return 2; }
    const bind = signTraceBind({
      record: JSON.parse(readFileSync(opt("--record"), "utf8")),
      trace: unwrapVector(JSON.parse(readFileSync(opt("--trace"), "utf8"))),
      actedAt: Number(opt("--acted-at")), seed32: seed,
    });
    console.log(JSON.stringify(bind, null, 2));
    return 0;
  }
  console.error("usage: nenrin-trace-verify intake <record.json> [--now s] | bind <bundle.json> | sign-bind ... | --batch intake|bind <in> <out>");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(String((e && e.message) || e)); process.exitCode = 2; }
}
