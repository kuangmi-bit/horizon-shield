#!/usr/bin/env python3
"""GRAVITY-v0, part 4: learn the gravity weights from real AI citations (Bing Webmaster Tools, AI page stats).

Target: citations per page from the Bing AI page stats export (*AIPageStatsReport*.csv), which counts how often
Bing's AI answers (Copilot, and the Bing index behind ChatGPT search) cited each of our pages. Every page in our three
sitemaps that is absent from the export counts as 0.
Features: measured on the page files in this repository, the same family as gravity_margin.py, but query-free
(a page answers many queries), plus where the page sits (section, core or archive sitemap) and how many of our own
pages link to it.

Two fits, both ridge-regularised on standardised features, with bootstrap 90% intervals:
  1. P(cited at all): logistic regression
  2. log(1 + citations) among all pages: linear regression
This is observational: a coefficient says what Bing's AI rewarded across our pages, not what causes a citation.
Pages differ in age and in how long Bing has known them, which the fits cannot separate from content.

Out-of-sample check (always run): repeated k-fold cross-validation (default 10 repeats x 5 folds). Each held-out page
is predicted by a model that never saw it; reported are R2 on log(1+citations), Spearman rank correlation and the AUC of
P(cited), each with the min..max over repeats, against a baseline that knows only the section and sitemap. Sign
stability: the share of bootstrap fits in which each coefficient is positive.

Usage: python3 tools/gravity/gravity_fit_bing.py <AIPageStatsReport.csv> [--boot 300] [--repeats 10] [--folds 5]
Writes iasf/gravity/bing_fit_<date>.json and .md. Needs numpy.
"""
import csv, collections, datetime, html, io, json, math, os, re, sys, urllib.parse
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "gravity"))
import gravity_margin as G  # noqa: E402

SITE = "https://shield.the-horizons-innovation.com"


def local(p):
    p = urllib.parse.unquote(p)
    f = p.lstrip("/")
    return "index.html" if f == "" else (f + "index.html" if f.endswith("/") else f)


def norm(p):
    p = urllib.parse.unquote(p.replace(SITE, ""))
    return p if p else "/"


def load_pages():
    sm = {}
    for name, tag in (("sitemap.xml", "core"), ("sitemap-archive.xml", "archive"), ("sitemap-yakumo.xml", "yakumo")):
        fp = os.path.join(ROOT, name)
        if os.path.exists(fp):
            for p in re.findall(r"<loc>" + re.escape(SITE) + r"(.*?)</loc>", io.open(fp, encoding="utf-8").read()):
                sm.setdefault(norm(p), tag)
    return sm


def inbound_links(pages):
    cnt = collections.Counter()
    for p in pages:
        fp = os.path.join(ROOT, local(p))
        h = io.open(fp, encoding="utf-8", errors="replace").read()
        for href in set(re.findall(r'href="([^"#?]+)', h)):
            if href.startswith(SITE):
                href = href[len(SITE):]
            if href.startswith("/"):
                q = norm(href)
                if q in pages and q != p:
                    cnt[q] += 1
    return cnt


def features(p, tag, inbound, now):
    h = io.open(os.path.join(ROOT, local(p)), encoding="utf-8", errors="replace").read()
    title = " ".join(G.tags(h, "title"))
    raw = G.raw_features(title, h, now=now)
    m = raw["_meta"]
    sec = p.strip("/").split("/")[0] if p != "/" else "top"
    sec = sec.split(".")[0] if "." in sec else sec
    return {
        "yen_amounts": math.log1p(m["yen"]),
        "quantities": math.log1p(m["qty"]),
        "tables": math.log1p(m["tables"]),
        "ordered_steps": math.log1p(m["ol_items"]),
        "self_check_steps": math.log1p(m["woven_items"]),
        "faq_jsonld": float(m["faq"]),
        "raw_proof_terms": math.log1p(m["raw_proof"]),
        "text_chars": math.log1p(m["text_chars"]),
        "age_days": min(-raw["F"], 730.0) / 30.0,
        "title_has_tekisei": 1.0 if "適正" in title else 0.0,
        "title_has_souba": 1.0 if "相場" in title else 0.0,
        "title_has_question": 1.0 if re.search(r"[?？]|高い|妥当|いくら", title) else 0.0,
        "title_has_number": 1.0 if re.search(r"[0-9０-９]", title) else 0.0,
        "in_core_sitemap": 1.0 if tag == "core" else 0.0,
        "section_aeo": 1.0 if sec == "aeo" else 0.0,
        "section_souba": 1.0 if sec == "souba" else 0.0,
        "internal_inbound_links": math.log1p(inbound.get(p, 0)),
    }


def ridge_logistic(X, y, lam=1.0, iters=3000, lr=0.2):
    n, k = X.shape
    w = np.zeros(k); b = 0.0
    for _ in range(iters):
        z = np.clip(X @ w + b, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (p - y) / n + lam * w / n
        w -= lr * g; b -= lr * float(np.mean(p - y))
    return w, b


def ridge_linear(X, y, lam=1.0):
    n, k = X.shape
    Xa = np.hstack([X, np.ones((n, 1))])
    R = lam * np.eye(k + 1); R[-1, -1] = 0
    beta = np.linalg.solve(Xa.T @ Xa + R, Xa.T @ y)
    return beta[:-1], beta[-1]


def rank(a):
    o = np.argsort(a, kind="mergesort"); r = np.empty(len(a)); r[o] = np.arange(len(a))
    for v in np.unique(a):
        m = a == v
        if m.sum() > 1:
            r[m] = r[m].mean()
    return r


def spearman(a, b):
    ra, rb = rank(np.asarray(a, float)), rank(np.asarray(b, float))
    if ra.std() == 0 or rb.std() == 0:
        return 0.0
    return float(np.corrcoef(ra, rb)[0, 1])


def auc(score, y):
    pos, neg = score[y == 1], score[y == 0]
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    r = rank(np.concatenate([pos, neg]))
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) - 1) / 2) / (len(pos) * len(neg)))


def cross_validate(Z, yc, yl, cols, repeats, folds, seed=20261004):
    rng = np.random.default_rng(seed)
    n = len(yl); res = {"r2": [], "spearman": [], "auc_cited": []}
    for _ in range(repeats):
        perm = rng.permutation(n); pl = np.zeros(n); pc = np.zeros(n)
        for f in range(folds):
            te = perm[f::folds]; tr = np.setdiff1d(perm, te)
            Xtr, Xte = Z[tr][:, cols], Z[te][:, cols]
            b, c0 = ridge_linear(Xtr, yl[tr]); pl[te] = Xte @ b + c0
            w, w0 = ridge_logistic(Xtr, yc[tr], iters=800); pc[te] = Xte @ w + w0
        res["r2"].append(1 - float(np.sum((yl - pl) ** 2)) / float(np.sum((yl - yl.mean()) ** 2)))
        res["spearman"].append(spearman(pl, yl)); res["auc_cited"].append(auc(pc, yc))
    return {k: {"mean": round(float(np.mean(v)), 3), "min": round(float(np.min(v)), 3), "max": round(float(np.max(v)), 3)} for k, v in res.items()}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    arg = lambda k, d: int(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
    boot, repeats, folds = arg("--boot", 300), arg("--repeats", 10), arg("--folds", 5)
    now = datetime.date.today()
    cites = {}
    for r in csv.DictReader(io.open(path, encoding="utf-8-sig")):
        k = [x for x in r if x.strip() in ("ページ", "Page", "URL")][0]
        c = [x for x in r if x.strip().lower() == "citations"][0]
        cites[norm(r[k])] = int(str(r[c]).replace(",", "") or 0)
    sm = load_pages()
    pages = sorted(sm)
    inbound = inbound_links(set(pages))
    rows = [(p, features(p, sm[p], inbound, now), cites.get(p, 0)) for p in pages]
    names = list(rows[0][1].keys())
    X = np.array([[f[n] for n in names] for _, f, _ in rows], dtype=float)
    mu, sd = X.mean(0), X.std(0); sd[sd == 0] = 1
    Z = (X - mu) / sd
    yc = np.array([1.0 if c > 0 else 0.0 for *_, c in rows])
    yl = np.array([math.log1p(c) for *_, c in rows])
    wl, _ = ridge_logistic(Z, yc)
    bl, _ = ridge_linear(Z, yl)
    rng = np.random.default_rng(20261004)
    BL, BC = [], []
    for _ in range(boot):
        idx = rng.integers(0, len(rows), len(rows))
        BC.append(ridge_logistic(Z[idx], yc[idx], iters=800)[0])
        BL.append(ridge_linear(Z[idx], yl[idx])[0])
    BL, BC = np.array(BL), np.array(BC)
    pred = Z @ bl
    ss_res = float(np.sum((yl - pred - (yl.mean() - pred.mean())) ** 2)); ss_tot = float(np.sum((yl - yl.mean()) ** 2))
    out = {"schema": "gravity-bing-fit-v0", "export": os.path.basename(path), "pages": len(rows), "cited_pages": int(yc.sum()),
           "citations_total": int(sum(c for *_, c in rows)), "citations_on_sitemap_pages": int(sum(c for *_, c in rows)),
           "export_pages_not_in_sitemaps": sorted(set(cites) - set(pages))[:50], "r2_log_citations": round(1 - ss_res / ss_tot, 3),
           "coefficients": []}
    base_cols = [i for i, n in enumerate(names) if n.startswith("section_") or n == "in_core_sitemap"]
    out["cross_validation"] = {"repeats": repeats, "folds": folds,
                               "model": cross_validate(Z, yc, yl, list(range(len(names))), repeats, folds),
                               "baseline_section_and_sitemap_only": cross_validate(Z, yc, yl, base_cols, repeats, folds)}
    for i, n in enumerate(names):
        out["coefficients"].append({"feature": n, "cited_logit": round(float(wl[i]), 3),
                                    "cited_logit_90": [round(float(np.percentile(BC[:, i], 5)), 3), round(float(np.percentile(BC[:, i], 95)), 3)],
                                    "log_citations": round(float(bl[i]), 3),
                                    "log_citations_90": [round(float(np.percentile(BL[:, i], 5)), 3), round(float(np.percentile(BL[:, i], 95)), 3)],
                                    "log_citations_positive_share": round(float(np.mean(BL[:, i] > 0)), 2),
                                    "cited_logit_positive_share": round(float(np.mean(BC[:, i] > 0)), 2)})
    out["coefficients"].sort(key=lambda c: -abs(c["log_citations"]))
    top = sorted(rows, key=lambda r: -r[2])[:15]
    out["top_pages"] = [{"page": p, "citations": c} for p, _, c in top]
    od = os.path.join(ROOT, "iasf", "gravity"); os.makedirs(od, exist_ok=True)
    stem = os.path.join(od, "bing_fit_%s" % now.isoformat())
    json.dump(out, io.open(stem + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    L = ["# What Bing's AI rewarded across our pages (%s)" % out["export"], "",
         "pages %d, cited %d, citations %d, R2 on log(1+citations) %.3f" % (out["pages"], out["cited_pages"], out["citations_total"], out["r2_log_citations"]), "",
         "Out of sample (%d x %d-fold; mean, min..max over repeats):" % (repeats, folds), "",
         "| | R2 log(1+citations) | Spearman | AUC P(cited) |", "|---|---|---|---|"]
    for lab, key in (("model", "model"), ("baseline: section + sitemap only", "baseline_section_and_sitemap_only")):
        cv = out["cross_validation"][key]
        L.append("| %s | %s | %s | %s |" % (lab, *["%.3f (%.3f..%.3f)" % (cv[m]["mean"], cv[m]["min"], cv[m]["max"]) for m in ("r2", "spearman", "auc_cited")]))
    L += ["", "| feature | log(1+citations), per 1 sd | 90% | share > 0 | P(cited) logit | 90% |", "|---|---|---|---|---|---|"]
    for c in out["coefficients"]:
        L.append("| %s | %+.3f | %+.3f..%+.3f | %.2f | %+.3f | %+.3f..%+.3f |" % (c["feature"], c["log_citations"], c["log_citations_90"][0], c["log_citations_90"][1],
                 c["log_citations_positive_share"], c["cited_logit"], c["cited_logit_90"][0], c["cited_logit_90"][1]))
    io.open(stem + ".md", "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("\n".join(L))
    if out["export_pages_not_in_sitemaps"]:
        print("\ncited pages that are in no sitemap (not in the fit):", len(set(cites) - set(pages)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
