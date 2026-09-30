"""Build the a2a-card-sign-v01 corpus: signed Agent Card vectors, one signature per canonical reading.

Layer C of the Agent Card canonicalization corpus. Layer A (RFC 8785 and signatures-exclusion) is a2a-jcs-v01
(a2aproject/a2a-tck#228), Layer B (section 8.4.1 rule 1 on bytes) is a2a-jcs-rule1-v01 (a2aproject/a2a-tck#245).
This layer asks the question those two cannot: given a signed card, which signatures does a verifier accept.

Three readings of the bytes a card signature covers:
  rule-1-as-written  section 8.4.1 rule 1 applied to the card as served, REQUIRED set read from the proto annotations
  prune-empty        empty strings, arrays and objects removed recursively (a2a-python 1.2.1 and @a2a-js/sdk 1.3.0)
  served-as-is       the served JSON with only `signatures` removed (a2a-go a2acrypto at main 534a60fc)
Every card here carries every REQUIRED field of AgentCard, so the open question of a2a-tck#245 (absent REQUIRED
fields) does not arise: its presence-preserving and inject-required-defaults resolutions both coincide with
rule-1-as-written on these inputs.

Each vector's signature is made by a reference signer (ES256, RFC 6979 deterministic, so every byte re-creates) over
one reading's canonical bytes, with the published test key from matrix.py. Readings are checked against the SDKs
before anything is written: prune-empty must equal the a2a-python and @a2a-js/sdk canonical bytes and served-as-is
must equal a2a-go's, case by case. Canonical bytes are produced by rfc8785 (PyPI) and, when JCS_GO_BIN points at a
build of gowebpki/jcs, checked byte for byte against it.

Run after matrix.py (it reuses out/ and the built Go tool):  JCS_GO_BIN=/path/to/jcsgo python3 vectors.py
"""
import base64, hashlib, json, os, shutil, subprocess

import rfc8785
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from google.api import field_behavior_pb2
from a2a.types import AgentCard
from a2a.utils import signing

import matrix as m

CORPUS = "a2a-card-sign-v01"
OUT = os.path.join(m.HERE, "vectors", CORPUS)
READINGS = ["rule-1-as-written", "prune-empty", "served-as-is"]
SPEC_REF = "https://a2a-protocol.org/latest/specification/#841-canonicalization-requirements"
REQUIRED = field_behavior_pb2.REQUIRED
CASES = [c for c in m.CASES if c[0] != "nested_empty_security"]
VEC_JKU = "https://example.com/a2a-card-sign-v01/testkey_jwks.json"  # never fetched; verifiers use testkey_jwks.json
HEADER = {"alg": "ES256", "jku": VEC_JKU, "kid": m.KID, "typ": "JOSE"}


class Ambiguous(Exception):
    pass


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def is_required(f):
    return REQUIRED in f.GetOptions().Extensions[field_behavior_pb2.field_behavior]


def is_default(v):
    return v is False or v == "" or v == [] or v == {} or (type(v) in (int, float) and v == 0)


def rule1(obj, desc):
    out = {}
    for k, v in obj.items():
        if k == "signatures" and desc is AgentCard.DESCRIPTOR:
            continue
        f = desc.fields_by_camelcase_name.get(k)
        if f is None:
            raise Ambiguous("field not in proto: " + k)
        msg = f.message_type is not None and not f.message_type.GetOptions().map_entry
        if msg and f.is_repeated:
            val = [rule1(e, f.message_type) for e in v]
        elif msg:
            val = rule1(v, f.message_type)
        else:
            val = v
        if is_required(f):
            out[k] = val
        elif msg and not f.is_repeated:
            if val == {}:
                raise Ambiguous("non-REQUIRED message field left empty: " + k)
            out[k] = val
        elif f.has_presence:
            out[k] = val
        elif not is_default(val):
            out[k] = val
    return out


def prune_empty(v, top=True):
    if isinstance(v, dict):
        d = {k: p for k, x in v.items() if not (top and k == "signatures") and (p := prune_empty(x, False)) is not None}
        return d or None
    if isinstance(v, list):
        l = [p for x in v if (p := prune_empty(x, False)) is not None]
        return l or None
    if isinstance(v, str) and not v:
        return None
    return v


def served_as_is(card):
    return {k: v for k, v in card.items() if k != "signatures"}


def canon(obj):
    b = rfc8785.dumps(obj)
    go = os.environ.get("JCS_GO_BIN")
    if go:
        p = subprocess.run([go], input=json.dumps(obj, ensure_ascii=False).encode(), capture_output=True, check=True)
        if bytes.fromhex(p.stdout.decode().strip()) != b:
            raise SystemExit("rfc8785 and gowebpki/jcs disagree")
    return b


def forms(card):
    return {"rule-1-as-written": canon(rule1(card, AgentCard.DESCRIPTOR)), "prune-empty": canon(prune_empty(card)), "served-as-is": canon(served_as_is(card))}


def sign(priv, payload):
    protected = b64u(json.dumps(HEADER, separators=(",", ":"), sort_keys=True).encode())
    der = priv.sign((protected + "." + b64u(payload)).encode(), ec.ECDSA(hashes.SHA256(), deterministic_signing=True))
    r, s = decode_dss_signature(der)
    return {"protected": protected, "signature": b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))}


def ref_verify(pub, sig, payload):
    raw = unb64u(sig["signature"])
    try:
        pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
                   (sig["protected"] + "." + b64u(payload)).encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def sdk_check(name, card, f, go_sha):
    py = m.py_canon(card, text=True)["text"].encode()
    cp = os.path.join(m.HERE, "out", name + ".json")
    js = m.run(["node", "js_tool.mjs", "canon", cp])["text"].encode()
    if not (py == js == f["prune-empty"]):
        raise SystemExit(name + ": prune-empty does not match a2a-python / @a2a-js/sdk")
    if go_sha != hashlib.sha256(f["served-as-is"]).hexdigest():
        raise SystemExit(name + ": served-as-is does not match a2a-go")


def observe(served, jwks, jwksp, tag):
    sp = os.path.join(m.HERE, "out", "vec-" + tag + ".json")
    json.dump(served, open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
    g = m.run([m.GO_BIN, "verify", sp, jwksp])
    return {"a2a-python": m.py_verify(served, jwks)["ok"], "a2a-js": bool(m.run(["node", "js_tool.mjs", "verify", sp, jwksp]).get("ok")), "a2a-go": bool(g.get("ok"))}


def main():
    priv, pem, jwks = m.test_key()
    pub = priv.public_key()
    jwksp = os.path.join(m.HERE, "testkey_jwks.json")
    keyp = os.path.join(m.HERE, "out", "testkey.pem")
    results = json.load(open(os.path.join(m.HERE, "out", "results.json")))
    go_sha = {r["case"]: r["canonical"]["go"]["sha256"] for r in results["rows"]}
    kept = {}
    for i in (2, 3, 4):
        old = os.path.join(OUT, "s0-control", "S0-%03d.json" % i)
        if os.path.exists(old):
            kept[i] = json.load(open(old))["served_card"]["signatures"][0]
    shutil.rmtree(OUT, ignore_errors=True)
    vectors, observed = [], {}

    def emit(group, vid, body, served, obs=True):
        os.makedirs(os.path.join(OUT, group), exist_ok=True)
        doc = {"id": vid, "clause": "a2a-spec-8.4.1", "spec_ref": SPEC_REF, "layer": "signature", **body, "served_card": served}
        path = group + "/" + vid + ".json"
        data = (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode()
        open(os.path.join(OUT, path), "wb").write(data)
        vectors.append({"path": path, "sha256": hashlib.sha256(data).hexdigest()})
        if obs:
            observed[vid] = observe(served, jwks, jwksp, vid)

    name, what, ctrl = CASES[0]
    f = forms(ctrl)
    if len(set(f.values())) != 1:
        raise SystemExit("control is not reading-independent")
    sdk_check(name, ctrl, f, go_sha[name])
    payload = f["prune-empty"]
    sig = sign(priv, payload)
    assert ref_verify(pub, sig, payload)
    emit("s0-control", "S0-001", {"disposition": "MUST-ACCEPT", "accept_under": READINGS, "reject_under": [], "signer": "reference (ES256, RFC 6979)",
         "rationale": "Control: every REQUIRED field present and non-default, no empty value anywhere, so all three readings give the same bytes. Any verifier MUST accept, whichever way a2aproject/A2A#2122 is settled.",
         "canonical_utf8_hex": payload.hex()}, {**ctrl, "signatures": [sig]})
    n = 2
    for sdk, label in (("python", "a2a-sdk 1.2.1"), ("js", "@a2a-js/sdk 1.3.0"), ("go", "a2a-go main 534a60fc")):
        cp = os.path.join(m.HERE, "out", name + ".json")
        s = kept.get(n)
        if s and not (ref_verify(pub, s, payload) and json.loads(unb64u(s["protected"])).get("jku") == VEC_JKU):
            s = None
        if s is None and sdk == "python":
            signer = signing.create_agent_card_signer(priv, {"alg": "ES256", "kid": m.KID, "jku": VEC_JKU, "typ": "JOSE"})
            s = signer(m.py_parse(ctrl)).signatures[-1]
            s = {"protected": s.protected, "signature": s.signature}
        elif s is None:
            s = m.run((["node", "js_tool.mjs"] if sdk == "js" else [m.GO_BIN]) + ["sign", cp, keyp, m.KID, VEC_JKU])["signature"]
        s = {"protected": s["protected"], "signature": s["signature"]}
        if not ref_verify(pub, s, payload):
            raise SystemExit(sdk + " signature on control does not verify over the common bytes")
        emit("s0-control", "S0-%03d" % n, {"disposition": "MUST-ACCEPT", "accept_under": READINGS, "reject_under": [], "signer": label,
             "rationale": "The control card signed by %s itself. Recorded as produced; its ECDSA nonce is the SDK's, so re-signing gives other bytes that verify the same way." % label,
             "canonical_utf8_hex": payload.hex()}, {**ctrl, "signatures": [s]})
        n += 1
    tampered = {**ctrl, "description": ctrl["description"] + ".", "signatures": [sig]}
    emit("s0-control", "S0-REJECT-%03d" % n, {"disposition": "MUST-REJECT", "accept_under": [], "reject_under": READINGS, "signer": "reference (ES256, RFC 6979)",
         "rationale": "S0-001's signature on a card whose description gained one character after signing. Every reading changes, so every verifier MUST reject.",
         "canonical_utf8_hex": canon(served_as_is(tampered)).hex()}, tampered)

    k = 1
    for name, what, card in CASES[1:]:
        f = forms(card)
        sdk_check(name, card, f, go_sha[name])
        groups = {}
        for r in READINGS:
            groups.setdefault(f[r], []).append(r)
        if len(groups) != 2:
            raise SystemExit(name + ": expected exactly two distinct forms")
        for payload, acc in groups.items():
            sig = sign(priv, payload)
            assert ref_verify(pub, sig, payload)
            rej = [r for r in READINGS if r not in acc]
            emit("s1-default-valued", "S1-%03d" % k, {"case": name, "what": what, "disposition": "MUST-ACCEPT under accept_under, MUST-REJECT under reject_under",
                 "accept_under": acc, "reject_under": rej, "signer": "reference (ES256, RFC 6979)",
                 "rationale": "One field at its default value (%s). The signature covers the %s form. Exactly one vector of this case's pair applies once a2aproject/A2A#2122 settles which reading is normative." % (what, " / ".join(acc)),
                 "canonical_utf8_hex": payload.hex()}, {**card, "signatures": [sig]})
            k += 1

    readings_doc = {
        "rule-1-as-written": "Section 8.4.1 rule 1 on the card as served: a REQUIRED field (proto annotation) stays even at its default value, a field with the optional keyword stays when set, any other field at its default value (\"\", 0, false, [], {}) is dropped. Applied recursively through message-typed fields. Then RFC 8785.",
        "prune-empty": "Empty strings, arrays and objects removed recursively regardless of REQUIRED (false and 0 kept). Then RFC 8785. Matches a2a-sdk 1.2.1 and @a2a-js/sdk 1.3.0 byte for byte on every card here.",
        "served-as-is": "The served JSON with `signatures` removed, nothing else. Then RFC 8785. Matches a2a-go a2acrypto at main 534a60fc byte for byte on every card here.",
    }
    manifest = {
        "corpus": CORPUS, "suite": "a2a-agent-card-signature-conformance", "specRef": SPEC_REF, "layer": "signature",
        "scope": "Layer C: which Agent Card signatures a verifier accepts. Layer A is a2a-jcs-v01 (a2a-tck#228), Layer B is a2a-jcs-rule1-v01 (a2a-tck#245). Every card carries every REQUIRED field of AgentCard, so Layer B's open point (absent REQUIRED fields) does not arise here.",
        "open_question": "https://github.com/a2aproject/A2A/issues/2122",
        "spec_provenance": {
            "text": "a2aproject/A2A specification/specification.md at 173695755607 (v1.0.0), section 8.4.1",
            "required_set": "field_behavior = REQUIRED annotations of a2a.proto as generated in a2a-sdk 1.2.1 (a2a.types.a2a_pb2); on the fields these cases touch they agree with a2aproject/A2A specification/a2a.proto at 173695755607: AgentCard.description and AgentCard.skills and AgentSkill.tags are REQUIRED, AgentCapabilities.extensions is not, AgentCapabilities.streaming and push_notifications carry the optional keyword",
            "worked_example": "The section's own worked example keeps description \"\" and skills [] and omits capabilities.extensions [], which is the rule-1-as-written tagging of S1-001, S1-003 and S1-007.",
        },
        "jku_note": "The jku in every protected header is an example.com placeholder and is never fetched. Resolve the key from testkey_jwks.json by kid.",
        "readings": readings_doc,
        "relation_to_rule1_corpus": "On inputs that carry every REQUIRED field, a2a-jcs-rule1-v01's presence-preserving and inject-required-defaults resolutions both give the rule-1-as-written bytes.",
        "test_key": {"kid": m.KID, "alg": "ES256", "jwk": jwks["keys"][0], "derivation": "d = int.from_bytes(sha256(phrase), 'big') mod (n - 1) + 1 on P-256", "phrase": m.PHRASE,
                     "note": "Published test key, so anyone can re-create the private key and re-sign every reference vector byte for byte (RFC 6979). It signs test vectors only and is nobody's production key."},
        "protected_header": HEADER,
        "oracles": ["rfc8785 (PyPI, 0.1.4)", "gowebpki/jcs (Go, v1.0.1)"] if os.environ.get("JCS_GO_BIN") else ["rfc8785 (PyPI, 0.1.4)"],
        "generator": "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/a2a-card-sign/interop-matrix/vectors.py",
        "counts": {"accept_any": 4, "reject_any": 1, "reading_dependent": k - 1, "total": len(vectors)},
        "groups": ["s0-control", "s1-default-valued"],
        "observed": {"note": "Not part of the expectations. What each SDK's own verifier returned on each served card, on the date and versions below.",
                     "date": "2026-10-01", "versions": results["versions"], "results": observed},
        "vectors": vectors,
    }
    open(os.path.join(OUT, "MANIFEST.json"), "w").write(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    shutil.copy(jwksp, os.path.join(OUT, "testkey_jwks.json"))
    shutil.copy(os.path.join(m.HERE, "vectors", "README_corpus.md"), os.path.join(OUT, "README.md"))
    for vid, o in observed.items():
        print(vid, o)


if __name__ == "__main__":
    main()
