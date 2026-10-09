#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Admission adapter "aps-v2": reads an Agent Passport System passport (record_type "aps.agent-passport", version "2.0")
and returns the presentation item admit_v0.admit() takes. It normalizes input. It decides nothing.

The Agent Passport System is aeoess's (https://github.com/agent-passport-system/agent-passport-system, Apache-2.0).
This file reads its records; it issues none and is not part of that project.

    item = read(passport)                 {"adapter": "aps-v2", "sha256", "verified": null, "self_asserted": true, "aps": {...}}
    item = read(passport, receipt=r)      also the sha256 of an APS receipt the agent showed

verified is null, on purpose. The 2.0 passport's identifier and signature are computed in the official SDK by
src/v2/identity-binding/passport.ts. That repository (package 7.2.1, commit c31d94aa, read 2026-10-10) carries no
frozen vectors for the 2.0 shape: no signed passport with the result a verifier must give. A port that has never been
held against the official implementation's own answers has not earned "verified": true, so this adapter returns null
for every 2.0 passport. admit() reads null as not verified and refuses, or escalates if the relying party's policy
says so. It never admits on it. What this file computed is reported under aps.local_check and named unconfirmed.

How it becomes true. fixtures/aps_agent_passport_system/README.md says where the official vectors go and in what
form. When that file exists, hashes to VECTORS_SHA256 below, and this adapter agrees with every vector in it, read()
returns verified true for a passport whose local check is valid, and false for one whose local check is invalid.

self_asserted. A 2.0 passport's capabilities sit under "self_asserted" in the record itself: the agent states them
and nobody else has signed them. This adapter copies that distinction (self_asserted: true, and the capabilities
under aps.capabilities_self_asserted). It does not turn capabilities into a grant: a grant is what a principal
signed, and a 2.0 passport carries no principal's signature. grant is therefore absent, and admit reads the action
against the MUSUBI contract alone.

What was checked against an official artifact. The SDK's legacy canonical form and hex Ed25519 signatures, on one
signed passport written by the SDK itself (fixtures/aps_agent_passport_system/valid-signed-passport.json, the
"1.0.0" shape). The self test runs that check. It says nothing about the 2.0 shape.
"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

ADAPTER = "aps-v2"
SOURCE = {"repository": "https://github.com/agent-passport-system/agent-passport-system", "package": "agent-passport-system 7.2.1",
          "commit": "c31d94aad86713ae9b2e4cbc811deeab4b5d91ed", "license": "Apache-2.0", "read": "2026-10-10"}
FIX = os.path.join(HERE, "fixtures", "aps_agent_passport_system")
VECTORS_PATH = os.path.join(FIX, "passport-v2-vectors.json")
VECTORS_SHA256 = None            # set to the sha256 of the official vectors file when there is one
ID_DOMAIN = "APS-PASSPORT-ID-V2\0"
SIG_DOMAIN = "APS-PASSPORT-SIG-V2\0"
KEYS = ("record_type", "version", "passport_id", "agent_id", "verification_method", "public_key_multibase", "issued_at",
        "expires_at", "nonce", "self_asserted", "signature")
UTC_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


# --------------------------------------------------------------------------- the two canonical forms the SDK uses
def jcs(v):
    """RFC 8785 for the values a 2.0 passport holds: strings, integers, booleans, null, arrays, objects. A float has no form here."""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        if abs(v) > 9007199254740991:
            raise ValueError("integer outside the I-JSON safe range")
        return str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + jcs(v[k]) for k in keys) + "}"
    raise ValueError("no canonical form for %s" % type(v).__name__)


def legacy_canonical(v):
    """The SDK's first canonicalize(): keys sorted, object members whose value is null dropped, arrays kept as they are."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, str)):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(legacy_canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + legacy_canonical(v[k]) for k in sorted(v) if v[k] is not None) + "}"
    raise ValueError("no canonical form for %s" % type(v).__name__)


def ed25519_hex_ok(message_utf8, sig_hex, pub_hex):
    if not (isinstance(sig_hex, str) and re.match(r"^[0-9a-f]{128}$", sig_hex) and isinstance(pub_hex, str) and re.match(r"^[0-9a-f]{64}$", pub_hex)):
        return False
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex)).verify(bytes.fromhex(sig_hex), message_utf8.encode("utf-8"))
        return True
    except Exception:
        return False


def b58decode(s):
    n = 0
    for ch in s:
        n = n * 58 + B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * (len(s) - len(s.lstrip("1"))) + raw


def multibase_to_hex(mb):
    """'z' + base58btc(0xed 0x01 + 32 key bytes) -> hex, or None."""
    if not (isinstance(mb, str) and re.match(r"^z[1-9A-HJ-NP-Za-km-z]+$", mb)):
        return None
    b = b58decode(mb[1:])
    return b[2:].hex() if len(b) == 34 and b[:2] == b"\xed\x01" else None


# --------------------------------------------------------------------------- the 2.0 passport, as this file reads it
def shape_problem(p):
    if not isinstance(p, dict) or set(p) != set(KEYS):
        return "keys"
    if p.get("record_type") != "aps.agent-passport" or p.get("version") != "2.0":
        return "profile"
    if not all(isinstance(p.get(k), str) for k in KEYS if k != "self_asserted"):
        return "types"
    if not re.match(r"^did:[a-z0-9]+:.+$", p["agent_id"]) or not p["verification_method"].startswith(p["agent_id"] + "#"):
        return "identifier"
    if multibase_to_hex(p["public_key_multibase"]) is None:
        return "public_key_multibase"
    if not (UTC_MS.match(p["issued_at"]) and UTC_MS.match(p["expires_at"]) and p["issued_at"] < p["expires_at"]):
        return "time window"
    if not re.match(r"^[0-9a-f]{32}$", p["nonce"]) or not re.match(r"^[0-9a-f]{64}$", p["passport_id"]) or not re.match(r"^[0-9a-f]{128}$", p["signature"]):
        return "hex fields"
    sa = p.get("self_asserted")
    if not isinstance(sa, dict) or not set(sa) <= {"capabilities", "display_name"} or "capabilities" not in sa:
        return "self_asserted"
    caps = sa["capabilities"]
    if not (isinstance(caps, list) and all(isinstance(c, str) for c in caps) and caps == sorted(set(caps))):
        return "capabilities"
    if "display_name" in sa and not isinstance(sa["display_name"], str):
        return "display_name"
    return None


def local_check(p, now=None):
    """This file's own reading of a 2.0 passport, following verifyPassportV2 step by step. Unconfirmed until official vectors exist."""
    why = shape_problem(p)
    if why:
        return {"state": "invalid", "code": "PASSPORT_MALFORMED", "detail": why}
    id_form = {k: v for k, v in p.items() if k not in ("passport_id", "signature")}
    if sha256_hex((ID_DOMAIN + jcs(id_form)).encode("utf-8")) != p["passport_id"]:
        return {"state": "invalid", "code": "PASSPORT_ID_MISMATCH"}
    pub = multibase_to_hex(p["public_key_multibase"])
    if not ed25519_hex_ok(SIG_DOMAIN + jcs({k: v for k, v in p.items() if k != "signature"}), p["signature"], pub):
        return {"state": "invalid", "code": "PASSPORT_SIGNATURE_INVALID"}
    if now is not None and (now < p["issued_at"] or now >= p["expires_at"]):
        return {"state": "invalid", "code": "PASSPORT_NOT_CURRENT", "proof_of_possession": True}
    if p["agent_id"].startswith("did:key:") or p["agent_id"].startswith("did:aps:"):
        derived = multibase_to_hex(p["agent_id"].split(":", 2)[2])
        if derived != pub:
            return {"state": "invalid", "code": "PASSPORT_KEY_AUTHORITY_REJECTED", "proof_of_possession": True, "key_authority": "rejected"}
        return {"state": "valid", "code": "OK", "proof_of_possession": True, "key_authority": "verified"}
    return {"state": "indeterminate", "code": "PASSPORT_KEY_AUTHORITY_UNRESOLVED", "proof_of_possession": True, "key_authority": "unresolved"}


def vectors_status():
    """{"status": "not_available" | "hash_mismatch" | "disagree" | "agree", ...}. Only "agree" lets read() return a boolean."""
    if not os.path.exists(VECTORS_PATH):
        return {"status": "not_available", "reason": "the official repository carries no frozen vectors for the 2.0 passport", "source": SOURCE}
    raw = open(VECTORS_PATH, "rb").read()
    if VECTORS_SHA256 is None or sha256_hex(raw) != VECTORS_SHA256:
        return {"status": "hash_mismatch", "reason": "passport-v2-vectors.json is not the file this adapter pins", "sha256": sha256_hex(raw)}
    vs = json.loads(raw.decode("utf-8")).get("vectors") or []
    bad = [v.get("id") for v in vs if {k: local_check(v.get("passport"), v.get("now")).get(k) for k in ("state", "code")} != {k: (v.get("expect") or {}).get(k) for k in ("state", "code")}]
    if bad or not vs:
        return {"status": "disagree", "vectors": len(vs), "disagreeing": bad}
    return {"status": "agree", "vectors": len(vs), "sha256": VECTORS_SHA256}


def read(passport, receipt=None, now=None):
    vec = vectors_status()
    try:
        lc = local_check(passport, now)
        sha = sha256_hex(jcs(passport).encode("utf-8")) if isinstance(passport, dict) else None
    except Exception as e:
        lc, sha = {"state": "invalid", "code": "PASSPORT_MALFORMED", "detail": type(e).__name__}, None
    verified = None
    if vec["status"] == "agree":
        verified = True if lc["state"] == "valid" else (False if lc["state"] == "invalid" else None)
    item = {"adapter": ADAPTER, "sha256": sha, "verified": verified, "self_asserted": True,
            "aps": {"record_type": passport.get("record_type") if isinstance(passport, dict) else None,
                    "version": passport.get("version") if isinstance(passport, dict) else None,
                    "passport_id": passport.get("passport_id") if isinstance(passport, dict) else None,
                    "agent_id": passport.get("agent_id") if isinstance(passport, dict) else None,
                    "capabilities_self_asserted": list(((passport.get("self_asserted") or {}).get("capabilities") or [])) if isinstance(passport, dict) and isinstance(passport.get("self_asserted"), dict) else [],
                    "local_check": dict(lc, confirmed_against_official_vectors=(vec["status"] == "agree")),
                    "vectors": vec}}
    if receipt is not None:
        try:
            item["aps"]["receipt_sha256"] = sha256_hex(legacy_canonical(receipt).encode("utf-8"))
        except Exception:
            item["aps"]["receipt_sha256"] = None
    return item


# --------------------------------------------------------------------------- self test
def _issue_for_selftest(seed, agent_id=None, **over):
    """A 2.0 passport made here, by this file's own reading of the rules. It tests this file against itself, nothing more."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(seed.encode()).digest())
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    n = int.from_bytes(b"\xed\x01" + pub, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = B58[r] + s
    mb = "z" + s
    aid = agent_id or "did:key:" + mb
    d = {"record_type": "aps.agent-passport", "version": "2.0", "agent_id": aid,
         "verification_method": aid + "#" + (mb if aid.startswith("did:key:") else "key-1"), "public_key_multibase": mb,
         "issued_at": "2026-07-16T18:00:00.000Z", "expires_at": "2026-07-19T18:00:00.000Z", "nonce": "01" * 16,
         "self_asserted": {"display_name": "Procurement agent", "capabilities": ["commerce:checkout", "tools:read"]}}
    d.update(over)
    d["passport_id"] = sha256_hex((ID_DOMAIN + jcs(d)).encode("utf-8"))
    d["signature"] = k.sign((SIG_DOMAIN + jcs(d)).encode("utf-8")).hex()
    return d


def _selftest():
    n = 0
    # [1] the official artifact: the SDK's own signed passport, legacy shape
    path = os.path.join(FIX, "valid-signed-passport.json")
    raw = open(path, "rb").read()
    assert sha256_hex(raw) == "dfd440006a268ba8495a57f8d2c08581a89dd073bfa6054de23c186fc6b4c8fd"
    sp = json.loads(raw.decode("utf-8"))
    assert ed25519_hex_ok(legacy_canonical(sp["passport"]), sp["signature"], sp["passport"]["publicKey"])
    changed = json.loads(raw.decode("utf-8")); changed["passport"]["agentName"] += "."
    assert not ed25519_hex_ok(legacy_canonical(changed["passport"]), sp["signature"], sp["passport"]["publicKey"])
    assert not ed25519_hex_ok(legacy_canonical(sp["passport"]), sp["signature"][:-2] + "00", sp["passport"]["publicKey"])
    n += 1; print("[1] the SDK's own signed passport (legacy shape, %s at commit %s): signature verifies with this port of canonicalize(); one changed byte fails"
                  % (SOURCE["package"], SOURCE["commit"][:8]))

    # [2] no official vectors for the 2.0 shape: verified is null, always
    assert vectors_status()["status"] == "not_available"
    good = _issue_for_selftest("aps-selftest-1")
    it = read(good, now="2026-07-17T00:00:00.000Z")
    assert it["verified"] is None and it["self_asserted"] is True and it["adapter"] == ADAPTER
    assert it["aps"]["local_check"] == {"state": "valid", "code": "OK", "proof_of_possession": True, "key_authority": "verified", "confirmed_against_official_vectors": False}
    assert it["aps"]["capabilities_self_asserted"] == ["commerce:checkout", "tools:read"] and "grant" not in it
    n += 1; print("[2] a 2.0 passport this file reads as valid: verified null, local_check reported as unconfirmed, capabilities copied as self asserted, no grant made from them")

    # [3] null for the ones this file reads as broken too: no boolean without vectors
    for mut, code in ((lambda p: p.update(nonce="02" * 16), "PASSPORT_ID_MISMATCH"),
                      (lambda p: p.update(signature=p["signature"][:-2] + ("00" if p["signature"][-2:] != "00" else "01")), "PASSPORT_SIGNATURE_INVALID"),
                      (lambda p: p.update(version="1.0"), "PASSPORT_MALFORMED"),
                      (lambda p: p.pop("nonce"), "PASSPORT_MALFORMED")):
        p = dict(good); mut(p)
        it = read(p, now="2026-07-17T00:00:00.000Z")
        assert it["verified"] is None and it["aps"]["local_check"]["code"] == code, (code, it["aps"]["local_check"])
    assert read(good, now="2026-07-20T00:00:00.000Z")["aps"]["local_check"]["code"] == "PASSPORT_NOT_CURRENT"
    web = _issue_for_selftest("aps-selftest-2", agent_id="did:web:agent.example")
    lc = read(web, now="2026-07-17T00:00:00.000Z")["aps"]["local_check"]
    assert lc["state"] == "indeterminate" and lc["key_authority"] == "unresolved"
    other = _issue_for_selftest("aps-selftest-3")
    forged = dict(good, public_key_multibase=other["public_key_multibase"])
    assert read(forged)["aps"]["local_check"]["state"] == "invalid"
    for junk in (None, [], "x", {}, {"record_type": "aps.agent-passport"}, {"a": 1.5}):
        it = read(junk)
        assert it["verified"] is None and it["aps"]["local_check"]["state"] == "invalid"
    n += 1; print("[3] edited nonce, edited signature, another version, a missing field, past its window, a did:web with no resolver, another key, junk: local_check names each, verified stays null")

    # [4] admit never admits on it
    import admit_fixtures as F
    import admit_v0 as A
    from contract_v0 import contract_sha256
    w = F.World(); P = w.contracts["plain"]
    req = A.build_action_request(P, "read", "5a" * 16, 500, w.kb)
    native = {"adapter": "musubi-native", "sha256": contract_sha256(P), "verified": True}
    a = A.admit(P, req, [native, read(good, now="2026-07-17T00:00:00.000Z")], F.VIEW, [], relying_party=F.RP)
    assert (a["decision"], a["reasons"]) == ("refuse", ["presentation_unverifiable"]), a
    assert a["presentation_ref"][1] == {"adapter": "aps-v2", "sha256": read(good)["sha256"], "verified": None, "self_asserted": True}
    a = A.admit(P, req, [native, read(good)], F.VIEW, [], relying_party=F.RP, policy={"on_unverifiable": "escalate"})
    assert (a["decision"], a["reasons"]) == ("escalate", ["presentation_unverifiable"])
    n += 1; print("[4] admit with an aps-v2 item: refuse presentation_unverifiable (or escalate by the relying party's policy), never admit; the record keeps verified null and self_asserted true")

    # [5] the receipt hash and the two canonical forms
    assert read(good, receipt={"b": 1, "a": None, "c": [None, "x"]})["aps"]["receipt_sha256"] == sha256_hex(b'{"b":1,"c":[null,"x"]}')
    assert jcs({"b": 1, "a": None, "c": [True, "é"]}) == '{"a":null,"b":1,"c":[true,"é"]}'
    assert multibase_to_hex(good["public_key_multibase"]) is not None and multibase_to_hex("z111") is None and multibase_to_hex("m123") is None
    n += 1; print("[5] the receipt is named by the sha256 of the SDK's legacy canonical form (null members dropped); the 2.0 form keeps them")

    print("\nSELF-TEST PASSED: admission adapter aps-v2, %d checks (one official artifact verifies in the legacy shape; no official 2.0 vectors, so verified is null "
          "for every 2.0 passport; local reading reported as unconfirmed; admit never admits on it)" % n)


if __name__ == "__main__":
    _selftest() if "--selftest" in sys.argv else print(__doc__)
