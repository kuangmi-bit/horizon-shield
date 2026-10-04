"""interop-v0.2/edge (PR #30, kuangmi-bit): one vector per rule VERIFIER.md section 5 pins, with expectations cut by an
independent implementation written from the text alone. The port and the JavaScript reference must both reproduce every
verdict signature. The corpus is frozen; its own runner is python/run_edge.py (the independent verifier)."""
import json
import os
import shutil
import subprocess

import pytest

import nenrin_verify as N

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = os.path.normpath(os.path.join(HERE, "..", "..", "interop-v0.2", "edge"))
JS_FILE = os.environ.get("NENRIN_JS") or os.path.normpath(os.path.join(HERE, "..", "..", "sdk", "nenrin_verify.mjs"))

pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(EDGE, "expected.json")), reason="needs interop-v0.2/edge")


def _cases():
    with open(os.path.join(EDGE, "expected.json"), encoding="utf-8") as f:
        return json.load(f)["cases"]


def _want(c):
    return c["expect"]["verdict"], sorted(c["expect"]["refusals"]), sorted(c["expect"]["findings"])


def _bundle(name):
    with open(os.path.join(EDGE, "fixtures", name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def test_python_port_reproduces_every_edge_signature():
    cases = _cases()
    assert len(cases) >= 36
    bad = {}
    for name, c in cases.items():
        r = N.verify_bundle(_bundle(name))
        got = (r["verdict"], sorted(x["code"] for x in r["refusals"]), sorted(x["code"] for x in r["findings"]))
        if got != _want(c):
            bad[name] = (got, _want(c))
    assert bad == {}, bad


@pytest.mark.skipif(not (shutil.which("node") and os.path.exists(JS_FILE)), reason="needs node and nenrin_verify.mjs")
def test_javascript_reference_reproduces_every_edge_signature():
    proc = subprocess.run(["node", os.path.join(EDGE, "run_edge.mjs")], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ALL PASS" in proc.stdout
