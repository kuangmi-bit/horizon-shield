#!/usr/bin/env node
// a2a-admission-v0 in a second runtime: the twin of admit_v0.py.
//
// admit_v0.py is the reference. This file imports its clauses from clause_eval_v0.mjs (the twin of the module settle
// imports) and does not restate them. admit_bytematch.py feeds both runtimes the same inputs and compares the record
// bytes, the admission sha256 and the reasons.
//
// One stated difference. The Python reference passes the contract through contract_v0.verify_contract, the full door
// (grant types, required limits, key forms). This twin checks that the contract is an a2a-contract-v0 and that both
// parties' signatures verify over its bytes; it does not re-run the rest of the door. A relying party that uses only
// this twin should have run the door once when the contract was signed. For a contract the door accepts, the two
// runtimes return the same bytes.
//
//   node admit_v0.mjs --input in.json     in.json: {contract, action_request, presentation, chain_view, revocations,
//                                         relying_party, admission_id, seen_nonces?, policy?}; prints the canonical record
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { canonical } from "./canonical_v0.mjs";
import * as ce from "./clause_eval_v0.mjs";

export const SCHEMA = "a2a-admission-v0";
const REVOKE_SCHEMA = "a2a-revocation-v0";
export const REASONS = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
  "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
  "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch"];
const REFUSING = new Set(["action_digest_mismatch", "presentation_unverifiable", "signer_not_on_own_domain", "key_revoked", "grant_revoked",
  "contract_expired", "nonce_reused", "delegation_exceeds_parent", "amount_over_limit", "prohibited_action", "outside_grant"]);
const HEX32 = /^[0-9a-f]{32}$/;
export const DOES_NOT_ESTABLISH = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "that a revocation published after the chain view was known at admission time",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const ctx = (name, obj) => Buffer.concat([ce.utf8(name + "\n"), ce.utf8(canonical(obj))]);

export function actionPreimage(csha, req) {
  const a = isObj(req.action) ? req.action : {};
  return { contract_sha256: csha, action: a.action ?? null, target: a.target ?? null, amount: a.amount ?? null,
    nonce: req.nonce ?? null, expiry_height: req.expiry_height ?? null };
}
export const actionDigest = (csha, req) => ce.sha256Hex(ce.utf8(canonical(actionPreimage(csha, req))));

function requestShapeOk(req) {
  const a = isObj(req) ? req.action : null;
  return isObj(req) && isObj(a) && typeof a.action === "string"
    && (a.target === null || a.target === undefined || typeof a.target === "string")
    && (a.amount === null || a.amount === undefined || (ce.isInt(a.amount) && a.amount >= 0))
    && typeof req.nonce === "string" && HEX32.test(req.nonce)
    && ce.isInt(req.expiry_height) && req.expiry_height >= 0
    && isObj(req.requester) && ["principal", "contractor"].includes(req.requester.role)
    && isObj(req.contract_ref);
}
function requestSigned(contract, req) {
  const key = ce.partyKey(contract, req.requester.role);
  if (!key) return false;
  const msg = ctx("a2a-action-request-v0", body(req, ["signatures"]));
  return (Array.isArray(req.signatures) ? req.signatures : []).some((s) => isObj(s) && s.role === req.requester.role && ce.ed25519Verify(key, s.sig_b64, msg));
}
function contractSignedByBoth(contract) {
  if (!isObj(contract) || contract.schema !== "a2a-contract-v0" || !Array.isArray(contract.parties) || !Array.isArray(contract.signatures)) return false;
  const msg = ce.contractSigningBytes(contract);
  for (const role of ["principal", "contractor"]) {
    const p = contract.parties.find((x) => isObj(x) && x.role === role);
    if (!p) return false;
    if (!contract.signatures.some((s) => isObj(s) && s.domain === p.domain && s.alg === "ed25519" && ce.ed25519Verify(p.public_key_ed25519_b64, s.signature, msg))) return false;
  }
  return true;
}
function readRevocations(contract, revocations, height) {
  const csha = ce.contractSha256(contract), pk = ce.partyKey(contract, "principal");
  let grantRevoked = false; const keys = new Set(), seen = [];
  for (const rec of Array.isArray(revocations) ? revocations : []) {
    if (!(isObj(rec) && rec.schema === REVOKE_SCHEMA && rec.revoked_by === "principal")) continue;
    if ((isObj(rec.contract_ref) ? rec.contract_ref : {}).contract_sha256 !== csha) continue;
    const anchor = isObj(rec.anchor) ? rec.anchor : {};
    if (!(ce.isInt(anchor.height) && ce.isInt(height) && anchor.height <= height)) continue;
    const msg = ctx(REVOKE_SCHEMA, body(rec, ["signatures", "anchor"]));
    if (!(pk && (Array.isArray(rec.signatures) ? rec.signatures : []).some((s) => isObj(s) && s.role === "principal" && ce.ed25519Verify(pk, s.sig_b64, msg)))) continue;
    const rk = rec.revoked_key;
    if (rk === undefined || rk === null) grantRevoked = true;
    else if (isObj(rk) && typeof rk.public_key_ed25519_b64 === "string") keys.add(rk.public_key_ed25519_b64);
    else continue;
    seen.push(ce.sha256Hex(ce.utf8(canonical(body(rec, ["anchor"])))));
  }
  return { grantRevoked, keys, seen: seen.sort() };
}
function presentationRef(presentation) {
  return (Array.isArray(presentation) ? presentation : []).map((p) => {
    if (!isObj(p)) return { adapter: null, sha256: null, verified: null };
    const e = { adapter: typeof p.adapter === "string" ? p.adapter : null, sha256: typeof p.sha256 === "string" ? p.sha256 : null,
      verified: typeof p.verified === "boolean" ? p.verified : null };
    if (typeof p.self_asserted === "boolean") e.self_asserted = p.self_asserted;
    return e;
  });
}

export function decide(contract, req, presentation, chainView, revocations, { seenNonces = [], policy = null } = {}) {
  policy = isObj(policy) ? policy : {};
  let reasons = [], clause = null, seenRev = [];
  const contractOk = contractSignedByBoth(contract);
  const csha = isObj(contract) ? ce.contractSha256(contract) : null;
  const height = isObj(chainView) ? chainView.height : null;
  const shapeOk = requestShapeOk(req);
  const digest = shapeOk && csha ? actionDigest(csha, req) : null;
  let unverifiable = !contractOk || !shapeOk || !ce.isInt(height);
  if (shapeOk && contractOk) {
    const stated = isObj(req.action_binding) && isObj(req.action_binding.digest) ? req.action_binding.digest.value : null;
    if (stated !== digest) reasons.push("action_digest_mismatch");
    if (!requestSigned(contract, req)) unverifiable = true;
  }
  const pref = presentationRef(presentation);
  const unverifiedItems = pref.filter((p) => p.verified !== true);
  if (unverifiable || (unverifiedItems.length && policy.on_unverifiable !== "escalate")) reasons.push("presentation_unverifiable");
  const seen = new Set(seenNonces || []);
  if (contractOk && shapeOk && ce.isInt(height)) {
    if (req.contract_ref.contract_sha256 !== csha) reasons.push("outside_grant");
    const rv = readRevocations(contract, revocations, height); seenRev = rv.seen;
    if (rv.keys.has(ce.partyKey(contract, req.requester.role))) reasons.push("key_revoked");
    if (rv.grantRevoked) reasons.push("grant_revoked");
    const exp = (contract.grant || {}).expiry_height ?? null;
    if ((exp !== null && height > exp) || height > req.expiry_height) reasons.push("contract_expired");
    if (seen.has(req.nonce)) reasons.push("nonce_reused");
    const act = req.action.action, amount = req.action.amount ?? null;
    for (const p of Array.isArray(presentation) ? presentation : []) {
      if (!isObj(p)) continue;
      if (p.within_parent === false) reasons.push("delegation_exceeds_parent");
      const lim = isObj(p.limits) ? p.limits[act] : null;
      if (ce.isInt(lim) && ce.isInt(amount) && amount > lim) reasons.push("amount_over_limit");
      if (isObj(p.grant) && ["prohibited", "unauthorized"].includes(ce.classifyAction({ grant: p.grant }, act))) reasons.push("outside_grant");
    }
    const ev = ce.evaluateAction(contract, act, { approvals: Array.isArray(req.approvals) ? req.approvals : [], height, authorityEnded: false, usedNonces: seen });
    clause = ce.clausePath(contract, act);
    if (ev.clauses.includes("prohibited")) reasons.push("prohibited_action");
    if (ev.clauses.includes("unauthorized")) reasons.push("outside_grant");
    if (ev.clauses.includes("conditional")) reasons.push("conditional_needs_approval");
  }
  reasons = REASONS.filter((r) => reasons.includes(r));
  let decision;
  if (unverifiedItems.length && policy.on_unverifiable === "escalate" && !reasons.includes("presentation_unverifiable")) {
    reasons.push("presentation_unverifiable");
    reasons = REASONS.filter((r) => reasons.includes(r));
    decision = reasons.some((r) => REFUSING.has(r) && r !== "presentation_unverifiable") ? "refuse" : "escalate";
  } else if (reasons.some((r) => REFUSING.has(r))) decision = "refuse";
  else if (reasons.includes("conditional_needs_approval")) decision = "escalate";
  else { decision = "admit"; reasons = ["within_grant"]; }
  return { decision, reasons, clause, action_digest: digest, revocations_seen: seenRev };
}

export function admit(contract, req, presentation, chainView, revocations, { relyingParty = null, admissionId = null, seenNonces = [], policy = null } = {}) {
  const d = decide(contract, req, presentation, chainView, revocations, { seenNonces, policy });
  const cv = isObj(chainView) ? chainView : {}, rp = isObj(relyingParty) ? relyingParty : {};
  return {
    schema: SCHEMA,
    admission_id: admissionId ?? null,
    relying_party: { domain: rp.domain ?? null, key_url: rp.key_url ?? null },
    contract_ref: { contract_id: isObj(contract) ? contract.contract_id ?? null : null, contract_sha256: isObj(contract) ? ce.contractSha256(contract) : null },
    action_ref: { action_binding_digest: d.action_digest, nonce: isObj(req) ? req.nonce ?? null : null },
    presentation_ref: presentationRef(presentation),
    chain_view: { height: cv.height ?? null, header_sha256: cv.header_sha256 ?? null },
    revocations_seen: d.revocations_seen,
    decision: d.decision,
    reasons: d.reasons,
    clause: d.clause,
    rules: { admit: SCHEMA, evaluator_sha256: ce.evaluatorSha256() },
    establishes: [
      "that the relying party named here ran admit() over this contract, this action digest and this chain view, and signed the result",
      "that the decision and reasons are what the shared clause evaluator (rules.evaluator_sha256) returns for those inputs; anyone holding them can recompute it"],
    does_not_establish: [...DOES_NOT_ESTABLISH],
    signatures: [] };
}

export const admissionSigningBytes = (record) => ctx(SCHEMA, body(record, ["signatures"]));
export const admissionSha256 = (record) => ce.sha256Hex(admissionSigningBytes(record));
export function signAdmission(record, privateKeyRaw32, domain) {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), privateKeyRaw32]), format: "der", type: "pkcs8" });
  const sig = edSign(null, admissionSigningBytes(record), key).toString("base64");
  record.signatures.push({ domain: domain ?? record.relying_party.domain, alg: "ed25519", sig });
  return record;
}

let isMain = false;
try { isMain = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch (_e) {}
if (isMain) {
  const i = process.argv.indexOf("--input");
  if (i < 0) { console.error("usage: node admit_v0.mjs --input in.json"); process.exit(1); }
  const inp = JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  const many = Array.isArray(inp) ? inp : [inp];
  const out = many.map((x) => {
    const rec = admit(x.contract, x.action_request, x.presentation, x.chain_view, x.revocations,
      { relyingParty: x.relying_party, admissionId: x.admission_id, seenNonces: x.seen_nonces || [], policy: x.policy || null });
    if (x.sign_with_raw_key_hex) signAdmission(rec, Buffer.from(x.sign_with_raw_key_hex, "hex"));
    return { record: canonical(rec), admission_sha256: admissionSha256(rec), decision: rec.decision, reasons: rec.reasons };
  });
  process.stdout.write(JSON.stringify(Array.isArray(inp) ? out : out[0]) + "\n");
}
