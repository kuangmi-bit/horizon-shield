// task_ledger_selftest.mjs : offline test of the additive /witness/task ledger face.
// Uses an in-memory KV mock and Web Crypto (global crypto.subtle, present in Node 20+ and in Workers).
// No network, no live ledger. Run: node task_ledger_selftest.mjs
import { evidenceId, handleTaskWitness } from "./task_ledger_v0.mjs";
// record-privacy-v1: parties are real did:keys and both consent by default, so these cases exercise publication as before;
// the commitment-only path has its own cases in task_ledger_selftest.mjs.
import { D, consented, consentEntry, newParty } from "./consent_testkit.mjs";
import { handleTaskEvidence, CONSENT_PURPOSE } from "./task_ledger_v0.mjs";

function kv() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
  };
}
const ENV = () => ({ LEDGER: kv() });

async function obs({ task_id = "t1", seq = 0, from = "did:key:A", to = "did:key:B", prev = null, verdict = "PASS", witness = "did:key:W1" }) {
  const o = { task_id, hop: { seq, from: D(from), to: D(to) }, prev_evidence_id: prev, conduct: { verdict, detail_ref: null }, witness_id: D(witness), observed_at: "2026-09-16T00:00:00Z" };
  o.evidence_id = await evidenceId(o);
  return o;
}
function req(method, body) { return { method, json: async () => body, text: async () => JSON.stringify(body) }; }
function urlFor(qs) { return new URL("https://ledger.horizonshield.dev/witness/task?" + qs); }

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) fails++; };
async function post(env, o) { const r = await handleTaskWitness("/witness/task", req("POST", consented(o)), null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function get(env, qs) { const r = await handleTaskWitness("/witness/task", { method: "GET" }, urlFor(qs), env); return { status: r.status, body: JSON.parse(await r.text()) }; }

console.log("task-delegation-bind-v0 : ledger face selftest (Web Crypto)");

{
  const env = ENV();
  const o = await obs({ task_id: "t1", verdict: "PASS" });
  const p = await post(env, o);
  ok("1 post accepted (200)", p.status === 200 && p.body.ok === true);
  ok("1 evidence_id echoed matches recompute", p.body.evidence_id === o.evidence_id);
  const g = await get(env, "task_id=t1");
  ok("1 get one hop", g.body.hops_observed === 1 && g.body.hops[0].verdict === "PASS" && g.body.hops[0].witnesses === 1);
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t2", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "t2", verdict: "PASS", witness: "did:key:W2" }));
  const g = await get(env, "task_id=t2");
  ok("2 agree -> PASS", g.body.hops[0].verdict === "PASS" && g.body.hops[0].witnesses === 2 && g.body.hops[0].evidence_ids.length === 2);
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t3", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "t3", verdict: "FAIL", witness: "did:key:W2" }));
  const g = await get(env, "task_id=t3");
  ok("3 disagree -> disagreement (R4)", g.body.hops[0].verdict === "disagreement" && g.body.hops[0].witnesses === 2);
}

{
  const env = ENV();
  const o = await obs({ task_id: "t4" });
  o.evidence_id = "0".repeat(64);
  const p = await post(env, o);
  ok("4 tampered evidence_id -> 422 recompute_mismatch (R2)", p.status === 422 && p.body.error === "recompute_mismatch");
}

{
  const env = ENV();
  const o = await obs({ task_id: "t4b", verdict: "PASS" });
  o.conduct.verdict = "FAIL";
  const p = await post(env, o);
  ok("4b post-stamp field tamper -> 422 (R2)", p.status === 422 && p.body.error === "recompute_mismatch");
}

{
  const env = ENV();
  const o = await obs({ task_id: "t5", from: "did:key:A", witness: "did:key:A" });
  const p = await post(env, o);
  ok("5 self-witness -> 422 witness_not_independent (R1)", p.status === 422 && p.body.error === "witness_not_independent");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t6", seq: 0, from: "did:key:A", to: "did:key:B", prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t6", seq: 1, from: "did:key:B", to: "did:key:C", prev: h0.evidence_id, witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t6");
  ok("6 two hops observed", g.body.hops_observed === 2);
  ok("6 chain continuous true (R3)", g.body.chain_continuous === true);
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t7", seq: 0, prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t7", seq: 1, from: "did:key:B", to: "did:key:C", prev: "deadbeef", witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t7");
  ok("7 broken link -> chain false (R3)", g.body.chain_continuous === false && g.body.chain_reason === "broken_link");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t8", seq: 0, prev: null, witness: "did:key:W1" });
  const h2 = await obs({ task_id: "t8", seq: 2, prev: "whatever", witness: "did:key:W3" });
  await post(env, h0); await post(env, h2);
  const g = await get(env, "task_id=t8");
  ok("8 seq gap -> chain false (R3)", g.body.chain_continuous === false && g.body.chain_reason === "seq_gap");
}

{
  const env = ENV();
  await post(env, await obs({ task_id: "t9", verdict: "PASS", witness: "did:key:W1" }));
  await post(env, await obs({ task_id: "other", verdict: "FAIL", witness: "did:key:W9" }));
  const g = await get(env, "task_id=t9");
  ok("9 cross-task isolation", g.body.hops_observed === 1 && g.body.hops[0].verdict === "PASS");
}

{
  const env = ENV();
  const h0 = await obs({ task_id: "t10", seq: 0, prev: null, witness: "did:key:W1" });
  const h1 = await obs({ task_id: "t10", seq: 1, prev: h0.evidence_id, witness: "did:key:W2" });
  await post(env, h0); await post(env, h1);
  const g = await get(env, "task_id=t10&hop=1");
  ok("10 hop filter returns only seq 1", g.body.hops.length === 1 && g.body.hops[0].hop_seq === 1);
}

{
  const env = ENV();
  const p = await post(env, { task_id: "t11" });
  ok("11 missing hop -> 400 hop_missing", p.status === 400 && p.body.error === "hop_missing");
}

{
  const env = ENV();
  const r = await handleTaskWitness("/witness/task", { method: "GET" }, new URL("https://x/witness/task"), env);
  ok("12 get without task_id -> 400", r.status === 400);
}

// 10. strict parse at the ledger door: duplicate keys, floats, unsafe integers and non-ASCII keys are refused
//     before anything is hashed (SPEC.md "Canonical form, pinned"); a clean record still lands
{
  const env = ENV();
  const o = await obs({ task_id: "t10", verdict: "PASS" });
  const clean = JSON.stringify(o);
  const raw = async (text) => { const r = await handleTaskWitness("/witness/task", { method: "POST", text: async () => text }, null, env); return { status: r.status, body: JSON.parse(await r.text()) }; };
  const dup = clean.replace('"task_id":"t10"', '"task_id":"t10","task_id":"t10"');
  const flt = clean.replace('"seq":0', '"seq":0.0');
  const big = clean.replace('"seq":0', '"seq":9007199254740993');
  const key = clean.replace('"task_id"', '"task\u00e9id"');
  const d = await raw(dup), f = await raw(flt), b = await raw(big), k = await raw(key), c = await raw(clean);
  ok("10 duplicate key refused (400 duplicate_key)", d.status === 400 && d.body.error === "duplicate_key");
  ok("10 float refused (400 non_integer_number)", f.status === 400 && f.body.error === "non_integer_number");
  ok("10 unsafe integer refused (400 unsafe_number)", b.status === 400 && b.body.error === "unsafe_number");
  ok("10 non-ASCII key refused (400 key_not_printable_ascii)", k.status === 400 && k.body.error === "key_not_printable_ascii");
  ok("10 clean record still accepted (200)", c.status === 200 && c.body.ok === true);
}

// ---- record-privacy-v1: without both parties' consent the ledger keeps a commitment and nothing else ----
async function rawPost(env, o) { const r = await handleTaskWitness("/witness/task", req("POST", o), null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
async function evid(env, eid) { const r = await handleTaskEvidence("/witness/task/evidence/" + eid, { method: "GET" }, null, env); return { status: r.status, body: JSON.parse(await r.text()) }; }
function keysOf(env) { return env.LEDGER.list({ prefix: "" }).then((l) => l.keys.map((k) => k.name)); }
{
  const env = ENV();
  const o = await obs({ task_id: "private-1", verdict: "FAIL" });
  const p = await rawPost(env, o);
  ok("P1 no consent -> 200 stored commitment, consent missing from both", p.status === 200 && p.body.stored === "commitment" && p.body.consent_missing_from === "both parties" && p.body.evidence_id === o.evidence_id);
  ok("P1 the response carries no task, party, witness or verdict", !JSON.stringify(p.body).includes("private-1") && !JSON.stringify(p.body).includes(o.hop.from) && !JSON.stringify(p.body).includes("FAIL") && !JSON.stringify(p.body).includes("did:key:W1"));
  // the daily cap counters (2026-10-08) hold a UTC day and a count, keyed by a digest of the source address; they name nothing in the observation
  const keys = (await keysOf(env)).filter((k) => !k.startsWith("nenrin:tw:cap:"));
  ok("P1 kv holds only the commitment and the pending commitment", keys.length === 2 && keys.includes("nenrin:task:commit:" + o.evidence_id) && keys.includes("nenrin:tw:pending:" + o.evidence_id));
  const stored = JSON.stringify(await Promise.all(keys.map((k) => env.LEDGER.get(k))));
  ok("P1 nothing stored names the task, the parties, the witness or the verdict", !stored.includes("private-1") && !stored.includes(o.hop.from) && !stored.includes(o.hop.to) && !stored.includes("did:key:W1") && !stored.includes("FAIL"));
  const g = await get(env, "task_id=private-1");
  ok("P1 GET /witness/task shows nothing for the task", g.body.hops_observed === 0);
  const e = await evid(env, o.evidence_id);
  ok("P1 evidence GET says commitment_only, recompute_ok null, no content", e.status === 200 && e.body.commitment_only === true && e.body.recompute_ok === null && e.body.task_id === undefined && e.body.verdict === undefined && e.body.status === "pending");
  // one party consents: still a commitment, and it says which party is missing
  const one = Object.assign({}, o, { consent: [consentEntry(o, o.hop.from)] });
  const p1 = await rawPost(env, one);
  ok("P2 only hop.from consents -> commitment, missing hop.to", p1.body.stored === "commitment" && p1.body.consent_missing_from === "hop.to");
  // both consent later: published, same evidence_id, the earlier commitment still stands
  const p2 = await rawPost(env, consented(o));
  ok("P3 both consent later -> published, same evidence_id", p2.status === 200 && p2.body.stored === "public" && p2.body.evidence_id === o.evidence_id);
  const g2 = await get(env, "task_id=private-1");
  ok("P3 now served with its verdict", g2.body.hops_observed === 1 && g2.body.hops[0].verdict === "FAIL");
  const e2 = await evid(env, o.evidence_id);
  ok("P3 evidence GET now recomputes", e2.body.recompute_ok === true && e2.body.commitment_only === undefined);
  const pend = JSON.parse(await env.LEDGER.get("nenrin:tw:pending:" + o.evidence_id));
  ok("P3 the pending batch entry now carries the full observation", pend.task_id === "private-1" && pend.commitment === undefined);
  // re-posting without consent never downgrades a published observation
  const p3 = await rawPost(env, o);
  ok("P4 no-consent re-post after publication does not downgrade", p3.body.stored === "public" && p3.body.already === true && (await get(env, "task_id=private-1")).body.hops_observed === 1);
}
{
  const env = ENV();
  const o = await obs({ task_id: "private-2" });
  const bad = Object.assign({}, o, { consent: [consentEntry(o, o.hop.from), { party: o.hop.to, sig: consentEntry(o, o.hop.from).sig }] });
  const r1 = await rawPost(env, bad);
  ok("P5 a consent signed by the wrong party -> 422 consent_sig_invalid, nothing kept", r1.status === 422 && r1.body.error === "consent_sig_invalid" && (await keysOf(env)).length === 0);
  const stranger = newParty();
  const r2 = await rawPost(env, Object.assign({}, o, { consent: [consentEntry(o, o.hop.from), { party: stranger.did, sig: "AAAA" }] }));
  ok("P6 consent from someone who is not a hop party -> 422 consent_from_non_party", r2.status === 422 && r2.body.error === "consent_from_non_party");
  const other = await obs({ task_id: "private-3" });
  const replay = Object.assign({}, o, { consent: [consentEntry(o, o.hop.from, consentMessageFor(other)), consentEntry(o, o.hop.to, consentMessageFor(other))] });
  const r3 = await rawPost(env, replay);
  ok("P7 consent given for another task does not carry over -> 422", r3.status === 422 && r3.body.error === "consent_sig_invalid");
  const edgeMsg = JSON.stringify({ hop: { from: o.hop.from, seq: o.hop.seq, to: o.hop.to }, task_id: o.task_id });   // canonical({task_id, hop}), the exact edge_sig bytes
  const edgeAsConsent = Object.assign({}, o, { consent: [consentEntry(o, o.hop.from, edgeMsg), consentEntry(o, o.hop.to, edgeMsg)] });
  const r4 = await rawPost(env, edgeAsConsent);
  ok("P8 an edge_sig style message is not consent -> 422", r4.status === 422 && r4.body.error === "consent_sig_invalid");
  const r5 = await rawPost(env, Object.assign({}, o, { consent: "yes" }));
  ok("P9 consent that is not a list -> 422", r5.status === 422 && r5.body.error === "consent_not_a_list");
  const r6 = await rawPost(env, Object.assign({}, o, { consent: [{ party: o.hop.from }] }));
  ok("P10 consent entry without sig -> 422", r6.status === 422 && r6.body.error === "consent_entry_malformed");
  const nonDid = await obs({ task_id: "private-4", from: "agent-a", to: "agent-b" });
  const r7 = await rawPost(env, Object.assign({}, nonDid, { consent: [{ party: "agent-a", sig: "AAAA" }] }));
  ok("P11 a party that is not a did:key cannot consent -> 422", r7.status === 422 && r7.body.error === "consent_party_not_did_key");
  const r8 = await rawPost(env, nonDid);
  ok("P12 without did:keys the observation stays a commitment", r8.body.stored === "commitment");
  ok("P13 consent purpose is named", CONSENT_PURPOSE === "nenrin-task-publication-consent-v0");
}
{
  // class P: a party that is an https origin on a public host is a public surface and needs no consent (as a walk)
  const env = ENV();
  const a = await obs({ task_id: "pub-1", to: "https://api.agent.example" });
  const pa = await rawPost(env, Object.assign({}, a, { consent: [consentEntry(a, a.hop.from)] }));
  ok("P15 requester consents, counterparty is an https origin -> published", pa.body.stored === "public" && pa.body.publication_basis.from === "consent" && pa.body.publication_basis.to === "public_surface");
  const b = await obs({ task_id: "pub-2", to: "https://api.agent.example" });
  const pb = await rawPost(env, b);
  ok("P16 https counterparty but the did:key requester did not consent -> commitment, missing hop.from", pb.body.stored === "commitment" && pb.body.consent_missing_from === "hop.from");
  const c = await obs({ task_id: "pub-3", from: "https://a.agent.example", to: "https://b.agent.example" });
  ok("P17 two https origins -> published without consent", (await rawPost(env, c)).body.stored === "public");
  for (const [label, url] of [["localhost", "https://localhost:8443"], ["bare IP", "https://10.0.0.7"], ["plain http", "http://api.agent.example"], ["userinfo", "https://u:p@api.agent.example"], ["single label", "https://intranet"], ["IPv6", "https://[::1]"]]) {
    const d = await obs({ task_id: "pub-x-" + label, from: "https://a.agent.example", to: url });
    ok("P18 " + label + " is not a public surface -> commitment", (await rawPost(env, d)).body.stored === "commitment");
  }
}
{
  // known answer: the consent bytes are fixed by the spec, written out here independently of the implementation
  const env = ENV();
  const o = await obs({ task_id: "ka-1" });
  const msg = '{"hop":{"from":"' + o.hop.from + '","seq":0,"to":"' + o.hop.to + '"},"publication":"public","purpose":"nenrin-task-publication-consent-v0","task_id":"ka-1"}';
  const r = await rawPost(env, Object.assign({}, o, { consent: [consentEntry(o, o.hop.from, msg), consentEntry(o, o.hop.to, msg)] }));
  ok("P19 consent over the spec's exact bytes publishes (known answer)", r.body.stored === "public");
}
function consentMessageFor(o) { return JSON.stringify({ hop: { from: o.hop.from, seq: o.hop.seq, to: o.hop.to }, publication: "public", purpose: CONSENT_PURPOSE, task_id: o.task_id }); }
{
  // adding consent changes neither evidence_id nor the preimage
  const o = await obs({ task_id: "private-5" });
  ok("P14 consent is outside the evidence_id preimage", (await evidenceId(consented(o))) === o.evidence_id);
}

{
  // 2026-10-08 (FIX_LIST 5): caps on POST /witness/task
  const env = ENV();
  const big = { method: "POST", text: async () => "x".repeat(32769) };
  const rb = await handleTaskWitness("/witness/task", big, null, env);
  ok("C1 body over 32768 bytes -> 413 before parsing", rb.status === 413 && JSON.parse(await rb.text()).error === "too_large");
  const longTask = await obs({ task_id: "t".repeat(257) });
  const rl = await rawPost(env, longTask);
  ok("C2 task_id over 256 chars -> 400 field_too_long", rl.status === 400 && rl.body.error === "field_too_long" && rl.body.field === "task_id");
  const badSeq = await obs({ task_id: "seq-x", seq: 5000 });
  ok("C3 hop.seq out of 0..1000 -> 400", (await rawPost(env, badSeq)).body.field === "hop.seq");
  const day = new Date().toISOString().slice(0, 10);
  await env.LEDGER.put("nenrin:tw:cap:" + day, "2000");
  const fresh = await obs({ task_id: "cap-g", from: "https://a.agent.example", to: "https://b.agent.example" });
  const rg = await rawPost(env, fresh);
  ok("C4 global daily cap reached -> 429 and nothing stored", rg.status === 429 && rg.body.error === "daily_global_cap_reached" && !(await env.LEDGER.get("nenrin:task:obs:" + fresh.evidence_id)));
  const env2 = ENV();
  const first = await obs({ task_id: "cap-r", from: "https://a.agent.example", to: "https://b.agent.example" });
  ok("C5 a new observation is accepted and counted", (await rawPost(env2, first)).body.stored === "public" && (await env2.LEDGER.get("nenrin:tw:cap:" + day)) === "1");
  await env2.LEDGER.put("nenrin:tw:cap:" + day, "2000");
  ok("C6 a repeat of an observation already stored is not blocked by the cap", (await rawPost(env2, first)).status === 200);
  const thrower = { LEDGER: { get: async () => { throw new Error("boom"); }, put: async () => {}, list: async () => ({ keys: [] }) } };
  const r5 = await rawPost(thrower, first);
  ok("C7 internal error is a JSON 500 without a stack trace", r5.status === 500 && r5.body.stack === undefined);
}

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (task_ledger_v0, Web Crypto)");
process.exit(fails ? 1 : 0);
