#!/usr/bin/env bash
# refresh_upstream.sh <a2a-go commit or branch> : replace go/a2acrypto with upstream a2a-go's a2acrypto at that
# commit, unchanged apart from the one import path (the a2a package is the local JSON-shape stub in go/a2a), keep
# export_canon.go (the only file that is not upstream code), and rewrite UPSTREAM_SHA256.txt. Used by the watch
# workflow so a new a2a-go commit is measured as it is, not as it was copied on 2026-10-01.
set -euo pipefail
REF="${1:?usage: refresh_upstream.sh <commit|branch>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
git init -q "$T/a2a-go"
git -C "$T/a2a-go" remote add origin https://github.com/a2aproject/a2a-go.git
git -C "$T/a2a-go" fetch -q --depth 1 origin "$REF"
git -C "$T/a2a-go" checkout -q FETCH_HEAD
COMMIT="$(git -C "$T/a2a-go" rev-parse HEAD)"
find "$HERE/a2acrypto" -maxdepth 1 -name '*.go' ! -name export_canon.go -exec rm -f {} +
: > "$HERE/UPSTREAM_SHA256.txt"
for f in "$T"/a2a-go/a2acrypto/*.go; do
  case "$f" in *_test.go) continue ;; esac
  b="$(basename "$f")"
  (cd "$T/a2a-go/a2acrypto" && sha256sum "$b") >> "$HERE/UPSTREAM_SHA256.txt"
  sed -E 's#"github.com/a2aproject/a2a-go(/v[0-9]+)?/a2a"#"hs.local/interop/a2a"#' "$f" > "$HERE/a2acrypto/$b"
done
cp "$T/a2a-go/LICENSE" "$HERE/UPSTREAM_LICENSE"
echo "$COMMIT"
