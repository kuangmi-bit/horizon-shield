#!/usr/bin/env python3
"""EHN(見積もり達人)の公開カードを 1 枚ずつ静的なページにする (2026-10-09)。

なぜ: 掲示板のカードは一覧の小窓で開くだけで、検索にも出ず、リンクで人に送ることもできなかった。
1 枚ずつ hacker/c/<id>/index.html に置き、sitemap-ehn.xml に載せる。

守ること:
- 公開の API(/hacker/cards)が既に返している物だけを使う。掲載者のニックネーム(initial)は載せない。
- 業者名・電話・住所らしき文字が混じっていたら、そのカードはページにしない(掲示板の通報と同じ考え)。
- 取得に失敗した時、0 枚の時は何も書き換えない(全部消える事故を防ぐ)。
- 消してよいのは、この台本が作った印のあるページだけ。

使い方:
  python3 tools/ehn_card_pages.py              公開 API から取って書く
  python3 tools/ehn_card_pages.py --in x.json  手元の JSON から書く
  python3 tools/ehn_card_pages.py --selftest   偽のカードで試す(書き込みは一時フォルダ)
"""
import html, json, os, re, shutil, sys, tempfile, urllib.request
from datetime import datetime, timezone, timedelta

API = "https://hs-kira-proxy.oga-surf-project.workers.dev/hacker/cards"
SITE = "https://shield.the-horizons-innovation.com"
MARK = "<!-- ehn-card-page v1 -->"
JST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_RE = re.compile(r"^card-[0-9]{10,16}$")
BAD_RE = re.compile(r"(株式会社|有限会社|合同会社|\(株\)|（株）|㈱|㈲|工務店|[0-9０-９]{2,4}[-ー－][0-9０-９]{2,4}[-ー－][0-9０-９]{3,4}|@|https?://|丁目|番地)")

e = lambda s: html.escape(str(s or ""), quote=True)


def yen(a):
    s = re.sub(r"[^0-9]", "", str(a or ""))
    if not s or int(s) <= 0:
        return ""
    return f"{int(s):,}円"


def man(a):
    s = re.sub(r"[^0-9]", "", str(a or ""))
    if not s or int(s) <= 0:
        return ""
    v = int(s) / 10000
    return f"{v:,.0f}万円" if v >= 100 else f"{v:,.1f}万円".replace(".0万円", "万円")


def card_ok(c):
    if not isinstance(c, dict) or not ID_RE.match(str(c.get("id", ""))):
        return False, "id が想定外"
    text = " ".join([str(c.get("title", "")), str(c.get("verdict", ""))] + [str(t) for t in (c.get("traits") or [])])
    m = BAD_RE.search(text)
    if m:
        return False, f"業者や連絡先らしき文字「{m.group(0)}」"
    if not str(c.get("title", "")).strip():
        return False, "題が空"
    return True, ""


def page(c, canonical_id):
    cid = c["id"]
    title = str(c.get("title", "")).strip()
    amt_y, amt_m = yen(c.get("amount")), man(c.get("amount"))
    traits = [str(t).strip() for t in (c.get("traits") or []) if str(t).strip()]
    verdict = str(c.get("verdict", "")).strip()
    genre, region, building = (str(c.get(k, "") or "").strip() for k in ("genre", "region", "building"))
    try:
        d = datetime.fromtimestamp(int(c.get("created_at", 0)) / 1000, JST).strftime("%Y年%-m月%-d日")
    except Exception:
        d = ""
    url = f"{SITE}/hacker/c/{cid}/"
    canon = f"{SITE}/hacker/c/{canonical_id}/"
    h1 = f"{title}の見積書" + (f"({amt_m})" if amt_m else "") + "を解剖"
    desc_bits = [x for x in [genre, region, building] if x]
    desc = ("・".join(desc_bits) + "。" if desc_bits else "") + (f"見積額 {amt_y}。" if amt_y else "")
    desc += (f"気になる点 {len(traits)} つ: {traits[0]}。" if traits else "") + (f"判定: {verdict}。" if verdict else "")
    desc = desc[:150]
    share_text = f"{h1}。見積書を匿名で置くと、無料で項目ごとに解剖してもらえます。"
    rows = [("工種", genre), ("地域", region), ("建物", building), ("見積額", amt_y), ("掲載", d)]
    rows_html = "".join(f'<div class="kv"><span class="k">{e(k)}</span><span class="v">{e(v)}</span></div>' for k, v in rows if v)
    traits_html = "".join(f'<li><span class="n">{i+1:02d}</span><span>{e(t)}</span></li>' for i, t in enumerate(traits)) or '<li><span class="n">--</span><span>明確な警告(赤旗)は見つかりませんでした。</span></li>'
    ld = {
        "@context": "https://schema.org", "@type": "WebPage", "name": h1, "description": desc, "url": url,
        "isPartOf": {"@type": "WebSite", "name": "HORIZON SHIELD", "url": SITE + "/"},
        "breadcrumb": {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "HORIZON SHIELD", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "見積もり達人", "item": SITE + "/hacker/"},
            {"@type": "ListItem", "position": 3, "name": title, "item": url}]},
    }
    from urllib.parse import quote
    line_url = "https://line.me/R/share?text=" + quote(share_text + "\n" + url)
    x_url = "https://x.com/intent/post?text=" + quote(share_text) + "&url=" + quote(url)
    ld_json = json.dumps(ld, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    robots = '<meta name="robots" content="noindex,follow">' if canonical_id != cid else ""
    return f"""<!doctype html>
{MARK}
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(h1)} | 見積もり達人 HORIZON SHIELD</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(canon)}">
{robots}
<meta property="og:type" content="article">
<meta property="og:title" content="{e(h1)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{SITE}/hacker/c/og.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ld_json}</script>
<style>
:root{{--ink:#111;--mut:#555;--rule:#111;--soft:#d6d6d6;--acc:#D7261E;--bg:#fff}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif;line-height:1.75;-webkit-font-smoothing:antialiased}}
.w{{max-width:760px;margin:0 auto;padding:28px 16px 48px}}
.mono{{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace}}
.top{{display:flex;justify-content:space-between;gap:12px;font-size:12px;letter-spacing:.08em;border-bottom:2px solid var(--rule);padding-bottom:10px}}
.top a{{color:var(--ink);text-decoration:none}}
h1{{font-size:clamp(24px,5vw,34px);line-height:1.35;margin:26px 0 18px;font-weight:900}}
.kvs{{border-top:1px solid var(--rule)}}
.kv{{display:flex;gap:16px;padding:9px 0;border-bottom:1px solid var(--soft);font-size:15px}}
.kv .k{{flex:0 0 72px;color:var(--mut);font-size:13px;padding-top:1px}}
.h{{margin:30px 0 8px;font-size:12px;letter-spacing:.16em;display:flex;justify-content:space-between;border-bottom:1px solid var(--rule);padding-bottom:6px}}
.h .c{{color:var(--acc)}}
ul{{list-style:none;margin:0;padding:0}}
li{{display:flex;gap:14px;padding:10px 0;border-bottom:1px solid var(--soft);font-size:16px}}
li .n{{flex:0 0 auto;color:var(--acc);font-size:13px;padding-top:2px}}
.verdict{{font-size:18px;font-weight:700;padding:12px 0;border-bottom:1px solid var(--soft)}}
.note{{font-size:13px;color:var(--mut);margin-top:14px}}
.cta{{margin-top:34px;border:2px solid var(--rule);padding:20px}}
.cta b{{display:block;font-size:20px;line-height:1.4}}
.cta p{{margin:8px 0 14px;font-size:14px}}
.btn{{display:block;text-align:center;background:var(--ink);color:#fff;text-decoration:none;padding:14px;font-size:15px}}
.btn:hover{{background:var(--acc)}}
.sub{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:22px}}
.sub a{{display:block;text-align:center;border:1.5px solid var(--rule);color:var(--ink);text-decoration:none;padding:11px 4px;font-size:13px}}
.foot{{margin-top:36px;padding-top:12px;border-top:1px solid var(--rule);font-size:12px;color:var(--mut)}}
.foot a{{color:var(--mut)}}
</style>
</head>
<body>
<div class="w">
  <div class="top mono"><a href="/hacker/">見積もり達人 ／ 匿名の見積もり</a><a href="/">HORIZON SHIELD</a></div>
  <h1>{e(h1)}</h1>
  <div class="kvs">{rows_html}</div>
  <div class="h mono"><span>気になる点(赤旗)</span><span class="c">{len(traits):02d}</span></div>
  <ul>{traits_html}</ul>
  {f'<div class="h mono"><span>KIRA の判定</span><span></span></div><div class="verdict">{e(verdict)}</div>' if verdict else ''}
  <p class="note">施主が匿名で置いた見積書を、KIRA(AI)が項目ごとに読み、建設実務30年の監修の手順で掲載しています。業者名と個人情報は伏せています。相場を断定するものではありません。気になる点は、契約の前に業者さんへ確かめる材料としてお使いください。</p>
  <div class="cta">
    <b>あなたの見積書も、無料で解剖できます。</b>
    <p>写真を匿名で置くだけ。解剖まではログイン不要です。工事を請け負わない第三者なので、売り込みはありません。</p>
    <a class="btn" href="/hacker/submit/?from=card">見積書を匿名で解剖する(無料)</a>
  </div>
  <div class="sub">
    <a href="/hacker/">一覧を見る</a>
    <a href="{e(line_url)}" target="_blank" rel="noopener">LINE で送る</a>
    <a href="{e(x_url)}" target="_blank" rel="noopener">X で送る</a>
  </div>
  <div class="foot">HORIZON SHIELD(運営 The HORIZ音s株式会社)は、施工業者から紹介手数料や送客の報酬を受け取らない第三者です。監修 <a href="https://orcid.org/0009-0000-9180-903X">大賀俊勝</a>。</div>
</div>
</body>
</html>
"""


def build(cards, root, now=None):
    out_dir = os.path.join(root, "hacker", "c")
    os.makedirs(out_dir, exist_ok=True)
    kept, skipped, seen = [], [], {}
    for c in cards:
        ok, why = card_ok(c)
        if not ok:
            skipped.append((str(c.get("id", "?")) if isinstance(c, dict) else "?", why))
            continue
        key = (str(c.get("title", "")).strip(), re.sub(r"[^0-9]", "", str(c.get("amount", ""))), tuple(c.get("traits") or []))
        canonical = seen.setdefault(key, c["id"])
        d = os.path.join(out_dir, c["id"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page(c, canonical))
        kept.append((c, canonical == c["id"]))
    keep_ids = {c["id"] for c, _ in kept}
    removed = []
    for name in sorted(os.listdir(out_dir)):
        p = os.path.join(out_dir, name, "index.html")
        if name in keep_ids or not os.path.isfile(p):
            continue
        with open(p, encoding="utf-8") as f:
            head = f.read(200)
        if MARK in head:
            shutil.rmtree(os.path.join(out_dir, name))
            removed.append(name)
    today = (now or datetime.now(JST)).strftime("%Y-%m-%d")
    urls = []
    for c, canon in kept:
        if not canon:
            continue
        try:
            lm = datetime.fromtimestamp(int(c.get("created_at", 0)) / 1000, JST).strftime("%Y-%m-%d")
        except Exception:
            lm = today
        urls.append(f"  <url>\n    <loc>{SITE}/hacker/c/{c['id']}/</loc>\n    <lastmod>{lm}</lastmod>\n  </url>")
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"
    with open(os.path.join(root, "sitemap-ehn.xml"), "w", encoding="utf-8") as f:
        f.write(sm)
    return kept, skipped, removed


def fetch():
    req = urllib.request.Request(API, headers={"User-Agent": "hs-ehn-card-pages/1", "Origin": SITE})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    return d.get("cards", d) if isinstance(d, dict) else d


def report(kept, skipped, removed):
    print(f"ページにした {len(kept)} 枚(検索に載せる {sum(1 for _, c in kept if c)} 枚、同じ内容の重なり {sum(1 for _, c in kept if not c)} 枚は noindex)")
    for cid, why in skipped:
        print(f"  ページにしなかった {cid}: {why}")
    if removed:
        print(f"  掲示板から消えたので消した {len(removed)} 枚: {', '.join(removed)}")


def selftest():
    tmp = tempfile.mkdtemp()
    cards = [
        {"id": "card-1787411315401", "genre": "その他", "region": "神奈川県", "building": "戸建て", "title": "玄関カバー工事", "traits": ["施工費が一式<script>"], "verdict": "内訳の確認が必須", "amount": "458210", "initial": "キクチ", "created_at": 1787411315401},
        {"id": "card-1787411315402", "genre": "その他", "region": "", "building": "", "title": "玄関カバー工事", "traits": ["施工費が一式<script>"], "verdict": "x", "amount": "458210", "initial": "", "created_at": 1787411315402},
        {"id": "card-1787411315403", "title": "外壁塗装 山田塗装株式会社", "traits": [], "amount": "1"},
        {"id": "../../etc", "title": "x"},
        {"id": "card-1787411315404", "title": "電話は 0463-74-5917", "traits": []},
    ]
    kept, skipped, removed = build(cards, tmp, datetime(2026, 10, 9, tzinfo=JST))
    p1 = open(os.path.join(tmp, "hacker/c/card-1787411315401/index.html"), encoding="utf-8").read()
    p2 = open(os.path.join(tmp, "hacker/c/card-1787411315402/index.html"), encoding="utf-8").read()
    sm = open(os.path.join(tmp, "sitemap-ehn.xml"), encoding="utf-8").read()
    checks = [
        ("2 枚だけページになる", len(kept) == 2),
        ("社名・電話・変な id は弾く", len(skipped) == 3 and not os.path.exists(os.path.join(tmp, "etc"))),
        ("ニックネームは載せない", "キクチ" not in p1),
        ("本文と JSON-LD は escape される", "一式<script>" not in p1 and "&lt;script&gt;" in p1 and "\\u003cscript" in p1),
        ("題と金額", "玄関カバー工事の見積書(45.8万円)を解剖" in p1 and "458,210円" in p1),
        ("重なりは noindex で canonical は 1 枚目", 'noindex' in p2 and "/hacker/c/card-1787411315401/" in p2 and "noindex" not in p1),
        ("sitemap は 1 枚目だけ", sm.count("<loc>") == 1 and "card-1787411315401" in sm),
        ("投稿の口は from=card", "/hacker/submit/?from=card" in p1),
        ("ダッシュを使わない", not re.search("[‒-―]", p1)),
    ]
    os.makedirs(os.path.join(tmp, "hacker/c/handmade"))
    open(os.path.join(tmp, "hacker/c/handmade/index.html"), "w").write("<html>手作り</html>")
    kept2, _, removed2 = build([cards[0]], tmp)
    checks += [
        ("消えたカードのページは消す", removed2 == ["card-1787411315402"]),
        ("印の無いページは消さない", os.path.exists(os.path.join(tmp, "hacker/c/handmade/index.html"))),
    ]
    shutil.rmtree(tmp)
    bad = [n for n, ok in checks if not ok]
    for n, ok in checks:
        print(("PASS " if ok else "FAIL ") + n)
    print(f"{len(checks) - len(bad)}/{len(checks)} passed")
    return 0 if not bad else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--in" in argv:
        with open(argv[argv.index("--in") + 1], encoding="utf-8") as f:
            d = json.load(f)
        cards = d.get("cards", d) if isinstance(d, dict) else d
    else:
        try:
            cards = fetch()
        except Exception as ex:
            print(f"公開 API から取れませんでした。何も書き換えません: {ex}")
            return 2
    if not isinstance(cards, list) or not cards:
        print("カードが 0 枚でした。何も書き換えません。")
        return 2
    report(*build(cards, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
