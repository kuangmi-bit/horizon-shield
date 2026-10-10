#!/usr/bin/env node
// MUSUBI admission records, the verifying side, in a second runtime: the twin of admission_verify_v0.py.
//
// admission_verify_v0.py is the reference and says what each function is for. This file gives the same verdicts, the
// same refusal codes and the same digests for the same records; admission_verify_v0.py --selftest runs both over the
// fixture and compares. The implementation of a relying party's door is not public and is not needed to check a
// record.
//
//   node admission_verify_v0.mjs --check fixtures/admission_intake/cases.json     prints what it reads from the fixture, as JSON
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { canonical } from "./canonical_v0.mjs";
import * as ce from "./clause_eval_v0.mjs";

export const SCHEMA = "a2a-admission-v0";
export const VERSION = "0.1";
export const REVOKE_SCHEMA = "a2a-revocation-v0";
export const PREIMAGE_PROFILE = "a2a-admission-v0/action";
export const DECISIONS = ["admit", "escalate", "refuse"];
export const REASONS = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
  "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
  "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch"];
export const DOES_NOT_ESTABLISH_V0 = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "that a revocation published after the chain view was known at admission time",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];
export const DOES_NOT_ESTABLISH = [
  DOES_NOT_ESTABLISH_V0[0],
  DOES_NOT_ESTABLISH_V0[1],
  "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    + "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
  DOES_NOT_ESTABLISH_V0[3],
  DOES_NOT_ESTABLISH_V0[4]];
const RECORD_KEYS = ["schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
  "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"];
const HEX32 = /^[0-9a-f]{32}$/;                         // the reference reads "\Z" (no trailing newline), and so does this

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o, k) => (isObj(o) && has(o, k) && o[k] !== undefined ? o[k] : null);
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const ctx = (name, obj) => Buffer.concat([ce.utf8(name + "\n"), ce.utf8(canonical(obj))]);
const tryOr = (f, fallback) => { try { return f(); } catch (_e) { return fallback; } };

// ---- the action request ----
export function actionPreimage(csha, req) {
  const a = isObj(req.action) ? req.action : {};
  return { contract_sha256: csha, action: a.action ?? null, target: a.target ?? null, amount: a.amount ?? null,
    nonce: req.nonce ?? null, expiry_height: req.expiry_height ?? null };
}
export const actionDigest = (csha, req) => ce.sha256Hex(ce.utf8(canonical(actionPreimage(csha, req))));
export const actionBinding = (csha, req) => ({ type: "canonical_request_digest", canonicalization: "musubi-canonical-v0", preimage_profile: PREIMAGE_PROFILE,
  digest: { alg: "sha-256", value: actionDigest(csha, req) } });
export function requestShapeOk(req) {
  const a = isObj(req) ? req.action : null;
  return isObj(req) && isObj(a) && typeof a.action === "string"
    && (a.target === null || a.target === undefined || typeof a.target === "string")
    && (a.amount === null || a.amount === undefined || (ce.isInt(a.amount) && a.amount >= 0))
    && typeof req.nonce === "string" && HEX32.test(req.nonce)
    && ce.isInt(req.expiry_height) && req.expiry_height >= 0
    && isObj(req.requester) && ["principal", "contractor"].includes(req.requester.role)
    && isObj(req.contract_ref);
}
export function requestSigned(contract, req) {
  const key = ce.partyKey(contract, req.requester.role);
  if (!key) return false;
  const msg = ctx("a2a-action-request-v0", body(req, ["signatures"]));
  return (Array.isArray(req.signatures) ? req.signatures : []).some((s) => isObj(s) && s.role === req.requester.role && ce.ed25519Verify(key, s.sig_b64, msg));
}

// ---- the principal's revocation record ----
export const revocationSigningBytes = (rec) => ctx(REVOKE_SCHEMA, body(rec, ["signatures", "anchor"]));
export function revocationSignedByPrincipal(contract, rec) {
  return tryOr(() => {
    if (!(isObj(rec) && rec.schema === REVOKE_SCHEMA && rec.revoked_by === "principal")) return false;
    const pk = ce.partyKey(contract, "principal");
    if (get(get(rec, "contract_ref"), "contract_sha256") !== ce.contractSha256(contract) || !pk) return false;
    const msg = revocationSigningBytes(rec);
    return (Array.isArray(rec.signatures) ? rec.signatures : []).some((s) => isObj(s) && s.role === "principal" && ce.ed25519Verify(pk, s.sig_b64, msg));
  }, false);
}

// ---- the record ----
export const admissionSigningBytes = (record) => ctx(SCHEMA, body(record, ["signatures"]));
export const admissionSha256 = (record) => ce.sha256Hex(admissionSigningBytes(record));
function hostOf(url) {
  const m = typeof url === "string" ? /^https:\/\/([A-Za-z0-9.-]+)(?::\p{Nd}+)?\//u.exec(url) : null;
  return m ? m[1].toLowerCase() : null;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// {verdict: "accepted" | "refused", refusals: [codes, sorted]}: admission_verify_v0.verify_admission.
export function verifyAdmission(record, relyingKeyB64, contract = null) {
  if (!isObj(record) || get(record, "schema") !== SCHEMA) return { verdict: "refused", refusals: ["malformed"] };
  const ref = new Set();
  const keys = Object.keys(record);
  if (keys.some((k) => !RECORD_KEYS.includes(k) && k !== "publication") || !RECORD_KEYS.every((k) => has(record, k))
    || (has(record, "publication") && record.publication !== "public")) ref.add("malformed");
  const rp = isObj(get(record, "relying_party")) ? record.relying_party : {};
  const dom = typeof get(rp, "domain") === "string" ? rp.domain : null;
  const reasons = get(record, "reasons");
  if (!DECISIONS.includes(get(record, "decision")) || !Array.isArray(reasons) || !reasons.length || reasons.some((r) => !REASONS.includes(r))) ref.add("malformed");
  const rules = isObj(get(record, "rules")) ? record.rules : {};
  const version = get(rules, "version");
  if (version !== null && version !== VERSION) ref.add("malformed");
  const dne = get(record, "does_not_establish");
  if (!same(Array.isArray(dne) ? dne : [], version === VERSION ? DOES_NOT_ESTABLISH : DOES_NOT_ESTABLISH_V0)) ref.add("does_not_establish_altered");
  if (!dom || hostOf(get(rp, "key_url")) !== dom.toLowerCase()) ref.add("signer_not_on_own_domain");
  const sigs = (Array.isArray(get(record, "signatures")) ? record.signatures : []).filter(isObj);
  const msg = tryOr(() => admissionSigningBytes(record), null);
  if (ce.b64Raw(relyingKeyB64, 32) === null || msg === null
    || !sigs.some((s) => get(s, "domain") === dom && get(s, "alg") === "ed25519" && ce.ed25519Verify(relyingKeyB64, get(s, "sig"), msg))) ref.add("bad_signature");
  if (isObj(contract)) {
    if (get(get(record, "contract_ref"), "contract_sha256") !== tryOr(() => ce.contractSha256(contract), undefined)) ref.add("other_contract");
    if (relyingKeyB64 === ce.partyKey(contract, "contractor")) ref.add("self_admission");
  }
  const refusals = [...ref].sort();
  return { verdict: refusals.length ? "refused" : "accepted", refusals };
}

let isMain = false;
try { isMain = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch (_e) {}
if (isMain) {
  const i = process.argv.indexOf("--check");
  if (i < 0) { console.error("usage: node admission_verify_v0.mjs --check fixtures/admission_intake/cases.json"); process.exit(1); }
  const C = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  const P = JSON.parse(C.contract_canonical), N = JSON.parse(C.other_contract_canonical);
  const names = ["admission_public", "admission_private", "admission_refuse", "admission_revoked_without_anchor", "admission_brought_result", "admission_public_v0", "admission_signed_by_contractor"];
  const records = {};
  for (const k of names) {
    const rec = JSON.parse(C[k]);
    records[k] = { sha: admissionSha256(rec), relying: verifyAdmission(rec, C.relying_pub_b64, P), contractor: verifyAdmission(rec, C.contractor_pub_b64, P),
      other: verifyAdmission(rec, C.relying_pub_b64, N), edited: verifyAdmission({ ...rec, decision: "escalate" }, C.relying_pub_b64, P) };
  }
  const req = JSON.parse(C.action_request_public), csha = ce.contractSha256(P);
  process.stdout.write(JSON.stringify({ records,
    request: { shape: requestShapeOk(req), signed: requestSigned(P, req), digest: actionDigest(csha, req), binding: actionBinding(csha, req) },
    revocations: { grant: revocationSignedByPrincipal(P, JSON.parse(C.revocation_grant)), key: revocationSignedByPrincipal(P, JSON.parse(C.revocation_key)),
      by_contractor: revocationSignedByPrincipal(P, JSON.parse(C.revocation_by_contractor)), other_terms: revocationSignedByPrincipal(N, JSON.parse(C.revocation_grant)) } }) + "\n");
}
