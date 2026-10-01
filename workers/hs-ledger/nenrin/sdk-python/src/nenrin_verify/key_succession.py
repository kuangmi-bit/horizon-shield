# VENDORED from workers/hs-ledger/nenrin/agreement-v0/key_succession.py by tools/vendor.py. Do not edit; edit the source.
"""Key succession records (a2a-key-succession-v0): how a party keeps attribution across a key
rotation. Library for agreement_verify.py. No network, no clock, no ledger.

Why this exists (2026-09-30). An open audit of x402 settlements matched payees by the address
they declared and found 0 of 357 attributable; matched by the key that actually submitted, 73%
were. What was left over was 22 signer addresses nobody had registered, which look like rotated
keys. Our agreement records already attribute by the signing key, which sits inside the signed
bytes. The gap was rotation: after a party rotates, its key_url serves the new key, and the
verifier refused every older record as key_url_mismatch, although those records were signed
honestly with the key that was current at the time.

The rule this file enforces, and nothing else:
  1. A handover is a record that the OLD key and the NEW key both sign. A handover signed by the
     new key alone is somebody claiming a key, not a key being passed on. The one exception is
     reason "compromise": asking a leaked key to sign proves nothing, so only the new key signs.
  2. Handovers form a chain: each one names the sha256 of the previous one, and each old key is
     the previous new key. Drop one, reorder two, or loop back, and the chain is broken.
  3. The chain must end at the key the party serves now.
  4. The time a key was retired is a Bitcoin block height, not anybody's clock.
The verifier decides what a retirement block means for a given record. This file only says
whether the chain from the record's key to today's key is intact, and at which block that key
was retired.
"""
# RUN_ALL: library

SCHEMA = "a2a-key-succession-v0"
CONTEXT = b"a2a-key-succession-v0\n"
MAX_CHAIN = 64
FIELDS = {"schema", "domain", "purpose", "old_public_key_ed25519_b64", "new_public_key_ed25519_b64",
          "reason", "effective_block", "prev_succession_sha256", "signatures"}
REASONS = ("rotation", "compromise")


def signing_bytes(entry, canonical):
    body = {k: v for k, v in entry.items() if k != "signatures"}
    return CONTEXT + canonical(body).encode("utf-8")


def entry_sha256(entry, canonical, sha256_hex):
    return sha256_hex(canonical(entry))


def _key_ok(V, s):
    if not isinstance(s, str):
        return False
    raw = V.b64_raw(s, 32)
    return raw is not None and V.public_key_problem(raw) is None


def check_chain(chain, domain, from_pub, to_pub, V):
    """Return (ok, why, retired) where retired is {"block": int, "reason": str} for the handover
    that retired from_pub. V is agreement_verify (canonical, sha256_hex, ed25519_verify, b64_raw,
    public_key_problem, norm_domain)."""
    if not isinstance(chain, list) or not chain:
        return False, "no handover records were supplied for this key_url", None
    if len(chain) > MAX_CHAIN:
        return False, "the handover chain is longer than %d records" % MAX_CHAIN, None
    seen_old = set()
    prev = None
    retired = None
    for i, e in enumerate(chain):
        at = "handover %d" % i
        if not isinstance(e, dict):
            return False, "%s is not an object" % at, None
        if set(e.keys()) != FIELDS:
            return False, "%s must carry exactly the fields %s" % (at, ", ".join(sorted(FIELDS))), None
        if e["schema"] != SCHEMA:
            return False, "%s is not %s" % (at, SCHEMA), None
        if V.norm_domain(e["domain"]) != domain:
            return False, "%s is for %r, not for %s" % (at, e["domain"], domain), None
        if e["purpose"] != "agreement":
            return False, "%s is for purpose %r, not agreement" % (at, e["purpose"]), None
        old, new = e["old_public_key_ed25519_b64"], e["new_public_key_ed25519_b64"]
        if not _key_ok(V, old) or not _key_ok(V, new):
            return False, "%s names a key that is not 32 bytes of usable Ed25519" % at, None
        if old == new:
            return False, "%s hands a key over to itself" % at, None
        if e["reason"] not in REASONS:
            return False, "%s has reason %r; it must be rotation or compromise" % (at, e["reason"]), None
        blk = e["effective_block"]
        if not isinstance(blk, int) or isinstance(blk, bool) or blk <= 0:
            return False, "%s effective_block must be a positive integer" % at, None
        if i == 0:
            if e["prev_succession_sha256"] is not None:
                return False, "the first handover must have prev_succession_sha256 null", None
        else:
            if e["prev_succession_sha256"] != entry_sha256(prev, V.canonical, V.sha256_hex):
                return False, "%s does not name the sha256 of the handover before it; a record was dropped, changed or reordered" % at, None
            if old != prev["new_public_key_ed25519_b64"]:
                return False, "%s hands over a key the handover before it did not hand on" % at, None
            if blk <= prev["effective_block"]:
                return False, "%s takes effect at block %d, not after the handover before it" % (at, blk), None
        if old in seen_old:
            return False, "%s retires a key that was already retired; the chain loops" % at, None
        seen_old.add(old)
        sigs = e["signatures"]
        if not isinstance(sigs, list) or not all(isinstance(s, dict) and set(s.keys()) == {"by", "sig"} for s in sigs):
            return False, "%s signatures must be a list of {by, sig}" % at, None
        bys = [s["by"] for s in sigs]
        if any(b not in ("old", "new") for b in bys) or len(bys) != len(set(bys)):
            return False, "%s signatures must be at most one by old and one by new" % at, None
        msg = signing_bytes(e, V.canonical)
        need = ("old", "new") if e["reason"] == "rotation" else ("new",)
        for who in need:
            if who not in bys:
                return False, "%s is not signed by the %s key; a %s handover needs %s" % (
                    at, who, e["reason"], " and ".join(need)), None
        for s in sigs:
            key = old if s["by"] == "old" else new
            if V.ed25519_verify(key, s["sig"], msg) is not True:
                return False, "%s carries a %s signature that does not verify" % (at, s["by"]), None
        if old == from_pub and retired is None:
            retired = {"block": blk, "reason": e["reason"]}
        prev = e
    if chain[-1]["new_public_key_ed25519_b64"] != to_pub:
        return False, "the chain ends at a key other than the one this key_url serves now", None
    if new_keys_include_old(chain, to_pub):
        return False, "the key served now was retired earlier in the chain", None
    if retired is None:
        return False, "the key that signed this record is not retired anywhere in the chain", None
    return True, "", retired


def new_keys_include_old(chain, to_pub):
    return any(e["old_public_key_ed25519_b64"] == to_pub for e in chain)


def sign_handover(entry, old_priv=None, new_priv=None, canonical=None):
    """Test helper: fill signatures for a handover. Keys are cryptography Ed25519PrivateKey."""
    import base64
    msg = signing_bytes(entry, canonical)
    sigs = []
    if old_priv is not None:
        sigs.append({"by": "old", "sig": base64.b64encode(old_priv.sign(msg)).decode("ascii")})
    if new_priv is not None:
        sigs.append({"by": "new", "sig": base64.b64encode(new_priv.sign(msg)).decode("ascii")})
    out = dict(entry)
    out["signatures"] = sigs
    return out
