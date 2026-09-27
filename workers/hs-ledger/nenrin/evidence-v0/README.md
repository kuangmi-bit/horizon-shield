# evidence-v0: 扉の判定バイトを扉の外に置く

2026-09-27 に始めた。発端は外部の批判の「証拠の可用性」の項。

## 穴

扉 (gate.horizonshield.dev) の判定は `record_sha256` で名指しされ、その hash は履歴にも台帳にも載る。
ところが hash が指すバイトそのもの (`GET /record/<sha>` が配る物) は、Cloudflare KV の `rec:<sha>` 一か所にしか無かった。
口座が止まれば、hash は「もう誰も持っとらんバイトの名前」になる。

## 手当

`mirror_records.mjs` が公開の読みだけで全行の判定バイトを取り、SHA-256 が名前と一致した物だけを、取ったバイトのまま `records/<slug>/<sha>.json` に書く。
`records/` をこの公開 repo に commit すると第二の置き場になり、Software Heritage がこの repo を保存すると、扉とも GitHub とも別の組織が持つ第三の置き場になる。

2026-09-27 の初回 (`records/MIRROR_MANIFEST.json`):

| | 件数 |
|---|---|
| 行 | 9 |
| 写した (hash 一致) | 148 |
| 扉が持っとらん (`not_stored_by_gate`) | 248 |
| hash 不一致 | 0 |
| 取得失敗 | 0 |

248 件は 0.4.1 (2026-09-08) より前の判定で、扉はそのバイトを保存しとらんかった。hash だけが残る。取り戻せん物は取り戻せんと書く。

## 回し方

```
node workers/hs-ledger/nenrin/evidence-v0/mirror_records.mjs --out workers/hs-ledger/nenrin/evidence-v0/records
```

冪等。既に在って hash が合うファイルは取り直さん。壊れた手元の写しは検証済みのバイトで置き換える。hash が合わんバイトは書かずに `hash_mismatch` と記録し、exit 2 で止まる。
鍵も token も要らん。

試験: `node mirror_records.test.mjs` (偽の扉、網に出ん、15 本)。

## 証明せん物

写しは判定が正しい事を証明せん。扉が他の誰かに同じバイトを配った事も証明せん。`not_stored_by_gate` の判定は hash しか残っとらん。写しが完全なのは、取った時点の `/register` に載っとった行についてだけ。
