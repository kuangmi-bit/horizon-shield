#!/usr/bin/env bash
# The public boundary. horizon-shield is public so strangers can recompute everything: record types, verifiers,
# walkers, the witness responder, the drill. Operating internals are not: the Shield agent, enrollment and
# outreach policy, private keys. This refuses a commit or push whose tracked files cross that line.
# Run: tools/boundary/check_public_boundary.sh        (from the repository root; exit 1 names every hit)
# As a hook: ln -sf ../../tools/boundary/check_public_boundary.sh .git/hooks/pre-push
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PAT_FILE="tools/boundary/private_patterns.txt"
hits=0
files=$(git ls-files)
while IFS= read -r pat; do
  case "$pat" in ''|'#'*) continue ;; esac
  m=$(printf '%s\n' "$files" | grep -E "$pat" || true)
  if [ -n "$m" ]; then
    printf '%s\n' "$m" | while IFS= read -r l; do printf 'private path tracked: %s  (rule %s)\n' "$l" "$pat"; done
    hits=1
  fi
done < "$PAT_FILE"
cand=$(git grep -l -I -E -e '-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----' -- . ':!tools/boundary/*' 2>/dev/null || true)
# A header alone is code (a test string, a PEM builder). Key material is the header followed by a real body line.
keys=$(printf '%s\n' "$cand" | python3 -c '
import re, sys
rx = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[ \t]*\r?\n[A-Za-z0-9+/=]{40,}")
for p in filter(None, (l.strip() for l in sys.stdin)):
    try:
        if rx.search(open(p, encoding="utf-8", errors="replace").read()): print(p)
    except OSError: pass
')
if [ -n "$keys" ]; then
  printf '%s\n' "$keys" | sed 's|^|private key material tracked: |'
  hits=1
fi
if [ "$hits" = 1 ]; then
  echo "public boundary: refused. Move these to hs-engine-private or hs-shield-private, or out of the tree."
  exit 1
fi
echo "public boundary: clean ($(printf '%s\n' "$files" | wc -l | tr -d ' ') tracked files)"
