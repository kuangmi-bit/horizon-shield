#!/usr/bin/env python3
"""This project's settle v1.10 approver check in the TSUNAGI batch shape, so the board scores it the way it scores others.

    python3 hs_approval_batch.py IN OUT       (run from workers/hs-ledger/nenrin/musubi-v0)

    IN   [{"name": "<case>", "contract": {...}, "approval": {...} | null}, ...]   (no expected value)
    OUT  {"<case>": {"result": "...", "reason": "..." | null}, ...}, or {"<case>": {"error": "..."}}

approval null is answered with the contract's policy reading, as hs_approval_on.py and settle v1.10 do. Exit 0.
"""
import json, os, sys
sys.path.insert(0, os.getcwd())
import settle_v1_10 as v110


def answer(case):
    c = case.get("contract")
    if not isinstance(c, dict):
        return {"error": "contract missing or not an object"}
    a = case.get("approval")
    got = v110.verify_approver_approval(c, a) if a is not None else (v110.policy_reading(c), None)
    return {"result": got[0], "reason": got[1]}


def main(src, dst):
    out = {}
    for case in json.load(open(src, encoding="utf-8")):
        name = case.get("name") if isinstance(case, dict) else None
        if not isinstance(name, str):
            continue
        try:
            out[name] = answer(case)
        except Exception as e:  # one bad fixture does not end the batch
            out[name] = {"error": "%s: %s" % (type(e).__name__, e)}
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, sort_keys=True, indent=1)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
