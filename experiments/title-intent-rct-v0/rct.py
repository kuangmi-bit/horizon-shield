#!/usr/bin/env python3
"""gravity-title-intent-rct-v0: does a price-intent <title> make Bing's AI cite a page that a judgement or ad title did not?

Pre-registered in PREREGISTRATION.md (this folder). The pages, their old and new titles and the strata are fixed in
pages.json before the assignment exists. The assignment is drawn from the hash of a Bitcoin block whose height is
fixed in advance (BLOCK_HEIGHT), so nobody, including us, can choose which pages get the new title.

  python3 rct.py check                                   pages.json matches the site; new titles are unique
  python3 rct.py assign --block-hash <64 hex>            writes assignment.json (refuses to overwrite)
  python3 rct.py apply                                   changes the <title> of the treatment pages only
  python3 rct.py analyze <AIPageStatsReport.csv>         primary and secondary outcomes, writes results_<date>.json
  python3 rct.py selftest
Standard library only.
"""
import csv, datetime, hashlib, html, io, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SITE = "https://shield.the-horizons-innovation.com"
EXPERIMENT = "gravity-title-intent-rct-v0"
BLOCK_HEIGHT = 969900
TITLE_RE = re.compile(r"(?is)<title[^>]*>(.*?)</title>")


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def local(p):
    import urllib.parse
    f = urllib.parse.unquote(p).lstrip("/")
    return os.path.join(ROOT, "index.html" if f == "" else (f + "index.html" if f.endswith("/") else f))


def text(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def load_pages():
    raw = io.open(os.path.join(HERE, "pages.json"), "rb").read()
    return json.loads(raw.decode("utf-8")), sha(raw)


def site_titles():
    out = {}
    for name in ("sitemap.xml", "sitemap-archive.xml", "sitemap-yakumo.xml"):
        fp = os.path.join(ROOT, name)
        if not os.path.exists(fp):
            continue
        for loc in re.findall(r"<loc>" + re.escape(SITE) + r"(.*?)</loc>", io.open(fp, encoding="utf-8").read()):
            f = local(loc)
            if os.path.exists(f):
                m = TITLE_RE.findall(io.open(f, encoding="utf-8", errors="replace").read())
                if m:
                    out[loc] = text(m[0])
    return out


def assign_rows(rows, block_hash):
    """within each stratum: order pages by sha256(experiment|block_hash|page); the first ceil(n/2) are treatment"""
    out = []
    for st in sorted({r["stratum"] for r in rows}):
        rs = sorted((r for r in rows if r["stratum"] == st), key=lambda r: sha(("%s|%s|%s" % (EXPERIMENT, block_hash, r["page"])).encode()))
        k = (len(rs) + 1) // 2
        for i, r in enumerate(rs):
            out.append({"page": r["page"], "stratum": st, "arm": "treatment" if i < k else "control",
                        "key": sha(("%s|%s|%s" % (EXPERIMENT, block_hash, r["page"])).encode())})
    return sorted(out, key=lambda x: x["page"])


def cmd_check():
    d, psha = load_pages()
    titles = site_titles()
    asg = {}
    ap = os.path.join(HERE, "assignment.json")
    if os.path.exists(ap):
        asg = {r["page"]: r["arm"] for r in json.load(io.open(ap, encoding="utf-8"))["rows"]}
    bad = 0
    for r in d["pages"]:
        f = local(r["page"])
        h = io.open(f, encoding="utf-8", errors="replace").read()
        m = TITLE_RE.findall(h)
        if len(m) != 1:
            print("NG  %s: %d <title> tags" % (r["page"], len(m))); bad += 1; continue
        cur = text(m[0])
        expect = r["new_title"] if asg.get(r["page"]) == "treatment" and cur != r["old_title"] else r["old_title"]
        if cur != expect:
            print("NG  %s: title is %r, expected %r" % (r["page"], cur, expect)); bad += 1
        others = [p for p, t in titles.items() if t == r["new_title"] and p != r["page"]]
        if others:
            print("NG  %s: new title already used by %s" % (r["page"], others)); bad += 1
    news = [r["new_title"] for r in d["pages"]]
    if len(set(news)) != len(news):
        print("NG  new titles are not unique among themselves"); bad += 1
    print("check: %d pages, pages.json sha256 %s, %s" % (len(d["pages"]), psha, "PASS" if not bad else "FAIL (%d)" % bad))
    return 0 if not bad else 1


def cmd_assign(block_hash):
    if not re.fullmatch(r"[0-9a-f]{64}", block_hash or ""):
        sys.exit("assign: --block-hash must be the 64 lowercase hex hash of Bitcoin block %d" % BLOCK_HEIGHT)
    ap = os.path.join(HERE, "assignment.json")
    if os.path.exists(ap):
        sys.exit("assign: assignment.json exists; the assignment is drawn once and never redrawn")
    d, psha = load_pages()
    rows = assign_rows(d["pages"], block_hash)
    body = {"schema": "gravity-title-intent-rct-v0-assignment", "experiment_id": EXPERIMENT, "block_height": BLOCK_HEIGHT,
            "block_hash": block_hash, "pages_json_sha256": psha, "rule": "within each stratum, order pages by sha256(experiment_id|block_hash|page); first ceil(n/2) are treatment",
            "rows": rows}
    body["assignment_sha256"] = sha(canon(body))
    json.dump(body, io.open(ap, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for st in sorted({r["stratum"] for r in rows}):
        t = [r["page"] for r in rows if r["stratum"] == st and r["arm"] == "treatment"]
        print("%-15s treatment %d / control %d" % (st, len(t), sum(1 for r in rows if r["stratum"] == st) - len(t)))
    print("assignment_sha256 %s" % body["assignment_sha256"])
    return 0


def cmd_apply():
    ap = os.path.join(HERE, "assignment.json")
    if not os.path.exists(ap):
        sys.exit("apply: no assignment.json; run assign first")
    asg = json.load(io.open(ap, encoding="utf-8"))
    d, psha = load_pages()
    if asg["pages_json_sha256"] != psha:
        sys.exit("apply: pages.json changed after the assignment (%s != %s)" % (psha, asg["pages_json_sha256"]))
    arm = {r["page"]: r["arm"] for r in asg["rows"]}
    changed = 0
    for r in d["pages"]:
        if arm[r["page"]] != "treatment":
            continue
        f = local(r["page"])
        h = io.open(f, encoding="utf-8").read()
        m = list(TITLE_RE.finditer(h))
        if len(m) != 1:
            sys.exit("apply: %s has %d <title> tags" % (r["page"], len(m)))
        cur = text(m[0].group(1))
        if cur == r["new_title"]:
            continue
        if cur != r["old_title"]:
            sys.exit("apply: %s title is %r, not the registered old title" % (r["page"], cur))
        new = h[:m[0].start(1)] + html.escape(r["new_title"], quote=False) + h[m[0].end(1):]
        io.open(f, "w", encoding="utf-8").write(new)
        changed += 1
        print("  title changed: %s" % r["page"])
    print("apply: %d treatment titles changed, control pages untouched" % changed)
    return 0


def fisher_one_sided(a, n1, c, n2):
    """P(X >= a) for X ~ hypergeometric: a cited of n1 treatment, c cited of n2 control"""
    k = a + c; N = n1 + n2
    tot = math.comb(N, k)
    return sum(math.comb(n1, x) * math.comb(n2, k - x) for x in range(a, min(n1, k) + 1)) / tot


def wilson(x, n, z=1.959964):
    if n == 0:
        return (0.0, 1.0)
    p = x / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def newcombe(x1, n1, x2, n2):
    l1, u1 = wilson(x1, n1); l2, u2 = wilson(x2, n2)
    p1, p2 = x1 / n1, x2 / n2
    return (p1 - p2 - math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2), p1 - p2 + math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2))


def read_export(path):
    import urllib.parse
    out = {}
    for r in csv.DictReader(io.open(path, encoding="utf-8-sig")):
        k = [x for x in r if x.strip() in ("ページ", "Page", "URL")][0]
        c = [x for x in r if x.strip().lower() == "citations"][0]
        p = urllib.parse.unquote(r[k].replace(SITE, "")) or "/"
        out[p] = int(str(r[c]).replace(",", "") or 0)
    return out


def analyze(rows, cites):
    res = {}
    for st in [None] + sorted({r["stratum"] for r in rows}):
        rs = [r for r in rows if st is None or r["stratum"] == st]
        t = [cites.get(r["page"], 0) for r in rs if r["arm"] == "treatment"]
        c = [cites.get(r["page"], 0) for r in rs if r["arm"] == "control"]
        a, b = sum(1 for x in t if x > 0), sum(1 for x in c if x > 0)
        lo, hi = newcombe(a, len(t), b, len(c))
        res[st or "pooled"] = {"treatment_cited": a, "treatment_n": len(t), "control_cited": b, "control_n": len(c),
                               "ate_pp": round(100 * (a / len(t) - b / len(c)), 1), "ate_95ci_pp": [round(100 * lo, 1), round(100 * hi, 1)],
                               "fisher_one_sided_p": round(fisher_one_sided(a, len(t), b, len(c)), 4),
                               "citations_treatment": sum(t), "citations_control": sum(c)}
    return res


def cmd_analyze(path):
    asg = json.load(io.open(os.path.join(HERE, "assignment.json"), encoding="utf-8"))
    cites = read_export(path)
    res = analyze(asg["rows"], cites)
    out = {"schema": "gravity-title-intent-rct-v0-results", "export": os.path.basename(path), "export_sha256": sha(io.open(path, "rb").read()),
           "assignment_sha256": asg["assignment_sha256"], "primary": "pooled: P(cited >= 1 | treatment) - P(cited >= 1 | control), Fisher exact one-sided, alpha 0.05",
           "results": res}
    fp = os.path.join(HERE, "results_%s.json" % datetime.date.today().isoformat())
    json.dump(out, io.open(fp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k, v in res.items():
        print("%-15s treatment %d/%d  control %d/%d  ATE %+.1f pp [%+.1f, %+.1f]  Fisher p %.4f  citations %d vs %d" % (
            k, v["treatment_cited"], v["treatment_n"], v["control_cited"], v["control_n"], v["ate_pp"], *v["ate_95ci_pp"],
            v["fisher_one_sided_p"], v["citations_treatment"], v["citations_control"]))
    print("written:", fp)
    return 0


def selftest():
    rows = [{"page": "/p%02d/" % i, "stratum": "a" if i < 18 else "b"} for i in range(35)]
    a1 = assign_rows(rows, "0" * 64); a2 = assign_rows(rows, "0" * 64); a3 = assign_rows(rows, "f" * 64)
    ok1 = a1 == a2 and a1 != a3
    ok2 = sum(r["arm"] == "treatment" for r in a1 if r["stratum"] == "a") == 9 and sum(r["arm"] == "treatment" for r in a1 if r["stratum"] == "b") == 9
    ok3 = abs(fisher_one_sided(8, 18, 1, 17) - 0.0109) < 0.002 and fisher_one_sided(0, 18, 0, 17) == 1.0
    lo, hi = newcombe(8, 18, 1, 17)
    ok4 = lo > 0 and hi < 0.7
    cites = {r["page"]: (3 if r["arm"] == "treatment" and int(r["page"][2:4]) % 2 else 0) for r in a1}
    res = analyze(a1, cites)
    ok5 = res["pooled"]["control_cited"] == 0 and res["pooled"]["treatment_cited"] > 0
    tests = [("assignment is a pure function of the block hash", ok1), ("strata split ceil(n/2) to treatment", ok2),
             ("Fisher exact one-sided", ok3), ("Newcombe interval", ok4), ("analysis counts arms correctly", ok5)]
    for n, r in tests:
        print(("  ok   " if r else "  NG   ") + n)
    print("selftest:", "ALL PASS (%d)" % len(tests) if all(r for _, r in tests) else "FAIL")
    return 0 if all(r for _, r in tests) else 1


def main():
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "selftest":
        return selftest()
    if a[0] == "check":
        return cmd_check()
    if a[0] == "assign":
        return cmd_assign(a[a.index("--block-hash") + 1] if "--block-hash" in a else None)
    if a[0] == "apply":
        return cmd_apply()
    if a[0] == "analyze" and len(a) > 1:
        return cmd_analyze(a[1])
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main())
