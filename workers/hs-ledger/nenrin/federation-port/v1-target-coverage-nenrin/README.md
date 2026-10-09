# Joint candidate v1 target-coverage cases: verdict and walk together

Candidate tests for the v1 target-coverage direction in
[aeoess/agent-governance-vocabulary#177](https://github.com/aeoess/agent-governance-vocabulary/issues/177), as offered there:
an action-bound source (`invinoveritas/verdict-check` 0.3.0) and an endpoint-coverage source (NENRIN `conduct-walk-check` 0.2.0)
required together, both target-bound, in one workflow. They sit next to the single-source cases in
[aeoess/federation-port#4](https://github.com/aeoess/federation-port/pull/4) (`v1-candidates/target-coverage/`) and use its
`decide()` unchanged. They are not part of contract v0 or any other version, and change nothing under `src/`.

Requirements in every case: `invinoveritas.verdict_covers_target` binds target, then `nenrin.walk_covers_target` binds target.
A = `https://gate.horizonshield.dev/a2a`.

| case | verdict issued on | walk of | runtime target | verdict claim | walk claim | result |
|---|---|---|---|---|---|---|
| J1 | action(A) | A | A | established, `subject:target=A` | established, `subject:target=A` | admit |
| J2 | action(A) | `/mcp` on the same host | A | established | `walk_is_not_of_the_runtime_target` | refuse, attributed to NENRIN |
| J3 | action(B) | A | A | `verdict_is_for_a_different_action` | established | refuse, attributed to invinoveritas |
| J4 | action(A/) | A | A/ | established, `subject:target=A/` | `walk_is_not_of_the_runtime_target` | refuse, attributed to NENRIN (exact string, no normalisation) |
| J5 | action(A) | A | none | `no_runtime_target` | `no_runtime_target` | refuse, `no_runtime_target` |
| J6 | action(L), L of 134 characters | L | L | established, `subject:target_sha256=<hex>` | established, `subject:target_sha256=<hex>` | refuse, `no_reported_subject`; admit if the rule also accepts the digest |

J1 to J5 use real signed walks from the NENRIN ledger by two outside witnesses: `pipavlo82.github.io` (a walk of A,
record `747ecd97…`) and `kuangmi-bit.github.io` (a walk of `https://gate.horizonshield.dev/mcp`, record `e1521f11…`), both
2026-10-07, from `../nenrin-conduct-walk/test/fixtures/walks.json`. J6 needs a target longer than any real walk, so its walk is
signed by a test witness from a fixed seed. Verdicts are signed with a BIP-340 test key from a fixed string, not the production
invinoveritas key; the signer is the one in federation-port's `gen-vectors.ts`, copied unchanged.

## J6 and the reason bound

The runtime bounds reasons to 120 UTF-16 units. Both components, written separately, fall back past the bound to the same form:
`subject:target_sha256=<hex>`, the sha256 of the target's UTF-8 bytes. The candidate `decide()` reads only `subject:target=`,
so a long target refuses with `no_reported_subject` even though both sources established it. The test also runs `decide()` with
one rewrite in front of it: an established `subject:target_sha256=<hex>` whose hex equals sha256 of the runtime target is read as
`subject:target=<runtime target>`. With that, J6 admits and J1 to J5 are unchanged. It keeps the comparison exact, since equal
digests mean equal strings, and it needs no subject field. A subject field in v1 would make it unnecessary.

## Run it

    ./reproduce.sh

It regenerates `vectors.json` and checks it is byte-identical, clones federation-port at the #4 commit and the invinoveritas
component at its pin, checks both sealed artifact digests, confirms `src/` is unchanged, then runs `joint.test.ts`, which also
runs the eight single-source cases it imports `decide()` from. Expected: `tests 14, pass 14, fail 0`.

## Limits

- What each claim establishes is unchanged: the verdict that the reviewed action named the target, the walk that an outside
  witness walked that URL. Neither says where the executor dispatches.
- A walk is one observation from one vantage at one instant; the walks here are pinned records, with `now` fixed.
- No Bitcoin check of the walks' anchoring here.

MIT. Horizon Shield (The HORIZONs Co., Ltd.). The copied BIP-340 signer is Apache-2.0 from aeoess/federation-port.
