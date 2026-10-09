#!/usr/bin/env python3
"""vouch_check_test: the reader side of vouch-pin-v0 against credentials Vouch Protocol's SDK made (fixtures/), a
synthetic ledger that answers the way vouch_pin_v0.mjs does, a synthetic OpenTimestamps path and a mined regtest header
view. No network. Run: python3 vouch_check_test.py   (needs the cryptography package)"""
import copy, hashlib, json, os, sys, struct

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "musubi-v0"))
import vouch_check as VC  # noqa: E402
import anchor_compose as AC  # noqa: E402
import settle_v1_1 as v11  # noqa: E402

FX = json.load(open(os.path.join(HERE, "fixtures", "vouch_fixtures.json"), encoding="utf-8"))
C = {c["name"]: c for c in FX["cases"]}
L = "https://ledger.test"
results = []


def t(name, ok, detail=""):
    results.append((name, bool(ok), detail))


def did_fetcher(url):
    host = url.split("/")[2]
    doc = FX["did_documents"].get("did:web:" + host)
    if doc is None:
        raise OSError("404")
    return 200, json.dumps(doc).encode()


# ---- the proof and the digest, against Vouch's own answers ----------------------------------------------------
for c in FX["cases"]:
    ok, rule, _d, why = VC.verify_proof(copy.deepcopy(c["credential"]), did_fetcher)
    t(c["name"] + ": verifies here as it did in Vouch's verify_proof", ok and c["vouch_verify_proof"], why)
    t(c["name"] + ": JCS sha here == Vouch's JCS sha", VC.sha_hex(VC.jcs(c["credential"]).encode()) == c["vouch_jcs_sha256"])
x = copy.deepcopy(C["commitment_didkey"]["credential"]); x["credentialSubject"]["claim"]["verdict"] = "no"
t("an edited claim does not verify", not VC.verify_proof(x, did_fetcher)[0])
x = copy.deepcopy(C["commitment_didkey"]["credential"]); x["issuer"] = "did:web:vouch-protocol.com"
t("another issuer over the same proof does not verify", not VC.verify_proof(x, did_fetcher)[0])


def sign_as(doc, vm, self_issued=False):
    """A correct eddsa-jcs-2022 proof by a fresh did:key, over whatever the document says (the attacker's own key)."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives import serialization
    k = Ed25519PrivateKey.generate()
    raw = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    n = int.from_bytes(b"\xed\x01" + raw, "big"); s = ""
    while n:
        n, r = divmod(n, 58); s = VC.B58[r] + s
    did = "did:key:z" + s
    vm = vm or did + "#key-1"
    if self_issued:
        doc = {**doc, "issuer": did}
    proof = {"type": "DataIntegrityProof", "cryptosuite": "eddsa-jcs-2022", "created": "2026-10-09T12:00:00Z", "verificationMethod": vm, "proofPurpose": "assertionMethod"}
    cfg = dict(proof); cfg["@context"] = doc["@context"]
    msg = hashlib.sha256(VC.jcs(cfg).encode()).digest() + hashlib.sha256(VC.jcs(doc).encode()).digest()
    sig = k.sign(msg); n = int.from_bytes(sig, "big"); s = ""
    while n:
        n, r = divmod(n, 58); s = VC.B58[r] + s
    s = "1" * (len(sig) - len(sig.lstrip(b"\x00"))) + s     # base58btc keeps leading zero bytes as "1"
    return {**doc, "proof": {**proof, "proofValue": "z" + s}}, did


body = {k: v for k, v in C["commitment_didkey"]["credential"].items() if k != "proof"}
own, did = sign_as(body, None, self_issued=True)
t("control: a credential an attacker signs as itself, with itself as issuer, verifies", VC.verify_proof(own, did_fetcher)[0])
claimed = {k: v for k, v in body.items()}
claimed["issuer"] = C["commitment_didkey"]["credential"]["issuer"]
forged, adid = sign_as(claimed, None)
t("a valid signature by the attacker's key on a credential naming someone else as issuer: refused", not VC.verify_proof(forged, did_fetcher)[0]
  and "not the issuer" in (VC.verify_proof(forged, did_fetcher)[3] or ""))


# ---- a synthetic ledger --------------------------------------------------------------------------------------
def build(creds, listed=None, block_t=1791600000, height=101, lie_claim=False, pins_by_id=None):
    shas = [VC.sha_hex(VC.jcs(c).encode()) for c in creds]
    listed = shas if listed is None else listed
    batch = {"schema": "nenrin-vouch-pin-batch-v0", "anchored_at": "2026-10-10T00:30:00Z", "count": len(listed),
             "records": [{"sha": s, "issuer": "x"} for s in listed]}
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
    entry = {"n": 900, "claim_sha256": ("0" * 64) if lie_claim else claim.hex(), "block_time": VC.iso(block_t), "bitcoin_block": height}
    routes = {L + "/ledger/900": json.dumps(entry).encode(), L + "/ledger/900?format=raw": bb, L + "/ledger/900/ots": ots}
    for c, s in zip(creds, shas):
        routes[L + "/evidence/vouch/" + s] = json.dumps({"sha": s, "issuer": c["issuer"], "status": "anchored", "received_at": "2026-10-09T13:00:00Z",
                                                          "anchor": {"ledger_entry": 900}}).encode()
    ids = pins_by_id or {}
    for c, s in zip(creds, shas):
        ids.setdefault(c["id"], []).append({"sha": s, "issuer": c["issuer"]})
    for cid, pins in ids.items():
        routes[L + "/evidence/vouch/id/" + VC.urllib.parse.quote(cid, safe="")] = json.dumps({"pins": pins}).encode()

    def fetcher(url):
        if url in routes:
            return 200, routes[url]
        if url.startswith("https://") and "/.well-known/did.json" in url:
            return did_fetcher(url)
        raise OSError("404 " + url)
    return fetcher, {"headers": headers}, shas


cred = copy.deepcopy(C["commitment_didkey"]["credential"])
F, VIEW, (S,) = build([cred])
r = VC.check(cred, L, F, view=VIEW, floor_bits="207fffff", outcome_time="2027-01-01T00:00:00Z")
t("honest: verifies, anchored, no problems", r["proof"]["verifies"] and r["anchored"] and not r["problems"], r["problems"])
t("honest: the block time is taken from the checked header, not from the ledger", r["block_time_source"].startswith("the header in the view") and r["block_time"] == VC.iso(1791600000))
t("honest: an outcome on 2027-01-01 is preceded by the anchor", r["precedence"] == "precedes")
r = VC.check(cred, L, F, view=VIEW, floor_bits="207fffff", outcome_time=VC.iso(1791600000 + 3600))
t("an outcome one hour after the block: within_block_time_tolerance, not precedes", r["precedence"] == "within_block_time_tolerance")
r = VC.check(cred, L, F, view=VIEW, floor_bits="207fffff", outcome_time="2026-10-01T00:00:00Z")
t("an outcome before the block: after", r["precedence"] == "after")
r = VC.check(cred, L, F, view=None, outcome_time="2027-01-01T00:00:00Z")
t("no header view: the ledger's time is reported as NOT checked", "NOT checked" in r["block_time_source"])
r = VC.check(cred, L, F, view=VIEW, outcome_time="2027-01-01T00:00:00Z")
t("regtest headers against the default mainnet floor: refused, no precedence verdict", any("floor" in p for p in r["problems"]) and "precedence" not in r, r["problems"])
bad = copy.deepcopy(VIEW); bad["headers"][1]["hex"] = VIEW["headers"][1]["hex"][:72] + "00" * 32 + VIEW["headers"][1]["hex"][136:]
r = VC.check(cred, L, F, view=bad, floor_bits="207fffff")
t("a header whose merkle root was swapped: problem named (work or merkle)", r["problems"], r["problems"])

# a header view with real work and linkage whose block at the attested height has another merkle root
F6, V6, _ = build([cred])
wrong = []
prev = "00" * 32
for h in V6["headers"]:
    raw = bytes.fromhex(h["hex"])
    merkle = hashlib.sha256(b"not the batch").digest() if h["height"] == 101 else raw[36:68]
    raw2 = v11._mine(prev, merkle, t=struct.unpack("<I", raw[68:72])[0], salt=h["height"] + 7)
    wrong.append({"height": h["height"], "hex": raw2.hex()}); prev = v11.header_hash(raw2)
r = VC.check(cred, L, F6, view={"headers": wrong}, floor_bits="207fffff", outcome_time="2027-01-01T00:00:00Z")
t("a well-formed view whose block 101 has another merkle root: refused by name, no precedence verdict", any("merkle root" in p for p in r["problems"]) and "precedence" not in r, r["problems"])

F2, V2, _ = build([cred], listed=["ab" * 32])
r = VC.check(cred, L, F2, view=V2, floor_bits="207fffff")
t("a batch that does not list the sha: not anchored", not r["anchored"] and any("exactly once" in p for p in r["problems"]))
F3, V3, _ = build([cred], lie_claim=True)
r = VC.check(cred, L, F3, view=V3, floor_bits="207fffff")
t("an entry whose claim is not the batch's sha: not anchored", not r["anchored"])

other = copy.deepcopy(C["commitment_didkey_same_id_other_verdict"]["credential"])
F4, V4, shas = build([cred, other])
r = VC.check(cred, L, F4, view=V4, floor_bits="207fffff")
t("two credentials under one id by one issuer: equivocation reported, both shas named", sorted(r.get("equivocation", [])) == sorted(shas) and any("different credentials" in p for p in r["problems"]))
t("...and the anchoring itself is still reported as true (a separate fact)", r["anchored"])

x = copy.deepcopy(cred); x["credentialSubject"]["claim"]["verdict"] = "maybe"
r = VC.check(x, L, F, view=VIEW, floor_bits="207fffff")
t("an edited credential: the proof fails and the sha is not pinned", not r["proof"]["verifies"] and r["anchored"] is False)

w = copy.deepcopy(C["commitment_didweb_multibase"]["credential"])
F5, V5, _ = build([w])
r = VC.check(w, L, F5, view=V5, floor_bits="207fffff")
t("did:web issuer: resolved from its document and anchored", r["proof"]["verifies"] and r["anchored"], r["problems"])

bad = [r for r in results if not r[1]]
for name, ok, d in results:
    print(("ok    " if ok else "FAIL  ") + name + ("" if ok else "  [%s]" % (d,)))
print("\n%d/%d passed" % (len(results) - len(bad), len(results)))
sys.exit(1 if bad else 0)
