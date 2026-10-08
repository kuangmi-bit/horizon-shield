// test/witness_rules.test.mjs
// 2026-10-08 (FIX_LIST 5): POST /witness runs the resume's measurement rules (resume_v1.checkMeasurement) on a full
// record, with the receipt time standing in for the anchoring block. A record the resume would refuse is refused at
// intake, before it is stored or counted, so one bad record can no longer take an endpoint's resume down.
// Run: node test/witness_rules.test.mjs   (offline)

import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger witness measurement rules at intake");
const ORIGIN = "https://ledger.horizonshield.dev";
const SHA = "a".repeat(64);
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
const canon = (o) => JSON.stringify(sortKeys(o));
function walk(over = {}) {
  return {
    schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp",
    walked_at: "2026-09-07T01:00:00Z", base: "https://mcp.horizonshield.dev",
    witness: { name: "Test Witness", vantage: "test" },
    nodes: [{ id: "n0", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: SHA } }],
    assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
    verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 },
    ...over,
  };
}
let kvMock, env;
function reset() { kvMock = mockKV([["seq", "40"]]); env = { LEDGER: kvMock.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) }; }
async function post(rec, ip = "203.0.113.9") {
  const res = await worker.fetch(new Request(ORIGIN + "/witness", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ record_canonical: canon(rec) }),
  }), env);
  return { status: res.status, j: await res.json() };
}
const stored = () => [...kvMock.store.keys()].filter((k) => k.startsWith("wit:pending:")).length;

reset();
let r = await post(walk());
chk("a clean full record is accepted and counted", r.status === 201 && r.j.counted === true, JSON.stringify(r.j).slice(0, 160));

reset();
r = await post(walk({ walked_at: "2099-01-01T00:00:00Z" }));
chk("walked_at after the receipt time is refused: coordinate_chosen_by_prover", r.status === 422 && r.j.error === "fails_measurement_rules" && r.j.reason_code === "coordinate_chosen_by_prover", JSON.stringify(r.j).slice(0, 200));
chk("a refused record is not stored", stored() === 0);

reset();
r = await post(walk({ assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"], rating: 5 }] }));
chk("a score key anywhere in the record is refused: score_injection", r.status === 422 && (r.j.reason_code === "score_injection" || r.j.error === "invalid_witness_record"), JSON.stringify(r.j).slice(0, 200));
chk("and nothing is stored", stored() === 0);

reset();
r = await post(walk({ verdict: { ok: false, outcome: "PASS", n_pass: 1, n_total: 1 } }));
chk("verdict.ok disagreeing with outcome is refused", r.status === 422 && (r.j.reason_code === "verdict_inconsistent" || r.j.error === "invalid_witness_record"), JSON.stringify(r.j).slice(0, 200));

reset();
r = await post(walk({ walked_at: "2026-09-07 01:00" }));
chk("an unrecognised timestamp is refused", r.status === 422, JSON.stringify(r.j).slice(0, 200));

process.exit(chk.done() ? 1 : 0);
