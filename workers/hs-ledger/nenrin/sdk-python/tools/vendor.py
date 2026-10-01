"""Copy the repository's agreement verifier into the package, unchanged but for one import line.

The agreement verifier (agreement-v0/agreement_verify.py and key_succession.py) is already held to its
JavaScript twin by 5,286 frozen reports. Rewriting it for the package would throw that proof away, so the package
carries the files themselves. The only edit is `import key_succession as KS` becoming a package-relative import.
VENDORED.json pins the sha256 of each source and of each vendored file; tests/test_vendored.py refuses a package
whose copies drift from the pins, and, inside the repository, from the sources.

  python3 tools/vendor.py          rewrite the copies and VENDORED.json from ../agreement-v0
  python3 tools/vendor.py --check  exit 1 if the copies are not what this script would write
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.normpath(os.path.join(ROOT, "..", "agreement-v0"))
DST = os.path.join(ROOT, "src", "nenrin_verify")
FILES = ["agreement_verify.py", "key_succession.py"]
EDITS = {"agreement_verify.py": [("    import key_succession as KS\n", "    from . import key_succession as KS\n")]}
HEADER = "# VENDORED from workers/hs-ledger/nenrin/agreement-v0/%s by tools/vendor.py. Do not edit; edit the source.\n"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def build():
    out, pins = {}, {}
    for name in FILES:
        src = open(os.path.join(SRC, name), "rb").read().decode("utf-8")
        text = src
        for old, new in EDITS.get(name, []):
            if text.count(old) != 1:
                raise SystemExit("%s: expected exactly one %r" % (name, old.strip()))
            text = text.replace(old, new)
        if text.startswith("#!"):
            first, rest = text.split("\n", 1)
            text = first + "\n" + (HEADER % name) + rest
        else:
            text = (HEADER % name) + text
        data = text.encode("utf-8")
        out[name] = data
        pins[name] = {"source": "workers/hs-ledger/nenrin/agreement-v0/" + name, "source_sha256": sha(src.encode("utf-8")), "vendored_sha256": sha(data)}
    return out, pins


def main(argv):
    out, pins = build()
    if "--check" in argv:
        bad = [n for n, d in out.items() if open(os.path.join(DST, n), "rb").read() != d]
        if bad:
            print("vendored copies differ from what tools/vendor.py writes: " + ", ".join(bad))
            return 1
        print("vendored copies match their sources")
        return 0
    for n, d in out.items():
        open(os.path.join(DST, n), "wb").write(d)
    open(os.path.join(DST, "VENDORED.json"), "w").write(json.dumps(pins, indent=2, sort_keys=True) + "\n")
    print("wrote " + ", ".join(out) + " and VENDORED.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
