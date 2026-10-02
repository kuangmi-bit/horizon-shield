#!/usr/bin/env python3
"""Offline test: a fake ledger on 127.0.0.1. No network beyond loopback."""
import json, os, subprocess, sys, tempfile, threading, hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
A = "a" * 64; B = "b" * 64; C = "c" * 64
BODIES = {"/witness/pending": {"pending": [{"sha": A}, {"sha": "not-hex"}]},
          "/agreement/pending": {"pending": [{"canonical_sha256": B}, {"canonical_sha256": C}]},
          "/witness/" + A: {"status": "pending", "sha": A, "x": 1},
          "/agreement/" + B: {"record": {"y": 2}}}
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b = BODIES.get(self.path)
        if b is None: self.send_response(404); self.end_headers(); return
        raw = json.dumps(b).encode(); self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(raw)
    def log_message(self, *a): pass
srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_port
here = os.path.dirname(os.path.abspath(__file__)); fails = 0
def ok(n, c):
    global fails; print(("PASS  " if c else "FAIL  ") + n); fails += 0 if c else 1
with tempfile.TemporaryDirectory() as t:
    r = subprocess.run([sys.executable, os.path.join(here, "pending_mirror.py"), "--out", t, "--base", base], capture_output=True, text=True)
    ok("a missing record makes the run exit 1", r.returncode == 1)
    ok("witness snapshot written as served", open(os.path.join(t, "snapshots/witness", A + ".json"), "rb").read() == json.dumps(BODIES["/witness/" + A]).encode())
    ok("agreement snapshot written", os.path.exists(os.path.join(t, "snapshots/agreement", B + ".json")))
    ok("a non sha name is skipped", "not a sha256 name" in r.stdout)
    rows = [json.loads(l) for l in open(os.path.join(t, "log.jsonl"))]
    ok("log has 2 rows with served sha256", len(rows) == 2 and rows[0]["served_bytes_sha256"] == hashlib.sha256(json.dumps(BODIES["/witness/" + A]).encode()).hexdigest())
    del BODIES["/agreement/pending"]["pending"][1]
    r2 = subprocess.run([sys.executable, os.path.join(here, "pending_mirror.py"), "--out", t, "--base", base], capture_output=True, text=True)
    ok("second run: nothing new, exit 0", r2.returncode == 0 and "0 new snapshot" in r2.stdout)
    ok("idempotent log", len(open(os.path.join(t, "log.jsonl")).readlines()) == 2)
    r3 = subprocess.run([sys.executable, os.path.join(here, "pending_mirror.py"), "--out", t, "--base", "http://example.com"], capture_output=True, text=True)
    ok("refuses a non https base", r3.returncode == 2)
print("pending-v0: " + ("ALL PASS" if not fails else "%d FAIL" % fails)); sys.exit(1 if fails else 0)
