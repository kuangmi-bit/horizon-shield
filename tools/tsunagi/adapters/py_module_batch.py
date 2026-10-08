#!/usr/bin/env python3
"""TSUNAGI batch adapter for a Python verifier that exposes verify(bundle).

    python3 py_module_batch.py <module> <in.json> <out.json>      (the module is found on PYTHONPATH)
    python3 py_module_batch.py --nenrin-verify <in.json> <out.json>  (this project's PyPI port, nenrin_verify)

The adapter only calls the author's own verify() and writes what it returns; the board compares the result with the
corpus itself. Accepted return shapes: an object with .signature(), a dict {"verdict","refusals","findings"}, or a
tuple whose first item is one of those. Refusal and finding entries may be codes or {"code": ...} objects.
"""
import importlib, json, os, sys


def codes(xs):
    return sorted((x["code"] if isinstance(x, dict) else x) for x in xs)


def as_sig(r):
    if isinstance(r, tuple):
        r = r[0]
    if hasattr(r, "signature"):
        r = r.signature()
    return {"verdict": r["verdict"], "refusals": codes(r["refusals"]), "findings": codes(r["findings"])}


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr); return 2
    mod, inp, outp = sys.argv[1:]
    if mod == "--nenrin-verify":
        here = os.path.dirname(os.path.abspath(__file__))
        sys.path.insert(0, os.path.join(here, "..", "..", "..", "workers", "hs-ledger", "nenrin", "sdk-python", "src"))
        import nenrin_verify as m

        def verify(b):
            b = dict(b); b["resolve"] = m.did_key_resolver
            return m.verify_provenance(b)
    else:
        verify = importlib.import_module(mod).verify
    out = {}
    for c in json.load(open(inp, encoding="utf-8")):
        try:
            out[c["name"]] = as_sig(verify(json.loads(json.dumps(c["bundle"]))))
        except Exception as e:  # a crash is recorded as this case's result, never hidden
            out[c["name"]] = {"error": "%s: %s" % (type(e).__name__, str(e)[:160])}
    json.dump(out, open(outp, "w", encoding="utf-8"))
    print("wrote %d verdict signatures (%s)" % (len(out), mod))
    return 0


if __name__ == "__main__":
    sys.exit(main())
