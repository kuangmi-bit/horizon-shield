# interop-v0.2/edge: the pinned edge rules, and two open questions

`interop-v0` and `interop-v0.1` freeze verdict signatures for whole bundles. Neither carries a vector for
most of what `provenance-v0/VERIFIER.md` section 5 pins, so the promise made there — *pinned so two
implementations agree* — is not exercised by `run_interop.mjs`: a verifier that disagrees with section 5
passes both corpora. This corpus is one fixture per settled rule, plus one per open question, plus the two
cases section 5 caught in an independent implementation.

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
non-zero on any verdict-signature mismatch, and prints the reasons for the mismatch.

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

## Open questions — proposals, to settle before merge

These are the two cases where the text does not yet say what a conforming verifier must do. Each fixture
in the list carries the verdict this implementation gives. What follows is what I would write into the
text; if the reference's answer turns out to be an accident of its implementation, the rule should be
decided here and the reference changed to match.

1. **Element types inside `observations` / `receipts`.** Section 5 pins "not an array is treated as
   empty" but says nothing about elements that are not objects.
   *Proposal:* a non-object element of `observations` fails as an observation (one
   `delegation_observation_invalid`) and contributes nothing to step 0, R3 or R4; a non-object element of
   `receipts` is not a receipt and is not added to the receipt set.
   Fixtures: `obs_element_not_object`, `obs_nonobject_with_valid`, `receipts_element_not_object`.
2. **Record keys present but neither null/false nor an object.** Section 5 covers null, false and absent
   only.
   *Proposal:* such a value is not presented, exactly like null and false.
   Fixtures: `receipt_key_not_object`, `grant_key_not_object`, `intent_key_not_object`.

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
`interop-v0` + `interop-v0.1` and the 32 here. Canonicalization is re-implemented from the
musubi-canonical-v0 prose (byte-identical to RFC 8785 on both corpora); Ed25519 verification is OpenSSL
through `cryptography`; `sdk/nenrin_verify.mjs` was not read.
