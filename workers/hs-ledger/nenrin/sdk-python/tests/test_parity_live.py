"""The Python port against the JavaScript verifier itself, on every frozen bundle and on mutations of every path.

Needs Node and the JavaScript file (the repository's sdk/nenrin_verify.mjs, or NENRIN_JS=/path/to/it); skipped
otherwise. Each mutated bundle is written once as JSON text and parsed by each language from the same text.
Pass condition per input: both threw, or both returned the same report and the same consume projection, byte
for byte in the shared sorted-key form.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

import nenrin_verify as nv
from nenrin_verify._js import assign, loads, stringify

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "parity"))
from mutate import mutations  # noqa: E402

JS_FILE = os.environ.get("NENRIN_JS") or os.path.normpath(os.path.join(HERE, "..", "..", "sdk", "nenrin_verify.mjs"))
BUNDLES = json.load(open(os.path.join(HERE, "fixtures", "bundles.json"), encoding="utf-8"))["cases"]

pytestmark = pytest.mark.skipif(not (shutil.which("node") and os.path.exists(JS_FILE)), reason="needs node and nenrin_verify.mjs")


def _py(text):
    try:
        inp = assign(loads(text), {"resolve": nv.did_key_resolver})
        return {"threw": False, "report": stringify(nv.verify_provenance(inp), sort_keys=True),
                "consume": stringify(nv.consume_evidence(inp), sort_keys=True)}
    except Exception as e:
        return {"threw": True, "error": "%s: %s" % (type(e).__name__, e)}


def _corpus():
    seen, out = set(), []
    for c in BUNDLES:
        items = [((), "frozen", c["bundle"])] + list(mutations(c["bundle"]))
        for p, op, b in items:
            text = json.dumps(b, ensure_ascii=False, separators=(",", ":"))
            if text in seen:
                continue
            seen.add(text)
            out.append((c["name"], "/".join(map(str, p)), op, text))
    return out


def test_live_differential():
    corpus = _corpus()
    proc = subprocess.run(["node", os.path.join(HERE, "parity", "js_runner.mjs"), JS_FILE],
                          input="\n".join(t for *_x, t in corpus) + "\n", capture_output=True, text=True, encoding="utf-8")
    assert proc.returncode == 0, proc.stderr[-2000:]
    js = [json.loads(l) for l in proc.stdout.split("\n") if l]
    assert len(js) == len(corpus)
    bad, threw = [], 0
    for (name, p, op, text), j in zip(corpus, js):
        py = _py(text)
        if j["threw"] or py["threw"]:
            threw += 1
            if j["threw"] != py["threw"]:
                bad.append((name, p, op, "js threw" if j["threw"] else "python threw", j.get("error") or py.get("error")))
            continue
        if j["report"] != py["report"] or j["consume"] != py["consume"]:
            bad.append((name, p, op, "report differs", None))
    print("\nlive differential: %d inputs, %d both threw, %d differ" % (len(corpus), threw, len(bad)))
    for b in bad[:25]:
        print("  ", b)
    assert len(corpus) > 10000
    assert not bad
