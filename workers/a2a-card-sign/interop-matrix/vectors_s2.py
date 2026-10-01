"""Add group s2-absent-required to the a2a-card-sign-v01 corpus: a REQUIRED field absent from the served JSON.

Groups s0 and s1 carry every REQUIRED field, so section 8.4.1 rule 1 could be read on them without deciding what
"MUST always be present" means for a field the signer never served. This group decides nothing either; it makes
the two scopes of rule 1 testable against each other:

  rule-1-served-scope      rule 1 applied to the fields present in the served JSON. A field the served JSON does not
                           carry stays absent. Reproduces the section's own worked example byte for byte.
  rule-1-descriptor-scope  rule 1 applied by walking the AgentCard descriptor. A REQUIRED field absent from the served
                           JSON is emitted at its default ("" for a string, [] for a repeated field, {} for a message).
                           Matches a2a-python with a2aproject/a2a-python#1287 (head cdee28e) byte for byte.
  prune-empty              as in s1 (a2a-sdk 1.2.1, @a2a-js/sdk 1.3.0)
  served-as-is             as in s1 (a2a-go main 534a60fc)

The s0 and s1 files are not touched. Their bytes, hashes and verdicts stay as published, so a sweep run over the
13 vectors of s0 and s1 stays valid. On s0 and s1 the two scopes coincide with rule-1-as-written.

Each case is checked against the SDKs before a vector is written: prune-empty must equal a2a-python 1.2.1 and
@a2a-js/sdk 1.3.0, served-as-is must equal a2a-go, rule-1-descriptor-scope must equal a2a-python at #1287 (run in the
virtualenv named by PY1287, default ../v1287). A case whose readings do not split into exactly two forms is refused
unless it is listed as the worked example.

Run after vectors.py:  PY1287=/path/to/venv/bin/python JCS_GO_BIN=/path/to/jcsgo python3 vectors_s2.py
"""
import hashlib, json, os, subprocess

from a2a.types import AgentCard

import matrix as m
import vectors as v

GROUP = "s2-absent-required"
OUT = v.OUT
S2_READINGS = ["rule-1-served-scope", "rule-1-descriptor-scope", "prune-empty", "served-as-is"]
PY1287 = os.environ.get("PY1287", os.path.join(m.HERE, "..", "v1287", "bin", "python"))


def required_default(f):
    if f.message_type is not None and f.message_type.GetOptions().map_entry:
        return {}
    if f.is_repeated:
        return []
    if f.message_type is not None:
        return {}
    if f.type == f.TYPE_STRING:
        return ""
    return None


def descriptor_scope(obj, desc):
    out = v.rule1(obj, desc)
    # walk again for nested messages that are present, so their absent REQUIRED children are injected too
    for k, val in list(out.items()):
        f = desc.fields_by_camelcase_name.get(k)
        if f is None or f.message_type is None or f.message_type.GetOptions().map_entry:
            continue
        if f.message_type.full_name.startswith("google.protobuf."):
            continue
        if f.is_repeated:
            out[k] = [descriptor_scope(e, f.message_type) for e in val]
        else:
            out[k] = descriptor_scope(val, f.message_type)
    for f in desc.fields:
        if f.json_name in out or not v.is_required(f):
            continue
        d = required_default(f)
        if d is not None:
            out[f.json_name] = d
    return out


def s2_forms(card):
    return {
        "rule-1-served-scope": v.canon(v.rule1(card, AgentCard.DESCRIPTOR)),
        "rule-1-descriptor-scope": v.canon(descriptor_scope(card, AgentCard.DESCRIPTOR)),
        "prune-empty": v.canon(v.prune_empty(card) or {}),
        "served-as-is": v.canon(v.served_as_is(card)),
    }


def py1287_canon(card):
    code = ("import json,sys\nfrom google.protobuf import json_format\nfrom a2a.types import AgentCard\nfrom a2a.utils import signing\n"
            "c=json_format.Parse(sys.stdin.read(), AgentCard(), ignore_unknown_fields=True)\nsys.stdout.write(signing._canonicalize_agent_card(c))\n")
    p = subprocess.run([PY1287, "-c", code], input=json.dumps(card), capture_output=True, text=True, check=True)
    return p.stdout.encode()


def py1287_verify(served, jwksp):
    code = ("import json,sys\nfrom google.protobuf import json_format\nfrom a2a.types import AgentCard\nfrom a2a.utils import signing\nfrom jwt import PyJWK\n"
            "card=json.loads(open(sys.argv[1]).read()); jwks=json.loads(open(sys.argv[2]).read())\n"
            "def kp(kid, jku):\n    return PyJWK([k for k in jwks['keys'] if k['kid']==kid][0])\n"
            "try:\n    signing.create_signature_verifier(kp, ['ES256'])(json_format.Parse(json.dumps(card), AgentCard(), ignore_unknown_fields=True)); print('ok')\n"
            "except Exception as e:\n    print('no')\n")
    sp = os.path.join(m.HERE, "out", "s2-verify.json")
    json.dump(served, open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
    p = subprocess.run([PY1287, "-c", code, sp, jwksp], capture_output=True, text=True, check=True)
    return p.stdout.strip() == "ok"


def drop(path):
    def mut(c):
        cur = c
        for p in path[:-1]:
            cur = cur[p]
        del cur[path[-1]]
    return mut


CASES = [
    ("absent_description", "description absent (REQUIRED string)", m.case(drop(["description"]))),
    ("absent_version", "version absent (REQUIRED string)", m.case(drop(["version"]))),
    ("absent_skills", "skills absent (REQUIRED repeated)", m.case(drop(["skills"]))),
    ("absent_skill_tags", "skills[0].tags absent (REQUIRED on AgentSkill)", m.case(drop(["skills", 0, "tags"]))),
    ("absent_default_input_modes", "defaultInputModes absent (REQUIRED repeated)", m.case(drop(["defaultInputModes"]))),
]
# The section's own worked example, served exactly as printed. It is not a pair: it is here to show which reading
# reproduces the printed canonical form.
WORKED_INPUT = {"name": "Example Agent", "description": "", "capabilities": {"streaming": False, "pushNotifications": False, "extensions": []}, "skills": []}
WORKED_OUTPUT = b'{"capabilities":{"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}'


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    man_path = os.path.join(OUT, "MANIFEST.json")
    man = json.load(open(man_path))
    if any(p["path"].startswith(GROUP + "/") for p in man["vectors"]):
        raise SystemExit("s2 already present; rebuild the corpus with vectors.py first")
    os.makedirs(os.path.join(OUT, GROUP), exist_ok=True)
    added, observed, checks = [], {}, {}
    k = 1

    def emit(vid, body, served):
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", **body, "served_card": served}
        path = GROUP + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(OUT, path), "wb").write(data)
        added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        o = v.observe(served, jwks, jwksp, vid)
        o["a2a-python#1287"] = py1287_verify(served, jwksp)
        observed[vid] = o

    for name, what, card in CASES:
        f = s2_forms(card)
        py = m.py_canon(card, text=True)["text"].encode()
        cp = os.path.join(m.HERE, "out", "s2-" + name + ".json")
        json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
        js = m.run(["node", "js_tool.mjs", "canon", cp])["text"].encode()
        go = m.run([m.GO_BIN, "canon", cp])
        p1287 = py1287_canon(card)
        checks[name] = {"prune-empty=a2a-python-1.2.1": py == f["prune-empty"], "prune-empty=a2a-js-1.3.0": js == f["prune-empty"],
                        "served-as-is=a2a-go": go.get("text", "").encode() == f["served-as-is"],
                        "descriptor-scope=a2a-python#1287": p1287 == f["rule-1-descriptor-scope"]}
        if not all(checks[name].values()):
            raise SystemExit(name + ": a reading does not match its SDK " + json.dumps(checks[name]))
        groups = {}
        for r in S2_READINGS:
            groups.setdefault(f[r], []).append(r)
        if len(groups) != 2:
            raise SystemExit(name + ": expected exactly two distinct forms, got " + str(len(groups)))
        for payload, acc in groups.items():
            sig = v.sign(priv, payload)
            assert v.ref_verify(pub, sig, payload)
            rej = [r for r in S2_READINGS if r not in acc]
            emit("S2-%03d" % k, {"case": name, "what": what, "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
                 "accept_under": acc, "reject_under": rej, "signer": "reference (ES256, RFC 6979)",
                 "rationale": "One REQUIRED field absent from the served JSON (%s). The signature covers the %s form. Which vector applies depends on whether section 8.4.1 rule 1 is scoped to the served JSON or to the descriptor." % (what, " / ".join(acc)),
                 "canonical_utf8_hex": payload.hex()}, {**card, "signatures": [sig]})
            k += 1

    f = s2_forms(WORKED_INPUT)
    reproduces = [r for r in S2_READINGS if f[r] == WORKED_OUTPUT]
    checks["worked_example"] = {r: f[r] == WORKED_OUTPUT for r in S2_READINGS}
    payload = WORKED_OUTPUT
    sig = v.sign(priv, payload)
    assert v.ref_verify(pub, sig, payload)
    emit("S2-WE-%03d" % k, {"case": "worked_example", "what": "section 8.4.1's worked example input, served as printed",
         "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under", "accept_under": reproduces,
         "reject_under": [r for r in S2_READINGS if r not in reproduces], "signer": "reference (ES256, RFC 6979)",
         "rationale": "Signed over the canonical form the section prints. A reading that accepts this vector reproduces the worked example; one that rejects it does not.",
         "canonical_utf8_hex": payload.hex()}, {**WORKED_INPUT, "signatures": [sig]})
    k += 1

    man["groups"] = man["groups"] + [GROUP]
    man["vectors"] = man["vectors"] + added
    man["counts"] = {**man["counts"], "absent_required": len(added), "total": len(man["vectors"])}
    man["s2_readings"] = {
        "rule-1-served-scope": "Rule 1 applied to the fields present in the served JSON. A field the served JSON does not carry stays absent. Then RFC 8785.",
        "rule-1-descriptor-scope": "Rule 1 applied by walking the AgentCard descriptor: a REQUIRED field absent from the served JSON is emitted at its default (\"\" for a string, [] for a repeated field, {} for a message). Then RFC 8785. Matches a2a-python at a2aproject/a2a-python#1287 head cdee28e byte for byte on every s2 card.",
        "note": "On s0 and s1 both scopes give the rule-1-as-written bytes. Only s2 separates them.",
    }
    man["s2_checks"] = checks
    man["observed"]["s2"] = {"note": "Same meaning as observed.results. a2a-python#1287 is the PR head cdee28e installed from source.", "results": observed}
    open(man_path, "w").write(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    for vid, o in observed.items():
        print(vid, o)
    print("worked example reproduced by:", reproduces)


if __name__ == "__main__":
    main()
