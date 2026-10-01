"""The TSUGI port against tsugi_verify.mjs itself, on the frozen cases and on edits of every path of the real chains.

Needs Node and the JavaScript file (the repository's sdk/tsugi_verify.mjs, or TSUGI_JS=/path/to/it); skipped
otherwise. Each input is written once as JSON text and both languages read the same text. Pass condition per input:
both threw, or both print the same bytes and exit the same way. Inputs on which the port raises NotReproduced are
counted and listed, never passed silently, and each must be one of the limits the README states (a URL host that
needs UTS #46, an IPv6 or file URL, a code point this Python's Unicode tables do not assign).

Node 22 writes one refusal text differently from Node 24 (tsugi.KEY_LENGTH_MESSAGE); the JavaScript output is
compared after writing Node 22's text as Node 24's.
"""
import gzip
import json
import os
import shutil
import subprocess
import sys

import pytest

from nenrin_verify import tsugi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "parity"))
from mutate_tsugi import mutations  # noqa: E402
from tsugi_tools import dumps  # noqa: E402

JS_FILE = os.environ.get("TSUGI_JS") or os.path.normpath(os.path.join(HERE, "..", "..", "sdk", "tsugi_verify.mjs"))
DOC = json.loads(gzip.decompress(open(os.path.join(os.path.dirname(tsugi.__file__), "tsugi_selftest.json.gz"), "rb").read()).decode("utf-8"))
NODE22_KEY_TEXT = "Ed25519 raw keys must be exactly 32-bytes"

pytestmark = pytest.mark.skipif(not (shutil.which("node") and os.path.exists(JS_FILE)), reason="needs node and tsugi_verify.mjs")

# The frozen cases every path of which is edited: (raw edits, re-sealed edits). The strict chain is the week's chain
# with a signed authorization, so its raw edits would repeat the week's; only its re-sealed edits are run.
BASES = {
    "incident: strict with the embedded operator key": (True, True),
    "week: lenient": (True, True),
    "strict: signed by the operator": (False, True),
    "witness: full policy": (True, True),
}
CHUNK = 2000


def _py(c):
    def read(p):
        if not isinstance(p, str):
            raise tsugi.JSTypeError("path")
        if p not in c["files"]:
            raise FileNotFoundError(p)
        return c["files"][p]
    try:
        out, code = tsugi.run(c["args"], read_file=read)
    except tsugi.Usage:
        return {"usage": True, "exit": 2, "threw": False}
    except tsugi.NotReproduced as e:
        return {"unreproduced": str(e)}
    except Exception as e:
        return {"threw": True, "error": "%s: %s" % (type(e).__name__, e)}
    return {"stdout": tsugi.output_text(out), "exit": code, "threw": False}


def _corpus():
    by_name = {c["name"]: c for c in DOC["cases"]}
    seen, out = set(), []
    for c in DOC["cases"]:
        out.append((c["name"], "", "frozen", {"args": c["args"], "files": c["files"]}))
    for name, (raw, deep) in BASES.items():
        c = by_name[name]
        chain = json.loads(c["files"]["chain.json"])
        pool = json.loads(c["files"]["pool.json"]) if "pool.json" in c["files"] else None
        for p, op, edited in mutations(chain, pool, deep=deep, raw=raw):
            text = dumps(edited)
            if text in seen:
                continue
            seen.add(text)
            out.append((name, "/".join(map(str, p)), op, {"args": c["args"], "files": dict(c["files"], **{"chain.json": text})}))
        if pool is not None:
            for p, op, edited in mutations(pool, None, deep=False):
                files = dict(c["files"], **{"pool.json": dumps(edited)})
                out.append((name, "pool/" + "/".join(map(str, p)), op, {"args": c["args"], "files": files}))
    return out


def test_live_differential():
    corpus = _corpus()
    js = []
    for at in range(0, len(corpus), CHUNK):
        proc = subprocess.run(["node", os.path.join(HERE, "parity", "tsugi_runner.mjs"), JS_FILE],
                              input="\n".join(json.dumps(x[3], ensure_ascii=True) for x in corpus[at:at + CHUNK]) + "\n",
                              capture_output=True, text=True, encoding="utf-8")
        assert proc.returncode == 0, proc.stderr[-2000:]
        js += [json.loads(l) for l in proc.stdout.split("\n") if l]
    assert len(js) == len(corpus)
    bad, threw, unrep, ok_count = [], 0, [], 0
    for (name, p, op, c), j in zip(corpus, js):
        if "stdout" in j:
            j["stdout"] = j["stdout"].replace(NODE22_KEY_TEXT, tsugi.KEY_LENGTH_MESSAGE)
        py = _py(c)
        if "unreproduced" in py:
            unrep.append((name, p, op, py["unreproduced"], "js threw" if j["threw"] else "js answered"))
            continue
        if j["threw"] or py["threw"]:
            threw += 1
            if j["threw"] != py["threw"]:
                bad.append((name, p, op, "js threw" if j["threw"] else "python threw", j.get("error") or py.get("error")))
            continue
        if j.get("stdout") != py.get("stdout") or j["exit"] != py["exit"]:
            bad.append((name, p, op, "output differs", None))
            continue
        ok_count += j["exit"] == 0
    print("\ntsugi live differential: %d inputs, %d accepted by both, %d both threw, %d not reproduced, %d differ"
          % (len(corpus), ok_count, threw, len(unrep), len(bad)))
    for u in unrep[:15]:
        print("   not reproduced:", u)
    for b in bad[:25]:
        print("  ", b)
    assert len(corpus) > 10000
    assert not bad
    stated = ("URL host outside ASCII", "URL host with an xn-- label", "URL host that is not UTF-8", "IPv6 URL host",
              "file URL host", "toLowerCase of a code point")
    assert not [u for u in unrep if not u[3].startswith(stated)]
