"""Add group s3-unknown-fields to the a2a-card-sign-v01 corpus: a field the served JSON carries that the AgentCard
schema does not define.

Raised on a2aproject/A2A#2122: "The rules apply to the fields present in the JSON being signed or verified" does not say
whether a present field outside the schema is covered. Section 5.7 says implementations SHOULD ignore unrecognized
fields, which settles parsing, not signing. This group decides nothing; it makes the three possible answers testable
against each other, with default handling held fixed:

  unknown-retain   the served-scope rule 1 form, with every field outside the schema kept verbatim where it was
                   served (no default handling for it: the schema gives it no default). The signature covers it.
  unknown-exclude  every field outside the schema removed, at every depth, before rule 1. The signature does not
                   cover it, so its value can change without the signature changing.
  unknown-reject   a card carrying any field outside the schema is refused, signed or not.

Every card here is the s0 control card plus fields outside the schema, and carries no field at its default value, so
rule-1-served-scope, rule-1-descriptor-scope, prune-empty and served-as-is cannot disagree on its known fields. Any
difference between the forms is the unknown fields and nothing else. (The frozen card in a2aproject/a2a-python#1286
mixes both questions, as noted on #2122; this group separates them.)

The s0, s1 and s2 files are not touched. score.py scores s3 on its own three readings and keeps the s0 to s2 table as
it was.

What each SDK does is recorded, not assumed: the generator canonicalizes every case with a2a-sdk 1.2.1, @a2a-js/sdk
1.3.0, a2a-go and a2a-python at #1287, and writes which reading each one's bytes equal (or "neither") to MANIFEST.json
under s3_sdk_forms, then runs each SDK's own verifier on every vector under observed.s3.

Run after vectors.py and vectors_s2.py:  PY1287=/path/to/venv/bin/python python3 vectors_s3.py
"""
import hashlib, json, os

from a2a.types import AgentCard

import matrix as m
import vectors as v
import vectors_s2 as s2

GROUP = "s3-unknown-fields"
AXIS = "unknown-fields"
OUT = v.OUT
S3_READINGS = ["unknown-retain", "unknown-exclude", "unknown-reject"]


def rule1x(obj, desc, mode):
    """vectors.rule1, line for line, plus one branch for a field the descriptor does not define."""
    out = {}
    for k, val in obj.items():
        if k == "signatures" and desc is AgentCard.DESCRIPTOR:
            continue
        f = desc.fields_by_camelcase_name.get(k)
        if f is None:
            if mode == "retain":
                out[k] = val
            continue
        msg = f.message_type is not None and not f.message_type.GetOptions().map_entry
        if msg and f.is_repeated:
            x = [rule1x(e, f.message_type, mode) for e in val]
        elif msg:
            x = rule1x(val, f.message_type, mode)
        else:
            x = val
        if v.is_required(f):
            out[k] = x
        elif msg and not f.is_repeated:
            if x == {}:
                raise v.Ambiguous("non-REQUIRED message field left empty: " + k)
            out[k] = x
        elif f.has_presence:
            out[k] = x
        elif not v.is_default(x):
            out[k] = x
    return out


def s3_forms(card):
    return {"unknown-retain": v.canon(rule1x(card, AgentCard.DESCRIPTOR, "retain")),
            "unknown-exclude": v.canon(rule1x(card, AgentCard.DESCRIPTOR, "exclude"))}


def put(path, value):
    def mut(c):
        cur = c
        for p in path[:-1]:
            cur = cur[p]
        cur[path[-1]] = value
    return mut


def many(*muts):
    def mut(c):
        for f in muts:
            f(c)
    return mut


CASES = [
    ("legacy_v03_top_level", "url, protocolVersion and preferredTransport at the top level (AgentCard 0.3 fields, not in 1.0)",
     m.case(many(put(["url"], "https://example.com/a2a/v1"), put(["protocolVersion"], "0.3.0"), put(["preferredTransport"], "JSONRPC")))),
    ("unknown_in_known_message", "provider.legalEntity (provider is defined, legalEntity is not)",
     m.case(put(["provider"], {"organization": "Interop Probe Org", "url": "https://example.com", "legalEntity": "Interop Probe Ltd"}))),
    ("unknown_top_level_object", "compensation, an object the schema does not define",
     m.case(put(["compensation"], {"model": "none", "disclosedAt": "https://example.com/compensation"}))),
    ("unknown_in_repeated_element", "skills[0].costHint, inside an element of a repeated message",
     m.case(put(["skills", 0, "costHint"], "free"))),
    ("unknown_empty_value", "x-reserved = [] (outside the schema, and empty)",
     m.case(put(["x-reserved"], []))),
]
TAMPER_OF = "legacy_v03_top_level"
TAMPER_URL = "https://attacker.example/a2a/v1"


def sdk_forms(name, card, f):
    cp = os.path.join(m.HERE, "out", "s3-" + name + ".json")
    json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
    got = {"a2a-python-1.2.1": m.py_canon(card, text=True)["text"].encode(),
           "a2a-js-1.3.0": (m.run(["node", "js_tool.mjs", "canon", cp]).get("text") or "").encode(),
           "a2a-go": (m.run([m.GO_BIN, "canon", cp]).get("text") or "").encode(),
           "a2a-python#1287": s2.py1287_canon(card)}
    res = {}
    for sdk, b in got.items():
        hit = [r for r, p in f.items() if p == b]
        res[sdk] = {"equals": hit[0] if hit else "neither", "sha256": hashlib.sha256(b).hexdigest(), "len": len(b)}
    return res


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    man_path = os.path.join(OUT, "MANIFEST.json")
    man = json.load(open(man_path))
    if any(p["path"].startswith(GROUP + "/") for p in man["vectors"]):
        raise SystemExit("s3 already present; rebuild the corpus with vectors.py and vectors_s2.py first")
    base = json.loads(json.dumps(m.BASE))
    if v.canon(rule1x(base, AgentCard.DESCRIPTOR, "retain")) != v.canon(v.rule1(base, AgentCard.DESCRIPTOR)):
        raise SystemExit("rule1x differs from vectors.rule1 on a card with no unknown field")
    os.makedirs(os.path.join(OUT, GROUP), exist_ok=True)
    added, observed, forms_seen = [], {}, {}
    k = 1

    def emit(vid, body, served):
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", "axis": AXIS, **body, "served_card": served}
        path = GROUP + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(OUT, path), "wb").write(data)
        added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        o = v.observe(served, jwks, jwksp, vid)
        o["a2a-python#1287"] = s2.py1287_verify(served, jwksp)
        observed[vid] = o

    signed = {}
    for name, what, card in CASES:
        f = s3_forms(card)
        if f["unknown-retain"] == f["unknown-exclude"]:
            raise SystemExit(name + ": retain and exclude give the same bytes; the case tests nothing")
        forms_seen[name] = sdk_forms(name, card, f)
        for reading in ("unknown-retain", "unknown-exclude"):
            payload = f[reading]
            sig = v.sign(priv, payload)
            assert v.ref_verify(pub, sig, payload)
            signed[(name, reading)] = sig
            emit("S3-%03d" % k, {"case": name, "what": what,
                 "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
                 "accept_under": [reading], "reject_under": [r for r in S3_READINGS if r != reading],
                 "signer": "reference (ES256, RFC 6979)",
                 "rationale": "Fields outside the AgentCard schema are served (%s). The signature covers the %s form. "
                              "Known fields carry no default value, so this vector differs from its pair only in whether "
                              "the unknown fields are covered." % (what, reading),
                 "canonical_utf8_hex": payload.hex()}, {**card, "signatures": [sig]})
            k += 1

    card = dict(CASES[[c[0] for c in CASES].index(TAMPER_OF)][2])
    sig = signed[(TAMPER_OF, "unknown-exclude")]
    served = {**card, "url": TAMPER_URL, "signatures": [sig]}
    f = s3_forms(served)
    assert v.ref_verify(pub, sig, f["unknown-exclude"]) and not v.ref_verify(pub, sig, f["unknown-retain"])
    emit("S3-T-%03d" % k, {"case": TAMPER_OF + "_edited", "what": "the unknown-exclude vector of %s, with url replaced after signing" % TAMPER_OF,
         "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
         "accept_under": ["unknown-exclude"], "reject_under": ["unknown-retain", "unknown-reject"],
         "signer": "reference (ES256, RFC 6979), card edited after signing",
         "rationale": "The signature is the one from the unknown-exclude vector of the same case; only the legacy url "
                      "was changed, to %s. A verifier that excludes unknown fields accepts it, because the changed "
                      "value was never covered. This vector shows what exclusion leaves outside the signature." % TAMPER_URL,
         "canonical_utf8_hex": f["unknown-exclude"].hex()}, served)
    k += 1

    man["groups"] = man["groups"] + [GROUP]
    man["vectors"] = man["vectors"] + added
    man["counts"] = {**man["counts"], "unknown_fields": len(added), "total": len(man["vectors"])}
    man["s3_readings"] = {
        "axis": AXIS,
        "unknown-retain": "Rule 1 served-scope on the fields the schema defines; every field outside the schema kept verbatim where it was served. Then RFC 8785.",
        "unknown-exclude": "Every field outside the schema removed at every depth, then rule 1 served-scope. Then RFC 8785.",
        "unknown-reject": "A card carrying any field outside the schema is refused.",
        "note": "Scored separately from s0 to s2: an s3 vector lists only these three readings. On every s3 card the s0 to s2 readings agree on the known fields.",
    }
    man["s3_sdk_forms"] = {"note": "Which reading each SDK's own canonicalization equals on each s3 card, byte for byte. Recorded, not required.", "cases": forms_seen}
    man["observed"]["s3"] = {"note": "Same meaning as observed.results. a2a-python#1287 is the PR head cdee28e installed from source.", "results": observed}
    man["generator_s3"] = "vectors_s3.py"
    open(man_path, "w").write(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    for name, r in forms_seen.items():
        print(name, {s: x["equals"] for s, x in r.items()})
    for vid, o in observed.items():
        print(vid, o)


if __name__ == "__main__":
    main()
