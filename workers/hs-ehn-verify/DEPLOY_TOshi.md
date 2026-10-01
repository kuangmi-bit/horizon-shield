# hs-ehn-verify v2(トルネード v2)の配り方

2026-10-01 番人。恒久 dry-run のまま(/submit は呼ばない、KV にも書かない)。

## 何が変わるか

- L2 をトルネード v2 に(値と根拠をつなぐ、数のかたまりごと照合、万円を読む、K 回すべてを接地)。共通部品は workers/_shared/tornado/tornado.js。
- /verify-dryrun に認証(Authorization: Bearer、secret TORNADO_TOKEN)。secret が無ければ 503 で閉じる。/healthz は公開のまま。
- 本文 32KB、原文 8,000 字の上限。rate limit バインディング TORNADO_RL があれば回数も制限する(無くても認証で閉じている)。
- ログは判定・理由・ハッシュだけ(原文も値も出さない)。
- 旧版は src/verify.js.20261001-v1.bak。

## 手元の試験

```sh
cd ~/horizon-shield/workers && node _shared/tornado/test/redteam_tornado.mjs && node _shared/tornado/test/mutate.mjs && node hs-ehn-verify/test/harness_ehn.mjs
```

85 本、40 変異すべて検出、19 本が通れば配ってよい。

## 配る(TOshi の手)

1. 鍵を作って入れる。値は画面に出さず、手元の file に残す(四点: worker の secret、~/.hs_tornado_token、ops/keys_inventory.md、鍵マネージャ)。

```sh
cd ~/horizon-shield/workers/hs-ehn-verify && printf %s "$(openssl rand -hex 32)" > ~/.hs_tornado_token && chmod 600 ~/.hs_tornado_token && wc -c < ~/.hs_tornado_token && npx wrangler secret put TORNADO_TOKEN < ~/.hs_tornado_token
```

2. 配る。

```sh
cd ~/horizon-shield/workers/hs-ehn-verify && npx wrangler deploy
```

3. 確かめる。healthz が gate tornado-v2.0.0 を返し、鍵なしが 401、鍵ありが判定を返す。

```sh
curl -s https://hs-ehn-verify.oga-surf-project.workers.dev/healthz && echo && curl -s -o /dev/null -w "%{http_code}\n" -X POST https://hs-ehn-verify.oga-surf-project.workers.dev/verify-dryrun -H 'content-type: application/json' -d '{"raw":"x"}' && curl -s -X POST https://hs-ehn-verify.oga-surf-project.workers.dev/verify-dryrun -H "authorization: Bearer $(cat ~/.hs_tornado_token)" -H 'content-type: application/json' -d '{"raw":"神奈川県平塚市 外壁塗装の見積もり 御見積金額 1,280,000円"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["decision"], d["reasons"], d["decision_inputs_sha256"][:12])'
```

本物のモデルの返事しだいで adopt か escalate になる。reject で reasons に span_ が並ぶなら、モデルが根拠の文字列を原文どおりに写していない(指示文を見直す)。
