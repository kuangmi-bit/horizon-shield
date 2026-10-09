#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Admission adapter "musubi-native": reads a signed MUSUBI contract (and, when there is one, a delegated child contract)
and returns the presentation item admit_v0.admit() takes. It normalizes input. It decides nothing.

    item = read(contract)                       the contract the two parties signed
    item = read(contract, child=child_contract) a delegation: the child's grant, and whether it stays inside the parent's

What "verified": true means here, and only this: contract_v0.verify_contract accepts the contract (both signatures
over the same bytes, the grant's types, the limits a contract must state), and each party's key_url is an https URL on
the party's own domain or a subdomain of it. It does not say the A2A card's JWS was checked; that needs the card and
its JWKS, which this function does not fetch. checks.card_jws stays null unless the caller passes the result of a
check it ran itself (card_jws=True or False), and a false there makes verified false.

With a child contract: within_parent is contract_v0.grant_subset(child.grant, parent.grant) == [], the same function
the contract door uses, and the item carries the child's grant so that admit reads the action against it too.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_v0 as v0
from contract_v0 import contract_sha256

ADAPTER = "musubi-native"


def _host(url):
    m = re.match(r"^https://([A-Za-z0-9.-]+)(?::\d+)?/", url) if isinstance(url, str) else None
    return m.group(1).lower() if m else None


def key_on_own_domain(party):
    d = party.get("domain") if isinstance(party, dict) else None
    h = _host(party.get("key_url")) if isinstance(party, dict) else None
    return isinstance(d, str) and bool(d) and h is not None and (h == d.lower() or h.endswith("." + d.lower()))


def read(contract, child=None, card_jws=None):
    door = isinstance(contract, dict) and v0.verify_contract(contract).get("verdict") == "accepted"
    parties = [p for p in (contract.get("parties") or []) if isinstance(p, dict)] if isinstance(contract, dict) else []
    own = len(parties) == 2 and all(key_on_own_domain(p) for p in parties)
    checks = {"contract_door": bool(door), "keys_on_own_domain": bool(own), "card_jws": card_jws if isinstance(card_jws, bool) else None}
    item = {"adapter": ADAPTER, "sha256": contract_sha256(contract) if isinstance(contract, dict) else None,
            "verified": bool(door and own and card_jws is not False), "checks": checks}
    if child is not None:
        child_ok = isinstance(child, dict) and v0.verify_contract(child, parent=contract).get("verdict") == "accepted"
        violations = v0.grant_subset(child.get("grant") or {}, contract.get("grant") or {}) if (isinstance(child, dict) and isinstance(contract, dict)) else ["child or parent is not a contract"]
        item["within_parent"] = not violations
        item["delegation"] = {"child_contract_sha256": contract_sha256(child) if isinstance(child, dict) else None,
                              "child_door": bool(child_ok), "violations": len(violations)}
        item["grant"] = child.get("grant") if isinstance(child, dict) and isinstance(child.get("grant"), dict) else None
        item["sha256"] = item["delegation"]["child_contract_sha256"]
        item["verified"] = bool(item["verified"] and child_ok)
    return item


def _selftest():
    import admit_fixtures as F
    w = F.World()
    n = 0
    P = w.contracts["plain"]
    it = read(P)
    assert it["verified"] is True and it["sha256"] == contract_sha256(P) and it["checks"] == {"contract_door": True, "keys_on_own_domain": True, "card_jws": None}
    n += 1; print("[1] a contract both parties signed, keys on their own domains: verified true; card_jws stays null because nothing here checked the card")
    bad = dict(P, nonce="f" * 32)
    assert read(bad)["verified"] is False and read(bad)["checks"]["contract_door"] is False
    assert read({})["verified"] is False and read(None)["verified"] is False
    assert read(P, card_jws=False)["verified"] is False and read(P, card_jws=True)["verified"] is True
    n += 1; print("[2] a contract edited after signing, an empty object, a card check the caller reports as failed: verified false")
    off = w.mk(None, "9" * 32)
    off2 = dict(off); off2["parties"] = [dict(p) for p in off["parties"]]; off2["parties"][1]["key_url"] = "https://keys.elsewhere.example/k.json"
    assert key_on_own_domain(off["parties"][1]) and not key_on_own_domain(off2["parties"][1])
    assert key_on_own_domain({"domain": "example.com", "key_url": "https://gate.example.com/keys/a.json"})
    assert not key_on_own_domain({"domain": "example.com", "key_url": "https://notexample.com/k.json"})
    assert not key_on_own_domain({"domain": "example.com", "key_url": "http://example.com/k.json"})
    n += 1; print("[3] key_url must be https on the party's domain or a subdomain of it; a look-alike suffix and plain http are not")
    wide = {"authorized_actions": ["read", "emit_witness", "refund", "transfer"]}
    narrow_g = w.grant(None); narrow_g["authorized_actions"] = ["read"]
    assert v0.grant_subset(narrow_g, P["grant"]) == [] and v0.grant_subset(dict(P["grant"], **wide), P["grant"]) != []
    it = read(P, child={"grant": dict(P["grant"], **wide)})
    assert it["within_parent"] is False and it["verified"] is False and it["delegation"]["violations"] >= 1
    it = read(P, child={"grant": narrow_g})
    assert it["within_parent"] is True and it["grant"]["authorized_actions"] == ["read"] and it["verified"] is False
    n += 1; print("[4] a delegated grant wider than its parent: within_parent false; a narrower one: within_parent true and its grant is carried; an unsigned child never reads as verified")
    print("\nSELF-TEST PASSED: admission adapter musubi-native, %d checks (verified is the contract door and keys on own domains; null card check; delegation by grant_subset)" % n)


if __name__ == "__main__":
    _selftest() if "--selftest" in sys.argv else print(__doc__)
