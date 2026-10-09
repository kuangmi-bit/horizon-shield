#!/usr/bin/env bash
# Run the joint candidate v1 target-coverage cases: invinoveritas/verdict-check 0.3.0 and NENRIN conduct-walk-check 0.2.0 in one
# workflow, on federation-port at the candidate vectors' commit (aeoess/federation-port#4), with src/ untouched.
# Needs git and Node >= 22. Run from anywhere inside a horizon-shield checkout.
set -euo pipefail
FP_PIN=136a3a9035752c6f4885f643449a8ea4f780f00f        # aeoess/federation-port#4, v1-candidates/target-coverage
IV_PIN=8c1aea50a0902ca2cf6e2bab1b5e0f1c59de7719        # babyblueviper1/preaction-governance-conformance, verdict-check 0.3.0
IV_DIGEST=sha256:126160033d88056f16ec2f67c6bf3ee8c4d66fcef11303b34642955b3a16281f
NN_DIGEST=sha256:68efb46e6d7236b2ff8106e98910d4d43e16b442956e83e766481925a3531414
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/tmp" && export TMPDIR="$W/tmp"
FLAG="--experimental-strip-types"; node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)' && FLAG=""
RUN="node $FLAG --disable-warning=ExperimentalWarning"

cp "$HERE/vectors.json" "$W/vectors.committed.json"
$RUN "$HERE/gen-vectors.mts" >/dev/null
cmp -s "$HERE/vectors.json" "$W/vectors.committed.json" && echo "vectors.json regenerates byte-identical" || { echo "vectors.json differs from the committed one"; exit 1; }

git clone -q https://github.com/aeoess/federation-port "$W/fp"
git -C "$W/fp" fetch -q origin pull/4/head && git -C "$W/fp" checkout -q "$FP_PIN"
git clone -q https://github.com/babyblueviper1/preaction-governance-conformance "$W/iv" && git -C "$W/iv" checkout -q "$IV_PIN"
mkdir -p "$W/fp/adapters/invinoveritas-verdict" "$W/fp/adapters/nenrin-conduct-walk" "$W/fp/v1-candidates/target-coverage/nenrin-joint"
cp "$W/iv/integrations/federation-port/invinoveritas-verdict/"{adapter.ts,bip340.ts,manifest.json} "$W/fp/adapters/invinoveritas-verdict/"
cp "$HERE/../nenrin-conduct-walk/"{adapter.ts,manifest.json} "$W/fp/adapters/nenrin-conduct-walk/"
cp "$HERE/"{joint.test.ts,vectors.json} "$W/fp/v1-candidates/target-coverage/nenrin-joint/"
cd "$W/fp" && npm ci --silent
digest() { $RUN scripts/seal.ts "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).artifact_digest))'; }
[ "$(digest adapters/invinoveritas-verdict)" = "$IV_DIGEST" ] && echo "ok  invinoveritas/verdict-check 0.3.0 $IV_DIGEST" || { echo "invinoveritas digest mismatch"; exit 1; }
[ "$(digest adapters/nenrin-conduct-walk)" = "$NN_DIGEST" ] && echo "ok  NENRIN conduct-walk-check 0.2.0 $NN_DIGEST" || { echo "NENRIN digest mismatch"; exit 1; }
git diff --quiet -- src && echo "core unmodified (src/ clean)"
$RUN --test v1-candidates/target-coverage/nenrin-joint/joint.test.ts
