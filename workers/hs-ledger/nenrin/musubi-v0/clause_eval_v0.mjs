#!/usr/bin/env node
// musubi-clause-eval-v0 in a second runtime: the twin of clause_eval_v0.py.
//
// clause_eval_v0.py is the reference. This file follows it function by function so that an admission computed in
// JavaScript carries the same decision, the same reasons and the same bytes as one computed in Python.
// admit_bytematch.py runs both over the same inputs and fails on the first byte that differs.
// The sha256 an admission record names (rules.evaluator_sha256) is the sha256 of the Python reference file, in both
// runtimes, so a reader has one evaluator to open. This file reads clause_eval_v0.py beside it to compute that.
//
// What the twin does not carry: settle v1.4's legacy approval readings (label_bound). An approval that is not a
// valid a2a-approval-v2 under these terms does not count in either runtime; only the wording of the internal
// reason differs, and that wording is not part of any record.
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonical } from "./canonical_v0.mjs";

export const RULES = "musubi-clause-eval-v0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");
export const utf8 = (s) => Buffer.from(s, "utf8");
export const isInt = (x) => typeof x === "number" && Number.isInteger(x);

export function evaluatorSha256() {
  return sha256Hex(readFileSync(path.join(HERE, "clause_eval_v0.py")));
}

// base64 -> exactly n raw bytes, canonical encoding only (the same refusal contract_v0.b64_raw makes), or null.
export function b64Raw(s, n) {
  if (typeof s !== "string" || !B64.test(s) || s.length % 4 !== 0) return null;
  const b = Buffer.from(s, "base64");
  return b.length === n && b.toString("base64") === s ? b : null;
}

export function ed25519Verify(pubB64, sigB64, message) {
  const pk = b64Raw(pubB64, 32), sig = b64Raw(sigB64, 64);
  if (!pk || !sig) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pk.toString("base64url") }, format: "jwk" });
    return edVerify(null, message, key, sig) === true;
  } catch (_e) { return false; }
}

const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
export const contractSigningBytes = (c) => Buffer.concat([utf8("a2a-contract-v0\n"), utf8(canonical(body(c, ["signatures"])))]);
export const contractSha256 = (c) => sha256Hex(contractSigningBytes(c));
export const partyKey = (c, role) => {
  const p = (Array.isArray(c.parties) ? c.parties : []).find((x) => x && typeof x === "object" && x.role === role);
  return p ? p.public_key_ed25519_b64 : null;
};

// ---- the pinned approver rule (settle v1.10) ----
export function approvers(contract) {
  const ap = (contract.grant || {}).approval_policy;
  const a = ap && typeof ap === "object" && !Array.isArray(ap) ? ap.approvers : null;
  return Array.isArray(a) ? a.filter((x) => x && typeof x === "object" && !Array.isArray(x)) : [];
}
export const gatedActions = (contract) => [...new Set(approvers(contract).flatMap((a) => (a.actions || []).filter((x) => typeof x === "string")))].sort();
const approverApprovalBytes = (contract, e, key) => Buffer.concat([utf8("a2a-approval-v2\n"), utf8(canonical({
  contract_sha256: contractSha256(contract), action: e.action ?? null, approver_key: key,
  valid_until_height: e.valid_until_height ?? null, nonce: e.nonce ?? null, single_use: e.single_use ?? null }))]);

export function verifyApproverApproval(contract, e) {
  if (!e || typeof e !== "object" || Array.isArray(e) || e.by !== "approver") return ["approval_unverified", "not_an_approver_approval"];
  const vu = e.valid_until_height, nonce = e.nonce, su = e.single_use;
  if (!(typeof e.action === "string" && isInt(vu) && vu >= 0 && typeof nonce === "string" && HEX32.test(nonce) && typeof su === "boolean"))
    return ["approval_unverified", "malformed"];
  const pin = approvers(contract).find((a) => a.name === e.approver);
  if (!pin) return ["approval_unverified", "approver_not_pinned"];
  if (!(pin.actions || []).includes(e.action)) return ["approval_unverified", "action_not_permitted_for_approver"];
  if (b64Raw(pin.public_key_ed25519_b64, 32) === null || b64Raw(e.sig_b64, 64) === null) return ["approval_unverified", "malformed_key_or_signature"];
  if (!ed25519Verify(pin.public_key_ed25519_b64, e.sig_b64, approverApprovalBytes(contract, e, pin.public_key_ed25519_b64))) return ["approval_unverified", "bad_signature"];
  return ["approved", null];
}

// settle v1.6: the principal's a2a-approval-v2 over these terms.
function principalApprovalCounts(contract, e) {
  const pk = partyKey(contract, "principal");
  if (!pk || !e || typeof e !== "object") return false;
  const vu = e.valid_until_height, nonce = e.nonce, su = e.single_use, claimed = e.contract_sha256;
  if (!(isInt(vu) && vu >= 0 && typeof nonce === "string" && HEX32.test(nonce) && typeof su === "boolean" && typeof claimed === "string" && HEX64.test(claimed))) return false;
  const msg = Buffer.concat([utf8("a2a-approval-v2\n"), utf8(canonical({ contract_sha256: claimed, action: e.action ?? null, valid_until_height: vu, nonce, single_use: su }))]);
  return ed25519Verify(pk, e.sig_b64, msg) && claimed === contractSha256(contract);
}

// ---- one action against the grant ----
export function grantSets(contract) {
  const g = contract.grant && typeof contract.grant === "object" && !Array.isArray(contract.grant) ? contract.grant : {};
  const conditional = new Map();
  for (const c of g.conditional || []) if (c && typeof c === "object" && !Array.isArray(c) && !conditional.has(c.action)) conditional.set(c.action, c);
  return { g, authorized: new Set(g.authorized_actions || []), prohibited: new Set(g.prohibited_actions || []), conditional, exp: g.expiry_height ?? null };
}
export function classifyAction(contract, action) {
  const s = grantSets(contract);
  if (s.prohibited.has(action)) return "prohibited";
  if (s.conditional.has(action)) return "conditional";
  return s.authorized.has(action) ? "authorized" : "unauthorized";
}
export function clausePath(contract, action) {
  const { g } = grantSets(contract), kind = classifyAction(contract, action);
  if (kind === "prohibited") return "grant.prohibited_actions[" + (g.prohibited_actions || []).indexOf(action) + "]";
  if (kind === "conditional") return "grant.conditional[" + (g.conditional || []).findIndex((c) => c && typeof c === "object" && c.action === action) + "]";
  if (kind === "authorized") return "grant.authorized_actions[" + (g.authorized_actions || []).indexOf(action) + "]";
  return null;
}
export function approvalCounts(contract, action, approval) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval) || approval.action !== action) return false;
  if (gatedActions(contract).includes(action)) return verifyApproverApproval(contract, approval)[0] === "approved";
  if (approval.by === "approver") return false;
  return principalApprovalCounts(contract, approval);
}
export function evaluateAction(contract, action, { approvals = [], height = null, authorityEnded = false, usedNonces = new Set() } = {}) {
  const s = grantSets(contract);
  const out = { class: classifyAction(contract, action), clauses: [], approval: null };
  if (authorityEnded) { out.clauses.push("revoked"); return out; }
  if (s.exp !== null && height !== null && height > s.exp) out.clauses.push("after_expiry");
  if (s.prohibited.has(action)) { out.clauses.push("prohibited"); return out; }
  if (s.conditional.has(action)) {
    for (const ap of approvals || []) {
      if (!approvalCounts(contract, action, ap)) continue;
      if (height !== null && height > ap.valid_until_height) continue;
      if (ap.single_use && usedNonces.has(ap.nonce)) continue;
      out.approval = { by: ap.by || "principal", nonce: ap.nonce, single_use: ap.single_use };
      return out;
    }
    out.clauses.push("conditional");
    return out;
  }
  if (!s.authorized.has(action)) out.clauses.push("unauthorized");
  return out;
}
