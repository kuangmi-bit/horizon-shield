#!/usr/bin/env python3
"""souba の相場ページの逆見積もりの箱(data-cta="reverse-v1")の直後に、EHN への箱を 1 つ足す。何度走らせても二重に入らない。

    python3 tools/souba_ehn_cta.py            # 何をするかを一覧で出すだけ(書かない)
    python3 tools/souba_ehn_cta.py --write    # 書く
    python3 tools/souba_ehn_cta.py --selftest # 入れ方の規則を偽のページで確かめる

2026-10-09: 相場ページに来る人のうち、見積書をもう持っている人の行き先が無かった(箱は逆見積もりだけ)。
対象: 逆見積もりの箱があるページだけ(箱があるのは検索に出す相場ページだけ、県別スタブには無い)。
場所: 逆見積もりの箱の直後。
印:   data-cta="ehn-v1"。この印があるページは触らない。
本文は 1 文字も変えない(箱の 1 行を足すだけ)。箱の文言に金額は書かない。
"""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://shield.the-horizons-innovation.com"
REV = re.compile(r'<div data-cta="reverse-v1"[^>]*>.*?</div>', re.S)
MARK = 'data-cta="ehn-v1"'
TEXT = "見積書がもう手元にあるなら、匿名で KIRA に解剖させる（無料・業者名は伏せます）→"
BOX = ('\n<div ' + MARK + ' style="margin:-8px 0 18px;"><a href="' + BASE + '/hacker/submit/?from=box" style="display:block;'
       'border:1px solid #16181d;padding:12px 16px;font-weight:700;color:inherit;text-decoration:none;line-height:1.5;">' + TEXT + "</a></div>")


def plan(html):
    if MARK in html:
        return "skip", "EHN の箱は入っている", None
    m = REV.search(html)
    if not m:
        return "skip", "逆見積もりの箱が無い", None
    return "add", "逆見積もりの箱の直後", html[:m.end()] + BOX + html[m.end():]


def selftest():
    bad = 0
    def check(name, got, want):
        nonlocal bad
        ok = got == want
        bad += not ok
        print(("ok   " if ok else "NG   ") + name + ("" if ok else "  got %r want %r" % (got, want)))
    rev = '<div data-cta="reverse-v1" style="margin:18px 0;"><a href="' + BASE + '/hs-reverse-estimate/?from=box" style="a">t</a></div>'
    page = "<html><body><h1>x</h1><div class=\"section\"><table></table>\n" + rev + "\n<p>本文</p></div></body></html>"
    a, why, out = plan(page)
    check("逆見積もりの箱があれば足す", a, "add")
    check("箱は逆見積もりの箱の直後", out.index(MARK) > out.index('data-cta="reverse-v1"') and out.index(MARK) < out.index("<p>本文</p>"), True)
    check("本文は変えない(箱を除けば元と同じ)", out.replace(BOX, ""), page)
    check("箱は 1 つ", out.count(MARK), 1)
    check("二度目は触らない", plan(out)[0], "skip")
    check("逆見積もりの箱が無いページは触らない", plan(page.replace(rev, ""))[0], "skip")
    check("行き先は EHN の投稿、from=box", '/hacker/submit/?from=box"' in BOX, True)
    check("金額を書かない", bool(re.search(r"[0-9０-９]|円|万", TEXT)), False)
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
            added.append(rel)
            if write:
                open(f, "w", encoding="utf-8").write(out)
        else:
            skipped[why] = skipped.get(why, 0) + 1
    for rel in added:
        print(("wrote " if write else "would add ") + rel)
    print("\n%s %d pages" % ("wrote" if write else "would add to", len(added)))
    for why, n in sorted(skipped.items()):
        print("skipped %d: %s" % (n, why))


if __name__ == "__main__":
    main()
