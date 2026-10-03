#!/usr/bin/env python3
"""GRAVITY-v0, part 2: the gravity margin of our page against the pages an AI engine actually cited.

For each monitor question: take the URLs the engine cited in a discovery run (iasf/discovery_runs/<run>/observations.jsonl),
fetch those pages and our canonical page for the question (tools/gravity/claims.json), measure the same features on
every page, combine them into a score G, and report

  margin   = G(ours) - max G(cited competitor)
  P(ours)  = softmax over {ours, competitors} with temperature TAU
  next_fix = the feature where the best competitor beats us by the most weighted amount

Features (each scaled 0..1 on the pages compared for that question):
  R relevance      character 2-gram Dice between the question and title + h1 + h2s
  X extractable    yen amounts, ㎡/坪 quantities, tables and ordered-list steps in the body text
  W woven check    steps that tell the reader how to check the number themselves (確かめ / 検算 / 手順 / 内訳 near a list)
  F freshness      days since dateModified / article:modified_time / Last-Modified (newer is higher)
  S structure      FAQPage JSON-LD present, and the question wording appearing in a heading
  K cost (minus)   page weight in bytes and how little text the HTML carries without scripts
  V raw proof      hashes / signatures / curl in the consumer text. Weight 0 or negative: in our controlled runs
                   (iasf v2, v4, v5) raw proof lowered selection and a bare "verifiable" claim did not raise it.

Weights are priors, not fitted: relevance and extractable numbers carry the most (arXiv 2605.25517, 252,000 trials;
iasf v3 to v6), the woven check is next (iasf v6, +20 to +24 pt over a useful filler sentence), freshness and
structure are smaller, formatting alone is small. When enough observations exist, --fit refits the weights by
logistic regression on (features of a page, was it cited) pairs gathered from several runs; until then the margin is
a diagnostic for which page to fix next, not a prediction.

Stage model (the pipeline in the GRAVITY-v0 proposal: discover, retrieve, select, cite, absorb):
  P_capture(q) = P_D(q) x P_S(q) x P_C x P_A
  P_D   discovered: our page appeared in the engine's results for q. Estimated from every observation file given
        with --obs (Laplace: (seen + 1) / (n + 2)), so one zero does not read as a certainty.
  P_S   selected if discovered: the softmax above.
  P_C, P_A  cited and absorbed: need the engine's answer text; set to 1 and reported as unmeasured here.
  Marginal effect of one more unit on each stage: dP/dP_D = P_S, dP/dP_S = P_D. The report names the stage with the
  larger marginal effect per question, and orders the questions by expected gain, so effort goes where it pays.

Learned weights (--weights bing): the same G and softmax, with the weights learned from Bing's real AI citations of
our 616 pages by tools/gravity/gravity_fit_bing.py (softmax over pages fitted as its Poisson equivalent, out-of-sample
checked). Only the content features that can be measured on any page are used here (title words, tables, quantities,
FAQ structure, freshness, length ...), not where a page sits in our site. The report then shows P(ours) under both the
prior weights and the learned weights, and the next fix is ranked by the learned weights. Needs
iasf/gravity/weights_bing.json, written by gravity_fit_bing.py.

Run on a machine that can reach the sites (TOshi's Mac):
  python3 tools/gravity/gravity_margin.py --obs iasf/discovery_runs/2026-10-04-monitor/observations.jsonl
  python3 tools/gravity/gravity_margin.py --obs ... --provider openai --qid p002
  python3 tools/gravity/gravity_margin.py --obs ... --weights bing
  python3 tools/gravity/gravity_margin.py --selftest
Writes iasf/gravity/<run>/margin.json and margin.md and rows.jsonl (features + cited label, for --fit later).
Standard library only. Read only: one GET per page, robots.txt honoured, 1 s between requests to one host.
"""
import argparse, collections, datetime, html, io, json, math, os, re, sys, time, urllib.parse, urllib.request, urllib.robotparser

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"
UA = "HORIZON-SHIELD-gravity/0 (+https://shield.the-horizons-innovation.com/security/; contact@the-horizons-innovation.com)"
WEIGHTS = {"R": 3.0, "X": 2.0, "W": 1.5, "F": 0.8, "S": 0.6, "K": -0.8, "V": -0.3}
TAU = 1.0
LABEL = {"R": "relevance (question words in title and headings)", "X": "extractable numbers, tables and steps",
         "W": "self-check steps the reader can follow", "F": "freshness (last modified)", "S": "FAQ structure and question as heading",
         "K": "page weight and script-only text", "V": "raw hashes or signatures in the consumer text"}


def bigrams(s):
    s = re.sub(r"\s+", "", s.lower())
    return collections.Counter(s[i:i + 2] for i in range(len(s) - 1))


def dice(a, b):
    A, B = bigrams(a), bigrams(b)
    n = sum((A & B).values())
    d = sum(A.values()) + sum(B.values())
    return 2.0 * n / d if d else 0.0


def text_of(h):
    h = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", h)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h))).strip()


def tags(h, name):
    return [text_of(x) for x in re.findall(r"(?is)<%s[^>]*>(.*?)</%s>" % (name, name), h)]


def modified(h, headers):
    for pat in (r'"dateModified"\s*:\s*"([0-9T:\-+Z.]+)"', r'article:modified_time"\s+content="([^"]+)"', r'"datePublished"\s*:\s*"([0-9T:\-+Z.]+)"'):
        m = re.search(pat, h)
        if m:
            return m.group(1)[:10]
    lm = (headers or {}).get("Last-Modified")
    if lm:
        try:
            return datetime.datetime.strptime(lm[5:16], "%d %b %Y").strftime("%Y-%m-%d")
        except Exception:
            return None
    return None


def raw_features(question, h, headers=None, now=None):
    now = now or datetime.date.today()
    body = text_of(h)
    head_text = " ".join(tags(h, "title") + tags(h, "h1") + tags(h, "h2")[:6])
    yen = len(re.findall(r"[0-9０-９][0-9０-９,，.]*\s*(?:万円|円)", body))
    qty = len(re.findall(r"[0-9０-９][0-9０-９,，.]*\s*(?:㎡|m2|坪|号)", body))
    tables = len(re.findall(r"(?i)<table", h))
    ol_items = sum(len(re.findall(r"(?i)<li", x)) for x in re.findall(r"(?is)<ol[^>]*>(.*?)</ol>", h))
    woven = 0
    for blk in re.findall(r"(?is)(.{0,200})<(?:ol|ul)[^>]*>(.*?)</(?:ol|ul)>", h):
        ctx = text_of(blk[0] + blk[1])
        if re.search(r"確かめ|検算|自分で|手順|内訳.*(数量|単価)", ctx):
            woven += len(re.findall(r"(?i)<li", blk[1]))
    d = modified(h, headers)
    try:
        age = (now - datetime.date.fromisoformat(d)).days if d else 730
    except Exception:
        age = 730
    faq = 1 if re.search(r'"@type"\s*:\s*"FAQPage"', h) else 0
    q_core = re.sub(r"[?？。、\s]", "", question)
    q_head = max([dice(question, x) for x in tags(h, "h1") + tags(h, "h2") + tags(h, "h3")] or [0.0])
    raw_proof = len(re.findall(r"(?i)\b[0-9a-f]{40,64}\b|curl\s+-|sha-?256|ed25519|signature", body))
    return {"R": dice(question, head_text), "X": math.log1p(yen + qty + 3 * tables + ol_items), "W": math.log1p(woven),
            "F": -float(age), "S": 0.5 * faq + 0.5 * q_head, "K": math.log1p(len(h) / 1024.0) + (1.0 if len(body) < 400 else 0.0),
            "V": math.log1p(raw_proof), "_meta": {"modified": d, "bytes": len(h), "text_chars": len(body), "yen": yen, "qty": qty,
                                                 "tables": tables, "ol_items": ol_items, "woven_items": woven, "faq": faq, "raw_proof": raw_proof,
                                                 "q_core": q_core[:40]}}


CONTENT_LABEL = {"yen_amounts": "yen amounts in the text", "quantities": "㎡/坪/号 quantities", "tables": "tables",
                 "ordered_steps": "ordered-list steps", "self_check_steps": "self-check steps", "faq_jsonld": "FAQPage JSON-LD",
                 "raw_proof_terms": "hashes, signatures, curl in the text", "text_chars": "text length", "age_days": "age since last modified",
                 "title_has_tekisei": "適正 in the title", "title_has_souba": "相場 in the title",
                 "title_has_question": "question form in the title", "title_has_number": "a number in the title",
                 "title_judgement": "judgement wording in the title (これ高い, 妥当 ...)", "title_ad_words": "ad wording in the title (無料, AI診断, 今すぐ)"}


JUDGEMENT = r"これ高い|高い[？?]|妥当|高すぎ|ぼったくり"
AD_WORDS = r"無料|AI診断|今すぐ"


def content_features(title, h, headers=None, now=None):
    """query-free page features, the same definitions gravity_fit_bing.py learns its weights on"""
    raw = raw_features(title, h, headers, now=now)
    m = raw["_meta"]
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
        "title_judgement": 1.0 if re.search(JUDGEMENT, title) else 0.0,
        "title_ad_words": 1.0 if re.search(AD_WORDS, title) else 0.0,
    }


def load_bing_weights(path=None):
    path = path or os.path.join(ROOT, "iasf", "gravity", "weights_bing.json")
    d = json.load(io.open(path, encoding="utf-8"))
    return d["content"]


def judge_bing(question, pages, bw):
    """G = sum_k w_k (x_k - mu_k) / sd_k with weights learned from Bing citations, softmax over the compared pages"""
    names = bw["features"]
    for p in pages:
        cf = p["cf"]
        z = {k: (cf[k] - bw["mu"][k]) / bw["sd"][k] for k in names}
        p["zb"] = z
        p["Gb"] = round(sum(bw["w"][k] * z[k] for k in names), 4)
    ours = [p for p in pages if p["ours"]]
    comps = [p for p in pages if not p["ours"]]
    if not ours or not comps:
        return {"error": "need our page and at least one cited competitor page"}
    o = ours[0]
    best = max(comps, key=lambda p: p["Gb"])
    mx = max(p["Gb"] for p in pages)
    z = [math.exp(p["Gb"] - mx) for p in pages]
    p_ours = math.exp(o["Gb"] - mx) / sum(z)
    gaps = sorted(((bw["w"][k] * (best["zb"][k] - o["zb"][k]), k) for k in names), reverse=True)
    return {"G_ours_bing": o["Gb"], "G_best_bing": best["Gb"], "best_competitor_bing": best["url"],
            "margin_bing": round(o["Gb"] - best["Gb"], 4), "p_ours_bing": round(p_ours, 4),
            "next_fix_bing": [{"feature": k, "label": CONTENT_LABEL.get(k, k), "weighted_gap": round(g, 3)} for g, k in gaps if g > 0][:3]}


def scale(rows):
    """min-max per feature across the pages compared for one question"""
    out = [dict(r) for r in rows]
    for k in WEIGHTS:
        vs = [r[k] for r in rows]
        lo, hi = min(vs), max(vs)
        for o, v in zip(out, vs):
            o[k] = 0.5 if hi == lo else (v - lo) / (hi - lo)
    return out


def score(f, w=WEIGHTS):
    return sum(w[k] * f[k] for k in w)


def judge(question, pages, w=WEIGHTS):
    """pages: list of {"url", "ours": bool, "raw": raw_features}. Returns the report for one question."""
    sc = scale([p["raw"] for p in pages])
    for p, s in zip(pages, sc):
        p["scaled"] = {k: round(s[k], 4) for k in w}
        p["G"] = round(score(s, w), 4)
    ours = [p for p in pages if p["ours"]]
    comps = [p for p in pages if not p["ours"]]
    if not ours or not comps:
        return {"question": question, "error": "need our page and at least one cited competitor page"}
    o = ours[0]
    best = max(comps, key=lambda p: p["G"])
    z = [math.exp(p["G"] / TAU) for p in pages]
    p_ours = math.exp(o["G"] / TAU) / sum(z)
    deficits = sorted(((w[k] * (best["scaled"][k] - o["scaled"][k]), k) for k in w), reverse=True)
    fixes = [{"feature": k, "label": LABEL[k], "weighted_gap": round(g, 3)} for g, k in deficits if g > 0][:3]
    return {"question": question, "ours": o["url"], "G_ours": o["G"], "best_competitor": best["url"], "G_best": best["G"],
            "margin": round(o["G"] - best["G"], 4), "p_ours_softmax": round(p_ours, 4), "next_fix": fixes,
            "pages": [{"url": p["url"], "ours": p["ours"], "G": p["G"], "scaled": p["scaled"], "meta": p["raw"]["_meta"]} for p in pages]}


_robots = {}
_last = {}


def allowed(url):
    p = urllib.parse.urlparse(url)
    base = "%s://%s" % (p.scheme, p.netloc)
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            req = urllib.request.Request(base + "/robots.txt", headers={"User-Agent": UA})
            rp.parse(urllib.request.urlopen(req, timeout=15).read().decode("utf-8", "replace").splitlines())
        except Exception:
            rp = None
        _robots[base] = rp
    rp = _robots[base]
    return True if rp is None else rp.can_fetch(UA, url)


def fetch(url):
    host = urllib.parse.urlparse(url).netloc
    wait = 1.0 - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.time()
    if not allowed(url):
        return None, None, "robots"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read(2_000_000).decode("utf-8", "replace"), dict(r.headers), None
    except Exception as e:
        return None, None, "%s: %s" % (type(e).__name__, str(e)[:120])


def load_claims():
    return {c["qid"]: c for c in json.load(io.open(os.path.join(ROOT, "tools", "gravity", "claims.json"), encoding="utf-8"))["claims"]}


def discovery_rates(obs_paths, claims):
    seen, n = collections.Counter(), collections.Counter()
    for pth in obs_paths:
        for line in io.open(pth, encoding="utf-8"):
            r = json.loads(line)
            if r.get("status") != "ok" or r.get("qid") not in claims:
                continue
            n[r["qid"]] += 1
            seen[r["qid"]] += 1 if (r.get("hs_seen") or r.get("hs_cited")) else 0
    return {q: {"seen": seen[q], "n": n[q], "p_d": (seen[q] + 1.0) / (n[q] + 2.0)} for q in n}


def stages(reports, disc, key="p_ours_softmax"):
    rows = []
    by_q = collections.defaultdict(list)
    for rep in reports:
        if key in rep:
            by_q[rep["qid"]].append(rep[key])
    for q, ps in by_q.items():
        p_s = sum(ps) / len(ps)
        d = disc.get(q, {"seen": 0, "n": 0, "p_d": 0.5})
        cap = d["p_d"] * p_s
        gain_d, gain_s = p_s, d["p_d"]
        rows.append({"qid": q, "p_d": round(d["p_d"], 3), "seen": d["seen"], "n_obs": d["n"], "p_s": round(p_s, 3),
                     "p_capture": round(cap, 3), "dP_dPD": round(gain_d, 3), "dP_dPS": round(gain_s, 3),
                     "next_stage": "discovery" if gain_d >= gain_s else "selection",
                     "expected_gain_next": round(max(gain_d * (1 - d["p_d"]), gain_s * (1 - p_s)), 3)})
    rows.sort(key=lambda x: -x["expected_gain_next"])
    return rows


def run(obs_path, provider=None, qid=None, max_comp=5, extra_obs=(), weights="prior"):
    claims = load_claims()
    bw = load_bing_weights() if weights == "bing" else None
    recs = {}
    for line in io.open(obs_path, encoding="utf-8"):
        r = json.loads(line)
        if r.get("status") != "ok" or r.get("qid") not in claims:
            continue
        if provider and r["provider"] != provider:
            continue
        if qid and r["qid"] != qid:
            continue
        recs[(r["provider"], r["qid"])] = r
    run_id = os.path.basename(os.path.dirname(os.path.abspath(obs_path)))
    out_dir = os.path.join(ROOT, "iasf", "gravity", run_id)
    os.makedirs(out_dir, exist_ok=True)
    cache, reports, rows = {}, [], []
    for (prov, q), r in sorted(recs.items()):
        c = claims[q]
        ours_url = SITE + c["page"]
        urls = [u for u in (r.get("cited_urls") or []) if "the-horizons-innovation.com" not in u][:max_comp]
        pages = []
        for u, is_ours in [(ours_url, True)] + [(u, False) for u in urls]:
            if u not in cache:
                cache[u] = fetch(u)
            h, hd, err = cache[u]
            if h is None:
                print("  skip %s (%s)" % (u, err))
                continue
            pages.append({"url": u, "ours": is_ours, "raw": raw_features(c["question"], h, hd),
                          "cf": content_features(" ".join(tags(h, "title")), h, hd)})
        rep = judge(c["question"], pages)
        if bw and "margin" in rep:
            rep.update(judge_bing(c["question"], pages, bw))
        rep.update({"provider": prov, "qid": q, "hs_cited": r.get("hs_cited"), "hs_seen": r.get("hs_seen")})
        reports.append(rep)
        for p in rep.get("pages", []):
            rows.append({"run": run_id, "provider": prov, "qid": q, "url": p["url"], "ours": p["ours"],
                         "cited": (not p["ours"]) or bool(r.get("hs_cited")), "scaled": p["scaled"]})
        if "margin" in rep:
            print("%-10s %-5s margin %+6.2f  P(ours) %.2f  next: %s" % (prov, q, rep["margin"], rep["p_ours_softmax"],
                  ", ".join(f["feature"] for f in rep["next_fix"]) or "none"))
        if "margin_bing" in rep:
            print("%-10s %-5s learned(bing) margin %+6.2f  P(ours) %.2f  next: %s" % (prov, q, rep["margin_bing"], rep["p_ours_bing"],
                  ", ".join(f["feature"] for f in rep["next_fix_bing"]) or "none"))
    disc = discovery_rates([obs_path] + list(extra_obs), claims)
    st = stages(reports, disc, "p_ours_bing" if bw else "p_ours_softmax")
    ccr = sum(x["p_capture"] for x in st) / len(st) if st else 0.0
    print("\nstage model  P_capture = P_D x P_S   (P_S from %s weights; P_C, P_A unmeasured, set to 1)" % ("learned Bing" if bw else "prior"))
    for x in st:
        print("  %-5s P_D %.2f (seen %d/%d)  P_S %.2f  P_capture %.3f  next: %-9s  dP/dP_D %.2f  dP/dP_S %.2f" % (
            x["qid"], x["p_d"], x["seen"], x["n_obs"], x["p_s"], x["p_capture"], x["next_stage"], x["dP_dPD"], x["dP_dPS"]))
    print("  expected capture over these questions (CCR estimate): %.3f" % ccr)
    json.dump({"schema": "gravity-margin-v0", "weights": WEIGHTS, "tau": TAU, "learned_weights": bw, "obs": obs_path, "extra_obs": list(extra_obs),
               "stages": st, "ccr_estimate": round(ccr, 4), "reports": reports},
              io.open(os.path.join(out_dir, "margin.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with io.open(os.path.join(out_dir, "rows.jsonl"), "w", encoding="utf-8") as fh:
        for x in rows:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    L = ["# Gravity margin  run %s" % run_id, "", "weights (priors) %s" % WEIGHTS, "",
         "| engine | q | question | margin | P(ours) | next fix | P(ours) learned | next fix learned |", "|---|---|---|---|---|---|---|---|"]
    for rep in reports:
        if "margin" in rep:
            L.append("| %s | %s | %s | %+.2f | %.2f | %s | %s | %s |" % (rep["provider"], rep["qid"], rep["question"], rep["margin"], rep["p_ours_softmax"],
                     "; ".join(f["label"] for f in rep["next_fix"]) or "none",
                     "%.2f" % rep["p_ours_bing"] if "p_ours_bing" in rep else "",
                     "; ".join(f["label"] for f in rep.get("next_fix_bing", [])) or ("none" if "p_ours_bing" in rep else "")))
    L += ["", "## Stage model  P_capture = P_D x P_S  (P_C, P_A unmeasured)", "",
          "| q | P_D (seen/n) | P_S | P_capture | next stage | dP/dP_D | dP/dP_S |", "|---|---|---|---|---|---|---|"]
    for x in st:
        L.append("| %s | %.2f (%d/%d) | %.2f | %.3f | %s | %.2f | %.2f |" % (x["qid"], x["p_d"], x["seen"], x["n_obs"], x["p_s"], x["p_capture"], x["next_stage"], x["dP_dPD"], x["dP_dPS"]))
    L += ["", "CCR estimate over these questions: %.3f" % ccr]
    io.open(os.path.join(out_dir, "margin.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print("\nwritten: %s/margin.md, margin.json, rows.jsonl" % out_dir)
    return 0


def fit(rows_paths, iters=4000, lr=0.1, l2=0.01):
    """logistic regression of cited ~ scaled features, pooled over runs. Prints fitted weights and n."""
    X, y = [], []
    for p in rows_paths:
        for line in io.open(p, encoding="utf-8"):
            r = json.loads(line)
            X.append([r["scaled"][k] for k in WEIGHTS])
            y.append(1.0 if r["cited"] else 0.0)
    n = len(y)
    if n < 200 or len(set(y)) < 2:
        print("fit: n=%d rows (%d cited). Need at least 200 rows with both labels; keeping the priors." % (n, int(sum(y))))
        return 1
    w = [0.0] * len(WEIGHTS)
    b = 0.0
    for _ in range(iters):
        gw, gb = [0.0] * len(w), 0.0
        for xi, yi in zip(X, y):
            z = b + sum(a * c for a, c in zip(w, xi))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            for j in range(len(w)):
                gw[j] += (p - yi) * xi[j]
            gb += p - yi
        w = [wj - lr * (gj / n + l2 * wj) for wj, gj in zip(w, gw)]
        b -= lr * gb / n
    print("fit: n=%d, cited=%d" % (n, int(sum(y))))
    for k, v in zip(WEIGHTS, w):
        print("  %s %-48s prior %+5.2f  fitted %+6.3f" % (k, LABEL[k], WEIGHTS[k], v))
    return 0


def selftest():
    q = "給湯器交換で20万円は高いですか"
    good = ("<title>給湯器交換で20万円は高い？</title><h1>給湯器交換で20万円は高いですか</h1><table><tr><td>20号 15〜30万円</td></tr></table>"
            "<p>自分で確かめる 3 手順</p><ol><li>内訳を数量と単価に分ける</li><li>単価を比べる</li><li>理由を聞く</li></ol>"
            '<script type="application/ld+json">{"@type": "FAQPage", "dateModified": "2026-09-15"}</script>' + "<p>" + "本文。" * 200 + "</p>")
    weak = "<title>リフォームのお役立ち情報</title><h1>住まいのコラム</h1><p>" + "一般的な話。" * 200 + "</p>"
    proof = good.replace("<p>自分で", "<p>sha256 " + "a" * 64 + " curl -s で確認。自分で")
    now = datetime.date(2026, 10, 4)
    pages = [{"url": "ours", "ours": True, "raw": raw_features(q, good, now=now)},
             {"url": "comp", "ours": False, "raw": raw_features(q, weak, now=now)}]
    rep = judge(q, pages)
    ok = rep["margin"] > 0 and rep["p_ours_softmax"] > 0.5
    pages2 = [{"url": "ours", "ours": True, "raw": raw_features(q, weak, now=now)},
              {"url": "comp", "ours": False, "raw": raw_features(q, good, now=now)}]
    rep2 = judge(q, pages2)
    ok2 = rep2["margin"] < 0 and rep2["next_fix"] and rep2["next_fix"][0]["feature"] in ("R", "X", "W")
    a, b = raw_features(q, good, now=now), raw_features(q, proof, now=now)
    ok3 = b["V"] > a["V"] and WEIGHTS["V"] <= 0
    ok4 = raw_features(q, good, now=now)["W"] > 0 and raw_features(q, weak, now=now)["W"] == 0
    st = stages([{"qid": "a", "p_ours_softmax": 0.9}, {"qid": "b", "p_ours_softmax": 0.2}],
                {"a": {"seen": 0, "n": 8, "p_d": 0.1}, "b": {"seen": 8, "n": 8, "p_d": 0.9}})
    sa = {x["qid"]: x for x in st}
    ok5 = sa["a"]["next_stage"] == "discovery" and sa["b"]["next_stage"] == "selection" and abs(sa["a"]["p_capture"] - 0.09) < 1e-9
    bw = {"features": ["title_has_souba", "tables", "text_chars"], "mu": {"title_has_souba": 0.3, "tables": 0.5, "text_chars": 7.0},
          "sd": {"title_has_souba": 0.45, "tables": 0.6, "text_chars": 1.0}, "w": {"title_has_souba": 0.5, "tables": 0.5, "text_chars": -0.1}}
    sp = "<title>給湯器交換の相場</title><table><tr><td>20号</td></tr></table><p>" + "本文。" * 100 + "</p>"
    ns = "<title>給湯器交換で20万円は高い？</title><p>" + "本文。" * 400 + "</p>"
    pg = [{"url": "ours", "ours": True, "cf": content_features("給湯器交換で20万円は高い？", ns, now=now)},
          {"url": "comp", "ours": False, "cf": content_features("給湯器交換の相場", sp, now=now)}]
    rb = judge_bing(q, pg, bw)
    ok6 = (rb["margin_bing"] < 0 and rb["next_fix_bing"][0]["feature"] in ("title_has_souba", "tables")
           and set(content_features("t", good, now=now)) == set(CONTENT_LABEL))
    res = [("learned weights: a 相場 title with a table beats a question title without, and that is the next fix", ok6),
           ("stage model: unseen strong page needs discovery, seen weak page needs selection", ok5),
           ("strong page beats weak page", ok), ("weak page gets negative margin and a content fix first", ok2),
           ("raw proof is detected and never weighted up", ok3), ("woven self-check steps detected only where present", ok4)]
    for name, r in res:
        print(("  ok   " if r else "  NG   ") + name)
    print("selftest:", "ALL PASS (%d)" % len(res) if all(r for _, r in res) else "FAIL")
    return 0 if all(r for _, r in res) else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--obs")
    ap.add_argument("--provider")
    ap.add_argument("--qid")
    ap.add_argument("--max-comp", type=int, default=5)
    ap.add_argument("--more-obs", nargs="*", default=[], help="more observation files, used only for P_D")
    ap.add_argument("--fit", nargs="+", metavar="ROWS_JSONL")
    ap.add_argument("--weights", choices=["prior", "bing"], default="prior",
                    help="bing: also score with the weights learned from Bing citations (iasf/gravity/weights_bing.json)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    if a.fit:
        sys.exit(fit(a.fit))
    if not a.obs:
        ap.error("--obs is required")
    sys.exit(run(a.obs, a.provider, a.qid, a.max_comp, a.more_obs, a.weights))


if __name__ == "__main__":
    main()
