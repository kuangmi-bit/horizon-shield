# interop-v0.2/edge: the pinned edge rules, with vectors

`interop-v0` and `interop-v0.1` freeze verdict signatures for whole bundles. Neither carries a vector for
most of what `provenance-v0/VERIFIER.md` section 5 pins, so the promise made there — *pinned so two
implementations agree* — is not exercised by `run_interop.mjs`: a verifier that disagrees with section 5
passes both corpora. This corpus gives each pinned rule a vector, including the rules only an adversary
reaches (base64 re-encodings, non-canonical and small-order keys).

Every fixture is freshly signed with keys generated for it, and is valid except for the one rule under
test, so only that rule can refuse it. The expectations are the verdict signatures of an independent
Python implementation written from the text alone (`python/verify_edge.py`, see Provenance); the
reference implementation was not read.

## Run it

```sh
cd workers/hs-ledger/nenrin/interop-v0.2/edge
python3 python/run_edge.py
```

Requires Python 3.10+ and `cryptography` (Ed25519 through OpenSSL, as section 5 pins). The runner exits
non-zero on any verdict-signature mismatch and prints the reasons for the mismatch.
`python/make_edge_fixtures.py .` regenerates the fixtures and `expected.json`, and reports per key-rule
case whether this OpenSSL build still accepts the forgery the fixture is built around.

## Settled rules, one fixture each

| fixture | rule |
|---|---|
| `ts_real_day_ok`, `ts_fraction_truncation_ok` | positive controls: a real leap day, and millisecond truncation inside an inclusive window |
| `ts_impossible_day`, `ts_hour_24`, `ts_second_60`, `ts_year_zero` | a conforming verifier MUST reject impossible instants |
| `ts_trailing_newline`, `ts_lowercase_tz`, `ts_offset` | the pattern matches the whole string, ASCII digits, uppercase `T`/`Z`, no offset |
| `prev_absent_seq0` | `prev_evidence_id` at seq 0 must be exactly null; absent fails `root_prev_not_null` |
| `seq_not_integer` | `hop.seq` must be a JSON integer, else `seq_gap` |
| `seq_duplicate_same_verdict` | R3 groups *distinct* seqs; two witnesses at one seq are not a gap |
| `verdict_missing_is_distinct` | a missing `conduct.verdict` is a distinct value of its own (R4) |
| `evidence_empty_object`, `evidence_empty_array` | present and not well formed, `evidence_invalid` |
| `evidence_zero`, `outcome_not_object` | absent by the falsy rule, `no_evidence_bound` |
| `require_signatures_zero`, `require_signatures_false` | only the literal `false` disables signature checks — the `false` fixture keeps a bad signature so the difference is observable |
| `unknown_bundle_keys` | unknown bundle keys are ignored |
| `sig_canonical_ok`, `sig_missing_padding`, `sig_urlsafe_alphabet`, `sig_whitespace`, `sig_trailing_newline`, `sig_noncanonical_trailing_bits` | canonical standard base64 only (strict from 0.4.1) |
| `obs_element_not_object`, `obs_nonobject_with_valid`, `receipts_element_not_object`, `receipt_key_not_object`, `grant_key_not_object`, `intent_key_not_object` | malformed records (settled 2026-10-04, this corpus): one refusal in the slot's own step with reason `record_not_object`, and not presented in any other respect |
| `key_identity_small_order`, `key_identity_noncanonical_signbit`, `key_order8_small_order`, `key_mixed_order` | the Ed25519 key rule (from 0.4.2): a public key resolves only if it is the canonical encoding of a non-identity point of the prime-order subgroup |

## Malformed records, as settled in review

The six fixtures, against the rule now in section 5:

- an element of `observations` that is not an object adds `delegation_observation_invalid`
  (`obs_element_not_object`, `obs_nonobject_with_valid`);
- a `grant`, `receipt` or `receipts` element that is not an object adds `execution_invalid`
  (`grant_key_not_object`, `receipt_key_not_object`, `receipts_element_not_object`);
- an `intent` that is not an object adds `preflight_invalid` (`intent_key_not_object`);
- in every other respect the slot is not presented. A grant with `receipts: [5]` is therefore also
  `execution_incomplete_pair`, and `receipt: 5` still lets `receipts[0]` be the primary, so step 4 runs.

This is one step stricter than the proposal in the first cut of this corpus, which read such a slot as not
presented and would have left `receipt_key_not_object` and `intent_key_not_object` **accepted**. The
settled rule is fail-closed on the argument that null or false is a producer saying "nothing here" while a
number is a producer that is broken, and the verdict should tell them apart.

## The Ed25519 key rule, and why those fixtures need a forgery

Section 5 resolves a public key only if it is the canonical encoding (y < p, and not x = 0 with the sign
bit set) of a non-identity point P of the prime-order subgroup. An implementation that delegates key
handling to OpenSSL alone accepts all four of these, so each fixture carries a signature a verifier
*without* the rule accepts and one *with* it refuses. The generator checks that claim against OpenSSL as
it builds them:

| fixture | key | what a verifier without the rule sees |
|---|---|---|
| `key_identity_small_order` | the identity point | `R = identity, S = 0` verifies every message, with no private key |
| `key_identity_noncanonical_signbit` | the identity with the sign bit set (x = 0 with the sign bit set) | the same forgery |
| `key_order8_small_order` | a point of order 8 | the same forgery, over a receipt ground so that `[k]T` is the identity |
| `key_mixed_order` | A + T, a mixed-order point | a signature by the holder of A's private key, accepted as a second, independent party (R1) |

All four are refused as `execution_signature_invalid` (+ `execution_unreconciled`, since no receipt
reconciles). The last is the attack the rule exists for: one party's key posing as two. The generator
printed `discriminating` for all four on 2026-10-05 (OpenSSL 3.x, via `cryptography`).

## The two cases section 5 caught in an independent implementation

Both are here because no vector in the older corpora can reach them:

- `ts_trailing_newline` — in Python the regex anchor `$` also matches *before* a trailing newline, so a
  pattern written `^...Z$` accepted `"2026-10-04T00:30:00Z\n"` as a valid instant. The sentence "matches
  the whole string (no trailing newline)" is load-bearing, not editorial.
- `prev_absent_seq0` — reading an absent `prev_evidence_id` at seq 0 as null accepted the bundle.
  Section 5's "must be exactly null; absent fails `root_prev_not_null`" is the exception that catches it.

## Provenance

`python/verify_edge.py` is an independent implementation of `provenance-v0/VERIFIER.md` written from the
text alone, after the clean-room test of 2026-10-04. It reproduces all 18 verdict signatures of
`interop-v0` + `interop-v0.1` and the 36 here, and implements section 5 as of nenrin-verify 0.4.4
(verifier_version 0.1.6): the timestamp rules, canonical base64, malformed records and the Ed25519 key
rule, the last with its own point arithmetic for the subgroup check. Canonicalization is re-implemented
from the musubi-canonical-v0 prose (byte-identical to RFC 8785 on both corpora); `cryptography` supplies
the OpenSSL Ed25519 verification the key rule layers on top of. The reference implementation was not read.
