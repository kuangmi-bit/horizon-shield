"""nenrin_verify.a2a_recorder: every A2A call your agent makes becomes a signed witness record, in two lines.

    from nenrin_verify.a2a_recorder import Recorder
    client = ClientFactory(config).create(card, interceptors=[Recorder(witness_name="acme-billing", key="witness.pem")])

That is the whole integration with the official A2A Python SDK (a2a-sdk 1.x, ClientCallInterceptor). From then on
each outgoing call (send_message, streaming, get_task, cancel_task, ...) is logged on your machine: when it
started, which method, the salted sha256 of the request, the salted sha256 of every response event, the final task
state, and whether any result came back at all. Nothing is sent anywhere. When the process exits (or when you call
flush()), the calls are written as one jidec-path-v1 record per agent endpoint, signed with your Ed25519 key:

    nenrin-records/records/<sha256>.json    {"record_canonical", "signature_ed25519_b64", "public_key_ed25519_b64"}
                                            (exactly the body the NENRIN witness intake accepts)
    nenrin-records/private/<sha256>.json    the salt and the full call log, file mode 600; it never leaves your machine
                                            unless you choose to show it to the counterparty in a dispute

Filing at the public ledger is opt-in and separate: flush(submit=True), or `nenrin-a2a-record submit <file>` later.
The ledger counts one record per witness per endpoint per UTC day, so the recorder files at most one per day and
keeps the rest local. Each record names the witness's previous record for the same endpoint (prev_path_refs), so a
witness that drops an unfavourable day leaves a visible break in its own chain.

What a record is, and is not: a caller's signed account of what came back from an agent it actually used. Content
never leaves the caller (salted hashes only). It does not say the answers were right, and an unanswered call may be
the caller's own network. Every record lists what it establishes and what it does not, and the ledger refuses a
record without both lists. No score is computed anywhere.

The interceptor never changes a request or a result, never raises into the SDK call path (a recording error is
counted, not thrown), and works with the JSON-RPC, REST and gRPC transports alike, because it sits above them.
"""
import argparse
import atexit
import base64
import hashlib
import json
import os
import platform
import secrets
import sys
import threading
import time
from datetime import datetime, timezone

try:  # the SDK is optional at import time: verify/submit/show work without it
    from a2a.client.interceptors import ClientCallInterceptor as _Base
except Exception:  # pragma: no cover
    class _Base(object):
        pass

SCHEMA = "jidec-path-v1"
PURPOSE_PREFIX = "a2a-call-record-v1: "
RECORDER_VERSION = "0.4.0"
WALKER = "nenrin-verify a2a_recorder/" + RECORDER_VERSION
DEFAULT_INTAKE = "https://ledger.horizonshield.dev/witness"
STATE_KEY = "nenrin.a2a_recorder.call"
GRACE_SECONDS = 30            # a call younger than this with no result yet is still in flight: kept for the next flush
MAX_NODES = 120               # nodes per record; every unanswered call is listed first, answered calls fill the rest
MAX_RECORD_BYTES = 60000      # the intake refuses records above 65536 bytes
HASH_RECIPE = ("sha256(salt || b1 || 0x0a || b2 || 0x0a ...) where each b is the canonical JSON (sorted keys, no "
               "whitespace, UTF-8) of the SDK object as google.protobuf.json_format.MessageToDict writes it; the "
               "salt is 32 random bytes per record, kept by the witness in its private file")


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_hex(b):
    return hashlib.sha256(b).hexdigest()


def utc_now(t=None):
    return datetime.fromtimestamp(time.time() if t is None else t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def object_bytes(obj):
    """The bytes a hash covers for one SDK object: canonical proto JSON for protobuf messages, canonical JSON for
    plain data, raw bytes for bytes. Returns (bytes, kind)."""
    if obj is None:
        return b"null", "none"
    if hasattr(obj, "DESCRIPTOR") and hasattr(obj, "SerializeToString"):
        from google.protobuf.json_format import MessageToDict
        return canonical(MessageToDict(obj)).encode("utf-8"), obj.DESCRIPTOR.name
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj), "bytes"
    if isinstance(obj, tuple):  # pre-1.0 SDKs yielded (task, update) pairs
        return canonical([json.loads(object_bytes(x)[0].decode("utf-8")) for x in obj]).encode("utf-8"), "tuple"
    try:
        return canonical(obj).encode("utf-8"), type(obj).__name__
    except Exception:
        return repr(obj).encode("utf-8"), "repr:" + type(obj).__name__


def salted_hash(salt, objs):
    h = hashlib.sha256(salt)
    for o in objs:
        h.update(object_bytes(o)[0] + b"\n")
    return h.hexdigest()


def _result_info(obj):
    """(kind, task_state) of one result or stream event, read from the proto without keeping any content."""
    kind, state = None, None
    try:
        from a2a.types import a2a_pb2 as pb
        if hasattr(obj, "HasField"):
            for f in ("task", "message", "status_update", "artifact_update"):
                try:
                    if obj.HasField(f):
                        kind = f
                        sub = getattr(obj, f)
                        if f == "task":
                            state = pb.TaskState.Name(sub.status.state)
                        elif f == "status_update":
                            state = pb.TaskState.Name(sub.status.state)
                        break
                except ValueError:
                    continue
            if kind is None:
                kind = obj.DESCRIPTOR.name
                if kind == "Task":
                    state = pb.TaskState.Name(obj.status.state)
    except Exception:
        pass
    return kind, state


def endpoint_of(card, preferred=None):
    """The interface URL the client most likely calls: the one given, else the first JSON-RPC interface on the card
    (the SDK's default binding), else the first interface. Returns (url, binding, how)."""
    if preferred:
        return preferred, None, "given"
    ifs = list(getattr(card, "supported_interfaces", []) or [])
    for i in ifs:
        if getattr(i, "protocol_binding", "") == "JSONRPC":
            return i.url, "JSONRPC", "first JSONRPC interface on the card (the SDK default binding)"
    if ifs:
        return ifs[0].url, getattr(ifs[0], "protocol_binding", None), "first interface on the card"
    return "unknown:" + (getattr(card, "name", "") or "agent"), None, "card lists no interface"


def _host(u):
    try:
        from urllib.parse import urlsplit
        s = urlsplit(u)
        return s.hostname.lower() if s.scheme == "https" and s.hostname else None
    except Exception:
        return None


def load_key(path):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    with open(path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("the witness key must be Ed25519 (openssl genpkey -algorithm ed25519 -out witness.pem)")
    pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(pub).decode("ascii")


def keygen(path):
    """A new Ed25519 witness key at path (PEM, mode 600, never overwrites). Returns the public key, base64."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    pub = k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(pub).decode("ascii")


class Recorder(_Base):
    """A ClientCallInterceptor that records every call. See the module docstring.

    witness_name   the name the record carries ("anonymous" is allowed)
    vantage        where the calls were made from; defaults to the SDK, Python and OS versions
    key            path to an Ed25519 PEM; with it every record is signed. Without it records are unsigned
    key_url        https URL under your own domain serving {"public_key_ed25519_b64": ...}; the domain then becomes
                   the witness's identity at the ledger. Needs key. Must not be the called agent's domain
    out_dir        where records are written (default ./nenrin-records)
    endpoint       the interface URL, when the card lists several and the client does not use the first JSON-RPC one
    auto_flush     write local records when the interpreter exits (default True; never submits)
    intake         the witness intake used by flush(submit=True)
    """

    def __init__(self, witness_name="anonymous", vantage=None, key=None, key_url=None, out_dir="nenrin-records",
                 endpoint=None, auto_flush=True, intake=DEFAULT_INTAKE, clock=time.time):
        self.witness_name = witness_name or "anonymous"
        self.vantage = vantage or default_vantage()
        self.key_path, self.key_url, self.out_dir = key, key_url, out_dir
        self.endpoint, self.intake, self.clock = endpoint, intake, clock
        if key_url and not key:
            raise ValueError("key_url binds a domain to a key; it needs key=")
        if key_url and not _host(key_url):
            raise ValueError("key_url must be an https URL under your own domain")
        self._key = load_key(key) if key else None
        self._lock = threading.Lock()
        self._buckets = {}      # endpoint -> {"salt", "card", "binding", "how", "calls": [entry]}
        self._calls = {}        # call id -> entry
        self.recording_errors = 0
        if auto_flush:
            atexit.register(self._flush_quietly)

    # --- the SDK hooks -------------------------------------------------------------------------------------------
    async def before(self, args):
        try:
            url, binding, how = endpoint_of(args.agent_card, self.endpoint)
            with self._lock:
                b = self._buckets.get(url)
                if b is None:
                    b = self._buckets[url] = {"salt": secrets.token_bytes(32), "calls": [], "binding": binding, "how": how,
                                              "card_name": getattr(args.agent_card, "name", None),
                                              "card_version": getattr(args.agent_card, "version", None), "cards": []}
                card_sha = sha256_hex(object_bytes(args.agent_card)[0])
                if card_sha not in b["cards"]:
                    b["cards"].append(card_sha)
                cid = secrets.token_hex(8)
                e = {"id": cid, "t": self.clock(), "method": args.method, "card_sha256": card_sha,
                     "request_sha256": salted_hash(b["salt"], [args.input]), "request_kind": object_bytes(args.input)[1],
                     "events": 0, "kinds": [], "task_state": None, "_h": hashlib.sha256(b["salt"]), "t_last": None}
                b["calls"].append(e)
                self._calls[cid] = e
            if args.context is None:
                from a2a.client.client import ClientCallContext
                args.context = ClientCallContext()
            args.context.state[STATE_KEY] = cid
        except Exception:
            self.recording_errors += 1

    async def after(self, args):
        try:
            cid = args.context.state.get(STATE_KEY) if args.context is not None else None
            with self._lock:
                e = self._calls.get(cid)
                if e is None:
                    self.recording_errors += 1
                    return
                e["_h"].update(object_bytes(args.result)[0] + b"\n")
                e["events"] += 1
                e["t_last"] = self.clock()
                kind, state = _result_info(args.result)
                if kind and kind not in e["kinds"]:
                    e["kinds"].append(kind)
                if state:
                    e["task_state"] = state
        except Exception:
            self.recording_errors += 1

    # --- records -------------------------------------------------------------------------------------------------
    def _state(self):
        p = os.path.join(self.out_dir, "state.json")
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_state(self, st):
        os.makedirs(self.out_dir, exist_ok=True)
        p = os.path.join(self.out_dir, "state.json")
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(st, f, indent=2, sort_keys=True)
        os.replace(p + ".tmp", p)

    def _take(self, now, final):
        """Move finished calls out of the buckets. A call with no result younger than GRACE_SECONDS stays, unless
        this is the final flush at exit."""
        out = {}
        with self._lock:
            for url, b in self._buckets.items():
                done, keep = [], []
                for e in b["calls"]:
                    (keep if (e["events"] == 0 and now - e["t"] < GRACE_SECONDS and not final) else done).append(e)
                if not done:
                    continue
                out[url] = dict(b, calls=done)
                for e in done:
                    self._calls.pop(e["id"], None)
                b["calls"] = keep
                b["salt"] = secrets.token_bytes(32) if not keep else b["salt"]
                b["cards"] = [done[-1]["card_sha256"]]
        return out

    def flush(self, submit=False, final=False):
        """Write one record per endpoint for the calls finished so far. Returns a list of results, one per record:
        {"endpoint", "sha256", "path", "private_path", "submitted": None | {"status", "body"} | {"skipped": why}}."""
        now = self.clock()
        taken = self._take(now, final)
        if not taken:
            return []
        st = self._state()
        results = []
        for url, b in taken.items():
            prev = (st.get(url) or {}).get("last_sha256")
            rec, private = build_record(url, b, self.witness_name, self.vantage, self.key_url, prev, now,
                                        signed=self._key is not None, recording_errors=self.recording_errors)
            rc = canonical(rec)
            payload = {"record_canonical": rc}
            if self._key:
                payload["signature_ed25519_b64"] = base64.b64encode(self._key[0].sign(rc.encode("utf-8"))).decode("ascii")
                payload["public_key_ed25519_b64"] = self._key[1]
            sha = sha256_hex(rc.encode("utf-8"))
            path = os.path.join(self.out_dir, "records", sha + ".json")
            ppath = os.path.join(self.out_dir, "private", sha + ".json")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            os.makedirs(os.path.dirname(ppath), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
            fd = os.open(ppath, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(private, ensure_ascii=False, indent=2) + "\n")
            ent = st.setdefault(url, {})
            ent["last_sha256"] = sha
            ent["records"] = int(ent.get("records", 0)) + 1
            res = {"endpoint": url, "sha256": sha, "path": path, "private_path": ppath, "submitted": None}
            if submit:
                day = rec["walked_at"][:10]
                why = submit_refusal(rec, payload)
                if why:
                    res["submitted"] = {"skipped": why}
                elif ent.get("filed_day") == day:
                    res["submitted"] = {"skipped": "already filed one record for this endpoint today; the ledger counts "
                                                   "one per witness per endpoint per UTC day. Kept local: " + path}
                else:
                    status, body = post(self.intake, payload)
                    res["submitted"] = {"status": status, "body": body}
                    if 200 <= status < 300:
                        ent["filed_day"] = day
            results.append(res)
        self._save_state(st)
        return results

    def _flush_quietly(self):
        try:
            self.flush(submit=False, final=True)
        except Exception:
            pass


def default_vantage():
    try:
        import importlib.metadata as md
        sdk = "a2a-sdk " + md.version("a2a-sdk")
    except Exception:
        sdk = "a2a-sdk (version unknown)"
    return "%s, Python %s, %s (the caller's own client; network not stated)" % (sdk, platform.python_version(), platform.system())


def _node(n, e, url, salt):
    answered = e["events"] > 0
    return {"n": n, "kind": "a2a_call", "at": utc_now(e["t"]), "a2a_method": e["method"],
            "request": {"url": url, "body_sha256": e["request_sha256"], "object": e["request_kind"]},
            "response": {"status": "result" if answered else "no_result",
                         "body_sha256": e["_h"].hexdigest() if answered else None,
                         "events": e["events"], "kinds": list(e["kinds"]), "task_state": e["task_state"],
                         "seconds": (round(e["t_last"] - e["t"], 3) if answered and e["t_last"] is not None else None)},
            "card_sha256": e["card_sha256"]}


def build_record(url, bucket, witness_name, vantage, key_url, prev_sha, now, signed, recording_errors=0):
    """The jidec-path-v1 record for one endpoint's finished calls, and the private sidecar (salt and full log)."""
    calls = sorted(bucket["calls"], key=lambda e: e["t"])
    salt = bucket["salt"]
    full = [_node(i, e, url, salt) for i, e in enumerate(calls)]
    unanswered = [x for x in full if x["response"]["status"] == "no_result"]
    answered = [x for x in full if x["response"]["status"] == "result"]
    log_sha = sha256_hex(canonical(full).encode("utf-8"))
    cards = sorted(set(x["card_sha256"] for x in full))

    def assemble(cap):
        listed = (unanswered + answered)[:cap]
        listed.sort(key=lambda x: x["n"])
        ok = len(unanswered) == 0
        est = ["that the witness recorded %d A2A call(s) to %s through the A2A Python SDK between %s and %s, and that "
               "%d of them returned a result" % (len(full), url, full[0]["at"], full[-1]["at"], len(answered)),
               "the salted sha256 of each listed request and response as the caller's SDK parsed them (recipe in "
               "content_hash); the witness keeps the salt and the full log, so the counterparty can match a call to "
               "its own logs if the witness reveals them",
               "that the full log of these %d calls has sha256 %s (calls.log_sha256, over the canonical JSON of every "
               "call node, listed or not)" % (len(full), log_sha)]
        if prev_sha:
            est.append("that this record follows the witness's previous record for this endpoint, " + prev_sha +
                       " (prev_path_refs); a dropped record shows as a break in the chain")
        dne = ["that any answer was correct, true or useful; only that answers with these hashes arrived",
               "that an unanswered call was the agent's fault: the caller's own network, timeout or cancellation "
               "looks the same from here",
               "that the agent treats other callers the same way",
               "the content of any request or response: only salted hashes leave the witness's machine",
               "that the calls are a fair sample: the witness recorded its own traffic and chooses which records to file",
               "that the card the client used is byte-identical to the card the agent serves: card_sha256 hashes the "
               "SDK's parsed card (canonical proto JSON), not the served bytes"]
        if bucket.get("how") and bucket["how"] != "given":
            dne.append("that the client called this interface: the recorder took " + bucket["how"] +
                       "; a client configured for another binding calls another URL")
        if not signed:
            dne.append("identity of the witness beyond the name given")
        elif not key_url:
            dne.append("identity of the witness beyond the key that signed this record (no key_url binds it to a domain)")
        if recording_errors:
            dne.append("that every call was recorded: the recorder counted %d recording error(s) in this process" % recording_errors)
        assertions = [
            {"claim": "every recorded call to %s returned a result through the A2A SDK" % url,
             "result": "pass" if ok else "fail", "nodes": [x["n"] for x in unanswered][:cap],
             "observed": "%d of %d answered" % (len(answered), len(full))},
            {"claim": "the agent card the client held was the same for every recorded call",
             "result": "pass" if len(cards) == 1 else "changed", "counts_toward_verdict": False,
             "observed": "%d distinct card hash(es)" % len(cards)},
        ]
        w = {"name": witness_name, "vantage": vantage}
        if key_url:
            w["key_url"] = key_url
        rec = {"schema": SCHEMA, "purpose": PURPOSE_PREFIX + url, "walked_at": utc_now(now), "walker": WALKER,
               "base": url, "mode": "full", "witness": w,
               "subject": {"card_name": bucket.get("card_name"), "card_version": bucket.get("card_version"),
                           "card_sha256": cards, "interface": {"url": url, "binding": bucket.get("binding"),
                                                               "chosen_by": bucket.get("how")}},
               "calls": {"total": len(full), "answered": len(answered), "unanswered": len(unanswered),
                         "listed": len(listed), "first_at": full[0]["at"], "last_at": full[-1]["at"],
                         "log_sha256": log_sha, "listing": "every unanswered call first, then answered calls, up to %d" % cap},
               "content_hash": {"recipe": HASH_RECIPE, "salted": True},
               "nodes": listed, "assertions": assertions,
               "verdict": {"ok": ok, "outcome": "PASS" if ok else "FAIL", "n_pass": len(answered), "n_total": len(full)},
               "replay": {"how": "ask the witness for the private file; recompute calls.log_sha256 from its nodes, and "
                                 "each body_sha256 from the salt and your own copy of the request or response",
                          "match_means": "the request or response you hold is the one the witness recorded",
                          "mismatch_means": "the bytes differ from what the witness's SDK parsed; compare canonical proto JSON"},
               "prev_path_refs": [prev_sha] if prev_sha else [],
               "establishes": est, "does_not_establish": dne}
        return rec

    cap = MAX_NODES
    rec = assemble(cap)
    while len(canonical(rec).encode("utf-8")) > MAX_RECORD_BYTES and cap > 1:
        cap = max(1, cap // 2)
        rec = assemble(cap)
    private = {"schema": "nenrin-a2a-call-log-v1", "endpoint": url, "salt_hex": salt.hex(), "nodes": full,
               "log_sha256": log_sha, "note": "keep this file private; showing it reveals the salt for these calls only"}
    return rec, private


def submit_refusal(rec, payload):
    """Why the intake would refuse or not index this record, checked locally before any network call."""
    if not _host(rec.get("base", "")):
        return "the endpoint is not https; the ledger resume indexes https endpoints only"
    kurl = (rec.get("witness") or {}).get("key_url")
    if kurl:
        if "signature_ed25519_b64" not in payload:
            return "key_url without a signature binds nothing"
        if _host(kurl) == _host(rec["base"]):
            return "self_witness: the key_url is on the called agent's own domain"
    if len(payload["record_canonical"].encode("utf-8")) > 65536:
        return "record larger than the intake's 65536 bytes"
    return None


def post(intake, payload, timeout=20):
    import urllib.request
    import urllib.error
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(intake, data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json",
        "User-Agent": "nenrin-verify-a2a-recorder/" + RECORDER_VERSION})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:
        return 0, {"error": str(e)}
    try:
        return status, json.loads(raw.decode("utf-8"))
    except Exception:
        return status, {"raw": raw.decode("utf-8", "replace")[:400]}


def verify_payload(payload, private=None):
    """Recompute a record file offline. Returns {"ok", "problems", "signed", "summary"}. With the private file, also
    recomputes calls.log_sha256 and checks every listed node against the full log."""
    problems = []
    rc = payload.get("record_canonical") if isinstance(payload, dict) else None
    if not isinstance(rc, str):
        return {"ok": False, "problems": ["record_canonical (string) missing"], "signed": False, "summary": None}
    try:
        rec = json.loads(rc)
    except Exception:
        return {"ok": False, "problems": ["record_canonical is not JSON"], "signed": False, "summary": None}
    if canonical(rec) != rc:
        problems.append("record_canonical is not in canonical form (sorted keys, no whitespace)")
    if rec.get("schema") != SCHEMA or not str(rec.get("purpose", "")).startswith(PURPOSE_PREFIX):
        problems.append("not an a2a-call-record-v1 jidec-path-v1 record")
    w = rec.get("witness") or {}
    if not (isinstance(w.get("name"), str) and w["name"] and isinstance(w.get("vantage"), str) and w["vantage"]):
        problems.append("witness {name, vantage} missing")
    for k in ("establishes", "does_not_establish"):
        v = rec.get(k)
        if not (isinstance(v, list) and v and all(isinstance(s, str) and s.strip() for s in v)):
            problems.append(k + " must be a non-empty list of strings")
    signed = False
    sig, pub = payload.get("signature_ed25519_b64"), payload.get("public_key_ed25519_b64")
    if sig or pub:
        from .provenance import b64_exact, ed25519_key_ok
        pk, sb = b64_exact(pub, 32), b64_exact(sig, 64)
        if pk is None or sb is None:
            problems.append("signature_ed25519_b64 and public_key_ed25519_b64 must be canonical standard base64 "
                            "(a 64-byte signature and a 32-byte key)")
        elif not ed25519_key_ok(pk):
            problems.append("public_key_ed25519_b64 is not a usable Ed25519 key (it must be the canonical encoding "
                            "of a point in the prime-order subgroup)")
        else:
            try:
                from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
                Ed25519PublicKey.from_public_bytes(pk).verify(sb, rc.encode("utf-8"))
                signed = True
            except Exception:
                problems.append("signature does not verify over record_canonical")
    if w.get("key_url") and not signed:
        problems.append("key_url on an unsigned record")
    c, v, nodes = rec.get("calls") or {}, rec.get("verdict") or {}, rec.get("nodes") or []
    if v.get("n_pass") != c.get("answered") or v.get("n_total") != c.get("total"):
        problems.append("verdict counts differ from calls counts")
    if bool(v.get("ok")) != (v.get("outcome") == "PASS") or (v.get("outcome") == "PASS") != (c.get("unanswered") == 0):
        problems.append("verdict ok/outcome disagree with each other or with calls.unanswered")
    if c.get("answered", 0) + c.get("unanswered", 0) != c.get("total"):
        problems.append("calls.answered + calls.unanswered != calls.total")
    listed_unanswered = sum(1 for x in nodes if (x.get("response") or {}).get("status") == "no_result")
    if listed_unanswered != min(c.get("unanswered", 0), len(nodes)):
        problems.append("the listing must show every unanswered call first (up to the node cap)")
    if private is not None:
        full = private.get("nodes") or []
        if sha256_hex(canonical(full).encode("utf-8")) != c.get("log_sha256"):
            problems.append("the private log does not recompute to calls.log_sha256")
        byn = {x.get("n"): x for x in full}
        if any(canonical(byn.get(x.get("n"))) != canonical(x) for x in nodes):
            problems.append("a listed node differs from the private log")
        if len(full) != c.get("total"):
            problems.append("the private log has a different number of calls than calls.total")
    summary = {"endpoint": rec.get("base"), "witness": w.get("name"), "key_url": w.get("key_url"),
               "walked_at": rec.get("walked_at"), "outcome": v.get("outcome"),
               "answered": "%s/%s" % (c.get("answered"), c.get("total")), "prev": rec.get("prev_path_refs"),
               "sha256": sha256_hex(rc.encode("utf-8"))}
    return {"ok": not problems, "problems": problems, "signed": signed, "summary": summary}


def matches(private, n, obj, which="request"):
    """Does obj (the request or response you hold) hash to call n in the witness's private log? For a response, pass
    the list of every event the call returned, in order."""
    salt = bytes.fromhex(private["salt_hex"])
    node = next((x for x in private["nodes"] if x["n"] == n), None)
    if node is None:
        return False
    objs = obj if (which == "response" and isinstance(obj, list)) else [obj]
    return salted_hash(salt, objs) == node[which]["body_sha256"]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="nenrin-a2a-record", description="A2A call records: keygen, verify, show, submit.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keygen", help="a new Ed25519 witness key (PEM, mode 600, never overwrites)")
    k.add_argument("path")
    v = sub.add_parser("verify", help="recompute a record file offline")
    v.add_argument("record")
    v.add_argument("--private", help="the private log, to recompute calls.log_sha256")
    s = sub.add_parser("show", help="list the records in a directory")
    s.add_argument("dir", nargs="?", default="nenrin-records")
    u = sub.add_parser("submit", help="file one record at the witness intake (the only command that uses the network)")
    u.add_argument("record")
    u.add_argument("--intake", default=DEFAULT_INTAKE)
    a = ap.parse_args(argv)
    if a.cmd == "keygen":
        print(json.dumps({"private_key_file": a.path, "public_key_ed25519_b64": keygen(a.path),
                          "key_url_body": "serve {\"public_key_ed25519_b64\": \"<the key above>\"} at an https URL "
                                          "under your own domain and pass it as key_url"}, indent=2))
        return 0
    if a.cmd == "verify":
        payload = json.load(open(a.record, encoding="utf-8"))
        priv = json.load(open(a.private, encoding="utf-8")) if a.private else None
        r = verify_payload(payload, priv)
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0 if r["ok"] else 1
    if a.cmd == "show":
        d = os.path.join(a.dir, "records")
        rows = []
        for fn in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            r = verify_payload(json.load(open(os.path.join(d, fn), encoding="utf-8")))
            rows.append(dict(r["summary"] or {}, ok=r["ok"], signed=r["signed"]))
        rows.sort(key=lambda x: x.get("walked_at") or "")
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0
    if a.cmd == "submit":
        payload = json.load(open(a.record, encoding="utf-8"))
        r = verify_payload(payload)
        if not r["ok"]:
            print(json.dumps(r, indent=2, ensure_ascii=False))
            return 1
        why = submit_refusal(json.loads(payload["record_canonical"]), payload)
        if why:
            print(json.dumps({"skipped": why}, indent=2))
            return 1
        status, body = post(a.intake, payload)
        print(json.dumps({"status": status, "body": body}, indent=2, ensure_ascii=False))
        return 0 if 200 <= status < 300 else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
