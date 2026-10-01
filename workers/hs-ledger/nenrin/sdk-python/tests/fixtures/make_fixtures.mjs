// make_fixtures.mjs : the frozen provenance bundles the Python port is held to, and the JavaScript reports on them.
//
// Every key is derived from a public phrase (Ed25519 seed = sha256(phrase)), every timestamp is fixed, and
// Ed25519 signing is deterministic, so a re-run writes the same bytes. The reports come from npm nenrin-verify's
// own file (../../../sdk/nenrin_verify.mjs) through its CLI path (did:key resolution, no network). The Python
// tests compare against these without needing Node; tests/test_parity_live.py re-derives them with Node when present.
//
//   node make_fixtures.mjs            write bundles.json, js_reports.json and ../../src/nenrin_verify/selftest.json
//   node make_fixtures.mjs --check    exit 1 if a re-run would write different bytes
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as N from "../../../sdk/nenrin_verify.mjs";
import { didKeyEncode, rawFromKeyObject } from "../../../task-delegation-bind-v0/verify_fixture.mjs";
import { jsCanon } from "../parity/js_canon.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHRASE = "nenrin-verify python parity fixture key ";

function keyFor(name) {
  const seed = createHash("sha256").update(PHRASE + name, "utf8").digest();
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}
const K = {}, ID = {};
for (const n of ["A", "B", "C", "W1", "W2", "W3", "X"]) { K[n] = keyFor(n); ID[n] = didKeyEncode(rawFromKeyObject(K[n].publicKey)); }

const T = "task_py_parity_1", NB = "2026-09-18T00:00:00Z", NA = "2026-09-18T01:00:00Z", IN = "2026-09-18T00:30:00Z", DECL = "2026-09-18T00:20:00Z";
const REF = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ACTION = { tool: "a2a.invoke", target: "/invoices/pay", args_sha256: "sha_args_ok" };
const clone = (o) => JSON.parse(JSON.stringify(o));

function mkGrant(over = {}, signer = "A", binding = false) {
  let g = Object.assign({ schema: "task-execution-bind-v0/grant", task_id: T, action: clone(ACTION), caller_id: ID.A, provider_id: ID.B, nonce: "n1", not_before: NB, not_after: NA }, over);
  for (const k of Object.keys(g)) if (g[k] === undefined) delete g[k];
  g.grant_ref = N.grantRef(g);
  g = N.signGrant(g, K[signer].privateKey);
  return binding ? N.withActionBinding(g, "action") : g;
}
function mkReceipt(g, over = {}, signer = "B", binding = false) {
  let r = Object.assign({ schema: "task-execution-bind-v0/receipt", task_id: T, grant_ref: g.grant_ref, executed_action: clone(ACTION), outcome: { status: "completed", result_sha256: "sha_res_1", evidence: { kind: "ledger_record", ref: REF, system: "ledger.horizonshield.dev" } }, provider_id: ID.B, executed_at: IN }, over);
  r.receipt_id = N.receiptId(r);
  r = N.signReceipt(r, K[signer].privateKey);
  return binding ? N.withActionBinding(r, "executed_action") : r;
}
function mkIntent(g, over = {}, signer = "B", binding = false) {
  let i = Object.assign({ schema: "task-execution-bind-v0/intent", task_id: T, grant_ref: g.grant_ref, proposed_action: clone(ACTION), provider_id: ID.B, declared_at: DECL }, over);
  i.intent_id = N.intentId(i);
  i = N.signIntent(i, K[signer].privateKey);
  return binding ? N.withActionBinding(i, "proposed_action") : i;
}
function mkObs({ seq, from, to, witness, verdict = "pass", prev = null, detail_ref = null, task_id = T }) {
  const obs = { task_id, hop: { seq, from: ID[from], to: ID[to] }, prev_evidence_id: prev, conduct: { verdict, detail_ref }, witness_id: ID[witness], observed_at: IN };
  obs.evidence_id = N.evidenceId(obs);
  return N.signEdge(N.signObservation(obs, K[witness].privateKey), K[from].privateKey);
}

const g = mkGrant();
const r = mkReceipt(g);
const h0 = mkObs({ seq: 0, from: "A", to: "B", witness: "W1", detail_ref: "nenrin-exec://" + r.receipt_id });
const h1 = mkObs({ seq: 1, from: "B", to: "C", witness: "W2", prev: h0.evidence_id });
const base = { task_id: T, observations: [h0, h1], grant: g, receipt: r };

const cases = [];
const add = (name, bundle) => cases.push({ name, bundle: clone(bundle) });

add("full_accepted", base);
add("with_intent", { ...base, intent: mkIntent(g) });
{ const gb = mkGrant({}, "A", true); const rb = mkReceipt(gb, {}, "B", true); const ib = mkIntent(gb, {}, "B", true);
  const o0 = mkObs({ seq: 0, from: "A", to: "B", witness: "W1", detail_ref: "nenrin-exec://" + rb.receipt_id });
  add("action_binding_all_three", { task_id: T, observations: [o0], grant: gb, receipt: rb, intent: ib }); }
{ const d0 = mkObs({ seq: 0, from: "A", to: "B", witness: "W3", verdict: "fail" });
  add("witness_disagreement", { ...base, observations: [h0, d0, h1] }); }
{ const r2 = mkReceipt(g, { outcome: { status: "failed", result_sha256: "sha_res_2" } });
  add("equivocation", { ...base, receipts: [r2] }); }
{ const go = mkGrant({ provider_id: null }); const ro = mkReceipt(go);
  add("open_grant_signed", { task_id: T, grant: go, receipt: ro });
  add("open_grant_unsigned_mode", { task_id: T, grant: go, receipt: ro, require_signatures: false }); }
{ const gs = mkGrant({ provider_id: ID.A }); const rs = mkReceipt(gs, { provider_id: ID.A }, "A");
  add("self_authorized", { task_id: T, grant: gs, receipt: rs }); }
{ const t = clone(r); t.outcome.status = "failed"; add("tampered_receipt", { ...base, receipt: t, receipts: [t] }); }
{ const late = mkReceipt(g, { executed_at: "2026-09-18T02:00:00Z" }); add("outside_window", { task_id: T, grant: g, receipt: late }); }
{ const badev = mkReceipt(g, { outcome: { status: "completed", evidence: { kind: "ledger_record", ref: "XYZ", system: "s" } } }); add("evidence_ref_malformed", { task_id: T, grant: g, receipt: badev }); }
{ const noev = mkReceipt(g, { outcome: { status: "completed" } }); add("no_evidence_bound", { task_id: T, grant: g, receipt: noev }); }
add("delegation_only", { task_id: T, observations: [h0, h1] });
add("execution_only", { task_id: T, grant: g, receipt: r });
add("intent_without_grant", { task_id: T, intent: mkIntent(g) });
add("grant_without_receipt", { task_id: T, grant: g });
{ const bad1 = mkObs({ seq: 1, from: "B", to: "C", witness: "W2", prev: REF }); add("chain_broken_link", { ...base, observations: [h0, bad1] }); }
{ const gap = mkObs({ seq: 2, from: "B", to: "C", witness: "W2", prev: h0.evidence_id }); add("chain_seq_gap", { ...base, observations: [h0, gap] }); }
{ const lm = mkObs({ seq: 0, from: "A", to: "B", witness: "W1", detail_ref: "nenrin-exec://" + REF }); const l1 = mkObs({ seq: 1, from: "B", to: "C", witness: "W2", prev: lm.evidence_id }); add("linkage_mismatch", { ...base, observations: [lm, l1] }); }
{ const other = mkObs({ seq: 1, from: "B", to: "C", witness: "W2", prev: h0.evidence_id, task_id: "task_other" }); add("task_id_mismatch", { ...base, observations: [h0, other] }); }
{ const forged = clone(h1); forged.witness_sig = N.signObservation(Object.assign({}, h1, { witness_sig: undefined }), K.X.privateKey).witness_sig; add("witness_sig_wrong_key", { ...base, observations: [h0, forged] }); }
{ const notind = mkObs({ seq: 0, from: "A", to: "B", witness: "A" }); add("witness_not_independent", { task_id: T, observations: [notind] }); }
{ const rB = mkReceipt(g, { outcome: { status: "completed", result_sha256: "sha_res_B" } }); add("receipt_and_receipts_union", { task_id: T, grant: g, receipt: r, receipts: [rB] }); }
{ const ug = clone(g); delete ug.caller_sig; const ur = clone(r); delete ur.provider_sig; add("unsigned_records_signatures_off", { task_id: T, grant: ug, receipt: ur, require_signatures: false }); add("unsigned_records_signatures_on", { task_id: T, grant: ug, receipt: ur }); }
add("task_id_missing", { observations: [h0] });
{ const intl = mkReceipt(g, { outcome: { status: "completed", note: "café 日本語   tab\t nul\u0000 quote\" back\\", evidence: { kind: "document_sha256", ref: REF, system: "平塚" } } });
  add("non_ascii_and_escapes", { task_id: T, grant: g, receipt: intl }); }
{ const ex = mkIntent(g, { proposed_action: { tool: "a2a.invoke", target: "/invoices/refund", args_sha256: "sha_args_ok" } }); add("intent_diverges", { ...base, intent: ex }); }
{ const early = mkIntent(g, { declared_at: "2026-09-17T23:00:00Z" }); add("intent_outside_window", { ...base, intent: early }); }
{ const feb = mkGrant({ not_before: "2026-02-29T00:00:00Z", not_after: "2026-03-02T00:00:00Z" }); const rf = mkReceipt(feb, { executed_at: "2026-03-01T00:00:00Z" }); add("date_rollover_feb29", { task_id: T, grant: feb, receipt: rf }); }
{ const midnight = mkGrant({ not_before: "2026-09-17T24:00:00Z", not_after: "2026-09-18T01:00:00.999999Z" }); const rm = mkReceipt(midnight, { executed_at: "2026-09-18T01:00:00.9999Z" }); add("hour_24_and_long_fraction", { task_id: T, grant: midnight, receipt: rm }); }

function jsReport(bundle) {
  const input = Object.assign({}, clone(bundle), { resolve: N.didKeyResolver });
  try {
    const rep = N.verifyProvenance(input);
    const con = N.consumeEvidence(input);
    return { threw: false, verdict: rep.verdict, report_canon: jsCanon(rep), report_sha256: createHash("sha256").update(jsCanon(rep), "utf8").digest("hex"), cli_stdout: JSON.stringify(rep, null, 2) + "\n", consume_sha256: createHash("sha256").update(jsCanon(con), "utf8").digest("hex") };
  } catch (e) { return { threw: true, error: String(e && e.message || e) }; }
}

const bundlesText = JSON.stringify({ schema: "nenrin-verify-py-fixtures-v0", key_phrase_prefix: PHRASE, cases }, null, 2) + "\n";
const reports = { schema: "nenrin-verify-py-js-reports-v0", reference: "npm nenrin-verify " + JSON.parse(readFileSync(path.join(HERE, "../../../sdk/package.json"), "utf8")).version + " (sdk/nenrin_verify.mjs, verifier_version " + N.VERIFIER_VERSION + ")", cases: cases.map((c) => ({ name: c.name, ...jsReport(c.bundle) })) };
const reportsText = JSON.stringify(reports, null, 2) + "\n";
// the compact copy shipped inside the package, for `nenrin-verify --selftest` (no Node, no tests directory needed)
const selftestText = JSON.stringify({ schema: "nenrin-verify-py-selftest-v0", reference: reports.reference, cases: cases.map((c, i) => ({ name: c.name, bundle: c.bundle, threw: reports.cases[i].threw, verdict: reports.cases[i].verdict, report_sha256: reports.cases[i].report_sha256, consume_sha256: reports.cases[i].consume_sha256 })) }) + "\n";
const SELFTEST = path.join(HERE, "..", "..", "src", "nenrin_verify", "selftest.json");

if (process.argv.includes("--check")) {
  const same = readFileSync(path.join(HERE, "bundles.json"), "utf8") === bundlesText && readFileSync(path.join(HERE, "js_reports.json"), "utf8") === reportsText && readFileSync(SELFTEST, "utf8") === selftestText;
  console.log(same ? "fixtures reproduce byte for byte" : "fixtures differ from a fresh run");
  process.exit(same ? 0 : 1);
}
writeFileSync(path.join(HERE, "bundles.json"), bundlesText);
writeFileSync(path.join(HERE, "js_reports.json"), reportsText);
writeFileSync(SELFTEST, selftestText);
const tally = {}; for (const c of reports.cases) tally[c.threw ? "threw" : c.verdict] = (tally[c.threw ? "threw" : c.verdict] || 0) + 1;
console.log("wrote " + cases.length + " bundles " + JSON.stringify(tally));
