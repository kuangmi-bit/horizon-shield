# NENRIN Reference Interop Test, extension vectors (interop-v0.1)

interop-v0 (five bundles, pinned at c235e75e362ae6bf303e75be9a302caefe726c06) is unchanged and stays the frozen reference. This directory adds thirteen vectors in the same format and under the same contract: for each fixture, reproduce the verdict, the sorted refusal codes and the sorted finding codes in expected.json. A conforming implementation reproduces both corpora. Together they exercise all 14 refusal codes in ../provenance-v0/PROVENANCE.md.

## Why these vectors exist
On 2026-10-04 the first independent implementation of interop-v0 (Python, written from the specs without reading any NENRIN source, A2A Discussion #1631) reproduced all five verdict signatures and reported where the specs made a second implementer guess. The spec text was clarified the same day (signing input, R4 scope, invalid_timestamp as a reason, every finding defined, linkage under equivocation). These vectors pin what the clarifications say, so the next implementer does not have to guess:

- linkage_unpresented: the link names a receipt_id that is not in the presented set. Refused under either reading.
- linkage_unreconciled: the link names a presented receipt that did not reconcile (not signed by the authorized provider). This is the vector that separates "names a presented receipt" from "names the reconciled receipt": it is refused (linkage_receipt_mismatch).
- self_authorized: the grant's caller is its own provider. Accepted with the finding.
- witness_is_party: R1, a witness that is a party to its own hop. Refused (delegation_observation_invalid, reason witness_not_independent).
- task_id_mismatch, task_id_missing, incomplete_pair, provider_sig_invalid, non_utc_timestamp, evidence_malformed, preflight_without_grant, preflight_invalid, preflight_signature_invalid: one vector per refusal code interop-v0 does not reach. expected.json also records each refusal's reason for readers; reasons are not part of the verdict signature.

## Run it
    node run_interop.mjs

run_interop.mjs verifies each fixture with ../sdk/nenrin_verify.mjs (the same single file published as nenrin-verify) and asserts it reproduces expected.json. The Python port (PyPI nenrin-verify) reproduces the same thirteen verdict signatures; it is a port by the same author, so it is not an independent implementation.

## Note
Re-running make_interop_fixtures.mjs produces NEW fixtures with fresh keys. The committed fixtures/ and expected.json are the immutable reference; run_interop.mjs is the check.
