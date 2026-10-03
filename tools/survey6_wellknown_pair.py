# -*- coding: utf-8 -*-
"""
WEDJAT survey, probe 6: a control for the 467 rows of probe 5 whose challenge named no metadata URL.

Why (2026-10-04):
  Probe 5 read those 467 endpoints at the RFC 9728 default location only, and counted every
  non-200 there as auth_proxy_by_rule. On modelcontextprotocol/registry Discussion #1548 it was
  pointed out that the default-location GET alone is not a discriminator: a path-scoped gate and
  a resource server that names its document only in the challenge both hand back a non-JSON body.
  The control suggested there is adopted as stated: per endpoint, GET the same well-known URL
  under a path that cannot exist, with the same headers, and judge the pair.

What one row records (per endpoint, two GETs, nothing else):
  registered  https://<host>/.well-known/oauth-protected-resource<path of the registered URL>
  garbage     https://<host>/.well-known/oauth-protected-resource/_nx<16 random hex>
  For each GET: HTTP status, content type, sha256 of the first 64 KiB of the body, whether the
  body is a JSON object, its `resource` (first 300 characters) and the number of
  `authorization_servers` entries that are http(s) URLs. No other body text is stored. The
  random suffix is stored, so the exact garbage URL is part of the row.

Pair category, derived only from the stored fields (so --recompute re-derives it):
  live_rs_keep                 registered: 200 JSON object; garbage: non-2xx. A path-scoped gate on a live resource
                               server. doc_category then grades the document as probe 5 does.
  auth_proxy_wall_every_path   both non-2xx with the same status, other than 404. The wall fronts every path, so a
                               client cannot fetch discovery before it holds a token.
  no_doc_unclassified          both 404. No document; this rule cannot classify it, so it is not counted as dead.
  unclassified_garbage_2xx     the garbage URL answered 2xx: the host answers any path, so the pair discriminates nothing.
  unclassified_registered_not_json  registered answered 200 but not a JSON object; garbage non-2xx.
  unclassified_statuses_differ both non-2xx with different statuses.
  pair_unreached               one of the two GETs got no HTTP answer.
  skipped_robots               robots.txt disallows one of the two URLs. Neither is fetched.

Same discipline as probes 1 to 5: same User-Agent with contact address, robots.txt honoured,
2 s minimum between requests to one host, read only (GET, no credentials, no attempt to obtain one),
record_sha256 on every row.

Usage:
  python3 tools/survey6_wellknown_pair.py --limit 10 --out /tmp/p6.jsonl     # try 10 first
  python3 tools/survey6_wellknown_pair.py                                    # all 467
  python3 tools/survey6_wellknown_pair.py --recompute verify-directory/survey/data/survey6_wellknown_pair_<date>.jsonl
  python3 tools/survey6_wellknown_pair.py --selftest                         # category rules, offline

Standard library only.
"""

import argparse, collections, hashlib, io, json, os, secrets, sys, threading, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402
import survey5_prm_probe as P5  # noqa: E402

ROOT = os.path.dirname(HERE)
DEFAULT_IN = os.path.join(ROOT, "verify-directory", "survey", "data", "survey5_prm_probe_2026-10-02.jsonl")
SCHEMA = "wedjat-survey6-wellknown-pair-v1"


def garbage_location(endpoint, nx):
    p = urllib.parse.urlparse(endpoint)
    return "%s://%s%s/_nx%s" % (p.scheme, p.netloc, P5.WELL_KNOWN, nx)


def is2xx(s):
    return isinstance(s, int) and 200 <= s < 300


def doc_category(endpoint, g):
    """Probe 5's grading of a 200 document, on the registered GET."""
    r = {"endpoint": endpoint, "source": "derived", "robots_skipped": False, "get": g}
    return P5.categorize(r)


def categorize(row):
    if row.get("robots_skipped"):
        return "skipped_robots"
    reg, gar = row.get("registered") or {}, row.get("garbage") or {}
    rs, gs = reg.get("status"), gar.get("status")
    if rs is None or gs is None:
        return "pair_unreached"
    if is2xx(gs):
        return "unclassified_garbage_2xx"
    if rs == 200:
        return "live_rs_keep" if reg.get("json_object") else "unclassified_registered_not_json"
    if is2xx(rs):
        return "unclassified_registered_not_json"
    if rs == 404 and gs == 404:
        return "no_doc_unclassified"
    if rs == gs:
        return "auth_proxy_wall_every_path"
    return "unclassified_statuses_differ"


def measure(t):
    ep = t["endpoint"]
    nx = secrets.token_hex(8)
    reg_url, gar_url = P5.default_location(ep), garbage_location(ep, nx)
    row = {"schema": SCHEMA, "endpoint": ep, "survey5_record_sha256": t.get("record_sha256"),
           "survey5_category": t.get("category"), "garbage_suffix": "_nx" + nx,
           "registered_url": reg_url, "garbage_url": gar_url}
    if not reg_url.lower().startswith("https://"):
        row.update({"robots": "not fetched: not https", "robots_skipped": False,
                    "registered": {"status": None, "error": "not_https"}, "garbage": {"status": None, "error": "not_https"}})
    else:
        ok1, note1 = W.robots_allows(reg_url)
        ok2, note2 = W.robots_allows(gar_url)
        row["robots"] = note1 if note1 == note2 else "registered: %s; garbage: %s" % (note1, note2)
        row["robots_skipped"] = not (ok1 and ok2)
        if ok1 and ok2:
            row["registered"] = P5.fetch(reg_url)
            row["garbage"] = P5.fetch(gar_url)
        else:
            row["registered"] = row["garbage"] = None
    row["measured_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    row["category"] = categorize(row)
    row["doc_category"] = doc_category(ep, row["registered"]) if row["category"] == "live_rs_keep" else None
    for k in ("registered", "garbage"):
        if row.get(k) and row[k].get("resource"):
            row[k]["resource"] = P5.redact_url(row[k]["resource"])
    return row


def load_targets(path):
    out, seen = [], set()
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        d = json.loads(line)
        if d.get("source") != "derived" or d["endpoint"] in seen:
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
        c = categorize(r)
        if c != r.get("category") or (c == "live_rs_keep" and doc_category(r["endpoint"], r["registered"]) != r.get("doc_category")):
            bad_cat += 1
        rows[r["endpoint"]] = r
    cats = collections.Counter(r["category"] for r in rows.values())
    hosts = collections.defaultdict(set)
    cross = collections.defaultdict(collections.Counter)
    for r in rows.values():
        hosts[r["category"]].add(urllib.parse.urlparse(r["endpoint"]).hostname)
        cross[r.get("survey5_category") or "?"][r["category"]] += 1
    report = {
        "file": os.path.basename(path),
        "file_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "endpoints": len(rows),
        "record_sha256_mismatch": bad_sha,
        "category_rederive_mismatch": bad_cat,
        "categories": dict(sorted(cats.items())),
        "distinct_hosts": {k: len(v) for k, v in sorted(hosts.items())},
        "live_rs_keep_doc_category": dict(sorted(collections.Counter(r["doc_category"] for r in rows.values() if r["category"] == "live_rs_keep").items())),
        "survey5_category_to_pair_category": {k: dict(sorted(v.items())) for k, v in sorted(cross.items())},
        "status_pairs_top": [["%s/%s" % k, n] for k, n in collections.Counter(
            ((r.get("registered") or {}).get("status"), (r.get("garbage") or {}).get("status")) for r in rows.values()).most_common(12)],
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if not bad_sha and not bad_cat else 1


def selftest():
    E = "https://example.com/mcp"
    def row(rs, gs, rj=False, skipped=False):
        reg = None if rs == "x" else {"status": rs, "json_object": rj, "resource": E, "authorization_servers": 1}
        gar = None if gs == "x" else {"status": gs, "json_object": False}
        return {"endpoint": E, "robots_skipped": skipped, "registered": reg, "garbage": gar}
    cases = [
        (row(200, 404, True), "live_rs_keep"),
        (row(200, 401, True), "live_rs_keep"),
        (row(401, 401), "auth_proxy_wall_every_path"),
        (row(403, 403), "auth_proxy_wall_every_path"),
        (row(404, 404), "no_doc_unclassified"),
        (row(200, 200, True), "unclassified_garbage_2xx"),
        (row(404, 200), "unclassified_garbage_2xx"),
        (row(200, 404, False), "unclassified_registered_not_json"),
        (row(204, 404), "unclassified_registered_not_json"),
        (row(401, 404), "unclassified_statuses_differ"),
        (row(404, 401), "unclassified_statuses_differ"),
        (row(None, 404), "pair_unreached"),
        (row(404, None), "pair_unreached"),
        (row("x", "x", skipped=True), "skipped_robots"),
    ]
    bad = [(c, categorize(r)) for r, c in cases if categorize(r) != c]
    g = garbage_location("https://h.example/api/mcp/", "0123456789abcdef")
    assert g == "https://h.example/.well-known/oauth-protected-resource/_nx0123456789abcdef", g
    assert doc_category(E, {"status": 200, "json_object": True, "resource": E, "authorization_servers": 1}) == "mcp_auth_confirmed"
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
                                "survey6_wellknown_pair_%s.jsonl" % time.strftime("%Y-%m-%d", time.gmtime()))
    targets = load_targets(a.input)
    print("probe 5 rows whose challenge named no metadata URL: %d endpoints" % len(targets))
    if a.limit:
        targets = targets[:a.limit]
    ok, via = W.control_ok()
    if not ok:
        sys.exit("control addresses are not reachable from here; our side is down. Not starting.")
    print("measuring %d endpoints, 2 GETs each (registered and garbage well-known), read only\n" % len(targets))
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
