#!/usr/bin/env python3
"""GRAVITY-v0, part 4: learn the gravity weights from real AI citations (Bing Webmaster Tools, AI page stats).

Target: citations per page from the Bing AI page stats export (*AIPageStatsReport*.csv), which counts how often
Bing's AI answers (Copilot, and the Bing index behind ChatGPT search) cited each of our pages. Every page in our three
sitemaps that is absent from the export counts as 0.
Features: measured on the page files in this repository, the same family as gravity_margin.py, but query-free
(a page answers many queries), plus where the page sits (section, core or archive sitemap) and how many of our own
pages link to it.

Three fits, all ridge-regularised on standardised features, with bootstrap 90% intervals:
  1. P(cited at all): logistic regression
  2. log(1 + citations) among all pages: linear regression
  3. The GRAVITY-v0 formula itself: G_i = sum_k w_k f_ik, and each citation lands on page i with probability
     softmax(G)_i = exp(G_i) / sum_j exp(G_j). The softmax over pages, fitted on citation counts, has the same weights
     as a Poisson log-linear model with an intercept (Baker 1994, the multinomial-Poisson transformation), so it is
     fitted that way. These w are the gravity weights learned from Bing, and they feed gravity_margin.py --weights bing
     through iasf/gravity/weights_bing.json (all features, and a content-only refit that can score any page).
     Levers: for each of our pages, the expected extra citations from one concrete change (相場 or 適正 in the title,
     one more table, FAQPage JSON-LD): E_i x (exp(dG) - 1), where E_i is the page's expected share of the citations.
     dG is given twice: with the fitted w, and with the cautious w (the bootstrap 5th percentile of each positive
     weight, floored at 0). Levers are ranked by the cautious gain, because the softmax weights lean on the most cited
     pages and the data are observational: a lever is where to try first, then measure, not a promise.
This is observational: a coefficient says what Bing's AI rewarded across our pages, not what causes a citation.
Pages differ in age and in how long Bing has known them, which the fits cannot separate from content.

Out-of-sample check (always run): repeated k-fold cross-validation (default 10 repeats x 5 folds). Each held-out page
is predicted by a model that never saw it; reported are R2 on log(1+citations), Spearman rank correlation and the AUC of
P(cited), each with the min..max over repeats, against a baseline that knows only the section and sitemap. Sign
stability: the share of bootstrap fits in which each coefficient is positive.

Gates found by testing on the 10/01 export (iasf 2026-10-04): no page younger than 60 days since its first commit was
cited (62 of 62 at zero), and pages whose body text is 70% or more the same as another of our pages were almost never
cited (1 of 54). Both enter the fit as switches: younger_than_60d (first publication from git history; skipped when
git is not available) and dup_over_0.7 (exact Jaccard of body-text 4-gram shingles to the nearest page). topic_siblings counts our other pages on
the same work (first word of the slug): Bing tends to cite one page per topic from a site, so siblings split it.
Title intent (found on 10/04 by explaining why all 18 */-check pages were never cited): titles that frame a judgement
(これ高い, 高い？, 妥当) or carry ad wording (無料, AI診断, 今すぐ) were almost never cited (judgement 1 of 36), while price
titles (相場, 費用, 価格, 単価) were cited on 46% of pages. Both are content features (title_judgement, title_ad_words).
Walk-forward test: learn only on pages first published before a month, predict that month (May, June, July), the
strictest test of whether the formula generalises forward in time.
The headline test holds out whole months of first publication, one at a time, and scores pages at least 60 days old:
pages made from the same template in the same batch cannot leak into their own test.

For the softmax fit the cross-validation also reports capture@10%: the share of held-out citations that falls on the
10% of held-out pages the model ranks highest (10% by chance).

Usage: python3 tools/gravity/gravity_fit_bing.py <AIPageStatsReport.csv> [--boot 300] [--repeats 10] [--folds 5]
       python3 tools/gravity/gravity_fit_bing.py --selftest
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
    sec = p.strip("/").split("/")[0] if p != "/" else "top"
    sec = sec.split(".")[0] if "." in sec else sec
    f = G.content_features(title, h, now=now)
    f.update({
        "in_core_sitemap": 1.0 if tag == "core" else 0.0,
        "section_aeo": 1.0 if sec == "aeo" else 0.0,
        "section_souba": 1.0 if sec == "souba" else 0.0,
        "internal_inbound_links": math.log1p(inbound.get(p, 0)),
    })
    return f


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


def first_published(paths):
    """first commit date of each page file, from git history ({} when git is not available).
    GRAVITY_GIT_DIR may point at another clone's .git when the working copy has none."""
    import subprocess
    try:
        gd = os.environ.get("GRAVITY_GIT_DIR")
        out = subprocess.run(["git"] + (["--git-dir", gd] if gd else []) + ["-c", "core.quotepath=off", "log", "--diff-filter=A", "--name-only", "--format=@%ad", "--date=short"],
                             cwd=ROOT, capture_output=True, text=True, timeout=300).stdout
    except Exception:
        return {}
    first, cur = {}, None
    for line in out.splitlines():
        if line.startswith("@"):
            cur = line[1:]
        elif line and (line not in first or cur < first[line]):
            first[line] = cur
    return {p: first[local(p)] for p in paths if local(p) in first}


def dup_max_similarity(paths, sample=8, candidates=5):
    """for each page, the exact Jaccard similarity of its body text (4-gram shingles) to its most similar other page.
    Candidates come from an inverted index on 1 in `sample` shingles; similarity is then computed exactly
    (a MinHash estimate overstated it near 0.7, where the citation cliff is)."""
    import zlib
    sh = []
    for p in paths:
        t = G.text_of(io.open(os.path.join(ROOT, local(p)), encoding="utf-8", errors="replace").read())
        sh.append({zlib.crc32(t[i:i + 4].encode()) for i in range(max(1, len(t) - 3))})
    idx = collections.defaultdict(list)
    for i, s_ in enumerate(sh):
        for x in s_:
            if x % sample == 0:
                idx[x].append(i)
    best = np.zeros(len(paths)); arg = np.zeros(len(paths), dtype=int)
    for i, s_ in enumerate(sh):
        cnt = collections.Counter(j for x in s_ if x % sample == 0 for j in idx[x] if j != i)
        for j, _ in cnt.most_common(candidates):
            jac = len(s_ & sh[j]) / max(1, len(s_ | sh[j]))
            if jac > best[i]:
                best[i], arg[i] = jac, j
    return best, arg


def topic(p):
    parts = [x for x in urllib.parse.unquote(p).strip("/").split("/") if x]
    if len(parts) < 2:
        return p
    slug = re.sub(r"\.html$", "", parts[1])
    return parts[0] + "/" + re.split(r"[-・_]", slug)[0]


def ridge_poisson(X, y, lam=1.0, iters=100):
    """log E[y] = X w + b, Newton with step halving on the penalised log-likelihood. Same w as softmax over rows."""
    n, k = X.shape
    Xa = np.hstack([X, np.ones((n, 1))])
    R = lam * np.eye(k + 1); R[-1, -1] = 0
    beta = np.zeros(k + 1); beta[-1] = math.log(max(y.mean(), 1e-9))

    def ll(b):
        eta = np.clip(Xa @ b, -30, 30)
        return float(np.sum(y * eta - np.exp(eta)) - 0.5 * b @ R @ b)
    cur = ll(beta)
    for _ in range(iters):
        mu = np.exp(np.clip(Xa @ beta, -30, 30))
        g = Xa.T @ (y - mu) - R @ beta
        H = Xa.T @ (Xa * mu[:, None]) + R + 1e-9 * np.eye(k + 1)
        step = np.linalg.solve(H, g)
        t = 1.0
        while t > 1e-6:
            nb = beta + t * step; nl = ll(nb)
            if nl >= cur - 1e-12:
                break
            t /= 2
        if abs(nl - cur) < 1e-9 * (1 + abs(cur)):
            beta, cur = nb, nl
            break
        beta, cur = nb, nl
    return beta[:-1], beta[-1]


def softmax_cv_grouped(Z, counts, cols, groups, mask):
    """hold out each group (month of first publication) in turn; score only rows in mask"""
    g = np.zeros(len(counts))
    for m in sorted(set(groups)):
        te = np.where(groups == m)[0]; tr = np.where(groups != m)[0]
        if len(tr) == 0:
            continue
        w, b = ridge_poisson(Z[tr][:, cols], counts[tr]); g[te] = Z[te][:, cols] @ w + b
    gg, yy = g[mask], counts[mask]
    top = np.argsort(-gg)[:max(1, len(gg) // 10)]
    return {"spearman": round(spearman(gg, yy), 3), "auc_cited": round(auc(gg, (yy > 0).astype(float)), 3),
            "capture_at_10pct": round(float(yy[top].sum() / max(yy.sum(), 1)), 3), "pages_scored": int(mask.sum())}


def walk_forward(Z, counts, cols, months, mask, test_months, gate=None):
    """train on months before m, test on m (rows in mask); a month counts only with 100+ training and 20+ test pages. gate: rows pushed to the bottom (younger than 60 days or
    70%+ duplicate). Returns per-month and mean Spearman, AUC and capture@10%."""
    per = {}
    for m in test_months:
        te = np.where((months == m) & mask)[0]; tr = np.where(months < m)[0]
        if len(te) < 20 or len(tr) < 100 or counts[te].sum() == 0:
            continue
        w, b = ridge_poisson(Z[tr][:, cols], counts[tr]); g = Z[te][:, cols] @ w + b
        if gate is not None:
            g = g - 10.0 * gate[te]
        yy = counts[te]; top = np.argsort(-g)[:max(1, len(te) // 10)]
        per[m] = {"spearman": round(spearman(g, yy), 3), "auc_cited": round(auc(g, (yy > 0).astype(float)), 3),
                  "capture_at_10pct": round(float(yy[top].sum() / yy.sum()), 3), "test_pages": int(len(te)), "train_pages": int(len(tr))}
    mean = {k: round(float(np.mean([v[k] for v in per.values()])), 3) for k in ("spearman", "auc_cited", "capture_at_10pct")} if per else {}
    return {"per_month": per, "mean": mean}


def softmax_cv(Z, counts, cols, repeats, folds, seed=20261004):
    """held-out pages scored by a softmax fitted without them; Spearman, capture@10%, out-of-sample deviance explained"""
    rng = np.random.default_rng(seed)
    n = len(counts); res = {"spearman": [], "capture_at_10pct": [], "deviance_explained": []}
    for _ in range(repeats):
        perm = rng.permutation(n); g = np.zeros(n)
        for f in range(folds):
            te = perm[f::folds]; tr = np.setdiff1d(perm, te)
            w, b = ridge_poisson(Z[tr][:, cols], counts[tr])
            g[te] = Z[te][:, cols] @ w + b
        res["spearman"].append(spearman(g, counts))
        top = np.argsort(-g)[:max(1, n // 10)]
        res["capture_at_10pct"].append(float(counts[top].sum() / max(counts.sum(), 1)))
        mu = np.exp(np.clip(g, -30, 30)); mu *= counts.sum() / mu.sum()
        dev = 2 * np.sum(np.where(counts > 0, counts * np.log(np.where(counts > 0, counts, 1) / mu), 0) - (counts - mu))
        m0 = counts.mean()
        dev0 = 2 * np.sum(np.where(counts > 0, counts * np.log(np.where(counts > 0, counts, 1) / m0), 0) - (counts - m0))
        res["deviance_explained"].append(1 - float(dev / dev0))
    return {k: {"mean": round(float(np.mean(v)), 3), "min": round(float(np.min(v)), 3), "max": round(float(np.max(v)), 3)} for k, v in res.items()}


LEVERS = {
    "title_souba": ("相場 in the title", lambda f: dict(f, title_has_souba=1.0) if f["title_has_souba"] == 0 else None),
    "title_tekisei": ("適正 in the title", lambda f: dict(f, title_has_tekisei=1.0) if f["title_has_tekisei"] == 0 else None),
    "one_more_table": ("one more table", lambda f: dict(f, tables=math.log1p(math.expm1(f["tables"]) + 1))),
    "faq_jsonld": ("FAQPage JSON-LD", lambda f: dict(f, faq_jsonld=1.0) if f["faq_jsonld"] == 0 else None),
}


def levers(rows, names, mu, sd, w, b, total, w_low=None):
    """expected extra citations per page and change: E_i (exp(dG) - 1), E_i = total x softmax(G)_i.
    w_low: cautious weights; the ranking uses them when given"""
    w_low = w if w_low is None else w_low
    Zs = np.array([[(f[n] - mu[j]) / sd[j] for j, n in enumerate(names)] for _, f, _ in rows])
    g = Zs @ w + b
    e = np.exp(g - g.max()); e = total * e / e.sum()
    out = []
    for i, (p, f, c) in enumerate(rows):
        combo = dict(f); applied = []
        for key, (label, fn) in LEVERS.items():
            nf = fn(f)
            if nf is None:
                continue
            dg = sum(w[j] * (nf[n] - f[n]) / sd[j] for j, n in enumerate(names))
            dl = sum(w_low[j] * (nf[n] - f[n]) / sd[j] for j, n in enumerate(names))
            out.append({"page": p, "lever": key, "label": label, "citations_now": c, "expected_now": round(float(e[i]), 2),
                        "dG": round(float(dg), 3), "expected_gain": round(float(e[i] * (math.exp(dg) - 1)), 2),
                        "dG_cautious": round(float(dl), 3), "expected_gain_cautious": round(float(e[i] * (math.exp(dl) - 1)), 2)})
            combo = fn(combo) or combo; applied.append(key)
        if len(applied) > 1:
            dg = sum(w[j] * (combo[n] - f[n]) / sd[j] for j, n in enumerate(names))
            dl = sum(w_low[j] * (combo[n] - f[n]) / sd[j] for j, n in enumerate(names))
            out.append({"page": p, "lever": "+".join(applied), "label": "all of: " + ", ".join(LEVERS[a][0] for a in applied),
                        "citations_now": c, "expected_now": round(float(e[i]), 2), "dG": round(float(dg), 3),
                        "expected_gain": round(float(e[i] * (math.exp(dg) - 1)), 2),
                        "dG_cautious": round(float(dl), 3), "expected_gain_cautious": round(float(e[i] * (math.exp(dl) - 1)), 2)})
    return sorted(out, key=lambda x: -x["expected_gain_cautious"])


def selftest():
    rng = np.random.default_rng(1)
    n, true = 600, np.array([0.8, -0.5, 0.0])
    X = rng.normal(size=(n, 3)); y = rng.poisson(np.exp(X @ true + 1.0)).astype(float)
    w, b = ridge_poisson(X, y)
    ok1 = np.max(np.abs(w - true)) < 0.12
    cv = softmax_cv(X, y, [0, 1, 2], 2, 5)
    ok2 = cv["spearman"]["mean"] > 0.4 and cv["capture_at_10pct"]["mean"] > 0.2
    names = ["title_has_souba", "tables", "title_has_tekisei", "faq_jsonld"]
    rows = [("/a/", {"title_has_souba": 0.0, "tables": 0.0, "title_has_tekisei": 1.0, "faq_jsonld": 1.0}, 0),
            ("/b/", {"title_has_souba": 1.0, "tables": math.log1p(2), "title_has_tekisei": 1.0, "faq_jsonld": 1.0}, 10)]
    lv = levers(rows, names, np.zeros(4), np.ones(4), np.array([0.5, 0.5, 0.1, 0.4]), 0.0, 10)
    ok4 = topic("/souba/kyutoki-20man/") == "souba/kyutoki" and topic("/aeo/シロアリ駆除-適正価格.html") == "aeo/シロアリ駆除"
    ok3 = lv[0]["page"] in ("/a/", "/b/") and all(x["expected_gain"] >= 0 for x in lv) and not any(x["lever"] == "title_souba" and x["page"] == "/b/" for x in lv)
    res = [("softmax (Poisson) fit recovers known weights", ok1), ("cross-validation ranks held-out pages", ok2),
           ("levers apply only where the page lacks them and never lose citations at positive weights", ok3),
           ("topic key groups pages on the same work", ok4)]
    for name, r in res:
        print(("  ok   " if r else "  NG   ") + name)
    print("selftest:", "ALL PASS (%d)" % len(res) if all(r for _, r in res) else "FAIL")
    return 0 if all(r for _, r in res) else 1


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
    if "--selftest" in sys.argv:
        return selftest()
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    arg = lambda k, d: int(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
    boot, repeats, folds = arg("--boot", 300), arg("--repeats", 10), arg("--folds", 5)
    m_ = re.search(r"(20\d\d)_(\d\d)_(\d\d)", os.path.basename(path))
    now = datetime.date(int(m_.group(1)), int(m_.group(2)), int(m_.group(3))) if m_ else datetime.date.today()
    cites = {}
    for r in csv.DictReader(io.open(path, encoding="utf-8-sig")):
        k = [x for x in r if x.strip() in ("ページ", "Page", "URL")][0]
        c = [x for x in r if x.strip().lower() == "citations"][0]
        cites[norm(r[k])] = int(str(r[c]).replace(",", "") or 0)
    sm = load_pages()
    pages = sorted(sm)
    inbound = inbound_links(set(pages))
    rows = [(p, features(p, sm[p], inbound, now), cites.get(p, 0)) for p in pages]
    first = first_published(pages)
    have_age = len(first) == len(pages)
    age = {p: (now - datetime.date.fromisoformat(first[p])).days for p in first}
    dmax, darg = dup_max_similarity(pages)
    tcount = collections.Counter(topic(p) for p in pages)
    for i, (p, f, _) in enumerate(rows):
        if have_age:
            f["younger_than_60d"] = 1.0 if age[p] < 60 else 0.0
        f["dup_over_0.7"] = 1.0 if dmax[i] >= 0.7 else 0.0
        f["topic_siblings"] = math.log1p(tcount[topic(p)] - 1)
    if not have_age:
        print("note: git history not available, younger_than_60d left out")
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
    counts = np.array([float(c) for *_, c in rows])
    ws, bs = ridge_poisson(Z, counts)
    content = [i for i, n in enumerate(names) if n in G.CONTENT_LABEL]
    wc, bc = ridge_poisson(Z[:, content], counts)
    BS = np.array([ridge_poisson(Z[idx], counts[idx])[0] for idx in (rng.integers(0, len(rows), len(rows)) for _ in range(min(boot, 200)))])
    out["softmax_gravity"] = {
        "formula": "G_i = sum_k w_k z_ik ; share_i = exp(G_i) / sum_j exp(G_j) ; fitted as Poisson log-linear with intercept",
        "weights": [{"feature": n, "w": round(float(ws[i]), 3), "w_90": [round(float(np.percentile(BS[:, i], 5)), 3), round(float(np.percentile(BS[:, i], 95)), 3)],
                     "positive_share": round(float(np.mean(BS[:, i] > 0)), 2)} for i, n in enumerate(names)],
        "cross_validation": softmax_cv(Z, counts, list(range(len(names))), repeats, folds),
        "cross_validation_baseline_section_and_sitemap_only": softmax_cv(Z, counts, [i for i, n in enumerate(names) if n.startswith("section_") or n == "in_core_sitemap"], repeats, folds),
        "cross_validation_content_only": softmax_cv(Z, counts, content, repeats, folds),
    }
    out["softmax_gravity"]["weights"].sort(key=lambda c: -abs(c["w"]))
    months = np.array([first.get(p, "unknown")[:7] for p in pages])
    old = np.array([age.get(p, 9999) >= 60 for p in pages])
    gate = [i for i, n in enumerate(names) if n in ("younger_than_60d", "dup_over_0.7", "topic_siblings")]
    out["softmax_gravity"]["held_out_months"] = {
        "months": sorted(set(months.tolist())),
        "formula_all": softmax_cv_grouped(Z, counts, list(range(len(names))), months, old),
        "formula_content_and_gates": softmax_cv_grouped(Z, counts, content + gate, months, old),
        "formula_content_only": softmax_cv_grouped(Z, counts, content, months, old),
        "baseline_section_and_sitemap_only": softmax_cv_grouped(Z, counts, [i for i, n in enumerate(names) if n.startswith("section_") or n == "in_core_sitemap"], months, old),
    } if have_age else None
    if have_age:
        gate_rows = np.array([1.0 if (age.get(p, 9999) < 60 or dmax[i] >= 0.7) else 0.0 for i, p in enumerate(pages)])
        tm = [m for m in sorted(set(months.tolist())) if m != "unknown" and any((months == m) & old)][1:]
        out["softmax_gravity"]["walk_forward"] = {
            "test_months": tm,
            "gates_x_formula_content": walk_forward(Z, counts, content, months, old, tm, gate_rows),
            "formula_content_only": walk_forward(Z, counts, content, months, old, tm),
            "baseline_section_and_sitemap_only": walk_forward(Z, counts, [i for i, n in enumerate(names) if n.startswith("section_") or n == "in_core_sitemap"], months, old, tm),
        }
    out["gates"] = {
        "younger_than_60d": {"pages": int(sum(1 for p in pages if age.get(p, 9999) < 60)), "cited": int(sum(1 for p, _, c in rows if age.get(p, 9999) < 60 and c > 0))} if have_age else None,
        "dup_over_0.7": {"pages": int((dmax >= 0.7).sum()), "cited": int(sum(1 for i, (_, _, c) in enumerate(rows) if dmax[i] >= 0.7 and c > 0))},
    }
    best_sib = {}
    for i, (p, _, c) in enumerate(rows):
        t = topic(p)
        if t not in best_sib or c > best_sib[t][1]:
            best_sib[t] = (p, c)
    p5, p95 = np.percentile(BS, 5, axis=0), np.percentile(BS, 95, axis=0)
    w_low = np.where(ws > 0, np.maximum(p5, 0), np.minimum(p95, 0))
    out["softmax_gravity"]["multiplier_per_lever"] = {
        k: {"fitted": round(math.exp(sum(ws[j] * (fn(dict(zip(names, [0.0] * len(names))))[n] - 0.0) / sd[j] for j, n in enumerate(names))), 2),
            "cautious": round(math.exp(sum(w_low[j] * (fn(dict(zip(names, [0.0] * len(names))))[n] - 0.0) / sd[j] for j, n in enumerate(names))), 2)}
        for k, (_, fn) in LEVERS.items()}
    out["levers"] = levers(rows, names, mu, sd, ws, bs, counts.sum(), w_low)[:40]
    g_all = Z @ ws + bs; e_all = np.exp(g_all - g_all.max()); e_all = counts.sum() * e_all / e_all.sum()
    def why(i, p, c):
        r = []
        if dmax[i] >= 0.6:
            r.append("body %.0f%% the same as %s" % (100 * dmax[i], pages[darg[i]]))
        bp, bc = best_sib[topic(p)]
        if bp != p and bc >= max(5 * c, 20):
            r.append("sibling %s has %d citations" % (bp, bc))
        return "; ".join(r) or "no gate: discovery"
    out["discovery_gaps"] = sorted([{"page": p, "citations_now": int(c), "expected_from_content": round(float(e_all[i]), 1), "why": why(i, p, c)}
                                    for i, (p, _, c) in enumerate(rows) if e_all[i] >= 20 and c < 0.1 * e_all[i] and age.get(p, 9999) >= 60],
                                   key=lambda x: -(x["expected_from_content"] - x["citations_now"]))[:30]
    out["cannibalized"] = sorted([{"page": p, "citations_now": int(c), "sibling": best_sib[topic(p)][0], "sibling_citations": int(best_sib[topic(p)][1])}
                                  for p, _, c in rows if best_sib[topic(p)][0] != p and best_sib[topic(p)][1] >= max(10 * c, 50) and age.get(p, 9999) >= 60],
                                 key=lambda x: -x["sibling_citations"])
    wpath = os.path.join(ROOT, "iasf", "gravity", "weights_bing.json"); os.makedirs(os.path.dirname(wpath), exist_ok=True)
    json.dump({"schema": "gravity-weights-bing-v0", "export": os.path.basename(path), "date": now.isoformat(), "pages": len(rows),
               "all": {"features": names, "mu": dict(zip(names, map(float, mu))), "sd": dict(zip(names, map(float, sd))),
                       "w": dict(zip(names, map(float, ws))), "b": float(bs)},
               "content": {"features": [names[i] for i in content], "mu": {names[i]: float(mu[i]) for i in content},
                           "sd": {names[i]: float(sd[i]) for i in content}, "w": {names[i]: float(wc[j]) for j, i in enumerate(content)}, "b": float(bc)}},
              io.open(wpath, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
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
    sg = out["softmax_gravity"]
    L += ["", "## The GRAVITY-v0 formula learned from Bing: share_i = exp(G_i) / sum_j exp(G_j)", "",
          "Out of sample (%d x %d-fold): Spearman, capture@10%% (chance 0.10), deviance explained" % (repeats, folds), "",
          "| | Spearman | capture@10% | deviance explained |", "|---|---|---|---|"]
    for lab, key in (("all features", "cross_validation"), ("content only (any page)", "cross_validation_content_only"),
                     ("baseline: section + sitemap only", "cross_validation_baseline_section_and_sitemap_only")):
        cv = sg[key]
        L.append("| %s | %s | %s | %s |" % (lab, *["%.3f (%.3f..%.3f)" % (cv[m]["mean"], cv[m]["min"], cv[m]["max"]) for m in ("spearman", "capture_at_10pct", "deviance_explained")]))
    L += ["", "| feature | w (per 1 sd) | 90% | share > 0 |", "|---|---|---|---|"]
    for c in sg["weights"]:
        L.append("| %s | %+.3f | %+.3f..%+.3f | %.2f |" % (c["feature"], c["w"], c["w_90"][0], c["w_90"][1], c["positive_share"]))
    if sg.get("held_out_months"):
        L += ["", "Honest test: each month of first publication held out in turn, scored on pages at least 60 days old (%d pages)" % sg["held_out_months"]["formula_all"]["pages_scored"], "",
              "| | Spearman | AUC P(cited) | capture@10% |", "|---|---|---|---|"]
        for lab, key in (("formula, all features", "formula_all"), ("formula, content + gates", "formula_content_and_gates"),
                         ("formula, content only", "formula_content_only"), ("baseline: section + sitemap only", "baseline_section_and_sitemap_only")):
            v = sg["held_out_months"][key]
            L.append("| %s | %.3f | %.3f | %.3f |" % (lab, v["spearman"], v["auc_cited"], v["capture_at_10pct"]))
    wf = sg.get("walk_forward")
    if wf:
        L += ["", "Walk-forward: learn on earlier months only, predict each later month (%s); mean over months" % ", ".join(wf["gates_x_formula_content"]["per_month"]), "",
              "| | Spearman | AUC P(cited) | capture@10% |", "|---|---|---|---|"]
        for lab, key in (("gates x formula (content)", "gates_x_formula_content"), ("formula, content only", "formula_content_only"),
                         ("baseline: section + sitemap only", "baseline_section_and_sitemap_only")):
            v = wf[key]["mean"]
            if v:
                L.append("| %s | %.3f | %.3f | %.3f |" % (lab, v["spearman"], v["auc_cited"], v["capture_at_10pct"]))
    gt = out["gates"]
    L += ["", "Gates: younger than 60 days %s; body 70%%+ the same as another page: %d pages, %d cited" % (
        ("%d pages, %d cited" % (gt["younger_than_60d"]["pages"], gt["younger_than_60d"]["cited"])) if gt["younger_than_60d"] else "not measured (no git)",
        gt["dup_over_0.7"]["pages"], gt["dup_over_0.7"]["cited"])]
    L += ["", "Multiplier on a page's expected citations from one change made on a page that lacks it (from zero tables for the table):", "",
          "| change | fitted | cautious (5th percentile) |", "|---|---|---|"]
    for k, v in sg["multiplier_per_lever"].items():
        L.append("| %s | x%.2f | x%.2f |" % (LEVERS[k][0], v["fitted"], v["cautious"]))
    L += ["", "## Levers: expected extra citations from one change, E_i x (exp(dG) - 1), ranked by the cautious gain", "",
          "| page | change | citations now | expected now | cautious gain | fitted gain |", "|---|---|---|---|---|---|"]
    for x in out["levers"][:25]:
        L.append("| %s | %s | %d | %.1f | %+.1f | %+.1f |" % (x["page"], x["label"], x["citations_now"], x["expected_now"],
                 x["expected_gain_cautious"], x["expected_gain"]))
    L += ["", "## Discovery gaps: the formula expects citations from the page itself, Bing gives under 10% of that", "",
          "The content is there, so the next stage is discovery (indexing, internal and external links, IndexNow), not rewriting.", "",
          "Pages under 60 days old are left out (age explains them). The last column says what else stands in the way.", "",
          "| page | citations now | expected from the page | why |", "|---|---|---|---|"]
    for x in out["discovery_gaps"]:
        L.append("| %s | %d | %.1f | %s |" % (x["page"], x["citations_now"], x["expected_from_content"], x["why"]))
    L += ["", "## Cannibalized: a sibling page on the same work takes the citations (10x or more)", "",
          "| page | citations | sibling | sibling citations |", "|---|---|---|---|"]
    for x in out["cannibalized"][:40]:
        L.append("| %s | %d | %s | %d |" % (x["page"], x["citations_now"], x["sibling"], x["sibling_citations"]))
    io.open(stem + ".md", "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("\n".join(L))
    if out["export_pages_not_in_sitemaps"]:
        print("\ncited pages that are in no sitemap (not in the fit):", len(set(cites) - set(pages)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
