#!/usr/bin/env python3
"""見積書の解剖シリーズ /hacker/kaibou/ の生成器。

使い方:
  python3 tools/ehn_kaibou_pages.py --out .            # HTML を書き出す
  python3 tools/ehn_kaibou_pages.py --out . --img-html DIR  # 画像用 HTML も書き出す(描画は playwright で別途)
  python3 tools/ehn_kaibou_pages.py --selftest

事例を足すときは CASES に1件足して、もう一度回すだけ。
投稿者名・業者名・住所は載せない(SNS で公開された金額と工事内容だけを使う)。
"""
import argparse, html, json, os, sys

BASE = "https://shield.the-horizons-innovation.com"
MARK = "<!-- generated: ehn_kaibou_pages.py -->"
DATE = "2026-10-09"
CTA = "/hacker/submit/?from=kaibou"
SRC_DB = "HORIZON SHIELD 相場DB"

# rows: (見出し, 中身, 赤にするか)
CASES = [
 {"no": "01", "slug": "01", "tag": "サンルーム屋根 ポリカ1枚の交換", "title": "サンルームの屋根1枚で20万円は高いか",
  "h1a": "この20万円、", "h1b": "3分の2は足場代。",
  "sub": "税抜 183,000円の内訳(見積書の数字そのまま)",
  "bars": [("仮設足場 1式", 120000, True), ("取替工事費 1式", 35000, False), ("ポリカパネル材料 1枚", 18000, False), ("諸経費 1式", 10000, False)],
  "situation": "2階のサンルームの屋根(ポリカーボネート)が1枚割れ、交換の見積が税込201,300円。「ボッタクリ」としてXに投稿され、約500万回表示されました。",
  "askl": "ボッタクリかどうかは、この1行で決まる。業者に聞くこと:", "ask": "「足場は何㎡架けますか。足場なしで直す方法はありませんか。」",
  "ref": "2階建て30坪の家を丸ごと囲う足場で 15〜25万円が目安です(HORIZON SHIELD 相場DB)。屋根1枚のための足場が、家1棟分の5〜8割。屋根材と交換の手間 5.3万円は普通の値段です。",
  "kw": "サンルーム 屋根 交換 費用,ポリカ 屋根 1枚 交換 見積,足場代 高い"},
 {"no": "02", "slug": "02", "tag": "外壁の大規模修繕 500万と300万", "title": "外壁の修繕、500万と300万の差はどこで生まれるか",
  "h1a": "200万の差は、", "h1b": "この4行に出る。", "sub": "総額ではなく、2社の見積書を横に並べて見る行",
  "rows": [("塗料", "シリコンかフッ素か無機か。製品名まで書いてあるか", True), ("シーリング", "打ち替えか増し打ちか。何mか", False), ("付帯部", "雨樋・破風・軒天・ベランダ防水まで含むか", False), ("足場・下地補修", "何㎡か。ひび割れ補修の範囲が書いてあるか", False)],
  "situation": "築20年の家で初めての外壁の大規模修繕。大手ハウスメーカーの見積が500万円、ほかの会社が300万円。どちらに頼むべきかという相談です。",
  "askl": "中身をそろえる1行:", "ask": "「同じ塗料・同じ範囲にしたら、いくらになりますか。」",
  "ref": "中身をそろえても差が残れば、それが看板料と保証の値段です。保証の年数と中身も、同じ表に並べて比べてください。",
  "kw": "外壁 修繕 ハウスメーカー 高い,外壁塗装 見積 比較,シーリング 打ち替え 増し打ち"},
 {"no": "03", "slug": "03", "tag": "給湯器の交換 撤去・設置込み30万円", "title": "給湯器の交換で30万円は高いか",
  "h1a": "30万が高いかは、", "h1b": "号数で決まる。", "sub": "本体+工事費込みの適正レンジ(HORIZON SHIELD 相場DB)",
  "rows": [("16号 従来型", "13〜25万円 → 30万なら高め", True), ("20号 従来型", "15〜30万円 → 上限いっぱい", False), ("24号 従来型", "18〜38万円 → 範囲内", False), ("20号 エコジョーズ", "20〜38万円 → 範囲内", False), ("24号 エコジョーズ", "25〜45万円 → 安め", False)],
  "situation": "給湯器の買い替えで、撤去と設置込み30万円の見積。",
  "askl": "見積書で確かめる1行:", "ask": "「本体の型番と号数、追い焚きの有無」",
  "ref": "型番が書いてあれば、本体の値段と工事費を分けて確かめられます。省エネ型は国の補助金の対象になることがあるので、申請までやる業者かも聞いてください。",
  "kw": "給湯器 交換 30万 高い,給湯器 号数 相場,エコジョーズ 交換 費用"},
 {"no": "04", "slug": "04", "tag": "天井の雨漏り修理 46万円", "title": "雨漏り修理で46万円は高いか",
  "h1a": "部分補修の相場は", "h1b": "3〜30万円。", "sub": "46万なら、相場との差が何から来ているか。確かめる行",
  "rows": [("原因の特定", "散水調査で、どこから入るか確かめたか", True), ("直す範囲", "雨の入口だけか、屋根全体の葺き替えやカバーか", False), ("足場", "要るのか。要るなら何㎡か", False), ("天井の内装", "室内側の張り替えまで入っているか", False)],
  "situation": "天井の雨漏りの修理見積が46万円。",
  "askl": "業者に聞く1行:", "ask": "「雨の入口はどこで、なぜそこだと分かったんですか。」",
  "ref": "原因が分からないまま広い範囲を直す見積は要注意です。直しても止まらないことがあります。相場の出典は HORIZON SHIELD 相場DB(雨漏り修理 部分補修)。",
  "kw": "雨漏り 修理 見積 高い,雨漏り 部分補修 相場,散水調査"},
 {"no": "05", "slug": "05", "tag": "外壁塗装の見積 80万〜250万円", "title": "外壁塗装の見積が80万から250万まで開く理由",
  "h1a": "80万と250万の差は、", "h1b": "塗料だけじゃない。", "sub": "同じ家で3倍の幅が出るとき、混ざっているもの",
  "rows": [("塗料", "シリコン・フッ素・無機。耐用年数で割って比べる", True), ("足場", "30坪2階建てで 15〜25万円が目安", False), ("下地とシーリング", "ひび割れ補修と目地の打ち替えを含むか", False), ("付帯部", "雨樋・破風・軒天まで塗るか", False)],
  "situation": "訪問した営業から、塗料の違いで80万円から250万円まで、と外壁塗装の見積を示された。塗り替えは来年以降の予定。",
  "askl": "業者を呼ぶ前にやること:", "ask": "自分の家の外壁の面積を、先に出しておく。",
  "ref": "面積が分かれば、㎡単価で比べられます。営業の総額に振り回されなくなります。足場の目安の出典は HORIZON SHIELD 相場DB。",
  "kw": "外壁塗装 見積 幅,外壁塗装 塗料 違い 価格,外壁塗装 相場 30坪"},
 {"no": "06", "slug": "06", "tag": "屋根とブロック塀 保険金とほぼ同額の見積", "title": "保険金とほぼ同じ額の修理見積、どこを見るか",
  "h1a": "保険金と同じ額の見積は、", "h1b": "中身を見る。", "sub": "金額が保険金に合わせて組まれていないか、確かめる行",
  "rows": [("直す場所", "屋根の「どこを」直すのか。写真と一致するか", True), ("数量", "何㎡・何m・何枚か。「1式」だけになっていないか", False), ("被害との関係", "地震で壊れた所だけか。元からの劣化も入っていないか", False), ("ブロック塀", "高さと長さ。撤去か補修か", False)],
  "situation": "業者が置いていった屋根とブロック塀の修理見積が、地震保険で降りた保険金とほぼ同額だった。",
  "askl": "業者に聞く1行:", "ask": "「保険金がいくらでも、この金額になりますか。」",
  "ref": "持ち出しがなくても、直す中身が見積書に書かれていることが大事です。書かれていない工事は、あとで「やっていない」と言えません。",
  "kw": "保険金 修理 見積 同額,地震保険 屋根 修理 業者,火災保険 修理 見積 注意"},
 {"no": "07", "slug": "07", "tag": "ハウスメーカーの外壁塗装 270万円", "title": "外壁塗装270万円と「今契約なら半額」",
  "h1a": "「今契約なら半額」は、", "h1b": "270万に根拠がない合図。", "sub": "30坪の家の場合の目安(HORIZON SHIELD 相場DB)と並べる",
  "rows": [("足場", "見積 35万円 → 目安は 15〜25万円", True), ("外壁塗装(シリコン)", "足場込み 70〜115万円", False), ("外壁+屋根のセット", "足場込み 90〜130万円", False), ("無機塗料なら", "㎡ 4,500〜6,500円(塗る面積に掛ける)", False)],
  "situation": "ハウスメーカーに外壁塗装の見積を頼んだら270万円(ベランダ抜き)。足場35万円、解体撤去10万円。「今契約するなら半額にする」と言われた。",
  "askl": "ハウスメーカーに頼むこと:", "ask": "「塗料の製品名と、塗る面積(㎡)を書いてください。」",
  "ref": "その場で半額にできる見積は、元の数字が積み上げではないということです。面積と塗料が分かれば、塗装専門店の見積と同じ物差しで比べられます。",
  "kw": "外壁塗装 270万 高い,今契約なら半額 外壁塗装,ハウスメーカー 外壁塗装 相場"},
 {"no": "08", "slug": "08", "tag": "新築の外構 570万円(予算250万)", "title": "外構570万円の見積、どこにいくらかかっているか",
  "h1a": "570万の外構は、", "h1b": "「どこにいくら」で見る。", "sub": "関東の外構フルセットは 100〜180万円が目安(HORIZON SHIELD 相場DB)",
  "rows": [("タイルデッキ・ポーチ", "何㎡か。タイルの品番と㎡単価が書いてあるか", True), ("フェンス", "何mか。見える所とメッシュで行が分かれているか", False), ("見えない工事", "土間・残土処分・ブロック基礎はいくらか", False), ("経由する会社", "ハウスメーカー経由なら、手数料が乗っている", False)],
  "situation": "都内の新築で、玄関ポーチ・タイルデッキ・家まわりのフェンスだけの外構が570万円。予算250万円から320万円の超過。",
  "askl": "次にやること:", "ask": "同じ図面で、外構専門店から直接見積を取る。",
  "ref": "図面が同じなら、行ごとに横へ並べられます。削るなら「見えない所のフェンス」と「デッキの面積」からが効きます。",
  "kw": "外構 見積 高い,外構 予算オーバー,タイルデッキ 費用"},
 {"no": "09", "slug": "09", "tag": "マンションの浴室 1620 230万円", "title": "1620の浴室リフォームで230万円は高いか",
  "h1a": "1620の浴室で230万は、", "h1b": "定価の見積。", "sub": "ユニットバス交換の目安(工事込み・HORIZON SHIELD 相場DB)",
  "rows": [("1620 ハイグレード", "140〜220万円 → 230万は上限を超える", True), ("1616 ミドル", "90〜150万円", False), ("1216 ロー", "60〜110万円", False), ("マンションで足すもの", "搬入・養生・管理組合への届出", False)],
  "situation": "メーカーのショールームで選んだ面材で、マンションの1620サイズの浴室の見積が230万円超(取り付け費・配送費込み)。",
  "askl": "リフォーム会社に頼むこと:", "ask": "「本体の定価、掛け率(何%引き)、工事費を分けて書いてください。」",
  "ref": "ショールームの見積は定価が基本です。本体は掛け率で下がるので、同じ品番で2社に出すと、工事費の差もそのまま見えます。",
  "kw": "ユニットバス 1620 交換 費用,浴室リフォーム マンション 相場,ショールーム 見積 定価"},
 {"no": "10", "slug": "10", "tag": "外壁ガルバのカバー工法 177㎡ 390万円", "title": "外壁カバー工法390万円を4行に分けて見る",
  "h1a": "390万を、", "h1b": "4行に分けて見る。", "sub": "外壁カバー・屋根塗装・足場・防水が1つの総額に混ざっている",
  "rows": [("外壁カバー", "177㎡ × 単価。材料の商品名と厚み", True), ("屋根塗装", "別の行で。塗料名と面積", False), ("足場・養生", "何㎡か(30坪の家で 15〜25万円が目安)", False), ("ベランダ防水", "FRPかウレタンか。何㎡か", False)],
  "situation": "外壁177㎡を金属サイディング(ガルバリウム)でカバーし、屋根は塗装。足場・養生・ベランダ防水込みで約390万円。",
  "askl": "業者に聞く1行:", "ask": "「外壁カバーだけの㎡単価はいくらですか。」",
  "ref": "㎡単価が出れば、他社や量販店の見積と横に並べられます。足場を組む今なら、屋根を塗装にするかカバーにするかも同じ表で比べられます。",
  "kw": "外壁 カバー工法 ガルバリウム 費用,外壁 カバー工法 見積,外壁 屋根 同時 リフォーム"},
 {"no": "11", "slug": "11", "tag": "外壁・浴室・内装 4か月で見積1.5倍", "title": "リフォームの見積が4か月で1.5倍になったとき",
  "h1a": "4か月で1.5倍は、", "h1b": "どの行が上がったか。", "sub": "前の見積と今の見積を、同じ行で横に並べる",
  "rows": [("材料", "メーカーの値上げ分。品番が同じか", False), ("工事費", "職人の手間の単価が変わったか", False), ("外注の上乗せ", "窓口の会社が各職人に出す手数料", True), ("増えた行", "前回なかった工事が入っていないか", False)],
  "situation": "不動産会社の紹介のリフォーム会社で、外壁塗装・浴室と洗面台の交換・和室の洋室化・全室クロス替え。4か月前の見積より1.5倍ほど高くなった。",
  "askl": "業者に聞く1行:", "ask": "「前回と同じ行で、どこがいくら上がったか教えてください。」",
  "ref": "1社でまとめる窓口の会社は、各職人への外注に手数料を乗せます。外壁・浴室・内装を専門店に分けると、下がることがあります。",
  "kw": "リフォーム 見積 値上がり,リフォーム 一括 外注 手数料,見積 比較 方法"},
]

E = html.escape


def card_css():
    return """*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1080px;background:#fff;color:#111;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans CJK JP','Noto Sans JP',sans-serif;overflow:hidden}
.w{position:absolute;inset:0;padding:56px 64px 48px;display:flex;flex-direction:column}
.mono{font-family:'JetBrains Mono','SF Mono',Menlo,'DejaVu Sans Mono',monospace;letter-spacing:.04em}
.top{display:flex;justify-content:space-between;font-size:17px;color:#555;border-bottom:1.5px solid #111;padding-bottom:15px}
h1{font-size:62px;line-height:1.24;font-weight:900;margin-top:38px;letter-spacing:-.01em}h1 em{font-style:normal;color:#d0021b}
.sub{font-size:21px;color:#444;margin-top:16px}.rows{margin-top:30px}
.r{display:grid;grid-template-columns:270px 1fr;gap:22px;padding:15px 0;border-top:1px solid #ddd;font-size:22px;line-height:1.45;align-items:baseline}.r:last-child{border-bottom:1px solid #ddd}
.r b{font-weight:700}.r.hot b,.r.hot span{color:#d0021b}
.rb{display:grid;grid-template-columns:330px 1fr 150px;gap:18px;padding:16px 0;border-top:1px solid #ddd;font-size:22px;align-items:center}.rb:last-child{border-bottom:1px solid #ddd}
.bar{height:24px;background:#111}.rb.hot .bar{background:#d0021b}.rb.hot b,.rb.hot .n{color:#d0021b}
.n{text-align:right;font-size:21px}.n small{display:block;font-size:16px;color:#777}.rb.hot .n small{color:#d0021b}
.ask{margin-top:30px;border-left:8px solid #d0021b;padding:6px 0 6px 22px}.ask .l{font-size:16px;color:#555}.ask p{font-size:29px;font-weight:700;line-height:1.45;margin-top:6px}
.ref{font-size:17px;color:#555;margin-top:20px;line-height:1.65}
.ft{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;border-top:1.5px solid #111;padding-top:16px}.ft b{font-size:25px}.ft span{font-size:16px;color:#333;text-align:right;line-height:1.5}"""


def card_html(c):
    if c.get("bars"):
        sub_total = sum(v for _, v, _ in c["bars"])
        mx = max(v for _, v, _ in c["bars"])
        rows = "".join(
            f"<div class='rb{' hot' if h else ''}'><b>{E(k)}</b><div><div class=bar style='width:{v/mx*100:.1f}%'></div></div>"
            f"<span class='n mono'>{v:,}<small>{v/sub_total*100:.1f}%</small></span></div>" for k, v, h in c["bars"])
    else:
        rows = "".join(f"<div class='r{' hot' if h else ''}'><b>{E(k)}</b><span>{E(v)}</span></div>" for k, v, h in c["rows"])
    return f"""<!doctype html><html lang=ja><head><meta charset=utf-8><style>{card_css()}</style></head><body><div class=w>
<div class='top mono'><span>見積書の解剖 {c['no']}</span><span>{E(c['tag'])}</span></div>
<h1>{E(c['h1a'])}<br><em>{E(c['h1b'])}</em></h1><div class=sub>{E(c['sub'])}</div><div class=rows>{rows}</div>
<div class=ask><div class=l>{E(c['askl'])}</div><p>{E(c['ask'])}</p></div>
<div class=ref>{E(c['ref'])}</div>
<div class=ft><b>SNSで聞く前に、行で読む。</b><span class=mono>見積もり達人(EHN) 無料・匿名<br>shield.the-horizons-innovation.com</span></div>
</div></body></html>"""


PAGE_CSS = """:root{--ink:#111;--mut:#555;--rule:#111;--soft:#d6d6d6;--acc:#D7261E;--bg:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif;line-height:1.8;-webkit-font-smoothing:antialiased}
.w{max-width:760px;margin:0 auto;padding:28px 16px 48px}.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace}
.top{display:flex;justify-content:space-between;gap:12px;font-size:12px;letter-spacing:.08em;border-bottom:2px solid var(--rule);padding-bottom:10px}.top a{color:var(--ink);text-decoration:none}
h1{font-size:clamp(26px,6vw,40px);line-height:1.3;margin:28px 0 14px;font-weight:900}
.k{font-size:12px;letter-spacing:.12em;color:var(--acc)}
.img{display:block;width:100%;height:auto;border:1px solid var(--soft);margin:18px 0}
h2{font-size:19px;margin:28px 0 8px;font-weight:900;border-top:1px solid var(--rule);padding-top:14px}
p{margin:0 0 10px;font-size:16px}
table{width:100%;border-collapse:collapse;font-size:15.5px}td{border-bottom:1px solid var(--soft);padding:10px 6px;vertical-align:top}td:first-child{font-weight:700;width:36%}tr.hot td{color:var(--acc)}
.ask{border-left:6px solid var(--acc);padding:4px 0 4px 16px;font-size:19px;font-weight:900;margin:8px 0}
.cta{margin-top:30px;border:2px solid var(--rule);padding:20px}.cta b{display:block;font-size:21px;line-height:1.4;margin:6px 0 10px}
.btn{display:block;text-align:center;background:var(--ink);color:#fff;text-decoration:none;padding:15px;font-size:16px}.btn:hover{background:var(--acc)}
ul.list{list-style:none;padding:0;margin:20px 0 0;border-top:1px solid var(--rule)}ul.list li{border-bottom:1px solid var(--soft)}
ul.list a{display:flex;gap:14px;padding:14px 2px;color:var(--ink);text-decoration:none}ul.list a:hover{color:var(--acc)}ul.list .n{color:var(--acc);font-size:13px;padding-top:3px;flex:0 0 auto}
.nav{display:flex;justify-content:space-between;gap:10px;margin-top:22px;font-size:14px}.nav a{color:var(--ink)}
.foot{margin-top:36px;padding-top:12px;border-top:1px solid var(--rule);font-size:12px;color:var(--mut)}.foot a{color:var(--mut)}"""

FOOT = ('<div class="foot">HORIZON SHIELD(運営 The HORIZ音s株式会社)は、施工業者から紹介手数料や送客の報酬を受け取らない第三者です。'
        '事例はSNSで公開された金額と工事内容だけを使い、投稿者・業者を特定する情報は載せていません。監修 '
        '<a href="https://orcid.org/0009-0000-9180-903X">大賀俊勝</a>(建設実務30年)。</div>')


def ld_json(obj):
    return json.dumps(obj, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def case_page(c, i):
    url = f"{BASE}/hacker/kaibou/{c['slug']}/"
    img = f"{BASE}/hacker/kaibou/img/{c['slug']}.png"
    desc = f"{c['situation']} {c['h1a']}{c['h1b']} 業者に聞く1行:{c['ask']}"
    if c.get("bars"):
        tot = sum(v for _, v, _ in c["bars"])
        trs = "".join(f"<tr class='{'hot' if h else ''}'><td>{E(k)}</td><td class=mono>{v:,}円({v/tot*100:.1f}%)</td></tr>" for k, v, h in c["bars"])
    else:
        trs = "".join(f"<tr class='{'hot' if h else ''}'><td>{E(k)}</td><td>{E(v)}</td></tr>" for k, v, h in c["rows"])
    prev_c = CASES[i - 1] if i > 0 else None
    next_c = CASES[i + 1] if i + 1 < len(CASES) else None
    nav = '<div class="nav">' + (f'<a href="../{prev_c["slug"]}/">← {prev_c["no"]}</a>' if prev_c else '<span></span>') + \
          '<a href="../">解剖の一覧</a>' + (f'<a href="../{next_c["slug"]}/">{next_c["no"]} →</a>' if next_c else '<span></span>') + '</div>'
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": c["title"], "description": desc[:300],
          "image": img, "datePublished": DATE, "inLanguage": "ja", "url": url,
          "author": {"@type": "Person", "name": "大賀俊勝", "sameAs": "https://orcid.org/0009-0000-9180-903X"},
          "publisher": {"@type": "Organization", "name": "HORIZON SHIELD"}, "keywords": c["kw"]}
    return f"""<!doctype html>
{MARK}
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(c['title'])} | 見積書の解剖 {c['no']} | 見積もり達人</title>
<meta name="description" content="{E(desc[:160])}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article"><meta property="og:title" content="{E(c['h1a'] + c['h1b'])}">
<meta property="og:description" content="{E(c['title'])}。業者に聞く1行と、相場の目安。"><meta property="og:url" content="{url}">
<meta property="og:image" content="{img}"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ld_json(ld)}</script>
<style>{PAGE_CSS}</style></head><body><div class="w">
<div class="top mono"><a href="/hacker/kaibou/">見積書の解剖 {c['no']}</a><a href="/hacker/">見積もり達人</a></div>
<h1>{E(c['title'])}</h1>
<div class="k mono">{E(c['tag'])}</div>
<img class="img" src="/hacker/kaibou/img/{c['slug']}.png" width="1080" height="1080" alt="{E(c['h1a'] + c['h1b'])}" loading="eager">
<h2>何があったか</h2><p>{E(c['situation'])}</p>
<h2>{E(c['h1a'] + c['h1b'])}</h2><p>{E(c['sub'])}</p><table>{trs}</table>
<h2>業者に聞く1行</h2><div class="ask">{E(c['ask'])}</div><p>{E(c['ref'])}</p>
<div class="cta"><div class="k mono">あなたの見積書も</div><b>総額で怒る前に、行で読む。</b>
<p>見積書を匿名で置けば、業者名と個人情報を伏せたまま、項目ごとに無料で解剖します。ログインは要りません。</p>
<a class="btn" href="{CTA}">見積書を匿名で解剖する(無料)</a></div>
{nav}
{FOOT}
</div></body></html>
"""


def index_page():
    url = f"{BASE}/hacker/kaibou/"
    items = "".join(f'<li><a href="{c["slug"]}/"><span class="n mono">{c["no"]}</span><span><b>{E(c["h1a"] + c["h1b"])}</b><br>'
                    f'<span style="color:#555;font-size:14px">{E(c["tag"])}</span></span></a></li>' for c in CASES)
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "見積書の解剖", "url": url, "inLanguage": "ja",
          "hasPart": [{"@type": "Article", "headline": c["title"], "url": f"{url}{c['slug']}/"} for c in CASES]}
    return f"""<!doctype html>
{MARK}
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>見積書の解剖 | SNSで「高い？」と聞かれた見積を、行で読む | 見積もり達人</title>
<meta name="description" content="SNSに貼られ「これ高いですか？」と聞かれた修理・リフォームの見積書を、建設30年の目で行ごとに読み解く連載。足場代、号数、一式、今契約なら半額。総額でなく、どの行を業者に聞けばよいかを示します。">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:title" content="見積書の解剖">
<meta property="og:description" content="SNSで「高い？」と聞かれた見積を、行で読む。"><meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}/hacker/kaibou/img/01.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{ld_json(ld)}</script>
<style>{PAGE_CSS}</style></head><body><div class="w">
<div class="top mono"><a href="/hacker/">見積もり達人 ／ 見積書の解剖</a><a href="/">HORIZON SHIELD</a></div>
<h1>見積書の解剖</h1>
<p>SNSに見積書を貼って「これ高いですか？」と聞く投稿が、毎日流れてきます。答える人はその家を見ていません。ここでは、そうして公開された見積の金額と工事内容から、<b>どの行を業者に聞けば答えが出るか</b>を1件ずつ示します。</p>
<ul class="list">{items}</ul>
<div class="cta"><div class="k mono">あなたの見積書も</div><b>総額で怒る前に、行で読む。</b>
<p>見積書を匿名で置けば、業者名と個人情報を伏せたまま、項目ごとに無料で解剖します。</p>
<a class="btn" href="{CTA}">見積書を匿名で解剖する(無料)</a></div>
{FOOT}
</div></body></html>
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if MARK not in f.read():
                raise SystemExit(f"refuse to overwrite hand-written file: {path}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def build(out, img_html=None):
    root = os.path.join(out, "hacker", "kaibou")
    write(os.path.join(root, "index.html"), index_page())
    for i, c in enumerate(CASES):
        write(os.path.join(root, c["slug"], "index.html"), case_page(c, i))
        if img_html:
            os.makedirs(img_html, exist_ok=True)
            with open(os.path.join(img_html, f"{c['slug']}.html"), "w", encoding="utf-8") as f:
                f.write(card_html(c))
    return [f"{BASE}/hacker/kaibou/"] + [f"{BASE}/hacker/kaibou/{c['slug']}/" for c in CASES]


def selftest():
    import re, tempfile
    ok = 0
    d = tempfile.mkdtemp()
    urls = build(d, os.path.join(d, "img"))
    assert len(urls) == len(CASES) + 1; ok += 1
    assert len({c["slug"] for c in CASES}) == len(CASES); ok += 1
    for c in CASES:
        t = open(os.path.join(d, "hacker", "kaibou", c["slug"], "index.html"), encoding="utf-8").read()
        assert "from=kaibou" in t and MARK in t
        assert "</script>" not in t.split('application/ld+json">')[1].split("</script>")[0]
        assert not re.search(r"[—–―]", t), "dash found"
        assert "@" not in c["situation"]
    ok += 1
    # 01 の内訳は見積書と一致
    assert sum(v for _, v, _ in CASES[0]["bars"]) == 183000; ok += 1
    t = open(os.path.join(d, "hacker", "kaibou", "index.html"), encoding="utf-8").read()
    assert t.count('<li><a href=') == len(CASES); ok += 1
    p = os.path.join(d, "hacker", "kaibou", "index.html")
    open(p, "w").write("hand")
    try:
        build(d); raise AssertionError("overwrote")
    except SystemExit:
        ok += 1
    print(f"selftest ok {ok}/6")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=".")
    ap.add_argument("--img-html")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest(); sys.exit(0)
    for u in build(a.out, a.img_html):
        print(u)
