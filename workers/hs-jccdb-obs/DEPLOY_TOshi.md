# hs-jccdb-obs v0.4.3(2026-09-27 午後、v0.4.2 の上に足すだけ。計算の式は変えない)

- きっかけ: US_KAKE_AUDIT_20260927.md の違い 1(米国の chain は元請の材料上乗せで止まり、施主が払う施工込みの段が無い)。TOshi の国内の掛け率(相場 ÷ 原価)の米国版。
- jccdb_us_price_chain が trade_installed(schema/0006_installed.sql)を hs10 で結び(結び表 trade_installed_hs)、州 DOT(NJDOT 2023、USCCDB の bid_item 層)の
  材料そのものに近い入札項目 38 本(鉄筋 2、H 形鋼の杭 1、銅線 13、PVC 管・電線管 4、鋼製電線管 9、ダクタイル鋳鉄管 9)を HS 13 本に対応させ、重さで単位をそろえた
  施工込みの入札単価 ÷ 材料の陸揚げ原価(installed_over_landed)を、対応がある品目の行の installed に出す。品目ごとの代表値(州全体の 12 か月の加重平均。
  無い品目は地区 N/C/S の金額 ÷ 数量の合算)、地区の幅、PPI(材料ごとの BLS 系列)で入札を陸揚げの時点に寄せた粗い推計、換算の根拠と確度(high/medium/low)、入札の件数(2 以下は low_sample)。
  桁を見る物で、国内の閾値(1.2〜6、3 以上)は持ち込まない。definitions.installed_over_landed を「出す」に直した。
- /health と jccdb_coverage の us_private_layer に chain_ext と installed の件数(kake_meta の built_chain_ext・built_installed)を出す(v0.4.2 では coverage だけだった)。
- 0006 は 0004・0005 の表に触らない。0006 を流していない D1 でも v0.4.3 は installed_loaded:false で v0.4.2 と同じ答えを返す(落ちない)。
- 表の元は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/build_installed_ratio.py(公開の観測層の bid_item_njdot_2023q2.csv と index_bls_ppi.csv、非公開の chain から)。
  対応表と重さの換算は同じファイルの MAP(銅線は AWG の直径 × 銅の密度、PVC とダクタイル鋳鉄は外径と肉厚の幾何、RMC は ANSI C80.1 の呼びの重さ、鉄筋と H 形鋼は名目)。
- 手順は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/toshi_steps_kake4.sh の段 P1〜P5。芯だけ:
       python3 build_installed_ratio.py --obs ~/horizon-shield/data/jccdb-obs-v2/observations/us --ym 202607   (ops-private で)
       python3 tools/make_d1_sql_installed.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 --obs ~/horizon-shield/data/jccdb-obs-v2/observations/us --ym 202607 --out sql_us_installed
       PROD_SQL=0 node test/harness.mjs   (番人の作業場: 299 pass / 0 fail)
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=schema/0006_installed.sql
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=sql_us_installed/001.sql
       npx wrangler deploy
- 本番の確認は /health(version 0.4.3、us_private_layer.installed_loaded true、rows.trade_installed 219)と、hs-mcp の get_us_price_chain hs=7214200000 の rows[0].installed。
- 戻し方: `npx wrangler rollback`(v0.4.2 は trade_installed を読まないので、表が残っていても無害)。表を捨てるなら 0006 の DROP 文だけ。

---

# hs-jccdb-obs v0.4.2(2026-09-27、v0.4.1 の上に足すだけ。計算の式は変えない)

- きっかけ: 2026-09-27 の検証(~/hs-core-private/ops-private/jccdb_us_kake_20260926/US_KAKE_AUDIT_20260927.md)。式に誤りは無かったが、
  陸揚げ原価に MPF・HMF が無い、関税が年初来の平均だけ、商社(輸入商社)の段が無い、「掛け率」の語が 3 つの違う量に使われている、の 4 点を直す。
- jccdb_us_price_chain が足し表 trade_chain_ext(schema/0005_chain_ext.sql)を hs10 で結び、各行に landed.fees_upper(MPF 0.3464%、HMF 0.125% の上限、法定の率と出典)、
  landed.latest_month(直近月の陸揚げ・実効関税率)、wholesale.two_tier_upper(卸 2 段の上限)、cost_share(原価率 3 つ)、cross_check_bea2007.nearest を足す。
  返答に definitions(契約の掛け率 = 価格 ÷ 定価、chain の cost_share = 原価 ÷ 売値、国内の掛け率 = 相場 ÷ 原価、施工込み ÷ 陸揚げは未提供)を付ける。
- 0005 は 0004 の表に触らない(trade_chain はそのまま)。0005 を流していない D1 でも v0.4.2 は ext_loaded:false で v0.4.1 と同じ答えを返す(落ちない)。
- 足し表の元は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/build_chain_ext.py(chain と derived の imports から。MPF の率と上下限は Federal Register 2025-07-23 CBP Dec. 25-10、HMF は 26 U.S.C. 4461)。
- 手順は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/toshi_steps_kake3.sh の段 N1〜N5。芯だけ:
       python3 build_chain_ext.py 202607 --imports ~/horizon-shield/data/jccdb-obs-v2/raw/us/kake_20260926/derived   (ops-private で)
       python3 tools/make_d1_sql_chain_ext.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 --ym 202607 --out sql_us_chain_ext
       PROD_SQL=0 node test/harness.mjs   (番人の作業場: 283 pass / 0 fail)
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=schema/0005_chain_ext.sql
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=sql_us_chain_ext/001.sql
       npx wrangler deploy
- 戻し方: `npx wrangler rollback`(v0.4.1 は trade_chain_ext を読まないので、表が残っていても無害)。表を捨てるなら 0005 の DROP 文だけ。

---

# hs-jccdb-obs v0.4.1(2026-09-26 夜、v0.4 の上に足すだけ)

- jccdb_us_margin に margin_index(BLS の卸・小売のマージン物価指数、月ごと。最新月・前年同月比・3 か月前比)を足した。粗利率そのものではなく、粗利の単価の値動き。
- jccdb_us_price_chain に materials_price_index(BLS の建設資材の特殊指数 WPUSI012011)と、元請の段の by_agency / range を足した。材料の上乗せ率は原本で読んだ 3 州(Caltrans 15%、FDOT 17.5%、TxDOT 25%)。既定の元請の値は Caltrans のまま。
- schema/0004_kake_us.sql に margin_ppi の表と、markup_dot の原本の sha256 と頁の列を足した。v0.4.0 の worker は新しい表と列を読まないので、先に D1 を流し直しても答えは変わらない。v0.4.1 の worker は margin_ppi が無い D1 でも指数を null で返し、落ちない。
- 手順は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/toshi_steps_kake2.sh の段 L1〜L5。

---

# hs-jccdb-obs v0.4 配備手順(TOshi の手、2026-09-26 夜)

v0.4 で変わること: 米国の値は hs-mcp の service binding(host が jccdb-obs.internal)からの呼び出しにだけ返す。公開の URL で米国の値を求めると 403 us_private(値なし、hs-mcp の道具の名前つき)。
日本の値、米国の出典台帳(/sources)、件数(/coverage、/search)は公開のまま。新しい4本(掛け率・粗利率・輸入原価・各段の価格)は DB_US の新しい表(schema/0004_kake_us.sql)から引く。
手順は ~/hs-core-private/ops-private/jccdb_us_kake_20260926/toshi_steps_kake2.sh(段 K1〜K6)にまとめた。芯だけ書く:

1. SQL を作る(入力は非公開。出力 sql_us_kake/ は .gitignore 済み)
       python3 tools/make_d1_sql_kake.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 --imports ~/horizon-shield/data/jccdb-obs-v2/raw/us/kake_20260926/derived --ym 202607 --out sql_us_kake
2. 手元で検査: `PROD_SQL=0 node test/harness.mjs`(番人の作業場: 264 pass / 0 fail、本番の sql_jp / sql_us 込みで 293 pass / 0 fail)
3. DB_US に流す(obs2 には触らない。流し直しは 0004 から)
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=schema/0004_kake_us.sql
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=sql_us_kake/001.sql
       npx wrangler d1 execute hs-jccdb-obs-us --remote --file=sql_us_kake/002.sql
4. `npx wrangler deploy` のあと、公開の URL で /us/chain?hs=2523 が 403、/health の us_private_layer.loaded が true。
5. hs-mcp に patcher v3(ops/jccdb_upgrade_20260926/patch_hs_mcp_kake_v3.py)を当てて deploy。get_us_price_chain などが値を返す。
6. 戻し方: `npx wrangler rollback`(v0.3 に戻ると公開の URL で米国の値がまた出る)。hs-mcp は src/mcp.js.bak.<時刻>-kakev3 を戻して deploy。
   表を捨てるなら 0004 の DROP 文だけを流す(obs2 は無関係)。

---

# hs-jccdb-obs v0.3 配備手順(TOshi の手)

番人は deploy も secret も push も触らない。以下は TOshi が順に打つ。secret は要らない(読み取り専用、鍵なし)。
順番の芯: **D1 を2つにする(DB_US を作る)→ 両方に 0003 と SQL を流す → hs-jccdb-obs v0.3 を deploy → hs-mcp に patcher v2 → hs-mcp を deploy**。

## 0. 先に決めること(プランと大きさ)

2026-09-26 の観測層 v2(公開の組み立てに入る 日本 331,946 行 + 米国 2,853,445 行)で、番人が SQL を SQLite のファイルに流して測った値:

| | DB(日本、v0.1 と同じ D1) | DB_US(米国、新しく作る) |
|---|---:|---:|
| 流す SQL | sql_jp/ 5 ファイル 209 MB | sql_us/ 27 ファイル + fts_001.sql、1,329 MB |
| D1 の大きさ(観測層の部分) | 242 MB | 1,583 MB |
| うち obs2 の表 / 索引 4 本 / notes / FTS5 | 184 / 38 / 18 / なし | 1,098 / 330 / 65 / 50 |
| DB 全体(日本は v0.1 の items / obs を含む) | 275 MB | 1,583 MB |
| 流し込み(SQLite、手元) | 4 秒 | 31 秒 |

- v0.2 の1つの D1(全部で 4 GB 近く)から、2 つで合計 約 1.9 GB になった。
- **Workers Paid が前提**。DB_US の 1.6 GB は Free の 1 DB 500 MB を超える。Paid の上限は 1 DB 10 GB、保存は合計 5 GB まで込み(超えた分は従量)。
- 書き込みの行数(D1 は索引の書き込みも数える、見積り): 日本 約 180 万、米国 約 1,500 万 + FTS5。Paid の月 5,000 万行の込みの範囲に入る見込み。入れ直しは月に何度もしないこと。
- 契約中のプランと上限は Cloudflare のダッシュボードで確かめること(番人は確かめられない)。
- DB(日本)は Free の 500 MB にも収まる大きさ。米国だけ Paid が要る。

## 1. アカウント確認(取り違え防止)
    cd ~/horizon-shield/workers/hs-jccdb-obs
    npx wrangler whoami            # c15ff64a(oga.surf.project@gmail.com)であること

## 2. ファイルを置く
番人の作業場 /home/claude/work/hs-jccdb-obs-v03/ から、リポの workers/hs-jccdb-obs/ に:

    src/worker.js  schema/0003_obs3.sql  tools/make_d1_sql_v3.py  test/harness.mjs
    test/fixtures/make_fixtures.py  test/fixtures/obs2/(丸ごと入れ替え)  DEPLOY_TOshi.md  .gitignore  wrangler.jsonc
    (REPORT_M2.md は番人の作業場には無い。M2 の返答に付けた全文を、置くならこの名前で保存する)

schema/0001_init.sql と tools/make_d1_sql.py(v0.1)、schema/0002_obs2.sql と tools/make_d1_sql_v2.py(v0.2)は変えていない(v0.3 では 0002 は流さない)。
観測層 v2(/home/claude/work/obs2)はリポの data/jccdb-obs-v2/ に置く想定(下のコマンドはその場所で書いた)。

## 3. sql_jp / sql_us を作る(検査器が先に走る)
    python3 tools/make_d1_sql_v3.py ~/horizon-shield/data/jccdb-obs-v2 --country JP     # 約 75 秒 -> sql_jp/
    python3 tools/make_d1_sql_v3.py ~/horizon-shield/data/jccdb-obs-v2 --country US     # 約 2 分  -> sql_us/
- どちらも最初に観測層 v2 の検査器(tools/validate_obs.py、全 320 万行)を走らせ、誤りが 1 つでもあれば何も書かずに止まる(検査器は約 1.2 GB のメモリを使う)。
- 組み立ては行を読みながら書く(組み立て自体のメモリは米国で約 250 MB)。1 ファイルは 50 MB まで(`--max-mb 20` などで小さくできる。D1 の import が大きいファイルを受けないときに使う)。1 文は 90,000 bytes まで(D1 の上限 100,000 bytes)。
- 出来るもの: `001.sql ...`(米国は最後に `fts_001.sql`)と `MANIFEST.json`(built.obs2 が行の数、各ファイルの sha256、**apply_order が流す順**)。
- sql_jp/ と sql_us/ は .gitignore 済み(作り直せるので入れない)。
- observations_restricted/(表が複製・電子化を禁じている出典)は件数だけ coverage に入る。observations_hold/ は何も入れない(v0.2 と同じ)。

## 4. 手元で検査
    OBS2=~/horizon-shield/data/jccdb-obs-v2 node test/harness.mjs
- Node 22.5 以上(node:sqlite)。「N pass / 0 fail」であること。
- sql_jp/ と sql_us/ があると、一時ディレクトリのファイルの DB(約 2 GB。ディスクの空きを見ておく)に流して、全行の形(値は開いた状態だけ、帰属表示、辞書の表、台帳と同じ値を持たない、period_key、norm、computed)と、実データでの道具の答え(竹筒 36,900、奈良 大工 29,600、Davis-Bacon、許可、地域係数、FTS5 の整合)を確かめる。数分かかる。省くなら `PROD_SQL=0`。
- 番人の作業場での結果(最終): harness 242 pass / 0 fail(86 秒、ファイルの DB は日本 275 MB・米国 1,583 MB)、itest_v2 79 pass / 0 fail。詳細は M2 の返答の REPORT_M2。

## 5. D1 に入れる(DB が先、worker は後)

### 5a. DB_US を作る(初回だけ)
    npx wrangler d1 create hs-jccdb-obs-us
    # 出た database_id を wrangler.jsonc の <D1_US_ID> に貼る(DB の <D1_ID> は v0.1 のときに貼ったもの)

### 5b. DB(日本)
v0.1 の D1 がまだ無いときだけ、先に v0.1 の手順:

    npx wrangler d1 create hs-jccdb-obs          # 出た database_id を wrangler.jsonc の <D1_ID> に貼る
    npx wrangler d1 execute hs-jccdb-obs --remote --file=schema/0001_init.sql
    for f in sql/*.sql; do echo "$f"; npx wrangler d1 execute hs-jccdb-obs --remote --file="$f" || break; done

v0.3 の日本の分(v0.1 の表には触らない。v0.2 の 0002 と sql_v2 を流してあっても、0003 が消して作り直す):

    for f in $(python3 -c "import json;print(' '.join(json.load(open('sql_jp/MANIFEST.json'))['apply_order']))"); do
      echo "$f"; npx wrangler d1 execute hs-jccdb-obs --remote --file="$f" || break; done

### 5c. DB_US(米国)
    for f in $(python3 -c "import json;print(' '.join(json.load(open('sql_us/MANIFEST.json'))['apply_order']))"); do
      echo "$f"; npx wrangler d1 execute hs-jccdb-obs-us --remote --file="$f" || break; done

- 流す順は MANIFEST.json の apply_order のとおり: `schema/0003_obs3.sql` → `sql_us/001.sql` … `027.sql` → `sql_us/fts_001.sql`(FTS5 の索引)。
- **途中で止まったら、その DB は 0003 からやり直す**(0003 が表を消して作り直す。同じファイルを2度流すと rid の重複で止まるので、途中から続けない)。
- 入れている間、v0.3 の worker はその国の部分だけ `obs2_loading`(fetch_failed:true)と答える。もう片方の国は答える。0 件とは答えない。
- `fts_001.sql` が D1 で通らないとき(FTS5 が使えない等): そこで止めてよい。worker は米国の品目の検索を LIKE で答える(返答の search に like_fallback と出る。遅い)。番人に知らせる。

確かめ(数が MANIFEST.json の built.obs2 と同じ):

    npx wrangler d1 execute hs-jccdb-obs --remote --command "SELECT COUNT(*) AS n FROM obs2"
    npx wrangler d1 execute hs-jccdb-obs-us --remote --command "SELECT COUNT(*) AS n FROM obs2"
    npx wrangler d1 execute hs-jccdb-obs-us --remote --command "SELECT k FROM meta"     # built_v3 と built_v3_fts があること

## 6. hs-jccdb-obs v0.3 を deploy
    npx wrangler deploy
    curl -s https://hs-jccdb-obs.oga-surf-project.workers.dev/health | head -c 1500
    # ok:true、obs2_by_country が JP 331946 / US 2853445、obs2_complete:true、parts.US.fts:true、items 95403 / obs 4780
    curl -s "https://hs-jccdb-obs.oga-surf-project.workers.dev/obs?q=%E7%94%9F%E3%82%B3%E3%83%B3%E3%82%AF%E3%83%AA%E3%83%BC%E3%83%88&pref=nara&status=published_pdl&limit=3"
    curl -s "https://hs-jccdb-obs.oga-surf-project.workers.dev/us/wage?state=CA&county=Los%20Angeles&trade=carpenter&limit=2"
    curl -s "https://hs-jccdb-obs.oga-surf-project.workers.dev/us/permits?geo=Austin,%20TX&year=2024&limit=2"
    curl -s "https://hs-jccdb-obs.oga-surf-project.workers.dev/us/area-factor?geo=NC&limit=2"

- /health は行の数を MAX(rid) で数える(米国の COUNT(*) は 285 万行を読むため)。数え直すなら `/health?deep=1`。

## 7. hs-mcp に patcher v2 を当てる(hs-jccdb-obs v0.3 が先)
patcher v2 は v0.3 に合わせて直した(当てる前なので v2 のまま。11 本)。

    python3 ~/horizon-shield/ops/jccdb_upgrade_20260926/patch_hs_mcp_jccdb_obs_v2.py ~/horizon-shield/workers/hs-mcp --dry
    # 「dry: 状態 fresh -> 全部(11本 + 分岐 + 案内文 + binding)」(v1 を当てていない)か「dry: 状態 v1 -> 差分 ...」と出る
    python3 ~/horizon-shield/ops/jccdb_upgrade_20260926/patch_hs_mcp_jccdb_obs_v2.py ~/horizon-shield/workers/hs-mcp
    cd ~/horizon-shield/workers/hs-mcp && npx wrangler deploy

- 錨が各 1 回・node --check 緑(一時ディレクトリ)・読み込んで tools/list を比べて既存ツールが同じ、のときだけ書き、時刻つきの .bak を2つ残す。
- 足す 11 本: search_jccdb_items / get_jccdb_observations / get_jccdb_labor_rate / compare_jccdb_regions / get_jccdb_work_unit_price /
  get_jccdb_index_series / get_us_construction_prices(米国の全 layer と geo)/ get_jccdb_coverage / **get_us_prevailing_wage / get_us_permits / get_us_area_factor**。
- 当てる前に結合試験を打つなら(任意): patcher と同じ所の itest_v2.mjs を、MCP2=<手つかずの hs-mcp の写し> MCPCOPY=<v1 を当てた写し> JCCDB_OBS=<この worker> OBS2=<観測層 v2> で。
- hs-mcp の版(1.0.10)は変えていない。agent card の署名や版を上げるかは TOshi の判断。

確かめ:

    curl -s https://mcp.horizonshield.dev/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_us_prevailing_wage","arguments":{"state":"CA","trade":"carpenter","limit":2}}}' | head -c 800

## 8. git(個別 add。git add . は使わない)
    git add workers/hs-jccdb-obs/src/worker.js workers/hs-jccdb-obs/schema/0003_obs3.sql workers/hs-jccdb-obs/tools/make_d1_sql_v3.py \
            workers/hs-jccdb-obs/test/harness.mjs workers/hs-jccdb-obs/test/fixtures/make_fixtures.py workers/hs-jccdb-obs/test/fixtures/obs2 \
            workers/hs-jccdb-obs/DEPLOY_TOshi.md workers/hs-jccdb-obs/.gitignore workers/hs-jccdb-obs/wrangler.jsonc \
            workers/hs-mcp/src/mcp.js workers/hs-mcp/wrangler.jsonc \
            ops/jccdb_upgrade_20260926/patch_hs_mcp_jccdb_obs_v2.py ops/jccdb_upgrade_20260926/itest_v2.mjs
.bak は add しない。wrangler.jsonc の database_id は2つとも貼ってから add する。

## 9. 観測層 v2 が増えたとき
3(sql_jp / sql_us を作り直す)→ 4(検査)→ 5b と 5c(変わった国だけでよい。0003 から全部)。worker の deploy は要らない(コードを変えたときだけ)。
extra_enums で layer が増えても worker は受ける(データにある layer は通す)。MCP の inputSchema の enum は 11 個
(SCHEMA.md の 9 + house_price + cost_limit)なので、新しい layer を AI に選ばせたいときは worker.js と patcher の enum に足す(番人に頼む)。

## 10. 戻し方
- hs-jccdb-obs: `npx wrangler rollback`(前の版へ)。v0.1 の表(items / obs / sources)は 0003 で触っていないので v0.1 はそのまま動く。
  v0.2 の worker に戻すなら、DB に 0002 と sql_v2 を流し直す(0003 の表とは名前が同じ obs2 なので、両方は同時に持てない)。
- hs-mcp: src/mcp.js.bak.<時刻>-jccdbobs2 と wrangler.jsonc.bak.<時刻>-jccdbobs2 を戻して deploy。
- DB_US を捨てるなら `npx wrangler d1 delete hs-jccdb-obs-us`(v0.3 の worker は DB_US が無くても日本の分は答え、米国の分を fetch_failed と言う。wrangler.jsonc から binding を外してから deploy)。
