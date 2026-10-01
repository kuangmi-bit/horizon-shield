"""The packaged agreement verifier against the repository's frozen reports (agreement-v0/agreement_vectors_v1.json).

The JavaScript verifier is held to the same file by agreement-v0/agreement_verify_test.mjs, so a pass here means
the packaged Python and the JavaScript return the same report on every frozen case. Skipped outside the repository.
"""
import base64
import json
import os
import zlib

import pytest

from nenrin_verify import agreement_verify as AV

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.normpath(os.path.join(HERE, "..", "..", "agreement-v0", "agreement_vectors_v1.json"))
pytestmark = pytest.mark.skipif(not os.path.exists(FIXTURE), reason="needs the repository's agreement-v0 fixture")


def _canon(o):
    return json.dumps(o, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def test_every_frozen_agreement_report():
    env = json.load(open(FIXTURE, encoding="utf-8"))
    doc = AV.parse_strict(zlib.decompress(base64.b64decode(env["payload"])).decode("utf-8"))
    cases = doc["cases"]
    bad = []
    for i, c in enumerate(cases):
        inp = c["input"]
        got = AV.verify(inp["record"], keys=inp.get("keys"), recorder_domain=inp.get("recorder_domain"),
                        now=inp.get("now"), input_text=inp.get("input_text"))
        if _canon(got) != _canon(c["report"]):
            bad.append(i)
    print("\nagreement: %d frozen reports, %d differ" % (len(cases), len(bad)))
    assert len(cases) > 5000
    assert not bad, bad[:10]
