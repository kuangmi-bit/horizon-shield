#!/usr/bin/env python3
"""a2a-python-e2e-v0: one A2A task, run with the official A2A Python SDK, turned into NENRIN evidence, and
recomputed offline by two verifiers (Python nenrin-verify and JavaScript nenrin_verify.mjs) that must agree.

    python e2e.py            run both cases live on 127.0.0.1 (output in a temp dir), verify, compare with fixtures/expected.json
    python e2e.py --freeze   run live and write fixtures/ and fixtures/expected.json
    python e2e.py --check    verify the committed fixtures only (no server, no network)

Roles, each with its own Ed25519 did:key (derived from a public phrase, see nenrin_records.py):
  caller    signs a grant (what it authorizes: this skill, this input, this provider, this window) and sends it in
            the A2A message metadata through the SDK client (ClientFactory, JSON-RPC, A2A 1.0).
  provider  an A2A server built from the SDK (DefaultRequestHandler, InMemoryTaskStore, JSON-RPC routes). Before it
            acts it checks the grant names it, recomputes and carries the caller's signature, and that the input it
            received is the input the caller authorized. It signs an intent, does the work (skill sha256-of-text:
            the artifact is the sha256 of the input text), and signs a receipt pointing at the artifact.
  witness   a third party with its own SDK client. It fetches the task with GetTask, recomputes the skill from the
            task history, compares the artifact and the receipt, and signs one observation of the hop
            caller -> provider: pass, or fail if anything differs. The caller signs the edge.

Cases:
  honest          the provider's receipt points at what it served.
  lying_provider  the provider serves the right artifact but signs a receipt claiming another result.

The bundle carries no HORIZON SHIELD endpoint and needs none: did:key resolves offline, and the evidence lookup
reads the transcript (the GetTask response the witness saw), so anyone can re-run the check from the files.
"""
import asyncio
import datetime
import hashlib
import json
import os
import socket
import subprocess
import sys
import uuid

import httpx
import uvicorn
from google.protobuf.json_format import MessageToDict
from starlette.applications import Starlette

from a2a.client import ClientConfig, ClientFactory
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.helpers.proto_helpers import new_task_from_user_message
from a2a.types import (AgentCapabilities, AgentCard, AgentInterface, AgentSkill, GetTaskRequest, Message, Part,
                       Role, SendMessageRequest)

import nenrin_records as nr

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")
NS = "https://horizonshield.dev/nenrin/a2a-python-e2e-v0/"
SKILL = "sha256-of-text"
CASES = ["honest", "lying_provider"]

CALLER, PROVIDER, WITNESS = nr.Agent("caller"), nr.Agent("provider"), nr.Agent("witness")


def now(offset_s=0):
    t = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0) + datetime.timedelta(seconds=offset_s)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def args_sha256(text):
    return nr.sha256hex(nr.canonical({"text": text}))


def struct_to_dict(s):
    return MessageToDict(s) if s is not None and len(s.fields) else {}


class Provider(AgentExecutor):
    def __init__(self, base, lie):
        self.base, self.lie = base, lie

    async def execute(self, context: RequestContext, event_queue):
        msg = context.message
        text = "".join(p.text for p in msg.parts if p.HasField("text"))
        task = context.current_task or new_task_from_user_message(msg)
        if context.current_task is None:
            await event_queue.enqueue_event(task)
        up = TaskUpdater(event_queue, task.id, task.context_id)
        grant = struct_to_dict(msg.metadata).get(NS + "grant")
        why = nr.verify_grant(grant, PROVIDER.did) if isinstance(grant, dict) else "no_grant"
        if why is None and grant["action"]["args_sha256"] != args_sha256(text):
            why = "input_is_not_what_the_caller_authorized"
        if why is None and grant["action"]["target"] != self.base + "#skill=" + SKILL:
            why = "grant_targets_another_skill"
        if why:
            await up.failed(message=up.new_agent_message(parts=[Part(text="refused: " + why)]))
            return
        intent = nr.make_intent(PROVIDER, grant, now())
        await up.start_work()
        result = hashlib.sha256(text.encode("utf-8")).hexdigest()   # the work: anyone can recompute it
        claimed = hashlib.sha256(b"a result the provider never served").hexdigest() if self.lie else result
        evidence = {"kind": "document_sha256", "ref": nr.sha256hex(claimed),
                    "system": "a2a GetTask " + self.base + " task " + task.id + " artifact " + SKILL + " (sha256 of the artifact text)"}
        receipt = nr.make_receipt(PROVIDER, grant, grant["action"], "completed", nr.sha256hex(claimed), evidence, now())
        await up.add_artifact(parts=[Part(text=result)], name=SKILL,
                              metadata={NS + "intent": intent, NS + "receipt": receipt})
        await up.complete()

    async def cancel(self, context, event_queue):
        raise NotImplementedError


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def make_app(base, lie):
    card = AgentCard(
        name="nenrin e2e provider", description="Returns the sha256 of the text it is given, with signed NENRIN records.",
        version="0.1.0",
        supported_interfaces=[AgentInterface(url=base, protocol_binding="JSONRPC", protocol_version="1.0")],
        capabilities=AgentCapabilities(streaming=False), default_input_modes=["text/plain"], default_output_modes=["text/plain"],
        skills=[AgentSkill(id=SKILL, name="sha256 of text", description="sha256 hex of the UTF-8 input text", tags=["nenrin", "test"])])
    handler = DefaultRequestHandler(agent_executor=Provider(base, lie), task_store=InMemoryTaskStore(), agent_card=card)
    return Starlette(routes=create_agent_card_routes(card) + create_jsonrpc_routes(handler, "/"))


async def first_task(stream):
    task = None
    async for ev in stream:
        obj = ev[0] if isinstance(ev, tuple) else ev
        t = getattr(obj, "task", None) if hasattr(obj, "HasField") and obj.HasField("task") else None
        if t is not None and t.id:
            task = t
    return task


async def run_case(case):
    port = free_port()
    base = "http://127.0.0.1:%d/" % port
    server = uvicorn.Server(uvicorn.Config(make_app(base, case == "lying_provider"), host="127.0.0.1", port=port, log_level="warning"))
    serving = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    try:
        text = "a2a-python-e2e-v0 " + case + " " + uuid.uuid4().hex
        context_id = str(uuid.uuid4())
        task_id = "a2a-context:" + context_id
        async with httpx.AsyncClient(timeout=30) as hc:
            card_json = (await hc.get(base + ".well-known/agent-card.json")).json()
            from a2a.client.card_resolver import parse_agent_card
            card = parse_agent_card(card_json)
            factory = ClientFactory(ClientConfig(httpx_client=hc, streaming=False))

            # caller
            action = {"tool": "a2a.SendMessage", "target": base + "#skill=" + SKILL, "args_sha256": args_sha256(text)}
            grant = nr.make_grant(CALLER, PROVIDER.did, task_id, action, uuid.uuid4().hex, now(-60), now(600))
            msg = Message(message_id=str(uuid.uuid4()), context_id=context_id, role=Role.ROLE_USER, parts=[Part(text=text)])
            msg.metadata.update({NS + "grant": grant})
            caller_client = factory.create(card)
            task = await first_task(caller_client.send_message(SendMessageRequest(message=msg)))
            assert task is not None, "the SDK returned no task"

            # witness: its own client, GetTask, recompute
            witness_client = ClientFactory(ClientConfig(httpx_client=hc, streaming=False)).create(card)
            got = await witness_client.get_task(GetTaskRequest(id=task.id))
            seen = MessageToDict(got)
            inputs = ["".join(p.text for p in m.parts if p.HasField("text")) for m in got.history if m.role == Role.ROLE_USER]
            art = got.artifacts[0]
            served = "".join(p.text for p in art.parts if p.HasField("text"))
            meta = struct_to_dict(art.metadata)
            receipt, intent = meta[NS + "receipt"], meta[NS + "intent"]
            checks = {
                "skill_recomputes": bool(inputs) and served == hashlib.sha256(inputs[0].encode()).hexdigest(),
                "receipt_result_is_served": receipt["outcome"]["result_sha256"] == nr.sha256hex(served),
                "receipt_evidence_is_served": receipt["outcome"]["evidence"]["ref"] == nr.sha256hex(served),
                "same_task": receipt["task_id"] == task_id and intent["task_id"] == task_id,
            }
            verdict = "pass" if all(checks.values()) else "fail"
            obs = nr.make_observation(WITNESS, CALLER, task_id, 0, PROVIDER.did, None, verdict,
                                      "nenrin-exec://" + receipt["receipt_id"], now())
        bundle = {"task_id": task_id, "observations": [obs], "grant": grant, "intent": intent, "receipt": receipt}
        transcript = {"note": "the GetTask response the witness fetched through the official A2A Python SDK, as proto JSON",
                      "a2a_sdk": "a2a-sdk " + __import__("importlib.metadata").metadata.version("a2a-sdk"),
                      "server": base, "witness_checks": checks, "task": seen}
        return bundle, transcript
    finally:
        server.should_exit = True
        await serving


async def run_refusals():
    """The provider must refuse before it acts: no grant, a grant for other input, a grant not signed by its caller."""
    port = free_port()
    base = "http://127.0.0.1:%d/" % port
    server = uvicorn.Server(uvicorn.Config(make_app(base, False), host="127.0.0.1", port=port, log_level="warning"))
    serving = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    out = {}
    try:
        async with httpx.AsyncClient(timeout=30) as hc:
            from a2a.client.card_resolver import parse_agent_card
            card = parse_agent_card((await hc.get(base + ".well-known/agent-card.json")).json())
            client = ClientFactory(ClientConfig(httpx_client=hc, streaming=False)).create(card)
            text = "refusal probe " + uuid.uuid4().hex
            action = {"tool": "a2a.SendMessage", "target": base + "#skill=" + SKILL, "args_sha256": args_sha256(text)}
            good = nr.make_grant(CALLER, PROVIDER.did, "t", action, "n", now(-60), now(600))
            other_input = nr.make_grant(CALLER, PROVIDER.did, "t", dict(action, args_sha256=args_sha256("other")), "n", now(-60), now(600))
            forged = dict(good, caller_sig=WITNESS.sign({k: v for k, v in good.items() if k not in nr.GRANT_DERIVED}))
            other_provider = nr.make_grant(CALLER, WITNESS.did, "t", action, "n", now(-60), now(600))
            for name, g, want in [("no_grant", None, "no_grant"), ("other_input", other_input, "input_is_not_what_the_caller_authorized"),
                                  ("forged_caller_sig", forged, "caller_sig_invalid"), ("names_another_provider", other_provider, "grant_names_another_provider")]:
                msg = Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[Part(text=text)])
                if g is not None:
                    msg.metadata.update({NS + "grant": g})
                t = await first_task(client.send_message(SendMessageRequest(message=msg)))
                said = "".join(p.text for p in t.status.message.parts) if t is not None and t.status.HasField("message") else ""
                out[name] = t is not None and len(t.artifacts) == 0 and said == "refused: " + want
    finally:
        server.should_exit = True
        await serving
    return out


def verify_py(bundle_bytes, transcript, use_lookup=True):
    import nenrin_verify as nv
    served = [p["text"] for a in transcript["task"].get("artifacts", []) for p in a.get("parts", []) if isinstance(p.get("text"), str)]

    def lookup(ev):
        return {"found": len(served) > 0, "matches": any(nr.sha256hex(t) == ev["ref"] for t in served)}

    b = nv.js_loads(bundle_bytes)
    inp = {**b, "resolve": nv.did_key_resolver}
    if use_lookup:
        inp["lookup"] = lookup
    report = nv.verify_provenance(inp)
    sig = {"verdict": report["verdict"], "refusals": sorted(r["code"] for r in report["refusals"]),
           "findings": sorted(f["code"] for f in report["findings"])}
    return {"signature": sig, "report_sha256": nv.report_sha256(report)}


def verify_js(bpath, tpath, use_lookup=True):
    cmd = ["node", os.path.join(HERE, "verify_js.mjs"), bpath, tpath] + ([] if use_lookup else ["--no-lookup"])
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def write(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def check_one(case, bpath, tpath, expected, mode_check_sha=False):
    with open(bpath, "rb") as f:
        bb = f.read()
    with open(tpath, encoding="utf-8") as f:
        tr = json.load(f)
    py, js = verify_py(bb, tr), verify_js(bpath, tpath)
    same = py == js
    want = expected.get(case) if expected else None
    ok_sig = want is None or py["signature"] == want["signature"]
    print("%-15s python %s  javascript %s  %s%s" % (case, py["report_sha256"][:12], js["report_sha256"][:12],
          "same report" if same else "REPORTS DIFFER", "" if ok_sig else "  SIGNATURE DIFFERS FROM expected.json"))
    print("                " + json.dumps(py["signature"]) + ("  witness: " + json.dumps(tr.get("witness_checks")) if tr.get("witness_checks") else ""))
    # without the lookup the evidence is bound but unchecked; with a tampered bundle the two must still agree
    py0, js0 = verify_py(bb, tr, False), verify_js(bpath, tpath, False)
    variants_ok = py0 == js0 and "evidence_bound_unchecked" in py0["signature"]["findings"]
    if want is not None and "without_lookup" in want:
        variants_ok = variants_ok and py0["signature"] == want["without_lookup"]["signature"]
        if mode_check_sha:
            variants_ok = variants_ok and py0["report_sha256"] == want["without_lookup"]["report_sha256"]
    if want is not None and mode_check_sha:
        ok_sig = ok_sig and py["report_sha256"] == want["report_sha256"]
    import tempfile
    for path, value in [(("receipt", "outcome", "status"), "failed"), (("grant", "provider_id"), WITNESS.did),
                        (("intent", "declared_at"), "2000-01-01T00:00:00Z"), (("observations", 0, "conduct", "verdict"), "pass" if case != "honest" else "fail")]:
        b = json.loads(bb)
        cur = b
        for k in path[:-1]:
            cur = cur[k]
        cur[path[-1]] = value
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(b, f)
        pyt, jst = verify_py(open(f.name, "rb").read(), tr), verify_js(f.name, tpath)
        os.unlink(f.name)
        variants_ok = variants_ok and pyt == jst and pyt["signature"]["verdict"] == "refused"
    print("                no lookup and 4 tampered copies: " + ("python and javascript agree, every tampered copy refused" if variants_ok else "MISMATCH"))
    return same and ok_sig and variants_ok, py, py0


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--live"
    exp_path = os.path.join(FIX, "expected.json")
    expected = json.load(open(exp_path))["cases"] if os.path.exists(exp_path) and mode != "--freeze" else None
    ok, results = True, {}
    import tempfile
    out_dir = FIX if mode in ("--freeze", "--check") else tempfile.mkdtemp(prefix="a2a-python-e2e-")
    os.makedirs(out_dir, exist_ok=True)
    for case in CASES:
        bpath, tpath = os.path.join(out_dir, case + ".bundle.json"), os.path.join(out_dir, case + ".transcript.json")
        if mode != "--check":
            bundle, transcript = asyncio.run(run_case(case))
            write(bpath, bundle)
            write(tpath, transcript)
        good, py, py0 = check_one(case, bpath, tpath, expected, mode == "--check")
        ok = ok and good
        results[case] = {"signature": py["signature"], "report_sha256": py["report_sha256"],
                         "without_lookup": {"signature": py0["signature"], "report_sha256": py0["report_sha256"]}}
    if mode != "--check":
        ref = asyncio.run(run_refusals())
        print("provider refuses before acting: " + json.dumps(ref))
        ok = ok and all(ref.values())
    if mode == "--freeze":
        write(exp_path, {"schema": "nenrin-a2a-python-e2e-expected-v0", "note": "per case: the verdict signature and report sha256 with the evidence lookup (the receipt evidence is checked against the artifact the server served, from the transcript), and without it (what nenrin-verify bundle.json prints). The same from Python and JavaScript. Without the lookup the lying provider is accepted: its receipt is a validly signed claim, the witness fail is surfaced in layers.delegation.hop_verdicts, and only resolving the evidence refuses it.", "cases": results})
        print("wrote fixtures/")
    print("ok" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
