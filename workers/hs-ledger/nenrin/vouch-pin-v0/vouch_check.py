#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vouch_check: recompute, without trusting the NENRIN ledger or the issuer, what a Vouch credential pinned there proves.

    python3 vouch_check.py --credential commitment.json [--outcome-time 2027-01-01T00:00:00Z] [--headers view.json]

Given the signed credential (the JSON the issuer published), this:
  1. verifies its eddsa-jcs-2022 proof here (did:key offline; did:web from the issuer's document, compared with the
     sha256 the ledger recorded at intake);
  2. computes sha256 of its RFC 8785 form and finds every credential the ledger holds under the same id, so an issuer
     who pinned two different credentials under one id is reported (equivocation);
  3. reads the ledger batch that lists the sha, checks sha256(batch bytes) is the ledger entry's claim and the sha is
     exactly one records[i] of a nenrin-vouch-pin-batch-v0 batch;
  4. reads the entry's OpenTimestamps proof with no library (musubi-v0/anchor_compose.read_ots), and, given a header
     view, checks the attested block's merkle root, the chain linkage and the proof of work, and takes the block time
     from the header itself; without a view it reports the time the ledger serves, marked as not checked;
  5. with --outcome-time, says whether the block time precedes it by more than Bitcoin's own timestamp tolerance
     (two hours plus a minute). That is the check Vouch's accountability module leaves to the consumer of an anchor
     marked pre-outcome-ordering.
Exit 0 when the credential verifies and is anchored in a batch that lists it, 1 otherwise, 2 on usage errors.
Standard library plus the cryptography package (Ed25519).
"""
import argparse, base64, hashlib, json, os, struct, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "musubi-v0"))
import anchor_compose as AC  # noqa: E402  (read_ots: the OTS reader settle uses)

SLACK = 7260
BATCH_SCHEMA = "nenrin-vouch-pin-batch-v0"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


# ---------------------------------------------------------------------------- RFC 8785
def _key16(k):
    return k.encode("utf-16-be")


def jcs(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        if abs(v) > 9007199254740991:
            raise ValueError("integer outside the safe range has no single JCS form")
        return str(v)
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("non-finite number")
        if v == int(v) and abs(v) < 1e21:
            return str(int(v))
        return json.dumps(v)   # repr round trip; matches ES Number-to-String for the values VCs carry
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + jcs(v[k]) for k in sorted(v, key=_key16)) + "}"
    raise ValueError("not a JSON value")


def sha_hex(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------------------- keys and the proof
def b58decode(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    out = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * (len(s) - len(s.lstrip("1"))) + out


def multikey_ed25519(mk):
    b = b58decode(mk[1:]) if mk.startswith("z") else b""
    if len(b) != 34 or b[:2] != b"\xed\x01":
        raise ValueError("not an Ed25519 Multikey")
    return b[2:]


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "nenrin-vouch-check/0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def resolve(did, vm, fetcher):
    if did.startswith("did:key:"):
        return multikey_ed25519(did[len("did:key:"):]), None
    if did.startswith("did:web:"):
        host = did[len("did:web:"):]
        if ":" in host or "%" in host:
            raise ValueError("v0 reads did:web:<host> only")
        st, body = fetcher("https://%s/.well-known/did.json" % host)
        doc = json.loads(body.decode("utf-8"))
        if doc.get("id") != did:
            raise ValueError("the DID document names another id")
        full = lambda i: did + i if isinstance(i, str) and i.startswith("#") else i  # noqa: E731
        for m in doc.get("verificationMethod") or []:
            if full(m.get("id")) == vm:
                if isinstance(m.get("publicKeyMultibase"), str):
                    return multikey_ed25519(m["publicKeyMultibase"]), sha_hex(body)
                jwk = m.get("publicKeyJwk") or {}
                if jwk.get("kty") == "OKP" and jwk.get("crv") == "Ed25519":
                    x = jwk["x"]
                    return base64.urlsafe_b64decode(x + "=" * (-len(x) % 4)), sha_hex(body)
        raise ValueError("verification method not in the DID document")
    raise ValueError("v0 resolves did:key and did:web only")


def verify_proof(cred, fetcher):
    """(ok, rule, did_document_sha256, why)"""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature
    p = cred.get("proof") or {}
    if p.get("type") != "DataIntegrityProof" or p.get("cryptosuite") != "eddsa-jcs-2022":
        return False, None, None, "not an eddsa-jcs-2022 DataIntegrityProof"
    vm = p.get("verificationMethod") or ""
    did = vm.split("#")[0]
    issuer = cred.get("issuer") if isinstance(cred.get("issuer"), str) else (cred.get("issuer") or {}).get("id")
    if did != issuer:
        return False, None, None, "the proof's key is not the issuer's (%s vs %s)" % (did, issuer)
    try:
        raw, docsha = resolve(did, vm, fetcher)
    except Exception as e:  # noqa: BLE001
        return False, None, None, "issuer key not resolved: %s" % e
    sig = b58decode(p.get("proofValue", "z")[1:])
    doc = {k: v for k, v in cred.items() if k != "proof"}
    unsigned = {k: v for k, v in p.items() if k != "proofValue"}
    config = dict(unsigned)
    if "@context" in doc:
        config["@context"] = doc["@context"]
    w3c = hashlib.sha256(jcs(config).encode()).digest() + hashlib.sha256(jcs(doc).encode()).digest()
    legacy = hashlib.sha256(jcs({**doc, "proof": unsigned}).encode()).digest()
    pk = Ed25519PublicKey.from_public_bytes(raw)
    for rule, msg in (("w3c-vc-di-eddsa-hashdata", w3c), ("vouch-pre-alignment-digest", legacy)):
        try:
            pk.verify(sig, msg)
            return True, rule, docsha, None
        except InvalidSignature:
            continue
    return False, None, docsha, "the proof does not verify under the issuer's key"


# ---------------------------------------------------------------------------- headers
def _bits_target(bits):
    exp, mant = bits >> 24, bits & 0x007fffff
    return mant * (1 << (8 * (exp - 3))) if exp >= 3 else mant >> (8 * (3 - exp))


def header_time(view, height, merkle, floor_bits):
    """Check a header view {"headers": [{"height", "hex"}]}: linkage, each header's work against its own bits and the
    floor, and the merkle root at `height`. Returns (unix time, header hash) or raises ValueError."""
    hs = sorted(view.get("headers") or [], key=lambda h: h["height"])
    floor = _bits_target(int(floor_bits, 16))
    prev = None
    found = None
    for h in hs:
        raw = bytes.fromhex(h["hex"])
        if len(raw) != 80:
            raise ValueError("header %s is not 80 bytes" % h["height"])
        hh = hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1]
        bits = struct.unpack("<I", raw[72:76])[0]
        t = _bits_target(bits)
        if t > floor or int.from_bytes(hh, "big") > t:
            raise ValueError("header %s does not carry the work its bits claim, or is under the floor" % h["height"])
        if prev is not None:
            if h["height"] != prev[0] + 1 or raw[4:36][::-1] != prev[1]:
                raise ValueError("header %s does not link to %s" % (h["height"], prev[0]))
        prev = (h["height"], hh)
        if h["height"] == height:
            found = (raw, hh)
    if not found:
        raise ValueError("no header at height %d in the view" % height)
    raw, hh = found
    if raw[36:68] != merkle:
        raise ValueError("the OTS path does not reach the merkle root of block %d" % height)
    return struct.unpack("<I", raw[68:72])[0], hh.hex()


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(s):
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


# ---------------------------------------------------------------------------- the check
def check(cred, ledger, fetcher=fetch, view=None, floor_bits="1903a30c", outcome_time=None):
    rep = {"schema": "nenrin-vouch-check-v0", "ledger": ledger, "problems": []}
    prob = rep["problems"].append
    ok, rule, docsha, why = verify_proof(cred, fetcher)
    rep["proof"] = {"verifies": ok, "rule": rule, "why": why}
    body = jcs(cred).encode("utf-8")
    sha = sha_hex(body)
    rep["sha256"] = sha
    rep["credential_id"] = cred.get("id")
    if not ok:
        prob("proof: %s" % why)
    # the ledger's record of this sha
    try:
        st, b = fetcher("%s/evidence/vouch/%s" % (ledger, sha))
        pin = json.loads(b.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        prob("not pinned (or the ledger did not answer): %s" % e)
        rep["anchored"] = False
        return rep
    rep["pinned_at"] = pin.get("received_at")
    if docsha and pin.get("did_document_sha256") and docsha != pin["did_document_sha256"]:
        rep["did_document_changed_since_intake"] = True
    # equivocation under the id
    if isinstance(cred.get("id"), str):
        try:
            st, b = fetcher("%s/evidence/vouch/id/%s" % (ledger, urllib.parse.quote(cred["id"], safe="")))
            ids = json.loads(b.decode("utf-8"))
            same_issuer = [p["sha"] for p in ids.get("pins") or [] if p.get("issuer") == pin.get("issuer")]
            rep["credentials_under_this_id_by_this_issuer"] = len(same_issuer)
            if len(same_issuer) > 1:
                rep["equivocation"] = sorted(same_issuer)
                prob("the issuer pinned %d different credentials under this id" % len(same_issuer))
        except Exception as e:  # noqa: BLE001
            prob("could not read the pins under this id: %s" % e)
    a = pin.get("anchor") or {}
    n = a.get("ledger_entry")
    if n is None:
        rep["anchored"] = False
        prob("pinned, not yet in a batch (status %s)" % pin.get("status"))
        return rep
    # leg 1: the batch lists the sha, and is the entry's claim
    p0 = len(rep["problems"])
    st, eb = fetcher("%s/ledger/%d" % (ledger, n))
    entry = json.loads(eb.decode("utf-8"))
    st, batch_bytes = fetcher("%s/ledger/%d?format=raw" % (ledger, n))
    claim = sha_hex(batch_bytes)
    rep["ledger_entry"] = n
    if claim != entry.get("claim_sha256"):
        prob("the batch bytes hash to %s, the entry claims %s" % (claim, entry.get("claim_sha256")))
    try:
        batch = json.loads(batch_bytes.decode("utf-8"))
        recs = batch.get("records") or []
        listed = [r for r in recs if isinstance(r, dict) and r.get("sha") == sha]
        if batch.get("schema") != BATCH_SCHEMA or batch.get("count") != len(recs) or len(listed) != 1:
            prob("the batch is not a %s that lists this sha exactly once" % BATCH_SCHEMA)
    except Exception:  # noqa: BLE001
        prob("the batch is not JSON")
    # leg 2: OTS
    try:
        st, ots = fetcher("%s/ledger/%d/ots" % (ledger, n))
        digest, atts = AC.read_ots(ots)
    except Exception as e:  # noqa: BLE001
        prob("no readable OpenTimestamps proof yet: %s" % e)
        rep["anchored"] = False
        return rep
    if digest.hex() != claim:
        prob("the .ots stamps %s, not the batch %s" % (digest.hex(), claim))
    btc = [x for x in atts if x.get("kind") == "bitcoin" and x.get("msg") is not None]
    rep["bitcoin_attestations"] = [{"height": x["height"]} for x in btc]
    if not btc:
        prob("the .ots has no Bitcoin attestation yet (pending at the calendars; run ots upgrade or wait)")
        rep["anchored"] = False
        return rep
    rep["anchored"] = len(rep["problems"]) == p0
    # leg 3: the block, its time
    lowest = min(btc, key=lambda x: x["height"])
    rep["block_height"] = lowest["height"]
    if view is not None:
        try:
            t, hh = header_time(view, lowest["height"], lowest["msg"], floor_bits)
            rep["block_time"], rep["block_hash"], rep["block_time_source"] = iso(t), hh, "the header in the view you gave, merkle root, linkage and work checked here"
        except ValueError as e:
            prob("header view: %s" % e)
            t = None
    else:
        bt = entry.get("block_time")
        t = parse_time(bt) if isinstance(bt, str) and bt else None
        rep["block_time"] = bt
        rep["block_time_source"] = "as served by the ledger, NOT checked here; pass --headers view.json (headers from two explorers that agree) to check it"
    if outcome_time and t is not None:
        o = parse_time(outcome_time)
        rep["outcome_time"] = outcome_time
        if t + SLACK < o:
            rep["precedence"] = "precedes"
        elif t - SLACK > o:
            rep["precedence"] = "after"
        else:
            rep["precedence"] = "within_block_time_tolerance"
        rep["precedence_rule"] = "precedes only when block time + 7260 s (Bitcoin's two hour future limit plus a minute) is before the outcome time"
    rep["establishes"] = ["the credential verifies under its issuer's key" if ok else "nothing about the signature",
                          "the exact bytes existed before block %d (the lowest Bitcoin attestation)" % lowest["height"]]
    rep["does_not_establish"] = ["that the claim is true", "that the issuer's key was not stolen or revoked",
                                 "a precedence verdict when block_time_source says not checked"]
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--credential", required=True, help="the signed credential, a JSON file")
    ap.add_argument("--ledger", default="https://ledger.horizonshield.dev")
    ap.add_argument("--headers", help="a header view {\"headers\": [{\"height\", \"hex\"}]} covering the attested block")
    ap.add_argument("--max-target-bits", default="1903a30c", help="the easiest target a header may claim (compact nBits hex)")
    ap.add_argument("--outcome-time", help="the settlement time (ISO 8601) to compare the anchor with")
    a = ap.parse_args()
    cred = json.load(open(a.credential, encoding="utf-8"))
    view = json.load(open(a.headers, encoding="utf-8")) if a.headers else None
    rep = check(cred, a.ledger.rstrip("/"), view=view, floor_bits=a.max_target_bits, outcome_time=a.outcome_time)
    print(json.dumps(rep, indent=2, ensure_ascii=False))
    return 0 if rep["proof"]["verifies"] and rep.get("anchored") and not rep["problems"] else 1


if __name__ == "__main__":
    sys.exit(main())
