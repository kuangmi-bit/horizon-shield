"""Command line entry points.

  nenrin-verify bundle.json            the provenance report, exit 0 accepted, 1 refused (as npm nenrin-verify)
  nenrin-verify --sha bundle.json      one line: verdict and report_sha256, for comparing with the JavaScript run
  nenrin-verify --selftest             re-run the frozen bundles shipped in the package against the JavaScript
                                       reports frozen with them; exit 0 only when every one matches
  nenrin-agreement-verify record.json  the agreement report (the repository's agreement_verify.py, unchanged)
"""
import sys

from . import report_sha256, verify_bundle, __version__
from ._js import loads, stringify


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("-V", "--version"):
        print("nenrin-verify " + __version__)
        return 0
    if argv and argv[0] == "--selftest":
        return selftest()
    sha_only = False
    if argv and argv[0] == "--sha":
        sha_only, argv = True, argv[1:]
    if len(argv) != 1 or argv[0].startswith("-"):
        print("usage: nenrin-verify [--sha] <bundle.json> | --selftest | --version", file=sys.stderr)
        return 2
    try:
        with open(argv[0], "rb") as f:
            bundle = loads(f.read())
        report = verify_bundle(bundle)
    except RecursionError:
        print("nenrin-verify: the input is nested deeper than this Python allows; no report", file=sys.stderr)
        return 2
    except Exception as e:
        print("nenrin-verify: no report for this input (%s: %s)" % (type(e).__name__, e), file=sys.stderr)
        return 2
    if sha_only:
        print(report["verdict"] + " " + report_sha256(report))
    else:
        print(stringify(report, indent=2))
    return 0 if report["verdict"] == "accepted" else 1


def selftest():
    import hashlib
    import json
    import os
    from . import consume_evidence, did_key_resolver
    doc = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "selftest.json"), encoding="utf-8"))
    ok = 0
    for c in doc["cases"]:
        bundle = loads(json.dumps(c["bundle"], ensure_ascii=False))
        rep = verify_bundle(bundle)
        inp = dict(bundle)
        inp["resolve"] = did_key_resolver
        con = hashlib.sha256(stringify(consume_evidence(inp), sort_keys=True).encode("utf-8")).hexdigest()
        same = rep["verdict"] == c["verdict"] and report_sha256(rep) == c["report_sha256"] and con == c["consume_sha256"]
        ok += same
        if not same:
            print("DIFFERS  " + c["name"])
    n = len(doc["cases"])
    print("%d/%d frozen bundles give the same report as %s" % (ok, n, doc["reference"]))
    return 0 if ok == n else 1


def agreement_main(argv=None):
    from . import agreement_verify
    return agreement_verify.main(argv)


if __name__ == "__main__":
    sys.exit(main())
