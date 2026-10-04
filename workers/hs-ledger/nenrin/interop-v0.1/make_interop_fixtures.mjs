// make_interop_fixtures.mjs : one-shot generator for interop-v0.1, the extension of the frozen interop-v0 corpus.
// interop-v0 (five bundles at c235e75e) stays frozen and unchanged. v0.1 adds vectors for the places an independent
// implementation reported it had to guess or could not test (A2A Discussion #1631, kuangmi-bit, 2026-10-04):
// linkage under the two readings of "names the reconciled receipt", the self_authorized grant, R1 witness
// independence, and refusal codes v0 never exercised. Each bundle runs through the published verifier
// (sdk/nenrin_verify.mjs) and its verdict signature is frozen into expected.json. Re-running makes NEW fixtures with
// fresh keys, so the committed fixtures and expected.json are the immutable reference and run_interop.mjs is the check.
import { writeFileSync, mkdirSync } from "node:fs";
import { evidenceId } from "../task-delegation-bind-v0/bind.mjs";
import { newAgentKey, signObservation, signEdge } from "../task-delegation-bind-v0/sign.mjs";
import { grantRef, receiptId } from "../task-execution-bind-v0/bind_exec.mjs";
import { signGrant, signReceipt } from "../task-execution-bind-v0/sign_exec.mjs";
import { intentId, signIntent } from "../task-execution-bind-v0/preflight.mjs";
import { didKeyEncode, rawFromKeyObject } from "../task-delegation-bind-v0/verify_fixture.mjs";
import { verifyProvenance, didKeyResolver } from "../sdk/nenrin_verify.mjs";

const NB = "2026-10-04T00:00:00Z", NA = "2026-10-04T01:00:00Z", IN = "2026-10-04T00:30:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const GOODEV = { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" };
const ACTION = { tool: "a2a.invoke", target: "/task", args_sha256: "sha_args_ok" };
function did() { const k = newAgentKey(); return { k, id: didKeyEncode(rawFromKeyObject(k.publicKey)) }; }
function flipB64(s) { const i = 10; const c = s[i]; const r = c === "A" ? "B" : "A"; return s.slice(0, i) + r + s.slice(i + 1); }

function makeBundle(task_id, flavor) {
  const A = did(), B = did(), C = did(), W1 = did(), W2 = did();
  const priv = {}; for (const x of [A, B, C, W1, W2]) priv[x.id] = x.k.privateKey;
  const callerOf = flavor === "self_authorized" ? B : A;
  const mkGrant = (tid = task_id) => { const g = { schema: "task-execution-bind-v0/grant", task_id: tid, action: ACTION, caller_id: callerOf.id, provider_id: B.id, nonce: "n1", not_before: NB, not_after: NA }; g.grant_ref = grantRef(g); return signGrant(g, callerOf.k.privateKey); };
  const grant = mkGrant();
  const mkReceipt = (o = {}) => {
    const r = { schema: "task-execution-bind-v0/receipt", task_id: o.task || task_id, grant_ref: (o.grant || grant).grant_ref, executed_action: ACTION,
      outcome: { status: o.status || "completed", result_sha256: o.result || "sha_res_1", evidence: o.evidence || GOODEV }, provider_id: B.id, executed_at: o.at || IN };
    r.receipt_id = receiptId(r); return signReceipt(r, (o.signer || B).k.privateKey);
  };
  const receipt = mkReceipt();
  const mkObs = (o) => { const obs = { task_id, hop: { seq: o.seq, from: o.from, to: o.to }, prev_evidence_id: o.prev === undefined ? null : o.prev, conduct: { verdict: o.verdict, detail_ref: o.detail_ref === undefined ? null : o.detail_ref }, witness_id: o.witness, observed_at: IN }; obs.evidence_id = evidenceId(obs); return signEdge(signObservation(obs, priv[o.witness]), priv[o.from]); };
  const chain = (link, w0 = W1.id) => { const h0 = mkObs({ seq: 0, from: A.id, to: B.id, witness: w0, verdict: "pass", detail_ref: link }); const h1 = mkObs({ seq: 1, from: B.id, to: C.id, witness: W2.id, verdict: "pass", prev: h0.evidence_id }); return [h0, h1]; };
  const LINK = "nenrin-exec://";
  let bundle = { task_id, observations: chain(LINK + receipt.receipt_id), grant, receipt };
  if (flavor === "linkage_unpresented") bundle.observations = chain(LINK + "f".repeat(64));
  if (flavor === "linkage_unreconciled") {
    const stray = mkReceipt({ signer: C, result: "sha_res_stray" });
    bundle = { task_id, observations: chain(LINK + stray.receipt_id), grant, receipts: [receipt, stray] };
  }
  if (flavor === "witness_is_party") bundle.observations = chain(LINK + receipt.receipt_id, A.id);
  if (flavor === "task_id_mismatch") { const g2 = mkGrant("task_other"); bundle.grant = g2; bundle.receipt = mkReceipt({ task: "task_other", grant: g2 }); bundle.observations = chain(LINK + bundle.receipt.receipt_id); }
  if (flavor === "task_id_missing") bundle.task_id = "";
  if (flavor === "incomplete_pair") { delete bundle.receipt; bundle.observations = chain(null); }
  if (flavor === "provider_sig_invalid") bundle.receipt = Object.assign({}, receipt, { provider_sig: flipB64(receipt.provider_sig) });
  if (flavor === "non_utc_timestamp") { const r = mkReceipt({ at: "2026-10-04T09:30:00+09:00" }); bundle.receipt = r; bundle.observations = chain(LINK + r.receipt_id); }
  if (flavor === "evidence_malformed") { const r = mkReceipt({ evidence: { kind: "not_a_kind", ref: "x" } }); bundle.receipt = r; bundle.observations = chain(LINK + r.receipt_id); }
  const mkIntent = (action = ACTION) => { const i = { schema: "task-execution-bind-v0/intent", task_id, grant_ref: grant.grant_ref, proposed_action: action, provider_id: B.id, declared_at: IN }; i.intent_id = intentId(i); return signIntent(i, B.k.privateKey); };
  if (flavor === "preflight_without_grant") bundle = { task_id, observations: chain(null), intent: mkIntent() };
  if (flavor === "preflight_invalid") bundle.intent = mkIntent({ tool: "a2a.invoke", target: "/other", args_sha256: "sha_args_ok" });
  if (flavor === "preflight_signature_invalid") { const i = mkIntent(); bundle.intent = Object.assign({}, i, { intent_sig: flipB64(i.intent_sig) }); }
  return bundle;
}

const CASES = [
  { name: "linkage_unpresented", intent: "an observation's nenrin-exec:// detail_ref names a receipt_id that is not in the presented set; refused under either reading of the linkage rule" },
  { name: "linkage_unreconciled", intent: "two receipts are presented, only one is signed by the authorized provider and reconciles; the link names the other, presented one. Refused: the link must name the RECONCILED receipt, not merely a presented one" },
  { name: "self_authorized", intent: "the grant's caller_id equals its provider_id; declared, so recorded as a finding and not refused" },
  { name: "witness_is_party", intent: "hop 0's witness is the hop's own from party; R1 witness independence fails, refusal" },
  { name: "task_id_mismatch", intent: "a self-consistent grant/receipt pair that belongs to another task_id; refusal" },
  { name: "task_id_missing", intent: "the bundle's task_id is the empty string; refusal (every record then also mismatches)" },
  { name: "incomplete_pair", intent: "a grant is presented with no receipt; refusal" },
  { name: "provider_sig_invalid", intent: "the receipt's provider_sig is tampered; refusal, and with no authentic receipt left the grant is also unreconciled" },
  { name: "non_utc_timestamp", intent: "executed_at carries a +09:00 offset; the receipt is refused as execution_invalid with reason invalid_timestamp (invalid_timestamp is a reason, not a refusal code)" },
  { name: "evidence_malformed", intent: "the outcome's evidence pointer names an unknown kind; refusal" },
  { name: "preflight_without_grant", intent: "a signed intent is presented without the grant it references; refusal" },
  { name: "preflight_invalid", intent: "the signed intent proposes an action the grant does not authorize; refusal" },
  { name: "preflight_signature_invalid", intent: "the intent's signature is tampered; refusal" },
];
const sig = (p) => ({ verdict: p.verdict, refusals: p.refusals.map((r) => r.code).sort(), findings: p.findings.map((f) => f.code).sort() });

mkdirSync(new URL("./fixtures/", import.meta.url), { recursive: true });
const expected = { schema: "nenrin-interop-expected-v0", version: "0.1.1", extends: "interop-v0 at c235e75e362ae6bf303e75be9a302caefe726c06 (unchanged)", verifier: "nenrin-provenance-verify-v0 (sdk/nenrin_verify.mjs, npm: nenrin-verify)", note: "the canonical verdict signature each fixture must reproduce: verdict, sorted refusal codes, sorted finding codes", cases: {} };
for (const c of CASES) {
  const task_id = "task_interop01_" + c.name;
  const bundle = makeBundle(task_id, c.name);
  const p = verifyProvenance(Object.assign({}, bundle, { resolve: didKeyResolver }));
  writeFileSync(new URL("./fixtures/" + c.name + ".json", import.meta.url), JSON.stringify(bundle, null, 2) + "\n");
  expected.cases[c.name] = { intent: c.intent, task_id, expect: sig(p), reasons: p.refusals.map((r) => r.reason).filter(Boolean) };
  console.log(c.name.padEnd(24) + JSON.stringify(sig(p)) + (p.refusals.some((r) => r.reason) ? "  reasons " + JSON.stringify(p.refusals.map((r) => r.reason)) : ""));
}
writeFileSync(new URL("./expected.json", import.meta.url), JSON.stringify(expected, null, 2) + "\n");
console.log("\nwrote fixtures and expected.json");
