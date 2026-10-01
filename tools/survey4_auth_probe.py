# -*- coding: utf-8 -*-
"""
WEDJAT survey, probe 4: is the authorization wall the MCP server's, or the host's?

Why (2026-10-02):
  Report 1 counted 3,076 registered addresses that answered a valid MCP initialize with
  HTTP 401, 402 or 403, and filed them as held / authorization_required: "Whether it speaks
  MCP was not measured." On modelcontextprotocol/registry Discussion #1548 it was pointed
  out that this count mixes two different things:

    - a server that implements MCP authorization at its MCP path, and
    - a host whose gateway, CDN or platform puts every path behind a wall, so the 401 says
      nothing about whether an MCP server lives at the registered path at all.

  The suggested way to separate them, adopted here as stated: send the same request to the
  registered path and to a path that cannot exist on the same host, and compare.

What one row records (per endpoint, two POSTs, nothing else):
  A  the registered URL, the same initialize report 1 sent (MCP 2024-11-05)
  B  https://<same host>/__nx_<16 random hex>, the identical request body and headers
  For each: HTTP status, WWW-Authenticate (raw, plus scheme, realm and resource_metadata
  parsed out), Server, the edge markers present (cf-ray, x-vercel-id, ...), and the sha256
  of the first 64 KiB of the body. No body text is stored.

Category, derived only from the stored fields (so --recompute can re-derive it):
  unreachable_now       A did not answer this time. Not a statement about the server.
  changed_since         A answered with a status that is no longer 401/402/403/407.
  mcp_path_specific     A is an auth status, B is not: the wall is at the registered path.
  origin_wide_wall      A and B are both auth statuses: the whole host is walled, and
                        whether an MCP server exists behind it is still not known.
  control_unreached     A is an auth status, B did not answer: not separable this time.
  skipped_robots        robots.txt disallows the registered path now. Not probed.

Same discipline as survey1_walk.py, imported from it rather than copied:
  same User-Agent with contact address, robots.txt honoured, 2 s minimum between requests
  to one host, read only (initialize only, never tools/call, no credentials, no attempt to
  obtain one), the self-check against control addresses when many in a row fail, and a
  record_sha256 on every row computed the same way.

Usage (from a machine that can reach the public internet):
  python3 tools/survey4_auth_probe.py                       # all 3,076, default paths
  python3 tools/survey4_auth_probe.py --limit 20 --out /tmp/p.jsonl   # try 20 first
  python3 tools/survey4_auth_probe.py --resume              # continue an interrupted run
  python3 tools/survey4_auth_probe.py --recompute verify-directory/survey/data/survey4_auth_probe_2026-10-02.jsonl

Standard library only.
"""

import argparse, collections, hashlib, io, json, os, re, secrets, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402

ROOT = os.path.dirname(HERE)
DEFAULT_IN = os.path.join(ROOT, "verify-directory", "survey", "data", "survey1_walk_2026-08-23_run2.jsonl")
SCHEMA = "wedjat-survey4-auth-probe-v1"
AUTH = W.AUTH_CODES
BODY_CAP = 65536
EDGE_MARKERS = ("cf-ray", "x-vercel-id", "x-amz-cf-id", "x-amzn-requestid", "x-amzn-trace-id",
                "x-served-by", "fly-request-id", "x-render-origin-server", "x-railway-request-id",
                "x-cloud-trace-context", "x-azure-ref", "x-nf-request-id", "x-github-request-id")
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": W.PROTOCOL, "capabilities": {},
                   "clientInfo": {"name": "horizon-shield-survey", "version": "1.0"}}}


def parse_www_authenticate(v):
    """scheme, realm, resource_metadata, error. Values are read as written; nothing is fetched."""
    out = {"scheme": None, "realm": None, "resource_metadata": None, "error": None}
    if not v:
        return out
    m = re.match(r"\s*([A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*)", v)
    if m:
        out["scheme"] = m.group(1)
    for k in ("realm", "resource_metadata", "error"):
        m = re.search(r'(?:^|[\s,])' + k + r'\s*=\s*(?:"([^"]*)"|([^\s,]+))', v, re.I)
        if m:
            out[k] = (m.group(1) if m.group(1) is not None else m.group(2))[:300]
    return out


def probe(url):
    """One POST of the report 1 initialize. Returns the fields kept for one side."""
    W.host_gate(urllib.parse.urlparse(url).hostname or url)
    req = urllib.request.Request(url, data=W.canon(INIT).encode("utf-8"), method="POST", headers={
        "content-type": "application/json",
        "accept": "application/json, text/event-stream",
        "user-agent": W.UA,
        "mcp-protocol-version": W.PROTOCOL,
    })
    code, headers, body, err = None, None, b"", None
    try:
        with urllib.request.urlopen(req, timeout=W.TIMEOUT) as r:
            code, headers, body = r.status, r.headers, r.read(BODY_CAP)
    except urllib.error.HTTPError as e:
        code, headers = e.code, e.headers
        try:
            body = e.read(BODY_CAP)
        except Exception:
            body = b""
    except Exception as e:
        err = W.describe_exc(e)
    return side_fields(code, headers, body, err)


def side_fields(code, headers, body, err):
    h = (lambda k: headers.get(k)) if headers is not None else (lambda k: None)
    wa = h("www-authenticate")
    p = parse_www_authenticate(wa)
    return {
        "status": code,
        "error": err,
        "www_authenticate": wa[:600] if wa else None,
        "wa_scheme": p["scheme"], "wa_realm": p["realm"],
        "wa_resource_metadata": p["resource_metadata"], "wa_error": p["error"],
        "server": (h("server") or None),
        "edge": sorted(k for k in EDGE_MARKERS if h(k) is not None),
        "content_type": (h("content-type") or None),
        "body_sha256": hashlib.sha256(body or b"").hexdigest() if code is not None else None,
    }


def categorize(row):
    """Derived only from stored fields. --recompute runs this again on every row."""
    if row.get("robots_skipped"):
        return "skipped_robots"
    a, b = row.get("a") or {}, row.get("b") or {}
    if a.get("status") is None:
        return "unreachable_now"
    if a["status"] not in AUTH:
        return "changed_since"
    if b.get("status") is None:
        return "control_unreached"
    if b["status"] in AUTH:
        return "origin_wide_wall"
    return "mcp_path_specific"


def signals(row):
    """Secondary facts worth counting, also derived only from stored fields."""
    a, b = row.get("a") or {}, row.get("b") or {}
    return {
        "a_has_resource_metadata": bool(a.get("wa_resource_metadata")),
        "b_has_resource_metadata": bool(b.get("wa_resource_metadata")),
        "same_www_authenticate": a.get("status") is not None and b.get("status") is not None
                                 and a.get("www_authenticate") == b.get("www_authenticate"),
        "same_body": a.get("body_sha256") is not None and a.get("body_sha256") == b.get("body_sha256"),
        "same_status": a.get("status") is not None and a.get("status") == b.get("status"),
    }


def nx_url(endpoint):
    p = urllib.parse.urlparse(endpoint)
    return "%s://%s/__nx_%s" % (p.scheme, p.netloc, secrets.token_hex(8))


def measure(t):
    url = t["endpoint"]
    row = {"schema": SCHEMA, "endpoint": url, "run2_status": t["run2_status"],
           "run2_measured_at": t["run2_measured_at"], "run2_record_sha256": t["run2_record_sha256"],
           "protocol": W.PROTOCOL, "method": "initialize"}
    ok, note = W.robots_allows(url)
    row["robots"] = note
    if not ok:
        row.update({"robots_skipped": True, "nx_url": None, "a": None, "b": None})
    else:
        row["robots_skipped"] = False
        row["a"] = probe(url)
        row["nx_url"] = nx_url(url)
        okb, noteb = W.robots_allows(row["nx_url"])
        row["b"] = probe(row["nx_url"]) if okb else {"status": None, "error": "robots: " + noteb}
    row["measured_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    row["category"] = categorize(row)
    row["signals"] = signals(row)
    return row


def measure_guarded(t):
    """The same self-check survey1_walk.py uses: an unreachable A first makes us doubt ourselves."""
    for attempt in range(W.MAX_ATTEMPTS):
        if W._abort.is_set():
            return None
        W.wait_healthy()
        if W._abort.is_set():
            return None
        row = measure(t)
        if row["category"] != "unreachable_now":
            W.health_note_success()
            if attempt:
                row["retried"] = attempt
            return row
        recovered = W.health_note_failure()
        if W._abort.is_set():
            return None
        if recovered or attempt == 0:
            time.sleep(W.RETRY_SLEEP)
            continue
        break
    row["retried"] = attempt
    return row


def load_targets(path):
    seen, out = set(), []
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("outcome") != "authorization_required":
            continue
        u = d.get("endpoint")
        if not u or u in seen:
            continue
        seen.add(u)
        out.append({"endpoint": u, "run2_status": d.get("http_status"),
                    "run2_measured_at": d.get("measured_at"),
                    "run2_record_sha256": d.get("record_sha256")})
    return out


def recompute(path):
    """Read a probe file back, check every record_sha256, re-derive every category, count."""
    rows, bad_sha, bad_cat = {}, 0, 0
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        body = {k: r[k] for k in r if k != "record_sha256"}
        if W.sha256hex(W.canon(body)) != r.get("record_sha256"):
            bad_sha += 1
        if categorize(r) != r.get("category") or signals(r) != r.get("signals"):
            bad_cat += 1
        rows[r["endpoint"]] = r          # last row per endpoint wins, as survey1_aggregate does
    cats = collections.Counter(r["category"] for r in rows.values())
    by_run2 = collections.defaultdict(collections.Counter)
    for r in rows.values():
        by_run2[r["category"]][r.get("run2_status")] += 1
    sig = collections.Counter()
    for r in rows.values():
        if r["category"] in ("mcp_path_specific", "origin_wide_wall"):
            for k, v in r["signals"].items():
                if v:
                    sig[(r["category"], k)] += 1
    hosts = collections.defaultdict(set)
    for r in rows.values():
        hosts[r["category"]].add(urllib.parse.urlparse(r["endpoint"]).hostname)
    edge = collections.Counter()
    for r in rows.values():
        if r["category"] == "origin_wide_wall":
            for m in (r["a"] or {}).get("edge") or ["(none)"]:
                edge[m] += 1
    report = {
        "file": os.path.basename(path),
        "file_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "endpoints": len(rows),
        "record_sha256_mismatch": bad_sha,
        "category_rederive_mismatch": bad_cat,
        "categories": dict(sorted(cats.items())),
        "distinct_hosts": {k: len(v) for k, v in sorted(hosts.items())},
        "by_run2_status": {k: dict(sorted(v.items(), key=lambda kv: str(kv[0]))) for k, v in sorted(by_run2.items())},
        "signals": {"%s.%s" % k: v for k, v in sorted(sig.items())},
        "origin_wide_wall_edge_markers": dict(edge.most_common()),
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if not bad_sha and not bad_cat else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=DEFAULT_IN)
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=W.GLOBAL_WORKERS)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--recompute", metavar="JSONL")
    a = ap.parse_args()

    if a.recompute:
        sys.exit(recompute(a.recompute))

    out = a.out or os.path.join(ROOT, "verify-directory", "survey", "data",
                                "survey4_auth_probe_%s.jsonl" % time.strftime("%Y-%m-%d", time.gmtime()))
    targets = load_targets(a.input)
    print("report 1 authorization_required: %d endpoints" % len(targets))
    done = set()
    if a.resume and os.path.exists(out):
        for line in io.open(out, encoding="utf-8"):
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("category") != "unreachable_now":
                done.add(r.get("endpoint"))
        print("resume: %d already measured, unreachable rows are measured again" % len(done))
    targets = [t for t in targets if t["endpoint"] not in done]
    if a.limit:
        targets = targets[:a.limit]
    if not targets:
        print("nothing to measure")
        return
    ok, via = W.control_ok()
    if not ok:
        sys.exit("control addresses are not reachable from here; our side is down. Not starting.")
    print("measuring %d endpoints, 2 POSTs each (registered path and /__nx_<random>), read only\n" % len(targets))

    lock = threading.Lock()
    counts = collections.Counter()
    fh = io.open(out, "a" if a.resume else "w", encoding="utf-8")
    n = 0
    try:
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            futs = [ex.submit(measure_guarded, t) for t in targets]
            for f in as_completed(futs):
                try:
                    row = f.result()
                except Exception as e:
                    print("  our probe raised %s: %s (not written)" % (type(e).__name__, e), file=sys.stderr)
                    continue
                if row is None:
                    continue
                with lock:
                    fh.write(json.dumps(W.stamp(row), ensure_ascii=False) + "\n")
                    fh.flush()
                    counts[row["category"]] += 1
                    n += 1
                    if n % 50 == 0 or n == len(targets):
                        print("  %5d / %d  %s" % (n, len(targets),
                              "  ".join("%s=%d" % kv for kv in sorted(counts.items()))))
    finally:
        fh.close()
    if W._abort.is_set():
        print("\naborted: control addresses did not come back. Rows written so far are kept; "
              "do not report from this file until it is completed with --resume.")
        sys.exit(2)
    print("\nwritten: %s\n" % out)
    sys.exit(recompute(out))


if __name__ == "__main__":
    main()
