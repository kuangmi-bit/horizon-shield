#!/usr/bin/env python3
"""souba の相場ページに、逆見積もりへの箱を 1 つ足す。何度走らせても二重に入らない。

    python3 tools/souba_reverse_cta.py            # 何をするかを一覧で出すだけ(書かない)
    python3 tools/souba_reverse_cta.py --write    # 書く
    python3 tools/souba_reverse_cta.py --selftest # 入れ方の規則を偽のページで確かめる

対象: souba/<名前>/index.html のうち、検索に出すページ(noindex でも meta refresh でもない)で、
      逆見積もり(/hs-reverse-estimate/)にも鑑定(/kantei/)にも、押せるリンクが 1 本も無いもの。県別スタブ(noindex)には入れない。
場所: h1 の後の最初の section の中で、最初の表の直後。表が無ければ最初の段落の直後。
印:   data-cta="reverse-v1"。この印があるページは触らない。
箱の文言に金額は書かない。本文は 1 文字も変えない(箱の 1 行を足すだけ)。
"""
import glob, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://shield.the-horizons-innovation.com"
MARK = 'data-cta="reverse-v1"'
TEXT = "この工事の適正価格を、あなたの家の条件で出す（無料・会員登録なし）→"


def is_stub(html):
    return bool(re.search(r'<meta[^>]+name="robots"[^>]+noindex', html, re.I)) or 'http-equiv="refresh"' in html


def work_name(html):
    """題名の先頭から工事名を取る。取れなければ None(その時は ?work を付けない)。"""
    m = re.search(r"<title>([^<]+)</title>", html)
    if not m:
        return None
    t = m.group(1).strip()
    t = re.split(r"の相場|の費用|の適正|の価格|費用|相場|適正価格|｜|\||【|\(|（|\s", t, maxsplit=1)[0].strip("・、 ")
    if not t or len(t) > 16 or re.search(r"[0-9０-９<>\"'&?#。、？！!]", t):
        return None
    # 工事の名前で終わる題名だけを渡す。「足場代が高すぎます」「退去」のような題名は工事名ではないので渡さない。
    if not re.search(r"(塗装|工事|交換|リフォーム|修理|補修|駆除|設置|補強|防水|解体|葺き替え|張替え|張り替え|清掃|取付|取り付け|外構)$", t):
        return None
    return t


def box(work):
    href = BASE + "/hs-reverse-estimate/" + ("?work=" + urllib.parse.quote(work) if work else "")
    return ('\n<div ' + MARK + ' style="margin:18px 0;"><a href="' + href + '" style="display:block;border:2px solid #C8960A;'
            'padding:14px 16px;font-weight:700;color:inherit;text-decoration:none;line-height:1.5;">' + TEXT + "</a></div>\n")


def insertion_point(html):
    """箱を入れる位置(文字の番号)と、何の直後かを返す。入れる所が無ければ (None, 理由)。"""
    h1 = html.find("</h1>")
    if h1 < 0:
        return None, "h1 が無い"
    sec = html.find('<div class="section"', h1)
    start = sec if sec >= 0 else h1
    nxt = html.find('<div class="section"', start + 10)
    end = nxt if nxt >= 0 else min(len(html), start + 8000)
    seg = html[start:end]
    t = seg.find("</table>")
    if t >= 0:
        return start + t + len("</table>"), "最初の表"
    p = seg.find("</p>")
    if p >= 0:
        return start + p + len("</p>"), "最初の段落"
    return None, "最初の section に表も段落も無い"


def plan(html):
    if is_stub(html):
        return "skip", "県別スタブ(noindex または refresh)", None
    if MARK in html:
        return "skip", "箱は入っている", None
    # 文字があるだけでは数えない。押せるリンク(<a href>)があるかで見る。
    # 2026-10-07: souba/gaiheki は FAQ の文中に「(/kantei/)」と書いてあるだけで、リンクは 1 本も無かった。
    if re.search(r'<a\b[^>]*href="[^"]*(hs-reverse-estimate|/kantei/)', html):
        return "skip", "診断へのリンクが既にある", None
    pos, where = insertion_point(html)
    if pos is None:
        return "skip", where, None
    w = work_name(html)
    return "add", where + "の直後" + ("、work=" + w if w else "、work なし"), html[:pos] + box(w) + html[pos:]


def selftest():
    bad = 0
    def check(name, got, want):
        nonlocal bad
        ok = got == want
        bad += not ok
        print(("ok   " if ok else "NG   ") + name + ("" if ok else "  got %r want %r" % (got, want)))
    page = ('<html><head><title>外壁塗装の相場・適正価格【2026年最新】 | HS</title><meta name="robots" content="index,follow"></head><body><h1>x</h1>'
            '<div class="section"><h2>a</h2><p>直答</p><table><tr><td>1</td></tr></table><p>次</p></div><div class="section"><table></table></div></body></html>')
    a, why, out = plan(page)
    check("表のあるページ: 足す", a, "add")
    check("箱は最初の表の直後", out.index(MARK) > out.index("</table>") and out.index(MARK) < out.index("<p>次</p>"), True)
    check("箱は 1 つ", out.count(MARK), 1)
    check("工事名が付く", "?work=" + urllib.parse.quote("外壁塗装") in out, True)
    check("本文は変えない(箱を除けば元と同じ)", out.replace(box("外壁塗装"), ""), page)
    check("二度目は触らない", plan(out)[0], "skip")
    check("金額を書かない", bool(re.search(r"[0-9０-９]|円|万", box("外壁塗装").split(">")[2])), False)
    nop = page.replace("<table><tr><td>1</td></tr></table>", "")
    a, why, out = plan(nop)
    check("表が無ければ最初の段落の直後", out.index("<div " + MARK) == out.index("<p>直答</p>") + len("<p>直答</p>") + 1, True)
    check("工事名でない題名は渡さない", [work_name("<title>%s</title>" % t) for t in ("足場代が高すぎます。", "退去の費用", "建設費の相場", "給湯器交換の費用相場")], [None, None, None, "給湯器交換"])
    check("県別スタブ(noindex)には入れない", plan(page.replace("index,follow", "noindex,follow"))[0], "skip")
    check("meta refresh のページには入れない", plan(page.replace("<head>", '<head><meta http-equiv="refresh" content="0;url=/">'))[0], "skip")
    check("既に逆見積もりへのリンクがあるページは触らない", plan(page.replace("<p>次</p>", '<a href="/hs-reverse-estimate/">x</a>'))[0], "skip")
    check("既に /kantei/ へのリンクがあるページは触らない", plan(page.replace("<p>次</p>", '<a href="/kantei/">x</a>'))[0], "skip")
    check("文中に /kantei/ と書いてあるだけ(リンクなし)のページには足す", plan(page.replace("<p>次</p>", "<p>鑑定(/kantei/)もあります</p>"))[0], "add")
    check("題名から工事名が取れなければ work を付けない", "?work=" in plan(page.replace("外壁塗装の相場・適正価格【2026年最新】", "2026年の相場"))[2], False)
    check("長すぎる工事名は付けない", work_name("<title>" + "あ" * 17 + "の相場</title>"), None)
    print("\n%s" % ("all passed" if not bad else "%d failed" % bad))
    return 1 if bad else 0


def main():
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    write = "--write" in sys.argv
    added, skipped = [], {}
    for f in sorted(glob.glob(os.path.join(ROOT, "souba", "*", "index.html"))):
        html = open(f, encoding="utf-8").read()
        action, why, out = plan(html)
        rel = os.path.relpath(f, ROOT)
        if action == "add":
            added.append((rel, why))
            if write:
                open(f, "w", encoding="utf-8").write(out)
        else:
            skipped[why] = skipped.get(why, 0) + 1
    for rel, why in added:
        print(("wrote " if write else "would add ") + rel + "  (" + why + ")")
    print("\n%s %d pages" % ("wrote" if write else "would add to", len(added)))
    for why, n in sorted(skipped.items()):
        print("skipped %d: %s" % (n, why))


if __name__ == "__main__":
    main()
