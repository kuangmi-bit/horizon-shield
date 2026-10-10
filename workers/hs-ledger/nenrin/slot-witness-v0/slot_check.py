#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
slot_check: recompute, without trusting the NENRIN ledger, what a slot witness observation says.

    python3 slot_check.py --sha <observation sha>            [--ledger https://ledger.horizonshield.dev] [--headers view.json]
    python3 slot_check.py --slot <request_slot>               (every observation of one slot, and whether the listing changed)
    python3 slot_check.py --record observation.json           (offline: the raw bytes /evidence/slot/<sha>?format=raw served)

For each observation this:
  1. checks the record is its own RFC 8785 form and hashes to its sha;
  2. checks the receipt it carries: the NIP-01 event id recomputes, the BIP-340 signature verifies under an issuer key
     listed here (written separately from the ledger's code), and request_slot is the one in the signed content;
  3. decodes the response bytes the ledger kept, checks their sha256 and length, and recomputes the verdict from them
     with the same rule the intake uses (unique only when the slot is taken and lists exactly this event id);
  4. with --sha or --slot, reads the ledger batch that lists the observation, checks it is the entry's claim and lists
     the sha exactly once, reads the entry's OpenTimestamps proof (musubi-v0/anchor_compose.read_ots) and, given a
     header view, the block's merkle root, linkage, work and time (vouch-pin-v0/vouch_check.header_time).
With --slot it also reports every distinct list of event ids the issuer served over time.
Exit 0 when every observation recomputes (and, online, is anchored), 1 otherwise, 2 on usage errors. Standard library only.
"""
import argparse, base64, hashlib, json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "vouch-pin-v0"))
sys.path.insert(0, os.path.join(HERE, "..", "musubi-v0"))
import bip340  # noqa: E402
import vouch_check as VC  # noqa: E402  (jcs, header_time, iso, parse_time: no third-party import at module load)
import anchor_compose as AC  # noqa: E402

OBS_SCHEMA = "nenrin-slot-observation-v0"
BATCH_SCHEMA = "nenrin-slot-witness-batch-v0"
MAX_RESPONSE_BYTES = 16384
ISSUERS = {
    "6786e18a864893a900bd9858e650f67ccc3513f248fed374b591e2ff6922fbb7": {
        "name": "invinoveritas", "slot_url_prefix": "https://api.babyblueviper.com/decision-receipt/slot/"},
}
VERDICTS = ["unique", "listed_with_others", "not_listed", "not_taken", "slot_mismatch", "unreadable", "fetch_failed"]


def judge(status, body, slot, event_id):
    """The intake's rule, from the stored bytes: (verdict, event_ids_seen)."""
    if status is None:
        return "fetch_failed", None
    if status != 200:
        return "unreadable", None
    try:
        b = json.loads(body.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return "unreadable", None
    if not isinstance(b, dict):
        return "unreadable", None
    if b.get("slot") != slot:
        return "slot_mismatch", None
    ids = b.get("event_ids")
    ids_ok = isinstance(ids, list) and all(isinstance(x, str) for x in ids)
    if b.get("taken") is not True:
        return "not_taken", (ids if ids_ok else None)
    if not ids_ok:
        return "unreadable", None
    if ids == [event_id]:
        return "unique", ids
    if event_id in ids:
        return "listed_with_others", ids
    return "not_listed", ids


def check_record(raw, sha=None, issuers=None):
    """Offline checks of one observation's raw bytes. Returns (report, problems)."""
    issuers = ISSUERS if issuers is None else issuers
    prob = []
    got = hashlib.sha256(raw).hexdigest()
    rep = {"sha256": got}
    if sha and got != sha:
        prob.append("the bytes hash to %s, not %s" % (got, sha))
    try:
        obs = json.loads(raw.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return rep, prob + ["the record is not JSON"]
    if VC.jcs(obs).encode("utf-8") != raw:
        prob.append("the record is not in its RFC 8785 form")
    if obs.get("schema") != OBS_SCHEMA:
        prob.append("schema is not %s" % OBS_SCHEMA)
    ev = obs.get("receipt_event")
    ok, why = bip340.nostr_event_check(ev)
    rep["receipt_signature"] = "verifies" if ok else why
    if not ok:
        prob.append("receipt: %s" % why)
        return rep, prob
    issuer = issuers.get(ev["pubkey"])
    rep["issuer"] = issuer["name"] if issuer else None
    if not issuer:
        prob.append("the receipt's key is not an issuer this checker reads")
        return rep, prob
    try:
        content = json.loads(ev["content"])
        slot = content.get("request_slot")
    except Exception:  # noqa: BLE001
        slot = None
    rep["request_slot"] = slot
    if not isinstance(slot, str) or slot != obs.get("request_slot"):
        prob.append("request_slot in the record is not the one in the signed content")
    if obs.get("receipt_event_id") != ev["id"] or obs.get("issuer_pubkey") != ev["pubkey"] or obs.get("receipt_created_at") != ev["created_at"]:
        prob.append("the record's receipt fields are not the event's")
    if isinstance(slot, str) and obs.get("slot_url") != issuer["slot_url_prefix"] + urllib.parse.quote(slot, safe="-_.!~*'()"):
        prob.append("slot_url is not the issuer's slot endpoint for this slot")
    try:
        body = base64.b64decode(obs.get("response_b64") or "", validate=True)
    except Exception:  # noqa: BLE001
        return rep, prob + ["response_b64 is not base64"]
    if hashlib.sha256(body).hexdigest() != obs.get("response_sha256") or len(body) != obs.get("response_bytes"):
        prob.append("the kept response bytes do not match response_sha256 or response_bytes")
    truncated = obs.get("response_truncated") is True
    if truncated and len(body) != MAX_RESPONSE_BYTES:
        prob.append("response_truncated is true but the kept bytes are not %d" % MAX_RESPONSE_BYTES)
    verdict, ids = ("unreadable", None) if truncated else judge(obs.get("http_status"), body, slot, ev["id"])
    rep.update({"observed_at": obs.get("observed_at"), "http_status": obs.get("http_status"), "verdict": verdict, "event_ids_seen": ids,
                "trigger": obs.get("trigger"), "previous_observation": (obs.get("previous_observation") or {}).get("sha")})
    if verdict != obs.get("verdict") or ids != obs.get("event_ids_seen"):
        prob.append("the verdict does not recompute from the kept bytes: record says %s, bytes say %s" % (obs.get("verdict"), verdict))
    return rep, prob


def anchor_leg(ledger, sha, n, fetcher, view, floor_bits):
    rep, prob = {"ledger_entry": n}, []
    st, eb = fetcher("%s/ledger/%d" % (ledger, n))
    entry = json.loads(eb.decode("utf-8"))
    st, batch_bytes = fetcher("%s/ledger/%d?format=raw" % (ledger, n))
    claim = hashlib.sha256(batch_bytes).hexdigest()
    if claim != entry.get("claim_sha256"):
        prob.append("the batch bytes hash to %s, the entry claims %s" % (claim, entry.get("claim_sha256")))
    try:
        batch = json.loads(batch_bytes.decode("utf-8"))
        recs = batch.get("records") or []
        if batch.get("schema") != BATCH_SCHEMA or batch.get("count") != len(recs) or len([r for r in recs if isinstance(r, dict) and r.get("sha") == sha]) != 1:
            prob.append("the batch is not a %s that lists this sha exactly once" % BATCH_SCHEMA)
    except Exception:  # noqa: BLE001
        prob.append("the batch is not JSON")
    try:
        st, ots = fetcher("%s/ledger/%d/ots" % (ledger, n))
        digest, atts = AC.read_ots(ots)
    except Exception as e:  # noqa: BLE001
        return rep, prob + ["no readable OpenTimestamps proof yet: %s" % e]
    if digest.hex() != claim:
        prob.append("the .ots stamps %s, not the batch %s" % (digest.hex(), claim))
    btc = [x for x in atts if x.get("kind") == "bitcoin" and x.get("msg") is not None]
    if not btc:
        return rep, prob + ["the .ots has no Bitcoin attestation yet"]
    low = min(btc, key=lambda x: x["height"])
    rep["block_height"] = low["height"]
    if view is not None:
        try:
            t, hh = VC.header_time(view, low["height"], low["msg"], floor_bits)
            rep["block_time"], rep["block_time_source"] = VC.iso(t), "the header in the view you gave, checked here"
        except ValueError as e:
            prob.append("header view: %s" % e)
    else:
        rep["block_time"] = entry.get("block_time")
        rep["block_time_source"] = "as served by the ledger, NOT checked here; pass --headers view.json to check it"
    rep["anchored"] = not prob
    return rep, prob


def check_online(ledger, sha, fetcher=VC.fetch, view=None, floor_bits="1903a30c"):
    st, raw = fetcher("%s/evidence/slot/%s?format=raw" % (ledger, sha))
    rep, prob = check_record(raw, sha)
    st, b = fetcher("%s/evidence/slot/%s" % (ledger, sha))
    meta = json.loads(b.decode("utf-8"))
    n = (meta.get("anchor") or {}).get("ledger_entry")
    if n is None:
        rep["anchored"] = False
        return rep, prob + ["observed, not yet in a batch"]
    a, p2 = anchor_leg(ledger, sha, n, fetcher, view, floor_bits)
    rep.update(a)
    return rep, prob + p2


def check_slot(ledger, slot, fetcher=VC.fetch, view=None, floor_bits="1903a30c"):
    st, b = fetcher("%s/evidence/slot/s/%s" % (ledger, urllib.parse.quote(slot, safe="")))
    hist = json.loads(b.decode("utf-8"))
    out, problems = [], []
    for o in hist.get("observations") or []:
        r, p = check_online(ledger, o["sha"], fetcher, view, floor_bits)
        out.append(r)
        problems += ["%s: %s" % (o["sha"][:12], x) for x in p]
    lists = []
    for r in out:
        if r.get("event_ids_seen") not in lists:
            lists.append(r.get("event_ids_seen"))
    return {"request_slot": slot, "observations": out, "distinct_event_id_lists_seen": lists, "slot_listing_changed": len(lists) > 1}, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--sha")
    g.add_argument("--slot")
    g.add_argument("--record", help="an observation's raw bytes in a file (offline)")
    ap.add_argument("--ledger", default="https://ledger.horizonshield.dev")
    ap.add_argument("--headers", help="a header view {\"headers\": [{\"height\", \"hex\"}]} covering the attested block")
    ap.add_argument("--max-target-bits", default="1903a30c")
    a = ap.parse_args()
    view = json.load(open(a.headers, encoding="utf-8")) if a.headers else None
    led = a.ledger.rstrip("/")
    if a.record:
        rep, prob = check_record(open(a.record, "rb").read())
        online_needed = False
    elif a.sha:
        rep, prob = check_online(led, a.sha.lower(), view=view, floor_bits=a.max_target_bits)
        online_needed = True
    else:
        rep, prob = check_slot(led, a.slot, view=view, floor_bits=a.max_target_bits)
        online_needed = True
    rep["problems"] = prob
    rep["establishes"] = ["the receipt verifies under the issuer key and names this slot",
                          "the ledger kept exactly these response bytes, and they say what the verdict says"]
    rep["does_not_establish"] = ["that only one receipt was issued; the slot is the issuer's record",
                                 "what the endpoint served between observations or to anyone else"]
    print(json.dumps(rep, indent=2, ensure_ascii=False))
    if prob:
        return 1
    return 0 if (not online_needed or a.slot or rep.get("anchored")) else 1


if __name__ == "__main__":
    sys.exit(main())
