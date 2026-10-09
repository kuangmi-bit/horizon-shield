#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Red team for a2a-admission-v0: every attack in the design's threat model, each with the code that must stop it.

  python3 admit_redteam.py

Each line is one attack. "stopped by" names where it is caught (admit, the record's verifier, or settle v1.11) and
the exact code. A line fails when the code is absent or another verdict comes back.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import admit_fixtures as F
import admit_v0 as A
import adapter_aps_v2 as APS
import adapter_musubi_native as NATIVE
import clause_eval_v0 as ce
import settle_v1_11 as v111
from contract_v0 import canonical, contract_sha256


def main():
    w = F.World()
    P, AP, AN = w.contracts["plain"], w.contracts["admission_plain"], w.contracts["admission_pinned"]
    KEYS = {F.RP["domain"]: w.pr}
    native = lambda c: [NATIVE.read(c)]
    rows = []

    def check(attack, where, code, ok, got=None):
        rows.append((attack, where, code, bool(ok), got))

    def req(c, action, nonce="5a" * 16, **kw):
        return A.build_action_request(c, action, nonce, kw.pop("expiry_height", 500), kw.pop("key", w.kb), **kw)

    def adm_for(c, action, sign=None, override=None, nonce="5a" * 16, **kw):
        a = A.admit(c, req(c, action, nonce=nonce, **kw), native(c), F.VIEW, [], relying_party=F.RP, admission_id="rt")
        if override:
            a["decision"], a["reasons"] = override
        return A.sign_admission(a, sign or w.kr)

    def settle(c, adm, action, adm_height=98, executed=None, nonce="5a" * 16, twice=False):
        ex = {"action": action, "target": None, "amount": None, "nonce": nonce, "expiry_height": 500}
        ex.update(executed or {})
        ref = [{"action": action, "admission_sha256": A.admission_sha256(adm), "executed": ex}]
        blocks = [[], [w.ex(c, [action], admission_ref=ref, ref="1")]] + ([[w.ex(c, [action], admission_ref=ref, ref="2")]] if twice else [])
        recs, view = w.run(blocks, "rt")
        s = v111.settle_v1_11(c, recs, view, admissions=[dict(adm, anchor={"height": adm_height})] if adm_height is not None else [adm], relying_keys=KEYS)
        return sorted(d["clause"] for d in s["deviations"]), s

    # 1. the applicant writes its own admission
    own = adm_for(AP, "delete", sign=w.kb, override=("admit", ["within_grant"]))
    v = A.verify_admission(own, w.pb, AP)
    check("the applicant signs its own admission", "verify_admission", "self_admission", "self_admission" in v["refusals"], v["refusals"])
    v = A.verify_admission(own, w.pr, AP)
    check("the applicant signs, the relying party's key is used to check", "verify_admission", "bad_signature", v["refusals"] == ["bad_signature"], v["refusals"])
    cl, _ = settle(AP, own, "delete")
    check("that self made admission is named by an execution", "settle v1.11", "unadmitted_execution", "unadmitted_execution" in cl, cl)
    off = A.sign_admission(A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [], relying_party={"domain": "shop.example", "key_url": "https://evil.example/k.json"}, admission_id="x"), w.kr)
    v = A.verify_admission(off, w.pr, AP)
    check("the signing key is served from another domain", "verify_admission", "signer_not_on_own_domain", v["refusals"] == ["signer_not_on_own_domain"], v["refusals"])

    # 2. admitted for one thing, something else is done
    good = adm_for(AP, "read")
    cl, _ = settle(AP, good, "read", executed={"target": "/payments"})
    check("admitted read, executed against another target", "settle v1.11", "executed_other_than_admitted", cl == ["executed_other_than_admitted"], cl)
    cl, _ = settle(AP, good, "read", executed={"amount": 999999})
    check("admitted read, executed with another amount", "settle v1.11", "executed_other_than_admitted", cl == ["executed_other_than_admitted"], cl)
    r = req(AP, "read"); r["action"]["action"] = "delete"
    a = A.admit(AP, r, native(AP), F.VIEW, [], relying_party=F.RP)
    check("the request is edited to another action after signing", "admit", "action_digest_mismatch", a["decision"] == "refuse" and "action_digest_mismatch" in a["reasons"], a["reasons"])

    # 3. one admission, two executions; one nonce, two requests
    cl, _ = settle(AP, good, "read", twice=True)
    check("the same admission is named by two executions", "settle v1.11", "unadmitted_execution", cl == ["unadmitted_execution"], cl)
    a = A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [], relying_party=F.RP, seen_nonces=["5a" * 16])
    check("a request repeats a nonce the relying party has seen", "admit", "nonce_reused", (a["decision"], a["reasons"]) == ("refuse", ["nonce_reused"]), a["reasons"])

    # 4. the admission is written after the act
    cl, _ = settle(AP, good, "read", adm_height=140)
    check("the admission is anchored after the execution", "settle v1.11", "admission_after_execution", cl == ["admission_after_execution"], cl)
    cl, _ = settle(AP, good, "read", adm_height=None)
    check("the admission was never anchored", "settle v1.11", "admission_after_execution", cl == ["admission_after_execution"], cl)

    # 5. the relying party lets through what the grant does not allow
    for act, clause in (("delete", "prohibited"), ("transfer", "unauthorized"), ("refund", "conditional")):
        waved = adm_for(AP, act, override=("admit", ["within_grant"]))
        cl, s = settle(AP, waved, act)
        why = next((d["why"] for d in s["deviations"] if d["clause"] == "admitted_out_of_grant"), "")
        check("the relying party signs admit for %s (%s)" % (act, clause), "settle v1.11", "admitted_out_of_grant", "admitted_out_of_grant" in cl and "shop.example" in why, cl)

    # 6. a revoked grant, a revoked key
    def anchored(rec, h):
        return dict(rec, anchor={"height": h, "block_hash": "00" * 32, "proof": []})
    a = A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [anchored(A.build_revocation(AP, w.ka), 99)], relying_party=F.RP)
    check("a request under a grant the principal revoked", "admit", "grant_revoked", (a["decision"], a["reasons"]) == ("refuse", ["grant_revoked"]), a["reasons"])
    a = A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [anchored(A.build_revocation(AP, w.ka, revoked_key_b64=w.pb), 99)], relying_party=F.RP)
    check("a request signed with a key the principal revoked", "admit", "key_revoked", (a["decision"], a["reasons"]) == ("refuse", ["key_revoked"]), a["reasons"])
    a = A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [anchored(A.build_revocation(AP, w.kb), 98), anchored(A.build_revocation(AP, w.kf), 98)], relying_party=F.RP)
    check("a revocation forged by the contractor or a stranger (must NOT revoke)", "admit", "within_grant", a["decision"] == "admit", a["reasons"])
    a = A.admit(AP, req(AP, "read"), native(AP), F.VIEW, [anchored(A.build_revocation(AP, w.ka), 100)], relying_party=F.RP)
    check("a revocation anchored after the view (stated limit: not visible)", "admit", "within_grant", a["decision"] == "admit" and "after the chain view" in " ".join(a["does_not_establish"]), a["reasons"])

    # 7. a delegation that widens the grant
    wide = dict(AP["grant"], authorized_actions=AP["grant"]["authorized_actions"] + ["transfer"])
    item = NATIVE.read(AP, child={"grant": wide})
    a = A.admit(AP, req(AP, "read"), native(AP) + [dict(item, verified=True)], F.VIEW, [], relying_party=F.RP)
    check("a delegated grant adds an action its parent lacks", "admit", "delegation_exceeds_parent", item["within_parent"] is False and "delegation_exceeds_parent" in a["reasons"] and a["decision"] == "refuse", a["reasons"])
    narrow = dict(AP["grant"], authorized_actions=["emit_witness"])
    item = NATIVE.read(AP, child={"grant": narrow})
    a = A.admit(AP, req(AP, "read"), native(AP) + [dict(item, verified=True)], F.VIEW, [], relying_party=F.RP)
    check("a delegate asks for an action its own narrower grant lacks", "admit", "outside_grant", item["within_parent"] is True and (a["decision"], a["reasons"]) == ("refuse", ["outside_grant"]), a["reasons"])

    # 8. an identity nobody verified
    aps = APS.read(APS._issue_for_selftest("redteam"), now="2026-07-17T00:00:00.000Z")
    a = A.admit(AP, req(AP, "read"), native(AP) + [aps], F.VIEW, [], relying_party=F.RP)
    check("a passport with no verified result (null) beside a good contract", "admit", "presentation_unverifiable", aps["verified"] is None and (a["decision"], a["reasons"]) == ("refuse", ["presentation_unverifiable"]), a["reasons"])
    a = A.admit(AP, req(AP, "read"), native(AP) + [dict(aps, verified="true")], F.VIEW, [], relying_party=F.RP)
    check("the same item with verified set to the string \"true\"", "admit", "presentation_unverifiable", a["decision"] == "refuse" and a["presentation_ref"][1]["verified"] is None, a["reasons"])
    a = A.admit(AP, req(AP, "delete"), native(AP) + [aps], F.VIEW, [], relying_party=F.RP, policy={"on_unverifiable": "escalate", "admit_everything": True})
    check("a policy that tries to soften a prohibited action", "admit", "prohibited_action", a["decision"] == "refuse" and "prohibited_action" in a["reasons"], a["reasons"])
    a = A.admit(AP, req(AP, "read", key=w.kf), native(AP), F.VIEW, [], relying_party=F.RP)
    check("a request signed by a key the contract does not name", "admit", "presentation_unverifiable", (a["decision"], a["reasons"]) == ("refuse", ["presentation_unverifiable"]), a["reasons"])
    a = A.admit(dict(AP, nonce="0" * 32), req(AP, "read"), native(AP), F.VIEW, [], relying_party=F.RP)
    check("the contract was edited after both parties signed", "admit", "presentation_unverifiable", a["decision"] == "refuse" and "presentation_unverifiable" in a["reasons"], a["reasons"])

    # 9. admission and settlement made to disagree
    _, s = settle(AP, good, "read")
    check("admission and settlement use different clauses", "both", "evaluator_sha256", good["rules"]["evaluator_sha256"] == s["admission_gate"]["evaluator_sha256"] == ce.evaluator_sha256(), good["rules"])
    esc = adm_for(AN, "emit_witness")
    cl, _ = settle(AN, esc, "emit_witness")
    check("escalate is treated as admit and executed with no approval", "settle v1.11", "executed_after_refusal", esc["decision"] == "escalate" and "executed_after_refusal" in cl, cl)
    ref = adm_for(AP, "delete")
    cl, _ = settle(AP, ref, "delete")
    check("refused, executed anyway", "settle v1.11", "executed_after_refusal", ref["decision"] == "refuse" and "executed_after_refusal" in cl, cl)

    # 10. HS renders the decision
    rec = good
    check("the record carries a signature other than the relying party's", "record", "signatures", [s_.get("domain") for s_ in rec["signatures"]] == [F.RP["domain"]], rec["signatures"])
    check("the record says HS allowed or blocked", "record", "does_not_establish", rec["does_not_establish"][0].startswith("that HS allowed or blocked anything"), rec["does_not_establish"][0])
    check("the record carries a score", "record", "no score", not any(k in json.loads(canonical(rec)) for k in ("score", "rating", "risk", "trust_level")), list(rec))
    src = open(os.path.join(HERE, "admit_v0.py"), encoding="utf-8").read() + open(os.path.join(HERE, "clause_eval_v0.py"), encoding="utf-8").read()
    check("admit() reaches the network (it must not)", "source", "no socket", not any(x in src for x in ("urllib", "requests", "socket", "http.client", "subprocess")), None)

    bad = 0
    for attack, where, code, ok, got in rows:
        bad += not ok
        print("%s %-74s stopped by %-16s %s%s" % ("ok  " if ok else "NG  ", attack, where, code, "" if ok else "   <<< got %s" % (got,)))
    if bad:
        print("\nFAILED: %d of %d attacks not stopped as stated" % (bad, len(rows))); return 1
    print("\nALL PASS (admit_redteam: %d attacks across the 10 rows of the threat model, each stopped with the stated code)" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
