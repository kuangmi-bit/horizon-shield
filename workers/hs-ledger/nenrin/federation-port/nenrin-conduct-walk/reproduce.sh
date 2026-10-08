#!/usr/bin/env bash
# Reproduce: run this adapter through federation-port's UNMODIFIED core at the pinned commit.
# Needs git and Node >= 22 (type stripping). Node 24 runs it without the flag.
set -euo pipefail
PIN=92d5078
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/tmp" && export TMPDIR="$W/tmp"
git clone -q https://github.com/aeoess/federation-port "$W/fp" && git -C "$W/fp" checkout -q "$PIN"
mkdir -p "$W/fp/adapters/nenrin-conduct-walk" "$W/fp/test/fixtures/nenrin"
cp "$HERE"/adapter.ts "$HERE"/manifest.json "$W/fp/adapters/nenrin-conduct-walk/"
cp "$HERE"/test/nenrin-conduct-walk.test.ts "$W/fp/test/"
cp "$HERE"/test/fixtures/walks.json "$W/fp/test/fixtures/nenrin/"
cd "$W/fp" && npm ci --silent
FLAG="--experimental-strip-types"; node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' && FLAG=""
node $FLAG scripts/seal.ts adapters/nenrin-conduct-walk
cmp -s adapters/nenrin-conduct-walk/manifest.json "$HERE/manifest.json" && echo "sealed manifest identical to the published one"
git diff --quiet -- src && echo "core unmodified (src/ clean)"
node $FLAG --disable-warning=ExperimentalWarning --test --test-concurrency=1 'test/*.test.ts'
npx --no-install tsc -p tsconfig.json && echo "tsc: 0 errors"
