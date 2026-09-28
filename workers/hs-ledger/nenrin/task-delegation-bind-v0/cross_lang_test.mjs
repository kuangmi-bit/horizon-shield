// cross_lang_test.mjs : proves the Python producer (task_witness_emit.py) and the JS ledger face
// (task_ledger_v0.mjs) agree on evidence_id byte-for-byte. Python-produced observations are fed into the
// JS ledger POST handler; every one must be ACCEPTED (200), which means the JS recompute equals the Python
// evidence_id. If canonical() differed across languages by a single byte, the JS R2 check would 422.
// Run: python3 task_witness_emit.py > obs.json && node cross_lang_test.mjs
import { readFileSync } from "node:fs";
import { handleTaskWitness, evidenceId } from "./task_ledger_v0.mjs";

const observations = JSON.parse(readFileSync(new URL("./obs.json", import.meta.url), "utf8"));

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const env = { LEDGER: kv() };
function req(o) { return { method: "POST", json: async () => o, text: async () => JSON.stringify(o) }; }
function urlFor(qs) { return new URL("https://x/witness/task?" + qs); }
let fails = 0;
const ok = (n, c) => { console.log((c ? "  ok   " : "  FAIL ") + n); if (!c) fails++; };
async function post(o) { const r = await handleTaskWitness("/witness/task", req(o), null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function get(qs) { const r = await handleTaskWitness("/witness/task", { method: "GET" }, urlFor(qs), env); return { status: r.status, body: JSON.parse(await r.text()) }; }

console.log("cross-lang: Python producer output -> JS ledger (" + observations.length + " observations)");

let accepted = 0;
for (const o of observations) {
  const p = await post(o);
  const match = p.status === 200 && p.body.evidence_id === o.evidence_id;
  ok("accept " + o.task_id + " hop" + o.hop.seq + " " + o.witness_id + "  (200 and evidence_id matches => cross-lang byte match)", match);
  if (match) accepted++;
}
ok("all " + observations.length + " python observations accepted by JS ledger", accepted === observations.length);

// record-privacy-v1: the Python demo parties are placeholder did:keys that cannot sign consent, so the ledger keeps
// each as a commitment and serves nothing by task_id. The byte match above is the cross-language claim; linkage is
// checked directly on the Python bytes, and aggregation (R3, R4) is language independent and covered in
// task_ledger_selftest.mjs with consenting parties.
const stored = [];
for (const o of observations) stored.push((await post(o)).body.stored);
ok("placeholder parties cannot consent: every observation is kept as a commitment", stored.every((x) => x === "commitment"));
{ const t2 = observations.filter((o) => o.task_id === "prod-t2").sort((a, b) => a.hop.seq - b.hop.seq);
  ok("prod-t2 hop1.prev_evidence_id (Python) equals the JS evidence_id of hop0 (cross-lang linkage, R3)", t2.length === 2 && t2[1].prev_evidence_id === (await evidenceId(t2[0]))); }
{ const g = await get("task_id=prod-t2"); ok("nothing is served by task_id for a commitment", g.body.hops_observed === 0); }

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (cross-lang producer <-> ledger)");
process.exit(fails ? 1 : 0);
