#!/usr/bin/env python3
"""Citation Radar: a fixed probe set asked of AI answer engines every day, and the Citation Pulse computed from it.

Observation (one line per run, iasf/radar/observations.jsonl, written by the collector):
  {"engine", "ts" (UTC ISO), "qid", "q", "run_no", "web_search_used", "cited_urls" (in display order),
   "hs_cited", "hs_url", "citation_rank" (1-based or null), "answer_mentions_hs"}
Metrics per engine over a window (24 h, 7 days):
  run citation rate   runs that cited HS / runs
  coverage            queries cited at least once / queries asked
  repeatability       mean over cited queries of (cited runs / runs of that query)
  first-source rate   runs where HS was the first citation / runs
  competitor capture  share of runs citing each other domain (top 10)
  pulse               coverage x repeatability x (HS citations / all citations)
Tracks: engine "chatgpt-ui" is the real product (B, reality); a fixed API model would be track A (science). Never
pool the two. A query id is never edited in place (tools/gravity/radar_queries.json).

  python3 tools/gravity/citation_radar.py report [--obs iasf/radar/observations.jsonl] [--engine chatgpt-ui]
  python3 tools/gravity/citation_radar.py selftest
Standard library only.
"""
import collections, datetime, io, json, os, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HS_HOSTS = ("shield.the-horizons-innovation.com", "horizonshield.dev")


def host(u):
    h = urllib.parse.urlparse(u).hostname or ""
    return h[4:] if h.startswith("www.") else h


def is_hs(u):
    h = host(u)
    return any(h == x or h.endswith("." + x) for x in HS_HOSTS)


def parse_ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def metrics(rows):
    if not rows:
        return None
    by_q = collections.defaultdict(list)
    for r in rows:
        by_q[r["qid"]].append(r)
    cited_runs = sum(1 for r in rows if r["hs_cited"])
    cited_q = [q for q, rs in by_q.items() if any(r["hs_cited"] for r in rs)]
    rep = [sum(r["hs_cited"] for r in by_q[q]) / len(by_q[q]) for q in cited_q]
    first = sum(1 for r in rows if r.get("citation_rank") == 1)
    all_cites = sum(len(r["cited_urls"]) for r in rows)
    hs_cites = sum(1 for r in rows for u in r["cited_urls"] if is_hs(u))
    comp = collections.Counter(h for r in rows for h in {host(u) for u in r["cited_urls"] if not is_hs(u)})
    cov = len(cited_q) / len(by_q)
    repeat = sum(rep) / len(rep) if rep else 0.0
    share = hs_cites / all_cites if all_cites else 0.0
    return {"runs": len(rows), "queries": len(by_q), "cited_runs": cited_runs, "cited_queries": sorted(cited_q),
            "run_citation_rate": round(cited_runs / len(rows), 4), "coverage": round(cov, 4), "repeatability": round(repeat, 4),
            "first_source_rate": round(first / len(rows), 4), "hs_citation_share": round(share, 4),
            "pulse": round(cov * repeat * share, 5), "web_search_rate": round(sum(1 for r in rows if r.get("web_search_used")) / len(rows), 4),
            "competitor_capture": [(h, round(n / len(rows), 3)) for h, n in comp.most_common(10)],
            "per_query": {q: "%d/%d" % (sum(r["hs_cited"] for r in rs), len(rs)) for q, rs in sorted(by_q.items())}}


def report(obs, engine=None, now=None):
    rows = [json.loads(l) for l in io.open(obs, encoding="utf-8") if l.strip()]
    rows = [r for r in rows if engine is None or r["engine"] == engine]
    now = now or max(parse_ts(r["ts"]) for r in rows)
    out = {}
    for eng in sorted({r["engine"] for r in rows}):
        er = [r for r in rows if r["engine"] == eng]
        w = {}
        for lab, hours in (("24h", 24), ("7d", 168), ("prev_24h", (48, 24)), ("prev_7d", (336, 168))):
            if isinstance(hours, tuple):
                lo, hi = now - datetime.timedelta(hours=hours[0]), now - datetime.timedelta(hours=hours[1])
            else:
                lo, hi = now - datetime.timedelta(hours=hours), now + datetime.timedelta(seconds=1)
            w[lab] = metrics([r for r in er if lo < parse_ts(r["ts"]) <= hi])
        out[eng] = w
    return out


def show(out):
    for eng, w in out.items():
        m = w["24h"]
        print("== %s  (last 24 h)" % eng)
        if not m:
            print("  no runs"); continue
        print("  runs %d  queries %d  cited runs %d  cited queries %s" % (m["runs"], m["queries"], m["cited_runs"], ",".join(m["cited_queries"]) or "-"))
        for k in ("run_citation_rate", "coverage", "repeatability", "first_source_rate", "hs_citation_share", "pulse", "web_search_rate"):
            d = ""
            if w["prev_24h"]:
                d = "  (24h %+.1f pp)" % (100 * (m[k] - w["prev_24h"][k]))
            print("  %-18s %.4f%s" % (k, m[k], d))
        print("  competitor capture: " + ", ".join("%s %.0f%%" % (h, 100 * s) for h, s in m["competitor_capture"]))
        print("  per query: " + "  ".join("%s %s" % kv for kv in m["per_query"].items()))


def selftest():
    t0 = "2026-10-04T00:00:00Z"
    rows = [{"engine": "e", "ts": t0, "qid": "a", "run_no": i, "web_search_used": True, "cited_urls": (["https://shield.the-horizons-innovation.com/souba/kyutoki/", "https://x.jp/"] if i < 2 else ["https://x.jp/"]),
             "hs_cited": i < 2, "citation_rank": 1 if i == 0 else (2 if i == 1 else None)} for i in range(3)]
    rows += [{"engine": "e", "ts": t0, "qid": "b", "run_no": i, "web_search_used": True, "cited_urls": ["https://y.jp/"], "hs_cited": False, "citation_rank": None} for i in range(3)]
    m = metrics(rows)
    ok1 = m["run_citation_rate"] == round(2 / 6, 4) and m["coverage"] == 0.5 and abs(m["repeatability"] - 2 / 3) < 1e-3
    ok2 = m["first_source_rate"] == round(1 / 6, 4) and m["hs_citation_share"] == round(2 / 8, 4)
    ok3 = is_hs("https://www.shield.the-horizons-innovation.com/x") and not is_hs("https://shield.example.com/")
    tests = [("rates, coverage and repeatability", ok1), ("first source and citation share", ok2), ("HS host match", ok3)]
    for n, r in tests:
        print(("  ok   " if r else "  NG   ") + n)
    print("selftest:", "ALL PASS (%d)" % len(tests) if all(r for _, r in tests) else "FAIL")
    return 0 if all(r for _, r in tests) else 1


def main():
    a = sys.argv[1:]
    if not a or a[0] not in ("report", "selftest"):
        sys.exit(__doc__)
    if a[0] == "selftest":
        return selftest()
    obs = a[a.index("--obs") + 1] if "--obs" in a else os.path.join(ROOT, "iasf", "radar", "observations.jsonl")
    out = report(obs, a[a.index("--engine") + 1] if "--engine" in a else None)
    show(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
