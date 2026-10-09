// test/redteam_20261009.test.mjs : regressions for the internal red team of 2026-10-09 that touch the ledger worker.
//   R1-1 a key rotated at key_url takes effect at once: the stolen old key is refused, the new key is accepted.
//   R1-7 a small-order key cannot make a record "signed" (R = identity, S = 0 verifies every message under it).
//   R3-2 the nightly batch takes the oldest submissions first, from the whole pool (past the 1000-key list page),
//        and keeps batching until the pool is empty.
// Run: node test/redteam_20261009.test.mjs   (offline)
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { loadWorker, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger red team 2026-10-09");
const ORIGIN = "https://ledger.horizonshield.dev";

// A KV that behaves like Workers KV on list: sorted keys, pages of at most 1000, a cursor.
function pagedKV(entries = []) {
  const store = new Map(entries);
  return {
    store,
    binding: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, String(v)); },
      delete: async (k) => { store.delete(k); },
      list: async (opt = {}) => {
        const all = [...store.keys()].filter((k) => k.startsWith(opt.prefix || "")).sort();
        const start = opt.cursor ? Number(opt.cursor) : 0, lim = Math.min(opt.limit || 1000, 1000);
        const page = all.slice(start, start + lim);
        const done = start + lim >= all.length;
        return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + lim) };
      },
    },
  };
}
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return { privateKey, pub_b64: Buffer.from(der.subarray(der.length - 32)).toString("base64") };
}
const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
const SHA = "a".repeat(64);
const walk = (walkedAt, witness) => ({
  schema: "jidec-path-v1", purpose: "a2a-conduct-walk-v1: https://mcp.horizonshield.dev/mcp", walked_at: walkedAt, base: "https://mcp.horizonshield.dev",
  witness, mode: "full",
  nodes: [{ id: "n0", kind: "fetch", request: { url: "https://mcp.horizonshield.dev/.well-known/agent-card.json", method: "GET" }, response: { status: 200, body_sha256: SHA } }],
  assertions: [{ claim: "card_bytes_stable", op: "eq", result: true, evidence_nodes: ["n0"] }],
  verdict: { ok: true, outcome: "PASS", n_pass: 1, n_total: 1 },
  establishes: ["card fetched"], does_not_establish: ["correctness or quality of any response", "truth of the compensation declaration", "identity of the witness beyond the name given"],
});
let kv = pagedKV([["seq", "40"]]);
let env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
async function post(rec, key, sigB64) {
  const record_canonical = canon(rec);
  const body = { record_canonical };
  if (key) { body.public_key_ed25519_b64 = key.pub_b64; body.signature_ed25519_b64 = sigB64 || edSign(null, Buffer.from(record_canonical, "utf8"), key.privateKey).toString("base64"); }
  const res = await worker.fetch(new Request(ORIGIN + "/witness", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) }), env);
  return { status: res.status, j: await res.json() };
}

// R1-1: rotation takes effect at once.
const OLD = keypair(), NEW = keypair();
const KU = "https://victim.example/keys/witness.json";
let served = OLD.pub_b64, fetches = 0;
globalThis.fetch = async (url) => {
  if (String(url) === KU) { fetches++; return new Response(JSON.stringify({ public_key_ed25519_b64: served }), { status: 200 }); }
  return new Response("nope", { status: 404 });
};
const wit = { name: "Victim", vantage: "test", key_url: KU };
let r = await post(walk("2026-10-09T01:00:00Z", wit), OLD);
chk("R1-1 honest record under the served key accepted", r.status === 201 && r.j.signed_domain === "victim.example", JSON.stringify(r.j));
served = NEW.pub_b64;   // the owner rotates
r = await post(walk("2026-10-09T01:01:00Z", wit), OLD);
chk("R1-1 a record signed with the stolen old key is refused right after the rotation", r.status === 422 && r.j.reason_code === "key_url_mismatch", JSON.stringify(r.j));
r = await post(walk("2026-10-09T01:02:00Z", wit), NEW);
chk("R1-1 the owner's new key is accepted right after the rotation", r.status === 201 && r.j.signed_domain === "victim.example", JSON.stringify(r.j));
chk("R1-1 the key was fetched for every submission (no cached answer)", fetches === 3, String(fetches));

// R1-7: a small-order key cannot sign.
const IDENTITY = Buffer.from("0100000000000000000000000000000000000000000000000000000000000000", "hex").toString("base64");
const R0S0 = Buffer.concat([Buffer.from("0100000000000000000000000000000000000000000000000000000000000000", "hex"), Buffer.alloc(32)]).toString("base64");
r = await post(walk("2026-10-09T01:03:00Z", { name: "Nobody", vantage: "test" }), { pub_b64: IDENTITY }, R0S0);
chk("R1-7 identity key with R = identity, S = 0 is not a signature", r.status === 422 && r.j.reason_code === "signature_invalid", JSON.stringify(r.j));

// R3-2: oldest first, whole pool, until empty.
kv = pagedKV([["seq", "40"]]); env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
const pend = (sha, at) => kv.store.set("wit:pending:" + sha, JSON.stringify({ sha, purpose: "p", witness_name: "w", vantage: "v", signed: false, submitted_at: at, record_canonical: "{}" }));
const victim = "f" + "0".repeat(63);
pend(victim, "2026-10-01T00:00:00Z");                               // oldest, highest sha
for (let i = 0; i < 1100; i++) pend(i.toString(16).padStart(64, "0"), "2026-10-08T00:00:00." + String(i).padStart(3, "0") + "Z");
globalThis.fetch = async () => new Response("{}", { status: 404 });
const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(" "));
try { await worker.scheduled({}, env, { waitUntil() {} }); } finally { console.log = origLog; }
const batches = [...kv.store.keys()].filter((k) => k.startsWith("entry:")).map((k) => JSON.parse(kv.store.get(k))).filter((e) => /witness batch/.test(e.work)).sort((a, b) => a.n - b.n);
const first = batches.length ? JSON.parse(batches[0].record_canonical).records.map((x) => x.sha) : [];
chk("R3-2 the oldest record (highest sha) is in the first batch", first.includes(victim), "first batch has " + first.length);
chk("R3-2 five batches a night take the 1000 oldest of 1101; 101 wait for the next night", batches.length === 5 && [...kv.store.keys()].filter((k) => k.startsWith("wit:pending:")).length === 101, batches.length + " batches, " + [...kv.store.keys()].filter((k) => k.startsWith("wit:pending:")).length + " left");
const res = await worker.fetch(new Request(ORIGIN + "/witness/pending"), env);
const pj = await res.json();
chk("R3-2 GET /witness/pending lists the whole remainder past one list page", pj.count === 101, String(pj.count));

process.exitCode = chk.done() ? 1 : 0;
