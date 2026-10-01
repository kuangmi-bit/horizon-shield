# トルネード v2(tornado-v2.0.0)

信用できない文章を、構造化された記録に変える場所の門です。検証可能性の密度が低い値を外へ振り落とし、原文までたどれる値だけを中心に残します。

| 層 | 何をするか | 性質 |
|---|---|---|
| L1 propose | 抽出器が値と根拠の文字列を出す(K 本) | 信用しない。書き込みの力なし |
| L2 ground | 値がその根拠から取れること、根拠が原文に丸ごとあること | 決定論 |
| L3 plausible | 型と範囲だけ。参照値は読まない | 決定論 |
| L4 decide | adopt / reject / escalate | 純関数 |

## v1 から直した穴(2026-10-01 に v1 の L2 を直接試して確かめた物)

1. 根拠が原文にあれば、値が別物でも通った(根拠は神奈川県、値は大阪府)。値と根拠をつないだ。
2. 金額は原文の全数字をつなげた列の一部なら通った(日付と電話番号から作った数)。数のかたまりごとに照合し、金額として書かれた数(円、¥、金、万、億)に限った。
3. 「80万円」の 800000 が落ちた。万、億、千、漢数字、大字を読む。
4. K 回の一致を見ていたのに、接地は 1 回目しか見ていなかった。K 回すべてを接地させる。
5. 入口に認証も回数制限も上限も無かった。Bearer(秘密は sha256 で比較)、rate limit バインディング、本文 32KB と原文 8,000 字。秘密が無ければ 503 で閉じる。
6. 監査ハッシュが 1 回目の抽出だけだった。正規化 JSON で K 回分、抽出器名、指示文の sha256、方針の版を入れる。

足したもの: 根拠の長さの上限(原文まるごとを根拠にさせない)、分類が 2 つ入る根拠は曖昧として却下、金額の競合(別の金額があり、選んだ物だけに合計の見出しが付いているのでなければ人に回す)、指示文の注入の兆し、個人情報の項目と原文は鍵付きハッシュ(HMAC)でしか記録に残さない。

## 守らないもの

- 投稿者本人が原文に書いた嘘。原文にある値は接地します。トルネードは「原文に無い値」を落とす門で、原文が本当かは判定しません。
- 同じ人の大量投稿。1 件ずつしか見ません。
- 誰が読めるか、会社ごとの分離、個人情報の保管と削除。これは門の外の層で守ります。

## 使い方

```js
import { runTornado, gateHandle } from "../../_shared/tornado/tornado.js";
const policy = { id: "x", version: "1", maxChars: 8000, fields: [
  { name: "amount", type: "amount_jpy", required: true, min: 1000, max: 2e9 },
  { name: "region", type: "enum", required: true, taxonomy: [{ canonical: "神奈川県", aliases: ["神奈川県", "神奈川"] }] },
  { name: "name", type: "text", required: true, maxLen: 20, pii: true },
] };
const r = await runTornado(raw, policy, extractors, { hmacKey });   // r.decision, r.reasons, r.agreed, r.decision_inputs_sha256
```

項目の型: amount_jpy、enum(taxonomy の別名、generic: true は総称)、text、phone、email、date。

## 試験

```sh
node test/redteam_tornado.mjs   # 敵の試験 85 本
node test/mutate.mjs            # 守りを 40 か所壊して、全部を試験が見つけるか
```

写しを置く worker(hs-apps-line の src/tornado.js)は、この file と同じバイトであることを各 worker の試験で確かめます。
