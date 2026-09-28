#!/usr/bin/env python3
"""Tests for ops/agreement_republish.py with throwaway keys. Needs the cryptography package.

    python3 ops/agreement_republish_test.py
"""
import copy, io, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
V = os.path.abspath(os.path.join(HERE, "..", "workers", "hs-ledger", "nenrin", "agreement-v0"))
sys.path.insert(0, V)
sys.path.insert(0, HERE)
import base64  # noqa: E402
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402
from agreement_verify import EXAMPLE_V11, verify, canonical  # noqa: E402
import agreement_sign as S  # noqa: E402
import agreement_republish as R  # noqa: E402

OK = []


def t(name, cond, detail=""):
    OK.append(bool(cond))
    print(("  ok    " if cond else "  FAIL  ") + name + ("" if cond else "  " + str(detail)))


def keypair():
    k = Ed25519PrivateKey.generate()
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return k, base64.b64encode(pub).decode("ascii")


KA, PA = keypair()
KB, PB = keypair()
H = "b" * 64


def both_signed_base():
    r = copy.deepcopy(EXAMPLE_V11)
    r["lower_bound"] = {"kind": "bitcoin_block", "height": 968325, "hash": "a" * 64}
    r["parties"][0]["public_key_ed25519_b64"] = PA
    r["parties"][1]["public_key_ed25519_b64"] = PB
    r, _ = S.sign(r, KA, "party-a.example")
    r, _ = S.sign(r, KB, "party-b.example")
    return r


def refuses(fn, needle):
    try:
        fn()
    except ValueError as e:
        return needle in str(e)
    return False


base = both_signed_base()
t("the base is accepted with both signatures", verify(base)["verdict"] == "accepted")

new = R.build(base, 968999, H, "f" * 32, "2026-09-28T05:00:00Z")
t("only the five allowed fields differ",
  sorted(k for k in set(base) | set(new) if base.get(k) != new.get(k)) ==
  ["agreed_at", "agreement_id", "lower_bound", "publication", "signatures"])
t("publication is public and signatures are empty", new["publication"] == "public" and new["signatures"] == [])
t("terms and parties are byte-identical", canonical(new["terms"]) == canonical(base["terms"]) and
  canonical(new["parties"]) == canonical(base["parties"]))
t("the base is not mutated", "publication" not in base and len(base["signatures"]) == 2)
rep = verify(new)
t("unsigned republished bytes read one_sided and nothing else",
  rep["verdict"] == "refused" and [x["code"] for x in rep["refusals"]] == ["one_sided"], rep["refusals"])

moved = copy.deepcopy(new)
moved["signatures"] = copy.deepcopy(base["signatures"])
rep = verify(moved)
t("the old signatures do not carry over to the new bytes",
  rep["verdict"] == "refused" and "signature_invalid" in [x["code"] for x in rep["refusals"]], rep["refusals"])

signed = copy.deepcopy(new)
signed, _ = S.sign(signed, KA, "party-a.example")
t("one new signature is still one_sided", verify(signed)["verdict"] == "refused")
signed, _ = S.sign(signed, KB, "party-b.example")
rep = verify(signed)
t("both sign again: accepted", rep["verdict"] == "accepted" and rep["signatures_checked"], rep["refusals"])
t("the consent the intake reads sits inside the signed bytes",
  b'"publication":"public"' in S.signing_bytes(signed, signed["schema"]))

late = copy.deepcopy(signed)
late["publication"] = "private"
t("flipping publication after both signed breaks the signatures",
  "signature_invalid" in [x["code"] for x in verify(late)["refusals"]])

already = copy.deepcopy(base)
already["publication"] = "public"
t("refuses a base that already says public", refuses(lambda: R.build(already, 968999, H, "f" * 32, "2026-09-28T05:00:00Z"), "already"))
one = copy.deepcopy(base)
one["signatures"] = one["signatures"][:1]
t("refuses a base with one signature", refuses(lambda: R.build(one, 968999, H, "f" * 32, "2026-09-28T05:00:00Z"), "fewer than two"))
t("refuses a lower_bound that is not newer", refuses(lambda: R.build(base, 968325, H, "f" * 32, "2026-09-28T05:00:00Z"), "newer"))
t("refuses the old agreement_id", refuses(lambda: R.build(base, 968999, H, base["agreement_id"], "2026-09-28T05:00:00Z"), "new agreement_id"))
t("refuses agreed_at not after the old one", refuses(lambda: R.build(base, 968999, H, "f" * 32, "2026-09-09T00:00:00Z"), "later"))
t("refuses a bad block hash", refuses(lambda: R.build(base, 968999, "XYZ", "f" * 32, "2026-09-28T05:00:00Z"), "64 lowercase hex"))
v1 = copy.deepcopy(base)
v1["schema"] = "a2a-agreement-v1"
t("refuses a v1 base", refuses(lambda: R.build(v1, 968999, H, "f" * 32, "2026-09-28T05:00:00Z"), "must be"))

with tempfile.TemporaryDirectory() as d:
    bp = os.path.join(d, "base.json")
    io.open(bp, "w", encoding="utf-8").write(canonical(base))
    out = os.path.join(d, "out", "unsigned.json")
    cmd = [sys.executable, os.path.join(HERE, "agreement_republish.py"), bp, "--lb-height", "968999", "--lb-hash", H, "--out", out]
    p = subprocess.run(cmd, capture_output=True, text=True)
    t("CLI writes the unsigned bytes and exits 0", p.returncode == 0 and os.path.exists(out), p.stderr)
    if os.path.exists(out):
        w = json.loads(io.open(out, encoding="utf-8").read())
        t("CLI output is canonical and says public", io.open(out, encoding="utf-8").read() == canonical(w) and w["publication"] == "public")
    half = copy.deepcopy(base)
    half["signatures"] = half["signatures"][:1]
    io.open(bp, "w", encoding="utf-8").write(canonical(half))
    p = subprocess.run(cmd, capture_output=True, text=True)
    t("CLI refuses a base that is not accepted (exit 2)", p.returncode == 2 and "not accepted" in p.stderr, p.stderr)
    tam = copy.deepcopy(base)
    tam["terms"]["what"] = "something the other party never signed"
    io.open(bp, "w", encoding="utf-8").write(canonical(tam))
    p = subprocess.run(cmd, capture_output=True, text=True)
    t("CLI refuses a base whose terms were edited after signing (exit 2)", p.returncode == 2, p.stderr)

print("=== %d / %d 合格 (agreement_republish) ===" % (sum(OK), len(OK)))
sys.exit(0 if all(OK) else 1)
