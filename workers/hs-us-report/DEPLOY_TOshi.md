# hs-us-report を本番に出す手順(TOshi の手でやる分)

hs-us-report は HORIZON SHIELD の米国の窓口です。受付、PayPal の入金、AI の読み取り、公的データの参照、英語の PDF、TOshi の確認、送付、30 日での削除まで、この 1 本でやります。日本の hs-pdf-gen には触っていません。

先に用語です。
- **KV**: Cloudflare の小さな記録の置き場。注文の状態を入れます。
- **R2**: Cloudflare のファイルの置き場。アップロードと PDF を入れます。
- **secret**: API の鍵など、見せてはいけない値。`wrangler secret put` で入れると、コードにも設定ファイルにも残りません。
- **service binding**: worker どうしの直通の線。hs-jccdb-obs の米国の値は、この線からしか取れません。

番人がここまでやったこと: コード、試験(engine / units / flow の 3 本、全部通過)、`wrangler deploy --dry-run` での組み立て確認、ローカルの実行時での動作確認、別の検証役による審査と直し。
番人ができないこと: 下の 1〜6 と 8(deploy と secret は TOshi の手だけ)。

## 1. 置き場に移す

```
cd ~/horizon-shield/workers/hs-us-report
npm install
npm test
```
`npm install` は必要な部品(@cloudflare/puppeteer と wrangler)を入れます。`npm test` は 3 本の試験を流します。最後の行が `flow ok US-...` なら合格です。

## 2. KV と R2 を作る(一度だけ)

```
npx wrangler kv namespace create US_ORDERS
```
出てくる `id = "xxxxxxxx"` の値を、`wrangler.jsonc` の `"id": "REPLACE_WITH_KV_ID"` のところに書きます。

```
npx wrangler r2 bucket create hs-us-files
npx wrangler r2 bucket lifecycle add hs-us-files --prefix uploads/ --expire-days 30
npx wrangler r2 bucket lifecycle add hs-us-files --prefix reports/ --expire-days 366
```
lifecycle は R2 側の自動削除です。worker の巡回が止まっても、アップロードは 30 日、報告は 1 年で消えます(プライバシーポリシーの約束の控え)。

## 3. PayPal 側で要ること(金額の登録は要らない)

日本の ¥5,500 のような「支払いリンク」を PayPal で作る必要はありません。米国版は、注文ごとに worker が金額(\$39 か \$119)と注文番号を入れた PayPal の支払い画面の URL を作ります。入金の通知(IPN)が来たら、受け取り口座・通貨・金額を注文と照合し、合うときだけ「入金」にします。金額が PayPal 側に登録されていなくても、この照合があるので改ざんはできません。

PayPal の管理画面で確かめるのは 2 点です。
- **米ドルを受け取れること**: 「支払いの受け取り設定」で、持っていない通貨の支払いをブロックしない(受け取って換算する)になっていること。ブロックだと入金が「保留」になり、通知が来ません。
- **税や送料の上乗せが無いこと**: 上乗せがあると金額が合わず、処理しません(LINE に「合わない」と通知が来ます)。

## 4. secret を入れる(7 つ)

```
cd ~/horizon-shield/workers/hs-us-report
npx wrangler secret put PAYPAL_BUSINESS
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put LINE_CHANNEL_TOKEN
npx wrangler secret put LINE_USER_ID
npx wrangler secret put LINK_SECRET
npx wrangler secret put US_ADMIN_TOKEN
```
それぞれ、実行すると値を聞かれるので貼り付けて Enter です。
- PAYPAL_BUSINESS は、PayPal の **マーチャント ID**(13 文字。PayPal の アカウント設定 → 事業情報 の「PayPal マーチャント ID」)。主のメールアドレスでも通りますが、ID のほうがメールが支払い画面に出ないので ID を使います。公開の repo に載せないために secret にしてあります。
- ANTHROPIC_API_KEY、LINE_CHANNEL_TOKEN、LINE_USER_ID は hs-pdf-gen と同じ値で構いません(鍵の置き場は hs-secrets の記録のとおり)。
- RESEND_API_KEY は **この worker 用に新しく作ります**。今の 5 worker に入っている 2026-09-06 の鍵は、Cloudflare からも Resend からも値を読み出せず、手元の写しも残っていません(put 後に temp を消す手順だったため)。Resend → API Keys → Create API Key、名前 `hs-us-report`、Permission は Sending access、Domain は the-horizons-innovation.com。鍵は足し算なので、他の worker の鍵は無傷です。
- LINK_SECRET と US_ADMIN_TOKEN は新しく作ります。`openssl rand -hex 32` で出た 64 文字を使い、鍵マネージャに控えてください。LINK_SECRET は お客様のダウンロードの署名、US_ADMIN_TOKEN は管理の口の鍵です。

## 5. deploy

```
npx wrangler deploy --dry-run --outdir dist
npx wrangler deploy
```
1 行目は組み立てだけして本番に出しません(エラーが無いことの確認)。2 行目で本番に出ます。出た URL が `https://hs-us-report.oga-surf-project.workers.dev` であることを確かめてください。違っていたら `wrangler.jsonc` の PUBLIC_WORKER_URL を直して、もう一度 deploy します。

確認:
```
curl -s https://hs-us-report.oga-surf-project.workers.dev/health
```
`"secrets"` の 6 項目(line は LINE の 2 つをまとめて 1 項目)が全部 `true` なら準備完了です。

## 6. 本物で 1 回試す

1. サイトの /us/ で、自分のメールアドレスで Quote Check を注文し、PayPal で $39 払う(あとで PayPal から自分に返金できます)。
2. LINE に「入金」の通知が来て、1 分以内に「下書きができた」と確認のリンクが来ます。
3. リンクを開く → 「下書きを開く」で 3 つの書類を見る → 「この内容でお客様に送る」。
4. 自分のメールに 3 つのリンクが届き、PDF が開くことを確かめる。
5. 管理の口で状態を見る:
```
curl -s -H "authorization: Bearer <US_ADMIN_TOKEN>" https://hs-us-report.oga-surf-project.workers.dev/admin/orders
```

## 7. 下書きを直したいとき(管理の口)

AI の読み取りが違っていたら、読み取り結果(extraction)を直して作り直せます。
```
curl -s -H "authorization: Bearer <US_ADMIN_TOKEN>" https://hs-us-report.oga-surf-project.workers.dev/admin/orders/US-XXXXXXXX-XXXXXX > order.json
```
`order.json` の `extracted` を直した JSON を `ex.json` に用意して、
```
curl -s -X PUT -H "authorization: Bearer <US_ADMIN_TOKEN>" -H "content-type: application/json" --data @ex.json https://hs-us-report.oga-surf-project.workers.dev/admin/orders/US-XXXXXXXX-XXXXXX/extraction
curl -s -X POST -H "authorization: Bearer <US_ADMIN_TOKEN>" https://hs-us-report.oga-surf-project.workers.dev/admin/orders/US-XXXXXXXX-XXXXXX/draft
```
作り直すと指紋が変わり、新しい確認のリンクが LINE に来ます。返金したら `/refunded` に POST して状態を記録します。

## 7b. ヒアリング(2026-09-27 に追加)

日本のヒアリングに当たる物を 3 段で入れてあります。
- **受付欄の質問**: 工種を選ぶと、その工種の質問(屋根なら 面積・勾配・層数・人工 など)と共通の質問(建物・築年・市域の内外・保険請求・業者との出会い方・見積りの数・手付金・圧力の有無)が出ます。答えは注文に `hearing.answers` として残り、参照(面積から床、人工から時給の幅、市域で許可の規則)と「Before you sign」の注意(FTC の 3 日クーリングオフ、テキサスの免責額の肩代わり禁止、州の手付金の上限、EPA の鉛規則など。全部に出典)に使われます。
- **聞き返し**: AI が見積りを読んだあと、お客様しか埋められない穴(面積が無い、人工が無い、許可の行があるのに市域の内外が不明)があれば、**2〜3 問だけ**のメールを送り、署名つきの `/answer/<注文番号>` のリンクで答えてもらいます。返事が来れば即、来なければ **8 時間**待って、見積りに書いてある物だけで下書きを作ります(納期 1 営業日の約束は守れます)。聞き返しの間、状態は `awaiting_answers`、LINE に「聞き返し中」が来ます。
- **管理の口**: `PUT /admin/orders/<id>/hearing` に `{"answers":{"inside_city":"yes"}}` の形で答えを足せます(電話で聞いた場合など)。`POST /admin/orders/<id>/draft` は穴があれば先に聞き返し、`/draft?ask=0` なら聞かずに今の情報で作ります。

質問の定義は `src/hearing.js` の 1 か所だけです。変えたら `node tools/build_hearing_json.mjs ../../us/index.html` でページに書き込み(`npm test` がページとの一致を確かめます)、ページも push します。

## 8. サイト側

/us/ のページの送信欄は、この worker の URL(PUBLIC_WORKER_URL)に送ります。worker が動く前にページを公開すると、送信欄は「まだ受け付けていない」を返します。順番は worker → ページです。

## 起きうること

- **LINE に「下書きに失敗」**: AI が読めなかったか、公的データが取れなかった。3 回まで 10 分おきに作り直します。それでも駄目なら 7 で直すか、お客様に返金します(納期は Quote Check が 1 営業日)。
- **LINE に「入金が注文と合わない」**: 金額か通貨が違う。PayPal の画面で確かめて返金します。
- **LINE に「二重払いの疑い」**: 同じ注文に 2 回払われた。PayPal で 2 回目を返金します。
- **LINE に「納期が近い」**: 入金から 20 時間たっても送れていない。確認のリンクを開いて送るか、返金します。
