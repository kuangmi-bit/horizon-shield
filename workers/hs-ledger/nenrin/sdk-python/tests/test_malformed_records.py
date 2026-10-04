"""0.4.4 (verifier_version 0.1.6): a record slot or list element that is present but not an object (and not null/false)
is refused in its own step with reason record_not_object and is otherwise not presented. The port must neither
raise nor accept, and must give the JavaScript's verdict signature (interop-v0.2/edge settles the rule)."""
import json
import os

import nenrin_verify as N

PASS = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "interop-v0", "fixtures", "pass.json"))


def _pass():
    with open(PASS, encoding="utf-8") as f:
        return json.load(f)


def _sig(r):
    return r["verdict"], sorted(x["code"] for x in r["refusals"]), sorted(x["code"] for x in r["findings"])


def test_malformed_records_are_refused_in_their_step():
    cases = [
        ({"observations": [1]}, "delegation_observation_invalid"),
        ({"receipt": 5}, "execution_invalid"),
        ({"grant": "g"}, "execution_invalid"),
        ({"receipts": [5]}, "execution_invalid"),
        ({"intent": 5}, "preflight_invalid"),
    ]
    for patch, code in cases:
        b = dict(_pass(), **patch)
        r = N.verify_bundle(b)
        assert r["verdict"] == "refused", patch
        assert any(x["code"] == code and x.get("reason") == "record_not_object" for x in r["refusals"]), (patch, r["refusals"])
        assert not any(x["code"] == "task_id_mismatch" for x in r["refusals"]), patch


def test_receipt_slot_malformed_beside_a_valid_receipt_is_not_accepted():
    p = _pass()
    b = dict(p, receipt=5, receipts=[p["receipt"]])
    verdict, refusals, findings = _sig(N.verify_bundle(b))
    assert verdict == "refused" and refusals == ["execution_invalid"]
