#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Admission in two runtimes: the Python reference (admit_v0.py) and its JavaScript twin (admit_v0.mjs) must return the
same record bytes, the same admission sha256 and the same reasons for the same inputs.

  python3 admit_bytematch.py      runs every case in admit_fixtures.admission_cases through both and compares
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import admit_fixtures as F
import admit_v0 as A
import clause_eval_v0 as ce
from contract_v0 import canonical


def main():
    w = F.World()
    cases = F.admission_cases(w)
    py, inputs = [], []
    for c in cases:
        rec = A.admit(c["contract"], c["action_request"], c["presentation"], c["chain_view"], c["revocations"],
                      relying_party=F.RP, admission_id="adm-" + c["name"], seen_nonces=c["seen_nonces"], policy=c["policy"],
                      publication="public" if c["name"].startswith("a0") else None)
        A.sign_admission(rec, w.kr)
        assert A.verify_admission(rec, w.pr, c["contract"])["verdict"] == "accepted", c["name"]
        py.append({"record": canonical(rec), "admission_sha256": A.admission_sha256(rec), "decision": rec["decision"], "reasons": rec["reasons"]})
        inputs.append({"contract": c["contract"], "action_request": c["action_request"], "presentation": c["presentation"],
                       "chain_view": c["chain_view"], "revocations": c["revocations"], "relying_party": F.RP,
                       "admission_id": "adm-" + c["name"], "seen_nonces": c["seen_nonces"], "policy": c["policy"],
                       "publication": "public" if c["name"].startswith("a0") else None,
                       "sign_with_raw_key_hex": F.raw_private_hex("relying-party")})
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "in.json")
        open(p, "w", encoding="utf-8").write(json.dumps(inputs, ensure_ascii=False))
        r = subprocess.run(["node", os.path.join(HERE, "admit_v0.mjs"), "--input", p], capture_output=True, text=True)
    if r.returncode != 0:
        print("node failed:", r.stderr[-600:]); return 1
    js = json.loads(r.stdout)
    bad = 0
    for c, a, b in zip(cases, py, js):
        same = a == b
        want = (a["decision"], a["reasons"]) == c["expect"]
        bad += not (same and want)
        print("%s %-42s %-8s %s%s%s" % ("ok  " if same and want else "NG  ", c["name"], a["decision"], ",".join(a["reasons"]),
                                        "" if same else "   <<< JS: %s %s sha %s vs %s" % (b["decision"], b["reasons"], b["admission_sha256"][:12], a["admission_sha256"][:12]),
                                        "" if want else "   <<< expected %s" % (c["expect"],)))
    reasons = sorted({r for a in py for r in a["reasons"]})
    missing = [r for r in A.REASONS if r not in reasons and r != "signer_not_on_own_domain"]
    print("\nreason codes exercised: %d of %d (signer_not_on_own_domain belongs to verify_admission, not to admit)%s"
          % (len(reasons), len(A.REASONS), "" if not missing else "   <<< never produced: %s" % missing))
    print("evaluator_sha256 %s (clause_eval_v0.py, read by both runtimes)" % ce.evaluator_sha256())
    if bad or missing:
        print("FAILED: %d of %d cases differ" % (bad, len(cases))); return 1
    print("ALL PASS (admit_bytematch: %d cases, record bytes, admission sha256 and reasons identical in Python and JavaScript)" % len(cases))
    return 0


if __name__ == "__main__":
    sys.exit(main())
