# -*- coding: utf-8 -*-
"""
survey4_auth_probe.py against local servers that wall in the ways seen in the wild.

  python3 tools/survey4_auth_probe_test.py

Four hosts on 127.0.0.1, one per category, plus one that is not listening at all:
  path wall   401 with resource_metadata at /mcp only, 404 elsewhere   -> mcp_path_specific
  origin wall 401 on every path, same body                             -> origin_wide_wall
  opened      200 at /mcp now                                          -> changed_since
  robots      robots.txt disallows /mcp                                -> skipped_robots
  closed port                                                          -> unreachable_now
Then the file is read back with --recompute, and one row is tampered with to show the
record_sha256 check refuses it. WWW-Authenticate parsing is checked on awkward shapes.
"""
import http.server, io, json, os, socket, sys, tempfile, threading

os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import survey1_walk as W  # noqa: E402
import survey4_auth_probe as P  # noqa: E402

W.PER_HOST_INTERVAL = 0.0
W.RETRY_SLEEP = 0.0
W.control_ok = lambda: (True, "test")

RM = 'Bearer realm="mcp", resource_metadata="https://x.example/.well-known/oauth-protected-resource"'


def make(kind):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, extra=()):
            b = body.encode()
            self.send_response(code)
            for k, v in extra:
                self.send_header(k, v)
            self.send_header("content-length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if self.path == "/robots.txt" and kind == "robots":
                return self.send(200, "User-agent: *\nDisallow: /mcp\n")
            self.send(404, "no")

        def do_POST(self):
            self.rfile.read(int(self.headers.get("content-length") or 0))
            if kind == "path":
                if self.path == "/mcp":
                    return self.send(401, '{"error":"invalid_token"}', [("WWW-Authenticate", RM)])
                return self.send(404, "not found")
            if kind == "origin":
                return self.send(401, "Unauthorized", [("WWW-Authenticate", 'Basic realm="gw"'),
                                                       ("cf-ray", "abc"), ("server", "cloudflare")])
            if kind == "opened":
                return self.send(200, '{"jsonrpc":"2.0","id":1,"result":{}}')
            self.send(401, "x")
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    bad = 0

    def check(label, got, want):
        nonlocal bad
        ok = got == want
        bad += 0 if ok else 1
        print("  %s  %-44s %s" % ("ok" if ok else "NG", label, got if ok else "%r != %r" % (got, want)))

    print("WWW-Authenticate parsing")
    check("bearer with resource_metadata", P.parse_www_authenticate(RM)["resource_metadata"],
          "https://x.example/.well-known/oauth-protected-resource")
    check("unquoted token value", P.parse_www_authenticate('Bearer error=invalid_token')["error"], "invalid_token")
    check("scheme only", P.parse_www_authenticate("Basic")["scheme"], "Basic")
    check("empty", P.parse_www_authenticate(None)["scheme"], None)
    check("realm not confused with xrealm", P.parse_www_authenticate('Bearer xrealm="a", realm="b"')["realm"], "b")

    servers = {k: make(k) for k in ("path", "origin", "opened", "robots")}
    url = lambda k: "http://127.0.0.1:%d/mcp" % servers[k].server_address[1]
    dead = "http://127.0.0.1:%d/mcp" % free_port()
    want = {url("path"): "mcp_path_specific", url("origin"): "origin_wide_wall",
            url("opened"): "changed_since", url("robots"): "skipped_robots", dead: "unreachable_now"}

    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "run2.jsonl")
    with io.open(src, "w", encoding="utf-8") as f:
        for u in want:
            f.write(json.dumps({"endpoint": u, "outcome": "authorization_required", "http_status": 401,
                                "measured_at": "2026-08-23T00:00:00Z", "record_sha256": "0" * 64}) + "\n")
        f.write(json.dumps({"endpoint": "http://127.0.0.1:1/other", "outcome": "speaks_mcp_and_lists_tools"}) + "\n")

    targets = P.load_targets(src)
    check("only authorization_required rows are targets", len(targets), 5)
    out = os.path.join(tmp, "probe.jsonl")
    print("\nprobe against local servers")
    with io.open(out, "w", encoding="utf-8") as fh:
        for t in targets:
            row = P.measure_guarded(t)
            fh.write(json.dumps(W.stamp(row), ensure_ascii=False) + "\n")
            check(t["endpoint"].split(":")[2], row["category"], want[t["endpoint"]])
            if row["category"] == "mcp_path_specific":
                check("  resource_metadata seen at A only",
                      (row["signals"]["a_has_resource_metadata"], row["signals"]["b_has_resource_metadata"]), (True, False))
                check("  nx path is on the same host", row["nx_url"].split("/__nx_")[0] + "/mcp", t["endpoint"])
            if row["category"] == "origin_wide_wall":
                check("  same body and WWW-Authenticate",
                      (row["signals"]["same_body"], row["signals"]["same_www_authenticate"]), (True, True))
                check("  edge marker recorded", row["a"]["edge"], ["cf-ray"])
            if row["category"] == "unreachable_now":
                check("  no body hash when nothing answered", row["a"]["body_sha256"], None)

    print("\nrecompute")
    check("clean file recomputes", P.recompute(out), 0)
    lines = io.open(out, encoding="utf-8").read().splitlines()
    r = json.loads(lines[0]); r["category"] = "origin_wide_wall"
    lines[0] = json.dumps(r)
    io.open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    check("tampered category is refused", P.recompute(out), 1)

    print("\n%s" % ("all passed" if not bad else "%d failed" % bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
