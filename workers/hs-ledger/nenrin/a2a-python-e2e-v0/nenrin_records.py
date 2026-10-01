"""The producer side of NENRIN provenance records, written in Python from the spec, not from the verifier.

Nothing here is imported from nenrin-verify. The verifier (Python or JavaScript) recomputes every id and checks
every signature these functions make, so a mistake here shows up as a refusal, not as a silent pass.

  canonical(v)       keys sorted at every depth, no whitespace, strings as JSON writes them, integers only
                     (task-delegation-bind-v0/bind.mjs). Every value this producer writes is ASCII.
  did:key            Ed25519 public key, multicodec 0xed01, base58btc, prefix did:key:z.
  ids                sha256 of canonical(record without its derived fields):
                       observation  evidence_id   without evidence_id, witness_sig, edge_sig, consent
                       grant        grant_ref     without grant_ref, caller_sig, action_binding
                       intent       intent_id     without intent_id, intent_sig, action_binding
                       receipt      receipt_id    without receipt_id, provider_sig, action_binding
  signatures         Ed25519 over the same canonical bytes, base64; the edge signature is the hop sender's,
                     over canonical({task_id, hop}).

Test keys are derived from a public phrase (TEST_PHRASE + role), so anyone can re-derive them. They sign nothing
but these examples.
"""
import base64
import hashlib
import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

TEST_PHRASE = "nenrin a2a-python-e2e-v0 public test key, never use for anything real: "
MAX_SAFE = 9007199254740991
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _check(v, path="$"):
    if v is None or isinstance(v, (str, bool)):
        return
    if isinstance(v, int):
        if abs(v) > MAX_SAFE:
            raise ValueError("unsafe_number at " + path)
        return
    if isinstance(v, float):
        raise ValueError("non_integer_number at " + path)
    if isinstance(v, list):
        for i, x in enumerate(v):
            _check(x, "%s[%d]" % (path, i))
        return
    if isinstance(v, dict):
        for k, x in v.items():
            if not isinstance(k, str) or any(ord(c) < 0x20 or ord(c) > 0x7E for c in k):
                raise ValueError("key_not_printable_ascii at %s.%s" % (path, k))
            _check(x, path + "." + k)
        return
    raise ValueError("bad_json at " + path)


def canonical(v):
    _check(v)
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256hex(s):
    return hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()


def b58encode(b):
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


class Agent:
    def __init__(self, role):
        self.role = role
        self.key = Ed25519PrivateKey.from_private_bytes(hashlib.sha256((TEST_PHRASE + role).encode()).digest())
        raw = self.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.did = "did:key:z" + b58encode(b"\xed\x01" + raw)

    def sign(self, record):
        return base64.b64encode(self.key.sign(canonical(record).encode("utf-8"))).decode()


def _without(rec, derived):
    return {k: v for k, v in rec.items() if k not in derived}


OBS_DERIVED = ("evidence_id", "witness_sig", "edge_sig", "consent")
GRANT_DERIVED = ("grant_ref", "caller_sig", "action_binding")
INTENT_DERIVED = ("intent_id", "intent_sig", "action_binding")
RECEIPT_DERIVED = ("receipt_id", "provider_sig", "action_binding")


def make_grant(caller, provider_did, task_id, action, nonce, not_before, not_after):
    g = {"schema": "task-execution-bind-v0/grant", "task_id": task_id, "action": action, "caller_id": caller.did,
         "provider_id": provider_did, "nonce": nonce, "not_before": not_before, "not_after": not_after}
    g["grant_ref"] = sha256hex(canonical(g))
    g["caller_sig"] = caller.sign(_without(g, GRANT_DERIVED))
    return g


def make_intent(provider, grant, declared_at):
    i = {"schema": "task-execution-bind-v0/intent", "task_id": grant["task_id"], "grant_ref": grant["grant_ref"],
         "proposed_action": grant["action"], "provider_id": provider.did, "declared_at": declared_at}
    i["intent_id"] = sha256hex(canonical(i))
    i["intent_sig"] = provider.sign(_without(i, INTENT_DERIVED))
    return i


def make_receipt(provider, grant, executed_action, status, result_sha256, evidence, executed_at):
    r = {"schema": "task-execution-bind-v0/receipt", "task_id": grant["task_id"], "grant_ref": grant["grant_ref"],
         "executed_action": executed_action, "outcome": {"status": status, "result_sha256": result_sha256, "evidence": evidence},
         "provider_id": provider.did, "executed_at": executed_at}
    r["receipt_id"] = sha256hex(canonical(r))
    r["provider_sig"] = provider.sign(_without(r, RECEIPT_DERIVED))
    return r


def make_observation(witness, sender, task_id, seq, to_did, prev, verdict, detail_ref, observed_at):
    o = {"task_id": task_id, "hop": {"seq": seq, "from": sender.did, "to": to_did}, "prev_evidence_id": prev,
         "conduct": {"verdict": verdict, "detail_ref": detail_ref}, "witness_id": witness.did, "observed_at": observed_at}
    o["evidence_id"] = sha256hex(canonical(o))
    o["witness_sig"] = witness.sign(_without(o, OBS_DERIVED))
    o["edge_sig"] = sender.sign({"task_id": task_id, "hop": o["hop"]})
    return o


def verify_grant(grant, provider_did):
    """What the provider checks before it acts: the grant names it, recomputes, and the caller signed it."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    if grant.get("schema") != "task-execution-bind-v0/grant":
        return "grant_schema"
    if grant.get("provider_id") != provider_did:
        return "grant_names_another_provider"
    if grant.get("grant_ref") != sha256hex(canonical(_without(grant, GRANT_DERIVED))):
        return "grant_ref_mismatch"
    did = grant.get("caller_id", "")
    if not did.startswith("did:key:z"):
        return "caller_not_did_key"
    n = 0
    for c in did[len("did:key:z"):]:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes(34, "big")
    if raw[:2] != b"\xed\x01":
        return "caller_not_ed25519"
    try:
        Ed25519PublicKey.from_public_bytes(raw[2:]).verify(base64.b64decode(grant["caller_sig"]),
                                                          canonical(_without(grant, GRANT_DERIVED)).encode())
    except Exception:
        return "caller_sig_invalid"
    return None
