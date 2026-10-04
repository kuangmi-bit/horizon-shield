#!/bin/bash
# JCCDB v5.1 の件数・版・DOI を、サイトと worker の説明文に当てる TOshi の台本(2026-10-04 番人)。
# 使い方: bash ~/horizon-shield/ops/jccdb_counts_v51/toshi_steps_counts.sh C1
#         段は C1 C2 C3 C3m C4 C5 C6 の順。1 段ずつ打ち、最後の行を見てから次へ。
set -euo pipefail

STAGE="${1:-}"
ONLY="${2:-}"
R="${HOME}/horizon-shield"
S="${R}/ops/jccdb_counts_v51"
REL="${HOME}/hs-release/20261004"
DOIS="${REL}/dois.json"
SUMMARY="${REL}/build_summary.json"
OUT="${S}/out_v5.1"
ENGINE="${HOME}/hs-engine-private/hs-mcp"
PROGRESS="${HOME}/hs-core-private/handoff/PROGRESS_counts_v51_20261004.md"
MCPJS="workers/hs-mcp/src/mcp.js"
OLD_DOI="10.5281/zenodo.22980284"
NEW_TOTAL_C="526,128"
NEW_TOTAL=526128
NEW_OBS=430725
NEW_SRC=88
SITE="https://shield.the-horizons-innovation.com"
ARGS=(--root "${R}" --dois "${DOIS}" --old-total 425765 --new-total 526128 --old-obs 330362 --new-obs 430725 --items 95403
      --old-version 5.0 --new-version 5.1 --old-date 2026-09-26 --new-date 2026-10-04 --old-doi "${OLD_DOI}"
      --old-sources 76 --new-sources "${NEW_SRC}")

say() { printf '%s\n' "$*"; }
stop() { printf '止めた: %s\n' "$*" >&2; exit 1; }
progress() {
  if [ -d "${HOME}/hs-core-private/handoff" ]; then
    printf '%s\n' "- $(date '+%Y-%m-%d %H:%M') $*" >> "${PROGRESS}"
  fi
}
new_doi() {
  python3 - "${DOIS}" "${OLD_DOI}" <<'PY'
import json, re, sys
d = json.load(open(sys.argv[1], encoding="utf-8")).get("jccdb") or {}
doi = (d.get("doi") or "").strip()
if not re.fullmatch(r"10\.5281/zenodo\.\d+", doi):
    sys.exit("dois.json の jccdb.doi の形が違う: %r" % doi)
if doi in (sys.argv[2], "10.5281/zenodo.22127751"):
    sys.exit("dois.json の jccdb.doi が v5.0 の DOI か全版の DOI のまま: " + doi)
if d.get("concept_doi") not in (None, "", "10.5281/zenodo.22127751"):
    sys.exit("dois.json の jccdb.concept_doi が 22127751 ではない")
print(doi)
PY
}
mcp_release_patched() {
  local id
  id="$(new_doi)"
  id="${id#10.5281/zenodo.}"
  grep -q "zenodo.${id}" "${R}/${MCPJS}"
}
indexnow_key() {
  python3 - "${R}" <<'PY'
import os, re, sys
for n in sorted(os.listdir(sys.argv[1])):
    m = re.fullmatch(r"([0-9a-f]{32})\.txt", n)
    if m and open(os.path.join(sys.argv[1], n), encoding="utf-8").read().strip() == m.group(1):
        print(m.group(1))
        break
PY
}
run_test() {
  local name="$1"
  shift
  if "$@" > "${OUT}/test_${name}.txt" 2>&1; then
    say "  通った: ${name}  $(tail -n 1 "${OUT}/test_${name}.txt")"
  else
    tail -n 20 "${OUT}/test_${name}.txt"
    stop "試験 ${name} が落ちた(全文は ${OUT}/test_${name}.txt)"
  fi
}
count_in() {
  local pat="$1" file="$2"
  ( grep -o -- "${pat}" "${file}" || true ) | wc -l | tr -d ' '
}

[ -n "${STAGE}" ] || stop "段を付けて打つ(例: bash ${S}/toshi_steps_counts.sh C1)"
mkdir -p "${OUT}"
cd "${R}"

case "${STAGE}" in

C1)
  say "C1: 確かめるだけ。何も書かない。Ctrl+C で止めても何も残らない。"
  [ -f "${DOIS}" ] || stop "${DOIS} が無い。公開の台本が Zenodo の v5.1 の DOI を書くまで待つ"
  NEW_DOI="$(new_doi)"
  say "v5.1 の DOI: ${NEW_DOI}(v5.0 は ${OLD_DOI}、全版 10.5281/zenodo.22127751 は変えない)"
  if [ -f "${SUMMARY}" ]; then
    python3 - "${SUMMARY}" "${NEW_OBS}" "${NEW_SRC}" <<'PY'
import json, sys
j = json.load(open(sys.argv[1], encoding="utf-8")).get("jccdb") or {}
rows, src = j.get("rows_out"), len(j.get("sources") or [])
print("公開の台本の組み立て: 観測 %s 行、出典 %s、ファイル %s" % (rows, src, j.get("files_out")))
if rows != int(sys.argv[2]):
    sys.exit("観測の行数が 430,725 ではない。番人に見せる")
if src != int(sys.argv[3]):
    sys.exit("出典の数が 88 ではない。台本の NEW_SRC を直すので番人に見せる")
PY
  else
    say "build_summary.json は無い。出典の数 ${NEW_SRC} は番人が観測層 v2 から数えた値(restricted を除いた 430,725 行、71 ファイル)で進める"
  fi
  for c in python3 node npx git curl; do
    command -v "${c}" > /dev/null || stop "${c} が無い"
  done
  say "git:"
  git --no-optional-locks status -sb | sed -n '1p'
  STAGED="$(git status --short | grep '^[MARD]' || true)"
  if [ -n "${STAGED}" ]; then
    say "${STAGED}"
    stop "stage 済みのファイルがある(別の作業の物)。この台本の commit に混ざるので、先に片付ける"
  fi
  UNPUSHED="$(git --no-optional-locks log --oneline origin/main..main || true)"
  if [ -n "${UNPUSHED}" ]; then
    say "まだ push していない commit がある(C4 で一緒に出ていくので、中身を確かめておく):"
    say "${UNPUSHED}"
  fi
  if mcp_release_patched; then
    say "hs-mcp: 公開の台本の get_jccdb_dataset_info の直しは済み(mcp.js に新しい DOI がある)。C3 の後に C3m で mcp.js を当てる"
  else
    say "hs-mcp: 公開の台本の get_jccdb_dataset_info の直しはまだ。C3 と C4 は先に進めてよい。直しが済んでから C3m、その後 C5 hs-mcp"
  fi
  progress "counts C1 済(DOI ${NEW_DOI})"
  say "C1 済。次は C2"
  ;;

C2)
  say "C2: 下見。git pull で main を origin に合わせてから、置き換える所の一覧と差分を出す。台本はファイルを書かない。Ctrl+C は安全。"
  [ -f "${DOIS}" ] || stop "${DOIS} が無い"
  git pull --rebase --autostash origin main
  python3 "${S}/update_counts.py" "${ARGS[@]}" --skip "${MCPJS}" --out "${OUT}" --reviewed "${S}/targets_reviewed_v5.1.txt" --dry-run
  say ""
  say "差分の頭(全部は ${OUT}/full.diff、ファイルごとの当たりは ${OUT}/plan.txt):"
  sed -n '1,24p' "${OUT}/full.diff"
  progress "counts C2 済(下見)"
  say "C2 済。上の「検査: 全部合格」を見てから C3"
  ;;

C3)
  say "C3: 当てる。書く前に全部を検査し、1 本でも落ちたら 1 本も書かない。書いた後に pagecheck と各 worker の試験を回す。"
  say "    途中で Ctrl+C すると、書いた後の試験だけが止まる(書いたファイルは ${OUT}/originals_*.tar.gz から戻せる)。"
  [ -f "${DOIS}" ] || stop "${DOIS} が無い"
  python3 "${S}/update_counts.py" "${ARGS[@]}" --skip "${MCPJS}" --out "${OUT}" --discover
  python3 - "${OUT}/discovered.txt" <<'PY'
import os, subprocess, sys
paths = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
env = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
r = subprocess.run(["git", "--no-optional-locks", "-c", "core.quotepath=false", "status", "--porcelain", "--"] + paths,
                   stdout=subprocess.PIPE, universal_newlines=True, env=env)
dirty = [l for l in r.stdout.splitlines() if l.strip()]
if dirty:
    print("\n".join(dirty))
    sys.exit("置き換える対象に、まだ commit していない別の変更がある(上の一覧)。混ざるので先に片付ける")
print("置き換える対象 %d 本に、別の作業の変更は無い" % len(paths))
PY
  python3 "${S}/update_counts.py" "${ARGS[@]}" --skip "${MCPJS}" --out "${OUT}" --reviewed "${S}/targets_reviewed_v5.1.txt" --apply
  say ""
  say "pagecheck(CI と同じ門。その push で変わる yakumo/care/qa/aeo/faq の頁を、HEAD を前の版として見る):"
  grep -E '^(yakumo|care|qa|aeo|faq)/.*\.html$' "${OUT}/changed_files.txt" > "${OUT}/pc_paths.txt" || true
  if [ -s "${OUT}/pc_paths.txt" ]; then
    if python3 tools/pagecheck/validate.py --before HEAD --paths $(cat "${OUT}/pc_paths.txt") > "${OUT}/pagecheck.txt" 2>&1; then
      tail -n 2 "${OUT}/pagecheck.txt"
    else
      grep -E 'NG|DUPLICATE|検証結果' "${OUT}/pagecheck.txt" || true
      stop "pagecheck が赤。番人に見せる。戻すときは: tar -xzf ${OUT}/originals_*.tar.gz -C ${R}"
    fi
  fi
  run_test pagecheck_redteam python3 tools/pagecheck/redteam.py
  run_test pagecheck_dedup_before python3 tools/pagecheck/test_dedup_before.py
  say "worker の試験:"
  run_test hearing_syntax bash -c 'for f in industry autopilot hearing visibility concierge; do node --check "workers/hs-hearing/src/${f}.js" || exit 1; done; echo "node --check 5 本"'
  run_test hearing_suites bash -c 'cd workers/hs-hearing && node run_all.mjs'
  run_test hearing_sync bash -c 'python3 tools/nursing/sync_questions.py --check && python3 tools/visibility/sync_questions.py --check && python3 tools/industries/check.py'
  run_test ccdb bash -c 'cd workers/hs-ccdb-mcp && node test/ccdb.test.mjs'
  run_test ccdb_build bash -c 'python3 workers/hs-ccdb-mcp/build/build_worker.py "$0" > /dev/null && cmp "$0" workers/hs-ccdb-mcp/src/worker.js && echo "生成器から同じバイト"' "${OUT}/ccdb_rebuilt.js"
  run_test jccdb_obs bash -c 'cd workers/hs-jccdb-obs && PROD_SQL=0 node test/harness.mjs'
  run_test webmcp bash -c 'cd workers/hs-webmcp && node --check index.js && node --check embed.js && node test/ask_tactics.test.mjs'
  progress "counts C3 済($(wc -l < "${OUT}/changed_files.txt" | tr -d ' ') 本を当てた、検査と試験は全部通った)"
  say "C3 済。次は C4。hs-mcp の mcp.js は C3m で当てる(公開の台本の get_jccdb_dataset_info の直しが済んでから。C4 の前でも後でもよい)"
  ;;

C3m)
  say "C3m: hs-mcp の mcp.js だけを当てる(公開の台本の get_jccdb_dataset_info の直しが済んでから)。Ctrl+C は書く前なら安全。"
  mcp_release_patched || stop "mcp.js にまだ新しい DOI が無い。公開の台本の hs-mcp の段を先に済ませる"
  if grep -q "JCCDB v5.1, ${NEW_TOTAL_C} records" "${MCPJS}"; then
    say "mcp.js はもう当たっている。試験だけ回す"
  else
    mkdir -p "${OUT}/mcp"
    python3 "${S}/update_counts.py" "${ARGS[@]}" --only "${MCPJS}" --with-dataset-info-desc --out "${OUT}/mcp" --apply
  fi
  for f in workers/hs-mcp/test/*.test.mjs workers/hs-mcp/test/sdk_js_interop.mjs; do
    b="$(basename "${f}")"
    run_test "hsmcp_${b}" bash -c 'cd workers/hs-mcp && node "test/$0"' "${b}"
  done
  progress "counts C3m 済(mcp.js)"
  say "C3m 済。C4 がまだなら C4、済んでいれば C5 hs-mcp"
  ;;

C4)
  say "C4: git。C3 で変えたファイルと ops/jccdb_counts_v51 の台本 5 本だけを名指しで add し、commit。plugin を変えたときは Grok の写しを先に push し、最後に horizon-shield を push。"
  [ -s "${OUT}/changed_files.txt" ] || stop "C3 がまだ"
  DONE_COMMIT=0
  LAST_SUBJECT="$(git log -1 --format=%s)"
  case "${LAST_SUBJECT}" in
    *"JCCDB の件数・版・DOI を v5.1"*) git diff --quiet HEAD -- $(cat "${OUT}/changed_files.txt") && DONE_COMMIT=1 ;;
  esac
  if [ "${DONE_COMMIT}" = "1" ]; then
    say "commit はもう済んでいる($(git rev-parse --short HEAD))。push の続きから"
  fi
  STAGED="$(git status --short | grep '^[MARD]' || true)"
  [ -z "${STAGED}" ] || { say "${STAGED}"; stop "stage 済みのファイルがある(別の作業の物)。先に片付ける"; }
  UNPUSHED="$(git --no-optional-locks log --oneline origin/main..main || true)"
  if [ "${DONE_COMMIT}" = "1" ]; then
    UNPUSHED="$(git --no-optional-locks log --oneline origin/main..HEAD~1 || true)"
  fi
  if [ -n "${UNPUSHED}" ] && [ "${ALLOW_UNPUSHED:-0}" != "1" ]; then
    say "${UNPUSHED}"
    stop "まだ push していない別の commit がある。一緒に出してよければ ALLOW_UNPUSHED=1 bash ${S}/toshi_steps_counts.sh C4"
  fi
  if [ "${DONE_COMMIT}" = "0" ]; then
  python3 - "${R}" "${OUT}/after_sha256.txt" <<'PY'
import hashlib, os, sys
bad = []
for line in open(sys.argv[2], encoding="utf-8"):
    line = line.rstrip("\n")
    if not line:
        continue
    h, rel = line.split("  ", 1)
    p = os.path.join(sys.argv[1], rel)
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != h:
        bad.append(rel)
if bad:
    print("\n".join(bad))
    sys.exit("C3 の後に書き換わったファイルがある(上の一覧)。C2 からやり直す")
print("C3 で書いたファイルは、書いたときのまま")
PY
  while IFS= read -r f; do
    if [ -n "${f}" ]; then
      git add -- "${f}"
    fi
  done < "${OUT}/changed_files.txt"
  for f in update_counts.py toshi_steps_counts.sh prod_compare.mjs targets_reviewed_v5.1.txt .gitignore; do
    git add -- "ops/jccdb_counts_v51/${f}"
  done
  git -c core.quotepath=false diff --cached --name-only > "${OUT}/staged.txt"
  python3 - "${OUT}/changed_files.txt" "${OUT}/staged.txt" <<'PY'
import sys
want = set(l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip())
got = set(l.strip() for l in open(sys.argv[2], encoding="utf-8") if l.strip())
extra = sorted(g for g in got - want if not g.startswith("ops/jccdb_counts_v51/"))
missing = sorted(want - got)
if extra or missing:
    print("余分:", extra[:20]); print("足りない:", missing[:20])
    sys.exit("stage した物が C3 の一覧と合わない")
print("stage した: %d 本(C3 の %d 本と台本)" % (len(got), len(want)))
PY
  python3 - "${OUT}/report.json" "${DOIS}" "${OUT}/commit_msg.txt" <<'PY'
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8")); doi = json.load(open(sys.argv[2], encoding="utf-8"))["jccdb"]["doi"]
by = r.get("by_dir", {})
pages = sum(v for k, v in by.items() if k not in ("workers", "plugin", "ops", "data"))
msg = """site: JCCDB の件数・版・DOI を v5.1(2026-10-04)に。計 526,128 件(品目 95,403 + 観測 430,725 行)、DOI %s

- サイトの頁と llms.txt・llms-full.txt・README など %d 本。data/jccdb-manifest.json(記事の生成器 generate_blog.py が読む)も v5.1 に
- JCCDB の定義の所(トップの Dataset、llms.txt、JCCDB とは)は版と日付が分かる形に。出典の数は 76 から 88 に
- worker の説明: hs-ccdb-mcp(生成器 build_worker.py と data_tools.json と生成物)、hs-jccdb-obs、hs-webmcp、hs-hearing(Yakumo の stats も)、hs-mcp の README
- 頁を作る生成器 ops/monitor_pages_20260915/build_pages2.py に残っていた古い数も
- pagecheck の重複の関所に掛からないよう、qa の 4 頁は定型文から件数を外した(2026-09-27 と同じやり方)
- plugin %s(Grok の写し horizon-shield-plugin も同じ版)
- 台本 ops/jccdb_counts_v51/(数・版・日付・DOI は引数。来月の版も同じ台本で回せる)
- 検査: 古い数・DOI・版の残り 0、全版と論文の DOI は不変、JSON-LD と JSON、HTML のタグの並び、ダッシュは増えていない、pagecheck 0 件、各 worker の試験

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JZzp13Vf9yukn1YHi2HTLv
""" % (doi, pages, (r.get("plugin_bump") or ["", "の版は変えていない"])[1])
open(sys.argv[3], "w", encoding="utf-8").write(msg)
print(msg.splitlines()[0])
PY
  git commit -q -F "${OUT}/commit_msg.txt"
  say "commit: $(git rev-parse --short HEAD)"
  fi
  if grep -q '^plugin/' "${OUT}/changed_files.txt"; then
    say "plugin の写し(ogasurfproject-jpg/horizon-shield-plugin)を先に push する。main の push で動く plugin-mirror-drift を赤にしないため"
    grep '^plugin/' "${OUT}/changed_files.txt" > "${OUT}/plugin_files.txt"
    M="$(mktemp -d)/horizon-shield-plugin"
    git clone -q --depth 1 https://github.com/ogasurfproject-jpg/horizon-shield-plugin.git "${M}"
    while IFS= read -r f; do
      rel="${f#plugin/}"
      mkdir -p "$(dirname "${M}/${rel}")"
      cp "${R}/${f}" "${M}/${rel}"
    done < "${OUT}/plugin_files.txt"
    diff -r -q --exclude=.git "${R}/plugin" "${M}" || stop "plugin/ と写しがまだ違う(上の一覧)。番人に見せる"
    (
      cd "${M}"
      while IFS= read -r f; do
        git add -- "${f#plugin/}"
      done < "${OUT}/plugin_files.txt"
      if git diff --cached --quiet; then
        say "写しはもう同じ($(git rev-parse --short HEAD))"
      else
        git commit -q -m "JCCDB v5.1: 526,128 records (95,403 line items and 430,725 observations); version $(python3 -c 'import json;print(json.load(open(".claude-plugin/plugin.json"))["version"])')"
        git push -q origin HEAD
        say "写しを push した: $(git rev-parse --short HEAD)"
      fi
    )
  fi
  git pull --rebase --autostash origin main
  git push origin main
  say "push 済: $(git rev-parse --short HEAD)"
  progress "counts C4 済(push $(git rev-parse --short HEAD))"
  say "C4 済。GitHub Pages と hs-hearing の deploy の Actions が動く。次は C5"
  ;;

C5)
  say "C5: worker を順に deploy し、本番の答えを確かめる。deploy の前に「本番と手元の違いが数字だけか」を見て、違えばその worker は出さずに止まる。"
  say "    途中で Ctrl+C しても、出し終えた worker は新しい版、まだの worker は前の版のまま(どちらも壊れない)。"
  NEW_DOI="$(new_doi)"
  NEW_ID="${NEW_DOI#10.5281/zenodo.}"
  PC="node ${S}/prod_compare.mjs"
  want() { [ -z "${ONLY}" ] || [ "${ONLY}" = "$1" ]; }
  [ -z "${ONLY}" ] || say "    ${ONLY} だけを出す"
  ship() {
    local w="$1" file="$2" url="$3"
    say "== ${w}"
    ${PC} "workers/${w}/${file}" "${url}" pre "${OUT}" || stop "${w}: 本番に届かないか、本番と手元の違いが数字だけではない(手元が本番と別の版)。deploy せずに止めた。番人に見せる"
    if [ "${w}" = "hs-webmcp" ]; then
      ( cd "workers/${w}" && npx --yes wrangler deploy --dry-run ) > "${OUT}/webmcp_dryrun.txt" 2>&1 || stop "hs-webmcp の dry-run が通らない"
      for b in HS_MCP_SVC LEDGER_SVC STATS; do
        grep -q "${b}" "${OUT}/webmcp_dryrun.txt" || stop "hs-webmcp の dry-run に ${b} が見えない。deploy すると消えるので止めた"
      done
      say "  hs-webmcp の dry-run に HS_MCP_SVC・LEDGER_SVC・STATS の 3 本が見える"
    fi
    ( cd "workers/${w}" && npx --yes wrangler deploy ) || stop "${w} の deploy が失敗"
    local i=0
    until ${PC} "workers/${w}/${file}" "${url}" post "${OUT}"; do
      i=$((i + 1))
      [ "${i}" -lt 6 ] || stop "${w}: deploy の後も本番が手元と同じにならない"
      sleep 10
    done
    say "  ${w}: 本番が手元と 1 字も違わない"
  }
  if want hs-jccdb-obs; then
    ship hs-jccdb-obs src/worker.js "https://hs-jccdb-obs.oga-surf-project.workers.dev/mcp"
  fi
  if want hs-ccdb-mcp; then
    ship hs-ccdb-mcp src/worker.js "https://ccdb.horizonshield.dev/mcp"
  fi
  if want hs-webmcp; then
    ship hs-webmcp index.js "https://web.horizonshield.dev/mcp"
    curl -sS --max-time 30 "https://web.horizonshield.dev/embed.js?store=hs-partner-001&v=$(date +%s)" > "${OUT}/prod_embed.js"
    say "  埋め込みの一文: ${NEW_TOTAL_C} が $(count_in "${NEW_TOTAL_C}" "${OUT}/prod_embed.js") 回、425,765 が $(count_in '425,765' "${OUT}/prod_embed.js") 回"
  fi
  if ! want hs-mcp; then
    :
  elif grep -q "JCCDB v5.1, ${NEW_TOTAL_C} records" "${MCPJS}"; then
    say "== hs-mcp(手元の mcp.js は公開の台本の直しと C3m の直しの両方が入っている)"
    ${PC} "${MCPJS}" "https://mcp.horizonshield.dev/mcp" pre "${OUT}" get_jccdb_dataset_info || stop "hs-mcp: 本番に届かないか、get_jccdb_dataset_info の他に数字以外の違いがある。deploy せずに止めた。番人に見せる"
    ( cd workers/hs-mcp && npx --yes wrangler deploy ) || stop "hs-mcp の deploy が失敗"
    i=0
    until ${PC} "${MCPJS}" "https://mcp.horizonshield.dev/mcp" post "${OUT}"; do
      i=$((i + 1))
      [ "${i}" -lt 6 ] || stop "hs-mcp: deploy の後も本番が手元と同じにならない"
      sleep 10
    done
    say "  hs-mcp: 本番が手元と 1 字も違わない"
    if [ -d "${ENGINE}/src" ]; then
      if cmp -s "${MCPJS}" "${ENGINE}/src/mcp.js"; then
        say "  hs-engine-private の mcp.js はもう同じ"
      else
        cp "${MCPJS}" "${ENGINE}/src/mcp.js"
        git -C "${ENGINE}" add src/mcp.js
        git -C "${ENGINE}" commit -q -m "hs-mcp: JCCDB v5.1 の件数(526,128)と版を説明文に。本番と同じ mcp.js"
        git -C "${ENGINE}" pull --rebase --autostash -q || true
        git -C "${ENGINE}" push -q
        say "  hs-engine-private に写して push した: $(git -C "${ENGINE}" rev-parse --short HEAD)"
      fi
    else
      say "  ${ENGINE}/src が無いので hs-engine-private への写しは飛ばした。番人に知らせる"
    fi
  else
    say "== hs-mcp は飛ばした(mcp.js に C3m がまだ当たっていない)。C3m の後に: bash ${S}/toshi_steps_counts.sh C5 hs-mcp"
  fi
  if want hs-hearing; then
  say "== hs-hearing(push で GitHub Actions の deploy-hs-hearing が出す。来なければ手元の deploy_hearing.sh で出す)"
  i=0
  until curl -sS --max-time 30 "https://hearing.horizonshield.dev/contractors.json?v=$(date +%s)" > "${OUT}/prod_contractors.json" 2> /dev/null && grep -q "\"jccdb_records\":${NEW_TOTAL}" "${OUT}/prod_contractors.json"; do
    i=$((i + 1))
    if [ "${i}" -eq 10 ]; then
      say "  5 分待っても Actions の deploy が来ない。手元から出す"
      bash workers/hs-hearing/deploy_hearing.sh
    fi
    [ "${i}" -lt 16 ] || stop "hs-hearing の contractors.json に jccdb_records ${NEW_TOTAL} が出ない"
    sleep 30
  done
  ${PC} workers/hs-hearing/src/hearing.js "https://hearing.horizonshield.dev/mcp" post "${OUT}" || stop "hs-hearing の本番の MCP の答えが手元と違う"
  say "  hs-hearing: Yakumo の stats が jccdb_records ${NEW_TOTAL}、MCP の答えも手元と同じ"
  fi
  if want site; then
  say "== サイト(GitHub Pages)"
  i=0
  until curl -sS --max-time 30 "${SITE}/llms.txt?v=$(date +%s)" > "${OUT}/prod_llms.txt" && grep -q "${NEW_TOTAL_C}" "${OUT}/prod_llms.txt" && grep -q "zenodo.${NEW_ID}" "${OUT}/prod_llms.txt" && ! grep -q '425,765' "${OUT}/prod_llms.txt"; do
    i=$((i + 1))
    [ "${i}" -lt 20 ] || stop "サイトの llms.txt が新しくならない(Pages の Actions を確かめる)"
    sleep 30
  done
  curl -sS --max-time 30 "${SITE}/data/jccdb-manifest.json?v=$(date +%s)" > "${OUT}/prod_manifest.json"
  curl -sS --max-time 30 "${SITE}/?v=$(date +%s)" > "${OUT}/prod_index.html"
  grep -q "\"records\": ${NEW_TOTAL}" "${OUT}/prod_manifest.json" || stop "サイトの data/jccdb-manifest.json が新しくない"
  say "  llms.txt: ${NEW_TOTAL_C} と新しい DOI がある。manifest の records ${NEW_TOTAL}。トップの頁は ${NEW_TOTAL_C} が $(count_in "${NEW_TOTAL_C}" "${OUT}/prod_index.html") 回、425,765 が $(count_in '425,765' "${OUT}/prod_index.html") 回"
  fi
  progress "counts C5 済${ONLY:+(${ONLY})}(本番で 526,128 を確認)"
  say "C5 済。次は C6(IndexNow)"
  ;;

C6)
  say "C6: 変えた頁を IndexNow に送る(Bing など)。Ctrl+C は安全(送った分だけ届く)。"
  python3 - "${OUT}/changed_files.txt" "${SITE}" > "${OUT}/indexnow_urls.txt" <<'PY'
import sys
site = sys.argv[2]
for line in open(sys.argv[1], encoding="utf-8"):
    p = line.strip()
    if not p.endswith(".html") or p.split("/")[0] in ("workers", "ops", "plugin", "data", "tools", "note-post"):
        continue
    if p == "index.html":
        print(site + "/")
    elif p.endswith("/index.html"):
        print(site + "/" + p[: -len("index.html")])
    else:
        print(site + "/" + p)
PY
  N="$(wc -l < "${OUT}/indexnow_urls.txt" | tr -d ' ')"
  say "送る頁: ${N} 本"
  KEY="$(indexnow_key)"
  [ -n "${KEY}" ] || stop "サイトの根に IndexNow の鍵のファイル(32 桁の名前の .txt)が見つからない"
  INDEXNOW_KEY="${KEY}" python3 indexnow_submit.py --no-marker --urls "$(paste -s -d , "${OUT}/indexnow_urls.txt")" --send
  progress "counts C6 済(IndexNow ${N} 本)"
  say "C6 済。全部終わり"
  ;;

*)
  stop "段は C1 C2 C3 C3m C4 C5 C6 のどれか(C5 は後ろに hs-jccdb-obs hs-ccdb-mcp hs-webmcp hs-mcp hs-hearing site のどれかを付けると、それだけ)"
  ;;
esac
