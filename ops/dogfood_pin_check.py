#!/usr/bin/env python3
"""ops/dogfood_pin_check.py

The conduct-witness-dogfood workflow pins the sha256 of the walker, the task binder and the
producer it fetches from main, and refuses to walk with a tool it did not pin. That refusal is
right, but it means every change to one of those three files silently breaks the weekly run
until the pin is moved. This check compares the pins in the workflow with the files in the
working tree, so the pin moves in the same commit as the file.

    python3 ops/dogfood_pin_check.py          exit 0 when every pin matches, 1 otherwise

Standard library only. It reads two local files per pin and fetches nothing.
"""
import hashlib, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WF = os.path.join(ROOT, ".github", "workflows", "conduct-witness-dogfood.yml")
WALK = os.path.join(ROOT, "workers", "hs-ledger", "nenrin", "a2a-conduct-walk")
PINS = {"walker_sha256": "a2a_conduct_walk.py", "task_bind_sha256": "task_bind.py", "producer_sha256": "task_witness_emit.py"}


def main():
    text = open(WF, encoding="utf-8").read()
    bad = 0
    for key, name in PINS.items():
        m = re.search(r"^\s*" + key + r":\s*([0-9a-f]{64})\s*$", text, re.M)
        if not m:
            print("  FAIL  %s: no pin in %s" % (key, os.path.relpath(WF, ROOT)))
            bad += 1
            continue
        got = hashlib.sha256(open(os.path.join(WALK, name), "rb").read()).hexdigest()
        if got == m.group(1):
            print("  ok    %s = %s  %s" % (key, got[:12], name))
        else:
            print("  FAIL  %s pins %s but %s is %s" % (key, m.group(1)[:12], name, got))
            bad += 1
    print("=== dogfood pins: %s ===" % ("ALL MATCH" if not bad else "%d MISMATCH" % bad))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
