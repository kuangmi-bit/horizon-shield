# -*- coding: utf-8 -*-
"""
WEDJAT survey, probe 5: of the 2,063 walls on the MCP path only, which ones publish
OAuth protected resource metadata (RFC 9728) that names the registered URL?

Why (2026-10-03):
  Probe 4 separated a wall on the registered path from a wall on the whole host, and found
  2,063 endpoints where only the registered path asked for authorization. On
  modelcontextprotocol/registry Discussion #1548 it was pointed out that this still mixes MCP
  servers with path-scoped gates (WAF path rules, oauth2-proxy and the like), and a rule was
  suggested, adopted here as stated: discriminate on the challenge, not the status. Parse
  WWW-Authenticate for Bearer resource_metadata, GET that URL, and require JSON whose
  `resource` is the registered URL and whose `authorization_servers` is not empty. A server
  that follows the MCP authorization spec publishes this. A generic gate answers 401 with a
  bare realm and 404 at the well-known location.

What one row records (per endpoint, one GET, nothing else):
  source   named   the resource_metadata URL the probe 4 challenge carried (row a)
           derived the RFC 9728 default location, when the challenge named none:
                   https://<host>/.well-known/oauth-protected-resource<path of the registered URL>
  For the GET: HTTP status, content type, sha256 of the first 64 KiB of the body, whether the
  body is a JSON object, its `resource` (first 300 characters) and the number of
  `authorization_servers` entries that are http(s) URLs. No other body text is stored.

Category, derived only from the stored fields (so --recompute re-derives it):
  mcp_auth_confirmed             200, JSON, resource == registered URL exactly, >= 1 authorization server
  prm_resource_differs_in_form   as above, but resource equals the registered URL only after
                                 lowercasing the host and dropping a trailing slash
  prm_resource_mismatch          200, JSON, authorization servers present, resource names another URL
  prm_no_authorization_servers   200, JSON, authorization_servers missing or empty
  prm_not_json                   200, body is not a JSON object
  prm_named_but_unavailable      the challenge named a metadata URL and it did not answer 200
  auth_proxy_by_rule             the challenge named none and the default location did not answer 200
                                 (the suggested rule; it is a rule, not a proof of what is behind it)
  prm_unreached                  the metadata URL did not answer at all this time
  skipped_robots                 robots.txt disallows the metadata URL. Not fetched.

Same discipline as survey1_walk.py and survey4: same User-Agent with contact address,
robots.txt honoured, 2 s minimum between requests to one host, read only (one GET, no
credentials, no attempt to obtain one), record_sha256 on every row.

Usage:
  python3 tools/survey5_prm_probe.py --limit 20 --out /tmp/p5.jsonl     # try 20 first
  python3 tools/survey5_prm_probe.py                                    # all 2,063
  python3 tools/survey5_prm_probe.py --recompute verify-directory/survey/data/survey5_prm_probe_<date>.jsonl
  python3 tools/survey5_prm_probe.py --selftest                         # category rules, offline

Standard library only.
"""

import argparse, collections, hashlib, io, json, os, re, sys, threading, time
import urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402

ROOT = os.path.dirname(HERE)
DEFAULT_IN = os.path.join(ROOT, "verify-directory", "survey", "data", "survey4_auth_probe_2026-10-01.jsonl")
SCHEMA = "wedjat-survey5-prm-probe-v1"
BODY_CAP = 65536
WELL_KNOWN = "/.well-known/oauth-protected-resource"


def default_location(endpoint):
    p = urllib.parse.urlparse(endpoint)
    path = p.path.rstrip("/")
    return "%s://%s%s%s" % (p.scheme, p.netloc, WELL_KNOWN, path)


def norm(u):
    try:
        p = urllib.parse.urlparse(u)
        return "%s://%s%s%s" % (p.scheme.lower(), (p.netloc or "").lower(), p.path.rstrip("/"), ("?" + p.query) if p.query else "")
    except Exception:
        return None


def fetch(url):
    W.host_gate(urllib.parse.urlparse(url).hostname or url)
    req = urllib.request.Request(url, method="GET", headers={"accept": "application/json", "user-agent": W.UA})
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
    out = {"status": code, "error": err,
           "content_type": (headers.get("content-type") if headers is not None else None),
           "body_sha256": hashlib.sha256(body or b"").hexdigest() if code is not None else None,
           "json_object": False, "resource": None, "authorization_servers": None}
    if code == 200:
        try:
            d = json.loads((body or b"").decode("utf-8"))
        except Exception:
            d = None
        if isinstance(d, dict):
            out["json_object"] = True
            res = d.get("resource")
            out["resource"] = res[:300] if isinstance(res, str) else None
            a = d.get("authorization_servers")
            out["authorization_servers"] = (sum(1 for x in a if isinstance(x, str) and x.lower().startswith(("https://", "http://")))
                                            if isinstance(a, list) else None)
    return out


SECRET_KEY = re.compile(r"(?i)^(api[_-]?key|apikey|key|token|access[_-]?token|auth|secret|client[_-]?secret|sig|signature|password)$")


def redact_url(u):
    """Credential-looking query values are replaced by REDACTED before a row is stored. Templates like {apiKey} stay."""
    if not isinstance(u, str) or "?" not in u:
        return u
    base, _, q = u.partition("?")
    out = []
    for part in q.split("&"):
        k, eq, v = part.partition("=")
        if eq and v and SECRET_KEY.match(urllib.parse.unquote(k)) and not (v.startswith("{") or v.startswith("%7B")):
            v = "REDACTED"
        out.append(k + eq + v)
    return base + "?" + "&".join(out)


def categorize(row):
    if row.get("robots_skipped"):
        return "skipped_robots"
    g = row.get("get") or {}
    if g.get("status") is None:
        return "prm_unreached"
    if g["status"] != 200:
        return "prm_named_but_unavailable" if row.get("source") == "named" else "auth_proxy_by_rule"
    if not g.get("json_object"):
        return "prm_not_json"
    if not g.get("authorization_servers"):
        return "prm_no_authorization_servers"
    if g.get("resource") == row["endpoint"]:
        return "mcp_auth_confirmed"
    if g.get("resource") and norm(g["resource"]) == norm(row["endpoint"]):
        return "prm_resource_differs_in_form"
    return "prm_resource_mismatch"


def measure(t):
    a = t.get("a") or {}
    named = a.get("wa_resource_metadata")
    if named:
        url, source = urllib.parse.urljoin(t["endpoint"], named), "named"
    else:
        url, source = default_location(t["endpoint"]), "derived"
    row = {"schema": SCHEMA, "endpoint": t["endpoint"], "survey4_record_sha256": t.get("record_sha256"),
           "survey4_wa_scheme": a.get("wa_scheme"), "survey4_wa_realm": a.get("wa_realm"),
           "source": source, "metadata_url": url,
           "cross_host": (urllib.parse.urlparse(url).hostname or "").lower() != (urllib.parse.urlparse(t["endpoint"]).hostname or "").lower()}
    if not url.lower().startswith("https://"):
        row.update({"robots": "not fetched: metadata URL is not https", "robots_skipped": False,
                    "get": {"status": None, "error": "not_https"}})
    else:
        ok, note = W.robots_allows(url)
        row["robots"] = note
        row["robots_skipped"] = not ok
        row["get"] = fetch(url) if ok else None
    row["measured_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    row["category"] = categorize(row)
    # stored after the category is fixed: redaction keeps the query, so the category would not change either way
    row["metadata_url"] = redact_url(row["metadata_url"])
    if row.get("get") and row["get"].get("resource"):
        row["get"]["resource"] = redact_url(row["get"]["resource"])
    return row


def load_targets(path):
    out, seen = [], set()
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        if d.get("category") != "mcp_path_specific" or d["endpoint"] in seen:
            continue
        seen.add(d["endpoint"])
        out.append(d)
    return out


def recompute(path):
    rows, bad_sha, bad_cat = {}, 0, 0
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        body = {k: r[k] for k in r if k != "record_sha256"}
        if W.sha256hex(W.canon(body)) != r.get("record_sha256"):
            bad_sha += 1
        if categorize(r) != r.get("category"):
            bad_cat += 1
        rows[r["endpoint"]] = r
    cats = collections.Counter(r["category"] for r in rows.values())
    by_source = collections.defaultdict(collections.Counter)
    hosts = collections.defaultdict(set)
    for r in rows.values():
        by_source[r["source"]][r["category"]] += 1
        hosts[r["category"]].add(urllib.parse.urlparse(r["endpoint"]).hostname)
    report = {
        "file": os.path.basename(path),
        "file_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "endpoints": len(rows),
        "record_sha256_mismatch": bad_sha,
        "category_rederive_mismatch": bad_cat,
        "categories": dict(sorted(cats.items())),
        "distinct_hosts": {k: len(v) for k, v in sorted(hosts.items())},
        "by_source": {k: dict(sorted(v.items())) for k, v in sorted(by_source.items())},
        "cross_host_metadata": sum(1 for r in rows.values() if r.get("cross_host")),
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if not bad_sha and not bad_cat else 1


def selftest():
    E = "https://example.com/mcp"
    def row(source, get):
        return {"endpoint": E, "source": source, "robots_skipped": False, "get": get}
    ok = {"status": 200, "json_object": True, "resource": E, "authorization_servers": 1}
    cases = [
        (row("named", ok), "mcp_auth_confirmed"),
        (row("derived", ok), "mcp_auth_confirmed"),
        (row("named", dict(ok, resource="https://EXAMPLE.com/mcp/")), "prm_resource_differs_in_form"),
        (row("named", dict(ok, resource="https://other.example/mcp")), "prm_resource_mismatch"),
        (row("named", dict(ok, authorization_servers=0)), "prm_no_authorization_servers"),
        (row("named", dict(ok, authorization_servers=None)), "prm_no_authorization_servers"),
        (row("named", dict(ok, json_object=False)), "prm_not_json"),
        (row("named", {"status": 404}), "prm_named_but_unavailable"),
        (row("derived", {"status": 404}), "auth_proxy_by_rule"),
        (row("derived", {"status": 401}), "auth_proxy_by_rule"),
        (row("named", {"status": None}), "prm_unreached"),
        ({"endpoint": E, "source": "named", "robots_skipped": True, "get": None}, "skipped_robots"),
    ]
    bad = [(c, categorize(r)) for r, c in cases if categorize(r) != c]
    assert default_location("https://h.example/mcp/") == "https://h.example/.well-known/oauth-protected-resource/mcp"
    assert default_location("https://h.example") == "https://h.example/.well-known/oauth-protected-resource"
    print("selftest:", "ALL PASS (%d)" % len(cases) if not bad else "FAIL %r" % bad)
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=DEFAULT_IN)
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=W.GLOBAL_WORKERS)
    ap.add_argument("--recompute", metavar="JSONL")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if a.recompute:
        sys.exit(recompute(a.recompute))
    out = a.out or os.path.join(ROOT, "verify-directory", "survey", "data",
                                "survey5_prm_probe_%s.jsonl" % time.strftime("%Y-%m-%d", time.gmtime()))
    targets = load_targets(a.input)
    print("probe 4 mcp_path_specific: %d endpoints" % len(targets))
    if a.limit:
        targets = targets[:a.limit]
    ok, via = W.control_ok()
    if not ok:
        sys.exit("control addresses are not reachable from here; our side is down. Not starting.")
    print("measuring %d endpoints, 1 GET each (the RFC 9728 metadata URL), read only\n" % len(targets))
    lock, counts, n = threading.Lock(), collections.Counter(), 0
    fh = io.open(out, "w", encoding="utf-8")
    try:
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            for f in as_completed([ex.submit(measure, t) for t in targets]):
                try:
                    row = f.result()
                except Exception as e:
                    print("  our probe raised %s: %s (not written)" % (type(e).__name__, e), file=sys.stderr)
                    continue
                with lock:
                    fh.write(json.dumps(W.stamp(row), ensure_ascii=False) + "\n")
                    fh.flush()
                    counts[row["category"]] += 1
                    n += 1
                    if n % 100 == 0 or n == len(targets):
                        print("  %5d / %d  %s" % (n, len(targets), "  ".join("%s=%d" % kv for kv in sorted(counts.items()))))
    finally:
        fh.close()
    print("\nwritten: %s\n" % out)
    sys.exit(recompute(out))


if __name__ == "__main__":
    main()
