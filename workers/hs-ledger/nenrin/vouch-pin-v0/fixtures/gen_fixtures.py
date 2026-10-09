#!/usr/bin/env python3
"""Fixtures for vouch_pin_v0, made by Vouch Protocol's own SDK (pip install vouch-protocol==2.2.1), so the intake is
tested against the other implementation's bytes and its own verifier's answers, not against this repository's
assumptions. Run with a Python that has vouch-protocol installed:  python3 gen_fixtures.py > vouch_fixtures.json
Keys are generated fresh on each run; the private keys are not written."""
import base64, hashlib, json, sys
from datetime import datetime, timezone

import vouch
from vouch import Signer, multikey, data_integrity, accountability
from vouch.jcs import canonicalize
from vouch.keys import generate_identity
from jwcrypto.common import base64url_decode
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ORIGIN = "https://ledger.horizonshield.dev"
T0 = datetime(2026, 10, 9, 12, 0, 0, tzinfo=timezone.utc)


def did_key(kp):
    raw = base64url_decode(json.loads(kp.public_key_jwk)["x"])
    return "did:key:" + multikey.encode_ed25519_public(raw), raw


def anchor(cid, establishes):
    # the same entry vouch_pin_v0.anchorEntry builds; vouch.accountability.timestamp_anchor accepts it
    a = accountability.timestamp_anchor(
        "nenrin-opentimestamps", ORIGIN + "/evidence/vouch/id/" + __import__("urllib.parse").parse.quote(cid, safe=""),
        "curl -sO https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/vouch-pin-v0/vouch_check.py && python3 vouch_check.py --ledger " + ORIGIN + " --credential <this credential as JSON> --outcome-time <the settlement time>",
        establishes)
    return a


def pub_of(raw):
    return Ed25519PublicKey.from_public_bytes(raw)


def entry(name, cred, raw, note):
    return {"name": name, "note": note, "credential": cred,
            "vouch_verify_proof": data_integrity.verify_proof(cred, pub_of(raw)),
            "vouch_jcs_sha256": hashlib.sha256(canonicalize(cred)).hexdigest(),
            "issuer_public_key_b64": base64.b64encode(raw).decode()}


out = {"_about": {"vouch_protocol": getattr(vouch, "__version__", "2.2.1"), "origin": ORIGIN, "made_at": T0.isoformat()}, "cases": [], "did_documents": {}}

# 1. did:key commitment naming this ledger as its pre-outcome anchor
kp = generate_identity(); did, raw = did_key(kp)
s = Signer(private_key=kp.private_key_jwk, did=did)
cid = "urn:uuid:7f1c2a90-4b1e-4f7a-9d55-0a1b2c3d4e5f"
claim = {"market": "BTC above 100k on 2026-12-31", "verdict": "yes"}
settle = {"method": "public-price-feed", "resolutionCriteria": "close above 100000 USD", "resolveBy": "2026-12-31T23:59:59Z"}
c1, _ = accountability.commit_outcome(s, claim=claim, settlement=settle, anchor=anchor(cid, "pre-outcome-ordering"), valid_from=T0, credential_id=cid)
ok, _subj = accountability.verify_commitment(c1, pub_of(raw))
e = entry("commitment_didkey", c1, raw, "did:key commitment whose anchor names this ledger, establishes pre-outcome-ordering")
e["vouch_verify_commitment"] = ok; e["vouch_claims_precedence"] = accountability.claims_precedence(c1)
out["cases"].append(e)

# 2. the same issuer, the same id, the opposite verdict: equivocation under one id
c2, _ = accountability.commit_outcome(s, claim={**claim, "verdict": "no"}, settlement=settle, anchor=anchor(cid, "pre-outcome-ordering"), valid_from=T0, credential_id=cid)
out["cases"].append(entry("commitment_didkey_same_id_other_verdict", c2, raw, "same issuer and id as commitment_didkey, opposite verdict"))

# 3. did:web issuer, key in publicKeyJwk (as vouch onboard publishes) and in publicKeyMultibase
for form in ("jwk", "multibase"):
    kw = generate_identity(domain="witness-%s.example.org" % form)
    rw = base64url_decode(json.loads(kw.public_key_jwk)["x"])
    sw = Signer(private_key=kw.private_key_jwk, did=kw.did)
    vm = {"id": kw.did + "#key-1", "type": "JsonWebKey2020" if form == "jwk" else "Multikey", "controller": kw.did}
    if form == "jwk":
        vm["publicKeyJwk"] = json.loads(kw.public_key_jwk)
    else:
        vm["publicKeyMultibase"] = multikey.encode_ed25519_public(rw)
    out["did_documents"][kw.did] = {"@context": ["https://www.w3.org/ns/did/v1"], "id": kw.did, "verificationMethod": [vm], "assertionMethod": [kw.did + "#key-1"]}
    cw, _ = accountability.commit_outcome(sw, claim={"q": form}, settlement=settle, valid_from=T0, credential_id="urn:uuid:00000000-0000-4000-8000-00000000000" + ("1" if form == "jwk" else "2"))
    out["cases"].append(entry("commitment_didweb_" + form, cw, rw, "did:web issuer, key served as " + form))

# 4. a settlement attestation (another credential type) by a third party, did:key
kq = generate_identity(); dq, rq = did_key(kq)
sq = Signer(private_key=kq.private_key_jwk, did=dq)
att = accountability.attest_outcome(sq, commitment=c1, outcome={"result": {"close": 101000}, "observedAt": "2027-01-01T00:00:00Z"},
                                   claim=claim, matches=True, valid_from=datetime(2027, 1, 1, tzinfo=timezone.utc),
                                   credential_id="urn:uuid:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
out["cases"].append(entry("attestation_didkey", att, rq, "settlement attestation by a third party, settled 2027-01-01"))

# 5. Vouch's pre-alignment signing input (legacy_proof_digest), which Vouch still verifies
priv = Ed25519PrivateKey.from_private_bytes(base64url_decode(json.loads(kp.private_key_jwk)["d"]))
base = {k: v for k, v in c1.items() if k != "proof"}
base["id"] = "urn:uuid:11111111-2222-4333-8444-555555555555"
base["credentialSubject"] = {**base["credentialSubject"], "commitment": {k: v for k, v in base["credentialSubject"]["commitment"].items() if k != "anchor"}}
unsigned = {"type": "DataIntegrityProof", "cryptosuite": "eddsa-jcs-2022", "created": "2026-10-09T12:00:00Z", "verificationMethod": did + "#key-1", "proofPurpose": "assertionMethod"}
sig = priv.sign(data_integrity.legacy_proof_digest(base, unsigned))
from vouch.multikey import _b58encode
legacy = {**base, "proof": {**unsigned, "proofValue": "z" + _b58encode(sig)}}
out["cases"].append(entry("legacy_digest_didkey", legacy, raw, "signed over Vouch's pre-alignment digest, which Vouch's verify_proof still accepts"))

json.dump(out, sys.stdout, indent=1, sort_keys=True)
