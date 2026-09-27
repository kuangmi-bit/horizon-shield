#!/usr/bin/env python3
"""walk_reference_servers.py : the real client against the real server code. No network.

    python3 walk_reference_servers.py            # the four reference servers in this repository
    python3 walk_reference_servers.py --module gate=/path/to/older/src/worker.js   # walk another copy of one server

conduct-v1.4 (2026-09-28, section 14 of CONDUCT_EXT_v1.md). walk_selftest.py checks the client against mocks,
and each worker's own tests check the server against expectations written by the same hand. Neither would
have caught what a witness outside this project caught on 2026-09-27: the gate's /a2a told its callers that
/mcp served them, and the client passed it 5 of 5. The mocks agreed with the client, the tests agreed with
the server, and nothing put the two together. This file does: it starts each reference Worker locally with
hs-mcp/test/serve_local.mjs (the same scaffold the official SDK interop tests use), keeps every URL the walk
sees at its public https origin, and routes the bytes to 127.0.0.1. Then it walks each A2A interface on
both wires with a2a_conduct_walk.walk() unchanged and requires every applicable assertion to hold.

Run against the gate as it was before 0.4.16 and endpoint_bound goes false: that is the finding, reproduced
offline. Nothing is filed; no record leaves this machine.
"""
import argparse
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import a2a_conduct_walk as W  # noqa: E402

WORKERS = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
SERVE = os.path.join(WORKERS, "hs-mcp", "test", "serve_local.mjs")
# (label, module, public origin, the A2A interface the card names)
SERVERS = [
    ("gate", os.path.join(WORKERS, "hs-verify-gate", "src", "worker.js"), "https://gate.horizonshield.dev", "/a2a"),
    ("kira", os.path.join(WORKERS, "hs-mcp", "src", "mcp.js"), "https://mcp.horizonshield.dev", "/mcp"),
    ("ledger", os.path.join(WORKERS, "hs-ledger", "src", "worker.js"), "https://ledger.horizonshield.dev", "/a2a"),
    ("jidec", os.path.join(WORKERS, "hs-jidec-mcp", "src", "worker.js"), "https://jidec.horizonshield.dev", "/a2a"),
]
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def start(module, origin):
    p = subprocess.Popen(["node", SERVE, module, origin], cwd=os.path.dirname(os.path.dirname(SERVE)),
                         stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    line = p.stdout.readline().strip()
    if not line.startswith("PORT="):
        p.kill()
        raise RuntimeError("serve_local did not start for " + module + ": " + line)
    return p, "http://127.0.0.1:" + line[5:]


def router(origin, base):
    """A transport for walk(): the walk sees https://<public host>/..., the bytes go to the local Worker."""
    def fetch(method, url, headers=None, body=None):
        if not url.startswith(origin + "/") and url != origin:
            return 0, {"x-transport-error": "outside the walked origin: " + url}, b""
        local = base + url[len(origin):]
        h = {"User-Agent": W.USER_AGENT}
        h.update(headers or {})
        req = urllib.request.Request(local, data=body, method=method, headers=h)
        try:
            with LOCAL.open(req, timeout=W.TIMEOUT) as r:
                return r.status, dict(r.headers.items()), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers.items()), e.read()
    return fetch


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", action="append", default=[], help="label=path: walk this copy of that server instead of the repository's")
    ap.add_argument("--only", help="comma separated labels: gate,kira,ledger,jidec")
    a = ap.parse_args(argv)
    over = dict(x.split("=", 1) for x in a.module)
    servers = [(l, over.get(l, m), o, p) for l, m, o, p in SERVERS]
    if a.only:
        keep = set(a.only.split(","))
        servers = [s for s in servers if s[0] in keep]
    bad, n = [], 0
    for label, module, origin, path in servers:
        if not os.path.exists(module):
            # hs-mcp's source is not in the public repository (.gitignore); a clone walks the other three.
            print("  skip   %-6s %s is not in this checkout" % (label, os.path.relpath(module, WORKERS)))
            continue
        proc, base = start(module, origin)
        try:
            for wire in ("1.0", "0.3"):
                n += 1
                rec = W.walk(origin, origin + path, "a2a", "reference-servers", "local node, no network",
                             fetch=router(origin, base), walked_at="2026-09-28T00:00:00Z", wire=wire)
                res = {x["claim"].split(":")[0]: (x["result"], x.get("note")) for x in rec["assertions"]}
                false = [k for k, (r, _n) in res.items() if r is False]
                need = [k for k in ("metadata_echoed", "endpoint_bound", "extension_echoed", "measured_endpoint_answered") if res.get(k, (None,))[0] is not True]
                v = rec["verdict"]
                line = "%-6s %-5s wire %s  %s %d/%d" % (label, path, wire, v["outcome"], v["n_pass"], v["n_total"])
                if false or need:
                    bad.append(line)
                    print("  RED    " + line + "  << " + "; ".join("%s=%s (%s)" % (k, res.get(k, (None,))[0], res.get(k, (None, None))[1]) for k in sorted(set(false + need))))
                else:
                    print("  green  " + line + "  (" + str(res["endpoint_bound"][1]) + ")")
        finally:
            proc.kill()
    print("\n=== %d / %d walks hold every applicable assertion (reference servers, real client, no network) ===" % (n - len(bad), n))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
