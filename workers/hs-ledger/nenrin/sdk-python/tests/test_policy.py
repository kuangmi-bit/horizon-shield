"""policy: a developer's own rule over a NENRIN resume. The fixture is the live resume of
https://mcp.horizonshield.dev/mcp as the ledger served it on 2026-10-02; resume_sha256 must recompute from it."""
import copy
import json
import os

import pytest

from nenrin_verify import policy as P

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "resume_mcp_20261002.json")


def live():
    return json.load(open(FIX, encoding="utf-8"))


def signed(res, hosts):
    r = copy.deepcopy(res)
    for m, h in zip(r["measurements"], hosts):
        m["witness"]["key_url"] = "https://%s/.well-known/nenrin-witness.json" % h if h else None
    r["resume_sha256"] = P.resume_sha256(r)
    return r


def test_the_live_resume_recomputes():
    assert P.resume_sha256(live()) == live()["resume_sha256"]


def test_default_rule_counts_only_signed_domains():
    d = P.evaluate(live())
    assert d["resume_recomputes"] and not d["allow"]
    assert all(x["why"].startswith("no key_url") for x in d["not_counted"])


def test_name_and_vantage_and_excluded_names():
    assert P.evaluate(live(), {"independence": "name_and_vantage"})["allow"]
    d = P.evaluate(live(), {"independence": "name_and_vantage", "exclude_names": ["Self-Witness"]})
    assert not d["allow"] and len(d["independent_passing_witnesses"]) == 1


def test_window():
    d = P.evaluate(live(), {"independence": "name_and_vantage", "min_independent_witnesses": 1, "within_days": 20})
    assert d["allow"] and {c["measured_at"][:10] for c in d["counted"]} == {"2026-09-14", "2026-09-15"}
    assert not P.evaluate(live(), {"independence": "name_and_vantage", "min_independent_witnesses": 1, "within_days": 5})["allow"]


def test_a_tampered_resume_is_denied():
    r = live()
    r["measurements"][0]["outcome"] = "FAIL"
    d = P.evaluate(r, {"independence": "name_and_vantage", "max_fail": 5, "min_independent_witnesses": 0})
    assert not d["allow"] and not d["resume_recomputes"]


def test_signed_domains_subject_and_exclusions():
    r = signed(live(), ["witness-a.example", "b.witness.example", "mcp.horizonshield.dev"])
    d = P.evaluate(r)
    assert d["allow"] and d["independent_passing_witnesses"] == ["domain:b.witness.example", "domain:witness-a.example"]
    assert d["not_counted"][0]["why"] == "the witness is the measured agent's own domain"
    assert not P.evaluate(r, {"exclude_domains": ["witness.example"]})["allow"]


def test_fail_records_deny():
    r = signed(live(), ["a.example", "b.example", "c.example"])
    r["measurements"][2]["outcome"] = "FAIL"
    r["resume_sha256"] = P.resume_sha256(r)
    d = P.evaluate(r)
    assert not d["allow"] and d["fail_records"] == 1
    assert P.evaluate(r, {"max_fail": 1})["allow"]


def test_supplied_record_bytes_are_checked():
    r = signed(live(), ["a.example", "b.example", None])
    sha = r["measurements"][0]["record_sha256"]
    d = P.evaluate(r, records={sha: "not the bytes"})
    assert not d["allow"] and d["not_counted"][0]["why"].startswith("the record bytes")


def test_deterministic_and_strict_rule():
    assert P.evaluate(live())["decision_sha256"] == P.evaluate(live())["decision_sha256"]
    with pytest.raises(ValueError):
        P.evaluate(live(), {"min_independant_witnesses": 2})
    with pytest.raises(ValueError):
        P.evaluate(live(), {"max_fail": -1})


def test_signatures_verified_here(tmp_path):
    import base64
    import hashlib
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    r = signed(live(), ["a.example", "b.example", None])
    recs = {}
    for i, m in enumerate(r["measurements"][:2]):
        k = Ed25519PrivateKey.generate()
        rc = '{"n":%d}' % i
        m["record_sha256"] = hashlib.sha256(rc.encode()).hexdigest()
        pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
        recs[m["record_sha256"]] = {"record_canonical": rc, "public_key_ed25519_b64": pub,
                                    "signature_ed25519_b64": base64.b64encode(k.sign(rc.encode())).decode()}
    r["resume_sha256"] = P.resume_sha256(r)
    d = P.evaluate(r, {"require_verified_signature": True}, records=recs)
    assert d["allow"] and all(c["signature_verified_here"] for c in d["counted"])
    assert not P.evaluate(r, {"require_verified_signature": True})["allow"]
    bad = dict(recs)
    k0 = list(bad)[0]
    bad[k0] = dict(bad[k0], signature_ed25519_b64=base64.b64encode(b"\0" * 64).decode())
    d = P.evaluate(r, {"require_verified_signature": True}, records=bad)
    assert not d["allow"] and any("does not verify" in x["why"] for x in d["not_counted"])


def test_noncanonical_base64_is_not_counted():
    """0.4.2: a record whose signature or key is not canonical standard base64 is not counted, even if it would decode."""
    import base64
    import hashlib
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.generate()
    rc = '{"n":1}'
    sha = hashlib.sha256(rc.encode()).hexdigest()
    pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    sig = base64.b64encode(k.sign(rc.encode())).decode()
    good = {"record_canonical": rc, "public_key_ed25519_b64": pub, "signature_ed25519_b64": sig}
    assert P._check_record(good, sha) == (None, True)
    for bad in (dict(good, signature_ed25519_b64=sig.rstrip("=")), dict(good, signature_ed25519_b64=sig + "\n"),
                dict(good, public_key_ed25519_b64=pub.rstrip("=")), dict(good, public_key_ed25519_b64=" " + pub)):
        why, ok = P._check_record(bad, sha)
        assert ok is False and "canonical standard base64" in why


def test_small_order_key_is_not_counted():
    """0.4.2: under a small-order key, R = identity and S = 0 verifies on every message; such a record is not counted."""
    import hashlib
    rc = '{"n":2}'
    sha = hashlib.sha256(rc.encode()).hexdigest()
    rec = {"record_canonical": rc, "public_key_ed25519_b64": "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
           "signature_ed25519_b64": "AQ" + "A" * 84 + "=="}
    why, ok = P._check_record(rec, sha)
    assert ok is False and "usable Ed25519 key" in why
