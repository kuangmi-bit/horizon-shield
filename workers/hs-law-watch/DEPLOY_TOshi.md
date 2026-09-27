# hs-law-watch(改正ウォッチャー)配備手順(TOshi の手)

番人は deploy も secret も触らない。

## 何が動くか
- 毎日 JST 09:07 と 18:07 に、sources.js の 43 か所を見に行く(2026-09-26 夕に米国の出典 7 か所と中部の特別調査を足した。harness 52/0)。
  - 訪問看護(20): 厚労省の通知一覧・介護保険最新情報・審議会・新着 RSS・パブコメ RSS・e-Gov 法令API・官報・法令等データベースの告示本文(第67号・第19号・第103号・第95号・第94号)
  - 建設(23): 近畿地整の翌月単価表、残り9機関の単価表の一覧頁、中部の特別調査(資材)、施工パッケージ標準単価、技術者単価、デフレーター、新営予算単価、FEMA、Census VIP、NJDOT、米国の BLS OEWS・QCEW、USACE CWCCIS・EP 1110-1-8、HUD TDC、FTA 資本費、Census BPS
  - 見張らないもの: WBDG の UFS(頁が JavaScript で描かれてリンクが取れない)、SAM.gov の Davis-Bacon(利用規約が自動取得を禁止)
- 2026-09-26(v0.2): 観測層 v2 の出典の系統(obs2_family)を建設の見張り先に付けた。新しい PDF のリンクが増えたら、その系統の parser(観測層 v2 の tools/parsers/)を当て直す合図。初回の実行は基準線を作るだけで、出来事は出ない(2回目から差分だけ)。したがって、観測層に取り込んだ月より新しい表が既に出ている場合(2026-09-26 時点で近畿地整の 2026年10月版を確認済み)は、見張りでは拾えない。近畿は翌月版の probe(kkr-zairyo-next)が初回から拾う。
- 前回から増えた/変わったものを D1 の events に積む。読み直し候補の JHNRD 項目と、人がやる手順(next_steps)を付ける。
- 告示に日付が書き込まれている変更(令和9年6月のベースアップ評価料・物価対応料の倍化など)は 60/30/7/0 日前に1回ずつ知らせる。
- JHNRD も JCCDB も書き換えない。読むのは番人、確定は二資料一致、push は TOshi。

## 0. アカウント確認
    cd ~/horizon-shield/workers/hs-law-watch
    npx wrangler whoami            # c15ff64a であること

## 1. D1
    npx wrangler d1 create hs-law-watch       # 出た database_id を wrangler.jsonc の <D1_ID> に貼る
    npx wrangler d1 execute hs-law-watch --remote --file=schema/0001_init.sql

## 2. 手元の検査
    node test/harness.mjs          # 52 pass / 0 fail
    node test/live_smoke.mjs       # 本物の頁(2026-09-26 取得)で一覧の parser が動くこと

## 3. deploy と最初の1回(基準線を取る。この1回目は変化を出さない)
    npx wrangler deploy
    npx wrangler secret put ADMIN_KEY          # 値は鍵マネージャで作る。admin は鍵が無いと 403
    curl -s -X POST https://hs-law-watch.oga-surf-project.workers.dev/admin/run -H "x-admin-key: <ADMIN_KEY>"
    curl -s https://hs-law-watch.oga-surf-project.workers.dev/sources   # 各先の http_status と ok を見る

## 4. 知らせ(任意。入れなければ D1 に積むだけ)
    npx wrangler secret put LINE_TOKEN         # 知らせ用 OA のチャネルアクセストークン
    npx wrangler secret put LINE_TO            # TOshi の userId
    npx wrangler secret put GITHUB_TOKEN       # jhnrd に Issue を立てる PAT(issues:write のみ)
    npx wrangler secret put GITHUB_REPO        # ogasurfproject-jpg/jhnrd
GitHub の jhnrd に law-change ラベルを先に作っておく。

## 5. 見る場所
- 開いている出来事: GET /events?status=open&domain=nursing
- 片付け: POST /admin/event {event_id, status: triaged|applied|dismissed, note}(X-Admin-Key)
- 先の予定: GET /schedule

## 分かっている限界(正直に)
- 検知は最大 12 時間遅れる。ただし告示・省令は公布から施行まで普通は数か月あるので、公布(官報・e-Gov の施行前改正)で拾えば施行日より前に直せる。
- 告示は e-Gov 法令API に無い。官報の目次の題名に当たる語で拾っている。題名に訪問看護の語が無い告示(大きな一括改正)は、厚労省の改定頁の一覧側で拾う。
- 法令等データベースは同じ URL で別の告示を返すことがある。そのときは『改正ではない』出来事(instrument)にして、基準線を壊さない。
- 近畿地整の翌月単価表は、ファイル名が YYYY_MMtanka.pdf の形のままならという前提。形が変わると 404 のまま拾えない(その時は sources.js を直す)。

## 6. 鏡(2026-09-27、v0.3): Cloudflare から取れない 3 頁
- 初回(09-27 09:07 JST)から USACE の 2 頁(CWCCIS、EP 1110-1-8。.mil は Cloudflare からの取得を弾く)と FTA の資本費データベース(transit.dot.gov)が 403。
  番人の container からも Mac の VM からも届かず、Anthropic の取得器は FTA には届き USACE には 403。相手の側の遮断で、UA を変えても直らない見立て。
- 直し: GitHub Actions(.github/workflows/law-watch-mirror.yml、日曜 21:23 UTC = 月曜 06:23 JST に週 1 回、手でも回せる)が
  workers/hs-law-watch/tools/mirror_fetch.py で 3 頁を取り、worker の parseLinks が読む <a> の原文だけ(link_filter に当たる物)を data/law-watch/mirror/<id>.json に書いて commit する。
  worker は直接の取得が失敗したときだけ、鏡が新しく(10 日以内)相手が 200 を返していれば、鏡の <a> を同じ parser に通す(鍵は直接と同じ = 直接が戻っても偽の出来事は出ない)。
  鏡が無い・古い・相手が 403 のときは今までどおり失敗(3 回で instrument。題名に鏡が使えなかった理由が付く)。/sources の last.url が鏡の URL なら鏡で読んだ回。
- GitHub の網も .mil に弾かれる可能性はある。Action の Step summary に「usace-cwccis: HTTP 403」と出たら、その頁は鏡でも取れない = 人が半年に 1 度見る(CWCCIS は 3 月末と 9 月末)。
- 手順(~/hs-core-private/ops-private/law_watch_mirror_20260927/toshi_steps_lawwatch.sh の W1〜W4)。芯だけ:
       node test/harness.mjs                      # 65 pass / 0 fail
       python3 tools/mirror_fetch.py --selftest   # selftest ok
       npx wrangler deploy                        # D1 は変えない
       (push のあと) GitHub の Actions で「law-watch mirror」を Run workflow。走ったら data/law-watch/mirror/ に 3 本の json

## 7. 鏡の結果(2026-09-27 15:00 JST): GitHub の網も 3 か所とも 403。鏡は手で入れる
- Action「law-watch mirror」#1(手で回した、2026-09-27 05:29 UTC)の Step summary: usace-cwccis HTTP 403、usace-ep1110 HTTP 403、fta-capital-cost HTTP 403(<a> 0 本)。
  bot は 403 の記録(status 403、anchors 空)を data/law-watch/mirror/ に commit した(c90a2d6e)。worker はこの鏡を使わない(status が 200 でない)。
  つまり Cloudflare も GitHub Actions も、Anthropic の container も Mac の VM も弾かれる。届くのは人の browser(TOshi の Chrome)だけ。
- 取れた道: 番人が TOshi の Chrome(Claude in Chrome)で 3 頁を開き、link_filter に当たる <a> の href・属性・中身を構造化して読み、
  mirror_fetch.py と同じ形の JSON に組み直した(evidence と組み方は ~/hs-core-private/ops-private/law_watch_mirror_20260927/manual_20260927/)。
  同日の読み: CWCCIS 6 本(最新は 31 March 2026、9 月の表はまだ)、EP 1110-1-8 168 本(2024 版のまま)、FTA 2 本(September 2024 のまま)。3 か所とも台帳から変わっていない。
- 入れ方: ~/hs-core-private/ops-private/law_watch_mirror_20260927/toshi_steps_mirror_manual.sh <日付> M1(pull、写し、検査、commit、push)-> cron の後に M2(/sources の last.url が鏡の URL、fail_streak 0)。
- 限界: 鏡は fetched_at から 10 日で古くなり、worker は使わなくなる(古い鏡で「変わっていない」と言わないため)。週 1 の Action は 403 のまま回り続けるが、200 の鏡を 403 で上書きはしない。
  だからこの 3 か所は「人が見たいときに Chrome で読ませて入れる」計器。半年ごと(CWCCIS は 3 月末・9 月末の表)、月次の IMDB 更新の日(6 日)に一緒に読むのが現実的。
  安い試し(未検証): mirror_fetch.py の UA を純粋な browser の文字列にして Accept-Language を足す。.mil の遮断は IP と TLS 指紋で見ている見立てなので、直る見込みは低い。
