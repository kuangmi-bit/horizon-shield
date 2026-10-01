"""Add two transition vectors to group s3-unknown-fields: one card carrying one signature per form.

Raised on a2aproject/A2A#2122: whichever form the patch selects, cards signed today were signed over the other one, so
the patch has to say how the change is crossed. Section 8.4.3 already gives the tool: "Clients SHOULD verify at least one
signature before trusting an Agent Card" and "Multiple signatures MAY be present to support key rotation". A signer
can carry the same key's signature over both forms during a transition window, and each verifier checks the form it
implements.

  S3-D-012  the legacy_v03_top_level card with signatures [exclude form, retain form]. A verifier under either reading
            finds one signature that verifies, so the card is accepted under both. Signer-side transition costs nothing.
  S3-D-013  the same dual-signed card with url replaced after signing. The exclude-form signature still verifies (url was
            never covered), the retain-form one does not. So a retain verifier rejects it, an exclude verifier accepts
            it, and a verifier that accepts a card when either form verifies (a verifier-side transition policy)
            accepts it too: it inherits exactly the exposure of exclude. That is the point of the pair: dual-signing is
            safe for the signer; accepting either form is not safe for the verifier.

Both signatures are the reference signatures already in S3-001 and S3-002 (RFC 6979, same key, same bytes), so nothing
here is a new signature over new content. canonical_utf8_hex is the payload of signatures[0] (vectors_check.mjs checks
that one); canonical_utf8_hex_per_signature lists both.

Run after vectors_s3.py:  PY1287=/path/to/venv/bin/python python3 vectors_s3_transition.py
"""
import hashlib, json, os

import matrix as m
import vectors as v
import vectors_s2 as s2
import vectors_s3 as s3

IDS = ("S3-D-012", "S3-D-013")


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    man_path = os.path.join(s3.OUT, "MANIFEST.json")
    man = json.load(open(man_path))
    have = {p["path"] for p in man["vectors"]}
    if not any(p.startswith(s3.GROUP + "/S3-T-") for p in have):
        raise SystemExit("run vectors_s3.py first")
    if any(s3.GROUP + "/" + i + ".json" in have for i in IDS):
        raise SystemExit("transition vectors already present")
    card = dict(dict((c[0], c[2]) for c in s3.CASES)[s3.TAMPER_OF])
    f = s3.s3_forms(card)
    s_ex, s_re = v.sign(priv, f["unknown-exclude"]), v.sign(priv, f["unknown-retain"])
    for vid in ("S3-001", "S3-002"):
        d = json.load(open(os.path.join(s3.OUT, s3.GROUP, vid + ".json")))
        assert d["served_card"]["signatures"][0] in (s_ex, s_re), vid + ": reference signature not reproduced"
    added, observed = [], {}

    def emit(vid, body, served, payloads):
        for sig, p in zip(served["signatures"], payloads):
            assert v.ref_verify(pub, sig, p)
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": v.SPEC_REF, "layer": "signature", "axis": s3.AXIS, **body,
               "canonical_utf8_hex": payloads[0].hex(), "canonical_utf8_hex_per_signature": [p.hex() for p in payloads],
               "served_card": served}
        path = s3.GROUP + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(s3.OUT, path), "wb").write(data)
        added.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        o = v.observe(served, jwks, jwksp, vid)
        o["a2a-python#1287"] = s2.py1287_verify(served, jwksp)
        observed[vid] = o

    emit("S3-D-012", {"case": s3.TAMPER_OF + "_dual_signed", "what": "the legacy_v03_top_level card with one signature per form: [exclude, retain]",
         "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
         "accept_under": ["unknown-retain", "unknown-exclude"], "reject_under": ["unknown-reject"],
         "signer": "reference (ES256, RFC 6979); the signatures of S3-002 and S3-001",
         "rationale": "Section 8.4.3: a client SHOULD verify at least one signature, and multiple signatures MAY be present. "
                      "Under each reading one of the two signatures verifies, so a signer can serve both readings during a transition."},
         {**card, "signatures": [s_ex, s_re]}, [f["unknown-exclude"], f["unknown-retain"]])

    edited = {**card, "url": s3.TAMPER_URL}
    fe = s3.s3_forms(edited)
    assert fe["unknown-exclude"] == f["unknown-exclude"] and fe["unknown-retain"] != f["unknown-retain"]
    emit("S3-D-013", {"case": s3.TAMPER_OF + "_dual_signed_edited", "what": "S3-D-012 with url replaced after signing",
         "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
         "accept_under": ["unknown-exclude"], "reject_under": ["unknown-retain", "unknown-reject"],
         "signer": "reference (ES256, RFC 6979), card edited after signing",
         "rationale": "The exclude-form signature still verifies because url was never covered; the retain-form signature does not. "
                      "A verifier that accepts the card when either form verifies accepts this vector, so a verifier-side "
                      "transition policy carries the exposure of unknown-exclude."},
         {**edited, "signatures": [s_ex, s_re]}, [f["unknown-exclude"], f["unknown-retain"]])

    man["vectors"] = man["vectors"] + added
    man["counts"] = {**man["counts"], "unknown_fields": man["counts"]["unknown_fields"] + len(added), "total": len(man["vectors"])}
    man["s3_readings"]["transition"] = ("S3-D-012 and S3-D-013 carry two signatures, one per form, from the same key. Section 8.4.3: "
                                        "verify at least one signature; multiple signatures MAY be present. A verifier is scored on "
                                        "the reading it implements; a verifier that accepts either form accepts S3-D-013.")
    man["observed"]["s3"]["results"].update(observed)
    man["generator_s3_transition"] = "vectors_s3_transition.py"
    open(man_path, "w").write(json.dumps(man, indent=2, ensure_ascii=False) + "\n")
    for vid, o in observed.items():
        print(vid, o)


if __name__ == "__main__":
    main()
