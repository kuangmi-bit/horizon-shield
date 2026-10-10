// gen_fixtures.mjs: deterministic observations for slot_check.py to recompute, so the JS intake and the Python
// checker are tested against the same bytes. A test issuer key (BIP-340 vector 0's secret key, 3) signs receipt
// events with a fixed aux; the slot endpoint is a fake. Run: node nenrin/slot-witness-v0/fixtures/gen_fixtures.mjs > slot_fixtures.json
// (in workers/hs-ledger). The test asserts the committed file regenerates byte for byte.
import { ISSUERS, readReceipt, observe } from "../slot_witness_v0.mjs";
import { schnorrSign, hexToBytes, nostrEventId } from "../bip340.mjs";
import { jcs } from "../../trace-pin-v0/trace_pin_v0.mjs";

export const TEST_SK = "0000000000000000000000000000000000000000000000000000000000000003";
export const TEST_PUB = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
export const TEST_PREFIX = "https://issuer.test/decision-receipt/slot/";
export const NOW = 1791600000; // 2026-10-10T02:40:00Z
const hex = (b) => Buffer.from(b).toString("hex");

export function addTestIssuer() { ISSUERS[TEST_PUB] = { name: "test-issuer", slot_url_prefix: TEST_PREFIX, spec: "fixtures only" }; }

export async function receipt({ slot, choice = "approve", created_at = NOW - 120, extra = {} }) {
  const content = jcs({ schema: "invinoveritas.decision_receipt.v0", request_slot: slot, choice_commitment: "c".repeat(64), ...extra });
  const ev = { pubkey: TEST_PUB, created_at, kind: 30078, tags: [["d", "decision-receipt"]], content };
  ev.id = await nostrEventId(ev);
  ev.sig = hex(await schnorrSign(hexToBytes(TEST_SK), hexToBytes(ev.id), new Uint8Array(32)));
  return ev;
}

export const slotFetch = (bodyFor) => async (u, init) => {
  if (init && init.redirect !== "manual") return new Response("redirects must not be followed", { status: 500 });
  const slot = decodeURIComponent(u.slice(TEST_PREFIX.length));
  const r = bodyFor(slot, u);
  if (r instanceof Response) return r;
  return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
};

async function main() {
  addTestIssuer();
  const slotA = "a".repeat(64), slotB = "b".repeat(64);
  const evA = await receipt({ slot: slotA });
  const evA2 = await receipt({ slot: slotA, choice: "deny", created_at: NOW - 60, extra: { choice_commitment: "d".repeat(64) } });
  const evB = await receipt({ slot: slotB });
  const cases = [];
  const add = async (name, ev, body, trigger = "submitted") => {
    const rc = await readReceipt(ev);
    const obs = await observe(ev, rc, { nowSec: NOW, fetchImpl: slotFetch(() => body), trigger, previous: null });
    const record_jcs = jcs(obs);
    cases.push({ name, record_jcs, expect_verdict: obs.verdict });
  };
  await add("unique", evA, { slot: slotA, taken: true, event_ids: [evA.id] });
  await add("listed_with_others", evA, { slot: slotA, taken: true, event_ids: [evA.id, evA2.id] });
  await add("not_listed", evA2, { slot: slotA, taken: true, event_ids: [evA.id] });
  await add("not_taken", evB, { slot: slotB, taken: false, event_ids: [] });
  await add("slot_mismatch", evB, { slot: slotA, taken: true, event_ids: [evB.id] });
  await add("unreadable_status", evB, new Response("gone", { status: 503 }));
  await add("unreadable_body", evB, "<html>not json</html>");
  process.stdout.write(JSON.stringify({ schema: "nenrin-slot-witness-fixtures-v0", test_issuer_pubkey: TEST_PUB, test_slot_url_prefix: TEST_PREFIX, now: NOW, cases }, null, 1) + "\n");
}

if (import.meta.url === "file://" + process.argv[1]) await main();
