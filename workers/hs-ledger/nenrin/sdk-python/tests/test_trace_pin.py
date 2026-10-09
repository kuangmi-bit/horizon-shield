"""nenrin_verify.trace_pin with a stand-in transport: no network. The records are the ones TRACE's own library signed
(agentrust-trace 0.11.0, workers/hs-ledger/nenrin/trace-pin-v0/fixtures); the expected sha and thumbprint come from
that library, not from this package. The JavaScript twin (sdk/trace_pin_cli.test.mjs) runs against the ledger module
itself."""
import copy
import hashlib
import json
import os

import pytest

from nenrin_verify import trace_pin
from nenrin_verify._js import loads
from nenrin_verify.trace import jcs

HERE = os.path.dirname(os.path.abspath(__file__))
FX_PATH = os.path.join(HERE, "..", "..", "trace-pin-v0", "fixtures", "trace_fixtures.json")
ORIGIN = "https://ledger.example"

pytestmark = pytest.mark.skipif(not os.path.exists(FX_PATH), reason="needs the repository checkout (trace-pin-v0 fixtures)")


def _fx():
    with open(FX_PATH, "rb") as f:
        return loads(f.read())


class FakeLedger:
    """Answers like the ledger: sha256 of the RFC 8785 form, 201 then dedup, raw bytes under ?format=raw."""

    def __init__(self, tamper_raw=False):
        self.calls = []
        self.store = {}
        self.tamper_raw = tamper_raw

    def __call__(self, method, url, body=None):
        self.calls.append((method, url))
        path = url[len(ORIGIN):]
        if method == "POST" and path == "/evidence/trace":
            rec = loads(body)["record"]
            raw = jcs(rec).encode("utf-8")
            sha = hashlib.sha256(raw).hexdigest()
            dedup = sha in self.store
            self.store[sha] = raw
            return (200 if dedup else 201), json.dumps({"sha": sha, "status": "pending", "dedup": dedup or None,
                                                        "url": ORIGIN + "/evidence/trace/" + sha}).encode()
        if method == "GET" and path.startswith("/evidence/trace/"):
            rest = path[len("/evidence/trace/"):]
            sha, raw_q = (rest[:-len("?format=raw")], True) if rest.endswith("?format=raw") else (rest, False)
            if sha not in self.store:
                return 404, b'{"error":"not_found"}'
            if raw_q:
                b = self.store[sha]
                return 200, (b.replace(b"}", b',"x":1}', 1) if self.tamper_raw else b)
            return 200, json.dumps({"sha": sha, "status": "pending", "anchor": None}).encode()
        return 404, b"{}"


def test_dry_run_sends_nothing_and_matches_trace_library():
    fx = _fx()
    led = FakeLedger()
    r = trace_pin.pin_record(copy.deepcopy(fx["valid"]["record"]), ledger=ORIGIN, now=fx["_about"]["iat"] + 60, fetch=led)
    assert r["ok"] and r["stage"] == "dry_run" and not r["sent"] and led.calls == []
    assert r["sha"] == fx["valid"]["jcs_sha256"]
    assert r["key_thumbprint"] == fx["valid"]["thumbprint"]
    assert "cannot be withdrawn" in r["notice"]


def test_refused_locally_never_sent():
    fx = _fx()
    led = FakeLedger()
    bad = copy.deepcopy(fx["valid"]["record"])
    bad["subject"] = "spiffe://example.org/agent/someone-else"
    r = trace_pin.pin_record(bad, ledger=ORIGIN, send=True, now=fx["_about"]["iat"] + 60, fetch=led)
    assert not r["ok"] and r["stage"] == "local_intake" and r["refused"] == "signature_invalid" and led.calls == []


def test_pin_then_status_then_dedup():
    fx = _fx()
    led = FakeLedger()
    now = fx["_about"]["iat"] + 60
    r = trace_pin.pin_record(copy.deepcopy(fx["nonascii"]["record"]), ledger=ORIGIN, send=True, now=now, fetch=led)
    assert r["ok"] and r["stage"] == "pinned" and r["sha"] == fx["nonascii"]["jcs_sha256"]
    assert led.calls == [("POST", ORIGIN + "/evidence/trace")]
    assert r["check_later"].endswith("--ledger " + ORIGIN)
    again = trace_pin.pin_record(copy.deepcopy(fx["nonascii"]["record"]), ledger=ORIGIN, send=True, now=now, fetch=led)
    assert again["ok"] and again["dedup"] and again["sha"] == r["sha"]
    s = trace_pin.pin_status(r["sha"], ledger=ORIGIN, fetch=led)
    assert s["ok"] and s["found"] and s["bytes_match"] and s["status"] == "pending"
    assert not trace_pin.pin_status("0" * 64, ledger=ORIGIN, fetch=led)["found"]


def test_altered_bytes_are_caught():
    fx = _fx()
    led = FakeLedger(tamper_raw=True)
    r = trace_pin.pin_record(copy.deepcopy(fx["valid"]["record"]), ledger=ORIGIN, send=True,
                             now=fx["_about"]["iat"] + 60, fetch=led)
    s = trace_pin.pin_status(r["sha"], ledger=ORIGIN, fetch=led)
    assert not s["ok"] and s["bytes_match"] is False


def test_receipt_for_other_bytes_and_refusal():
    fx = _fx()
    rec = fx["valid"]["record"]
    now = fx["_about"]["iat"] + 60
    other = trace_pin.pin_record(copy.deepcopy(rec), ledger=ORIGIN, send=True, now=now,
                                 fetch=lambda *a: (201, json.dumps({"sha": "a" * 64, "status": "pending"}).encode()))
    assert not other["ok"] and other["stage"] == "receipt"
    refused = trace_pin.pin_record(copy.deepcopy(rec), ledger=ORIGIN, send=True, now=now,
                                   fetch=lambda *a: (422, b'{"error":"refused","reason_code":"iat_in_future"}'))
    assert not refused["ok"] and refused["http"] == 422 and refused["refused"] == "iat_in_future"


def test_ledger_must_be_https_except_localhost():
    fx = _fx()
    with pytest.raises(ValueError):
        trace_pin.pin_record(fx["valid"]["record"], ledger="http://ledger.example", now=fx["_about"]["iat"] + 60)
    r = trace_pin.pin_record(fx["valid"]["record"], ledger="http://127.0.0.1:8787", now=fx["_about"]["iat"] + 60)
    assert r["ok"] and r["ledger"] == "http://127.0.0.1:8787"
