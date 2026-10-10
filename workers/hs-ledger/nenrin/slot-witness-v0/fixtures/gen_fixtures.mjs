// gen_fixtures.mjs: deterministic observations for slot_check.py to recompute, so the JS intake and the Python
// checker are tested against the same bytes. A test issuer key (BIP-340 vector 0's secret key, 3) signs receipt
// events with a fixed aux; the slot endpoint is a fake. Run: node nenrin/slot-witness-v0/fixtures/gen_fixtures.mjs > slot_fixtures.json
// (in workers/hs-ledger). The test asserts the committed file regenerates byte for byte.
// slot_fixtures.json holds v0 observations (written with version "0", as the intake wrote them until 2026-10-11).
// With --v01 it writes slot_fixtures_v01.json: v0.1 observations of decider-scoped slots (decision-receipt SPEC v0.4),
// where a test decider key (secret key 5) signs decider claims. The equivocation case has the shape of the first
// live one (2026-10-10): the slot holds one claim and lists one conflicting claim, both signed by the decider key.
import { ISSUERS, readReceipt, observe } from "../slot_witness_v0.mjs";
import { schnorrSign, hexToBytes, nostrEventId, xOnlyPub } from "../bip340.mjs";
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

export const DECIDER_SK = "0000000000000000000000000000000000000000000000000000000000000005";
export const OTHER_DECIDER_SK = "0000000000000000000000000000000000000000000000000000000000000007";
const enc = new TextEncoder();
const sha = async (s) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));

export async function deciderClaim(sk, { request_id = "req-1", choice = "approve", claimed_at = NOW - 120 } = {}) {
  const pub = hex(await xOnlyPub(hexToBytes(sk)));
  const slot = await sha("invinoveritas.decision_receipt.slot.decider.v1|" + pub + "|" + request_id);
  const claim = { schema: "invinoveritas.decision_claim.v1", request_slot: slot, decider_pubkey: pub, claimed_at,
    choice_commitment: await sha("choice|" + choice), question_commitment: await sha("question|" + request_id) };
  const sig = hex(await schnorrSign(hexToBytes(sk), new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(jcs(claim)))), new Uint8Array(32)));
  return { pub, slot, claim, sig };
}

async function mainV01() {
  addTestIssuer();
  const A = await deciderClaim(DECIDER_SK);                                              // the claim that holds the slot
  const B = await deciderClaim(DECIDER_SK, { choice: "deny", claimed_at: NOW - 100 });   // same key, same request_id, other choice
  const O = await deciderClaim(OTHER_DECIDER_SK);                                       // another decider key
  const rcA = { decider_pubkey: A.pub, decider_claim: A.claim, decider_sig: A.sig, slot_scope: "decider" };
  const rcB = { decider_pubkey: B.pub, decider_claim: B.claim, decider_sig: B.sig, slot_scope: "decider" };
  const evA = await receipt({ slot: A.slot, extra: rcA });
  const evB = await receipt({ slot: B.slot, created_at: NOW - 100, extra: { ...rcB, choice_commitment: "d".repeat(64) } });
  const flip = (sig) => (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  const slotBody = (ev, holder, conflicts) => ({ slot: A.slot, taken: true, event_ids: [ev.id], scope: "decider",
    decider_claim: holder.claim, decider_sig: holder.sig, ...(conflicts ? { conflicts } : {}) });
  const cases = [];
  const add = async (name, ev, body, expect_decider) => {
    const rc = await readReceipt(ev);
    const obs = await observe(ev, rc, { nowSec: NOW, fetchImpl: slotFetch(() => body), trigger: "submitted", previous: null });
    cases.push({ name, record_jcs: jcs(obs), expect_verdict: obs.verdict, expect_decider: obs.decider === null ? null : obs.decider[expect_decider[0]] === expect_decider[1] ? expect_decider : ["MISMATCH", obs.decider] });
  };
  await add("account_scoped_no_decider_claim", evA, { slot: A.slot, taken: true, event_ids: [evA.id] }, null);
  await add("holder_verifies_no_conflicts", evA, slotBody(evA, A, []), ["holder_claim", "verifies"]);
  await add("equivocation_one_conflict", evA, slotBody(evA, A, [{ decider_claim: B.claim, decider_sig: B.sig, received_at: NOW - 100 }]), ["equivocation", true]);
  await add("conflict_with_bad_signature", evA, slotBody(evA, A, [{ decider_claim: B.claim, decider_sig: flip(B.sig) }]), ["conflicts_verified", 0]);
  await add("conflict_by_another_key", evA, slotBody(evA, A, [{ decider_claim: O.claim, decider_sig: O.sig }]), ["conflicts_verified", 0]);
  const X = await deciderClaim(DECIDER_SK, { request_id: "req-2" });                    // same key, another request_id: another slot
  await add("conflict_for_another_slot", evA, slotBody(evA, A, [{ decider_claim: X.claim, decider_sig: X.sig }]), ["conflicts_verified", 0]);
  await add("conflict_repeats_the_holder", evA, slotBody(evA, A, [{ decider_claim: A.claim, decider_sig: A.sig }]), ["equivocation", false]);
  await add("holder_bad_signature", evA, slotBody(evA, { claim: A.claim, sig: flip(A.sig) }, [{ decider_claim: B.claim, decider_sig: B.sig }]), ["holder_claim", "bad_signature"]);
  await add("slot_held_by_the_other_claim", evB, { ...slotBody(evA, A, [{ decider_claim: B.claim, decider_sig: B.sig }]), event_ids: [evA.id] }, ["holder_claim", "not_the_receipts_claim"]);
  await add("holder_names_another_key", evA, slotBody(evA, O, []), ["holder_claim", "other_key"]);
  for (const c of cases) if (c.expect_decider && c.expect_decider[0] === "MISMATCH") throw new Error(c.name + ": " + JSON.stringify(c.expect_decider[1]));
  process.stdout.write(JSON.stringify({ schema: "nenrin-slot-witness-fixtures-v0.1", test_issuer_pubkey: TEST_PUB, test_slot_url_prefix: TEST_PREFIX, now: NOW, decider_pubkey: A.pub, cases }, null, 1) + "\n");
}

async function main() {
  addTestIssuer();
  const slotA = "a".repeat(64), slotB = "b".repeat(64);
  const evA = await receipt({ slot: slotA });
  const evA2 = await receipt({ slot: slotA, choice: "deny", created_at: NOW - 60, extra: { choice_commitment: "d".repeat(64) } });
  const evB = await receipt({ slot: slotB });
  const cases = [];
  const add = async (name, ev, body, trigger = "submitted") => {
    const rc = await readReceipt(ev);
    const obs = await observe(ev, rc, { nowSec: NOW, fetchImpl: slotFetch(() => body), trigger, previous: null, version: "0" });
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

if (import.meta.url === "file://" + process.argv[1]) await (process.argv.includes("--v01") ? mainV01() : main());
