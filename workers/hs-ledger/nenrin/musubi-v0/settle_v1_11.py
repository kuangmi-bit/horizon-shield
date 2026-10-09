#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI settle v1.11: when the contract requires admission before execution, an execution is read against the
relying party's signed admission (a2a-settlement-v1.11). One rule, and nothing else.

Why this file exists. admit_v0.py lets a relying party decide, at its own door and before the act, whether an action
is inside the signed grant. That decision is only worth something if settlement can check it afterwards: that an
admission existed, that it said admit, that what ran is what was admitted, that the admission was not written after
the fact, and that the relying party did not wave through something outside the grant.

When the rule applies. Only when contract.requirements.admission == "required_before_execution". For every other
contract this file returns settle v1.10's result unchanged, the same bytes, schema line included. run0002, the second
contract and the outside parties' contract d7118f28 carry no such requirement and settle exactly as before.

The rule, for each action in each execution record the lower layers accepted:

  unadmitted_execution           the record's admission_ref names no admission for the action, or names one that is
                                 not in hand, does not verify under the relying party's key, is for other terms, or
                                 was already used by an earlier action
  executed_after_refusal         the admission's decision was refuse, or escalate without a countable approval
                                 carried in the execution record
  executed_other_than_admitted   the digest of what the record says it executed is not the admission's
                                 action_binding_digest (an action changed between admission and execution)
  admission_after_execution      the admission's anchor is above the execution's anchor, or it has none
  admitted_out_of_grant          the admission said admit, and the shared clause evaluator, run here again, puts the
                                 action outside the grant. The relying party's signature is on that admission; this
                                 file states the fact and names the domain, it does not assign fault.

An execution record under such a contract carries
    "admission_ref": [{"action", "admission_sha256", "executed": {"action", "target", "amount", "nonce", "expiry_height"}}]
admission_sha256 is admit_v0.admission_sha256 (the bytes the relying party signed). The lower layers refuse unknown
record fields, so for the length of one call this file adds admission_ref to settle v1.3's execution field list and
restores it in a finally block, the way v1.10 swaps v1.7's classifier. No earlier settle file is edited.

Inputs beyond v1.10: admissions (signed a2a-admission-v0 records, each with the anchor it was given), and relying_keys
({domain: public_key_ed25519_b64}, fetched by the caller from each record's key_url). A settler opens no socket.

Stated limits: as v1.10. The admission's anchor height is read as stated; verifying that anchor against headers is the
same step as for any anchored record and is the caller's when it collects the admissions. A relying party that never
publishes its admissions leaves executions unadmitted; that is the contract's requirement working, not a finding about
the contractor's conduct beyond that.
"""
import argparse, contextlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import settle_v1 as v1
import settle_v1_2 as v12
import settle_v1_3 as v13
import settle_v1_5 as v15
import settle_v1_10 as v110
import clause_eval_v0 as ce
import admit_v0 as A
from contract_v0 import canonical, parse_strict, contract_sha256, EXEC_SCHEMA

SETTLE_SCHEMA = "a2a-settlement-v1.11"
REQUIRED = "required_before_execution"
CLAUSES = ("unadmitted_execution", "executed_after_refusal", "executed_other_than_admitted", "admission_after_execution", "admitted_out_of_grant")


def admission_required(contract):
    r = contract.get("requirements") if isinstance(contract, dict) else None
    return isinstance(r, dict) and r.get("admission") == REQUIRED


@contextlib.contextmanager
def _exec_field(name):
    fields = v13.FIELDS[EXEC_SCHEMA]
    had = name in fields
    fields.add(name)
    try:
        yield
    finally:
        if not had:
            fields.discard(name)


def _admission_index(contract, admissions, relying_keys):
    """admission_sha256 -> (record, anchor height or None), for the admissions that verify under a key the caller supplied."""
    out, unverified = {}, set()
    keys = relying_keys if isinstance(relying_keys, dict) else {}
    for rec in admissions if isinstance(admissions, list) else []:
        if not isinstance(rec, dict) or rec.get("schema") != A.SCHEMA:
            continue
        body = {k: v for k, v in rec.items() if k != "anchor"}
        sha = A.admission_sha256(body)
        dom = (rec.get("relying_party") or {}).get("domain") if isinstance(rec.get("relying_party"), dict) else None
        if A.verify_admission(body, keys.get(dom), contract)["verdict"] != "accepted":
            unverified.add(sha)
            continue
        anchor = rec.get("anchor") if isinstance(rec.get("anchor"), dict) else {}
        h = anchor.get("height") if isinstance(anchor.get("height"), int) and not isinstance(anchor.get("height"), bool) else None
        out[sha] = (body, h)
    return out, unverified


def admission_deviations(contract, events, admissions, relying_keys, skip=()):
    """The v1.11 rule over the execution records, in (anchor height, record sha256) order. Returns (deviations, read)."""
    csha = contract_sha256(contract)
    index, unverified = _admission_index(contract, admissions, relying_keys)
    recs, seen = [], set()
    for ev in events if isinstance(events, list) else []:
        if not (isinstance(ev, dict) and ev.get("schema") == EXEC_SCHEMA):
            continue
        if (ev.get("contract_ref") or {}).get("contract_sha256") != csha or v12.authenticate(ev, contract):
            continue
        s, h = v1.rec_sha(ev), v1.height_of(ev)
        if s in seen or s in skip or h is None:
            continue
        seen.add(s)
        recs.append((h, s, ev))
    recs.sort(key=lambda t: (t[0], t[1]))
    devs, used, read = [], set(), []
    for h, s, ev in recs:
        refs = [r for r in (ev.get("admission_ref") or []) if isinstance(r, dict)] if isinstance(ev.get("admission_ref"), list) else []
        taken = set()
        for a in [x for x in (ev.get("performed_actions") or []) if isinstance(x, str)]:
            d = lambda clause, why, sha=None: {"clause": clause, "observed": a, "height": h, "record_sha256": s, "admission_sha256": sha, "why": why}
            i = next((i for i, r in enumerate(refs) if i not in taken and r.get("action") == a), None)
            if i is None:
                devs.append(d("unadmitted_execution", "the execution record names no admission for this action")); continue
            taken.add(i)
            ref = refs[i]
            sha = ref.get("admission_sha256")
            if sha in unverified:
                devs.append(d("unadmitted_execution", "the admission named does not verify under the relying party's key in hand", sha)); continue
            if sha not in index:
                devs.append(d("unadmitted_execution", "the admission named was not presented to this settler", sha)); continue
            if sha in used:
                devs.append(d("unadmitted_execution", "the admission named was already used by an earlier action", sha)); continue
            used.add(sha)
            adm, ah = index[sha]
            dom = (adm.get("relying_party") or {}).get("domain")
            read.append({"action": a, "admission_sha256": sha, "decision": adm.get("decision"), "relying_party": dom, "record_sha256": s})
            ev_now = ce.evaluate_action(contract, a, approvals=ev.get("approvals") or [], height=(adm.get("chain_view") or {}).get("height"))
            if adm.get("decision") == "refuse":
                devs.append(d("executed_after_refusal", "the admission's decision was refuse (%s)" % ", ".join(adm.get("reasons") or []), sha))
            elif adm.get("decision") == "escalate" and "conditional" in ev_now["clauses"]:
                devs.append(d("executed_after_refusal", "the admission's decision was escalate and the execution carries no countable approval", sha))
            ex = ref.get("executed") if isinstance(ref.get("executed"), dict) else {}
            digest = A.action_digest(csha, {"action": {"action": ex.get("action"), "target": ex.get("target"), "amount": ex.get("amount")},
                                            "nonce": ex.get("nonce"), "expiry_height": ex.get("expiry_height")})
            if ex.get("action") != a or digest != (adm.get("action_ref") or {}).get("action_binding_digest"):
                devs.append(d("executed_other_than_admitted", "the digest of what was executed is not the admission's action_binding_digest", sha))
            if ah is None or ah > h:
                devs.append(d("admission_after_execution", "the admission has no anchor" if ah is None else "the admission is anchored at %d, the execution at %d" % (ah, h), sha))
            if adm.get("decision") == "admit" and [c for c in ev_now["clauses"] if c in ("prohibited", "unauthorized", "conditional")]:
                devs.append(d("admitted_out_of_grant", "relying party %s signed admit; the shared clause evaluator reads this action as %s under these terms"
                              % (dom, ", ".join(c for c in ev_now["clauses"] if c in ("prohibited", "unauthorized", "conditional"))), sha))
    return devs, read


def settle_v1_11(contract, events, view, admissions=None, relying_keys=None, mode="strict", nenrin_records=None, spine=None,
                 pool=None, contract_anchor_height=None, history=None):
    kw = dict(mode=mode, nenrin_records=nenrin_records, spine=spine, pool=pool,
              contract_anchor_height=contract_anchor_height, history=history)
    if not admission_required(contract):
        return v110.settle_v1_10(contract, events, view, **kw)
    with _exec_field("admission_ref"):
        s = v110.settle_v1_10(contract, events, view, **kw)
    out = dict(s)
    out["schema"], out["settled_under"] = SETTLE_SCHEMA, v110.SETTLE_SCHEMA
    skip = {x.get("sha256") for k in ("rejected", "orphaned", "predates_contract") for x in (s.get(k) or []) if isinstance(x, dict)}
    devs, read = ([], []) if s.get("verdict") == "underspecified" else admission_deviations(contract, events, admissions, relying_keys, skip=skip)
    out["deviations"] = list(s.get("deviations") or []) + devs
    if s.get("verdict") != "underspecified":
        out["verdict"] = "deviation" if out["deviations"] else "within_grant"
        out["bond_outcome"] = v15._bond_outcome(contract, out["verdict"], out.get("status"))
    out["admission_gate"] = {"required": True, "requirement": REQUIRED, "rule": SETTLE_SCHEMA, "evaluator_sha256": ce.evaluator_sha256(),
                             "admissions_read": sorted(read, key=canonical),
                             "counts": {c: sum(1 for d in devs if d["clause"] == c) for c in CLAUSES}}
    out["establishes"] = list(s.get("establishes") or []) + [
        "that every executed action was read against the relying party's signed admission named in the execution record, under the rule in a2a-settlement-v1.11",
        "that each admission's decision was recomputed here with the clause evaluator the admission names (admission_gate.evaluator_sha256)"]
    out["does_not_establish"] = list(s.get("does_not_establish") or []) + [
        "that a relying party which published no admission refused nothing; only that no admission was presented",
        "that HS allowed or blocked anything; the relying party ran admit() at its own door",
        "who is at fault when an admission and the grant disagree; the signatures show who signed what"]
    return out


# --------------------------------------------------------------------------- self test
def _selftest():
    import subprocess
    import admit_fixtures as F
    w = F.World()
    n = 0
    P, AP, AN = w.contracts["plain"], w.contracts["admission_plain"], w.contracts["admission_pinned"]
    KEYS = {F.RP["domain"]: w.pr}
    assert admission_required(AP) and admission_required(AN) and not admission_required(P)

    def flow(c, action, exec_action=None, approvals=(), exec_approvals=None, adm_height=98, exec_block=1, sign_key=None, executed_edit=None,
             with_ref=True, present=True, decision_override=None, nonce="5a" * 16, extra_blocks=None):
        req = A.build_action_request(c, action, nonce, 500, w.kb, approvals=list(approvals))
        adm = A.admit(c, req, [{"adapter": "musubi-native", "sha256": contract_sha256(c), "verified": True}], F.VIEW, [], relying_party=F.RP, admission_id="adm")
        if decision_override:
            adm["decision"], adm["reasons"] = decision_override
        A.sign_admission(adm, sign_key or w.kr)
        executed = {"action": action, "target": None, "amount": None, "nonce": nonce, "expiry_height": 500}
        if executed_edit:
            executed.update(executed_edit)
        ref = [{"action": exec_action or action, "admission_sha256": A.admission_sha256(adm), "executed": executed}]
        ex = w.ex(c, [exec_action or action], list(approvals if exec_approvals is None else exec_approvals), **({"admission_ref": ref} if with_ref else {}))
        blocks = [[] for _ in range(exec_block)] + [[ex]] + (extra_blocks or [])
        recs, view = w.run(blocks, "v11")
        admissions = [dict(adm, anchor={"height": adm_height})] if (present and adm_height is not None) else ([adm] if present else [])
        return settle_v1_11(c, recs, view, admissions=admissions, relying_keys=KEYS), adm

    clauses = lambda s: sorted(d["clause"] for d in s["deviations"])

    # [1] no requirement: v1.11 returns v1.10's bytes
    res10, res11 = F.settle_all(w), F.settle_all(w, settle=settle_v1_11)
    assert res10 == res11 and len(res10) == 18
    rr = os.path.join(HERE, "run0002")
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    C2 = rd(os.path.join(HERE, "second_contract_AB.json"))
    args = (C2, [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    assert canonical(settle_v1_11(*args, nenrin_records=nr)) == canonical(v110.settle_v1_10(*args, nenrin_records=nr))
    assert contract_sha256(C2).startswith("14474983")
    n += 1; print("[1] contracts with no requirements.admission: v1.11 is v1.10 byte for byte (18 corpus scenarios, run0002 under the second contract 14474983)")

    # [2] admitted before, executed as admitted: within_grant
    s, adm = flow(AP, "read")
    assert s["schema"] == SETTLE_SCHEMA and s["verdict"] == "within_grant" and s["status"] == "final" and s["deviations"] == [], s["deviations"]
    assert s["admission_gate"]["admissions_read"][0]["decision"] == "admit" and s["admission_gate"]["evaluator_sha256"] == ce.evaluator_sha256()
    s, _ = flow(AP, "refund", approvals=[w.principal_ok(AP, "refund", "11" * 16)])
    assert s["verdict"] == "within_grant", s["deviations"]
    s, _ = flow(AN, "emit_witness", approvals=[w.approver_ok(AN)])
    assert s["verdict"] == "within_grant", s["deviations"]
    n += 1; print("[2] admit before, the same action executed after: within_grant, final (plain, conditional with the principal's approval, gated with the pinned approver's)")

    # [3] rule 1: unadmitted
    assert clauses(flow(AP, "read", with_ref=False)[0]) == ["unadmitted_execution"]
    assert clauses(flow(AP, "read", present=False)[0]) == ["unadmitted_execution"]
    assert clauses(flow(AP, "read", sign_key=w.kf)[0]) == ["unadmitted_execution"]
    assert clauses(flow(AP, "read", sign_key=w.kb)[0]) == ["unadmitted_execution"]
    n += 1; print("[3] no admission_ref, an admission not presented, one signed by a stranger, one signed by the applicant itself: unadmitted_execution")

    # [4] rule 2: executed after refusal, or after escalate with no approval
    s, adm = flow(AP, "delete")
    assert adm["decision"] == "refuse" and "executed_after_refusal" in clauses(s) and "prohibited" in clauses(s), clauses(s)
    s, adm = flow(AP, "refund")
    assert adm["decision"] == "escalate" and clauses(s) == ["conditional", "executed_after_refusal"], clauses(s)
    s, adm = flow(AP, "refund", exec_approvals=[w.principal_ok(AP, "refund", "12" * 16)])
    assert adm["decision"] == "escalate" and s["verdict"] == "within_grant", clauses(s)
    n += 1; print("[4] executed after refuse: executed_after_refusal (and the grant's own clause); after escalate with no approval: the same; after escalate with the approval carried: within_grant")

    # [5] rule 3: something else was executed
    s, _ = flow(AP, "read", executed_edit={"target": "/other"})
    assert clauses(s) == ["executed_other_than_admitted"], clauses(s)
    s, _ = flow(AP, "read", exec_action="emit_witness")
    assert "unadmitted_execution" in clauses(s) or "executed_other_than_admitted" in clauses(s), clauses(s)
    n += 1; print("[5] the executed target differs from the admitted one: executed_other_than_admitted; another action run on a read admission: not covered by it")

    # [6] rule 4: the admission came after
    assert clauses(flow(AP, "read", adm_height=150)[0]) == ["admission_after_execution"]
    assert clauses(flow(AP, "read", adm_height=None)[0]) == ["admission_after_execution"]
    assert flow(AP, "read", adm_height=99)[0]["verdict"] == "within_grant"
    n += 1; print("[6] admission anchored above the execution, or not anchored: admission_after_execution; anchored in the same block or below: fine")

    # [7] rule 5: the relying party admitted something outside the grant
    s, adm = flow(AP, "delete", decision_override=("admit", ["within_grant"]))
    assert "admitted_out_of_grant" in clauses(s) and "executed_after_refusal" not in clauses(s), clauses(s)
    why = next(d["why"] for d in s["deviations"] if d["clause"] == "admitted_out_of_grant")
    assert "shop.example" in why and "prohibited" in why
    s, _ = flow(AP, "transfer", decision_override=("admit", ["within_grant"]))
    assert "admitted_out_of_grant" in clauses(s) and "unauthorized" in clauses(s)
    s, _ = flow(AP, "refund", decision_override=("admit", ["within_grant"]))
    assert "admitted_out_of_grant" in clauses(s)
    n += 1; print("[7] a relying party signs admit for a prohibited, an unauthorized or an unapproved conditional action: admitted_out_of_grant, naming the domain that signed")

    # [8] one admission, two executions
    req = A.build_action_request(AP, "read", "7b" * 16, 500, w.kb)
    adm = A.sign_admission(A.admit(AP, req, [{"adapter": "musubi-native", "sha256": contract_sha256(AP), "verified": True}], F.VIEW, [], relying_party=F.RP, admission_id="once"), w.kr)
    ref = [{"action": "read", "admission_sha256": A.admission_sha256(adm), "executed": {"action": "read", "target": None, "amount": None, "nonce": "7b" * 16, "expiry_height": 500}}]
    recs, view = w.run([[w.ex(AP, ["read"], ref="1", admission_ref=ref)], [w.ex(AP, ["read"], ref="2", admission_ref=ref)]], "v11b")
    s = settle_v1_11(AP, recs, view, admissions=[dict(adm, anchor={"height": 98})], relying_keys=KEYS)
    assert clauses(s) == ["unadmitted_execution"] and "already used" in s["deviations"][0]["why"], s["deviations"]
    n += 1; print("[8] the same admission named by two executions: the second is unadmitted_execution")

    # [9] the field list is restored, also after an exception
    assert "admission_ref" not in v13.FIELDS[EXEC_SCHEMA]
    real = v110.settle_v1_10
    def boom(*a, **k):
        raise RuntimeError("boom")
    v110.settle_v1_10 = boom
    try:
        settle_v1_11(AP, [], view)
    except RuntimeError:
        pass
    finally:
        v110.settle_v1_10 = real
    assert "admission_ref" not in v13.FIELDS[EXEC_SCHEMA]
    recs, view = w.run([[w.ex(P, ["read"], admission_ref=[])]], "v11c")
    s = settle_v1_11(P, recs, view)
    assert any(d["clause"] == "nonconforming_record" for d in s["deviations"]), s["deviations"]
    n += 1; print("[9] settle v1.3's field list is restored after a call and after an exception; a contract without the requirement still refuses admission_ref as an unknown field")

    # [10] determinism
    s1, _ = flow(AP, "delete", decision_override=("admit", ["within_grant"]))
    s2, _ = flow(AP, "delete", decision_override=("admit", ["within_grant"]))
    assert canonical(s1) == canonical(s2)
    n += 1; print("[10] the same inputs give the same settlement bytes")

    # [11] mutants: each must change a verdict the tests above expect
    g, killed = globals(), 0
    saved = g["admission_deviations"]
    try:
        g["admission_deviations"] = lambda *a, **k: ([], [])                                  # M1: the rule is skipped
        killed += flow(AP, "read", with_ref=False)[0]["verdict"] == "within_grant"
    finally:
        g["admission_deviations"] = saved
    real_eval = ce.evaluate_action
    try:
        ce.evaluate_action = lambda *a, **k: {"class": "authorized", "clauses": [], "approval": None, "why": None}   # M2: the recompute always agrees
        killed += "admitted_out_of_grant" not in clauses(flow(AP, "delete", decision_override=("admit", ["within_grant"]))[0])
    finally:
        ce.evaluate_action = real_eval
    real_ver = A.verify_admission
    try:
        A.verify_admission = lambda *a, **k: {"verdict": "accepted", "refusals": []}          # M3: any signature is accepted
        killed += clauses(flow(AP, "read", sign_key=w.kf)[0]) == []
    finally:
        A.verify_admission = real_ver
    assert killed == 3, killed
    n += 1; print("[11] 3 mutants (rule skipped, recompute always agrees, any admission signature accepted): all 3 change a verdict the checks above expect")

    r = subprocess.run([sys.executable, os.path.join(HERE, "settle_v1_10.py"), "--selftest"], capture_output=True, text=True)
    assert r.returncode == 0 and "SELF-TEST PASSED" in r.stdout, (r.stdout[-300:], r.stderr[-300:])
    n += 1; print("[12] settle_v1_10 self test (and every layer it runs) still passes")

    print("\nSELF-TEST PASSED: MUSUBI settle v1.11, %d checks (no requirement: v1.10 byte for byte; admitted and executed: within_grant; "
          "unadmitted; after refusal; other than admitted; admission after execution; admitted out of grant; single use; field list restored; "
          "determinism; 3 mutants; v1.10 unchanged)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI settle v1.11 (executions read against the relying party's admission when the contract requires one)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--settle", metavar="CONTRACT.json")
    ap.add_argument("--event", action="append", default=[])
    ap.add_argument("--view", action="append", default=[])
    ap.add_argument("--nenrin", action="append", default=[])
    ap.add_argument("--admission", action="append", default=[], help="a signed a2a-admission-v0 record with its anchor")
    ap.add_argument("--relying-key", action="append", default=[], metavar="DOMAIN=BASE64", help="the relying party's Ed25519 key, fetched from its key_url")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not a.settle or not a.view:
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    contract = rd(a.settle)
    views = [rd(p) for p in a.view]
    cmp = v110.v19.v18.v17.v14.compare_views_v1_4(views, contract)
    if cmp["chosen"] is None:
        print(json.dumps({"fork_choice": cmp}, indent=2)); return 2
    keys = dict(x.split("=", 1) for x in a.relying_key)
    s = settle_v1_11(contract, [rd(p) for p in a.event], views[cmp["chosen"]], admissions=[rd(p) for p in a.admission], relying_keys=keys,
                     nenrin_records=[rd(p) for p in a.nenrin] or None)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(s))
    print(json.dumps(s, ensure_ascii=False, indent=2))
    return 0 if s["status"] == "final" else 2


if __name__ == "__main__":
    sys.exit(main())
