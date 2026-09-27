#!/usr/bin/env python3
"""hs-law-watch の鏡(mirror)を作る。Cloudflare からの取得を弾く頁(USACE の .mil、FTA の transit.dot.gov)を、
GitHub Actions の網から取り、<a ...>...</a> の並びだけを data/law-watch/mirror/<id>.json に書く。2026-09-27 番人。

なぜ: hs-law-watch(Cloudflare Workers)の cron は毎回 403 で、この 3 か所の変化を見られていなかった。頁の本文は写さず、
     worker の parseLinks が読む <a> だけを写す(鍵 = URL + 文字 が直接の取得と同じになるので、直接が戻っても偽の出来事は出ない)。
     link_filter に当たる <a> だけを残す(小さく保つ)。相手が 200 を返さなかったときは status を書くだけで anchors は空(worker は鏡を使わない)。

使い方: python3 workers/hs-law-watch/tools/mirror_fetch.py [--out data/law-watch/mirror] [--only id,id]
検査: python3 workers/hs-law-watch/tools/mirror_fetch.py --selftest(網に出ない。<a> の切り出しと link_filter が worker と同じ動きをすること)
入力の一覧(MIRRORS)は src/sources.js の mirror つきの行と同じ id・url・link_filter でなければならない(test/harness.mjs が突き合わせる)。
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error, datetime
from urllib.parse import urljoin
from html import unescape

MIRRORS = [
    {"id": "usace-cwccis", "url": "https://www.nww.usace.army.mil/missions/cost-engineering/cwccis-indices/", "link_filter": r"publibrary\.sec\.usace\.army\.mil/api/download|/Portals/28/.*\.pdf"},
    {"id": "usace-ep1110", "url": "https://www.nww.usace.army.mil/missions/cost-engineering/ep1110-1-8/", "link_filter": r"/Portals/28/.*\.pdf|contentdm\.oclc\.org/utils/getfile"},
    {"id": "fta-capital-cost", "url": "https://www.transit.dot.gov/capital-cost-database", "link_filter": r"/files/docs/.*\.(csv|accdb|xlsx)$"},
]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 hs-law-watch-mirror/0.1 (+https://shield.the-horizons-innovation.com)"
A_RE = re.compile(r'<a\b[^>]*href\s*=\s*["\']([^"\'#]+)["\'][^>]*>([\s\S]*?)</a>', re.I)

def anchors_of(html, base, link_filter):
    """worker の parseLinks と同じ条件で <a> を選ぶ(URL は base で絶対にし、link_filter を当てる。文字が空の <a> は捨てる)。返すのは <a> の原文。"""
    f = re.compile(link_filter) if link_filter else None
    out, seen = [], set()
    for m in A_RE.finditer(html):
        try: url = urljoin(base, unescape(m.group(1)))
        except Exception: continue
        if f and not f.search(url): continue
        text = re.sub(r"<[^>]+>", " ", m.group(2)); text = re.sub(r"\s+", " ", unescape(text)).strip()
        if not text: continue
        raw = m.group(0)
        if raw in seen: continue
        seen.add(raw); out.append(raw)
    return out

def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        return e.code, "", ""
    except Exception as e:
        return 0, "", str(e)[:200]

def selftest():
    html = '<html><a href="/Portals/28/docs/cwccis 2026-03.pdf">CWCCIS <b>March</b> 2026</a> <a href="#top">x</a> <a href="https://publibrary.sec.usace.army.mil/api/download/123">EM 1110-2-1304</a> <a href="/other.html">no</a> <a href="/Portals/28/x.pdf"></a></html>'
    a = anchors_of(html, MIRRORS[0]["url"], MIRRORS[0]["link_filter"])
    assert len(a) == 2 and a[0].startswith('<a href="/Portals/28/docs/cwccis 2026-03.pdf">') and "publibrary" in a[1], a
    b = anchors_of('<a href="/sites/fta.dot.gov/files/docs/FTA-Cost-Database-September-2024.csv">CSV</a><a href="/files/docs/guide.pdf">pdf</a>', MIRRORS[2]["url"], MIRRORS[2]["link_filter"])
    assert len(b) == 1 and "September-2024.csv" in b[0], b
    print("selftest ok")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/law-watch/mirror"); ap.add_argument("--only", default=""); ap.add_argument("--selftest", action="store_true")
    A = ap.parse_args()
    if A.selftest: return selftest()
    os.makedirs(A.out, exist_ok=True)
    only = set(x for x in A.only.split(",") if x)
    runner = os.environ.get("GITHUB_RUN_ID") and f"github-actions run {os.environ.get('GITHUB_RUN_ID')}" or "manual"
    summary = []
    for m in MIRRORS:
        if only and m["id"] not in only: continue
        status, html, note = fetch(m["url"])
        anchors = anchors_of(html, m["url"], m["link_filter"]) if status == 200 else []
        rec = {"source_id": m["id"], "url": m["url"], "fetched_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "status": status, "anchors": anchors, "link_filter": m["link_filter"], "runner": runner, "user_agent": UA,
               "note": "worker の parseLinks が読む <a> の原文だけ(link_filter に当たる物)。本文は写していない。status が 200 でないときは anchors は空で、worker は鏡を使わない。" + (" " + note if note else "")}
        path = os.path.join(A.out, m["id"] + ".json")
        prev = None
        if os.path.exists(path):
            try: prev = json.load(open(path, encoding="utf-8"))
            except Exception: prev = None
        # 相手が落ちていた回は、前回の 200 の鏡を上書きしない(worker は fetched_at で古さを見るので、古くなれば自然に使われなくなる)
        if status != 200 and prev and prev.get("status") == 200:
            summary.append(f"{m['id']}: HTTP {status}、前回(200、{prev.get('fetched_at')})の鏡を残す")
            continue
        json.dump(rec, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        summary.append(f"{m['id']}: HTTP {status}、<a> {len(anchors)} 本")
        time.sleep(2)
    print("\n".join(summary))
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
