#!/usr/bin/env python3
"""Run this project's settle v1.10 approver check on a vectors.json someone else published, one line per vector.

    python3 hs_approval_on.py <vectors.json>     (run from workers/hs-ledger/nenrin/musubi-v0)

The output has the same shape as babyblueviper1's verify_approval_v2.py, so TSUNAGI can put the two side by side:
"ok|NG  <id>  <result>  <reason>" and a last line "<n>/<total> agree". Nothing is fetched; the file is read as given.
"""
import os, sys
sys.path.insert(0, os.getcwd())
from contract_v0 import parse_strict, contract_sha256
import settle_v1_10 as v110


def main(path):
    V = parse_strict(open(path, encoding="utf-8").read())
    for name, c in V["contracts"].items():
        if contract_sha256(c) != V["contract_sha256"][name]:
            print("contract digest differs for %s" % name); return 1
    agree = 0
    for vec in V["vectors"]:
        c = V["contracts"][vec["contract"]]
        got = v110.verify_approver_approval(c, vec["approval"]) if vec.get("approval") is not None else (v110.policy_reading(c), None)
        want = (vec["expect"]["result"], vec["expect"].get("reason"))
        ok = tuple(got) == want
        agree += ok
        print("%-4s %-44s %-22s %s" % ("ok" if ok else "NG", vec["id"], got[0], got[1] or ""))
    print("%d/%d agree" % (agree, len(V["vectors"])))
    return 0 if agree == len(V["vectors"]) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
