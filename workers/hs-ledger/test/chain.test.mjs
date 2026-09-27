// jidec-chain-v1 (2026-09-28): predecessor binding and head. Offline, real worker, mock KV.
// Why this exists: scored against VLC-1 the ledger was L0 (no predecessor binding, no head). These checks keep
// the binding honest: it recomputes by the published recipe, a removed or edited entry breaks it, it is
// reported rather than skipped, and the daily batch carries the head inside the bytes that get stamped.
import { createHash } from "node:crypto";
import { loadWorker, mockKV, checker } from "./load.mjs";
const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger chain v1");
const B = "https://hs-ledger.example.dev";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
// Python json.dumps(sort_keys=True, separators=(",",":")) over ASCII values: the VLC-1 canon
const canon = (o) => "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";

function entries(k) {
  const out = [];
  for (let n = 1; n <= k; n++) {
    const rc = JSON.stringify({ schema: "example", n });
    const e = { n, work: "w" + n, claim_sha256: sha(rc), record_canonical: rc, schema: "v0-plain", created_at: "2026-09-2" + (n % 10) + "T00:00:00.000Z", ots_status: "confirmed", bitcoin_block: 968000 + n };
    if (n === 2) delete e.created_at;                     // a legacy entry without created_at: omitted, never null
    out.push(e);
  }
  return out;
}
function kvOf(es) { return mockKV([["seq", String(es.length)], ...es.map((e) => ["entry:" + e.n, JSON.stringify(e)])]); }
function expectHead(es) {
  let prev = "0".repeat(64);
  for (const e of es) {
    const b = { n: e.n, claim_sha256: e.claim_sha256, prev_entry_sha256: prev };
    if (e.schema) b.schema = e.schema;
    if (e.created_at) b.created_at = e.created_at;
    prev = sha(canon(b));
  }
  return prev;
}
const go = async (env, path, init) => worker.fetch(new Request(B + path, init), env, { waitUntil() {} });

const es = entries(5);
let env = { LEDGER: kvOf(es).binding };
let r = await go(env, "/ledger/head");
let j = await r.json();
chk("head: 200, n = 5, recomputes by the published recipe (VLC-1 canon)", r.status === 200 && j.n === 5 && j.head === expectHead(es) && j.schema === "jidec-head-v1", JSON.stringify(j).slice(0, 200));
chk("head states what it does not establish", Array.isArray(j.does_not_establish) && j.does_not_establish.length === 2);

r = await go(env, "/ledger/export.jsonl");
const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
chk("export: one row per entry plus a head record at the end", lines.length === 6 && lines[5].schema === "jidec-head-v1" && lines[5].head === j.head);
let linked = true, prev = "0".repeat(64);
for (const row of lines.slice(0, 5)) {
  const { entry_sha256, ...body } = row;
  if (row.prev_entry_sha256 !== prev || sha(canon(body)) !== entry_sha256) linked = false;
  prev = entry_sha256;
}
chk("export: every row links to its predecessor and hashes to its entry_sha256", linked);
chk("export: an entry without created_at omits it (never null)", !("created_at" in lines[1]) && Object.values(lines[1]).every((v) => v !== null));

// attacks
const cut = es.filter((e) => e.n !== 3);
env = { LEDGER: mockKV([["seq", "5"], ...cut.map((e) => ["entry:" + e.n, JSON.stringify(e)])]).binding };
r = await go(env, "/ledger/head"); j = await r.json();
chk("attack: a removed entry breaks the chain at that n (409, reported, not skipped)", r.status === 409 && j.error === "chain_broken" && j.broken_at === 3, JSON.stringify(j));
const edited = entries(5); edited[1].claim_sha256 = sha("other");
env = { LEDGER: kvOf(edited).binding };
r = await go(env, "/ledger/head"); j = await r.json();
chk("attack: an edited claim_sha256 in the middle moves the head", j.head !== expectHead(es) && j.head === expectHead(edited));
env = { LEDGER: kvOf(es.slice(0, 4)).binding };
r = await go(env, "/ledger/head"); j = await r.json();
chk("attack: truncating the newest entry gives a different head at n = 4 (detectable against a held head)", j.n === 4 && j.head !== expectHead(es));

// the daily batch carries the head inside its anchored bytes
const kv = kvOf(es);
kv.store.set("wit:pending:" + "a".repeat(64), JSON.stringify({ sha: "a".repeat(64), purpose: "p", witness_name: "w", vantage: "v", signed: false }));
env = { LEDGER: kv.binding, LEDGER_ADMIN_TOKEN: "t".repeat(64) };
r = await go(env, "/witness/anchor", { method: "POST", headers: { "x-ledger-key": "t".repeat(64) } });
j = await r.json();
const batchEntry = JSON.parse(kv.store.get("entry:6") || "null");
const batch = batchEntry ? JSON.parse(batchEntry.record_canonical) : null;
chk("batch: record_canonical carries ledger_head of the entries before it (n = 5, same head)", batch && batch.ledger_head && batch.ledger_head.n === 5 && batch.ledger_head.entry_sha256 === expectHead(es), JSON.stringify(batch && batch.ledger_head));
env = { LEDGER: kv.binding };
r = await go(env, "/ledger/head"); j = await r.json();
chk("batch: after it, the head moves to n = 6 and still recomputes", r.status === 200 && j.n === 6);
process.exit(chk.done() ? 1 : 0);
