# -*- coding: utf-8 -*-
"""
indexnow_submit.py の関所2(禁止語)の試験。2026-10-04。
禁止語は本体と同じく逆順表記から実行時に作る(ソースに平文を置かない)。
使い方: python3 tools/test_indexnow_gate.py   (失敗が1つでもあれば exit 1)
"""
import os, sys, base64, random
os.environ.setdefault("INDEXNOW_KEY", "test-not-a-key")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import indexnow_submit as ix

NUM = [w for w in ix.MOAT_FORBIDDEN if not any(c.isalpha() for c in w)][0]
UND = [w for w in ix.MOAT_FORBIDDEN if "_" in w][0]
W3 = [w for w in ix.MOAT_FORBIDDEN if w.isalpha()][0]

def jpeg_with(word):
    """JPEG の頭で始まり、base64 にした時に word の並びを含む塊(画像の偶然の再現)。決定論的。"""
    rnd = random.Random(20261004)
    while True:
        raw = b"\xff\xd8\xff\xe0" + bytes(rnd.getrandbits(8) for _ in range(600))
        s = base64.b64encode(raw).decode()
        if word in s:
            return s

def run_gate(html):
    ix.fetch = lambda url: (200, html)
    return ix.gate("https://" + ix.HOST + "/t/", False)

P = jpeg_with(W3)
CASES = [
    ("pass: 画像の base64 に偶然出た並び",            '<img src="data:image/jpeg;base64,%s" alt="card">' % P, True),
    ("pass: CSS の url() の中",                       "<style>.c{background:url(data:image/jpeg;base64,%s)}</style>" % P, True),
    ("pass: 健全な頁",                                "<p>平均削減率は約33%</p>", True),
    ("drop: 本文にそのまま",                          "<p>%s</p>" % W3, False),
    ("drop: 画像の alt に",                           '<img src="data:image/jpeg;base64,%s" alt="%s">' % (P, W3), False),
    ("drop: 画像の型の後ろに _ 入りの語",             '<img src="data:image/jpeg;base64,/9j/%s">' % UND, False),
    ("drop: SVG(base64 でない)の中",                  '<img src="data:image/svg+xml,<svg><text>%s</text></svg>">' % W3, False),
    ("drop: 数の語を本文に",                          "<p>係数は %s</p>" % NUM, False),
    ("drop: 数の語を JSON-LD に",                     '<script type="application/ld+json">{"d":"%s%%"}</script>' % NUM, False),
]
fails = 0
for name, html, want in CASES:
    ok, why = run_gate(html)
    good = (ok == want)
    fails += (not good)
    print(("  ok   " if good else "  FAIL ") + name + "  -> " + why)

# 文を画像の型で包んだものは外さない(中身が UTF-8 で読める)
fake = "data:image/png;base64," + base64.b64encode(("GIF89a " + W3).encode()).decode() + '"'
kept = ix.strip_binary_images(fake) == fake
fails += (not kept)
print(("  ok   " if kept else "  FAIL ") + "keep: 文を画像の型で包んだ塊は外さない")

# 実物: /ehn/ は画像の中にしか並びが無い
ehn = os.path.join(ROOT, "ehn", "index.html")
if os.path.exists(ehn):
    body = open(ehn, encoding="utf-8").read()
    raw_hit = [w for w in ix.MOAT_FORBIDDEN if w in body]
    after = [w for w in ix.MOAT_FORBIDDEN if w in ix.strip_binary_images(body)]
    good = bool(raw_hit) and not after
    fails += (not good)
    print(("  ok   " if good else "  FAIL ") + "ehn/index.html: 外す前 %d 語 / 外した後 %d 語" % (len(raw_hit), len(after)))

# 認めている残り: 本物の画像の塊の末尾に base64 の文字だけで書き足した並びは、画像と区別できないので外れる。
#   読める文にはならない(base64 の雑音に混ざる)ので、漏れとは扱わない。
print("\n%s: 失敗 %d 件" % ("PASS" if fails == 0 else "FAIL", fails))
sys.exit(1 if fails else 0)
