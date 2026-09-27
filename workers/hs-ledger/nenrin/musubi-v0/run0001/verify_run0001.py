#!/usr/bin/env python3
"""verify_run0001.py: recompute, offline, everything a third party can recompute about FURUI run 0001
(the sieve that decided HORIZON SHIELD would sign the second MUSUBI contract offered by api.babyblueviper.com).

What it checks, with no network and no trust in the operator:
  1. policy_sha256 = sha256("a2a-sieve-policy-v0\n" + canonical(policy without signatures))
  2. sieve_sha256  = sha256("a2a-sieve-v0\n"        + canonical(sieve  without signatures))
     canonical = musubi-canonical-v0 (../canonical_vectors.json): keys sorted, no spaces, UTF-8, integers only.
  3. the sieve cites that policy, and second_contract_A.json cites both (selection_provenance)
  4. the pinned agent card bytes (cards/<sha>.json) hash to parties[0].agent_card_sha256
  5. the seven declared rules of the policy, applied to the classified inputs the sieve records, yield the
     recorded decision, and the decision cites every rule as a ground
  6. with --key <public_key_ed25519_b64> (the value served at gate.horizonshield.dev/keys/agreement.json),
     the Ed25519 signatures on the policy and the sieve verify over the same signing bytes as 1 and 2

What it cannot check, and says so: the classifier that produced the inputs (a2a-sieve-v0, not published) and
the hidden instruction detector whose sha the sieve pins. The sieve record's own does_not_establish says the same.
Run: python3 verify_run0001.py [--key <b64>]
"""
import hashlib, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "agreement-v0"))
from agreement_verify import canonical, ed25519_verify  # musubi-canonical-v0 and RFC 8032 verify, stdlib only

POLICY_SCHEMA, SIEVE_SCHEMA = "a2a-sieve-policy-v0", "a2a-sieve-v0"

def load(p):
    with open(p, "rb") as f: return f.read()

def rec_sha(schema, record):
    body = {k: v for k, v in record.items() if k != "signatures"}
    c = canonical(body); c = c if isinstance(c, bytes) else c.encode("utf-8")
    return hashlib.sha256(schema.encode("ascii") + b"\n" + c).hexdigest(), schema.encode("ascii") + b"\n" + c

def main():
    key = None
    if "--key" in sys.argv: key = sys.argv[sys.argv.index("--key") + 1]
    fails = []
    ok = lambda cond, msg: (print(("PASS  " if cond else "FAIL  ") + msg), None if cond else fails.append(msg))
    policy_b = load(os.path.join(HERE, "policy_signed.json")); policy = json.loads(policy_b)
    sieve_b = load(os.path.join(HERE, "sieve_signed.json")); sieve = json.loads(sieve_b)
    contract = json.loads(load(os.path.join(HERE, "..", "second_contract_A.json")))
    psha, pmsg = rec_sha(POLICY_SCHEMA, policy); ssha, smsg = rec_sha(SIEVE_SCHEMA, sieve)
    print("policy_sha256", psha); print("sieve_sha256 ", ssha)
    ok(policy.get("schema") == POLICY_SCHEMA and sieve.get("schema") == SIEVE_SCHEMA, "schema names as expected")
    ok(sieve["policy_ref"]["policy_sha256"] == psha, "sieve cites this policy (policy_ref.policy_sha256)")
    sp = contract["selection_provenance"]
    ok(sp["policy_sha256"] == psha, "contract selection_provenance.policy_sha256 == recomputed")
    ok(sp["sieve_sha256"] == ssha, "contract selection_provenance.sieve_sha256 == recomputed")
    ok(sp["offer_sha256"] == sieve["subject"]["offer_sha256"], "contract and sieve cite the same offer_sha256")
    pin = contract["parties"][0]["agent_card_sha256"]
    card_path = os.path.join(HERE, "cards", pin + ".json")
    if os.path.exists(card_path):
        ok(hashlib.sha256(load(card_path)).hexdigest() == pin, "pinned card bytes hash to parties[0].agent_card_sha256")
    else:
        ok(False, "pinned card bytes present at cards/" + pin + ".json")
    # rules, applied by hand
    inputs = {(i["as"], i["name"]): i for i in sieve["inputs"]}
    all_pass = True
    for n, rule in enumerate(policy["rules"]):
        ref = rule["ref"]; inp = inputs.get((ref["as"], ref["name"]))
        if inp is None or inp.get("class") != "admitted":
            res = False
        elif rule["op"] == "eq": res = inp["value"] == rule["value"]
        elif rule["op"] == "le": res = inp["value"] <= rule["value"]
        elif rule["op"] == "present": res = inp["value"] is not None
        elif rule["op"] == "signed_by": res = inp.get("code") == "signature_on_own_domain"
        else: res = False
        all_pass = all_pass and res
        print(("PASS  " if res else "FAIL  ") + "rule %d %s %s %s -> %r" % (n, rule["op"], ref["name"], rule.get("value", rule.get("domain", "")), inp and inp.get("value")))
        if not res: fails.append("rule %d" % n)
    expected = "sign" if all_pass else policy.get("default", "decline")
    ok(sieve["decision"]["action"] == expected, "recorded decision %r equals the rule outcome %r" % (sieve["decision"]["action"], expected))
    ok(sorted(sieve["decision"]["grounds"]) == list(range(len(policy["rules"]))), "decision cites every rule as a ground")
    if key:
        for name, rec, msg in (("policy", policy, pmsg), ("sieve", sieve, smsg)):
            sigs = [s for s in rec.get("signatures", []) if s.get("domain") == "horizonshield.dev"]
            ok(bool(sigs) and all(ed25519_verify(key, s["sig"], msg) for s in sigs), name + " Ed25519 signature verifies with the given key over the signing bytes")
    else:
        print("SKIP  signatures (pass --key <public_key_ed25519_b64> from gate.horizonshield.dev/keys/agreement.json)")
    print("NOT CHECKED  the classifier (a2a-sieve-v0) and the hidden instruction detector are not published; only their pins are")
    print("RESULT", "ALL PASS" if not fails else "FAIL " + ", ".join(fails))
    sys.exit(0 if not fails else 1)

if __name__ == "__main__":
    main()
