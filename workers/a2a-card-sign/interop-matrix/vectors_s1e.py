"""Add the element-level empty value to group s1-default-valued of the a2a-card-sign-v01 corpus: securityRequirements: [{}].

Left out of s1 at first, because whether an element that becomes empty collapses is itself part of a2aproject/A2A#2122.
On #2122 (issuecomment-6077328276) the signer sentence was widened to cover "an element that becomes empty under recursive
empty-value removal", and kuangmi-bit asked (2026-10-09) for the case to sit in the same family as the field-level cards
with the accepting readings named next to each signature, so that a reader that only checks for empty fields fails the
set rather than one vector. So it goes into s1, next to skills: [] (S1-003/S1-004) and capabilities.extensions: []
(S1-007/S1-008), one signature per distinct canonical form:

  S1-009  signed over the form that keeps the element: securityRequirements: [{}]
          accepted under served-as-is, rule-1-as-written (rule 1 applied to fields: the repeated field is not at its
          default because it has one element, and the element is kept as an empty message), and by a reader that removes
          empty fields but not empty elements (field-level-prune)
  S1-010  signed over the form where the empty element collapses and the field with it
          accepted under prune-empty (a2a-sdk 1.2.1, @a2a-js/sdk 1.3.0) and rule-1-element-collapse (rule 1 with an
          element that becomes empty removed first)

Both are rejected under refuse-empty-element, the strict verifier reading of the widened sentence: a card carrying an
element that becomes empty under recursive removal is refused, signed or not (the a2a-tck#245 Layer B shape: one pair per
resolution plus a MUST-REJECT for the strict reading).

The other s1 files and every other group are not touched. The generator checks prune-empty against the a2a-python and
@a2a-js/sdk canonical bytes and served-as-is against a2a-go's, as vectors.py does for s1.

Run in the virtualenv with requirements.txt, go/interop-go built and node_modules installed:  python3 vectors_s1e.py
"""
import hashlib, json, os

import matrix as m
import vectors as v

GROUP = "s1-default-valued"
OUT = v.OUT
CASE = "nested_empty_security"
WHAT = "securityRequirements = [{}] (not REQUIRED, an element that becomes empty under recursive removal)"
ASK = "https://github.com/a2aproject/A2A/issues/2122#issuecomment-6083665390"
SENTENCE = "https://github.com/a2aproject/A2A/issues/2122#issuecomment-6077328276"
EXTRA = {
    "field-level-prune": "Empty strings, arrays and objects removed where they are field values, but an element of an array is never removed for being empty. A reader that checks only for empty fields.",
    "rule-1-element-collapse": "Section 8.4.1 rule 1 (served scope) after removing every array element that becomes empty under recursive removal; a repeated field left with no element is then at its default and dropped.",
    "refuse-empty-element": "The strict verifier reading of the sentence widened on #2122: a card carrying an element that becomes empty under recursive empty-value removal is refused, signed or not.",
}


def field_level_prune(x, top=True):
    if isinstance(x, dict):
        d = {}
        for k, val in x.items():
            if top and k == "signatures":
                continue
            p = field_level_prune(val, False)
            if p == "" or p == [] or p == {}:
                continue
            d[k] = p
        return d
    if isinstance(x, list):
        return [field_level_prune(e, False) for e in x]
    return x


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    man_path = os.path.join(OUT, "MANIFEST.json")
    man = json.load(open(man_path))
    if any(p["path"].endswith("/S1-009.json") for p in man["vectors"]):
        raise SystemExit("S1-009 already present")
    card = next(c for n, _w, c in m.CASES if n == CASE)
    assert card["securityRequirements"] == [{}]
    f = v.forms(card)
    kept, collapsed = f["served-as-is"], f["prune-empty"]
    assert f["rule-1-as-written"] == kept and kept != collapsed
    assert v.canon(field_level_prune(card)) == kept
    os.makedirs(os.path.join(m.HERE, "out"), exist_ok=True)
    cp = os.path.join(m.HERE, "out", CASE + ".json")
    json.dump(card, open(cp, "w"), separators=(",", ":"), ensure_ascii=False)
    py = m.py_canon(card, text=True)["text"].encode()
    js = (m.run(["node", "js_tool.mjs", "canon", cp]).get("text") or "").encode()
    go = (m.run([m.GO_BIN, "canon", cp]).get("text") or "").encode()
    if not (py == js == collapsed):
        raise SystemExit("prune-empty does not match a2a-python / @a2a-js/sdk on [{}]")
    if go != kept:
        raise SystemExit("served-as-is does not match a2a-go on [{}]")
    added, observed = [], {}
    for vid, payload, acc in (("S1-009", kept, ["rule-1-as-written", "served-as-is", "field-level-prune"]),
                              ("S1-010", collapsed, ["prune-empty", "rule-1-element-collapse"])):
        sig = v.sign(priv, payload)
        assert v.ref_verify(pub, sig, payload)
        rej = [r for r in ["rule-1-as-written", "prune-empty", "served-as-is", "field-level-prune", "rule-1-element-collapse"] if r not in acc] + ["refuse-empty-element"]
        body = {"case": CASE, "what": WHAT, "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
                "accept_under": acc, "reject_under": rej, "signer": "reference (ES256, RFC 6979)",
                "rationale": ("An array element that becomes empty under recursive removal (%s). The signature covers the %s form. "
                              "The pair sits next to the field-level cases S1-003/S1-004 (skills: []) and S1-007/S1-008 "
                              "(capabilities.extensions: []), so a reader that removes empty fields but keeps empty elements "
                              "(field-level-prune) agrees with prune-empty on those and disagrees here. Under refuse-empty-element "
                              "both vectors of this pair are rejected." % (WHAT, "element-kept" if vid == "S1-009" else "element-collapsed")),
                "canonical_utf8_hex": payload.hex()}
        served = {**card, "signatures": [sig]}
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", **body, "served_card": served}
        path = GROUP + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(OUT, path), "wb").write(data)
        added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        observed[vid] = v.observe(served, jwks, jwksp, vid)
    differ = []
    for p in man["vectors"]:
        sc = json.load(open(os.path.join(OUT, p["path"])))["served_card"]
        if v.canon(field_level_prune(sc)) != v.canon(v.prune_empty(sc)):
            differ.append(p["path"])
    if differ:
        raise SystemExit("field-level-prune differs from prune-empty on existing vectors: " + ", ".join(differ))
    idx = max(i for i, p in enumerate(man["vectors"]) if p["path"].startswith(GROUP + "/")) + 1
    man["vectors"] = man["vectors"][:idx] + added + man["vectors"][idx:]
    man["counts"] = {**man["counts"], "reading_dependent": man["counts"]["reading_dependent"] + len(added), "total": len(man["vectors"])}
    man["s1e_readings"] = {**EXTRA, "asked_on": ASK, "sentence": SENTENCE,
                           "note": "Readings named only for S1-009 and S1-010. On every other vector field-level-prune equals prune-empty and rule-1-element-collapse equals rule-1-served-scope (rule-1-as-written on s0 and s1), because no other card carries an empty element."}
    man["observed"]["s1e"] = {"note": "Same meaning as observed.results.", "results": observed}
    man["generator_s1e"] = "vectors_s1e.py"
    open(man_path, "w").write(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    for vid, o in observed.items():
        print(vid, o)


if __name__ == "__main__":
    main()
