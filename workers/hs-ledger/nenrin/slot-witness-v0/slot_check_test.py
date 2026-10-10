#!/usr/bin/env python3
"""slot_check_test: the reader side of slot-witness-v0. BIP-340 (written separately from the intake's) against the BIP's
vectors and a real invinoveritas event; every observation the JS intake wrote in fixtures/slot_fixtures.json recomputed
here; tampering refused by name; and a synthetic ledger with an OpenTimestamps path and a mined regtest header view.
No network, standard library only. Run: python3 slot_check_test.py"""
import base64, copy, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "musubi-v0"))
import bip340  # noqa: E402
import slot_check as SC  # noqa: E402
import anchor_compose as AC  # noqa: E402
import settle_v1_1 as v11  # noqa: E402

results = []


def t(name, ok, detail=""):
    results.append((name, bool(ok), detail))


# ---- BIP-340 -------------------------------------------------------------------------------------------------
rows = [l.split(",") for l in open(os.path.join(HERE, "fixtures", "bip340_test_vectors.csv")).read().strip().split("\n")[1:]]
v = sum(1 for r in rows if bip340.verify(bytes.fromhex(r[2]), bytes.fromhex(r[4]), bytes.fromhex(r[5])) == (r[6] == "TRUE"))
t("BIP-340 verify (Python) agrees with all %d test vectors" % len(rows), v == len(rows), "%d/%d" % (v, len(rows)))
signed = [r for r in rows if r[1]]
s = sum(1 for r in signed if bip340.sign(bytes.fromhex(r[1]), bytes.fromhex(r[4]), bytes.fromhex(r[3])).hex().upper() == r[5])
t("BIP-340 sign (Python) reproduces every vector with a secret key", s == len(signed) and s > 0)
real = json.load(open(os.path.join(HERE, "fixtures", "invinoveritas_event.json"), encoding="utf-8"))["event"]
ok, why = bip340.nostr_event_check(real)
t("a real invinoveritas event verifies here (NIP-01 id and BIP-340)", ok, why)
t("the invinoveritas key is the one this checker reads", real["pubkey"] in SC.ISSUERS)
bad = dict(real, content=real["content"].replace("reject", "rejecT"))
t("one character of content changed: refused on the id", not bip340.nostr_event_check(bad)[0])

# ---- every observation the intake wrote ------------------------------------------------------------------------
FX = json.load(open(os.path.join(HERE, "fixtures", "slot_fixtures.json"), encoding="utf-8"))
TEST = {FX["test_issuer_pubkey"]: {"name": "test-issuer", "slot_url_prefix": FX["test_slot_url_prefix"]}}
for c in FX["cases"]:
    raw = c["record_jcs"].encode("utf-8")
    rep, prob = SC.check_record(raw, hashlib.sha256(raw).hexdigest(), issuers=TEST)
    t("%s: the JS intake's observation recomputes here, verdict %s" % (c["name"], c["expect_verdict"]), not prob and rep["verdict"] == c["expect_verdict"], prob)
rep, prob = SC.check_record(FX["cases"][0]["record_jcs"].encode())
t("with only the real issuer list, a test-issuer receipt is refused", any("not an issuer" in p for p in prob), prob)


def mutate(name, f):
    obs = json.loads(next(c for c in FX["cases"] if c["name"] == name)["record_jcs"])
    f(obs)
    return SC.VC.jcs(obs).encode("utf-8")


def problems(raw):
    return SC.check_record(raw, issuers=TEST)[1]


t("a record claiming unique over bytes that list two receipts: refused", any("does not recompute" in p for p in problems(mutate("listed_with_others", lambda o: o.update(verdict="unique", event_ids_seen=o["event_ids_seen"][:1])))))
t("a record whose kept bytes were swapped: refused", any("do not match" in p for p in problems(mutate("unique", lambda o: o.update(response_b64=base64.b64encode(b'{"slot":"x"}').decode())))))
t("a record naming another slot than the signed content: refused", any("request_slot" in p for p in problems(mutate("unique", lambda o: o.update(request_slot="c" * 64)))))
t("a record whose receipt signature was altered: refused", any("receipt:" in p for p in problems(mutate("unique", lambda o: o["receipt_event"].update(sig="0" * 128)))))
t("a record pointing at another endpoint: refused", any("slot_url" in p for p in problems(mutate("unique", lambda o: o.update(slot_url="https://evil.example/slot/" + o["request_slot"])))))
spaced = json.dumps(json.loads(FX["cases"][0]["record_jcs"]), indent=1).encode()
t("the same record not in RFC 8785 form: refused", any("RFC 8785" in p for p in problems(spaced)))
t("judge: the same id twice is never unique", SC.judge(200, b'{"slot":"s","taken":true,"event_ids":["e","e"]}', "s", "e")[0] == "listed_with_others")
t("judge: taken with an empty list is not_listed", SC.judge(200, b'{"slot":"s","taken":true,"event_ids":[]}', "s", "e")[0] == "not_listed")


# ---- a synthetic ledger: batch, OTS path, mined header view ----------------------------------------------------------
L = "https://ledger.test"


def build(records, listed=None, block_t=1791700000, height=101, lie_claim=False, anchored=True):
    shas = [hashlib.sha256(r).hexdigest() for r in records]
    listed = shas if listed is None else listed
    batch = {"schema": SC.BATCH_SCHEMA, "anchored_at": "2026-10-11T00:30:00Z", "count": len(listed), "records": [{"sha": x} for x in listed]}
    bb = json.dumps(batch).encode()
    claim = hashlib.sha256(bb).digest()
    tree = [(0xf0, b"nonce", [(0x08, None, [(0xf1, b"agg", [(0x08, None, [("att", "bitcoin", height)])])])])]
    ots = AC.OTS_MAGIC + b"\x01" + b"\x08" + claim + AC._ser(tree)
    root = AC._run(tree, claim)
    headers, prev = [], "00" * 32
    for h in (height - 1, height, height + 1):
        raw = v11._mine(prev, root if h == height else hashlib.sha256(b"h%d" % h).digest(), t=block_t + (h - height) * 600, salt=h)
        headers.append({"height": h, "hex": raw.hex()})
        prev = v11.header_hash(raw)
    entry = {"n": 900, "claim_sha256": ("0" * 64) if lie_claim else claim.hex(), "block_time": SC.VC.iso(block_t), "bitcoin_block": height}
    routes = {L + "/ledger/900": json.dumps(entry).encode(), L + "/ledger/900?format=raw": bb, L + "/ledger/900/ots": ots}
    obs_list = []
    for r, x in zip(records, shas):
        o = json.loads(r)
        routes[L + "/evidence/slot/" + x + "?format=raw"] = r
        routes[L + "/evidence/slot/" + x] = json.dumps({"sha": x, "status": "anchored" if anchored else "pending", "anchor": {"ledger_entry": 900} if anchored else None}).encode()
        obs_list.append({"sha": x, "observed_at": o["observed_at"], "event_ids_seen": o["event_ids_seen"]})
        routes[L + "/evidence/slot/s/" + o["request_slot"]] = json.dumps({"observations": obs_list}).encode()

    def fetcher(url):
        if url in routes:
            return 200, routes[url]
        raise OSError("404 " + url)
    return fetcher, {"headers": headers}, shas


SC.ISSUERS.update(TEST)
recs = [c["record_jcs"].encode() for c in FX["cases"] if c["name"] in ("unique", "listed_with_others")]
F, VIEW, shas = build(recs)
rep, prob = SC.check_online(L, shas[0], F, view=VIEW, floor_bits="207fffff")
t("online: the observation recomputes and is anchored, block time from the checked header", not prob and rep.get("anchored") and rep["block_time_source"].startswith("the header in the view"), prob)
rep, prob = SC.check_online(L, shas[0], F, view=None)
t("online without a header view: the ledger's time is reported as NOT checked", "NOT checked" in rep["block_time_source"])
F2, V2, s2 = build(recs, listed=[shas[1]])
t("a batch that does not list the observation: refused", any("exactly once" in p for p in SC.check_online(L, shas[0], F2, view=V2, floor_bits="207fffff")[1]))
F3, V3, s3 = build(recs, lie_claim=True)
t("an entry whose claim is not the batch's hash: refused", any("entry claims" in p for p in SC.check_online(L, shas[0], F3, view=V3, floor_bits="207fffff")[1]))
F4, V4, s4 = build(recs, anchored=False)
t("not yet batched: reported, not anchored", any("not yet in a batch" in p for p in SC.check_online(L, shas[0], F4)[1]))
slot_rep, prob = SC.check_slot(L, json.loads(recs[0])["request_slot"], F, view=VIEW, floor_bits="207fffff")
t("--slot: both observations recompute and the listing change (one receipt, then two) is reported", not prob and slot_rep["slot_listing_changed"] and len(slot_rep["distinct_event_id_lists_seen"]) == 2, prob)
for k in TEST:
    SC.ISSUERS.pop(k, None)

bad = [r for r in results if not r[1]]
for name, okk, detail in results:
    print(("ok    " if okk else "FAIL  ") + name + ("" if okk else "  [%s]" % (detail,)))
print("\n%d/%d passed" % (len(results) - len(bad), len(results)))
sys.exit(1 if bad else 0)
