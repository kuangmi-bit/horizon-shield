#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deterministic MUSUBI scenarios for the admission tests (a2a-admission-v0) and for settle regressions.

Every key is derived from a fixed label, every nonce and height is fixed, and Ed25519 signatures are deterministic,
so two runs of this file on any machine produce the same contracts, the same anchored records and the same header
views, byte for byte. The settle self-tests draw fresh keys on each run and so cannot serve as a byte regression;
this corpus can. It holds no real party's key: the labels are the whole secret, and they are printed below.

  python3 admit_fixtures.py            print one line per scenario with the sha256 of the settle v1.10 output
  python3 admit_fixtures.py --dump D   also write D/<name>.settle.json (canonical bytes) for a before/after compare
"""
import base64, hashlib, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_v0 as v0
import settle_v1 as v1
import settle_v1_1 as v11
import settle_v1_2 as v12
import settle_v1_6 as v16
from contract_v0 import canonical, contract_sha256, EXEC_SCHEMA

PDG = "a" * 64
DNE = ["that HS enforced any of this at runtime",
       "that the contractor obeyed the grant, only that its recorded acts match or deviate from it",
       "that HS judges liability or fault; the verdict is a function anyone recomputes",
       "that a prohibited action was impossible, only that performing one is a provable deviation",
       "that this is a legal contract or determines legal responsibility"]
COND = [{"action": "emit_witness", "requires": "approver"}, {"action": "refund", "requires": "principal_approval"}]


def key(label):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(("admit-fixture:" + label).encode()).digest())
    pub = base64.b64encode(k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    return k, pub


class World:
    """Keys, a common header chain and the contract variants. Built once; everything in it is fixed."""

    def __init__(self):
        self.ka, self.pa = key("principal")
        self.kb, self.pb = key("contractor")
        self.kw, self.pw = key("witness")
        self.kz, self.pz = key("approver")
        self.kf, self.pf = key("stranger")
        self.kr, self.pr = key("relying-party")
        self.base = v11._Chain(60, "00" * 32, "common")
        for _ in range(38):
            self.base.block()
        self.lb = {"kind": "bitcoin_block", "height": 97, "hash": self.base.hashes[97]}
        pin = [{"name": "approver.example", "public_key_ed25519_b64": self.pz, "actions": ["emit_witness"]}]
        self.contracts = {
            "plain": self.mk(None, "a" * 32),
            "pinned": self.mk(pin, "b" * 32),
            "expiring": self.mk(None, "c" * 32, expiry_height=100),
            "admission_plain": self.mk(None, "d" * 32, requirements={"evidence": "nenrin_required", "recovery": "tsugi_required", "admission": "required_before_execution"}),
            "admission_pinned": self.mk(pin, "e" * 32, requirements={"evidence": "nenrin_required", "recovery": "tsugi_required", "admission": "required_before_execution"}),
        }

    def grant(self, approvers=None, **over):
        g = {"authorized_actions": ["read", "emit_witness", "refund"], "prohibited_actions": ["delete"], "conditional": COND,
             "delegation": {"allowed": []}, "revocation": {"effective_at": "anchor"},
             "finality": {"depth": 3, "max_target_bits": "207fffff"},
             "witnesses": [{"name": "nenrin-walker", "public_key_ed25519_b64": self.pw}]}
        if approvers is not None:
            g["approval_policy"] = {"allow_unscoped": False, "approvers": approvers}
        g.update(over)
        return g

    def mk(self, approvers, nonce, requirements=None, **grant_over):
        c = v0.build_contract(
            {"domain": "a.example", "key_url": "https://a.example/k.json", "public_key_ed25519_b64": self.pa},
            {"domain": "b.example", "key_url": "https://b.example/k.json", "public_key_ed25519_b64": self.pb},
            {"purpose": "endpoint_conduct_walk", "payload_digest": PDG, "a2a_task_id": "t1"}, self.grant(approvers, **grant_over),
            ["that both parties signed these grant bytes"], DNE, requirements=requirements,
            bond={"amount": 1000, "currency": "JPY"}, lower_bound=self.lb,
            contract_id="0123456789abcdef0123456789abcdef", nonce=nonce, agreed_at="2026-10-05T00:00:00Z")
        v0.sign_contract(c, self.ka, self.pa, "a.example")
        v0.sign_contract(c, self.kb, self.pb, "b.example")
        return c

    def ref(self, c):
        return {"contract_id": c["contract_id"], "payload_digest": PDG, "contract_sha256": contract_sha256(c)}

    def ex(self, c, actions, approvals=(), ref="1", **extra):
        r = {"schema": EXEC_SCHEMA, "contract_ref": self.ref(c), "performed_actions": list(actions),
             "approvals": list(approvals), "delegated_to": [], "nenrin_ref": (ref * 64)[:64]}
        r.update(extra)
        return v12.sign_record(r, self.kb, "contractor")

    def revoke(self, c):
        r = {"schema": v1.REVOKE_SCHEMA, "contract_ref": self.ref(c), "revoked_by": "principal"}
        return v12.sign_record(r, self.ka, "principal")

    def principal_ok(self, c, action, nonce, vu=500, single_use=True):
        return v16.sign_approval_v2(self.ka, c, action, vu, nonce, single_use=single_use)

    def approver_ok(self, c, action="emit_witness", nonce="22" * 16, key_=None, name="approver.example", vu=500, single_use=True):
        import settle_v1_10 as v110
        return v110.sign_approver_approval(key_ or self.kz, c, action, vu, nonce, name, self.pz, single_use=single_use)

    def run(self, blocks, tag, tail=5):
        ch = self.base.fork(98, tag)
        recs = []
        for blk in blocks:
            recs += ch.block(blk) if blk else ch.block()
        for _ in range(tail):
            ch.block()
        return recs, ch.view()


def scenarios(w):
    """name -> (contract, blocks). blocks is a list of blocks, each a list of unanchored records. The first block lands at height 98."""
    P, N, X = w.contracts["plain"], w.contracts["pinned"], w.contracts["expiring"]
    S = {}
    S["s01_read"] = (P, [[w.ex(P, ["read"])]])
    S["s02_delete_prohibited"] = (P, [[w.ex(P, ["delete"])]])
    S["s03_transfer_unauthorized"] = (P, [[w.ex(P, ["transfer"])]])
    S["s04_refund_principal_approved"] = (P, [[w.ex(P, ["refund"], [w.principal_ok(P, "refund", "11" * 16)])]])
    S["s05_refund_no_approval"] = (P, [[w.ex(P, ["refund"])]])
    S["s06_emit_approver_approved"] = (N, [[w.ex(N, ["emit_witness"], [w.approver_ok(N)])]])
    S["s07_emit_no_approval"] = (N, [[w.ex(N, ["emit_witness"])]])
    S["s08_emit_principal_signed_gated"] = (N, [[w.ex(N, ["emit_witness"], [w.principal_ok(N, "emit_witness", "33" * 16)])]])
    S["s09_emit_stranger_key"] = (N, [[w.ex(N, ["emit_witness"], [w.approver_ok(N, key_=w.kf)])]])
    S["s10_read_after_expiry"] = (X, [[], [], [], [w.ex(X, ["read"])]])
    S["s11_read_after_revocation"] = (P, [[w.revoke(P)], [w.ex(P, ["read"])]])
    S["s12_read_and_delete"] = (P, [[w.ex(P, ["read", "delete"])]])
    once = w.approver_ok(N, nonce="67" * 16)
    S["s13_single_use_reused"] = (N, [[w.ex(N, ["read"], [once], ref="8")], [w.ex(N, ["emit_witness"], ref="9")], [w.ex(N, ["emit_witness"], ref="a")]])
    S["s14_refund_pinned_contract_principal"] = (N, [[w.ex(N, ["refund"], [w.principal_ok(N, "refund", "77" * 16)])]])
    S["s15_approver_for_ungated_refund"] = (N, [[w.ex(N, ["refund"], [w.approver_ok(N, action="refund", nonce="78" * 16)])]])
    S["s16_emit_in_plain_contract_principal"] = (P, [[w.ex(P, ["emit_witness"], [w.principal_ok(P, "emit_witness", "44" * 16)])]])
    S["s17_approval_expired"] = (N, [[w.ex(N, ["read"], [w.approver_ok(N, nonce="6a" * 16, vu=0)], ref="f")], [w.ex(N, ["emit_witness"], ref="0")]])
    S["s18_nothing_recorded"] = (P, [[]])
    return S


RP = {"domain": "shop.example", "key_url": "https://shop.example/keys/agreement.json"}
VIEW = {"height": 99, "header_sha256": "ab" * 32}


def raw_private_hex(label):
    """The fixture key's 32 secret bytes, for the JavaScript twin to sign with. A label, not a secret."""
    return hashlib.sha256(("admit-fixture:" + label).encode()).hexdigest()


def admission_cases(w):
    """Inputs for admit(), one per reason code and per attack in the threat model, each with the decision it must get.

    Every case is {"name", "contract", "action_request", "presentation", "chain_view", "revocations", "seen_nonces",
    "policy", "expect": (decision, reasons)}. Used by admit_redteam.py, admit_bytematch.py and admit_consistency.py.
    """
    import admit_v0 as A
    P, N, X = w.contracts["plain"], w.contracts["pinned"], w.contracts["expiring"]
    native = lambda c: [{"adapter": "musubi-native", "sha256": contract_sha256(c), "verified": True}]
    cases = []

    def add(name, c, action, expect, nonce=None, key_=None, pres=None, view=None, revs=(), seen=(), policy=None, edit=None, **kw):
        nonce = nonce or hashlib.sha256(name.encode()).hexdigest()[:32]
        req = A.build_action_request(c, action, nonce, kw.pop("expiry_height", 500), key_ or w.kb, **kw)
        if edit:
            edit(req)
        cases.append({"name": name, "contract": c, "action_request": req, "presentation": native(c) if pres is None else pres,
                      "chain_view": dict(view or VIEW), "revocations": list(revs), "seen_nonces": list(seen), "policy": policy,
                      "expect": (expect[0], list(expect[1]))})

    def anchored(rec, h):
        return dict(rec, anchor={"height": h, "block_hash": "00" * 32, "proof": []})

    add("a01_read_within_grant", P, "read", ("admit", ["within_grant"]))
    add("a02_refund_needs_approval", P, "refund", ("escalate", ["conditional_needs_approval"]))
    add("a03_refund_principal_approved", P, "refund", ("admit", ["within_grant"]), approvals=[w.principal_ok(P, "refund", "11" * 16)])
    add("a04_delete_prohibited", P, "delete", ("refuse", ["prohibited_action"]))
    add("a05_transfer_outside_grant", P, "transfer", ("refuse", ["outside_grant"]))
    add("a06_emit_approver_approved", N, "emit_witness", ("admit", ["within_grant"]), approvals=[w.approver_ok(N)])
    add("a07_emit_no_approval", N, "emit_witness", ("escalate", ["conditional_needs_approval"]))
    add("a08_emit_principal_signed_gated", N, "emit_witness", ("escalate", ["conditional_needs_approval"]), approvals=[w.principal_ok(N, "emit_witness", "33" * 16)])
    add("a09_emit_stranger_key", N, "emit_witness", ("escalate", ["conditional_needs_approval"]), approvals=[w.approver_ok(N, key_=w.kf)])
    add("a10_amount_over_limit", P, "read", ("refuse", ["amount_over_limit"]), amount=150000,
        pres=native(P) + [{"adapter": "aps-v2", "sha256": "d" * 64, "verified": True, "limits": {"read": 100000}}])
    add("a11_delegation_exceeds_parent", P, "read", ("refuse", ["delegation_exceeds_parent"]),
        pres=native(P) + [{"adapter": "musubi-native", "sha256": "d" * 64, "verified": True, "within_parent": False}])
    add("a12_contract_expired_grant", X, "read", ("refuse", ["contract_expired"]), view={"height": 101, "header_sha256": "ab" * 32})
    add("a13_request_expired", P, "read", ("refuse", ["contract_expired"]), expiry_height=98)
    add("a14_nonce_reused", P, "read", ("refuse", ["nonce_reused"]), nonce="5a" * 16, seen=["5a" * 16])
    add("a15_grant_revoked", P, "read", ("refuse", ["grant_revoked"]), revs=[anchored(A.build_revocation(P, w.ka), 99)])
    add("a16_revocation_after_view_not_seen", P, "read", ("admit", ["within_grant"]), revs=[anchored(A.build_revocation(P, w.ka), 100)])
    add("a17_key_revoked", P, "read", ("refuse", ["key_revoked"]), revs=[anchored(A.build_revocation(P, w.ka, revoked_key_b64=w.pb), 98)])
    add("a18_presentation_null", P, "read", ("refuse", ["presentation_unverifiable"]),
        pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": None, "self_asserted": True}])
    add("a19_presentation_null_policy_escalate", P, "read", ("escalate", ["presentation_unverifiable"]),
        pres=[{"adapter": "aps-v2", "sha256": "c" * 64, "verified": None, "self_asserted": True}], policy={"on_unverifiable": "escalate"})
    add("a20_requester_signature_by_stranger", P, "read", ("refuse", ["presentation_unverifiable"]), key_=w.kf)

    def retarget(req):
        req["action"]["target"] = "/other"
    add("a21_action_digest_mismatch", P, "read", ("refuse", ["presentation_unverifiable", "action_digest_mismatch"]), edit=retarget, target="/invoices")

    def swap_action(req):
        req["action"]["action"] = "delete"
    add("a22_admitted_read_edited_to_delete", P, "read", ("refuse", ["prohibited_action", "presentation_unverifiable", "action_digest_mismatch"]), edit=swap_action)
    add("a23_revocation_by_contractor_ignored", P, "read", ("admit", ["within_grant"]), revs=[anchored(A.build_revocation(P, w.kb), 98)])
    add("a24_forged_revocation_other_terms", P, "read", ("admit", ["within_grant"]), revs=[anchored(A.build_revocation(N, w.ka), 98)])
    add("a25_refund_in_pinned_contract_principal", N, "refund", ("admit", ["within_grant"]), approvals=[w.principal_ok(N, "refund", "77" * 16)])
    add("a26_approval_expired", N, "emit_witness", ("escalate", ["conditional_needs_approval"]), approvals=[w.approver_ok(N, nonce="6a" * 16, vu=0)])
    add("a27_delegated_grant_lacks_action", P, "read", ("refuse", ["outside_grant"]),
        pres=native(P) + [{"adapter": "musubi-native", "sha256": "e" * 64, "verified": True, "within_parent": True,
                           "grant": {"authorized_actions": ["emit_witness"], "prohibited_actions": ["delete"], "conditional": []}}])
    add("a28_request_for_other_contract", N, "read", ("refuse", ["outside_grant", "action_digest_mismatch"]),
        edit=lambda req: None, nonce="9c" * 16)
    cases[-1]["contract"] = P            # the request above was built and signed for the pinned contract, shown at the plain one
    cases[-1]["presentation"] = native(P)
    return cases


def settle_all(w=None, settle=None):
    import settle_v1_10 as v110
    w = w or World()
    settle = settle or v110.settle_v1_10
    out = {}
    for name, (c, blocks) in sorted(scenarios(w).items()):
        recs, view = w.run(blocks, name[:3])
        out[name] = canonical(settle(c, recs, view))
    return out


def main():
    res = settle_all()
    dump = sys.argv[sys.argv.index("--dump") + 1] if "--dump" in sys.argv else None
    if dump:
        os.makedirs(dump, exist_ok=True)
    import json
    for name, text in res.items():
        s = json.loads(text)
        print("%s  %-40s %-14s %s" % (hashlib.sha256(text.encode()).hexdigest()[:16], name, s["verdict"], sorted({d["clause"] for d in s["deviations"]})))
        if dump:
            open(os.path.join(dump, name + ".settle.json"), "w", encoding="utf-8", newline="").write(text)
    print("%d scenarios  all %s" % (len(res), hashlib.sha256("".join(res[k] for k in sorted(res)).encode()).hexdigest()[:16]))


if __name__ == "__main__":
    main()
