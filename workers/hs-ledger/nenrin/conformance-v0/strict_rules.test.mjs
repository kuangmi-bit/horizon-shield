// strict_rules.test.mjs : the two rules VERIFIER.md section 5 made strict in 0.4.1, checked on the reference.
// 1. timestamps: a real calendar instant (no 2026-02-30, no hour 24, no year 0000, no second 60);
// 2. signatures: canonical standard base64 only (padding present, no url-safe letters, no whitespace, zero trailing bits).
// Each signature case is a freshly signed, otherwise valid bundle, so only the rule under test can refuse it.
// 3. (0.4.2) the same base64 rule in the TSUGI verifier (tsugi_verify.mjs 0.3.1), for the signature and the public key
//    of a real signed record: the 2026-09-20 incident's operator authorization.
// 4. (0.4.2) small-order and non-canonical Ed25519 keys: with such a key, R = identity and S = 0 verifies on every
//    message in OpenSSL, so no private key is needed. Both verifiers now refuse the key (ed25519_key.mjs).
// 5. (0.4.2) mixed-order keys A + T: signed with A's private key, a different string from A, so one key could pose as
//    several (TSUGI quorum, provenance R1). Refused: a key must lie in the prime-order subgroup.
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
// ---- 3. TSUGI: the operator's signed authorization in the real 2026-09-20 incident ----
import { verifyRecord as tsugiVerifyRecord, b64Exact } from "../sdk/tsugi_verify.mjs";
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodingVariants(s) {
  const out = { "missing padding": s.replace(/=+$/, ""), "embedded whitespace": s.slice(0, 10) + " " + s.slice(10), "trailing newline": s + "\n" };
  if (s.includes("+") || s.includes("/")) out["url-safe letters"] = s.replace(/\+/g, "-").replace(/\//g, "_");
  const pad = (s.match(/=+$/) || [""])[0].length, unused = pad === 2 ? 15 : pad === 1 ? 3 : 0, i = s.length - pad - 1, v = ALPHA.indexOf(s[i]);
  if (unused && (v & unused) === 0) out["non-canonical trailing bits"] = s.slice(0, i) + ALPHA[v | 1] + s.slice(i + 1);
  return out;
}
const inc = JSON.parse(readFileSync(new URL("../recovery-v0/incident_20260920_resign_chain.json", import.meta.url)));
const signedRec = (Array.isArray(inc) ? inc : inc.records).find((r) => r.signature_ed25519_b64 && r.public_key_ed25519_b64);
chk("TSUGI: the incident's signed record verifies as written", signedRec && (await tsugiVerifyRecord(signedRec)).ok === true);
chk("TSUGI: b64Exact reads the canonical key (32 bytes) and signature (64 bytes)", b64Exact(signedRec.public_key_ed25519_b64, 32) && b64Exact(signedRec.signature_ed25519_b64, 64));
for (const [field, n] of [["signature_ed25519_b64", 64], ["public_key_ed25519_b64", 32]]) {
  for (const [name, v] of Object.entries(encodingVariants(signedRec[field]))) {
    chk("TSUGI: b64Exact refuses " + field + " with " + name, b64Exact(v, n) === null);
    const r = await tsugiVerifyRecord(Object.assign({}, signedRec, { [field]: v }));
    chk("TSUGI: record with " + name + " in " + field + " is refused (bad_signature)", r.ok === false && r.refusals.some((x) => x.code === "bad_signature"), JSON.stringify(r.refusals || r));
  }
}
// ---- 4. small-order and non-canonical keys ----
import { ed25519KeyOk } from "../task-delegation-bind-v0/ed25519_key.mjs";

import { verify as nodeVerify, createPublicKey } from "node:crypto";
const FORGED_SIG = "AQ" + "A".repeat(84) + "==";                       // R = identity point, S = 0
const BAD_KEYS = {
  "the identity point (order 1)": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "the identity with the sign bit set": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA=",
  "y = p + 1 (non-canonical identity)": "7v///////////////////////////////////////38=",
  "y = p - 1 (order 2)": "7P///////////////////////////////////////38=",
  "y = 0 (order 4)": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "an order 8 point": Buffer.from("26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05", "hex").toString("base64"),
};
const b58 = (bytes) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of bytes) { if (x === 0) s = "1" + s; else break; } return s; };
const didOf = (raw) => "did:key:z" + b58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(raw)]));
chk("a real party's did:key still resolves", didKeyResolver(pass.receipt.provider_id) !== null);
for (const [name, k] of Object.entries(BAD_KEYS)) {
  const raw = Buffer.from(k, "base64");
  chk("ed25519KeyOk refuses " + name, ed25519KeyOk(raw) === false);
  let nodeOk = null; try { nodeOk = nodeVerify(null, Buffer.from("any message at all"), createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") }, format: "jwk" }), Buffer.from(FORGED_SIG, "base64")); } catch { nodeOk = "throws"; }
  console.log("      (OpenSSL alone verifies the no-key signature under " + name + ": " + nodeOk + ")");
  chk("provenance: a did:key that is " + name + " does not resolve", didKeyResolver(didOf(raw)) === null);
  const r = await tsugiVerifyRecord(Object.assign({}, signedRec, { public_key_ed25519_b64: k, signature_ed25519_b64: FORGED_SIG }));
  chk("TSUGI: a record \"signed\" under " + name + " with no private key is refused (bad_signature)", r.ok === false && r.refusals.some((x) => x.code === "bad_signature"), JSON.stringify(r.refusals || r));
}
// ---- 5. mixed-order keys: a real key plus the order-2 point (0, -1) is (-x, -y), in the canonical encoding ----
const P25519 = (1n << 255n) - 19n;
function plusOrder2(raw) {
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? raw[i] & 0x7f : raw[i]);
  let yy = (P25519 - y) % P25519; const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) { out[i] = Number(yy & 0xffn); yy >>= 8n; }
  out[31] |= (raw[31] & 0x80) ^ 0x80;                                // x -> -x flips the parity of x (x != 0 for a real key)
  return out;
}
const realKey = Buffer.from(signedRec.public_key_ed25519_b64, "base64");
const mixed = plusOrder2(realKey);
chk("a real key passes the subgroup check", ed25519KeyOk(realKey) === true);
chk("the real key plus the order-2 point is refused (mixed order)", ed25519KeyOk(mixed) === false);
chk("provenance: a did:key of the mixed-order point does not resolve", didKeyResolver(didOf(mixed)) === null);
{ const r = await tsugiVerifyRecord(Object.assign({}, signedRec, { public_key_ed25519_b64: mixed.toString("base64") }));
  chk("TSUGI: a record under the mixed-order key is refused (bad_signature)", r.ok === false && r.refusals.some((x) => x.code === "bad_signature"), JSON.stringify(r.refusals || r)); }
// ---- 6. (0.4.4) malformed records: refused in their own step with reason record_not_object, never a crash, never accepted ----
const run = (b) => { try { return verifyProvenance(Object.assign({}, b, { resolve: didKeyResolver })); } catch (e) { return { threw: String(e.message) }; } };
const malformed = [
  ["observations: [1]", Object.assign({}, pass, { observations: [1] }), "delegation_observation_invalid"],
  ["observations: [1, valid]", Object.assign({}, pass, { observations: [1].concat(pass.observations || []) }), "delegation_observation_invalid"],
  ["receipt: 5 beside receipts: [valid]", Object.assign({}, pass, { receipt: 5, receipts: [pass.receipt] }), "execution_invalid"],
  ["grant: \"g\"", Object.assign({}, pass, { grant: "g" }), "execution_invalid"],
  ["receipts: [5]", Object.assign({}, pass, { receipts: [5] }), "execution_invalid"],
  ["intent: 5", Object.assign({}, pass, { intent: 5 }), "preflight_invalid"],
];
for (const [name, b, code] of malformed) {
  const p = run(b);
  chk("malformed " + name + " is refused with " + code + "/record_not_object and no task_id_mismatch", !p.threw && p.verdict === "refused" && p.refusals.some((r) => r.code === code && r.reason === "record_not_object") && !p.refusals.some((r) => r.code === "task_id_mismatch"), JSON.stringify(p.threw || p.refusals.map((r) => r.code + "/" + r.reason)));
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS (strict timestamp and signature-encoding rules, VERIFIER.md section 5, the TSUGI verifier's base64 rule, no small-order or mixed-order keys, malformed records refused)");
process.exit(fail ? 1 : 0);
