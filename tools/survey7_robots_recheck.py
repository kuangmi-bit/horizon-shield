# -*- coding: utf-8 -*-
"""
WEDJAT survey, probe 7: the 1,466 rows of the 2026-08-23 walk that were skipped as robots_disallowed, checked again.

Why (2026-10-09):
  On modelcontextprotocol/registry Discussion #1547 it was asked whether every robots_disallowed row came from a
  robots.txt that was actually fetched with a matching Disallow, or whether a fetcher that fails closed wrote the
  same value on a timeout, and whether re-fetching only those hosts moves the count.

  The walk's fetcher (survey1_walk.robots_allows) fails open: any exception, an HTTP error status included, is
  recorded as "not fetched (<error>), treated as allowed", and only a fetch that returned is parsed. All 1,466 rows
  carry "(fetched)". Its parser is also simpler than RFC 9309: it ignores Allow lines, treats a run of user-agent
  lines as the last one only, matches a group by the substring "horizon", strips a trailing * and does a prefix
  match (no $ anchor, no * inside a pattern), and reads at most 200,000 bytes. This probe measures how much of the
  count rests on those choices and how much on the files themselves.

What one origin fetch records (one GET of <origin>/robots.txt, same User-Agent as the walk, redirects followed up
to 5 hops and recorded): final HTTP status, every redirect hop (status and URL), whether the final host differs
from the origin's, content type, byte length, sha256 of the body as read (up to 512 KiB), and the user-agent groups
that apply to this crawler under either reading (groups naming "*" or containing "horizon"), as ordered
[directive, value] lines. No other body text is stored.

What one row records (one per skipped endpoint, sharing its origin's fetch): the walk's record_sha256 and reason,
the path that is matched, the verdict of the walk's own parser on today's file, and the RFC 9309 verdict.

RFC 9309 reading used here:
  status 2xx      parse; the group whose user-agent equals the product token HORIZON-SHIELD-survey (case
                  insensitive) applies, otherwise the "*" group(s); consecutive user-agent lines share one group;
                  the longest matching Allow or Disallow wins, a tie goes to Allow; * matches any run, a final $
                  anchors the end; an empty Disallow is no rule.
  status 4xx      unavailable: the crawler may access any path (RFC 9309 2.3.1.3).
  5xx, no answer  unreachable: assume complete disallow (RFC 9309 2.3.1.4).
  more than 5 redirects  treated as unavailable (2.3.1.2).

Category per row, derived only from stored fields (so --recompute re-derives it):
  still_disallowed             2xx, and both the walk's parser and RFC 9309 disallow the path today.
  allowed_now                  2xx, and both allow the path today (the file changed since 2026-08-23).
  rfc_allows_walk_parser_not   2xx; the walk's parser still disallows, RFC 9309 allows (an Allow line, a group, a
                               pattern the prefix match read wrongly). The skip on 2026-08-23 was our parser.
  rfc_disallows_walk_parser_not  2xx; the reverse.
  robots_unavailable_4xx       today the file answers 4xx: RFC 9309 allows everything.
  robots_unreachable           today no 2xx/4xx answer: RFC 9309 assumes complete disallow; the walk's fetcher
                               would have measured.

Same discipline as probes 1 to 6: User-Agent with contact address, 2 s minimum between requests to one host,
read only, record_sha256 on every row. Each origin is fetched once.

Usage:
  python3 tools/survey7_robots_recheck.py --selftest
  python3 tools/survey7_robots_recheck.py --limit 20 --out /tmp/p7.jsonl
  python3 tools/survey7_robots_recheck.py --out verify-directory/survey/data/survey7_robots_recheck_<UTC date>.jsonl
  python3 tools/survey7_robots_recheck.py --recompute verify-directory/survey/data/survey7_robots_recheck_<date>.jsonl

Standard library only.
"""

import argparse, collections, hashlib, io, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey1_walk as W  # noqa: E402

ROOT = os.path.dirname(HERE)
DEFAULT_IN = os.path.join(ROOT, "verify-directory", "survey", "data", "survey1_walk_2026-08-23_run2.jsonl")
SCHEMA = "wedjat-survey7-robots-recheck-v1"
TOKEN = "horizon-shield-survey"
MAX_READ = 512 * 1024
WALK_READ = 200000
MAX_HOPS = 5


# ---------- parsing ----------

def _lines(body):
    for raw in body.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        k, v = line.split(":", 1)
        yield k.strip().lower(), v.strip()


def rfc_groups(body):
    """RFC 9309 groups: [[user-agents...], [[directive, value], ...]]. Consecutive user-agent lines share a group."""
    groups, cur, last_ua = [], None, False
    for k, v in _lines(body):
        if k == "user-agent":
            if cur is None or not last_ua:
                cur = [[], []]
                groups.append(cur)
            cur[0].append(v.lower())
            last_ua = True
        elif k in ("allow", "disallow"):
            if cur is not None:
                cur[1].append([k, v])
            last_ua = False
    return groups


def relevant(groups):
    """The groups either reading could apply: '*' or anything containing 'horizon'."""
    return [g for g in groups if any(u == "*" or "horizon" in u for u in g[0])]


def walk_rules(body):
    """survey1_walk.robots_allows's parser, verbatim in effect, on the first 200,000 characters it would have read."""
    rules, active = [], False
    for k, v in _lines(body):
        if k == "user-agent":
            active = v == "*" or "horizon" in v.lower()
        elif k == "disallow" and active and v:
            rules.append(v)
    return rules


def walk_disallows(rules, path):
    for rule in rules:
        if path.startswith(rule.rstrip("*")):
            return True
    return False


def _pattern(p):
    anchored = p.endswith("$")
    core = p[:-1] if anchored else p
    rx = "".join(".*" if ch == "*" else re.escape(ch) for ch in core)
    return re.compile(rx + ("$" if anchored else ""))


def rfc_decide(groups, path):
    """(allowed, [directive, value] of the deciding rule or None). survey1_walk stores the rule on each row."""
    sel = [g for g in groups if TOKEN in g[0]]
    if not sel:
        sel = [g for g in groups if "*" in g[0]]
    best = None
    for g in sel:
        for d, v in g[1]:
            if d == "disallow" and v == "":
                continue
            if _pattern(v).match(path):
                n = len(v.encode("utf-8"))
                if best is None or n > best[0] or (n == best[0] and d == "allow"):
                    best = (n, d, v)
    if best is None:
        return True, None
    return best[1] == "allow", [best[1], best[2]]


def rfc_allows(groups, path):
    return rfc_decide(groups, path)[0]


def match_path(endpoint):
    p = urllib.parse.urlsplit(endpoint)
    return (p.path or "/") + ("?" + p.query if p.query else "")


# ---------- fetching ----------

class _Hops(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_HOPS

    def __init__(self):
        self.hops = []

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.hops.append([code, newurl])
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_origin(origin):
    host = urllib.parse.urlsplit(origin).hostname or origin
    W.host_gate(host)
    h = _Hops()
    opener = urllib.request.build_opener(h)
    out = {"url": origin + "/robots.txt", "status": None, "hops": h.hops, "final_url": None, "cross_host": None,
           "content_type": None, "bytes": None, "body_sha256": None, "error": None, "groups": None,
           "walk_rules": None, "over_walk_read": None}
    try:
        req = urllib.request.Request(origin + "/robots.txt", headers={"User-Agent": W.UA})
        with opener.open(req, timeout=W.ROBOTS_TIMEOUT) as r:
            raw = r.read(MAX_READ)
            out["status"] = r.status
            out["final_url"] = r.geturl()
            out["content_type"] = r.headers.get("Content-Type")
    except urllib.error.HTTPError as e:
        out["status"] = e.code
        out["final_url"] = e.geturl() if hasattr(e, "geturl") else None
        out["error"] = "HTTPError"
        if len(h.hops) >= MAX_HOPS and 300 <= e.code < 400:
            out["error"] = "too_many_redirects"
        raw = None
    except Exception as e:  # network, TLS, timeout
        out["error"] = type(e).__name__
        raw = None
    if out["final_url"]:
        out["cross_host"] = (urllib.parse.urlsplit(out["final_url"]).hostname or "") != host
    if raw is not None:
        body = raw.decode("utf-8", "replace")
        out["bytes"] = len(raw)
        out["body_sha256"] = hashlib.sha256(raw).hexdigest()
        out["groups"] = relevant(rfc_groups(body))
        out["walk_rules"] = walk_rules(body[:WALK_READ])
        out["over_walk_read"] = len(body) > WALK_READ
    return out


# ---------- verdicts ----------

def fetch_class(f):
    s, e = f.get("status"), f.get("error")
    if e == "too_many_redirects":
        return "unavailable_4xx"
    if isinstance(s, int) and 200 <= s < 300 and f.get("groups") is not None:
        return "ok_2xx"
    if isinstance(s, int) and 400 <= s < 500:
        return "unavailable_4xx"
    return "unreachable"


def derive(row):
    f, path = row["fetch"], row["path"]
    fc = fetch_class(f)
    if fc == "ok_2xx":
        walk_dis = walk_disallows(f["walk_rules"], path)
        rfc_dis = not rfc_allows(f["groups"], path)
    elif fc == "unavailable_4xx":
        walk_dis, rfc_dis = False, False
    else:
        walk_dis, rfc_dis = False, True
    if fc == "unavailable_4xx":
        cat = "robots_unavailable_4xx"
    elif fc == "unreachable":
        cat = "robots_unreachable"
    elif walk_dis and rfc_dis:
        cat = "still_disallowed"
    elif not walk_dis and not rfc_dis:
        cat = "allowed_now"
    elif walk_dis:
        cat = "rfc_allows_walk_parser_not"
    else:
        cat = "rfc_disallows_walk_parser_not"
    return {"fetch_class": fc, "walk_parser_disallows": walk_dis, "rfc9309_disallows": rfc_dis, "category": cat}


def load_targets(path):
    rows = []
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            d = json.loads(line)
            if d.get("outcome") == "robots_disallowed":
                rows.append(d)
    return rows


def origin_of(endpoint):
    p = urllib.parse.urlsplit(endpoint)
    return p.scheme + "://" + p.netloc


def recompute(path):
    rows, bad_sha, bad_cat = [], 0, 0
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        body = {k: r[k] for k in r if k != "record_sha256"}
        if W.sha256hex(W.canon(body)) != r.get("record_sha256"):
            bad_sha += 1
        d = derive(r)
        if any(d[k] != r.get(k) for k in d):
            bad_cat += 1
        rows.append(r)
    cats = collections.Counter(r["category"] for r in rows)
    hosts = collections.defaultdict(set)
    for r in rows:
        hosts[r["category"]].add(urllib.parse.urlsplit(r["endpoint"]).hostname)
    origins = {}
    for r in rows:
        origins[r["origin"]] = r["fetch"]
    report = {
        "file": os.path.basename(path),
        "file_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
        "rows": len(rows),
        "origins": len(origins),
        "record_sha256_mismatch": bad_sha,
        "rederive_mismatch": bad_cat,
        "categories": dict(sorted(cats.items())),
        "distinct_hosts_by_category": {k: len(v) for k, v in sorted(hosts.items())},
        "skip_count_today": {
            "walk_parser": sum(1 for r in rows if r["walk_parser_disallows"]),
            "rfc9309": sum(1 for r in rows if r["rfc9309_disallows"]),
            "of": len(rows),
        },
        "origin_fetch": {
            "status_top": [[str(k), n] for k, n in collections.Counter(f.get("status") for f in origins.values()).most_common(10)],
            "errors": dict(collections.Counter(f.get("error") for f in origins.values() if f.get("error"))),
            "redirected": sum(1 for f in origins.values() if f.get("hops")),
            "cross_host_final": sum(1 for f in origins.values() if f.get("cross_host")),
            "html_content_type": sum(1 for f in origins.values() if "html" in (f.get("content_type") or "").lower()),
            "over_200000_bytes": sum(1 for f in origins.values() if f.get("over_walk_read")),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if not bad_sha and not bad_cat else 1


def selftest():
    cases = []

    def t(name, got, want):
        cases.append((name, got == want, got, want))

    b1 = "User-agent: *\nDisallow: /\nAllow: /mcp\n"
    g1 = relevant(rfc_groups(b1))
    t("allow longer wins", rfc_allows(g1, "/mcp"), True)
    t("walk parser ignores allow", walk_disallows(walk_rules(b1), "/mcp"), True)
    t("other path disallowed", rfc_allows(g1, "/api/mcp"), False)
    b2 = "User-agent: *\nUser-agent: Googlebot\nDisallow: /api/\n"
    g2 = relevant(rfc_groups(b2))
    t("consecutive UA share group (rfc)", rfc_allows(g2, "/api/mcp"), False)
    t("consecutive UA: walk keeps last only", walk_disallows(walk_rules(b2), "/api/mcp"), False)
    b3 = "User-agent: *\nDisallow: /api$\n"
    t("$ anchor", rfc_allows(relevant(rfc_groups(b3)), "/api/mcp"), True)
    t("$ anchor walk prefix", walk_disallows(walk_rules(b3), "/api/mcp"), False)
    t("$ anchor exact", rfc_allows(relevant(rfc_groups(b3)), "/api"), False)
    b4 = "User-agent: *\nDisallow: /*.php\n"
    t("inner wildcard", rfc_allows(relevant(rfc_groups(b4)), "/x/y.php"), False)
    b5 = "User-agent: *\nDisallow: /mcp\n\nUser-agent: HORIZON-SHIELD-survey\nDisallow:\n"
    t("specific group overrides *", rfc_allows(relevant(rfc_groups(b5)), "/mcp"), True)
    t("walk: horizon substring group, empty disallow ignored, * rule kept", walk_disallows(walk_rules(b5), "/mcp"), True)
    b6 = "User-agent: *\nAllow: /mcp\nDisallow: /mcp\n"
    t("tie goes to allow", rfc_allows(relevant(rfc_groups(b6)), "/mcp"), True)
    t("no groups allows", rfc_allows([], "/x"), True)
    t("path with query", match_path("https://h.example/mcp?x=1"), "/mcp?x=1")
    t("empty path", match_path("https://h.example"), "/")

    def row(status, error=None, body=None, path="/mcp"):
        f = {"status": status, "error": error, "groups": None, "walk_rules": None}
        if body is not None:
            f["groups"], f["walk_rules"] = relevant(rfc_groups(body)), walk_rules(body)
        return {"fetch": f, "path": path}

    t("2xx still", derive(row(200, body="User-agent: *\nDisallow: /\n"))["category"], "still_disallowed")
    t("2xx allowed now", derive(row(200, body="User-agent: *\nDisallow: /admin\n"))["category"], "allowed_now")
    t("2xx parser diff", derive(row(200, body=b1))["category"], "rfc_allows_walk_parser_not")
    t("2xx reverse diff", derive(row(200, body=b2, path="/api/mcp"))["category"], "rfc_disallows_walk_parser_not")
    t("404", derive(row(404, "HTTPError"))["category"], "robots_unavailable_4xx")
    t("503", derive(row(503, "HTTPError"))["category"], "robots_unreachable")
    t("timeout", derive(row(None, "TimeoutError"))["category"], "robots_unreachable")
    t("too many redirects", derive(row(301, "too_many_redirects"))["category"], "robots_unavailable_4xx")
    bad = [c for c in cases if not c[1]]
    for c in bad:
        print("  FAIL %s: got %r want %r" % (c[0], c[2], c[3]))
    print("selftest:", "ALL PASS (%d)" % len(cases) if not bad else "FAIL %d of %d" % (len(bad), len(cases)))
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=DEFAULT_IN)
    ap.add_argument("--out", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--recompute", metavar="JSONL")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if a.recompute:
        sys.exit(recompute(a.recompute))
    out = a.out or os.path.join(ROOT, "verify-directory", "survey", "data",
                                "survey7_robots_recheck_%s.jsonl" % time.strftime("%Y-%m-%d", time.gmtime()))
    targets = load_targets(a.input)
    by_origin = collections.OrderedDict()
    for t in targets:
        by_origin.setdefault(origin_of(t["endpoint"]), []).append(t)
    print("walk rows skipped as robots_disallowed: %d endpoints on %d origins" % (len(targets), len(by_origin)))
    origins = list(by_origin)
    if a.limit:
        origins = origins[:a.limit]
    ok, via = W.control_ok()
    if not ok:
        sys.exit("control addresses are not reachable from here; our side is down. Not starting.")
    print("fetching robots.txt once per origin: %d origins, read only\n" % len(origins))
    lock, counts, n = threading.Lock(), collections.Counter(), 0
    fh = io.open(out, "w", encoding="utf-8")
    try:
        with ThreadPoolExecutor(max_workers=a.workers) as ex:
            futs = {ex.submit(fetch_origin, o): o for o in origins}
            for fut in as_completed(futs):
                o = futs[fut]
                try:
                    f = fut.result()
                except Exception as e:
                    print("  our probe raised %s: %s (not written)" % (type(e).__name__, e), file=sys.stderr)
                    continue
                measured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                with lock:
                    for t in by_origin[o]:
                        row = {"schema": SCHEMA, "endpoint": t["endpoint"], "origin": o,
                               "survey1_record_sha256": t.get("record_sha256"), "survey1_reason": t.get("reason"),
                               "path": match_path(t["endpoint"]), "fetch": f, "measured_at": measured_at}
                        row.update(derive(row))
                        fh.write(json.dumps(W.stamp(row), ensure_ascii=False) + "\n")
                        counts[row["category"]] += 1
                    fh.flush()
                    n += 1
                    if n % 100 == 0 or n == len(origins):
                        print("  %5d / %d origins  %s" % (n, len(origins), "  ".join("%s=%d" % kv for kv in sorted(counts.items()))))
    finally:
        fh.close()
    print("\nwritten: %s\n" % out)
    sys.exit(recompute(out))


if __name__ == "__main__":
    main()
