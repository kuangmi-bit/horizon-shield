"""Shared by the TSUGI fixture builder and the TSUGI live differential: deterministic keys, re-sealing a chain after
an edit, and writing JSON text both languages read the same way.

Keys come from public phrases, so anyone can re-derive them. The witness keys use the repository's own fixture
derivation (recovery-v0/witness_fixture_build.mjs: seed = sha256("tsugi fixture key " + domain)), so the witness
observations in witness_fixture_20260920.json can be re-signed after an edit. The operator key used for the strict
cases is this test's own (seed = sha256("nenrin-verify python parity tsugi operator")); the real incident chain's
authorization stays signed by the real operator key and is never re-signed.
"""
import base64
import copy
import hashlib
import json
import re

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from nenrin_verify import tsugi

WITNESS_DOMAINS = ["witness-a.example", "witness-b.example", "witness-c.example", "witness-d.example",
                   "witness-e.example", "gate.horizonshield.dev"]


def key_from_seed_text(text):
    priv = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(text.encode("utf-8")).digest())
    pub = base64.b64encode(priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode("ascii")
    return priv, pub


OPERATOR, OPERATOR_PUB = key_from_seed_text("nenrin-verify python parity tsugi operator")
OTHER, OTHER_PUB = key_from_seed_text("nenrin-verify python parity tsugi someone else")
KEYS = {OPERATOR_PUB: OPERATOR, OTHER_PUB: OTHER}
for _d in WITNESS_DOMAINS:
    _p, _b = key_from_seed_text("tsugi fixture key " + _d)
    KEYS[_b] = _p


def sign(record, priv):
    """recovery_verify.sign(): seal, then sign the canonical bytes (hash and signature fields excluded)."""
    body = tsugi.hashed_body(record)
    body["record_sha256"] = tsugi.record_sha256(body)
    sig = base64.b64encode(priv.sign(tsugi.canonical_bytes(body))).decode("ascii")
    pub = base64.b64encode(priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode("ascii")
    body["signature_ed25519_b64"] = sig
    body["public_key_ed25519_b64"] = pub
    return body


def records_of(root):
    if isinstance(root, list):
        return root, ()
    if isinstance(root, dict) and isinstance(root.get("records"), list):
        return root["records"], ("records",)
    return None, None


def _walk_replace(v, remap, here, skip):
    if isinstance(v, str):
        return remap.get(v, v) if here != skip else v
    if isinstance(v, list):
        return [_walk_replace(x, remap, here + (i,), skip) for i, x in enumerate(v)]
    if isinstance(v, dict):
        return {k: _walk_replace(x, remap, here + (k,), skip) for k, x in v.items()}
    return v


def _reseal_record(r, base, skip, remap, pool, inner=True):
    """Re-seal one record in place (and its embedded observations): links that pointed at a re-sealed record are
    moved to its new hash, record_sha256 recomputed, a known key's signature redone. The field the edit touched is
    left as the edit left it."""
    ext = r.get("external")
    if inner and isinstance(ext, list):
        for n, e in enumerate(ext):
            if isinstance(e, dict) and isinstance(e.get("record"), dict):
                _reseal_record(e["record"], base + ("external", n, "record"), skip, {}, None)
    for k in list(r):
        if k in ("record_sha256", "signature_ed25519_b64", "public_key_ed25519_b64", "external"):
            continue
        r[k] = _walk_replace(r[k], remap, base + (k,), skip)
    d = r.get("draw")
    if isinstance(d, dict) and remap:
        c = d.get("commitment")
        subj = d.get("subject_sha256")
        old_subj = next((o for o, n in remap.items() if n == subj), None)
        if old_subj and isinstance(c, dict) and base + ("draw", "commitment", "claim_sha256") != skip:
            try:
                if c.get("claim_sha256") == tsugi.sha256_hex(tsugi.commitment_claim_text(old_subj)):
                    c["claim_sha256"] = tsugi.sha256_hex(tsugi.commitment_claim_text(subj))
            except Exception:
                pass
        if old_subj and pool is not None and base + ("draw", "drawn") != skip:
            try:
                before = tsugi.draw(pool, d["beacon"]["hash"], old_subj, d["k"], "gate.horizonshield.dev")
                if before["drawn"] == d.get("drawn"):
                    d["drawn"] = tsugi.draw(pool, d["beacon"]["hash"], subj, d["k"], "gate.horizonshield.dev")["drawn"]
            except Exception:
                pass
    old = r.get("record_sha256")
    if "record_sha256" in r and base + ("record_sha256",) != skip:
        try:
            r["record_sha256"] = tsugi.record_sha256(r)
        except Exception:
            return
        if isinstance(old, str) and old != r["record_sha256"]:
            remap[old] = r["record_sha256"]
    pub, sig = r.get("public_key_ed25519_b64"), r.get("signature_ed25519_b64")
    if (isinstance(pub, str) and pub in KEYS and isinstance(sig, str)
            and base + ("signature_ed25519_b64",) != skip and base + ("public_key_ed25519_b64",) != skip):
        signed = sign(r, KEYS[pub])
        if base + ("record_sha256",) == skip:
            signed["record_sha256"] = old
        if "record_sha256" not in r:
            del signed["record_sha256"]
        r.clear()
        r.update(signed)


def reseal(root, skip=None, pool=None, inner=True):
    """A copy of the chain (an array or { records }) with every record re-sealed after an edit at path `skip`.
    With inner=False the observations embedded in a verify record are left as they are (only the chain re-sealed)."""
    root = copy.deepcopy(root)
    recs, pre = records_of(root)
    if recs is None:
        return root
    rel = tuple(skip[len(pre):]) if skip is not None and tuple(skip[:len(pre)]) == pre else None
    remap = {}
    for i, r in enumerate(recs):
        if isinstance(r, dict):
            _reseal_record(r, (i,), rel, remap, pool, inner)
    return root


_LONE = re.compile("[\ud800-\udfff]")


def dumps(v):
    """JSON text with non-ASCII written raw (so readFileSync's UTF-8 decoding is exercised) and only lone
    surrogates escaped (they have no UTF-8 form)."""
    text = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return _LONE.sub(lambda m: "\\u%04x" % ord(m.group()), text)
