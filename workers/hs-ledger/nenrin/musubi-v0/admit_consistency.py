#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
The consistency test: admission before the act and settlement after it must not disagree.

This is the one property the admission design rests on. If admit() says an action is inside the grant and the settler
later calls the same action a deviation, the relying party was told something false; if admit() refuses and the
settler finds nothing, the function is noise. So every scenario below is run both ways and compared.

Part 1, the clauses. For contracts with no admission requirement, each (contract, action, approvals, context) is given
to clause_eval_v0.evaluate_action and, as an anchored execution record, to settle v1.10, whose walk (settle v1.6 and
v1.7, published, not edited) is the older statement of the same clauses. The set of clauses must be the same. This is
what holds the shared evaluator to the walk.

Part 2, the decision. For contracts that require admission, admit() decides, the relying party signs, the admission is
anchored, the same action with the same digest is executed, and settle v1.11 settles:

    admit                               -> within_grant, no deviation
    refuse                              -> deviation
    escalate, executed with no approval -> deviation
    escalate, executed with an approval the grant counts -> within_grant

Part 3, the other direction. Whenever settle v1.11 returns within_grant for an executed action, the admission was
admit, or escalate with a countable approval carried. Nothing reaches within_grant past a refusal.

  python3 admit_consistency.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import admit_fixtures as F
import admit_v0 as A
import clause_eval_v0 as ce
import settle_v1_10 as v110
import settle_v1_11 as v111
from contract_v0 import contract_sha256

WALK_CLAUSES = ("revoked", "after_expiry", "prohibited", "conditional", "unauthorized")


def anchored(rec, h):
    return dict(rec, anchor={"height": h, "block_hash": "00" * 32, "proof": []})


def part1(w):
    """evaluate_action against the walk. Returns (checked, failures)."""
    P, N, X = w.contracts["plain"], w.contracts["pinned"], w.contracts["expiring"]
    rows = []
    for c, cname in ((P, "plain"), (N, "pinned")):
        for act in ("read", "delete", "transfer", "refund", "emit_witness", "unknown_thing"):
            offers = [("none", [])]
            if act in ("refund", "emit_witness"):
                offers += [("principal", [w.principal_ok(c, act, "aa" * 16)]),
                           ("approver", [w.approver_ok(c, action=act, nonce="bb" * 16)] if cname == "pinned" else [w.approver_ok(N, action=act, nonce="bb" * 16)]),
                           ("stranger", [w.approver_ok(c if cname == "pinned" else N, action=act, nonce="cc" * 16, key_=w.kf)]),
                           ("bare", [{"action": act}]),
                           ("expired", [w.principal_ok(c, act, "dd" * 16, vu=0)])]
            for oname, aps in offers:
                rows.append(("%s/%s/%s" % (cname, act, oname), c, act, aps, {}))
    rows.append(("expiring/read/after_expiry", X, "read", [], {"late": True}))
    rows.append(("expiring/delete/after_expiry", X, "delete", [], {"late": True}))
    rows.append(("expiring/transfer/after_expiry", X, "transfer", [], {"late": True}))
    rows.append(("plain/read/revoked", P, "read", [], {"revoked": True}))
    rows.append(("plain/delete/revoked", P, "delete", [], {"revoked": True}))
    failures = []
    for i, (name, c, act, aps, ctx) in enumerate(rows):
        blocks = [[w.ex(c, [act], aps)]]
        if ctx.get("late"):
            blocks = [[], [], []] + blocks
        if ctx.get("revoked"):
            blocks = [[A.build_revocation(c, w.ka)]] + blocks
        recs, view = w.run(blocks, "c1%02d" % i)
        h = next(r["anchor"]["height"] for r in recs if r["schema"] == "a2a-execution-v0")
        s = v110.settle_v1_10(c, recs, view)
        walk = sorted({d["clause"] for d in s["deviations"] if d["clause"] in WALK_CLAUSES})
        ev = ce.evaluate_action(c, act, approvals=aps, height=h, authority_ended=bool(ctx.get("revoked")))
        if sorted(set(ev["clauses"])) != walk or (s["verdict"] == "within_grant") != (ev["clauses"] == []):
            failures.append("%s: evaluator %s, settle v1.10 %s (%s)" % (name, ev["clauses"], walk, s["verdict"]))
    return len(rows), failures


def part2(w):
    """admit, then execute the same action, then settle v1.11. Returns (rows, failures, table)."""
    AP, AN = w.contracts["admission_plain"], w.contracts["admission_pinned"]
    KEYS = {F.RP["domain"]: w.pr}
    native = lambda c: [{"adapter": "musubi-native", "sha256": contract_sha256(c), "verified": True}]
    rows = []
    for c, cname in ((AP, "plain"), (AN, "pinned")):
        for act in ("read", "delete", "transfer", "refund", "emit_witness"):
            offers = [("none", [])]
            if act in ("refund", "emit_witness"):
                offers += [("principal", [w.principal_ok(c, act, "aa" * 16)]),
                           ("approver", [w.approver_ok(c if cname == "pinned" else AN, action=act, nonce="bb" * 16)]),
                           ("stranger", [w.approver_ok(c if cname == "pinned" else AN, action=act, nonce="cc" * 16, key_=w.kf)])]
            for oname, aps in offers:
                rows.append(dict(name="%s/%s/%s" % (cname, act, oname), c=c, act=act, aps=aps))
    rows.append(dict(name="plain/read/grant_revoked", c=AP, act="read", aps=[], revs=[anchored(A.build_revocation(AP, w.ka), 98)]))
    rows.append(dict(name="plain/read/key_revoked", c=AP, act="read", aps=[], revs=[anchored(A.build_revocation(AP, w.ka, revoked_key_b64=w.pb), 98)]))
    rows.append(dict(name="plain/read/nonce_reused", c=AP, act="read", aps=[], seen=True))
    rows.append(dict(name="plain/read/request_expired", c=AP, act="read", aps=[], expiry=98))
    rows.append(dict(name="plain/read/presentation_null", c=AP, act="read", aps=[], pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": None, "self_asserted": True}]))
    rows.append(dict(name="plain/read/delegation_wider", c=AP, act="read", aps=[], pres=native(AP) + [{"adapter": "musubi-native", "sha256": "d" * 64, "verified": True, "within_parent": False}]))
    rows.append(dict(name="plain/read/over_limit", c=AP, act="read", aps=[], amount=150000, pres=native(AP) + [{"adapter": "aps-v2", "sha256": "d" * 64, "verified": True, "limits": {"read": 100000}}]))
    rows.append(dict(name="plain/read/requester_is_stranger", c=AP, act="read", aps=[], key=w.kf))
    failures, table = [], []
    for i, r in enumerate(rows):
        c, act, nonce = r["c"], r["act"], "%032x" % (0x5a00 + i)
        req = A.build_action_request(c, act, nonce, r.get("expiry", 500), r.get("key") or w.kb, amount=r.get("amount"), approvals=r["aps"])
        adm = A.admit(c, req, r.get("pres") or native(c), F.VIEW, r.get("revs") or [], relying_party=F.RP, admission_id="adm-%d" % i,
                      seen_nonces=[nonce] if r.get("seen") else ())
        A.sign_admission(adm, w.kr)
        assert A.verify_admission(adm, w.pr, c)["verdict"] == "accepted", r["name"]
        ref = [{"action": act, "admission_sha256": A.admission_sha256(adm),
                "executed": {"action": act, "target": None, "amount": r.get("amount"), "nonce": nonce, "expiry_height": r.get("expiry", 500)}}]

        def settle(approvals):
            recs, view = w.run([[], [w.ex(c, [act], approvals, admission_ref=ref)]], "c2%02d" % i)
            return v111.settle_v1_11(c, recs, view, admissions=[dict(adm, anchor={"height": 98})], relying_keys=KEYS)

        s = settle(r["aps"])
        want = "within_grant" if adm["decision"] == "admit" else "deviation"
        ok = s["verdict"] == want and s["status"] == "final"
        if adm["decision"] == "admit" and s["deviations"]:
            ok = False
        table.append((r["name"], adm["decision"], ",".join(adm["reasons"]), s["verdict"], sorted({d["clause"] for d in s["deviations"]})))
        if not ok:
            failures.append("%s: admit() said %s %s, settle v1.11 said %s %s" % (r["name"], adm["decision"], adm["reasons"], s["verdict"], table[-1][4]))
        if adm["decision"] == "escalate" and act in ("refund", "emit_witness") and adm["reasons"] == ["conditional_needs_approval"]:
            good = [w.approver_ok(c, action=act, nonce="ee" * 16)] if act in ce.gated_actions(c) else [w.principal_ok(c, act, "ee" * 16)]
            s2 = settle(good)
            table.append((r["name"] + " + approval carried", "escalate", "then approved", s2["verdict"], sorted({d["clause"] for d in s2["deviations"]})))
            if s2["verdict"] != "within_grant":
                failures.append("%s: escalate, executed with a countable approval, settle v1.11 said %s %s" % (r["name"], s2["verdict"], table[-1][4]))
        # a refusal that rests on the grant alone must be one the published walk also finds: admit may not refuse what the grant allows
        if adm["decision"] == "refuse" and set(adm["reasons"]) <= {"prohibited_action", "outside_grant"} and not r.get("pres"):
            if not ({d["clause"] for d in s["deviations"]} & {"prohibited", "unauthorized"}):
                failures.append("%s: admit() refused on the grant (%s) and the walk finds neither prohibited nor unauthorized" % (r["name"], adm["reasons"]))
        # part 3: nothing reaches within_grant past a refusal
        if s["verdict"] == "within_grant" and adm["decision"] != "admit":
            failures.append("%s: settle within_grant although the admission was %s" % (r["name"], adm["decision"]))
    return len(rows), failures, table


def main():
    w = F.World()
    n1, f1 = part1(w)
    print("part 1  clause evaluator against the published walk (settle v1.10): %d scenarios, %d disagree" % (n1, len(f1)))
    for x in f1:
        print("  NG  " + x)
    n2, f2, table = part2(w)
    for name, dec, reasons, verdict, clauses in table:
        print("  %-44s admit(): %-8s %-38s settle v1.11: %-12s %s" % (name, dec, reasons, verdict, ",".join(clauses)))
    print("part 2  admit() then the same action executed, settled by v1.11: %d scenarios (%d settlements), %d disagree" % (n2, len(table), len(f2)))
    for x in f2:
        print("  NG  " + x)
    decisions = sorted({t[1] for t in table})
    if f1 or f2 or decisions != ["admit", "escalate", "refuse"]:
        print("FAILED"); return 1
    # A test that cannot fail proves nothing. Three wrong evaluators, each of which this file must notice.
    real = ce.evaluate_action
    def mutant(change):
        def ev(contract, action, **kw):
            out = real(contract, action, **kw)
            out["clauses"] = change(list(out["clauses"]), action)
            return out
        return ev
    caught = []
    for label, change in (("prohibited actions read as allowed", lambda cl, a: [c for c in cl if c != "prohibited"]),
                          ("conditional actions read as allowed", lambda cl, a: [c for c in cl if c != "conditional"]),
                          ("an authorized action read as outside the grant", lambda cl, a: cl + ["unauthorized"] if a == "read" and not cl else cl)):
        ce.evaluate_action = mutant(change)
        try:
            m1 = part1(w)[1]
            m2 = part2(w)[1]
        finally:
            ce.evaluate_action = real
        caught.append((label, len(m1), len(m2)))
        print("mutant  %-48s part 1 notices %d, part 2 notices %d" % (label, len(m1), len(m2)))
    if not all(a > 0 and b > 0 for _, a, b in caught):
        print("FAILED: a wrong evaluator passed"); return 1
    print("\nALL PASS (admit_consistency: %d clause scenarios agree with the walk; %d admit-then-execute scenarios, admit -> within_grant, refuse -> deviation, "
          "escalate -> deviation unless a countable approval is carried; nothing is within_grant past a refusal; 3 wrong evaluators noticed by both parts; evaluator %s)" % (n1, n2, ce.evaluator_sha256()[:16]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
