// task_anchor_selftest.mjs : offline test of the daily Bitcoin anchor for task observations.
// In-memory KV (with delete + seq) + Web Crypto. Mirrors anchorWitnessPool. Run: node task_anchor_selftest.mjs
import { evidenceId, handleTaskWitness, anchorTaskWitnessPool, sha256hex, handleTaskEvidence } from "./task_ledger_v0.mjs";
// record-privacy-v1: parties are real did:keys and both consent by default, so these cases exercise publication as before;
// the commitment-only path has its own cases in task_ledger_selftest.mjs.
import { D, consented } from "./consent_testkit.mjs";

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const env = { LEDGER: kv() };
let fails = 0;
const ok = (n, c) => { console.log((c ? "  ok   " : "  FAIL ") + n); if (!c) fails++; };
async function obs({ task_id, seq = 0, from = "did:key:A", to = "did:key:B", prev = null, verdict = "PASS", witness = "did:key:W1" }) {
  const o = { task_id, hop: { seq, from: D(from), to: D(to) }, prev_evidence_id: prev, conduct: { verdict, detail_ref: null }, witness_id: D(witness), observed_at: "2026-09-16T00:00:00Z" };
  o.evidence_id = await evidenceId(o);
  return o;
}
async function post(o) { const r = await handleTaskWitness("/witness/task", { method: "POST", json: async () => consented(o), text: async () => JSON.stringify(consented(o)) }, null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
const listLen = async (prefix) => (await env.LEDGER.list({ prefix })).keys.length;

console.log("task-witness anchor : selftest (mirrors anchorWitnessPool)");

const h0 = await obs({ task_id: "atask", seq: 0, witness: "did:key:W1" });
const h1 = await obs({ task_id: "atask", seq: 1, from: "did:key:B", to: "did:key:C", prev: h0.evidence_id, witness: "did:key:W2" });
await post(h0); await post(h1);

ok("2 observations enqueued to the pending pool", (await listLen("nenrin:tw:pending:")) === 2);
ok("nothing anchored yet", (await listLen("nenrin:tw:anchored:")) === 0);
ok("pending pool is disjoint from the task index (no collision)", (await listLen("nenrin:task:atask:")) === 2 && (await listLen("nenrin:tw:pending:")) === 2);

const a = await anchorTaskWitnessPool(env, "https://x", "operator");
ok("anchor -> 201 + anchored 2 + entry n", a.status === 201 && a.body.anchored === 2 && typeof a.body.n === "number");
ok("pending pool now empty", (await listLen("nenrin:tw:pending:")) === 0);
ok("both observations moved to anchored", (await listLen("nenrin:tw:anchored:")) === 2);

const entry = JSON.parse(await env.LEDGER.get("entry:" + a.body.n));
const batch = JSON.parse(entry.record_canonical);
ok("real ledger entry (v0-plain, unstamped, claim hash present)", entry.schema === "v0-plain" && entry.ots_status === "unstamped" && typeof entry.claim_sha256 === "string");
ok("claim_sha256 == sha256(record_canonical) (recompute)", (await sha256hex(entry.record_canonical)).toLowerCase() === entry.claim_sha256);
ok("batch = nenrin-task-witness-batch-v1 listing both evidence_ids",
   batch.schema === "nenrin-task-witness-batch-v1" && batch.count === 2 &&
   batch.records.map((r) => r.evidence_id).sort().join() === [h0.evidence_id, h1.evidence_id].sort().join());
ok("batch records carry attribution flags (witness_id, verdict, sig booleans)",
   batch.records.every((r) => typeof r.witness_id === "string" && typeof r.verdict === "string" && typeof r.witness_sig === "boolean" && typeof r.edge_sig === "boolean"));

const a2 = await anchorTaskWitnessPool(env, "https://x", "operator");
ok("empty pool -> anchored 0 (no wasted entry)", a2.status === 200 && a2.body.anchored === 0);

await post(h0);
ok("re-post of already-anchored evidence does NOT re-enqueue", (await listLen("nenrin:tw:pending:")) === 0);

const g = await handleTaskWitness("/witness/task", { method: "GET" }, new URL("https://x/witness/task?task_id=atask"), env);
const gb = JSON.parse(await g.text());
ok("GET still serves the task + carries the anchoring note", gb.hops_observed === 2 && typeof gb.anchoring === "string" && gb.anchoring.indexOf("nenrin-task-witness-batch-v1") >= 0);

async function ev(eid) { const r = await handleTaskEvidence("/witness/task/evidence/" + eid, { method: "GET" }, new URL("https://x/witness/task/evidence/" + eid), env); return r === null ? { isNull: true } : { status: r.status, body: JSON.parse(await r.text()) }; }
{ const e = await ev(h0.evidence_id); ok("evidence GET: anchored h0 reports ledger_entry + attribution + recompute_ok", e.status === 200 && e.body.status === "anchored" && e.body.anchored && typeof e.body.anchored.ledger_entry === "number" && e.body.recompute_ok === true && e.body.task_id === "atask" && e.body.verdict === "PASS"); }
{ const e = await ev("0".repeat(64)); ok("evidence GET: unknown evidence -> 404 not_found (a pin naming no evidence is a claim)", e.status === 404 && e.body.error === "not_found"); }
{ const e = await ev("nothex"); ok("evidence GET: malformed id -> 400", e.status === 400); }
const h2 = await obs({ task_id: "btask", seq: 0, witness: "did:key:W3" });
await post(h2);
{ const e = await ev(h2.evidence_id); ok("evidence GET: fresh obs -> pending (enqueued, not yet anchored)", e.status === 200 && e.body.status === "pending" && e.body.anchored === null); }

// ---- record-privacy-v1: a commitment is anchored as its evidence_id alone ----
{
  const c0 = await obs({ task_id: "secret-task", seq: 0, verdict: "FAIL", witness: "did:key:W4" });
  const r = await handleTaskWitness("/witness/task", { method: "POST", text: async () => JSON.stringify(c0) }, null, env);
  const rb = JSON.parse(await r.text());
  ok("C1 no consent -> commitment", rb.stored === "commitment");
  const a3 = await anchorTaskWitnessPool(env, "https://x", "operator");
  const b3 = JSON.parse(JSON.parse(await env.LEDGER.get("entry:" + a3.body.n)).record_canonical);
  const rec = b3.records.find((x) => x.evidence_id === c0.evidence_id);
  ok("C2 the batch lists the commitment as evidence_id + commitment:true and nothing else", rec && Object.keys(rec).sort().join() === "commitment,evidence_id" && rec.commitment === true);
  ok("C3 the batch bytes never name the task, the parties, the witness or the verdict", !JSON.stringify(b3).includes("secret-task") && !JSON.stringify(b3).includes(c0.hop.from) && !JSON.stringify(b3).includes("did:key:W4"));
  const anch = JSON.parse(await env.LEDGER.get("nenrin:tw:anchored:" + c0.evidence_id));
  ok("C4 the anchored record keeps no observation", anch.obs === null && anch.commitment === true);
  const e = await ev(c0.evidence_id);
  ok("C5 evidence GET: anchored commitment_only with its ledger entry", e.status === 200 && e.body.commitment_only === true && e.body.status === "anchored" && e.body.anchored.ledger_entry === a3.body.n && e.body.task_id === undefined);
  const r2 = await handleTaskWitness("/witness/task", { method: "POST", text: async () => JSON.stringify(consented(c0)) }, null, env);
  ok("C6 published later with both consents: served, not re-enqueued (the anchored commitment already fixes its time)", JSON.parse(await r2.text()).stored === "public" && !(await env.LEDGER.get("nenrin:tw:pending:" + c0.evidence_id)));
  const e2 = await ev(c0.evidence_id);
  ok("C7 evidence GET then recomputes and still reports the anchor", e2.body.recompute_ok === true && e2.body.status === "anchored" && e2.body.verdict === "FAIL");
}

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (task-witness anchor)");
process.exit(fails ? 1 : 0);
