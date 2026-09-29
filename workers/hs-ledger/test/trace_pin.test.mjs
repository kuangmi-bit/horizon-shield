// test/trace_pin.test.mjs
// nenrin-trace-pin-v0 wired into the real worker: POST /evidence/trace through worker.fetch, the stored bytes at
// ?format=raw, the pending list, the daily scheduled() batch, the anchored view, the ledger entry the batch writes,
// and the chain head still walking after it. Records are signed here with a fresh Ed25519 key and a current iat,
// so nothing depends on the wall clock. Offline, KV mocked.
// Run: node test/trace_pin.test.mjs

import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";
import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger trace pin wiring");
const ORIGIN = "https://ledger.horizonshield.dev";
const sha = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object") return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const X = publicKey.export({ format: "jwk" }).x;
function record(i, iat = Math.floor(Date.now() / 1000) - 60) {
  const r = {
    eat_profile: "tag:agentrust-io.com,2026:trace-v0.2", iat,
    subject: "spiffe://example.org/agent/n" + i,
    model: { provider: "example", model_id: "m-" + i },
    runtime: { platform: "intel-tdx", measurement: "sha256:" + "ab".repeat(32) },
    policy: { bundle_hash: "sha256:" + "cd".repeat(32), enforcement_mode: "enforce" },
    data_class: "internal",
    build_provenance: { slsa_level: 2, digest: "sha256:" + "ef".repeat(32) },
    appraisal: { status: "affirming", verifier: "https://verifier.example/appraise" },
    cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: X } },
  };
  r.signature = edSign(null, Buffer.from(canonical(r), "utf8"), privateKey).toString("base64url");
  return r;
}
const kv = mockKV([]);
const env = { LEDGER: kv.binding };
const call = (path, init) => worker.fetch(new Request(ORIGIN + path, init), env, { waitUntil() {} });
const post = (body, ip = "203.0.113.7") => call("/evidence/trace", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify(body) });

const d = await (await call("/evidence/trace")).json();
chk("GET /evidence/trace describes itself with establishes and does_not_establish", d.schema === "nenrin-trace-pin-v0" && d.establishes.length >= 3 && d.does_not_establish.length >= 5);

const rec = record(1);
const r1 = await post({ record: rec });
const b1 = await r1.json();
chk("POST a valid record: 201 pending", r1.status === 201 && b1.status === "pending" && /^[0-9a-f]{64}$/.test(b1.sha), JSON.stringify(b1).slice(0, 200));
chk("the pinned sha is sha256 of the canonical form of the whole signed record", b1.sha === sha(canonical(rec)));
const r1b = await (await post({ record: rec })).json();
chk("the same record again is a dedup, not a second pin", r1b.dedup === true && r1b.sha === b1.sha);

const raw = await call("/evidence/trace/" + b1.sha + "?format=raw");
const rawBuf = Buffer.from(await raw.arrayBuffer());
chk("?format=raw serves bytes whose sha256 is the path", raw.status === 200 && sha(rawBuf) === b1.sha && raw.headers.get("x-record-sha256") === b1.sha);
const one = await (await call("/evidence/trace/" + b1.sha)).json();
chk("GET /evidence/trace/<sha>: pending, with thumbprint and the parsed record", one.status === "pending" && one.record && one.record.subject === rec.subject && typeof one.key_thumbprint === "string" && one.anchor === null);

const bad = { ...record(2) }; bad.subject = "spiffe://example.org/agent/forged";
const rb = await post({ record: bad });
const bb = await rb.json();
chk("a tampered record is 422 with reason_code signature_invalid, and nothing is stored", rb.status === 422 && bb.reason_code === "signature_invalid" && ![...kv.store.keys()].some((k) => k.includes("tpin:pending:") && k.endsWith(sha(canonical(bad)))));
const rf = await post({ record: record(3, Math.floor(Date.now() / 1000) + 3600) });
chk("a record postdated an hour is 422 iat_in_future", rf.status === 422 && (await rf.json()).reason_code === "iat_in_future");
const rn = await call("/evidence/trace", { method: "POST", headers: { "content-type": "application/json" }, body: "{\"nope\":1}" });
chk("a body without record is 400", rn.status === 400);
chk("a malformed sha path is 400, an unknown sha is 404",
  (await call("/evidence/trace/xyz")).status === 400 && (await call("/evidence/trace/" + "0".repeat(64))).status === 404);

let lastStatus = 0, accepted = 1;
for (let i = 10; i < 40 && lastStatus !== 429; i++) { const r = await post({ record: record(i) }, "198.51.100.9"); lastStatus = r.status; if (r.status === 201) accepted++; }
chk("per-network daily cap: the 21st record from one /24 is 429", lastStatus === 429 && accepted === 21, "accepted " + accepted);
const other = await post({ record: record(99) }, "192.0.2.44");
chk("another network is not held by that cap", other.status === 201);

const pend = await (await call("/evidence/trace/pending")).json();
chk("the pending list shows every accepted pin", pend.count === accepted + 1, "count " + pend.count);

const seqBefore = Number(kv.store.get("seq") || 0);
await worker.scheduled({}, env, { waitUntil() {} });
const seqAfter = Number(kv.store.get("seq") || 0);
chk("scheduled() wrote the TRACE batch and then one head checkpoint (other pools are empty)", seqAfter === seqBefore + 2, seqBefore + " -> " + seqAfter);
const traceN = seqBefore + 1;
const entry = JSON.parse(kv.store.get("entry:" + traceN));
const ckpt = JSON.parse(JSON.parse(kv.store.get("entry:" + seqAfter)).record_canonical);
chk("the checkpoint stamps the head of everything before it, including the TRACE batch", ckpt.schema === "nenrin-head-checkpoint-v1" && ckpt.ledger_head.n === traceN, JSON.stringify(ckpt).slice(0, 200));
const batch = JSON.parse(entry.record_canonical);
chk("the entry is a nenrin-trace-pin-batch-v0 whose sha256 is its claim", batch.schema === "nenrin-trace-pin-batch-v0" && sha(entry.record_canonical) === entry.claim_sha256 && entry.anchored_by === "schedule");
chk("the batch lists the first pin by sha, sorted, with iat and thumbprint", batch.records.some((x) => x.sha === b1.sha && x.iat === rec.iat) && batch.records.every((x, i, a) => i === 0 || a[i - 1].sha < x.sha));
chk("the pool is empty after the batch", (await (await call("/evidence/trace/pending")).json()).count === 0);
const after = await (await call("/evidence/trace/" + b1.sha)).json();
chk("GET /evidence/trace/<sha> now says anchored and names the ledger entry", after.status === "anchored" && after.anchor && after.anchor.ledger_entry === traceN && after.anchor.batch_sha256 === entry.claim_sha256);
const raw2 = Buffer.from(await (await call("/evidence/trace/" + b1.sha + "?format=raw")).arrayBuffer());
chk("the served bytes are unchanged after anchoring", sha(raw2) === b1.sha);
const head = await (await call("/ledger/head")).json();
chk("the chain head walks through the new entry (jidec-chain-v1 not broken)", head && head.n === seqAfter && !head.broken_at, JSON.stringify(head).slice(0, 160));
await worker.scheduled({}, env, { waitUntil() {} });
chk("a second scheduled() with empty pools writes nothing (the last entry is already a checkpoint)", Number(kv.store.get("seq") || 0) === seqAfter);
chk("an existing route is untouched (GET /witness still answers)", (await call("/witness")).status === 200);

process.exit(chk.done() ? 1 : 0);
