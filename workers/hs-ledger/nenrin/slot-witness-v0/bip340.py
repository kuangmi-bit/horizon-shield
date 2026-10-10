# -*- coding: utf-8 -*-
"""BIP-340 Schnorr verification over secp256k1, and NIP-01 event checks, standard library only.

Written from BIP-340 (github.com/bitcoin/bips, bip-0340.mediawiki and reference.py) separately from bip340.mjs,
so the intake and the checker do not share code. Tested against the BIP's test-vectors.csv. sign() exists to build
test fixtures; it is not constant time.
"""
import hashlib, json

P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def tagged_hash(tag, msg):
    t = hashlib.sha256(tag.encode()).digest()
    return hashlib.sha256(t + t + msg).digest()


def _add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and a[1] != b[1]:
        return None
    if a == b:
        lam = 3 * a[0] * a[0] * pow(2 * a[1], P - 2, P) % P
    else:
        lam = (b[1] - a[1]) * pow(b[0] - a[0], P - 2, P) % P
    x3 = (lam * lam - a[0] - b[0]) % P
    return (x3, (lam * (a[0] - x3) - a[1]) % P)


def _mul(pt, k):
    r = None
    while k:
        if k & 1:
            r = _add(r, pt)
        pt = _add(pt, pt)
        k >>= 1
    return r


def _lift_x(x):
    if x >= P:
        return None
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if y * y % P != y_sq:
        return None
    return (x, y if y % 2 == 0 else P - y)


def verify(pub, msg, sig):
    """pub: 32 bytes x-only, msg: bytes, sig: 64 bytes. Exactly BIP-340 Verification."""
    if len(pub) != 32 or len(sig) != 64:
        return False
    pt = _lift_x(int.from_bytes(pub, "big"))
    r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
    if pt is None or r >= P or s >= N:
        return False
    e = int.from_bytes(tagged_hash("BIP0340/challenge", sig[:32] + pub + msg), "big") % N
    R = _add(_mul(G, s), _mul(pt, N - e))
    return R is not None and R[1] % 2 == 0 and R[0] == r


def sign(sk, msg, aux):
    d0 = int.from_bytes(sk, "big")
    if not 0 < d0 < N:
        raise ValueError("secret key out of range")
    pa = _mul(G, d0)
    d = d0 if pa[1] % 2 == 0 else N - d0
    t = (d ^ int.from_bytes(tagged_hash("BIP0340/aux", aux), "big")).to_bytes(32, "big")
    px = pa[0].to_bytes(32, "big")
    k0 = int.from_bytes(tagged_hash("BIP0340/nonce", t + px + msg), "big") % N
    R = _mul(G, k0)
    k = k0 if R[1] % 2 == 0 else N - k0
    e = int.from_bytes(tagged_hash("BIP0340/challenge", R[0].to_bytes(32, "big") + px + msg), "big") % N
    return R[0].to_bytes(32, "big") + ((k + e * d) % N).to_bytes(32, "big")


def nostr_event_id(ev):
    """NIP-01: sha256 of the UTF-8 JSON [0, pubkey, created_at, kind, tags, content] with no whitespace and the
    minimal escapes (", \\, control characters); other characters raw."""
    ser = json.dumps([0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]],
                     separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(ser.encode("utf-8")).hexdigest()


def _hex(s, n):
    return isinstance(s, str) and len(s) == n and all(c in "0123456789abcdef" for c in s)


def nostr_event_check(ev):
    """(ok, why): the event id recomputes and sig is a BIP-340 signature by pubkey over the id bytes."""
    if not isinstance(ev, dict):
        return False, "not an object"
    if not (_hex(ev.get("id"), 64) and _hex(ev.get("pubkey"), 64) and _hex(ev.get("sig"), 128)):
        return False, "id, pubkey or sig is not lower-case hex of the right length"
    if not (isinstance(ev.get("created_at"), int) and not isinstance(ev.get("created_at"), bool) and isinstance(ev.get("kind"), int)
            and isinstance(ev.get("tags"), list) and all(isinstance(t, list) and all(isinstance(x, str) for x in t) for t in ev["tags"])
            and isinstance(ev.get("content"), str)):
        return False, "created_at, kind, tags or content has the wrong type"
    if nostr_event_id(ev) != ev["id"]:
        return False, "the event id does not recompute from its fields (NIP-01)"
    if not verify(bytes.fromhex(ev["pubkey"]), bytes.fromhex(ev["id"]), bytes.fromhex(ev["sig"])):
        return False, "sig is not a valid BIP-340 signature by pubkey over the event id"
    return True, None
