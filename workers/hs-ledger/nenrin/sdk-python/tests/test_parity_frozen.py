"""The Python port against the frozen JavaScript reports (tests/fixtures/js_reports.json). No Node needed.

For every frozen bundle: the same verdict, the same report byte for byte under the shared sorted-key form, the
same report_sha256, the same consume_evidence projection, and the same CLI stdout as `node nenrin_verify.mjs`.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

import pytest

import nenrin_verify as nv
from nenrin_verify._js import loads, stringify

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLES = json.load(open(os.path.join(HERE, "fixtures", "bundles.json"), encoding="utf-8"))["cases"]
JS = {c["name"]: c for c in json.load(open(os.path.join(HERE, "fixtures", "js_reports.json"), encoding="utf-8"))["cases"]}
NAMES = [c["name"] for c in BUNDLES]


def _bundle(name):
    text = json.dumps(next(c["bundle"] for c in BUNDLES if c["name"] == name), ensure_ascii=False)
    return loads(text)


def test_corpus_is_whole():
    assert len(BUNDLES) == len(JS) == 31
    verdicts = [JS[n]["verdict"] for n in NAMES]
    assert verdicts.count("accepted") == 13 and verdicts.count("refused") == 18


@pytest.mark.parametrize("name", NAMES)
def test_report_matches_javascript(name):
    rep = nv.verify_bundle(_bundle(name))
    assert rep["verdict"] == JS[name]["verdict"]
    assert stringify(rep, sort_keys=True) == JS[name]["report_canon"]
    assert nv.report_sha256(rep) == JS[name]["report_sha256"]


@pytest.mark.parametrize("name", NAMES)
def test_consume_matches_javascript(name):
    inp = dict(_bundle(name))
    inp["resolve"] = nv.did_key_resolver
    con = nv.consume_evidence(inp)
    assert hashlib.sha256(stringify(con, sort_keys=True).encode("utf-8")).hexdigest() == JS[name]["consume_sha256"]


@pytest.mark.parametrize("name", ["full_accepted", "tampered_receipt", "non_ascii_and_escapes", "witness_disagreement"])
def test_cli_stdout_matches_javascript(name):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(next(c["bundle"] for c in BUNDLES if c["name"] == name), f, ensure_ascii=False)
    p = subprocess.run([sys.executable, "-m", "nenrin_verify.cli", f.name], capture_output=True)
    os.unlink(f.name)
    assert p.stdout.decode("utf-8") == JS[name]["cli_stdout"]
    assert p.returncode == (0 if JS[name]["verdict"] == "accepted" else 1)
