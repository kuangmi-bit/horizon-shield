"""The TSUGI port against the frozen JavaScript output: for every case in src/nenrin_verify/tsugi_selftest.json.gz
(the repository's real chains under the command lines that matter, and edits that reach every refusal code), the
Python command prints the same bytes as `node tsugi_verify.mjs` and exits the same way. Where the JavaScript threw,
the port raises. Needs no Node."""
import gzip
import json
import os

import pytest

from nenrin_verify import tsugi

DOC = json.loads(gzip.decompress(open(os.path.join(os.path.dirname(tsugi.__file__), "tsugi_selftest.json.gz"), "rb").read()).decode("utf-8"))


def _reader(files):
    def read(path):
        if not isinstance(path, str):
            raise tsugi.JSTypeError("path is not a string")
        return files[path]
    return read


@pytest.mark.parametrize("c", DOC["cases"], ids=[c["name"] for c in DOC["cases"]])
def test_frozen_case(c):
    js = c["js"]
    try:
        out, code = tsugi.run(c["args"], read_file=_reader(c["files"]))
    except tsugi.NotReproduced:
        raise
    except Exception:
        assert js["threw"], "the port raised where the JavaScript printed a report"
        return
    assert not js["threw"], "the JavaScript threw where the port printed a report"
    assert tsugi.output_text(out) == js["stdout"]
    assert code == js["exit"]


def test_every_refusal_code_is_reached():
    codes = set()
    for c in DOC["cases"]:
        for line in c["js"]["stdout"].split("\n"):
            if '"code": ' in line:
                codes.add(line.split('"code": ')[1].strip(' ",'))
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk", "tsugi_verify.mjs"), encoding="utf-8").read() \
        if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sdk", "tsugi_verify.mjs")) else None
    if src is None:
        pytest.skip("needs the repository's sdk/tsugi_verify.mjs")
    import re
    in_js = set(re.findall(r'refuse\("([a-z0-9_]+)"', src)) | set(re.findall(r'code: "([a-z0-9_]+)"', src))
    assert in_js - codes == set()
