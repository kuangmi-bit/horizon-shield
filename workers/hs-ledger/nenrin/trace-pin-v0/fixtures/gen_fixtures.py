import json, hashlib, rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import agentrust_trace as t
from agentrust_trace.sign import sign_record, verify_record, jwk_thumbprint, key_to_jwk
from agentrust_trace.validate import validate_json

key = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"hs trace-pin-v0 test key, not a secret").digest())
IAT = 1790640000
base = {
  "eat_profile": t.TRACE_PROFILE_V0_2, "iat": IAT,
  "subject": "spiffe://example.org/agent/estimator",
  "model": {"provider": "example", "model_id": "estimator-1"},
  "runtime": {"platform": "intel-tdx", "measurement": "sha256:" + "ab"*32},
  "policy": {"bundle_hash": "sha256:" + "cd"*32, "enforcement_mode": "enforce"},
  "data_class": "internal",
  "build_provenance": {"slsa_level": 2, "digest": "sha256:" + "ef"*32},
  "appraisal": {"status": "affirming", "verifier": "https://verifier.example/appraise"},
  "transparency": "https://registry.example/claim/trace-2026-09-29-0001",
}
def mk(rec):
    s = sign_record(rec, key)
    errs = []
    errs = [e.message[:200] for e in t.iter_errors(s)]
    ok = None
    try:
        verify_record(s, key.public_key(), now=IAT + 60); ok = True
    except Exception as e: ok = "REFUSED: " + str(e)[:160]
    return s, errs, ok
out = {}
for name, rec in [("valid", base),
                  ("nonascii", {**base, "data_class": "社外秘", "model": {"provider": "例", "model_id": "見積りé-1 " + chr(0x1F600) + " tab\t quote\" slash/ ctl" + chr(1)}}),
                  ("v01_profile", {**base, "eat_profile": "tag:agentrust.io,2026:trace-v0.1"})]:
    s, errs, ok = mk(rec)
    out[name] = {"record": s,
                 "jcs_sha256": hashlib.sha256(rfc8785.dumps(s)).hexdigest(),
                 "body_jcs_sha256": hashlib.sha256(rfc8785.dumps({k: v for k, v in s.items() if k != "signature"})).hexdigest(),
                 "thumbprint": jwk_thumbprint(s["cnf"]["jwk"]),
                 "python_verify_record_at_iat_plus_60": ok, "schema_errors": errs}
vectors = [{"b": 1, "a": [1, 2.5, -0.0, 1e-7, 123456789012345, True, None], "\u00e9": "x", "\U0001F600": 1, "\uffff": 2, "Z": {"y": "\u2028\u001f"}}, [0.1, 1.0, 100, 3.14159, -1.5e-10, 5e-324], "plain \"q\" \\\\ / \u007f"]
out["_jcs_vectors"] = [{"value": v, "jcs_utf8_hex": rfc8785.dumps(v).hex()} for v in vectors]
out["_jcs_stricter_here"] = [{"value": [1e21], "python_rfc8785": rfc8785.dumps([1e21]).decode(), "why": "Python holds 1e21 as a float; after JSON.parse a JS reader holds an integer past the safe range and cannot tell the two apart, so this ledger refuses it (unsafe_integer) instead of guessing"}]
out["_about"] = {"generator": "agentrust-trace 0.11.0 (PyPI), sign_record / verify_record / jwk_thumbprint / rfc8785", "key": "Ed25519 from sha256 of a fixed public test phrase; test key only, derives nothing real", "iat": IAT}
print(json.dumps({k: (v if k.startswith("_") else {kk: vv for kk, vv in v.items() if kk != "record"}) for k, v in out.items()}, ensure_ascii=False, indent=1))
json.dump(out, open("trace_fixtures.json", "w"), ensure_ascii=False, indent=1, sort_keys=True)
