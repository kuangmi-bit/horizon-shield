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
        "OPEN: receipts = [\"x\"] with a grant. Proposal: a non-object element "
        "is not a receipt, the set is empty, execution_incomplete_pair", b)
    c = Case()
    b = c.clean()
    good = b["receipt"]
    b["receipt"] = 5
    b["receipts"] = [good]
    out["receipt_key_not_object"] = (
        "OPEN: receipt = 5. Proposal: a record key that is present but not an "
        "object is not presented, so receipts[0] is the primary", b)
    c = Case()
    b = c.clean()
    b["grant"] = "g"
    out["grant_key_not_object"] = (
        "OPEN: grant = \"g\" with a receipt. Proposal: not presented, so the "
        "receipt set has no grant, execution_incomplete_pair", b)
    c = Case()
    b = c.clean()
    b["intent"] = 5
    out["intent_key_not_object"] = (
        "OPEN: intent = 5. Proposal: not presented, so step 3 emits nothing", b)
    return out


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
                "verdict, sorted refusal codes, sorted finding codes. Cases "
                "marked OPEN in INTEROP.md are proposals, not settled rules.",
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
    print(f"\n{len(built)} fixtures -> {out_dir} (self-check mismatches: {bad})")


if __name__ == "__main__":
    main()
