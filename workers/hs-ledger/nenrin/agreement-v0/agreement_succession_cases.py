#!/usr/bin/env python3
"""Cases for the key succession parity test (agreement_succession_parity_test.mjs).

Prints one canonical JSON document: {"cases": [{name, record, keys, successions, anchored_block,
report}]}, where report is what the python verifier says. The JavaScript twin must return the
same bytes for every case. Deterministic: fixed Ed25519 seeds and a seeded random for the odd
inputs, so two people running this reach the same document.
Run: python3 agreement_succession_cases.py > cases.json
"""
# RUN_ALL: library

import base64
import copy
import hashlib
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import agreement_verify as V
import agreement_sign as S
import key_succession as KS

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def keypair(seed_byte):
    k = Ed25519PrivateKey.from_private_bytes(bytes([seed_byte]) * 32)
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return k, base64.b64encode(pub).decode("ascii")


KA, PA = keypair(0x11)
KB, PB = keypair(0x22)
KD, PD = keypair(0x55)
KE, PE = keypair(0x66)
KX, PX = keypair(0x44)
URL_A = "https://party-a.example/keys/agreement.json"
URL_B = "https://party-b.example/keys/agreement.json"
DOM_A = "party-a.example"


def p11(dom, role, pub, sha, other):
    return {"domain": dom, "key_url": "https://%s/keys/agreement.json" % dom, "public_key_ed25519_b64": pub,
            "agent_card": "https://%s/.well-known/agent-card.json" % dom,
            "agent_card_sha256": hashlib.sha256(dom.encode()).hexdigest(),
            "conduct_record": {"sha256": sha, "url": "https://gate.example/record/" + sha,
                               "subject_domain": other, "measured_by_domain": "gate.example"},
            "role": role}


def good11(lower=None, key_url_a=None):
    rec = {
        "schema": "a2a-agreement-v1.1", "agreement_id": "00112233445566778899aabbccddeeff",
        "agreed_at": "2026-09-10T00:00:00Z",
        "parties": [p11(DOM_A, "payer", PA, "a" * 64, "party-b.example"),
                    p11("party-b.example", "payee", PB, "b" * 64, DOM_A)],
        "terms": {"what": "one audit of one estimate", "consideration": "money",
                  "who_pays_whom": {"from": DOM_A, "to": "party-b.example"},
                  "amount_minor_units": 10000, "minor_unit_scale": 0, "currency": "JPY",
                  "disclosure_url": "https://party-b.example/pricing"},
        "recorder": {"domain": "recorder.example", "is_a_party": False,
                     "fee": {"basis": "per_record", "amount_minor_units": 0, "currency": "JPY"}},
        "record_paid_by": "both",
        "establishes": ["that both parties signed these bytes at the stated time",
                        "that each party named the counterparty's conduct record by sha256 at that moment"],
        "does_not_establish": ["that either party performed", "that this record is a contract",
                               "that money moved", "that the conduct record each side pinned is accurate",
                               "that the terms are lawful or complete"],
        "signatures": [],
    }
    if lower is not None:
        rec["lower_bound"] = {"kind": "bitcoin_block", "height": lower, "hash": "e" * 64}
    if key_url_a is not None:
        rec["parties"][0]["key_url"] = key_url_a
    for dom, k in ((DOM_A, KA), ("party-b.example", KB)):
        rec, _ = S.sign(rec, k, dom)
    return rec


def handover(old_pub, new_pub, blk, prev=None, reason="rotation", dom=DOM_A, old_k=None, new_k=None):
    e = {"schema": KS.SCHEMA, "domain": dom, "purpose": "agreement",
         "old_public_key_ed25519_b64": old_pub, "new_public_key_ed25519_b64": new_pub,
         "reason": reason, "effective_block": blk,
         "prev_succession_sha256": None if prev is None else KS.entry_sha256(prev, V.canonical, V.sha256_hex),
         "signatures": []}
    return KS.sign_handover(e, old_k, new_k, V.canonical)


H1 = handover(PA, PD, 910000, old_k=KA, new_k=KD)
H2 = handover(PD, PE, 920000, prev=H1, old_k=KD, new_k=KE)
HC = handover(PA, PD, 910000, reason="compromise", new_k=KD)
SD = {URL_A: PD, URL_B: PB}
SE = {URL_A: PE, URL_B: PB}
G = good11()
LB = good11(lower=910000)
OFF_URL = "https://evilparty-a.example/keys/agreement.json"
OFF = good11(key_url_a=OFF_URL)

CASES = []


def add(name, rec, keys, chains, anchored):
    CASES.append({"name": name, "record": rec, "keys": keys, "successions": chains, "anchored_block": anchored})


add("no chain supplied", G, SD, None, None)
add("rotation, anchored before", G, SD, {URL_A: [H1]}, 900000)
add("rotation, no anchor", G, SD, {URL_A: [H1]}, None)
add("rotation, anchored at block", G, SD, {URL_A: [H1]}, 910000)
add("rotation, anchor true", G, SD, {URL_A: [H1]}, True)
add("two handovers", G, SE, {URL_A: [H1, H2]}, 900000)
add("two handovers, anchored between", G, SE, {URL_A: [H1, H2]}, 915000)
add("reordered", G, SE, {URL_A: [H2, H1]}, 900000)
add("stops short", G, SE, {URL_A: [H1]}, 900000)
add("new key only", G, SD, {URL_A: [handover(PA, PD, 910000, new_k=KD)]}, 900000)
add("old key only", G, SD, {URL_A: [handover(PA, PD, 910000, old_k=KA)]}, 900000)
add("signed after retirement", LB, SD, {URL_A: [H1]}, 900000)
add("signed after compromise", LB, SD, {URL_A: [HC]}, 900000)
add("compromise, anchored before", G, SD, {URL_A: [HC]}, 900000)
add("off domain key server", OFF, {OFF_URL: PD, URL_B: PB}, {OFF_URL: [H1]}, 900000)
add("chain for the other url", G, SD, {URL_B: [H1]}, 900000)
add("key unchanged, chain ignored", G, {URL_A: PA, URL_B: PB}, {URL_A: [H1]}, 900000)
add("empty chain", G, SD, {URL_A: []}, 900000)
add("chain not a list", G, SD, {URL_A: {"a": 1}}, 900000)
add("too long", G, SD, {URL_A: [H1] * (KS.MAX_CHAIN + 1)}, 900000)
add("loop", G, SE, {URL_A: [H1, handover(PD, PA, 920000, prev=H1, old_k=KD, new_k=KA)]}, 900000)
add("second not linked by sha", G, SE, {URL_A: [H1, handover(PD, PE, 920000, old_k=KD, new_k=KE)]}, 900000)
add("second passes on a foreign key", G, SE, {URL_A: [H1, handover(PX, PE, 920000, prev=H1, old_k=KX, new_k=KE)]}, 900000)
add("second dated before the first", G, SE, {URL_A: [H1, handover(PD, PE, 909999, prev=H1, old_k=KD, new_k=KE)]}, 900000)
_L1 = handover(PD, PA, 920000, prev=H1, old_k=KD, new_k=KA)
add("key retired twice", G, SE, {URL_A: [H1, _L1, handover(PA, PE, 920001, prev=_L1, old_k=KA, new_k=KE)]}, 900000)
add("to itself", G, SD, {URL_A: [handover(PA, PA, 910000, old_k=KA, new_k=KA)]}, 900000)

# odd inputs: every field of the handover replaced by values of every JSON type
ODD = [None, True, False, 0, -1, 1, 910000, 2 ** 70, "", "x", "rotation", "compromise", "old", "new",
       DOM_A, "PARTY-A.EXAMPLE.", "agreement", PA, PD, PX, "!!!!", [], [1], ["old"], {}, {"by": "old"},
       {"by": "old", "sig": "x"}, [{"by": "old", "sig": 1}], [{"by": ["old"], "sig": "x"}],
       [{"by": "old", "sig": "x"}, {"by": "old", "sig": "x"}], "a" * 64]
rnd = random.Random(20260930)
fields = sorted(KS.FIELDS)
for i in range(400):
    e = copy.deepcopy(H1)
    for _ in range(rnd.choice((1, 1, 2, 3))):
        f = rnd.choice(fields)
        op = rnd.random()
        if op < 0.1:
            e.pop(f, None)
        elif op < 0.15:
            e["extra"] = rnd.choice(ODD)
        else:
            e[f] = copy.deepcopy(rnd.choice(ODD))
    chain = [e] if rnd.random() < 0.7 else [e, H2]
    if rnd.random() < 0.3:
        # the second handover, re-signed after the change, so only the chain rules can catch it
        e2 = {k: v for k, v in H2.items() if k != "signatures"}
        for f in rnd.sample(["old_public_key_ed25519_b64", "effective_block", "prev_succession_sha256"], rnd.choice((1, 2))):
            e2[f] = rnd.choice({"old_public_key_ed25519_b64": [PA, PX, PE, PD],
                                "effective_block": [910000, 909999, 920000, 910001],
                                "prev_succession_sha256": [None, "0" * 64, KS.entry_sha256(H1, V.canonical, V.sha256_hex)]}[f])
        e2["signatures"] = []
        old_k = {PA: KA, PX: KX, PE: KE, PD: KD}[e2["old_public_key_ed25519_b64"]]
        chain = [H1, KS.sign_handover(e2, old_k, KE, V.canonical)]
    served = SD if len(chain) == 1 else SE
    add("odd %d" % i, rnd.choice((G, LB)), served, {URL_A: chain}, rnd.choice((None, 900000, 910000, 920001, True)))


def main():
    out = []
    for c in CASES:
        rep = V.verify(copy.deepcopy(c["record"]), keys=c["keys"], successions=c["successions"],
                       anchored_block=c["anchored_block"])
        d = dict(c)
        d["report"] = rep
        out.append(d)
    sys.stdout.write(V.canonical({"cases": out}))


if __name__ == "__main__":
    main()
