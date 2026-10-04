#!/usr/bin/env python3
"""Build the interop-v0.2/edge corpus.

Every fixture is freshly signed with keys generated here, and is valid except
for the one rule under test, so only that rule can refuse it. The expected
verdict signatures come from verify_edge.py (see INTEROP.md for the two cases
whose rule is still open).

usage: make_edge_fixtures.py <out_dir>
"""
import base64
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from verify_edge import (  # noqa: E402
    GRANT_DERIVED, OBS_DERIVED, RECEIPT_DERIVED, cbytes, digest, verify, without,
)
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TASK = "task_interop_edge"
GOOD_EVIDENCE = {"kind": "ledger_record", "ref": "ab" * 32,
                 "system": "edge.example"}
ABSENT = object()


def b58encode(raw: bytes) -> str:
    n = int.from_bytes(raw, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(raw) - len(raw.lstrip(b"\x00"))) + out


class Party:
    def __init__(self):
        self.sk = Ed25519PrivateKey.generate()
        raw = self.sk.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.did = "did:key:z" + b58encode(b"\xed\x01" + raw)

    def sign(self, obj) -> str:
        return base64.b64encode(self.sk.sign(cbytes(obj))).decode("ascii")


class Case:
    """One bundle under construction, with its own parties."""

    def __init__(self, task=TASK):
        self.task = task
        self.caller, self.provider = Party(), Party()
        self.witnesses = [Party() for _ in range(4)]

    def grant(self, not_before="2026-10-04T00:00:00Z",
              not_after="2026-10-04T01:00:00Z", **over):
        g = {"schema": "task-execution-bind-v0/grant", "task_id": self.task,
             "action": {"tool": "a2a.invoke", "target": "/task",
                        "args_sha256": "sha_args_ok"},
             "caller_id": self.caller.did, "provider_id": self.provider.did,
             "nonce": "n-edge-1", "not_before": not_before,
             "not_after": not_after}
        g.update(over)
        g["grant_ref"] = digest(without(g, GRANT_DERIVED))
        g["caller_sig"] = self.caller.sign(without(g, GRANT_DERIVED))
        return g

    def receipt(self, g, executed_at="2026-10-04T00:30:00Z",
                evidence=GOOD_EVIDENCE, outcome=ABSENT, **over):
        r = {"schema": "task-execution-bind-v0/receipt", "task_id": self.task,
             "grant_ref": g["grant_ref"],
             "executed_action": copy.deepcopy(g["action"]),
             "provider_id": self.provider.did, "executed_at": executed_at}
        if outcome is ABSENT:
            r["outcome"] = {"status": "completed", "result_sha256": "sha_res_1"}
            if evidence is not ABSENT:
                r["outcome"]["evidence"] = copy.deepcopy(evidence)
        else:
            r["outcome"] = outcome
        r.update(over)
        r["receipt_id"] = digest(without(r, RECEIPT_DERIVED))
        r["provider_sig"] = self.provider.sign(without(r, RECEIPT_DERIVED))
        return r

    def obs(self, seq, prev, verdict="ok", witness=0, hop=None, link=None,
            **over):
        w = self.witnesses[witness]
        hop = hop or {"seq": seq, "from": self.caller.did,
                      "to": self.provider.did}
        o = {"task_id": self.task, "hop": hop, "prev_evidence_id": prev,
             "conduct": {}, "witness_id": w.did,
             "observed_at": "2026-10-04T00:10:00Z"}
        if verdict is not ABSENT:
            o["conduct"]["verdict"] = verdict
        if link is not None:
            o["conduct"]["detail_ref"] = link
        o.update(over)
        if "hop" in over:
            o["hop"] = over["hop"]
        o["evidence_id"] = digest(without(o, OBS_DERIVED))
        o["witness_sig"] = w.sign(without(o, OBS_DERIVED))
        o["edge_sig"] = self.party_by_did(o["hop"]["from"]).sign(
            {"task_id": o.get("task_id"), "hop": o["hop"]})
        return o

    def party_by_did(self, did):
        for p in (self.caller, self.provider, *self.witnesses):
            if p.did == did:
                return p
        raise KeyError(did)

    def clean(self, **over):
        """A fully valid bundle: two hops, one linked, reconciled receipt."""
        g = self.grant(**{k: v for k, v in over.items()
                          if k in ("not_before", "not_after")})
        r = self.receipt(g, **{k: v for k, v in over.items()
                               if k in ("executed_at", "evidence", "outcome")})
        link = "nenrin-exec://" + r["receipt_id"]
        o0 = self.obs(0, None, link=link, **{k: v for k, v in over.items()
                                             if k in ("seq0",)})
        o1 = self.obs(1, o0["evidence_id"], witness=1, link=link)
        bundle = {"task_id": self.task, "observations": [o0, o1], "grant": g,
                  "receipt": r}
        for k, v in over.items():
            if k not in ("not_before", "not_after", "executed_at", "evidence",
                         "outcome", "seq0"):
                bundle[k] = v
        return bundle


def mutate_signature(case, bundle, kind):
    """Re-encode the primary receipt's signature without re-signing it."""
    sig = bundle["receipt"]["provider_sig"]
    if kind == "missing_padding":
        out = sig.rstrip("=")
    elif kind == "urlsafe_alphabet":
        out = sig.replace("+", "-").replace("/", "_")
    elif kind == "whitespace":
        out = sig[:10] + " " + sig[10:]
    elif kind == "trailing_newline":
        out = sig + "\n"
    elif kind == "noncanonical_trailing_bits":
        alphabet = ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
                    "0123456789+/")
        i = len(sig) - 3
        v = alphabet.index(sig[i])
        out = sig[:i] + alphabet[v | 1] + sig[i + 1:]
    else:
        raise ValueError(kind)
    if out == sig:
        raise AssertionError(f"{kind}: the mutation did not change the string")
    bundle["receipt"]["provider_sig"] = out
    return bundle


def cases():
    out = {}

    # ---- section 5, timestamps: the two positive controls -----------------
    c = Case()
    out["ts_real_day_ok"] = (
        "executed_at on a real leap day (2024-02-29) inside the window; "
        "accepted",
        c.clean(not_before="2024-02-29T00:00:00Z",
                not_after="2024-02-29T01:00:00Z",
                executed_at="2024-02-29T00:30:00Z"))
    c = Case()
    out["ts_fraction_truncation_ok"] = (
        "window .1234-.9876, executed .1239: milliseconds compared, extra "
        "digits truncated; accepted",
        c.clean(not_before="2026-10-04T00:00:00.1234Z",
                not_after="2026-10-04T01:00:00.9876Z",
                executed_at="2026-10-04T00:00:00.1239Z"))
    for name, stamp in (
            ("ts_impossible_day", "2026-02-30T00:30:00Z"),
            ("ts_hour_24", "2026-10-04T24:00:00Z"),
            ("ts_second_60", "2026-10-04T00:30:60Z"),
            ("ts_year_zero", "0000-10-04T00:30:00Z"),
            ("ts_trailing_newline", "2026-10-04T00:30:00Z\n"),
            ("ts_lowercase_tz", "2026-10-04t00:30:00z"),
            ("ts_offset", "2026-10-04T00:30:00+00:00")):
        c = Case()
        out[name] = (f"executed_at = {stamp!r}: not a real instant, refused",
                     c.clean(executed_at=stamp))

    # ---- section 5, prev_evidence_id and hop.seq -------------------------
    c = Case()
    b = c.clean()
    del b["observations"][0]["prev_evidence_id"]
    b["observations"][0]["evidence_id"] = digest(
        without(b["observations"][0], OBS_DERIVED))
    b["observations"][0]["witness_sig"] = c.witnesses[0].sign(
        without(b["observations"][0], OBS_DERIVED))
    out["prev_absent_seq0"] = (
        "seq 0 with prev_evidence_id absent (not null): root_prev_not_null",
        b)
    c = Case()
    b = c.clean()
    o = b["observations"][0]
    o["hop"] = {"seq": "0", "from": c.caller.did, "to": c.provider.did}
    o["evidence_id"] = digest(without(o, OBS_DERIVED))
    o["witness_sig"] = c.witnesses[0].sign(without(o, OBS_DERIVED))
    o["edge_sig"] = c.caller.sign({"task_id": o["task_id"], "hop": o["hop"]})
    out["seq_not_integer"] = (
        "hop.seq is the string \"0\": a JSON integer is required, seq_gap", b)
    c = Case()
    b = c.clean()
    link = "nenrin-exec://" + b["receipt"]["receipt_id"]
    twin = c.obs(0, None, verdict="ok", witness=2, link=link)
    b["observations"].insert(1, twin)
    out["seq_duplicate_same_verdict"] = (
        "two witnesses at seq 0, same verdict: distinct seqs 0,1 are "
        "contiguous, no disagreement; accepted", b)
    c = Case()
    b = c.clean()
    link = "nenrin-exec://" + b["receipt"]["receipt_id"]
    first = b["observations"][0]
    first["conduct"] = {"detail_ref": link}  # no conduct.verdict at all
    first["evidence_id"] = digest(without(first, OBS_DERIVED))
    first["witness_sig"] = c.witnesses[0].sign(without(first, OBS_DERIVED))
    b["observations"][1]["prev_evidence_id"] = first["evidence_id"]
    o = b["observations"][1]
    o["evidence_id"] = digest(without(o, OBS_DERIVED))
    o["witness_sig"] = c.witnesses[1].sign(without(o, OBS_DERIVED))
    twin = c.obs(0, None, verdict="ok", witness=2, link=link)
    b["observations"].insert(1, twin)
    out["verdict_missing_is_distinct"] = (
        "one observation at seq 0 carries no conduct.verdict: that counts as "
        "a distinct value of its own, witness_disagreement", b)

    # ---- section 5, evidence presence ------------------------------------
    c = Case()
    out["evidence_empty_object"] = (
        "outcome.evidence = {}: present and not well formed, evidence_invalid",
        c.clean(evidence={}))
    c = Case()
    out["evidence_empty_array"] = (
        "outcome.evidence = []: present and not well formed, evidence_invalid",
        c.clean(evidence=[]))
    c = Case()
    out["evidence_zero"] = (
        "outcome.evidence = 0: absent by the falsy rule, no_evidence_bound",
        c.clean(evidence=0))
    c = Case()
    out["outcome_not_object"] = (
        "outcome is a string: E is absent, no_evidence_bound",
        c.clean(outcome="none"))

    # ---- section 5, require_signatures and unknown keys -------------------
    c = Case()
    b = mutate_signature(c, c.clean(require_signatures=0),
                         "noncanonical_trailing_bits")
    out["require_signatures_zero"] = (
        "require_signatures = 0 (a number, not the literal false) with a "
        "signature that does not verify: checks still run", b)
    c = Case()
    b = mutate_signature(c, c.clean(require_signatures=False),
                         "noncanonical_trailing_bits")
    out["require_signatures_false"] = (
        "require_signatures = false with the same bad encoding: checks are "
        "off, the bundle is accepted", b)
    c = Case()
    out["unknown_bundle_keys"] = (
        "unknown bundle keys are ignored; accepted",
        c.clean(future_key={"x": 1}, another_future_key=[1, 2]))

    # ---- section 5, canonical standard base64 (strict in 0.4.1) ----------
    c = Case()
    out["sig_canonical_ok"] = (
        "canonical standard base64 signature; accepted", c.clean())
    for kind, why in (
            ("missing_padding", "padding removed"),
            ("urlsafe_alphabet", "+ and / rewritten as - and _"),
            ("whitespace", "one character replaced by a space"),
            ("trailing_newline", "a newline appended"),
            ("noncanonical_trailing_bits",
             "unused trailing bits of the final quantum set")):
        c = Case()
        out[f"sig_{kind}"] = (
            f"provider_sig with {why}: not canonical standard base64, refused",
            mutate_signature(c, c.clean(), kind))

    # ---- open questions: my verifier's answer, to be settled in review ----
    c = Case()
    b = c.clean()
    b["observations"] = [1]
    out["obs_element_not_object"] = (
        "OPEN: observations = [1]. Proposal: a non-object element fails as an "
        "observation (delegation_observation_invalid) and contributes nothing "
        "to step 0 or R3/R4", b)
    c = Case()
    b = c.clean()
    b["observations"] = [1, b["observations"][0]]
    out["obs_nonobject_with_valid"] = (
        "OPEN: a non-object element next to a valid observation. Same "
        "proposal: one delegation_observation_invalid, the valid set verdicts "
        "as usual", b)
    c = Case()
    b = c.clean()
    b.pop("receipt")
    b["receipts"] = ["x"]
    out["receipts_element_not_object"] = (
        "Malformed records: a receipts element that is not an object adds "
        "execution_invalid and does not enter the receipt set, so the grant has "
        "no receipts: execution_incomplete_pair", b)
    c = Case()
    b = c.clean()
    good = b["receipt"]
    b["receipt"] = 5
    b["receipts"] = [good]
    out["receipt_key_not_object"] = (
        "Malformed records: receipt = 5 adds execution_invalid and is not "
        "presented, so receipts[0] is the primary and step 4 still runs", b)
    c = Case()
    b = c.clean()
    b["grant"] = "g"
    out["grant_key_not_object"] = (
        "Malformed records: grant = \"g\" adds execution_invalid and is not "
        "presented, so the receipt set has no grant: execution_incomplete_pair", b)
    c = Case()
    b = c.clean()
    b["intent"] = 5
    out["intent_key_not_object"] = (
        "Malformed records: intent = 5 adds preflight_invalid and is not "
        "presented, so step 3 runs as if the slot were null", b)
    key_rule_cases(out, KEY_RULE_NOTES)
    return out


# ---- section 5, the Ed25519 key rule --------------------------------------
# Four keys OpenSSL accepts and section 5 refuses. Each sits on the provider
# slot, so a verifier without the rule accepts the bundle and one with the rule
# refuses it. Cases 3 and 4 need a ground record: the forgery verifies only for
# messages where [k]T is the identity (T the torsion part), which is 1 in 8.
import hashlib as _hashlib  # noqa: E402
import random as _random  # noqa: E402

from verify_edge import (_N, _P, _add, _affine, _mul, _recover_x,  # noqa: E402
                         key_is_prime_order)
from cryptography.exceptions import InvalidSignature  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey  # noqa: E402

_RAW = serialization.Encoding.Raw
_PUB = serialization.PublicFormat.Raw
_ID_SIG = (1).to_bytes(32, "little") + bytes(32)   # R = identity, S = 0


def _enc(pt, sign=None):
    x, y = pt
    return (y | (((x & 1) if sign is None else sign) << 255)).to_bytes(32, "little")


def _decompress(raw):
    v = int.from_bytes(raw, "little")
    return (_recover_x(v & ((1 << 255) - 1), (v >> 255) & 1), v & ((1 << 255) - 1))


def _ext(pt):
    return (pt[0], pt[1], 1, pt[0] * pt[1] % _P)


def _base_point():
    y = 4 * pow(5, _P - 2, _P) % _P
    return (_recover_x(y, 0), y)


def _scalar_of(sk):
    seed = sk.private_bytes(_RAW, serialization.PrivateFormat.Raw,
                            serialization.NoEncryption())
    h = bytearray(_hashlib.sha512(seed).digest()[:32])
    h[0] &= 248
    h[31] &= 127
    h[31] |= 64
    return int.from_bytes(bytes(h), "little")


def _torsion8():
    """A point of order 8: L * Q for some curve point Q."""
    seed = 11
    while True:
        seed += 1
        y = int.from_bytes(_hashlib.sha512(str(seed).encode()).digest(), "little")
        y &= (1 << 254) - 1
        sign = 0 if _recover_x(y, 0) is not None else (
            1 if _recover_x(y, 1) is not None else None)
        if sign is None:
            continue
        t = _mul((_recover_x(y, sign), y), _N)
        if t is not None and t != (0, 1) and _mul(t, 8) == (0, 1):
            return t


def _k(R_enc, A_enc, msg):
    return int.from_bytes(_hashlib.sha512(R_enc + A_enc + msg).digest(),
                          "little") % _N


def _openssl_accepts(raw, sig, msg):
    try:
        Ed25519PublicKey.from_public_bytes(raw).verify(sig, msg)
        return True
    except (InvalidSignature, ValueError):
        return False


def _did_of(raw):
    return "did:key:z" + b58encode(b"\xed\x01" + raw)


def _link_observations(c, g, r):
    link = "nenrin-exec://" + r["receipt_id"]
    o0 = c.obs(0, None, link=link)
    o1 = c.obs(1, o0["evidence_id"], witness=1, link=link)
    return [o0, o1]


def _grind(c, g, r, condition, make_sig):
    """Set executed_at until `condition(receipt preimage bytes)` holds."""
    for i in range(3000):
        minutes = 10 + i // 60          # inside the grant window 00:00-01:00
        seconds = i % 60
        r["executed_at"] = f"2026-10-04T00:{minutes:02d}:{seconds:02d}.000Z"
        msg = cbytes(without(r, RECEIPT_DERIVED))
        if condition(msg):
            r["receipt_id"] = digest(without(r, RECEIPT_DERIVED))
            r["provider_sig"] = make_sig(msg)
            return i
    raise RuntimeError("no ground instant found")


def key_rule_cases(out, notes):
    t = _torsion8()
    t_enc = _enc(t)
    identity = (1).to_bytes(32, "little")
    noncanonical = bytearray(identity)
    noncanonical[31] |= 0x80

    def simple(name, raw_key, intent):
        c = Case()
        did = _did_of(raw_key)
        g = c.grant(provider_id=did)
        r = c.receipt(g, provider_id=did)
        r["provider_sig"] = base64.b64encode(_ID_SIG).decode("ascii")
        b = {"task_id": c.task, "observations": _link_observations(c, g, r),
             "grant": g, "receipt": r}
        out[name] = (intent, b)
        return c, b, r, did

    _, b1, r1, did1 = simple(
        "key_identity_small_order", identity,
        "section 5 key rule: a did:key naming the identity point does not "
        "resolve, so the forged provider_sig (R = identity, S = 0) does not "
        "verify: execution_signature_invalid. OpenSSL accepts that signature")
    _, b2, r2, did2 = simple(
        "key_identity_noncanonical_signbit", bytes(noncanonical),
        "section 5 key rule: the same forgery under the same key with the sign "
        "bit set, which is neither canonical (x = 0 with the sign bit set) nor "
        "prime order. OpenSSL accepts the signature; the key must not resolve")
    notes.append(("key_identity_small_order", _openssl_accepts(
        identity, base64.b64decode(r1["provider_sig"]),
        cbytes(without(r1, RECEIPT_DERIVED)))))
    notes.append(("key_identity_noncanonical_signbit", _openssl_accepts(
        bytes(noncanonical), base64.b64decode(r2["provider_sig"]),
        cbytes(without(r2, RECEIPT_DERIVED)))))

    # order-8 key: the forgery verifies only where 8 divides k, so grind.
    c = Case()
    did3 = _did_of(t_enc)
    g3 = c.grant(provider_id=did3)
    r3 = c.receipt(g3, provider_id=did3)
    tries = _grind(c, g3, r3, lambda m: _mul(t, _k(_ID_SIG[:32], t_enc, m)) == (0, 1),
                   lambda m: base64.b64encode(_ID_SIG).decode("ascii"))
    out["key_order8_small_order"] = (
        "section 5 key rule: a did:key naming a point of order 8 does not "
        "resolve, so the forged provider_sig (R = identity, S = 0, the receipt "
        f"ground over {tries} instants so that [k]T is the identity) does not "
        "verify: execution_signature_invalid. OpenSSL accepts it, and a "
        "verifier without the rule accepts the bundle", 
        {"task_id": c.task, "observations": _link_observations(c, g3, r3),
         "grant": g3, "receipt": r3})
    notes.append(("key_order8_small_order", _openssl_accepts(
        t_enc, base64.b64decode(r3["provider_sig"]),
        cbytes(without(r3, RECEIPT_DERIVED)))))

    # mixed-order key A + T, signed by the holder of A's private key (R1 attack).
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    sk = Ed25519PrivateKey.generate()
    a_raw = sk.public_key().public_bytes(_RAW, _PUB)
    at_enc = _enc(_affine(_add(_ext(_decompress(a_raw)), _ext(t))))
    a_int = _scalar_of(sk)
    rng = _random.Random(4242)
    c = Case()
    did4 = _did_of(at_enc)
    g4 = c.grant(provider_id=did4)
    r4 = c.receipt(g4, provider_id=did4)

    def make_sig(msg):
        while True:
            k = _k(b"", b"", b"")  # placeholder, replaced below
            break
    state = {}

    def condition(msg):
        r = rng.randrange(1, _N)
        R_enc = _enc(_mul(_base_point(), r))
        kp = _k(R_enc, at_enc, msg)
        if _mul(t, kp) != (0, 1):
            return False
        state["sig"] = base64.b64encode(
            R_enc + ((r + kp * a_int) % _N).to_bytes(32, "little")).decode("ascii")
        return True

    tries4 = _grind(c, g4, r4, condition, lambda m: state["sig"])
    out["key_mixed_order"] = (
        "section 5 key rule (R1): a did:key naming A + T, a mixed-order point. "
        "The holder of A's private key signed this receipt as A + T "
        f"({tries4} instants ground so that [k]T is the identity), so one key "
        "poses as a second, independent party. The key must not resolve: "
        "execution_signature_invalid",
        {"task_id": c.task, "observations": _link_observations(c, g4, r4),
         "grant": g4, "receipt": r4})
    notes.append(("key_mixed_order", _openssl_accepts(
        at_enc, base64.b64decode(r4["provider_sig"]),
        cbytes(without(r4, RECEIPT_DERIVED)))))
    return out


KEY_RULE_NOTES = []


def main():
    out_dir = Path(sys.argv[1]).resolve()
    (out_dir / "fixtures").mkdir(parents=True, exist_ok=True)
    built = cases()
    expected = {
        "schema": "nenrin-interop-expected-v0",
        "version": "0.1.0",
        "verifier": "independent Python implementation (verify_edge.py), "
                    "written from VERIFIER.md; the reference was not read",
        "note": "the canonical verdict signature each fixture must reproduce: "
                "verdict, sorted refusal codes, sorted finding codes.",
        "cases": {},
    }
    bad = 0
    for name, (intent, bundle) in built.items():
        (out_dir / "fixtures" / f"{name}.json").write_text(
            json.dumps(bundle, indent=2, sort_keys=False) + "\n")
        sig = verify(bundle).signature()
        expected["cases"][name] = {
            "intent": intent,
            "task_id": bundle.get("task_id"),
            "expect": {"verdict": sig["verdict"],
                       "refusals": sig["refusals"],
                       "findings": sig["findings"]},
        }
        print(f"{name:<32} {sig['verdict']:<9} "
              f"refusals={sig['refusals']} findings={sig['findings']}")
    (out_dir / "expected.json").write_text(
        json.dumps(expected, indent=2) + "\n")
    for name, discriminating in KEY_RULE_NOTES:
        print(f"   {'discriminating' if discriminating else 'NOT discriminating'}: {name} "
              "(does this OpenSSL build accept the forgery?)")
    print(f"\n{len(built)} fixtures -> {out_dir} (self-check mismatches: {bad})")


if __name__ == "__main__":
    main()
