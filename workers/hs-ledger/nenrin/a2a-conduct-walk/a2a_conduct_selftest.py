#!/usr/bin/env python3
"""a2a_conduct_selftest.py : an agent built only with a2a_conduct.py helpers, walked by the unchanged reference client.

    python3 a2a_conduct_selftest.py

A tiny A2A agent (stdlib http.server) declares the extension with ac.extension(), echoes with ac.echo_headers(),
and attaches metadata with ac.attach(). The real walk client walks it over HTTP on both wires, at a measured
endpoint and at an A2A URL that is not measured. Every applicable assertion must hold. Then preflight() and the
refusals in extension(). No network beyond 127.0.0.1. Exit 1 on any miss.
"""
import json, os, sys, threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import a2a_conduct as ac          # noqa: E402
import a2a_conduct_walk as W      # noqa: E402

ORIGIN = "https://agent.selftest.invalid"
COMP = {"paid_by": "buyer", "referral_fee": False, "listing_fee": False, "success_fee_pct": 0}
EXT = ac.extension(COMP, [ORIGIN + "/mcp"])
STATE = {"task": False}


class Agent(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, headers=None):
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/.well-known/agent-card.json":
            return self._send(200, {"name": "Helper-built agent", "description": "selftest", "url": ORIGIN + "/a2a", "version": "1",
                                    "supportedInterfaces": [{"url": ORIGIN + "/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}],
                                    "capabilities": {"extensions": [EXT]}, "skills": [],
                                    "defaultInputModes": ["text/plain"], "defaultOutputModes": ["application/json"]})
        return self._send(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        b = json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        served = ORIGIN + self.path                       # the public URL this path is served at
        hdr = ac.echo_headers(dict(self.headers.items()))
        wire10 = b.get("method") == "SendMessage"
        if STATE["task"]:
            res = {"task": {"id": "t", "contextId": "c", "status": {"state": "TASK_STATE_COMPLETED"}}} if wire10 else \
                  {"kind": "task", "id": "t", "contextId": "c", "status": {"state": "completed"}}
        else:
            res = {"message": {"role": "ROLE_AGENT", "messageId": "m", "parts": [{"text": "ok"}]}} if wire10 else \
                  {"kind": "message", "role": "agent", "messageId": "m", "parts": [{"kind": "text", "text": "ok"}]}
        if hdr:
            ac.attach(res, EXT, served)
        return self._send(200, {"jsonrpc": "2.0", "id": b.get("id"), "result": res}, hdr)


srv = HTTPServer(("127.0.0.1", 0), Agent)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % srv.server_port
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fetch(method, url, headers=None, body=None):
    req = urllib.request.Request(BASE + url[len(ORIGIN):], data=body, method=method, headers=headers or {})
    try:
        with LOCAL.open(req, timeout=10) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()


R = []
def t(name, ok, detail=""):
    R.append(ok)
    print(("  green  " if ok else "  RED    ") + name + ("" if ok else "  << " + str(detail)))


for task in (False, True):
    STATE["task"] = task
    for path in ("/mcp", "/a2a"):
        for wire in ("1.0", "0.3"):
            rec = W.walk(ORIGIN, ORIGIN + path, "a2a", "selftest", "localhost", fetch=fetch, walked_at="2026-09-28T00:00:00Z", wire=wire)
            res = {a["claim"].split(":")[0]: a["result"] for a in rec["assertions"]}
            v = rec["verdict"]
            t("helper-built agent, %s at %s, wire %s: %d/%d, metadata_echoed and endpoint_bound true" % ("task" if task else "message", path, wire, v["n_pass"], v["n_total"]),
              v["ok"] and v["n_total"] == 7 and res.get("metadata_echoed") is True and res.get("endpoint_bound") is True, res)

# preflight, over a mock transport
def mock_get(url):
    if url.endswith("/.well-known/agent-card.json"):
        return 200, {"capabilities": {"extensions": [EXT]}}
    if "/is-verified?endpoint=" in url:
        return 200, {"state": "verified", "verified": True, "record_url": "https://gate.example/record/x", "history_url": "https://gate.example/history"}
    return 404, None
p = ac.preflight(ORIGIN, fetch=mock_get)
t("preflight: reads the declaration, who pays, and the register per measured endpoint", p["extension_declared"] and p["compensation"]["paid_by"] == "buyer"
  and p["register"][0]["verified"] is True and p["witness_intake"] == ac.WITNESS_INTAKE, p)
p2 = ac.preflight(ORIGIN, fetch=lambda u: (200, {"name": "no ext"}) if u.endswith("agent-card.json") else (404, None))
t("preflight: an agent without the extension is reported as such, nothing invented", p2["extension_declared"] is False and p2["register"] == [], p2)
t("preflight: says what it does not establish", len(p["does_not_establish"]) == 3)

# refusals
def refuses(f):
    try:
        f(); return False
    except ValueError:
        return True
t("extension() refuses paid_by outside the closed list", refuses(lambda: ac.extension(dict(COMP, paid_by="Buyer"), [ORIGIN + "/a2a"])))
t("extension() refuses a non-boolean fee flag", refuses(lambda: ac.extension(dict(COMP, referral_fee="no"), [ORIGIN + "/a2a"])))
t("extension() refuses a non-https measured endpoint", refuses(lambda: ac.extension(COMP, ["http://x.example/a2a"])))
t("echo: not activated means no header at all", ac.echo_headers({"Content-Type": "application/json"}) == {})
t("echo: the 0.3 spelling is echoed under both spellings", ac.echo_headers({"X-A2A-Extensions": ac.EXT_URI}) == {"A2A-Extensions": ac.EXT_URI, "X-A2A-Extensions": ac.EXT_URI})
t("metadata: served_by drops the query and never becomes a constant", ac.metadata(EXT, ORIGIN + "/a2a?x=1")[ac.EXT_URI + "/served_by"] == ORIGIN + "/a2a")

srv.shutdown()
print("\n=== %d / %d (a2a_conduct helpers, walked by the reference client) ===" % (sum(R), len(R)))
sys.exit(0 if all(R) else 1)
