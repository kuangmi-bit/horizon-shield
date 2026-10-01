#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bing Webmaster に URL を API で送ってクロールを頼み(SubmitUrlBatch)、送る前と後に各 URL の状態を読む(GetUrlInfo)。
既定は sitemap.xml の /us/ の URL 全部。鍵は bing_sitemap_submit.py と同じく画面で聞く(入力は表示されない、どこにも書かない)。

  python3 ops/bing_submit_urls.py            残りの送信枠と各 URL の状態だけ(送らない)
  python3 ops/bing_submit_urls.py --send     送って、もう一度状態を読む
  python3 ops/bing_submit_urls.py --send --match /us/guides/
"""
import os, sys, json, re, time, argparse, getpass, urllib.request, urllib.parse, urllib.error
SITE = "https://shield.the-horizons-innovation.com/"
API = "https://ssl.bing.com/webmaster/api.svc/json/"

def call(method, key, params=None, body=None):
    q = {"apikey": key}
    if params: q.update(params)
    url = API + method + "?" + urllib.parse.urlencode(q)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "HS-bing-submit-urls"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")

def sitemap_urls(match):
    with urllib.request.urlopen(urllib.request.Request(SITE + "sitemap.xml", headers={"User-Agent": "HS-bing-submit-urls"}), timeout=30) as r:
        xml = r.read().decode("utf-8", "replace")
    return [u for u in re.findall(r"<loc>([^<]+)</loc>", xml) if match in u]

def day(v):
    m = re.search(r"-?\d+", str(v or ""))
    if not m or int(m.group()) <= 0: return "なし"
    return time.strftime("%Y-%m-%d", time.gmtime(int(m.group()) / 1000))

def status(key, urls):
    for u in urls:
        time.sleep(2)   # GetUrlInfo は連続 10 回ほどで ThrottleHost を返す
        st, txt = call("GetUrlInfo", key, {"siteUrl": SITE, "url": u})
        if st != 200:
            print("  %-90s HTTP %s %s" % (u.replace(SITE, "/"), st, txt[:120])); continue
        d = json.loads(txt).get("d") or {}
        print("  %-90s 発見 %s | 最終クロール %s | HTTP %s | 文書の大きさ %s" % (
            u.replace(SITE, "/"), day(d.get("DiscoveryDate")), day(d.get("LastCrawledDate")), d.get("HttpStatus"), d.get("DocumentSize")))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--match", default="/us/")
    a = ap.parse_args()
    key = getpass.getpass("Bing Webmaster の API キー(設定 > API アクセス、英数字 32 桁)を貼って Enter: ").strip()
    if not key.isalnum() or len(key) < 20:
        print("キーの形が違う。何も送っていない。"); sys.exit(1)
    urls = sitemap_urls(a.match)
    print("sitemap.xml から %d 本(%s を含む)" % (len(urls), a.match))
    st, txt = call("GetUrlSubmissionQuota", key, {"siteUrl": SITE})
    print("送信枠: " + (txt[:200] if st == 200 else "HTTP %s %s" % (st, txt[:200])))
    print("=== 送る前の状態 ==="); status(key, urls)
    if not a.send:
        print("[dry-run] 送っていない"); return
    st, txt = call("SubmitUrlBatch", key, body={"siteUrl": SITE, "urlList": urls})
    print(("送信 OK %d 本" % len(urls)) if st == 200 else ("送信 失敗 HTTP %s %s" % (st, txt[:300])))
    if st != 200: sys.exit(1)
    st, txt = call("GetUrlSubmissionQuota", key, {"siteUrl": SITE})
    print("送信後の枠: " + (txt[:200] if st == 200 else "HTTP %s" % st))
    print("=== 送った後の状態(クロールは数時間から数日後) ==="); status(key, urls)

if __name__ == "__main__":
    main()
