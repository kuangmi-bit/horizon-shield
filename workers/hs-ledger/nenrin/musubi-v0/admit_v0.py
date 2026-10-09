#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MUSUBI admission v0 (a2a-admission-v0): a deterministic function a relying party runs at its own door, before an
action, and the signed record of what it returned.

    admit(contract, action_request, presentation, chain_view, revocations) -> admission

What this is. A relying party (a shop, an API, the principal itself) receives a request from an agent that says it
acts under a signed MUSUBI contract. admit() reads the contract, the request, what the agent presented, the block
height the relying party has verified, and the revocations it can see at that height, and returns one of three
decisions: admit, escalate, refuse, with reason codes from a closed list. The relying party signs the result with a
key served on its own domain. Settlement (settle v1.11) later recomputes the same clauses over what was executed.

What this is not. Nothing here issues an identity, and nobody but the relying party stops anything. HORIZON SHIELD
publishes the function, anchors records sent to it, and settles after the fact. It renders no decision of its own.

One rule, one implementation. The clauses are clause_eval_v0.py, the module settle v1.10 and v1.11 import. This file
does not restate them; every record names that module by sha256 (rules.evaluator_sha256).

Inputs.
  contract        an a2a-contract-v0 both parties signed. contract_v0.verify_contract must accept it.
  action_request  what the agent asks to do: {contract_ref, action:{action,target,amount}, nonce, expiry_height,
                  approvals?, action_binding, requester, signatures}. action_binding is the VATE shaped digest used in
                  task-execution-bind-v0 (canonical_request_digest over musubi-canonical-v0), here over
                  {contract_sha256, action, target, amount, nonce, expiry_height}. The requester signs
                  b"a2a-action-request-v0\\n" + canonical(body) with the key the contract names for its role.
  presentation    a list of adapter outputs (adapters/): {adapter, sha256, verified, ...}. verified is true, false or
                  null. null means "not verified", and admit never reads null as true.
  chain_view      {"height", "header_sha256"}: the tip the relying party verified. Time comes from here, not from
                  the requester.
  revocations     principal-signed a2a-revocation-v0 records the relying party holds. Only those anchored at or
                  below chain_view.height are read.

Reasons (closed list, v0): within_grant, conditional_needs_approval, prohibited_action, outside_grant,
amount_over_limit, delegation_exceeds_parent, contract_expired, nonce_reused, grant_revoked, key_revoked,
presentation_unverifiable, signer_not_on_own_domain, action_digest_mismatch.

Stated limits. A revocation anchored after chain_view.height is not visible to this admission; the record says so.
admit compares a revocation's stated anchor height with the view and checks the principal's signature; checking the
anchor proof against headers is the relying party's step (header_view_fetch.py, settle v1.1's verify_view), and
settlement does it again. No score is produced, only a decision, reasons and references.
"""
import argparse, base64, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clause_eval_v0 as ce
import contract_v0 as v0
from contract_v0 import canonical, parse_strict, ed25519_verify, contract_sha256, b64_raw

SCHEMA = "a2a-admission-v0"
CONTEXT = b"a2a-admission-v0\n"
REQUEST_CONTEXT = b"a2a-action-request-v0\n"
REVOKE_SCHEMA = "a2a-revocation-v0"
REVOKE_CONTEXT = b"a2a-revocation-v0\n"
PREIMAGE_PROFILE = "a2a-admission-v0/action"
DECISIONS = ("admit", "escalate", "refuse")
REASONS = ("within_grant", "conditional_needs_approval", "prohibited_action", "outside_grant", "amount_over_limit",
           "delegation_exceeds_parent", "contract_expired", "nonce_reused", "grant_revoked", "key_revoked",
           "presentation_unverifiable", "signer_not_on_own_domain", "action_digest_mismatch")
REFUSING = ("action_digest_mismatch", "presentation_unverifiable", "signer_not_on_own_domain", "key_revoked", "grant_revoked",
            "contract_expired", "nonce_reused", "delegation_exceeds_parent", "amount_over_limit", "prohibited_action", "outside_grant")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
DOES_NOT_ESTABLISH = [
    "that HS allowed or blocked anything; the relying party ran the function at its own door",
    "that the agent is who it claims to be beyond what the presented signatures and keys on its own domain show",
    "that a revocation published after the chain view was known at admission time",
    "that the action was lawful, safe or wise; only that it was inside or outside the signed grant",
    "that this record is a legal authorization or determines liability"]


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


# --------------------------------------------------------------------------- the action request
def action_preimage(contract_sha, req):
    a = req.get("action") if isinstance(req.get("action"), dict) else {}
    return {"contract_sha256": contract_sha, "action": a.get("action"), "target": a.get("target"), "amount": a.get("amount"),
            "nonce": req.get("nonce"), "expiry_height": req.get("expiry_height")}


def action_digest(contract_sha, req):
    return sha256_hex(canonical(action_preimage(contract_sha, req)).encode("utf-8"))


def action_binding(contract_sha, req):
    return {"type": "canonical_request_digest", "canonicalization": v0.CANONICAL_RULE, "preimage_profile": PREIMAGE_PROFILE,
            "digest": {"alg": "sha-256", "value": action_digest(contract_sha, req)}}


def request_signing_bytes(req):
    return REQUEST_CONTEXT + canonical({k: v for k, v in req.items() if k != "signatures"}).encode("utf-8")


def build_action_request(contract, action, nonce, expiry_height, key, role="contractor", target=None, amount=None, approvals=None):
    csha = contract_sha256(contract)
    req = {"contract_ref": {"contract_id": contract["contract_id"], "contract_sha256": csha},
           "action": {"action": action, "target": target, "amount": amount}, "nonce": nonce, "expiry_height": expiry_height,
           "approvals": list(approvals or []), "requester": {"role": role}}
    req["action_binding"] = action_binding(csha, req)
    req["signatures"] = [{"role": role, "sig_b64": base64.b64encode(key.sign(request_signing_bytes(req))).decode("ascii")}]
    return req


def _party_key(contract, role):
    for p in contract.get("parties") or []:
        if isinstance(p, dict) and p.get("role") == role:
            return p.get("public_key_ed25519_b64")
    return None


def request_shape_ok(req):
    a = req.get("action") if isinstance(req, dict) else None
    return (isinstance(req, dict) and isinstance(a, dict) and isinstance(a.get("action"), str)
            and (a.get("target") is None or isinstance(a.get("target"), str))
            and (a.get("amount") is None or (_is_int(a.get("amount")) and a["amount"] >= 0))
            and isinstance(req.get("nonce"), str) and bool(HEX32.match(req["nonce"]))
            and _is_int(req.get("expiry_height")) and req["expiry_height"] >= 0
            and isinstance(req.get("requester"), dict) and req["requester"].get("role") in ("principal", "contractor")
            and isinstance(req.get("contract_ref"), dict))


def request_signed(contract, req):
    key = _party_key(contract, req["requester"]["role"])
    if not key:
        return False
    msg = request_signing_bytes(req)
    return any(isinstance(s, dict) and s.get("role") == req["requester"]["role"] and ed25519_verify(key, s.get("sig_b64"), msg) is True
               for s in (req.get("signatures") or []))


# --------------------------------------------------------------------------- revocations
def revocation_signing_bytes(rec):
    return REVOKE_CONTEXT + canonical({k: v for k, v in rec.items() if k not in ("signatures", "anchor")}).encode("utf-8")


def build_revocation(contract, key, revoked_key_b64=None):
    """A principal's revocation. Without revoked_key it ends the grant: this is the a2a-revocation-v0 record settle v1
    already reads, bound to the terms by contract_sha256. With revoked_key it names one key that must no longer be
    admitted under this contract; that form is read by admit only and is not a settle event."""
    rec = {"schema": REVOKE_SCHEMA, "contract_ref": {"contract_id": contract["contract_id"],
           "payload_digest": (contract.get("task") or {}).get("payload_digest"), "contract_sha256": contract_sha256(contract)},
           "revoked_by": "principal"}
    if revoked_key_b64 is not None:
        rec["revoked_key"] = {"public_key_ed25519_b64": revoked_key_b64}
    rec["signatures"] = [{"role": "principal", "sig_b64": base64.b64encode(key.sign(revocation_signing_bytes(rec))).decode("ascii")}]
    return rec


def read_revocations(contract, revocations, height):
    """(grant_revoked, revoked_keys, seen) from the records that are the principal's, name these terms and are anchored at or below height."""
    csha, pk = contract_sha256(contract), _party_key(contract, "principal")
    grant_revoked, keys, seen = False, set(), []
    for rec in revocations if isinstance(revocations, list) else []:
        if not (isinstance(rec, dict) and rec.get("schema") == REVOKE_SCHEMA and rec.get("revoked_by") == "principal"):
            continue
        ref = rec.get("contract_ref") if isinstance(rec.get("contract_ref"), dict) else {}
        if ref.get("contract_sha256") != csha:
            continue
        anchor = rec.get("anchor") if isinstance(rec.get("anchor"), dict) else {}
        if not (_is_int(anchor.get("height")) and _is_int(height) and anchor["height"] <= height):
            continue
        msg = revocation_signing_bytes(rec)
        if not (pk and any(isinstance(s, dict) and s.get("role") == "principal" and ed25519_verify(pk, s.get("sig_b64"), msg) is True
                           for s in (rec.get("signatures") or []))):
            continue
        rk = rec.get("revoked_key")
        if rk is None:
            grant_revoked = True
        elif isinstance(rk, dict) and isinstance(rk.get("public_key_ed25519_b64"), str):
            keys.add(rk["public_key_ed25519_b64"])
        else:
            continue
        seen.append(sha256_hex(canonical({k: v for k, v in rec.items() if k != "anchor"}).encode("utf-8")))
    return grant_revoked, keys, sorted(seen)


# --------------------------------------------------------------------------- admit
def _presentation_ref(presentation):
    out = []
    for p in presentation if isinstance(presentation, list) else []:
        if not isinstance(p, dict):
            out.append({"adapter": None, "sha256": None, "verified": None})
            continue
        e = {"adapter": p.get("adapter") if isinstance(p.get("adapter"), str) else None,
             "sha256": p.get("sha256") if isinstance(p.get("sha256"), str) else None,
             "verified": p.get("verified") if isinstance(p.get("verified"), bool) else None}
        if isinstance(p.get("self_asserted"), bool):
            e["self_asserted"] = p["self_asserted"]
        out.append(e)
    return out


def decide(contract, action_request, presentation, chain_view, revocations, seen_nonces=(), policy=None):
    """The decision without the envelope: {"decision", "reasons", "clause", "action_digest", "revocations_seen"}.

    policy: {"on_unverifiable": "refuse" (default) | "escalate"}. Nothing in it can turn a refusal into an admit.
    """
    policy = policy if isinstance(policy, dict) else {}
    reasons, clause = [], None
    csha = contract_sha256(contract) if isinstance(contract, dict) else None
    height = chain_view.get("height") if isinstance(chain_view, dict) else None
    contract_ok = isinstance(contract, dict) and v0.verify_contract(contract).get("verdict") == "accepted"
    shape_ok = request_shape_ok(action_request)
    digest = action_digest(csha, action_request) if (shape_ok and csha) else None
    unverifiable = not contract_ok or not shape_ok or not _is_int(height)
    if shape_ok and contract_ok:
        stated = ((action_request.get("action_binding") or {}).get("digest") or {}).get("value") if isinstance(action_request.get("action_binding"), dict) else None
        if stated != digest:
            reasons.append("action_digest_mismatch")
        if not request_signed(contract, action_request):
            unverifiable = True
    pref = _presentation_ref(presentation)
    unverified_items = [p for p in pref if p["verified"] is not True]
    if unverifiable or (unverified_items and policy.get("on_unverifiable") != "escalate"):
        reasons.append("presentation_unverifiable")
    seen_rev = []
    if contract_ok and shape_ok and _is_int(height):
        if action_request["contract_ref"].get("contract_sha256") != csha:
            reasons.append("outside_grant")
        grant_revoked, revoked_keys, seen_rev = read_revocations(contract, revocations, height)
        if _party_key(contract, action_request["requester"]["role"]) in revoked_keys:
            reasons.append("key_revoked")
        if grant_revoked:
            reasons.append("grant_revoked")
        exp = (contract.get("grant") or {}).get("expiry_height")
        if (exp is not None and height > exp) or height > action_request["expiry_height"]:
            reasons.append("contract_expired")
        if action_request["nonce"] in set(seen_nonces or ()):
            reasons.append("nonce_reused")
        act, amount = action_request["action"]["action"], action_request["action"]["amount"]
        for p in presentation if isinstance(presentation, list) else []:
            if not isinstance(p, dict):
                continue
            if p.get("within_parent") is False:
                reasons.append("delegation_exceeds_parent")
            lim = (p.get("limits") or {}).get(act) if isinstance(p.get("limits"), dict) else None
            if _is_int(lim) and _is_int(amount) and amount > lim:
                reasons.append("amount_over_limit")
            g = p.get("grant")
            if isinstance(g, dict) and ce.classify_action({"grant": g}, act) in ("prohibited", "unauthorized"):
                reasons.append("outside_grant")
        ev = ce.evaluate_action(contract, act, approvals=action_request.get("approvals") or [], height=height,
                                authority_ended=False, used_nonces=set(seen_nonces or ()))
        clause = ce.clause_path(contract, act)
        if "prohibited" in ev["clauses"]:
            reasons.append("prohibited_action")
        if "unauthorized" in ev["clauses"]:
            reasons.append("outside_grant")
        if "conditional" in ev["clauses"]:
            reasons.append("conditional_needs_approval")
    reasons = [r for r in REASONS if r in set(reasons)]
    if unverified_items and policy.get("on_unverifiable") == "escalate" and "presentation_unverifiable" not in reasons:
        reasons.append("presentation_unverifiable")
        reasons = [r for r in REASONS if r in set(reasons)]
        refusing = [r for r in reasons if r in REFUSING and r != "presentation_unverifiable"]
        decision = "refuse" if refusing else "escalate"
    elif any(r in REFUSING for r in reasons):
        decision = "refuse"
    elif "conditional_needs_approval" in reasons:
        decision = "escalate"
    else:
        decision, reasons = "admit", ["within_grant"]
    return {"decision": decision, "reasons": reasons, "clause": clause, "action_digest": digest, "revocations_seen": seen_rev}


def admit(contract, action_request, presentation, chain_view, revocations, relying_party=None, admission_id=None,
          seen_nonces=(), policy=None):
    """The unsigned a2a-admission-v0 record. relying_party is {"domain", "key_url"}; sign_admission adds the signature."""
    d = decide(contract, action_request, presentation, chain_view, revocations, seen_nonces=seen_nonces, policy=policy)
    csha = contract_sha256(contract) if isinstance(contract, dict) else None
    cv = chain_view if isinstance(chain_view, dict) else {}
    rp = relying_party if isinstance(relying_party, dict) else {}
    return {
        "schema": SCHEMA,
        "admission_id": admission_id,
        "relying_party": {"domain": rp.get("domain"), "key_url": rp.get("key_url")},
        "contract_ref": {"contract_id": contract.get("contract_id") if isinstance(contract, dict) else None, "contract_sha256": csha},
        "action_ref": {"action_binding_digest": d["action_digest"],
                       "nonce": action_request.get("nonce") if isinstance(action_request, dict) else None},
        "presentation_ref": _presentation_ref(presentation),
        "chain_view": {"height": cv.get("height"), "header_sha256": cv.get("header_sha256")},
        "revocations_seen": d["revocations_seen"],
        "decision": d["decision"],
        "reasons": d["reasons"],
        "clause": d["clause"],
        "rules": {"admit": SCHEMA, "evaluator_sha256": ce.evaluator_sha256()},
        "establishes": [
            "that the relying party named here ran admit() over this contract, this action digest and this chain view, and signed the result",
            "that the decision and reasons are what the shared clause evaluator (rules.evaluator_sha256) returns for those inputs; anyone holding them can recompute it"],
        "does_not_establish": list(DOES_NOT_ESTABLISH),
        "signatures": []}


# --------------------------------------------------------------------------- the record: signing and verifying
def admission_signing_bytes(record):
    return CONTEXT + canonical({k: v for k, v in record.items() if k != "signatures"}).encode("utf-8")


def admission_sha256(record):
    """sha256 of the bytes the relying party signs. Stable when the signature lands; this is what an execution record names."""
    return sha256_hex(admission_signing_bytes(record))


def sign_admission(record, key, domain=None):
    sig = base64.b64encode(key.sign(admission_signing_bytes(record))).decode("ascii")
    record.setdefault("signatures", []).append({"domain": domain or (record.get("relying_party") or {}).get("domain"), "alg": "ed25519", "sig": sig})
    return record


def _host(url):
    m = re.match(r"^https://([A-Za-z0-9.-]+)(?::\d+)?/", url) if isinstance(url, str) else None
    return m.group(1).lower() if m else None


RECORD_KEYS = frozenset(("schema", "admission_id", "relying_party", "contract_ref", "action_ref", "presentation_ref", "chain_view",
                         "revocations_seen", "decision", "reasons", "clause", "rules", "establishes", "does_not_establish", "signatures"))


def verify_admission(record, relying_key_b64, contract=None):
    """{"verdict": "accepted" | "refused", "refusals": [codes]}. relying_key_b64 is the key the caller fetched from
    record.relying_party.key_url. With the contract, an admission signed by a party's own request key is refused: an
    applicant cannot admit itself (the same fail closed rule as a self witness)."""
    ref = []
    if not isinstance(record, dict) or record.get("schema") != SCHEMA:
        return {"verdict": "refused", "refusals": ["malformed"]}
    if set(record) - RECORD_KEYS or not RECORD_KEYS <= set(record):
        ref.append("malformed")
    rp = record.get("relying_party") if isinstance(record.get("relying_party"), dict) else {}
    dom = rp.get("domain") if isinstance(rp.get("domain"), str) else None
    if record.get("decision") not in DECISIONS or not isinstance(record.get("reasons"), list) or not record.get("reasons") \
            or any(r not in REASONS for r in record.get("reasons") or []):
        ref.append("malformed")
    if list(record.get("does_not_establish") or []) != DOES_NOT_ESTABLISH:
        ref.append("does_not_establish_altered")
    if not dom or _host(rp.get("key_url")) != dom.lower():
        ref.append("signer_not_on_own_domain")
    sigs = [s for s in (record.get("signatures") or []) if isinstance(s, dict)]
    if b64_raw(relying_key_b64, 32) is None or not any(
            s.get("domain") == dom and s.get("alg") == "ed25519" and ed25519_verify(relying_key_b64, s.get("sig"), admission_signing_bytes(record)) is True
            for s in sigs):
        ref.append("bad_signature")
    if isinstance(contract, dict):
        if (record.get("contract_ref") or {}).get("contract_sha256") != contract_sha256(contract):
            ref.append("other_contract")
        if relying_key_b64 == _party_key(contract, "contractor"):
            ref.append("self_admission")
    ref = sorted(set(ref))
    return {"verdict": "refused" if ref else "accepted", "refusals": ref}


# --------------------------------------------------------------------------- self test
def _selftest():
    import admit_fixtures as F
    w = F.World()
    n = 0
    P, N = w.contracts["plain"], w.contracts["pinned"]
    RP = {"domain": "shop.example", "key_url": "https://shop.example/keys/agreement.json"}
    VIEW = {"height": 99, "header_sha256": "ab" * 32}
    NATIVE = [{"adapter": "musubi-native", "sha256": contract_sha256(P), "verified": True}]

    def req(c, action, nonce="5a" * 16, key=None, role="contractor", **kw):
        return build_action_request(c, action, nonce, kw.pop("expiry_height", 500), key or w.kb, role=role, **kw)

    def run(c, r, pres=None, view=VIEW, revs=(), **kw):
        return admit(c, r, NATIVE if pres is None else pres, view, list(revs), relying_party=RP, admission_id="adm-1", **kw)

    # [1] the three decisions
    a = run(P, req(P, "read"))
    assert (a["decision"], a["reasons"], a["clause"]) == ("admit", ["within_grant"], "grant.authorized_actions[0]"), a
    a = run(P, req(P, "refund"))
    assert (a["decision"], a["reasons"]) == ("escalate", ["conditional_needs_approval"]) and a["clause"] == "grant.conditional[1]", a
    a = run(P, req(P, "delete"))
    assert (a["decision"], a["reasons"]) == ("refuse", ["prohibited_action"]), a
    a = run(P, req(P, "transfer"))
    assert (a["decision"], a["reasons"], a["clause"]) == ("refuse", ["outside_grant"], None), a
    n += 1; print("[1] read: admit within_grant; refund without approval: escalate; delete: refuse prohibited_action; transfer: refuse outside_grant")

    # [2] a conditional action with a countable approval is admitted; the wrong approver is not
    a = run(P, req(P, "refund", approvals=[w.principal_ok(P, "refund", "11" * 16)]))
    assert (a["decision"], a["reasons"]) == ("admit", ["within_grant"]), a
    a = run(N, req(N, "emit_witness", approvals=[w.approver_ok(N)]))
    assert a["decision"] == "admit", a
    a = run(N, req(N, "emit_witness", approvals=[w.principal_ok(N, "emit_witness", "33" * 16)]))
    assert (a["decision"], a["reasons"]) == ("escalate", ["conditional_needs_approval"]), a
    a = run(N, req(N, "emit_witness", approvals=[w.approver_ok(N, key_=w.kf)]))
    assert a["decision"] == "escalate", a
    n += 1; print("[2] conditional with the principal's approval, or the pinned approver's: admit; a gated action approved by the principal or by an unpinned key: escalate")

    # [3] the request itself
    r = req(P, "read"); r["action"]["target"] = "/other"
    a = run(P, r)
    assert a["decision"] == "refuse" and "action_digest_mismatch" in a["reasons"], a
    a = run(P, req(P, "read", key=w.kf))
    assert (a["decision"], a["reasons"]) == ("refuse", ["presentation_unverifiable"]), a
    a = run(N, req(P, "read"))
    assert a["decision"] == "refuse" and "outside_grant" in a["reasons"], a
    a = run(P, req(P, "read"), seen_nonces=["5a" * 16])
    assert (a["decision"], a["reasons"]) == ("refuse", ["nonce_reused"]), a
    a = run(P, req(P, "read", expiry_height=98))
    assert (a["decision"], a["reasons"]) == ("refuse", ["contract_expired"]), a
    a = run(w.contracts["expiring"], req(w.contracts["expiring"], "read"), view={"height": 101, "header_sha256": "ab" * 32})
    assert (a["decision"], a["reasons"]) == ("refuse", ["contract_expired"]), a
    n += 1; print("[3] request edited after signing: action_digest_mismatch; signed by another key: presentation_unverifiable; for other terms: outside_grant; nonce seen: nonce_reused; past its height or the grant's: contract_expired")

    # [4] presentation: null is never read as true
    for v, want in ((None, "refuse"), (False, "refuse"), (True, "admit")):
        a = run(P, req(P, "read"), pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": v, "self_asserted": True}])
        assert a["decision"] == want and (want == "admit" or a["reasons"] == ["presentation_unverifiable"]), (v, a)
        assert a["presentation_ref"] == [{"adapter": "aps-v2", "sha256": "c" * 64, "verified": v, "self_asserted": True}]
    a = run(P, req(P, "read"), pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": None}], policy={"on_unverifiable": "escalate"})
    assert (a["decision"], a["reasons"]) == ("escalate", ["presentation_unverifiable"]), a
    a = run(P, req(P, "delete"), pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": None}], policy={"on_unverifiable": "escalate"})
    assert a["decision"] == "refuse" and "prohibited_action" in a["reasons"], a
    a = run(P, req(P, "read"), pres=[{"adapter": "x", "sha256": "c" * 64, "verified": "true"}])
    assert a["decision"] == "refuse" and a["presentation_ref"][0]["verified"] is None, a
    n += 1; print("[4] verified null or false: refuse presentation_unverifiable; the relying party's policy may escalate instead, never admit; a string \"true\" is not true")

    # [5] delegation and limits from an adapter
    a = run(P, req(P, "read"), pres=NATIVE + [{"adapter": "musubi-native", "sha256": "d" * 64, "verified": True, "within_parent": False}])
    assert (a["decision"], a["reasons"]) == ("refuse", ["delegation_exceeds_parent"]), a
    a = run(P, req(P, "read", amount=150000), pres=NATIVE + [{"adapter": "aps-v2", "sha256": "d" * 64, "verified": True, "limits": {"read": 100000}}])
    assert (a["decision"], a["reasons"]) == ("refuse", ["amount_over_limit"]), a
    a = run(P, req(P, "read", amount=100000), pres=NATIVE + [{"adapter": "aps-v2", "sha256": "d" * 64, "verified": True, "limits": {"read": 100000}}])
    assert a["decision"] == "admit", a
    child = {"authorized_actions": ["emit_witness"], "prohibited_actions": ["delete"], "conditional": []}
    a = run(P, req(P, "read"), pres=NATIVE + [{"adapter": "musubi-native", "sha256": "d" * 64, "verified": True, "within_parent": True, "grant": child}])
    assert (a["decision"], a["reasons"]) == ("refuse", ["outside_grant"]), a
    n += 1; print("[5] a delegation wider than its parent: delegation_exceeds_parent; amount over the presented limit: amount_over_limit; an action the delegated grant does not carry: outside_grant")

    # [6] revocations: only the principal's, only for these terms, only anchored at or below the view
    def anchored(rec, h):
        return dict(rec, anchor={"height": h, "block_hash": "00" * 32, "proof": []})
    rv = build_revocation(P, w.ka)
    assert run(P, req(P, "read"), revs=[anchored(rv, 99)])["reasons"] == ["grant_revoked"]
    assert run(P, req(P, "read"), revs=[anchored(rv, 100)])["decision"] == "admit"
    assert run(P, req(P, "read"), revs=[rv])["decision"] == "admit"
    assert run(P, req(P, "read"), revs=[anchored(build_revocation(P, w.kb), 98)])["decision"] == "admit"
    assert run(P, req(P, "read"), revs=[anchored(build_revocation(N, w.ka), 98)])["decision"] == "admit"
    kr = build_revocation(P, w.ka, revoked_key_b64=w.pb)
    a = run(P, req(P, "read"), revs=[anchored(kr, 98)])
    assert (a["decision"], a["reasons"]) == ("refuse", ["key_revoked"]) and len(a["revocations_seen"]) == 1, a
    assert run(P, req(P, "read"), revs=[anchored(build_revocation(P, w.ka, revoked_key_b64=w.pf), 98)])["decision"] == "admit"
    n += 1; print("[6] grant revoked at or below the view: grant_revoked; anchored above it, unanchored, signed by the contractor, or for other terms: not read; the requester's key revoked: key_revoked")

    # [7] the record: signed by the relying party, on its own domain, not by the applicant
    a = sign_admission(run(P, req(P, "read")), w.kr)
    assert verify_admission(a, w.pr, P) == {"verdict": "accepted", "refusals": []}
    assert a["rules"] == {"admit": SCHEMA, "evaluator_sha256": ce.evaluator_sha256()} and a["does_not_establish"] == DOES_NOT_ESTABLISH
    assert admission_sha256(a) == sha256_hex(CONTEXT + canonical({k: v for k, v in a.items() if k != "signatures"}).encode())
    assert verify_admission(dict(a, decision="refuse"), w.pr, P)["refusals"] == ["bad_signature"]
    assert verify_admission(a, w.pf, P)["refusals"] == ["bad_signature"]
    self_made = sign_admission(run(P, req(P, "delete")), w.kb); self_made["decision"] = "admit"
    assert "self_admission" in verify_admission(sign_admission(run(P, req(P, "read")), w.kb), w.pb, P)["refusals"]
    off = admit(P, req(P, "read"), NATIVE, VIEW, [], relying_party={"domain": "shop.example", "key_url": "https://keys.elsewhere.example/k.json"}, admission_id="x")
    assert verify_admission(sign_admission(off, w.kr), w.pr, P)["refusals"] == ["signer_not_on_own_domain"]
    b = sign_admission(run(P, req(P, "read")), w.kr); b["does_not_establish"] = b["does_not_establish"][:4]
    assert "does_not_establish_altered" in verify_admission(b, w.pr, P)["refusals"]
    assert verify_admission(a, w.pr, N)["refusals"] == ["other_contract"]
    n += 1; print("[7] record accepted with the relying party's key; edited decision, another key: bad_signature; signed with the applicant's key: self_admission; key served off the domain: signer_not_on_own_domain; limits removed: refused")

    # [8] determinism, and no score anywhere
    r1 = req(P, "read")
    assert canonical(run(P, r1)) == canonical(run(P, json.loads(json.dumps(r1))))
    assert not any(k in a for k in ("score", "rating", "trust", "risk"))
    n += 1; print("[8] the same inputs give the same record bytes; the record carries no score")

    # [9] malformed inputs refuse, they do not raise
    for bad in (None, {}, {"action": "read"}, dict(req(P, "read"), nonce="xyz"), dict(req(P, "read"), expiry_height=-1)):
        a = run(P, bad)
        assert a["decision"] == "refuse" and "presentation_unverifiable" in a["reasons"], (bad, a)
    assert admit({}, req(P, "read"), NATIVE, VIEW, [], relying_party=RP)["decision"] == "refuse"
    assert run(P, req(P, "read"), view={})["decision"] == "refuse"
    n += 1; print("[9] a missing or malformed request, an unsigned or empty contract, a view with no height: refuse, no exception")

    print("\nSELF-TEST PASSED: MUSUBI admission v0, %d checks (three decisions; approvals; the request; presentation null is not true; "
          "delegation and limits; revocations by height; the signed record; determinism; malformed inputs)" % n)


def main():
    ap = argparse.ArgumentParser(description="MUSUBI admission v0 (a2a-admission-v0): admit() at the relying party's own door")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--admit", metavar="CONTRACT.json")
    ap.add_argument("--request", metavar="REQUEST.json")
    ap.add_argument("--presentation", metavar="PRESENTATION.json")
    ap.add_argument("--height", type=int)
    ap.add_argument("--header-sha256")
    ap.add_argument("--revocation", action="append", default=[])
    ap.add_argument("--domain")
    ap.add_argument("--key-url")
    ap.add_argument("--id")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.selftest:
        _selftest(); return 0
    if not (a.admit and a.request and a.height is not None):
        ap.print_help(); return 1
    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rec = admit(rd(a.admit), rd(a.request), rd(a.presentation) if a.presentation else [], {"height": a.height, "header_sha256": a.header_sha256},
                [rd(p) for p in a.revocation], relying_party={"domain": a.domain, "key_url": a.key_url}, admission_id=a.id)
    if a.out:
        open(a.out, "w", encoding="utf-8", newline="").write(canonical(rec))
    print(json.dumps(rec, ensure_ascii=False, indent=2))
    return {"admit": 0, "escalate": 3, "refuse": 4}[rec["decision"]]


if __name__ == "__main__":
    sys.exit(main())
