"""a2a_recorder: the interceptor records what came back, writes one signed record per endpoint, and every record
recomputes offline. The unit tests run anywhere; the live tests run the official A2A Python SDK (client and server on
127.0.0.1) and are skipped where a2a-sdk is not installed (it needs Python 3.10+)."""
import asyncio
import base64
import json
import os
import socket
import uuid

import pytest

from nenrin_verify import a2a_recorder as ar


class _Ctx:
    def __init__(self):
        self.state = {}


class _Args:
    def __init__(self, method, inp=None, result=None, card=None, context=None):
        self.method, self.input, self.result, self.context = method, inp, result, context
        self.agent_card = card
        self.early_return = None


class _Iface:
    def __init__(self, url, binding):
        self.url, self.protocol_binding = url, binding


class _Card:
    name, version = "test agent", "1"

    def __init__(self, url="https://agent.example/a2a"):
        self.supported_interfaces = [_Iface("https://agent.example/grpc", "GRPC"), _Iface(url, "JSONRPC")]


def _run(coro):
    return asyncio.run(coro)


def _record(tmp_path, n_ok=3, n_dead=1, key=True, key_url=None):
    kp = str(tmp_path / "w.pem")
    if key:
        ar.keygen(kp)
    rec = ar.Recorder(witness_name="tester", vantage="unit test", key=kp if key else None, key_url=key_url,
                      out_dir=str(tmp_path / "out"), auto_flush=False)
    card = _Card()

    async def go():
        for i in range(n_ok):
            a = _Args("send_message", {"text": "hello %d" % i}, card=card, context=_Ctx())
            await rec.before(a)
            await rec.after(_Args("send_message", result={"task": {"id": "t%d" % i}}, card=card, context=a.context))
        for i in range(n_dead):
            await rec.before(_Args("get_task", {"id": "x%d" % i}, card=card, context=_Ctx()))
    _run(go())
    return rec


def test_keygen_never_overwrites(tmp_path):
    p = str(tmp_path / "k.pem")
    ar.keygen(p)
    assert oct(os.stat(p).st_mode & 0o777) == "0o600"
    with pytest.raises(FileExistsError):
        ar.keygen(p)


def test_in_flight_calls_wait_for_the_next_flush(tmp_path):
    rec = _record(tmp_path)
    out = rec.flush()
    assert len(out) == 1
    r = ar.verify_payload(json.load(open(out[0]["path"])))
    assert r["ok"] and r["signed"], r
    assert r["summary"]["outcome"] == "PASS" and r["summary"]["answered"] == "3/3"
    out2 = rec.flush(final=True)
    r2 = ar.verify_payload(json.load(open(out2[0]["path"])), json.load(open(out2[0]["private_path"])))
    assert r2["ok"] and r2["summary"]["outcome"] == "FAIL" and r2["summary"]["answered"] == "0/1", r2
    assert r2["summary"]["prev"] == [out[0]["sha256"]]
    assert oct(os.stat(out2[0]["private_path"]).st_mode & 0o777) == "0o600"


def test_record_shape_is_what_the_intake_and_resume_read(tmp_path):
    rec = _record(tmp_path)
    p = rec.flush(final=True)[0]
    payload = json.load(open(p["path"]))
    r = json.loads(payload["record_canonical"])
    assert r["schema"] == "jidec-path-v1" and r["mode"] == "full" and r["base"] == "https://agent.example/a2a"
    assert r["purpose"] == "a2a-call-record-v1: https://agent.example/a2a"
    assert r["witness"] == {"name": "tester", "vantage": "unit test"}
    assert r["verdict"] == {"ok": False, "outcome": "FAIL", "n_pass": 3, "n_total": 4}
    assert r["nodes"] and r["assertions"] and r["establishes"] and r["does_not_establish"]
    assert ar.canonical(r) == payload["record_canonical"]
    import re
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", r["walked_at"])
    bad = {"score", "rating", "stars", "points", "rank", "grade", "trust_score"}

    def keys(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from keys(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys(v)
    assert not bad & {k.lower() for k in keys(r)}
    assert "hello" not in payload["record_canonical"]


def test_tampering_is_caught(tmp_path):
    rec = _record(tmp_path)
    p = rec.flush(final=True)[0]
    payload = json.load(open(p["path"]))
    priv = json.load(open(p["private_path"]))
    r = json.loads(payload["record_canonical"])
    r["verdict"] = {"ok": True, "outcome": "PASS", "n_pass": 4, "n_total": 4}
    forged = dict(payload, record_canonical=ar.canonical(r))
    v = ar.verify_payload(forged)
    assert not v["ok"] and any("signature" in x for x in v["problems"]) and any("verdict" in x for x in v["problems"])
    priv2 = dict(priv, nodes=priv["nodes"][:-1])
    assert not ar.verify_payload(payload, priv2)["ok"]


def test_salted_hash_matches_only_with_the_salt(tmp_path):
    rec = _record(tmp_path, n_dead=0)
    p = rec.flush()[0]
    priv = json.load(open(p["private_path"]))
    assert ar.matches(priv, 1, {"text": "hello 1"}, "request")
    assert not ar.matches(priv, 1, {"text": "hello 2"}, "request")
    assert ar.matches(priv, 1, [{"task": {"id": "t1"}}], "response")
    wrong = dict(priv, salt_hex="00" * 32)
    assert not ar.matches(wrong, 1, {"text": "hello 1"}, "request")


def test_submit_is_refused_locally_where_the_ledger_would_refuse(tmp_path):
    r = {"base": "http://127.0.0.1:9/", "witness": {}}
    assert "https" in ar.submit_refusal(r, {"record_canonical": "{}"})
    r = {"base": "https://agent.example/a2a", "witness": {"key_url": "https://agent.example/k.json"}}
    assert "self_witness" in ar.submit_refusal(r, {"record_canonical": "{}", "signature_ed25519_b64": "x"})
    with pytest.raises(ValueError):
        ar.Recorder(key_url="https://me.example/k.json", auto_flush=False)


def test_unsigned_and_key_url_disclaimers(tmp_path):
    rec = _record(tmp_path, key=False, n_dead=0)
    r = json.loads(json.load(open(rec.flush()[0]["path"]))["record_canonical"])
    assert any("beyond the name given" in s for s in r["does_not_establish"])


def test_one_filing_per_endpoint_per_day(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(ar, "post", lambda intake, payload: (calls.append(payload) or (202, {"status": "pending"})))
    rec = _record(tmp_path, n_dead=0)
    a = rec.flush(submit=True)[0]["submitted"]
    _run(rec.before(_Args("get_task", {"id": "z"}, card=_Card(), context=_Ctx())))
    b = rec.flush(submit=True, final=True)[0]["submitted"]
    assert a == {"status": 202, "body": {"status": "pending"}} and "already filed" in b["skipped"] and len(calls) == 1


def test_recorder_never_raises_into_the_call(tmp_path):
    rec = ar.Recorder(out_dir=str(tmp_path / "o"), auto_flush=False)
    _run(rec.after(_Args("send_message", result=object(), card=_Card(), context=None)))
    assert rec.recording_errors == 1


# --- live: the official SDK, client and server -------------------------------------------------------------------

def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def test_live_official_sdk(tmp_path):
    pytest.importorskip("a2a.client")
    uvicorn = pytest.importorskip("uvicorn")
    httpx = pytest.importorskip("httpx")
    from starlette.applications import Starlette
    from a2a.client import ClientConfig, ClientFactory
    from a2a.client.card_resolver import parse_agent_card
    from a2a.server.agent_execution import AgentExecutor
    from a2a.server.request_handlers import DefaultRequestHandler
    from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
    from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
    from a2a.helpers.proto_helpers import new_task_from_user_message
    from a2a.types import (AgentCapabilities, AgentCard, AgentInterface, AgentSkill, GetTaskRequest, Message, Part,
                           Role, SendMessageRequest)

    class Echo(AgentExecutor):
        async def execute(self, context, event_queue):
            msg = context.message
            task = context.current_task or new_task_from_user_message(msg)
            if context.current_task is None:
                await event_queue.enqueue_event(task)
            up = TaskUpdater(event_queue, task.id, task.context_id)
            await up.start_work()
            await up.add_artifact(parts=[Part(text="echo: " + "".join(p.text for p in msg.parts))], name="echo")
            await up.complete()

        async def cancel(self, context, event_queue):
            raise NotImplementedError

    kp = str(tmp_path / "w.pem")
    ar.keygen(kp)

    async def go():
        port = _free_port()
        base = "http://127.0.0.1:%d/" % port
        card = AgentCard(name="echo", description="echo", version="0.1.0",
                         supported_interfaces=[AgentInterface(url=base, protocol_binding="JSONRPC", protocol_version="1.0")],
                         capabilities=AgentCapabilities(streaming=True), default_input_modes=["text/plain"],
                         default_output_modes=["text/plain"], skills=[AgentSkill(id="echo", name="echo", description="echo", tags=["t"])])
        handler = DefaultRequestHandler(agent_executor=Echo(), task_store=InMemoryTaskStore(), agent_card=card)
        server = uvicorn.Server(uvicorn.Config(Starlette(routes=create_agent_card_routes(card) + create_jsonrpc_routes(handler, "/")),
                                               host="127.0.0.1", port=port, log_level="warning"))
        serving = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.05)
        rec = ar.Recorder(witness_name="live", vantage="127.0.0.1 test", key=kp, out_dir=str(tmp_path / "out"), auto_flush=False)
        sent, got = [], []
        try:
            async with httpx.AsyncClient(timeout=30) as hc:
                c = parse_agent_card((await hc.get(base + ".well-known/agent-card.json")).json())
                for streaming in (False, True):
                    client = ClientFactory(ClientConfig(httpx_client=hc, streaming=streaming)).create(c, interceptors=[rec])
                    req = SendMessageRequest(message=Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER,
                                                             parts=[Part(text="secret %s" % streaming)]))
                    events = [ev async for ev in client.send_message(req)]
                    sent.append(req)
                    got.append(events)
                    tid = next(e.task.id for e in events if e.HasField("task"))
                    await client.get_task(GetTaskRequest(id=tid))
                dead = AgentCard()
                dead.CopyFrom(c)
                dead.supported_interfaces[0].url = "http://127.0.0.1:%d/" % _free_port()
                dclient = ClientFactory(ClientConfig(httpx_client=hc, streaming=False)).create(dead, interceptors=[rec])
                with pytest.raises(Exception):
                    await dclient.get_task(GetTaskRequest(id="nope"))
        finally:
            server.should_exit = True
            await serving
        return rec, base, sent, got

    rec, base, sent, got = _run(go())
    out = {o["endpoint"]: o for o in rec.flush(final=True)}
    live = out[base]
    payload = json.load(open(live["path"]))
    priv = json.load(open(live["private_path"]))
    v = ar.verify_payload(payload, priv)
    assert v["ok"] and v["signed"] and v["summary"]["outcome"] == "PASS" and v["summary"]["answered"] == "4/4", v
    r = json.loads(payload["record_canonical"])
    assert [n["a2a_method"] for n in r["nodes"]] == ["send_message", "get_task", "send_message_streaming", "get_task"]
    assert r["nodes"][2]["response"]["events"] >= 2 and r["nodes"][0]["response"]["task_state"] == "TASK_STATE_COMPLETED"
    assert "secret" not in payload["record_canonical"] and "echo:" not in payload["record_canonical"]
    assert ar.matches(priv, 0, sent[0], "request") and ar.matches(priv, 2, sent[1], "request")
    assert ar.matches(priv, 0, got[0], "response")
    dead = [o for e, o in out.items() if e != base][0]
    dv = ar.verify_payload(json.load(open(dead["path"])))
    assert dv["ok"] and dv["summary"]["outcome"] == "FAIL" and dv["summary"]["answered"] == "0/1"


def test_noncanonical_base64_is_refused(tmp_path):
    """0.4.2: the signature and key must be canonical standard base64; a lenient spelling of a valid signature is refused."""
    rec = _record(tmp_path)
    p = rec.flush(final=True)[0]
    payload = json.load(open(p["path"]))
    assert ar.verify_payload(payload)["ok"]
    sig, pub = payload["signature_ed25519_b64"], payload["public_key_ed25519_b64"]
    for field, v in (("signature_ed25519_b64", sig.rstrip("=")), ("signature_ed25519_b64", sig[:10] + " " + sig[10:]),
                     ("signature_ed25519_b64", sig + "\n"), ("public_key_ed25519_b64", pub.rstrip("=")),
                     ("public_key_ed25519_b64", pub.replace("+", "-").replace("/", "_") if ("+" in pub or "/" in pub) else pub + "\n")):
        v2 = ar.verify_payload(dict(payload, **{field: v}))
        assert not v2["ok"] and any("canonical standard base64" in x for x in v2["problems"]), (field, v, v2["problems"])
