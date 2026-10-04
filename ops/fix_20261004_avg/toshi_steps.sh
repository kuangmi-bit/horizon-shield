#!/bin/bash
# 2026-10-04 C6 で落ちた 2 本の後始末。段は P1 P2 の順。
#   P1: 試験 -> 6 ファイルだけ commit -> push(他の人の未コミットは混ぜない)
#   P2: 本番が新しい版になったのを確かめてから、IndexNow に 3 本(dry-run で 3/0 の時だけ送る)
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="https://shield.the-horizons-innovation.com"
FILES="souba/kajou-seikyu-jirei-20/index.html souba/gaiheki-kajou-seikyu/index.html llms-full.txt sitemap-archive.xml indexnow_submit.py tools/test_indexnow_gate.py ops/fix_20261004_avg/toshi_steps.sh"
URLS="${SITE}/souba/kajou-seikyu-jirei-20/,${SITE}/souba/gaiheki-kajou-seikyu/,${SITE}/ehn/"
say()  { printf '\n>>> %s\n' "$*"; }
stop() { printf '\n!!! %s\n' "$*"; exit 1; }
cd "${R}" || stop "リポジトリが見つからない"

case "${1:-}" in
P1)
  say "P1: 関所の試験"
  python3 tools/test_indexnow_gate.py || stop "試験が赤。番人に見せる"
  say "P1: 頁の門(pagecheck)"
  python3 tools/pagecheck/validate.py --paths souba/kajou-seikyu-jirei-20/index.html souba/gaiheki-kajou-seikyu/index.html | tail -n 2 || stop "pagecheck が赤"
  say "P1: この 7 ファイルだけ commit して push"
  git add ${FILES} || stop "git add に失敗"
  git commit -m "souba: 実例20件の平均削減額の計算違いを直す(82.5万円 → 約101万円、20件の差額の単純平均 1,009,500円)。平均削減率の表記は約33%(20件の単純平均を整数に丸めた)。IndexNow の禁止語照合から画像の base64 を外す(/ehn/ の誤検知)" || stop "commit に失敗"
  git push || stop "push に失敗"
  say "P1 済。GitHub Pages の反映に 10 分ほど掛かる。10 分後に P2"
  ;;
P2)
  say "P2: 本番が新しい版か(キャッシュを避けて見る)"
  for u in "${SITE}/souba/kajou-seikyu-jirei-20/" "${SITE}/souba/gaiheki-kajou-seikyu/"; do
    b="$(curl -s "${u}?cb=${RANDOM}${RANDOM}")"
    if printf '%s' "${b}" | grep -q "約101万円" && ! printf '%s' "${b}" | grep -q "82\.5万円"; then
      echo "  新しい版: ${u}"
    else
      stop "まだ古い版: ${u} 。数分おいて P2 をもう一度"
    fi
  done
  KEY="$(python3 - "${R}" <<'PY'
import os, re, sys
for n in sorted(os.listdir(sys.argv[1])):
    m = re.fullmatch(r"([0-9a-f]{32})\.txt", n)
    if m and open(os.path.join(sys.argv[1], n), encoding="utf-8").read().strip() == m.group(1):
        print(m.group(1)); break
PY
)"
  [ -n "${KEY}" ] || stop "サイトの根に IndexNow の鍵のファイルが見つからない"
  say "P2: dry-run(送らない)"
  OUT="$(INDEXNOW_KEY="${KEY}" python3 indexnow_submit.py --no-marker --urls "${URLS}")"
  printf '%s\n' "${OUT}"
  printf '%s' "${OUT}" | grep -q "適格 3 / 除外 0" || stop "3/0 でない。送らずに止めた。キャッシュなら数分おいて P2 をもう一度"
  say "P2: 送る"
  INDEXNOW_KEY="${KEY}" python3 indexnow_submit.py --no-marker --urls "${URLS}" --send
  say "P2 済。全部終わり"
  ;;
*)
  stop "段は P1 か P2"
  ;;
esac
