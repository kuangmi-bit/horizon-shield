// admission_intake.test.mjs: the intake for a2a-admission-v0 and a2a-revocation-v0, on records made by the Python
// reference (fixtures/admission_intake/cases.json, written by a relying party's door from fixed test keys; fixtures/ADMISSION_FIXTURES.sha256 lists its sha256).
// No network: keys come from a stub, storage is a Map. Run: node admission_intake.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { handleAdmissionIntake, handleRevocationIntake, handleStoredGet, admissionSelfDescription, MAX_BYTES } from "./admission_intake.mjs";
import { canonical as musubiCanonical } from "./canonical_v0.mjs";
import { canonicalUtf8, parseStrict } from "../agreement-v0/agreement_canonical.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = JSON.parse(readFileSync(path.join(HERE, "fixtures", "admission_intake", "cases.json"), "utf8"));
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "   <<< " + (typeof detail === "string" ? detail : JSON.stringify(detail)))); };
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function world({ keys = null, bound = true } = {}) {
  const mem = new Map(), queued = [], fetched = [];
  const served = keys || { [C.relying_party.key_url]: C.relying_pub_b64, [C.principal_key_url]: C.principal_pub_b64 };
  return { mem, queued, fetched,
    deps: { origin: "https://ledger.horizonshield.dev", recorderDomain: "ledger.horizonshield.dev", now: () => "2026-10-10T00:00:00.000Z",
      fetchKey: async (u) => { fetched.push(u); return served[u] ? { ok: true, key: served[u] } : { ok: false, why: "key_url answered 404" }; },
      store: {
        claimAccepted: async (s, p) => { if (!bound) return { unbound: true }; if (mem.has(s)) return { duplicate: true, stored: mem.get(s) }; mem.set(s, p); return { duplicate: false, stored: p }; },
        queueForAnchor: async (s) => { queued.push(s); return { ok: true }; },
        getAccepted: async (s) => mem.get(s) || null,
        anchorState: async () => null } } };
}
const post = (b) => new Request("https://ledger.horizonshield.dev/x", { method: "POST", headers: { "content-type": "application/json" }, body: typeof b === "string" ? b : JSON.stringify(b) });
const edit = (text, f) => { const o = JSON.parse(text); f(o); return musubiCanonical(o); };

// ---- the canonical rule is one rule ----
for (const k of ["admission_public", "admission_public_v0", "admission_revoked_without_anchor", "admission_brought_result", "contract_canonical", "revocation_grant", "revocation_key"]) {
  // the intake reads with parseStrict (which keeps an integer an integer) and writes with canonicalUtf8; canonical_v0.mjs is the MUSUBI twin
  t("the intake's reader and writer and musubi-canonical-v0 give the bytes Python wrote for " + k, canonicalUtf8(parseStrict(C[k])) === C[k] && musubiCanonical(JSON.parse(C[k])) === C[k]);
}

// ---- POST /admission ----
let w = world();
let r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("a relying party's admission with signed consent to publication: 201, pending_anchor", r.status === 201 && r.body.status === "pending_anchor" && r.body.verdict === "accepted", r.body);
t("stored under the sha256 of the bytes received", r.body.canonical_sha256 === sha(C.admission_public) && w.mem.has(sha(C.admission_public)) && w.mem.get(sha(C.admission_public)).record_canonical === C.admission_public);
t("the response names admission_sha256, what an execution cites (the same value Python computes)", r.body.admission_sha256 === C.admission_public_sha256, r.body.admission_sha256);
t("queued for the daily batch the agreement intake anchors; batch row is schema a2a-admission-v0, verdict accepted", w.queued.length === 1 && r.body.report.record_schema === "a2a-admission-v0" && r.body.report.verdict === "accepted");
t("the intake says what it did not check, and that it did not agree with the decision", r.body.report.not_checked.length === 1 && /did not|does not/.test(JSON.stringify(r.body.does_not_establish) + r.body.report.not_checked[0]));
t("one key fetch, the relying party's own key_url", w.fetched.length === 1 && w.fetched[0] === C.relying_party.key_url);
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("the same bytes again: 200, dedup, one stored record", r.status === 200 && r.body.dedup === true && w.mem.size === 1 && w.queued.length === 1, r.body);
r = await handleAdmissionIntake(post({ record_canonical: C.admission_refuse }), w.deps);
t("a refuse decision is recorded like any other (the intake does not prefer an outcome)", r.status === 201 && r.body.report.decision === "refuse", r.body);
r = await handleStoredGet("admission", sha(C.admission_public), w.deps);
t("GET /admission/{sha} serves the exact bytes", r.status === 200 && r.body.record_canonical === C.admission_public && r.body.status === "pending_anchor");
t("GET /revocation/{sha} does not serve an admission", (await handleStoredGet("revocation", sha(C.admission_public), w.deps)).status === 404);
t("GET with a bad sha: 400", (await handleStoredGet("admission", "xyz", w.deps)).status === 400);

const refusal = async (name, text, code, deps) => {
  const ww = deps || world();
  const rr = await handleAdmissionIntake(post({ record_canonical: text }), ww.deps);
  t("refused, nothing stored: " + name + " (" + code + ")", rr.status === 422 && (rr.body.refusals || [rr.body.error]).includes(code) && ww.mem.size === 0 && ww.queued.length === 0, rr.body);
};
await refusal("no signed consent to publication", C.admission_private, "publication_consent_missing");
await refusal("publication set to private after signing", edit(C.admission_public, (o) => { o.publication = "private"; }), "publication_not_public");
await refusal("signed by the applicant's key (self admission), relying party's key served", C.admission_signed_by_contractor, "bad_signature");
await refusal("decision edited after signing", edit(C.admission_public, (o) => { o.decision = "refuse"; o.reasons = ["prohibited_action"]; }), "bad_signature");
await refusal("key_url on another domain", edit(C.admission_public, (o) => { o.relying_party.key_url = "https://evil.example/k.json"; }), "signer_not_on_own_domain");
await refusal("a stated limit removed", edit(C.admission_public, (o) => { o.does_not_establish.pop(); }), "does_not_establish_altered");
await refusal("a v0.1 record carrying v0's stated limits", edit(C.admission_public, (o) => { o.does_not_establish[2] = "that a revocation published after the chain view was known at admission time"; }), "does_not_establish_altered");
await refusal("a v0 record relabelled as v0.1", edit(C.admission_public_v0, (o) => { o.rules.version = "0.1"; }), "does_not_establish_altered");
await refusal("a version of admit() this intake does not know", edit(C.admission_public, (o) => { o.rules.version = "9"; }), "malformed");
await refusal("rules.version written as v0", edit(C.admission_public, (o) => { o.rules.version = "v0"; }), "malformed");
await refusal("rules.version a number", edit(C.admission_public, (o) => { o.rules.version = 1; }), "malformed");
{
  const ww = world();
  const r0 = await handleAdmissionIntake(post({ record_canonical: C.admission_public_v0 }), ww.deps);
  t("a record admit v0 signed is still accepted and stored under its own sha", r0.status === 201 && r0.body.canonical_sha256 === C.admission_public_v0_canonical_sha256 && r0.body.admission_sha256 === C.admission_public_v0_admission_sha256 && r0.body.report.admit_version === "0", r0.body);
  const r1 = await handleAdmissionIntake(post({ record_canonical: C.admission_revoked_without_anchor }), ww.deps);
  const rec1 = JSON.parse(C.admission_revoked_without_anchor);
  t("a v0.1 refusal on an unanchored revocation is stored, and says the revocation carried no anchor", r1.status === 201 && r1.body.report.admit_version === "0.1"
    && rec1.decision === "refuse" && rec1.revocations_seen.length === 1 && rec1.revocations_seen[0].anchored === false && rec1.revocations_seen[0].height === null, r1.body);
  const r2 = await handleAdmissionIntake(post({ record_canonical: C.admission_brought_result }), ww.deps);
  const rec2 = JSON.parse(C.admission_brought_result);
  t("a v0.1 refusal of a brought result is stored, and names what was brought", r2.status === 201 && rec2.decision === "refuse" && JSON.stringify(rec2.presentation_ref[0].self_declared) === JSON.stringify(["verified"]), r2.body);
}
await refusal("a reason outside the closed list", edit(C.admission_public, (o) => { o.reasons = ["looks_fine"]; }), "malformed");
await refusal("an extra field (a score)", edit(C.admission_public, (o) => { o.score = 97; }), "malformed");
await refusal("another schema", edit(C.admission_public, (o) => { o.schema = "a2a-admission-v1"; }), "malformed");
await refusal("the key the key_url serves is another key", C.admission_public, "bad_signature", world({ keys: { [C.relying_party.key_url]: C.stranger_pub_b64 } }));
await refusal("bytes that are not canonical (pretty printed)", JSON.stringify(JSON.parse(C.admission_public), null, 1), "not_canonical");
await refusal("not JSON", "{", "unparseable_record");
w = world({ keys: {} });
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("key_url unreachable: 503 with retry-after, not a verdict, nothing stored", r.status === 503 && r.headers["retry-after"] === "30" && w.mem.size === 0, r.body);
w = world({ bound: false });
r = await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps);
t("dedupe gate unbound: 503, fail closed", r.status === 503 && r.body.error === "dedupe_gate_unbound");
t("no record_canonical: 400", (await handleAdmissionIntake(post({}), world().deps)).status === 400);
t("too large: 413", (await handleAdmissionIntake(post({ record_canonical: "x".repeat(MAX_BYTES + 1) }), world().deps)).status === 413);
w = world(); w.deps.rateLimit = async () => ({ ok: false, error: "daily_cap", cap: 50, scope: "network" });
t("rate limited: 429, before any parsing", (await handleAdmissionIntake(post({ record_canonical: C.admission_public }), w.deps)).status === 429 && w.fetched.length === 0);

// ---- POST /revocation ----
w = world();
r = await handleRevocationIntake(post({ record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }), w.deps);
t("the principal's revocation of the grant: 201, pending_anchor, revokes grant", r.status === 201 && r.body.report.revokes === "grant" && r.body.report.contract_sha256 === C.contract_sha256, r.body);
t("only the revocation is stored, not the contract", w.mem.size === 1 && w.mem.get(sha(C.revocation_grant)).record_canonical === C.revocation_grant && !JSON.stringify([...w.mem.values()]).includes("authorized_actions"));
r = await handleRevocationIntake(post({ record_canonical: C.revocation_key, contract_canonical: C.contract_canonical }), w.deps);
t("the principal's revocation of one key: 201, revokes key", r.status === 201 && r.body.report.revokes === "key", r.body);
t("GET /revocation/{sha} serves the exact bytes", (await handleStoredGet("revocation", sha(C.revocation_key), w.deps)).body.record_canonical === C.revocation_key);
const rrev = async (name, bodyObj, code, deps) => {
  const ww = deps || world();
  const rr = await handleRevocationIntake(post(bodyObj), ww.deps);
  t("refused, nothing stored: " + name + " (" + code + ")", rr.status === 422 && (rr.body.refusals || []).includes(code) && ww.mem.size === 0, rr.body);
};
await rrev("a revocation signed by the contractor", { record_canonical: C.revocation_by_contractor, contract_canonical: C.contract_canonical }, "bad_signature");
await rrev("a revocation sent with another contract", { record_canonical: C.revocation_grant, contract_canonical: C.other_contract_canonical }, "other_contract");
await rrev("the contract edited after signing (and the revocation re-pointed)", { record_canonical: C.revocation_grant, contract_canonical: edit(C.contract_canonical, (o) => { o.nonce = "0".repeat(32); }) }, "other_contract");
await rrev("an extra field in the revocation", { record_canonical: edit(C.revocation_grant, (o) => { o.reason = "x"; }), contract_canonical: C.contract_canonical }, "malformed");
await rrev("revoked_by is not the principal", { record_canonical: edit(C.revocation_grant, (o) => { o.revoked_by = "contractor"; }), contract_canonical: C.contract_canonical }, "malformed");
await rrev("the principal's key_url now serves another key", { record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }, "key_url_serves_another_key", world({ keys: { [C.principal_key_url]: C.stranger_pub_b64 } }));
w = world({ keys: {} });
r = await handleRevocationIntake(post({ record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical }), w.deps);
t("principal's key_url unreachable: 503, not a verdict", r.status === 503 && w.mem.size === 0);
t("no contract sent: 400", (await handleRevocationIntake(post({ record_canonical: C.revocation_grant }), world().deps)).status === 400);

// ---- the self description ----
const d = admissionSelfDescription("https://ledger.horizonshield.dev");
t("the self description says what the intake does not do", d.what_this_does_not_do.length === 3 && d.schemas.join() === "a2a-admission-v0,a2a-revocation-v0");

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (admission_intake)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (admission_intake: records made by the Python reference; stored only when signed, on the signer's own domain, and public by the signer's consent)");
