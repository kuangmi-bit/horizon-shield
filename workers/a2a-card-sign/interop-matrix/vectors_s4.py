"""Add group s4-dual-name to the a2a-card-sign-v01 corpus: a card in which one schema field appears under both its JSON
name and its protobuf name (for example defaultInputModes and default_input_modes).

Raised on a2aproject/A2A#2122. A parser that accepts both spellings keeps only one value, so two readers of one signed
card can see different values for the same field, while a verifier that canonicalizes the received JSON keeps both members
and the signature covers both. The specification at 173695755607 does not address it. A sentence was proposed on #2122
(issuecomment-5946904114, aeoess, supported in issuecomment-5947101219):

  "A verifier MUST refuse a card in which the same schema field appears under both its JSON name and its protobuf name."

This group is labelled against that proposal, as s3 is labelled against its readings. It decides nothing:

  dual-name-tolerate  the specification text at 173695755607, which does not require refusal. The verifier canonicalizes
                      the received JSON under served scope, every member kept as served (both spellings), and a signature
                      over that form verifies.
  dual-name-refuse    the proposed sentence. A card carrying both spellings of one field is refused, signed or not.

Accepting a dual-name card is therefore a divergence from the proposal, not a failure against the current text. If the
sentence is adopted, results get pinned to the specification revision that carries it.

Every card is the s0 control card plus the fields named per case, with no field at its default value and no field outside
the schema, so the s0 to s3 readings agree on everything else. The tolerate form equals served-as-is and the served-scope
form of a verifier that keeps every received member; the generator checks that against a2a-go's canonical bytes.

The s0 to s3 files are not touched. score.py scores s4 in its own table.

Run after the earlier groups, in a virtualenv with requirements.txt, with go/interop-go built and node_modules installed:
  JCS_GO_BIN=/path/to/jcsgo python3 vectors_s4.py
"""
import hashlib, json, os

import matrix as m
import vectors as v

GROUP = "s4-dual-name"
AXIS = "dual-name"
OUT = v.OUT
S4_READINGS = ["dual-name-tolerate", "dual-name-refuse"]
PROPOSAL = "https://github.com/a2aproject/A2A/issues/2122#issuecomment-5946904114"
SUPPORT = "https://github.com/a2aproject/A2A/issues/2122#issuecomment-5947101219"
LABELLING = "https://github.com/a2aproject/A2A/issues/2122#issuecomment-5947250034"


def card_with(mut):
    c = json.loads(json.dumps(m.BASE))
    mut(c)
    return c


def top(c):
    c["default_input_modes"] = ["image/png"]


def in_repeated(c):
    c["skills"][0]["inputModes"] = ["text/plain"]
    c["skills"][0]["input_modes"] = ["image/png"]


def in_map(c):
    c["securitySchemes"] = {"b": {"httpAuthSecurityScheme": {"scheme": "bearer", "bearerFormat": "JWT", "bearer_format": "opaque"}}}


def control(c):
    c["securitySchemes"] = {"b": {"httpAuthSecurityScheme": {"scheme": "bearer", "bearerFormat": "JWT"}}}


CASES = [
    ("dual_top_level", "defaultInputModes [\"text/plain\"] and default_input_modes [\"image/png\"] at the top level", card_with(top), True),
    ("dual_in_repeated_element", "skills[0].inputModes [\"text/plain\"] and skills[0].input_modes [\"image/png\"]", card_with(in_repeated), True),
    ("dual_in_map_value", "securitySchemes.b.httpAuthSecurityScheme with bearerFormat \"JWT\" and bearer_format \"opaque\"", card_with(in_map), True),
    ("single_spelling_control", "the same scheme with bearerFormat only (one spelling)", card_with(control), False),
]


def has_dual(obj):
    """True if any object at any depth has two keys that are the camelCase and snake_case spellings of one name."""
    if isinstance(obj, dict):
        keys = set(obj)
        for k in keys:
            if "_" in k:
                p = k.split("_")
                if p[0] + "".join(x[:1].upper() + x[1:] for x in p[1:]) in keys:
                    return True
        return any(has_dual(x) for x in obj.values())
    if isinstance(obj, list):
        return any(has_dual(x) for x in obj)
    return False


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    man_path = os.path.join(OUT, "MANIFEST.json")
    man = json.load(open(man_path))
    if any(p["path"].startswith(GROUP + "/") for p in man["vectors"]):
        raise SystemExit("s4 already present")
    os.makedirs(os.path.join(OUT, GROUP), exist_ok=True)
    os.makedirs(os.path.join(m.HERE, "out"), exist_ok=True)
    added, observed, forms_seen = [], {}, {}
    for k, (name, what, card, dual) in enumerate(CASES, 1):
        assert has_dual(card) == dual, name
        payload = v.canon(v.served_as_is(card))
        cp = os.path.join(m.HERE, "out", "s4-" + name + ".json")
        json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
        g = m.run([m.GO_BIN, "canon", cp])
        if g.get("text", "").encode() != payload:
            raise SystemExit(name + ": tolerate form does not equal a2a-go's canonical bytes")
        py = m.py_canon(card, text=True)["text"].encode()
        js = (m.run(["node", "js_tool.mjs", "canon", cp]).get("text") or "").encode()
        forms_seen[name] = {sdk: {"equals": "dual-name-tolerate" if b == payload else "neither", "sha256": hashlib.sha256(b).hexdigest(), "len": len(b)}
                            for sdk, b in (("a2a-python-1.2.1", py), ("a2a-js-1.3.0", js), ("a2a-go", payload))}
        sig = v.sign(priv, payload)
        assert v.ref_verify(pub, sig, payload)
        vid = "S4-%03d" % k
        body = {"case": name, "what": what, "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under" if dual else "MUST-ACCEPT",
                "accept_under": ["dual-name-tolerate"] if dual else S4_READINGS, "reject_under": ["dual-name-refuse"] if dual else [],
                "signer": "reference (ES256, RFC 6979)",
                "rationale": ("One field appears under both its JSON name and its protobuf name (%s). The signature covers the received JSON "
                              "with both members kept. The specification at 173695755607 does not require refusal; the proposed sentence "
                              "(%s) does. Accepting this vector is a divergence from the proposal, not a failure against the current text." % (what, PROPOSAL))
                if dual else ("Control for S4-003: the same scheme with one spelling. Every reading accepts; a verifier that refuses it "
                              "refuses more than the proposal asks."),
                "canonical_utf8_hex": payload.hex()}
        served = {**card, "signatures": [sig]}
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", "axis": AXIS, **body, "served_card": served}
        path = GROUP + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(OUT, path), "wb").write(data)
        added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        observed[vid] = v.observe(served, jwks, jwksp, vid)
    # S4-005: the s0 control signed over its own bytes, then default_input_modes added after signing. Under both readings
    # the received JSON now carries a member the signature never covered, so every reading rejects. A verifier that drops
    # the snake_case spelling before canonicalizing still verifies it, while a parser that takes the snake_case value
    # reads image/png from a card whose signature covered text/plain.
    base = json.loads(json.dumps(m.BASE))
    bpay = v.canon(v.served_as_is(base))
    bsig = v.sign(priv, bpay)
    assert v.ref_verify(pub, bsig, bpay)
    tampered = {**base, "default_input_modes": ["image/png"]}
    tpay = v.canon(v.served_as_is(tampered))
    assert not v.ref_verify(pub, bsig, tpay)
    served = {**tampered, "signatures": [bsig]}
    vid = "S4-REJECT-%03d" % (len(CASES) + 1)
    doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", "axis": AXIS, "case": "snake_case_added_after_signing",
           "what": "the s0 control signed over its own bytes, then default_input_modes [\"image/png\"] added next to defaultInputModes [\"text/plain\"]",
           "disposition": "MUST-REJECT", "accept_under": [], "reject_under": S4_READINGS, "signer": "reference (ES256, RFC 6979), card edited after signing",
           "rationale": "Under dual-name-tolerate the added member is part of the received JSON the signature must cover, and it does not; under "
                        "dual-name-refuse the card carries both spellings. Every reading rejects. A verifier that discards the snake_case spelling "
                        "before canonicalizing still verifies the signature, while a parser that keeps the snake_case value reads image/png from a "
                        "card whose signature covered text/plain.",
           "canonical_utf8_hex": tpay.hex(), "served_card": served}
    path = GROUP + "/" + vid + ".json"
    data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
    open(os.path.join(OUT, path), "wb").write(data)
    added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
    observed[vid] = v.observe(served, jwks, jwksp, vid)
    man["vectors"] = man["vectors"] + added
    man["groups"] = man["groups"] + [GROUP]
    man["counts"] = {**man["counts"], "dual_name": len(added), "total": len(man["vectors"])}
    man["s4_readings"] = {
        "axis": AXIS,
        "dual-name-tolerate": "The specification text at a2aproject/A2A 173695755607 (v1.0.0), which does not require refusal: canonicalize the received JSON under served scope with every member kept as served, both spellings included. Then RFC 8785.",
        "dual-name-refuse": "The proposed sentence, not in the specification at 173695755607: \"A verifier MUST refuse a card in which the same schema field appears under both its JSON name and its protobuf name.\"",
        "proposal": PROPOSAL,
        "support": SUPPORT,
        "labelling": LABELLING,
        "note": "Labelled against the proposal, as s3 is labelled against its readings. Accepting a dual-name vector is a divergence from the proposal, not a failure against the current text. If the sentence is adopted, the readings get pinned to the specification revision that carries it.",
    }
    man["s4_sdk_forms"] = {"note": "Which reading each SDK's own canonicalization equals on each s4 card, byte for byte. Recorded, not required.", "cases": forms_seen}
    man["observed"]["s4"] = {"note": "Same meaning as observed.results.", "results": observed}
    man["generator_s4"] = "vectors_s4.py"
    open(man_path, "w").write(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    for vid, o in observed.items():
        print(vid, o)
    print(json.dumps({c: {s: f["equals"] for s, f in d.items()} for c, d in forms_seen.items()}, indent=1))


if __name__ == "__main__":
    main()
