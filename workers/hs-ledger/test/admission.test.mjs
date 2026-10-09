// test/admission.test.mjs
// Drives the LIVE worker (src/worker.js) through /admission and /revocation, with the real AgreementDedupeDO behind a
// mock Durable Object namespace, a mock KV, and a stubbed global fetch that serves the keys. The records are the ones
// the Python reference wrote (nenrin/musubi-v0/fixtures/admission_intake/cases.json). This proves the wiring: the
// import chain resolves, the routes dispatch, the same store deduplicates, the daily batch picks the records up, and
// nothing in the worker renders a decision of its own.
//
// Run: node test/admission.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";
import { loadWorker, mockKV } from "./load.mjs";
import { AgreementDedupeDO } from "../nenrin/agreement-v0/agreement_intake.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://ledger.horizonshield.dev";
const C = JSON.parse(readFileSync(path.join(HERE, "..", "nenrin", "musubi-v0", "fixtures", "admission_intake", "cases.json"), "utf8"));
const worker = await loadWorker("src/worker.js");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) { pass++; console.log("ok   " + name); } else { fail++; console.log("NG   " + name + (detail !== undefined ? "   <<< " + (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300)) : "")); } };

function fakeState() {
  const map = new Map(); let chain = Promise.resolve();
  return { storage: { get: async (k) => (map.has(k) ? map.get(k) : undefined), put: async (k, v) => { map.set(k, v); }, delete: async (k) => { map.delete(k); } },
           blockConcurrencyWhile: (fn) => { const r = chain.then(() => fn()); chain = r.catch(() => {}); return r; } };
}
function mockDO() {
  const insts = new Map();
  return { idFromName: (name) => name, get: (id) => { if (!insts.has(id)) insts.set(id, new AgreementDedupeDO(fakeState())); const d = insts.get(id); return { fetch: (u, init) => d.fetch(new Request(u, init)) }; } };
}
let SERVE = true; const fetched = [];
globalThis.fetch = async (url) => {
  const u = String(url); fetched.push(u);
  if (!SERVE) throw new Error("connection refused");
  const KEYS = { [C.relying_party.key_url]: C.relying_pub_b64, [C.principal_key_url]: C.principal_pub_b64 };
  if (u in KEYS) return new Response(JSON.stringify({ public_key_ed25519_b64: KEYS[u] }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("not found", { status: 404 });
};
let kv, env;
function reset() { kv = mockKV([["seq", "40"]]); env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64), AGREEMENT_DEDUPE_DO: mockDO() }; SERVE = true; fetched.length = 0; }
const call = async (method, p, body, headers) => {
  const r = await worker.fetch(new Request(ORIGIN + p, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  let j = null; try { j = await r.json(); } catch (_e) {}
  return { status: r.status, j, headers: r.headers };
};

reset();
let r = await call("GET", "/admission");
t("GET /admission: 200, names both schemas and what the intake does not do", r.status === 200 && r.j.schemas.join() === "a2a-admission-v0,a2a-revocation-v0" && r.j.what_this_does_not_do.length === 3, r.j);

r = await call("POST", "/admission", { record_canonical: C.admission_public });
t("POST /admission: 201, accepted, pending_anchor", r.status === 201 && r.j.verdict === "accepted" && r.j.status === "pending_anchor", r);
t("POST /admission: canonical_sha256 and admission_sha256 are the values Python computes", r.j.canonical_sha256 === sha(C.admission_public) && r.j.admission_sha256 === C.admission_public_sha256);
t("the worker fetched one key, the relying party's own key_url", fetched.length === 1 && fetched[0] === C.relying_party.key_url, fetched);
r = await call("GET", "/admission/" + sha(C.admission_public));
t("GET /admission/{sha}: the exact bytes", r.status === 200 && r.j.record_canonical === C.admission_public && sha(r.j.record_canonical) === r.j.canonical_sha256);
r = await call("POST", "/admission", { record_canonical: C.admission_public });
t("POST again: 200, deduplicated by the Durable Object", r.status === 200 && r.j.dedup === true, r);
r = await call("POST", "/admission", { record_canonical: C.admission_private });
t("an admission without signed consent to publication: 422, nothing served", r.status === 422 && r.j.refusals[0] === "publication_consent_missing" && (await call("GET", "/admission/" + sha(C.admission_private))).status === 404, r);
r = await call("POST", "/admission", { record_canonical: C.admission_signed_by_contractor });
t("an admission the applicant signed itself: 422 bad_signature", r.status === 422 && r.j.refusals[0] === "bad_signature", r);

r = await call("POST", "/revocation", { record_canonical: C.revocation_grant, contract_canonical: C.contract_canonical });
t("POST /revocation: 201, the principal's revocation of the grant", r.status === 201 && r.j.report.revokes === "grant", r);
r = await call("GET", "/revocation/" + sha(C.revocation_grant));
t("GET /revocation/{sha}: the exact bytes; the contract is not stored", r.status === 200 && r.j.record_canonical === C.revocation_grant && !JSON.stringify(r.j).includes("authorized_actions"));
r = await call("POST", "/revocation", { record_canonical: C.revocation_by_contractor, contract_canonical: C.contract_canonical });
t("a revocation the contractor signed: 422 bad_signature", r.status === 422 && r.j.refusals[0] === "bad_signature", r);
t("GET /admission/{sha of a revocation}: 404 (the two do not serve each other)", (await call("GET", "/admission/" + sha(C.revocation_grant))).status === 404);

// the daily batch the agreement intake already runs picks both up
r = await call("GET", "/agreement/pending");
const pend = (r.j.pending || []).map((x) => x.record_schema).sort();
t("the pending pool lists the admission and the revocation by schema", r.status === 200 && pend.join() === "a2a-admission-v0,a2a-revocation-v0", r.j);
r = await call("POST", "/agreement/anchor", undefined, { "x-ledger-key": "t".repeat(64) });
t("the existing batch anchors them: one ledger entry for the pool", r.status === 200 || r.status === 201, r);
r = await call("GET", "/admission/" + sha(C.admission_public));
t("after the batch the admission reads anchored, with its ledger entry", r.status === 200 && r.j.status === "anchored" && typeof r.j.ledger_entry === "number", r.j && { status: r.j.status, ledger_entry: r.j.ledger_entry });

// key server down: an unanswered question, never a verdict
reset(); SERVE = false;
r = await call("POST", "/admission", { record_canonical: C.admission_public });
t("key server unreachable: 503 with retry-after, nothing stored", r.status === 503 && r.headers.get("retry-after") === "30" && (await call("GET", "/admission/" + sha(C.admission_public))).status === 404, r);
// dedupe gate unbound: fail closed
reset(); delete env.AGREEMENT_DEDUPE_DO;
r = await call("POST", "/admission", { record_canonical: C.admission_public });
t("Durable Object not bound: 503, fail closed", r.status === 503 && r.j.error === "dedupe_gate_unbound", r);

console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (admission routes on the live worker)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (admission and revocation routes on the live worker)");
