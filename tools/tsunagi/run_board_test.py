#!/usr/bin/env python3
"""Offline checks of how TSUNAGI reads each implementation's output. No network, no clones."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_board as rb

fail = 0
def t(name, ok):
    global fail
    print(("ok   " if ok else "NG   ") + name); fail += (not ok)

r = rb.parse("count_line", 0, "interop-v0: 5/5 verdict signatures reproduced\n", 5)
t("count line: 5/5 and exit 0 is a pass", r["passed"] and r["reproduced"] == 5)
r = rb.parse("count_line", 1, "interop-v0: 4/5 verdict signatures reproduced\n", 5)
t("count line: 4/5 is not a pass", not r["passed"])
r = rb.parse("count_line", 0, "13/13 verdict signatures reproduced\n", 36)
t("count line: a full count of a smaller corpus than registered is not a pass", not r["passed"])
r = rb.parse("count_line", 0, "nothing printed here\n", 5)
t("count line: no count line is not a pass", not r["passed"] and r["reproduced"] is None)
r = rb.parse("all_pass", 0, "ALL PASS (nenrin reference interop)\n", 13)
t("all pass: the phrase and exit 0 is a pass", r["passed"])
r = rb.parse("all_pass", 1, "ALL PASS\n", 13)
t("all pass: a non-zero exit is not a pass even with the phrase", not r["passed"])
out = "ok   v2-a   approved   \nok   v2-b   approval_unverified    bad_signature\n2/2 agree\n"
r = rb.parse("approval_lines", 0, out, 2)
t("approval lines: per vector result and reason", r["passed"] and r["per_vector"]["v2-b"] == {"ok": True, "result": "approval_unverified", "reason": "bad_signature"} and r["per_vector"]["v2-a"]["reason"] is None)
r = rb.parse("json_results", 0, 'noise line\n{"passed": true, "results": [{"id": "S3-001", "matches": true, "canonical_sha256": "aa"}, {"id": "S3-002", "matches": false}]}', 2)
t("json results: a vector that does not match is not a pass", not r["passed"] and r["reproduced"] == 1 and r["per_vector"]["S3-002"]["ok"] is False)
r = rb.parse("pytest", 0, "..........\n10 passed in 0.22s\n", 10)
t("pytest: 10 passed is a pass", r["passed"])
r = rb.parse("pytest", 1, "9 passed, 1 failed in 0.3s\n", 10)
t("pytest: one failure is not a pass", not r["passed"] and r["of"] == 10)
try:
    rb.parse("guess", 0, "", 1); t("an unknown parse kind is refused", False)
except ValueError:
    t("an unknown parse kind is refused", True)
spec = __import__("json").load(open(os.path.join(rb.HERE, "implementations.json"), encoding="utf-8"))
ids = [i["id"] for i in spec["implementations"]]
t("implementation ids are unique", len(ids) == len(set(ids)))
t("every outside row names a public https repository and a licence", all(i["repo"] and i["repo"].startswith("https://") and i.get("license") for i in spec["implementations"] if not i["ours"]))
t("every pair names two registered implementations", all(p["a"] in ids and p["b"] in ids for p in spec["pairs"]))
print("")
if fail:
    print("FAIL %d (tsunagi)" % fail); sys.exit(1)
print("ALL PASS (tsunagi: how each implementation's output is read)")
