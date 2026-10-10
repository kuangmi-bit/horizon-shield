// admission_intake.mjs: the intake for a2a-admission-v0 and a2a-revocation-v0 at ledger.horizonshield.dev
// (POST /admission, POST /revocation). It records and anchors. It decides nothing.
//
// What an operator of this intake does and does not do. A relying party ran admit() at its own door and signed the
// result. This intake checks that the bytes are canonical, that the signature is the relying party's and that the key
// is served on the relying party's own domain, stores the bytes under their sha256, and queues them for the daily
// batch that the agreement intake already anchors to Bitcoin. It does not run admit(), does not read the contract,
// and never says whether the action should have been admitted. That is settle v1.11's and v1.12's recomputation, done by anyone.
//
// Publication. Only the signer can make a record public (record-privacy-v1). An admission is stored only when its
// signed bytes say "publication": "public". A revocation is the principal's own act and carries hashes, no names; it
// is stored when the principal's signature verifies under the key the contract names and the principal's key_url
// serves.
//
// Storage is the agreement intake's (doStore in ../agreement-v0/agreement_intake.mjs): the same strongly consistent
// deduplication by sha256, the same pending pool, the same daily batch. Nothing new is anchored differently.
//
// Workers safe: Web Crypto only, no node: imports. The canonical form is the one rule the house has
// (musubi-canonical-v0, which agreement_canonical.mjs's canonicalUtf8 writes; the test holds the two together on
// records made by the Python reference).
import { parseStrict, canonicalUtf8, CanonicalError } from "../agreement-v0/agreement_canonical.mjs";
import { ed25519Verify } from "../agreement-v0/agreement_verify.mjs";

export const ADMISSION_INTAKE_VERSION = "admission-intake 0.2.0";
export const ADMISSION_SCHEMA = "a2a-admission-v0";
export const REVOCATION_SCHEMA = "a2a-revocation-v0";
export const MAX_BYTES = 65536;
export const RETRY_AFTER_SECONDS = 30;
export const PRIVACY_POLICY = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/ext/RECORD_PRIVACY_v1.md";
const DECISIONS = ["admit", "escalate", "refuse"];
const REASONS = ["within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
  "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
  "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch"];
// The stated limits a record must carry, by the version of admit() that wrote it. A v0 record has no rules.version;
// a v0.1 record says "0.1" and states the limit about unanchored revocations. A record of one version carrying the
// other's list is refused, and so is a version this intake does not know.
const DOES_NOT_ESTABLISH_V0 = [
  "that HS allowed or blocked anything; the relying party ran the function at its own door",
  "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
  "that a revocation published after the chain view was known at admission time",
  "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
  "that this record is a legal authorization or determines liability"];
const DOES_NOT_ESTABLISH_V0_1 = [
  DOES_NOT_ESTABLISH_V0[0],
  DOES_NOT_ESTABLISH_V0[1],
  "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    + "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
  DOES_NOT_ESTABLISH_V0[3],
  DOES_NOT_ESTABLISH_V0[4]];
const LIMITS_BY_VERSION = { v0: DOES_NOT_ESTABLISH_V0, "0.1": DOES_NOT_ESTABLISH_V0_1 };
const RECORD_KEYS = ["schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
  "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"];
const REVOKE_KEYS = ["schema", "contract_ref", "revoked_by", "signatures"];

const enc = new TextEncoder();
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const body = (rec, drop) => Object.fromEntries(Object.entries(rec).filter(([k]) => !drop.includes(k)));
const res = (status, b, headers) => ({ status, body: b, headers: headers || {} });
async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const signingBytes = (context, obj) => enc.encode(context + "\n" + canonicalUtf8(obj));
function hostOf(url) {
  const m = typeof url === "string" ? /^https:\/\/([A-Za-z0-9.-]+)(?::\d+)?\//.exec(url) : null;
  return m ? m[1].toLowerCase() : null;
}

async function readBody(request) {
  let b;
  try { b = await request.json(); } catch { return { error: res(400, { error: "bad_json" }) }; }
  if (!isObj(b) || typeof b.record_canonical !== "string") return { error: res(400, { error: "record_canonical (string) required" }) };
  if (enc.encode(b.record_canonical).length > MAX_BYTES) return { error: res(413, { error: "too_large", max_bytes: MAX_BYTES }) };
  return { b };
}
function parseCanonical(text, what) {
  let record;
  try { record = parseStrict(text); } catch (e) {
    return { error: res(422, { error: "unparseable_record", reason_code: e instanceof CanonicalError ? e.code : "bad_json", stage: "parse",
      note: "the " + what + " could not be read as canonical JSON, so nothing was checked and nothing was stored" }) };
  }
  let again;
  try { again = canonicalUtf8(record); } catch { again = null; }
  if (again !== text) return { error: res(422, { error: "not_canonical", stage: "parse",
    note: "record_canonical must be the musubi-canonical-v0 bytes of the record (sorted keys, no whitespace); the sha256 this intake serves is over exactly those bytes" }) };
  return { record };
}
const refused = (codes, extra) => res(422, Object.assign({ status: "refused", refusals: codes,
  note: "not accepted, so not stored, not anchored, not served by sha" }, extra || {}));
const keyUnreachable = (ku, got) => res(503, { error: "key_url_unreachable", key_url: ku, why: (got && got.why) || "the key could not be fetched",
  retry_after_seconds: RETRY_AFTER_SECONDS, note: "a key that cannot be fetched is an unanswered question, not a bad record; retry later" },
  { "retry-after": String(RETRY_AFTER_SECONDS) });

async function storeAccepted(store, origin, kind, canonicalSha, payload, extra) {
  const claim = await store.claimAccepted(canonicalSha, payload);
  if (claim && claim.unbound) return res(503, { error: "dedupe_gate_unbound", retry_after_seconds: RETRY_AFTER_SECONDS,
    note: "the strongly consistent deduplication gate is not bound; refusing to store on eventually consistent storage. fail closed." },
    { "retry-after": String(RETRY_AFTER_SECONDS) });
  const url = origin + "/" + kind + "/" + canonicalSha;
  if (claim && claim.duplicate) return res(200, Object.assign({ status: (claim.stored && claim.stored.status) || "pending_anchor", dedup: true,
    verdict: "accepted", canonical_sha256: canonicalSha, url, note: "already recorded; one record per canonical_sha256" }, extra));
  if (store.queueForAnchor) { try { await store.queueForAnchor(canonicalSha, payload); } catch (_e) { /* served, just not queued */ } }
  return res(201, Object.assign({ status: "pending_anchor", verdict: "accepted", canonical_sha256: canonicalSha, url,
    anchor_policy: "recorded and served by sha now, and queued for the daily batch that anchors the accepted pool to Bitcoin at 00:30 UTC",
    does_not_establish: ["that this ledger agrees with the decision in the record; it stored what the relying party signed",
      "that the action was inside the grant; settle v1.11 recomputes that from the contract"] }, extra));
}

// POST /admission  {"record_canonical": "<musubi-canonical-v0 bytes of a signed a2a-admission-v0>"}
export async function handleAdmissionIntake(request, deps) {
  const { fetchKey, store, now = () => new Date().toISOString(), recorderDomain = null, rateLimit = null, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const rb = await readBody(request);
  if (rb.error) return rb.error;
  if (rateLimit) { const rl = await rateLimit(); if (rl && rl.ok === false) return res(429, { error: rl.error || "rate_limited", cap: rl.cap, scope: rl.scope }); }
  const pc = parseCanonical(rb.b.record_canonical, "admission");
  if (pc.error) return pc.error;
  const record = pc.record;
  const codes = [];
  if (!isObj(record) || record.schema !== ADMISSION_SCHEMA) return refused(["malformed"], { why: "schema must be " + ADMISSION_SCHEMA });
  const keys = Object.keys(record);
  if (!RECORD_KEYS.every((k) => keys.includes(k)) || keys.some((k) => !RECORD_KEYS.includes(k) && k !== "publication")) codes.push("malformed");
  if (!DECISIONS.includes(record.decision) || !Array.isArray(record.reasons) || !record.reasons.length || record.reasons.some((r) => !REASONS.includes(r))) codes.push("malformed");
  const rules = isObj(record.rules) ? record.rules : {};
  const version = Object.prototype.hasOwnProperty.call(rules, "version") ? rules.version : "v0";
  const stated = typeof version === "string" && Object.prototype.hasOwnProperty.call(LIMITS_BY_VERSION, version) ? LIMITS_BY_VERSION[version] : null;
  if (stated === null || version === "v0" && Object.prototype.hasOwnProperty.call(rules, "version")) codes.push("malformed");
  else if (JSON.stringify(record.does_not_establish) !== JSON.stringify(stated)) codes.push("does_not_establish_altered");
  const rp = isObj(record.relying_party) ? record.relying_party : {};
  const dom = typeof rp.domain === "string" && rp.domain ? rp.domain : null;
  if (!dom || hostOf(rp.key_url) !== dom.toLowerCase()) codes.push("signer_not_on_own_domain");
  if (codes.length) return refused([...new Set(codes)].sort());
  if (record.publication !== "public") {
    return refused([Object.prototype.hasOwnProperty.call(record, "publication") ? "publication_not_public" : "publication_consent_missing"], {
      why: "this ledger stores only admissions whose signed bytes say \"publication\": \"public\"; only the signer can make its record public",
      how_to_publish: "write \"publication\": \"public\" into the record before signing it, and file the new canonical bytes",
      how_to_keep_private: "do not file it here. To fix its existence time without revealing it, timestamp its sha256 yourself",
      policy: PRIVACY_POLICY });
  }
  const got = await fetchKey(rp.key_url);
  if (!got || got.ok !== true || typeof got.key !== "string") return keyUnreachable(rp.key_url, got);
  const msg = signingBytes(ADMISSION_SCHEMA, body(record, ["signatures"]));
  let signed = false;
  for (const s of Array.isArray(record.signatures) ? record.signatures : []) {
    if (isObj(s) && s.domain === dom && s.alg === "ed25519" && (await ed25519Verify(got.key, s.sig, msg)) === true) { signed = true; break; }
  }
  if (!signed) return refused(["bad_signature"], { why: "no signature by " + dom + " verifies under the key its key_url serves" });
  const canonicalSha = await sha256Hex(enc.encode(rb.b.record_canonical));
  const admissionSha = await sha256Hex(msg);
  const nowVal = typeof now === "function" ? now() : now;
  const report = { record_schema: ADMISSION_SCHEMA, verdict: "accepted", canonical_sha256: canonicalSha, admission_sha256: admissionSha,
    relying_party: dom, decision: record.decision, admit_version: version === "v0" ? "0" : version, verifier_version: ADMISSION_INTAKE_VERSION,
    checked: ["canonical bytes", "closed lists for decision and reasons", "the stated limits are unaltered", "key_url on the relying party's own domain",
      "Ed25519 signature under the key that key_url serves", "signed consent to publication"],
    not_checked: ["the decision itself; this intake does not run admit() and does not hold the contract"] };
  const payload = { canonical_sha256: canonicalSha, record_canonical: rb.b.record_canonical, report, verifier_version: ADMISSION_INTAKE_VERSION,
    recorder_domain: recorderDomain, submitted_at: nowVal, status: "pending_anchor" };
  return storeAccepted(store, origin, "admission", canonicalSha, payload, { admission_sha256: admissionSha, report,
    how_to_cite: "an execution record names this admission by admission_sha256 (the sha256 of the bytes the relying party signed)" });
}

// POST /revocation  {"record_canonical": "<a2a-revocation-v0, principal signed>", "contract_canonical": "<the a2a-contract-v0 it revokes>"}
// The contract is needed to know whose key the principal's is. It is checked and then dropped: only the revocation is stored.
export async function handleRevocationIntake(request, deps) {
  const { fetchKey, store, now = () => new Date().toISOString(), recorderDomain = null, rateLimit = null, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const rb = await readBody(request);
  if (rb.error) return rb.error;
  if (typeof rb.b.contract_canonical !== "string") return res(400, { error: "contract_canonical (string) required",
    note: "the contract names the principal's key; it is read to check the signature and is not stored" });
  if (enc.encode(rb.b.contract_canonical).length > MAX_BYTES) return res(413, { error: "too_large", max_bytes: MAX_BYTES });
  if (rateLimit) { const rl = await rateLimit(); if (rl && rl.ok === false) return res(429, { error: rl.error || "rate_limited", cap: rl.cap, scope: rl.scope }); }
  const pr = parseCanonical(rb.b.record_canonical, "revocation");
  if (pr.error) return pr.error;
  const pk = parseCanonical(rb.b.contract_canonical, "contract");
  if (pk.error) return pk.error;
  const rec = pr.record, contract = pk.record;
  const keys = isObj(rec) ? Object.keys(rec) : [];
  if (!isObj(rec) || rec.schema !== REVOCATION_SCHEMA || rec.revoked_by !== "principal" || !REVOKE_KEYS.every((k) => keys.includes(k))
    || keys.some((k) => !REVOKE_KEYS.includes(k) && k !== "revoked_key") || !isObj(rec.contract_ref)) return refused(["malformed"]);
  if (Object.prototype.hasOwnProperty.call(rec, "revoked_key") && !(isObj(rec.revoked_key) && typeof rec.revoked_key.public_key_ed25519_b64 === "string")) return refused(["malformed"]);
  if (!isObj(contract) || contract.schema !== "a2a-contract-v0" || !Array.isArray(contract.parties) || !Array.isArray(contract.signatures)) return refused(["contract_malformed"]);
  const contractMsg = signingBytes("a2a-contract-v0", body(contract, ["signatures"]));
  const contractSha = await sha256Hex(contractMsg);
  if (rec.contract_ref.contract_sha256 !== contractSha) return refused(["other_contract"], { why: "the revocation names contract_sha256 " + String(rec.contract_ref.contract_sha256) + ", the contract sent hashes to " + contractSha });
  for (const role of ["principal", "contractor"]) {
    const p = contract.parties.find((x) => isObj(x) && x.role === role);
    let ok = false;
    for (const s of p ? contract.signatures : []) {
      if (isObj(s) && s.domain === p.domain && s.alg === "ed25519" && (await ed25519Verify(p.public_key_ed25519_b64, s.signature, contractMsg)) === true) { ok = true; break; }
    }
    if (!ok) return refused(["contract_not_signed_by_both"]);
  }
  const principal = contract.parties.find((x) => isObj(x) && x.role === "principal");
  const pd = typeof principal.domain === "string" ? principal.domain.toLowerCase() : "";
  const kh = hostOf(principal.key_url);
  if (!pd || !kh || !(kh === pd || kh.endsWith("." + pd))) return refused(["signer_not_on_own_domain"]);
  const got = await fetchKey(principal.key_url);
  if (!got || got.ok !== true || typeof got.key !== "string") return keyUnreachable(principal.key_url, got);
  if (got.key !== principal.public_key_ed25519_b64) return refused(["key_url_serves_another_key"], { why: "the principal's key_url no longer serves the key the contract names" });
  const msg = signingBytes(REVOCATION_SCHEMA, body(rec, ["signatures", "anchor"]));
  let signed = false;
  for (const s of Array.isArray(rec.signatures) ? rec.signatures : []) {
    if (isObj(s) && s.role === "principal" && (await ed25519Verify(got.key, s.sig_b64, msg)) === true) { signed = true; break; }
  }
  if (!signed) return refused(["bad_signature"], { why: "the revocation is not signed by the contract's principal" });
  const canonicalSha = await sha256Hex(enc.encode(rb.b.record_canonical));
  const nowVal = typeof now === "function" ? now() : now;
  const report = { record_schema: REVOCATION_SCHEMA, verdict: "accepted", canonical_sha256: canonicalSha, contract_sha256: contractSha,
    revokes: Object.prototype.hasOwnProperty.call(rec, "revoked_key") ? "key" : "grant", principal: principal.domain, verifier_version: ADMISSION_INTAKE_VERSION,
    not_checked: ["whether any admission or execution came before or after it; the anchor height answers that"] };
  const payload = { canonical_sha256: canonicalSha, record_canonical: rb.b.record_canonical, report, verifier_version: ADMISSION_INTAKE_VERSION,
    recorder_domain: recorderDomain, submitted_at: nowVal, status: "pending_anchor" };
  return storeAccepted(store, origin, "revocation", canonicalSha, payload, { report,
    visible_from: "admit() v0.1 obeys this revocation as soon as the relying party holds it, anchored or not; the anchor proves when it existed, and until it is anchored that time is not proven" });
}

// GET /admission/{sha} and GET /revocation/{sha}: the exact stored bytes, so anyone can recompute the sha and the signature.
export async function handleStoredGet(kind, sha, deps) {
  const { store, origin = "https://ledger.horizonshield.dev" } = deps || {};
  const s = String(sha || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(s)) return res(400, { error: "bad_sha" });
  const stored = await store.getAccepted(s);
  const want = kind === "admission" ? ADMISSION_SCHEMA : REVOCATION_SCHEMA;
  if (!stored || !stored.report || stored.report.record_schema !== want) return res(404, { error: "not_found", canonical_sha256: s });
  let status = stored.status || "pending_anchor", ledgerEntry = null;
  if (store.anchorState) { const a = await store.anchorState(s); if (a && a.anchored) { status = "anchored"; ledgerEntry = a.ledger_entry; } }
  return res(200, { canonical_sha256: s, record_canonical: stored.record_canonical, report: stored.report, status, ledger_entry: ledgerEntry,
    ledger_url: ledgerEntry ? origin + "/ledger/" + ledgerEntry : null, submitted_at: stored.submitted_at });
}

export function admissionSelfDescription(origin) {
  const o = origin || "https://ledger.horizonshield.dev";
  return { intake: ADMISSION_INTAKE_VERSION, schemas: [ADMISSION_SCHEMA, REVOCATION_SCHEMA],
    post_admission: o + "/admission  {\"record_canonical\"}", post_revocation: o + "/revocation  {\"record_canonical\", \"contract_canonical\"}",
    serve_by_sha: [o + "/admission/{canonical_sha256}", o + "/revocation/{canonical_sha256}"], max_bytes: MAX_BYTES,
    what_this_does: "stores what a relying party (admission) or a principal (revocation) signed, under its sha256, and anchors it with the daily batch",
    what_this_does_not_do: ["run admit() or hold the contract", "say whether an action should have been admitted", "allow or block anything"],
    function: "https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/musubi-v0 (admission_verify_v0.py, admission_verify_v0.mjs, settle_v1_11.py, settle_v1_12.py)",
    publication: "an admission is stored only when its signed bytes say \"publication\": \"public\"", policy: PRIVACY_POLICY };
}
