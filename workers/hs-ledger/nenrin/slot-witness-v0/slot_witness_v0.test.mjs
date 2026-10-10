// slot_witness_v0.test.mjs: BIP-340 against its own test vectors and a real invinoveritas event, then the slot
// witness intake on a fake KV and a fake issuer endpoint: each verdict, no redirects, size cap, dedup, caps, the
// daily watch catching a changed listing, the per-slot history, and the batch oldest first.
// Offline. Run: node nenrin/slot-witness-v0/slot_witness_v0.test.mjs   (in workers/hs-ledger)   exit 1 on any failure.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { schnorrVerify, schnorrSign, hexToBytes, nostrEventCheck } from "./bip340.mjs";
import { ISSUERS, readReceipt, judge, handleSlotWitness, watchSlots, anchorSlotWitnessPool, BATCH_MAX, MAX_RESPONSE_BYTES, WATCH_DAYS } from "./slot_witness_v0.mjs";
import { Refusal } from "../trace-pin-v0/trace_pin_v0.mjs";
import { addTestIssuer, receipt, slotFetch, TEST_PUB, TEST_PREFIX, NOW } from "./fixtures/gen_fixtures.mjs";

const R = [];
const t = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: String(detail) });
const sha = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");
const HERE = new URL(".", import.meta.url).pathname;

// ---- BIP-340: the BIP's own vectors, and a real event the invinoveritas key signed ---------------------------
{
  const rows = readFileSync(HERE + "fixtures/bip340_test_vectors.csv", "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  // the BIP's file (bitcoin/bips bip-0340/test-vectors.csv, sha256 34c9d1d9..., CRLF line ends) with its line ends made LF,
  // because git am drops the CR; with every LF made CRLF again it is the BIP's bytes
  const csv = readFileSync(HERE + "fixtures/bip340_test_vectors.csv");
  t("bip340_test_vectors.csv is the BIP's file, line ends LF (sha256 01c8cabba63b4c9b2f44c975902990086a4fe56eee9d265b187d1e2c1d98ccfb), CRLF again gives the BIP's sha256 34c9d1d9...", sha(csv) === "01c8cabba63b4c9b2f44c975902990086a4fe56eee9d265b187d1e2c1d98ccfb" && sha(Buffer.from(csv.toString("latin1").replace(/\n/g, "\r\n"), "latin1")) === "34c9d1d9c3a88d524bc80778540dc43f8306ec249a7485293063c376db851c2d");
  let v = 0, s = 0, sTotal = 0;
  for (const [i, sk, pk, aux, msg, sig, res] of rows) {
    if ((await schnorrVerify(hexToBytes(pk), hexToBytes(msg), hexToBytes(sig))) === (res === "TRUE")) v++; else t("BIP-340 vector " + i, false, "verify disagrees");
    if (sk) { sTotal++; if (Buffer.from(await schnorrSign(hexToBytes(sk), hexToBytes(msg), hexToBytes(aux))).toString("hex").toUpperCase() === sig) s++; }
  }
  t("BIP-340 verify agrees with all " + rows.length + " test vectors (valid and invalid)", v === rows.length, v + "/" + rows.length);
  t("BIP-340 sign reproduces every vector that has a secret key", s === sTotal && sTotal > 0, s + "/" + sTotal);
  const real = JSON.parse(readFileSync(HERE + "fixtures/invinoveritas_event.json", "utf8")).event;
  const c = await nostrEventCheck(real);
  t("a real invinoveritas event: NIP-01 id recomputes and the BIP-340 signature verifies", c.ok && c.id === real.id, JSON.stringify(c));
  t("the same event with one character of content changed fails on the id", !(await nostrEventCheck({ ...real, content: real.content.replace("reject", "rejecT") })).ok);
  const flipped = real.sig.slice(0, 127) + (real.sig[127] === "0" ? "1" : "0");
  t("the same event with one bit of the signature changed fails", !(await nostrEventCheck({ ...real, sig: flipped })).ok);
  const r = await readReceipt(real).then(() => null, (e) => (e instanceof Refusal ? e.code : "THREW " + e.message));
  t("readReceipt on that real event (a verdict proof, no request_slot): the issuer key is read, the receipt is refused as no_request_slot", r === "no_request_slot", r);
}

addTestIssuer();
const SLOT = "a".repeat(64), SLOT2 = "b".repeat(64);
const evA = await receipt({ slot: SLOT });
const evA2 = await receipt({ slot: SLOT, created_at: NOW - 60, extra: { choice_commitment: "d".repeat(64) } });
const code = (p) => p.then(() => null, (e) => (e instanceof Refusal ? e.code : "THREW " + e.message));

// ---- readReceipt refusals ------------------------------------------------------------------------------------
{
  t("an unknown issuer key is refused by name", (await code(readReceipt({ ...evA, pubkey: "1".repeat(64) }))) === "issuer_not_read");
  t("a bad signature is refused", (await code(readReceipt({ ...evA, sig: "0".repeat(128) }))) === "bad_event");
  t("a non-object is refused", (await code(readReceipt("x"))) === "not_an_event");
  const noSlot = await receipt({ slot: null });
  t("a receipt with request_slot null is refused as no_request_slot", (await code(readReceipt(noSlot))) === "no_request_slot");
  const badSlot = await receipt({ slot: "../../admin?x=1" });
  t("a request_slot that is not URL-safe is refused", (await code(readReceipt(badSlot))) === "bad_request_slot");
  const rc = await readReceipt(evA);
  t("a good receipt yields its slot and content schema", rc.slot === SLOT && rc.content_schema === "invinoveritas.decision_receipt.v0");
}

// ---- judge: every verdict ------------------------------------------------------------------------------------
{
  const b = (o) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));
  const id = evA.id, other = evA2.id;
  const cases = [
    ["unique", judge(200, b({ slot: SLOT, taken: true, event_ids: [id] }), SLOT, id)],
    ["listed_with_others", judge(200, b({ slot: SLOT, taken: true, event_ids: [other, id] }), SLOT, id)],
    ["not_listed", judge(200, b({ slot: SLOT, taken: true, event_ids: [other] }), SLOT, id)],
    ["not_taken", judge(200, b({ slot: SLOT, taken: false, event_ids: [] }), SLOT, id)],
    ["slot_mismatch", judge(200, b({ slot: SLOT2, taken: true, event_ids: [id] }), SLOT, id)],
    ["unreadable", judge(404, b({}), SLOT, id)],
    ["unreadable", judge(200, b("[1,2]"), SLOT, id)],
    ["unreadable", judge(200, b({ slot: SLOT, taken: true, event_ids: "x" }), SLOT, id)],
    ["unreadable", judge(200, new Uint8Array([0xff, 0xfe]), SLOT, id)],
    ["fetch_failed", judge(null, new Uint8Array(0), SLOT, id)],
  ];
  for (const [want, got] of cases) t("judge: " + want, got.verdict === want, got.verdict);
  t("judge: taken true with an empty list is not_listed, never unique", judge(200, b({ slot: SLOT, taken: true, event_ids: [] }), SLOT, id).verdict === "not_listed");
  t("judge: the same id twice is listed_with_others, not unique", judge(200, b({ slot: SLOT, taken: true, event_ids: [id, id] }), SLOT, id).verdict === "listed_with_others");
}

// ---- the HTTP surface ----------------------------------------------------------------------------------------
function fakeEnv() {
  const m = new Map();
  return { m, LEDGER: {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", cursor } = {}) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0, page = all.slice(start, start + 1000);
      const done = start + 1000 >= all.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 1000) };
    },
  } };
}
const ORIGIN = "https://ledger.horizonshield.dev";
let listing = { [SLOT]: [evA.id], [SLOT2]: [] };
const seen = [];
const issuerFetch = slotFetch((slot, u) => { seen.push(u); return { slot, taken: (listing[slot] || []).length > 0, event_ids: listing[slot] || [] }; });
const call = async (env, method, path, body, now = NOW, ip = "203.0.113.7", f = issuerFetch) => {
  const url = new URL(ORIGIN + path);
  const req = new Request(url, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: body ? JSON.stringify(body) : undefined });
  const res = await handleSlotWitness(url.pathname, req, url, env, ORIGIN, now, f);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_e) {}
  return { status: res.status, json, text, headers: res.headers };
};

{
  const env = fakeEnv();
  const d = await call(env, "GET", "/evidence/slot");
  t("GET /evidence/slot describes the intake, its issuers and its limits", d.status === 200 && d.json.issuers_read.some((i) => i.name === "invinoveritas") && d.json.does_not_establish.length >= 4);
  t("the route ignores other paths", (await handleSlotWitness("/evidence/vouch", new Request(ORIGIN), new URL(ORIGIN), env, ORIGIN)) === null);
  const a = await call(env, "POST", "/evidence/slot", { event: evA });
  t("POST a receipt: 201, verdict unique, the ledger fetched the slot endpoint itself", a.status === 201 && a.json.verdict === "unique" && seen.at(-1) === TEST_PREFIX + SLOT, JSON.stringify(a.json).slice(0, 200));
  const raw = await call(env, "GET", "/evidence/slot/" + a.json.sha + "?format=raw");
  const obs = JSON.parse(raw.text);
  t("?format=raw serves the record bytes whose sha256 is the sha", sha(raw.text) === a.json.sha && raw.headers.get("x-record-sha256") === a.json.sha);
  t("the record keeps the response bytes and their sha256", sha(Buffer.from(obs.response_b64, "base64")) === obs.response_sha256 && obs.response_bytes === Buffer.from(obs.response_b64, "base64").length);
  t("the record carries the signed receipt itself and no previous observation", obs.receipt_event.id === evA.id && obs.previous_observation === null && obs.changed_since_previous === null);
  const again = await call(env, "POST", "/evidence/slot", { event: evA }, NOW + 3600);
  t("the same receipt again within 6 hours: dedup, no second fetch", again.status === 200 && again.json.dedup && again.json.sha === a.json.sha && seen.length === 1);
  const refused = await call(env, "POST", "/evidence/slot", { event: { ...evA, sig: "0".repeat(128) } });
  t("a bad signature: 422 refused with a reason code", refused.status === 422 && refused.json.reason_code === "bad_event");
  t("a body without event: 400", (await call(env, "POST", "/evidence/slot", { credential: 1 })).status === 400);
  t("PUT: 405", (await call(env, "PUT", "/evidence/slot", {})).status === 405);

  // the second receipt for the same slot: the issuer still lists only the first
  const b2 = await call(env, "POST", "/evidence/slot", { event: evA2 }, NOW + 60);
  t("a second receipt naming the same slot, while the issuer lists the first: not_listed", b2.status === 201 && b2.json.verdict === "not_listed", b2.json && b2.json.verdict);
  // the watch, a day later, after the issuer's listing changed to two receipts
  listing = { [SLOT]: [evA.id, evA2.id], [SLOT2]: [] };
  const w = await watchSlots(env, NOW + 21 * 3600, issuerFetch);
  t("the daily watch re-reads both (slot, receipt) pairs and sees the change", w.observed === 2 && w.changed === 2, JSON.stringify(w));
  const hist = await call(env, "GET", "/evidence/slot/s/" + SLOT);
  t("the slot history lists 4 observations oldest first and says the listing changed", hist.status === 200 && hist.json.count === 4 && hist.json.slot_listing_changed === true && hist.json.receipts_submitted_for_this_slot.length === 2, JSON.stringify(hist.json).slice(0, 300));
  const latest = hist.json.observations.filter((o) => o.receipt_event_id === evA.id).at(-1);
  const latestRec = JSON.parse((await call(env, "GET", "/evidence/slot/" + latest.sha + "?format=raw")).text);
  t("the watch observation of the first receipt is listed_with_others and links to the first observation", latestRec.verdict === "listed_with_others" && latestRec.previous_observation.sha === a.json.sha && latestRec.changed_since_previous === true && latestRec.trigger === "watch");
  const w2 = await watchSlots(env, NOW + 22 * 3600, issuerFetch);
  t("the watch does not re-read a pair it read less than 20 hours ago", w2.observed === 0);
  const w3 = await watchSlots(env, NOW + (WATCH_DAYS + 1) * 86400, issuerFetch);
  t("the watch stops " + WATCH_DAYS + " days after the first observation", w3.observed === 0 && w3.due === 0);
  t("an unknown slot: 404", (await call(env, "GET", "/evidence/slot/s/" + "c".repeat(64))).status === 404);
  t("a bad slot in the path: 400", (await call(env, "GET", "/evidence/slot/s/" + encodeURIComponent("../x"))).status === 400);

  // fetch failure, redirect, oversized body
  const evB = await receipt({ slot: SLOT2 });
  const f1 = await call(env, "POST", "/evidence/slot", { event: evB }, NOW, "198.51.100.1", async () => { throw new Error("down"); });
  t("the endpoint does not answer: verdict fetch_failed, still recorded", f1.status === 201 && f1.json.verdict === "fetch_failed" && f1.json.http_status === null);
  const evC = await receipt({ slot: "c".repeat(64) });
  const f2 = await call(env, "POST", "/evidence/slot", { event: evC }, NOW, "198.51.100.2", slotFetch(() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } })));
  t("a redirect is not followed: verdict unreadable with status 302", f2.json.verdict === "unreadable" && f2.json.http_status === 302);
  const evD = await receipt({ slot: "d".repeat(64) });
  const f3 = await call(env, "POST", "/evidence/slot", { event: evD }, NOW, "198.51.100.3", slotFetch((slot) => JSON.stringify({ slot, taken: true, event_ids: [evD.id], pad: "x".repeat(MAX_RESPONSE_BYTES) })));
  const r3 = JSON.parse((await call(env, "GET", "/evidence/slot/" + f3.json.sha + "?format=raw")).text);
  t("a response over " + MAX_RESPONSE_BYTES + " bytes is cut there and judged unreadable", r3.verdict === "unreadable" && r3.response_truncated === true && r3.response_bytes === MAX_RESPONSE_BYTES);

  // per-network cap
  const env2 = fakeEnv();
  let capped = null;
  for (let i = 0; i < 21; i++) {
    const ev = await receipt({ slot: ("e" + String(i).padStart(2, "0")).padEnd(64, "0") });
    const r = await call(env2, "POST", "/evidence/slot", { event: ev }, NOW, "192.0.2.9");
    if (r.status === 429) { capped = i; break; }
  }
  t("one network is capped at 20 new observations a day", capped === 20, capped);

  // anchoring
  const an = await anchorSlotWitnessPool(env, ORIGIN, "test", "2026-10-11T00:30:00Z");
  const entry = JSON.parse(env.m.get("entry:" + an.body.n));
  const batch = JSON.parse(entry.record_canonical);
  t("the batch lists every pending observation, oldest first, and is the entry's claim", an.status === 201 && batch.schema === "nenrin-slot-witness-batch-v0" && batch.count === batch.records.length && batch.records.every((r, i, a) => i === 0 || a[i - 1].observed_at <= r.observed_at) && entry.claim_sha256 === sha(entry.record_canonical));
  const one = await call(env, "GET", "/evidence/slot/" + a.json.sha);
  t("after the batch an observation reads as anchored with its ledger entry", one.json.status === "anchored" && one.json.anchor.ledger_entry === an.body.n);
  t("the pending list is empty after the batch", (await call(env, "GET", "/evidence/slot/pending")).json.count === 0);
  const envB = fakeEnv();
  for (let i = 0; i < BATCH_MAX + 1; i++) {
    const s = sha("obs" + i);
    envB.m.set("slotw:pending:" + s, JSON.stringify({ sha: s, request_slot: "x".repeat(64), receipt_event_id: "0".repeat(64), verdict: "unique", observed_at: new Date(Date.UTC(2026, 9, 10, 0, 0, BATCH_MAX + 1 - i)).toISOString(), response_sha256: "0".repeat(64) }));
  }
  const anB = await anchorSlotWitnessPool(envB, ORIGIN, "test", "2026-10-11T00:30:00Z");
  t("a batch of " + BATCH_MAX + " oldest first, the newest left for the next day", anB.body.anchored === BATCH_MAX && anB.body.remaining === 1 && envB.m.has("slotw:pending:" + sha("obs0")));
}

// ---- the fixtures slot_check.py reads regenerate byte for byte -------------------------------------------------
{
  const out = execFileSync(process.execPath, [HERE + "fixtures/gen_fixtures.mjs"], { encoding: "utf8" });
  t("fixtures/slot_fixtures.json regenerates byte for byte", out === readFileSync(HERE + "fixtures/slot_fixtures.json", "utf8"));
}

delete ISSUERS[TEST_PUB];
const bad = R.filter((r) => !r.ok);
for (const r of R) console.log((r.ok ? "ok    " : "FAIL  ") + r.name + (r.ok ? "" : "  [" + r.detail + "]"));
console.log("\n" + (R.length - bad.length) + "/" + R.length + " passed");
process.exit(bad.length ? 1 : 0);
