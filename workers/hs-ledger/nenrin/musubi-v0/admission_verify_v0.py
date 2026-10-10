#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI admission records, the verifying side (a2a-admission-v0): what anyone needs to check a record a relying party
signed, and to recompute what a settlement says about it.

An admission is a relying party's signed answer, given at its own door before an action: admit, escalate or refuse,
with reasons from a closed list. Settlement (settle_v1_11.py, settle_v1_12.py) reads an execution against that
record afterwards. This file is the part of that which a stranger needs:

    verify_admission(record, relying_key_b64, contract)   is this the relying party's record, unaltered, for these terms
    admission_sha256(record)                              the digest an execution record names (admission_ref)
    action_digest(contract_sha256, request)               the digest that binds what was asked to what was executed
    build_action_request / request_shape_ok / request_signed    the applicant's signed request, and its shape
    build_revocation / revocation_signed_by_principal     the principal's a2a-revocation-v0 record

What is not here. The implementation of the door itself, the function that decides, is not public. It is not needed
to check a record: a record carries the relying party's signature, the digests it decided over and the sha256 of the
clause evaluator it used (clause_eval_v0.py, which is public), and settlement recomputes the clauses from the
contract. A relying party is free to build its own door; what makes its records checkable is this file and the schema
in schemas/a2a-admission-v0.schema.json.

Two versions of the record exist. A v0 record has no rules.version. A v0.1 record (2026-10-10) says "0.1"; its
presentation_ref may carry self_declared, its revocations_seen are objects that say whether each revocation carried
an anchor, and the third line of its does_not_establish differs. verify_admission accepts each with its own stated
limits and refuses one that carries the other's.

  python3 admission_verify_v0.py --selftest
  python3 admission_verify_v0.py --check-fixtures      the fixture files are the ones listed in fixtures/ADMISSION_FIXTURES.sha256
  python3 admission_verify_v0.py --verify RECORD.json --key BASE64 [--contract CONTRACT.json]
"""
import argparse, base64, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, b64_raw, CANONICAL_RULE

SCHEMA = "a2a-admission-v0"
VERSION = "0.1"
CONTEXT = b"a2a-admission-v0\n"
REQUEST_CONTEXT = b"a2a-action-request-v0\n"
REVOKE_SCHEMA = "a2a-revocation-v0"
REVOKE_CONTEXT = b"a2a-revocation-v0\n"
PREIMAGE_PROFILE = "a2a-admission-v0/action"
DECISIONS = ("admit", "escalate", "refuse")
REASONS = ("within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
           "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
           "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch")
HEX32 = re.compile(r"^[0-9a-f]{32}\Z")
HEX64 = re.compile(r"^[0-9a-f]{64}\Z")
DOES_NOT_ESTABLISH_V0 = [
    "that HS allowed or blocked anything; the relying party ran the function at its own door",
    "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
    "that a revocation published after the chain view was known at admission time",
    "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
    "that this record is a legal authorization or determines liability"]
DOES_NOT_ESTABLISH = [
    DOES_NOT_ESTABLISH_V0[0],
    DOES_NOT_ESTABLISH_V0[1],
    "when a revocation without an anchor was issued, or that no revocation exists beyond those in revocations_seen; a revocation the "
    "principal signed is obeyed with or without an anchor, and its time is not proven until it is anchored",
    DOES_NOT_ESTABLISH_V0[3],
    DOES_NOT_ESTABLISH_V0[4]]


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --------------------------------------------------------------------------- the action request
def action_preimage(contract_sha, req):
    a = req.get("action") if isinstance(req.get("action"), dict) else {}
    return {"contract_sha256": contract_sha, "action": a.get("action"), "target": a.get("target"), "amount": a.get("amount"),
            "nonce": req.get("nonce"), "expiry_height": req.get("expiry_height")}


def action_digest(contract_sha, req):
    return sha256_hex(canonical(action_preimage(contract_sha, req)).encode("utf-8"))


def action_binding(contract_sha, req):
    return {"type": "canonical_request_digest", "canonicalization": CANONICAL_RULE, "preimage_profile": PREIMAGE_PROFILE,
            "digest": {"alg": "sha-256", "value": action_digest(contract_sha, req)}}


def request_signing_bytes(req):
    return REQUEST_CONTEXT + canonical({k: v for k, v in req.items() if k != "signatures"}).encode("utf-8")


def build_action_request(contract, action, nonce, expiry_height, key, role="contractor", target=None, amount=None, approvals=None):
    csha = contract_sha256(contract)
    req = {"contract_ref": {"contract_id": contract["contract_id"], "contract_sha256": csha},
           "action": {"action": action, "target": target, "amount": amount}, "nonce": nonce, "expiry_height": expiry_height,
           "approvals": list(approvals or []), "requester": {"role": role}}
    req["action_binding"] = action_binding(csha, req)
    req["signatures"] = [{"role": role, "sig_b64": base64.b64encode(key.sign(request_signing_bytes(req))).decode("ascii")}]
    return req


def _party_key(contract, role):
    for p in contract.get("parties") or []:
        if isinstance(p, dict) and p.get("role") == role:
            return p.get("public_key_ed25519_b64")
    return None


def request_shape_ok(req):
    a = req.get("action") if isinstance(req, dict) else None
    return (isinstance(req, dict) and isinstance(a, dict) and isinstance(a.get("action"), str)
            and (a.get("target") is None or isinstance(a.get("target"), str))
            and (a.get("amount") is None or (_is_int(a.get("amount")) and a["amount"] >= 0))
            and isinstance(req.get("nonce"), str) and bool(HEX32.match(req["nonce"]))
            and _is_int(req.get("expiry_height")) and req["expiry_height"] >= 0
            and isinstance(req.get("requester"), dict) and req["requester"].get("role") in ("principal", "contractor")
            and isinstance(req.get("contract_ref"), dict))


def request_signed(contract, req):
    key = _party_key(contract, req["requester"]["role"])
    if not key:
        return False
    msg = request_signing_bytes(req)
    return any(isinstance(s, dict) and s.get("role") == req["requester"]["role"] and ed25519_verify(key, s.get("sig_b64"), msg) is True
               for s in (req.get("signatures") or []))


# --------------------------------------------------------------------------- the principal's revocation record
def revocation_signing_bytes(rec):
    return REVOKE_CONTEXT + canonical({k: v for k, v in rec.items() if k not in ("signatures", "anchor")}).encode("utf-8")


def build_revocation(contract, key, revoked_key_b64=None):
    """A principal's revocation. Without revoked_key it ends the grant: this is the a2a-revocation-v0 record settle v1
    already reads, bound to the terms by contract_sha256. With revoked_key it names one key that must no longer be
    admitted under this contract; that form is read by a relying party's door and is not a settle event."""
    rec = {"schema": REVOKE_SCHEMA, "contract_ref": {"contract_id": contract["contract_id"],
           "payload_digest": (contract.get("task") or {}).get("payload_digest"), "contract_sha256": contract_sha256(contract)},
           "revoked_by": "principal"}
    if revoked_key_b64 is not None:
        rec["revoked_key"] = {"public_key_ed25519_b64": revoked_key_b64}
    rec["signatures"] = [{"role": "principal", "sig_b64": base64.b64encode(key.sign(revocation_signing_bytes(rec))).decode("ascii")}]
    return rec


def revocation_signed_by_principal(contract, rec):
    """True when rec is an a2a-revocation-v0 the contract's principal signed for these terms. An anchor, if any, is not
    part of the signed bytes and is not looked at here."""
    try:
        if not (isinstance(rec, dict) and rec.get("schema") == REVOKE_SCHEMA and rec.get("revoked_by") == "principal"):
            return False
        ref = rec.get("contract_ref") if isinstance(rec.get("contract_ref"), dict) else {}
        pk = _party_key(contract, "principal")
        if ref.get("contract_sha256") != contract_sha256(contract) or not pk:
            return False
        msg = revocation_signing_bytes(rec)
        return any(isinstance(s, dict) and s.get("role") == "principal" and ed25519_verify(pk, s.get("sig_b64"), msg) is True
                   for s in (rec.get("signatures") if isinstance(rec.get("signatures"), list) else []))
    except Exception:
        return False


# --------------------------------------------------------------------------- the record
def admission_signing_bytes(record):
    return CONTEXT + canonical({k: v for k, v in record.items() if k != "signatures"}).encode("utf-8")


def admission_sha256(record):
    """sha256 of the bytes the relying party signs. Stable when the signature lands; this is what an execution record names."""
    return sha256_hex(admission_signing_bytes(record))


def _host(url):
    m = re.match(r"^https://([A-Za-z0-9.-]+)(?::\d+)?/", url) if isinstance(url, str) else None
    return m.group(1).lower() if m else None


RECORD_KEYS = frozenset(("schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
                         "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"))


def verify_admission(record, relying_key_b64, contract=None):
    """{"verdict": "accepted" | "refused", "refusals": [codes]}. relying_key_b64 is the key the caller fetched from
    record.relying_party.key_url. With the contract, an admission signed by a party's own request key is refused: an
    applicant cannot admit itself (the same fail closed rule as a self witness)."""
    ref = []
    if not isinstance(record, dict) or record.get("schema") != SCHEMA:
        return {"verdict": "refused", "refusals": ["malformed"]}
    if set(record) - RECORD_KEYS - {"publication"} or not RECORD_KEYS <= set(record) or record.get("publication", "public") != "public":
        ref.append("malformed")
    rp = record.get("relying_party") if isinstance(record.get("relying_party"), dict) else {}
    dom = rp.get("domain") if isinstance(rp.get("domain"), str) else None
    if record.get("decision") not in DECISIONS or not isinstance(record.get("reasons"), list) or not record.get("reasons") \
            or any(r not in REASONS for r in record.get("reasons") or []):
        ref.append("malformed")
    rules = record.get("rules") if isinstance(record.get("rules"), dict) else {}
    if rules.get("version") not in (None, VERSION):
        ref.append("malformed")
    # a v0 record (no rules.version) carries v0's stated limits; a v0.1 record carries v0.1's. Neither may carry the other's.
    if list(record.get("does_not_establish") or []) != (DOES_NOT_ESTABLISH if rules.get("version") == VERSION else DOES_NOT_ESTABLISH_V0):
        ref.append("does_not_establish_altered")
    if not dom or _host(rp.get("key_url")) != dom.lower():
        ref.append("signer_not_on_own_domain")
    sigs = [s for s in (record.get("signatures") or []) if isinstance(s, dict)]
    if b64_raw(relying_key_b64, 32) is None or not any(
            s.get("domain") == dom and s.get("alg") == "ed25519" and ed25519_verify(relying_key_b64, s.get("sig"), admission_signing_bytes(record)) is True
            for s in sigs):
        ref.append("bad_signature")
    if isinstance(contract, dict):
        if (record.get("contract_ref") or {}).get("contract_sha256") != contract_sha256(contract):
            ref.append("other_contract")
        if relying_key_b64 == _party_key(contract, "contractor"):
            ref.append("self_admission")
    ref = sorted(set(ref))
    return {"verdict": "refused" if ref else "accepted", "refusals": ref}


party_key = _party_key


# --------------------------------------------------------------------------- the fixtures
FIXTURE_LIST = os.path.join(HERE, "fixtures", "ADMISSION_FIXTURES.sha256")


def check_fixtures(out=None):
    """The fixture records were written by a door this repository does not carry. Their sha256 is listed here, and this
    compares. Returns the number of files that differ or are missing."""
    bad = 0
    for line in open(FIXTURE_LIST, encoding="utf-8").read().splitlines():
        if not line.strip():
            continue
        want, rel = line.split("  ", 1)
        p = os.path.join(HERE, "fixtures", rel)
        got = hashlib.sha256(open(p, "rb").read()).hexdigest() if os.path.exists(p) else None
        bad += got != want
        if out is not None:
            print("%s %s  %s" % ("ok  " if got == want else "NG  ", want[:16], rel), file=out)
    return bad


# --------------------------------------------------------------------------- self test
def _selftest():
    import subprocess
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    n = 0
    assert check_fixtures() == 0
    C = json.load(open(os.path.join(HERE, "fixtures", "admission_intake", "cases.json"), encoding="utf-8"))
    rd = parse_strict
    P, N = rd(C["contract_canonical"]), rd(C["other_contract_canonical"])
    rk, ck, sk = C["relying_pub_b64"], C["contractor_pub_b64"], C["stranger_pub_b64"]
    ok = {"verdict": "accepted", "refusals": []}

    # [1] records a relying party signed: both versions verify, each with its own stated limits
    names = ("admission_public", "admission_private", "admission_refuse", "admission_revoked_without_anchor", "admission_brought_result", "admission_public_v0")
    for k in names:
        assert verify_admission(rd(C[k]), rk, P) == ok, (k, verify_admission(rd(C[k]), rk, P))
    pub, old = rd(C["admission_public"]), rd(C["admission_public_v0"])
    assert pub["rules"]["version"] == VERSION and "version" not in old["rules"]
    assert pub["does_not_establish"] == DOES_NOT_ESTABLISH and old["does_not_establish"] == DOES_NOT_ESTABLISH_V0
    assert admission_sha256(pub) == C["admission_public_sha256"] and admission_sha256(old) == C["admission_public_v0_admission_sha256"]
    assert admission_sha256(pub) == sha256_hex(CONTEXT + canonical({k: v for k, v in pub.items() if k != "signatures"}).encode())
    n += 1; print("[1] %d records from the fixture verify under the relying party's key, one of them written by v0; admission_sha256 is the sha256 of the signed bytes" % len(names))

    # [2] what does not verify
    edit = lambda rec, **kw: dict(json.loads(json.dumps(rec)), **kw)
    assert verify_admission(edit(pub, decision="refuse"), rk, P)["refusals"] == ["bad_signature"]
    assert verify_admission(pub, sk, P)["refusals"] == ["bad_signature"]
    assert verify_admission(pub, "not a key", P)["refusals"] == ["bad_signature"]
    self_made = rd(C["admission_signed_by_contractor"])
    assert verify_admission(self_made, rk, P)["refusals"] == ["bad_signature"] and "self_admission" in verify_admission(self_made, ck, P)["refusals"]
    assert verify_admission(pub, rk, N)["refusals"] == ["other_contract"]
    assert "does_not_establish_altered" in verify_admission(edit(pub, does_not_establish=pub["does_not_establish"][:4]), rk, P)["refusals"]
    assert "does_not_establish_altered" in verify_admission(edit(pub, does_not_establish=list(DOES_NOT_ESTABLISH_V0)), rk, P)["refusals"]
    assert "does_not_establish_altered" in verify_admission(edit(old, rules=dict(old["rules"], version=VERSION)), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, rules=dict(pub["rules"], version="9")), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, score=97), rk, P)["refusals"] and "malformed" in verify_admission(edit(pub, reasons=["looks_fine"]), rk, P)["refusals"]
    assert "malformed" in verify_admission(edit(pub, publication="private"), rk, P)["refusals"]
    assert "signer_not_on_own_domain" in verify_admission(edit(pub, relying_party={"domain": "shop.example", "key_url": "https://evil.example/k.json"}), rk, P)["refusals"]
    assert verify_admission(None, rk)["refusals"] == ["malformed"] and verify_admission({"schema": "x"}, rk)["refusals"] == ["malformed"]
    n += 1; print("[2] an edited decision, another key, the applicant's own key (self_admission), other terms, another version's stated limits, an unknown version, an extra field, a key off the domain: refused, each with its code")

    # [3] the action request and the digest that binds it
    req = rd(C["action_request_public"])
    assert request_shape_ok(req) and request_signed(P, req) and not request_signed(N, dict(req, signatures=[]))
    assert action_digest(contract_sha256(P), req) == pub["action_ref"]["action_binding_digest"] == req["action_binding"]["digest"]["value"]
    moved = json.loads(json.dumps(req)); moved["action"]["target"] = "/other"
    assert action_digest(contract_sha256(P), moved) != action_digest(contract_sha256(P), req) and not request_signed(P, moved)
    assert action_binding(contract_sha256(P), req) == req["action_binding"]
    for bad in (None, {}, dict(req, nonce="xyz"), dict(req, expiry_height=-1), dict(req, action={"action": "read", "amount": -1}), dict(req, requester={"role": "witness"})):
        assert not request_shape_ok(bad), bad
    k = Ed25519PrivateKey.generate()
    kp = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    mine = {"contract_id": "c" * 32, "parties": [{"role": "principal", "public_key_ed25519_b64": kp}, {"role": "contractor", "public_key_ed25519_b64": kp}], "task": {}}
    r2 = build_action_request(mine, "pay", "ab" * 16, 500, k, target="/invoices", amount=80000)
    assert request_shape_ok(r2) and request_signed(mine, r2) and r2["action_binding"]["digest"]["value"] == action_digest(contract_sha256(mine), r2)
    assert not request_signed(mine, dict(r2, nonce="cd" * 16))
    n += 1; print("[3] the applicant's request: shape, signature under the key the contract names, and the action digest the admission and the execution both carry; an edit breaks both")

    # [4] the principal's revocation record
    assert revocation_signed_by_principal(P, rd(C["revocation_grant"])) and revocation_signed_by_principal(P, rd(C["revocation_key"]))
    assert not revocation_signed_by_principal(P, rd(C["revocation_by_contractor"])) and not revocation_signed_by_principal(N, rd(C["revocation_grant"]))
    anchored = dict(rd(C["revocation_grant"]), anchor={"height": 5})
    assert revocation_signed_by_principal(P, anchored)
    rv = build_revocation(mine, k)
    assert revocation_signed_by_principal(mine, rv) and canonical(rv) == canonical(build_revocation(mine, k))
    assert not revocation_signed_by_principal(mine, dict(rv, revoked_key={"public_key_ed25519_b64": kp})) and not revocation_signed_by_principal(mine, None)
    n += 1; print("[4] a2a-revocation-v0: the principal's signature for these terms verifies, with or without an anchor beside it; the contractor's, or one for other terms, does not")

    # [5] the second runtime
    twin = os.path.join(HERE, "admission_verify_v0.mjs")
    r = subprocess.run(["node", twin, "--check", os.path.join(HERE, "fixtures", "admission_intake", "cases.json")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-600:]
    J = json.loads(r.stdout)
    mine_py = {}
    for k_ in names + ("admission_signed_by_contractor",):
        rec = rd(C[k_])
        mine_py[k_] = {"sha": admission_sha256(rec), "relying": verify_admission(rec, rk, P), "contractor": verify_admission(rec, ck, P), "other": verify_admission(rec, rk, N),
                       "edited": verify_admission(dict(rec, decision="escalate"), rk, P)}
    assert J["records"] == mine_py, [k_ for k_ in mine_py if J["records"].get(k_) != mine_py[k_]]
    assert J["request"] == {"shape": True, "signed": True, "digest": action_digest(contract_sha256(P), req), "binding": action_binding(contract_sha256(P), req)}
    assert J["revocations"] == {"grant": True, "key": True, "by_contractor": False, "other_terms": False}
    n += 1; print("[5] admission_verify_v0.mjs gives the same verdicts, refusal codes and digests for the same records (%d records, 4 readings each)" % len(mine_py))

    print("\nSELF-TEST PASSED: MUSUBI admission records, the verifying side, %d checks (both versions verify; what does not; the request and its digest; "
          "the revocation record; the JavaScript twin agrees)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI admission records (a2a-admission-v0): the verifying side")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--check-fixtures", action="store_true")
    ap.add_argument("--verify", metavar="RECORD.json")
    ap.add_argument("--key", metavar="BASE64", help="the relying party's Ed25519 key, fetched from the record's relying_party.key_url")
    ap.add_argument("--contract", metavar="CONTRACT.json")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if a.check_fixtures:
        bad = check_fixtures(out=sys.stdout)
        print("fixtures match the list" if not bad else "FAILED: %d fixture file(s) differ from fixtures/ADMISSION_FIXTURES.sha256" % bad)
        return 1 if bad else 0
    if not (a.verify and a.key):
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rec = rd(a.verify)
    out = verify_admission({k: v for k, v in rec.items() if k != "anchor"}, a.key, rd(a.contract) if a.contract else None)
    out["admission_sha256"] = admission_sha256({k: v for k, v in rec.items() if k != "anchor"})
    print(json.dumps(out, indent=2))
    return 0 if out["verdict"] == "accepted" else 4


if __name__ == "__main__":
    sys.exit(main())
