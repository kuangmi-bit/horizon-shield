# Key History v1 (`key-history-v1`)

**Status:** v1, 2026-09-28, served from gate 0.4.18 at `https://gate.horizonshield.dev/.well-known/key-history.json`.
**License:** Apache-2.0. **Language:** RFC 2119 keywords.

## 1. The problem

A signature says who holds a key. It does not say when it was made. If a key is stolen, every signature made with it
from then on belongs to the thief, and nothing in the signed bytes tells the two apart. Removing the key from a JWKS
stops new verifications, but it also silently strips attribution from everything the key signed honestly before.

This document is how this domain declares its keys over time, so that a reader can decide, for any signature, whether
it still counts.

## 2. The document

`GET /.well-known/key-history.json` returns:

- `schema`: `key-history-v1`
- `subject`: the domain
- `keys[]`: every public key the domain has signed with. Each entry has `use` (`agent-card`, `agreement`, `witness`,
  `operator`), `kid`, `alg`, the public key (`public_jwk` or `public_key_ed25519_b64`), `served_at`, `signs`, `since`
  (the date a commit in this repository first published it) and `since_commit`, and `status` with `retired_at`,
  `revoked_at`, `compromised_from`, `reason`.
- `rule[]`: the rule in section 3, as served.
- `history_sha256`: SHA-256 of the canonical JSON (sorted keys, UTF-8) of `{schema, subject, keys, rule}`.
- `env_consistency[]`: for each use, whether the key the running server is configured with is the active key in the
  history. A mismatch is reported, never hidden.
- `anchors`: where a served history has been fixed by a clock the operator does not control. `current[]` lists only
  the anchors whose `history_sha256` equals the one served now (JIDEC entry, Bitcoin block, the OpenTimestamps proof,
  the seed committed to this repository, and where present a Zenodo DOI holding the same bytes and proof outside this
  domain); `previous[]` the others; `covers_served_list` is false after a rotation until
  the new list is anchored. `anchors` is not covered by `history_sha256`: an anchor is made after the list it anchors.
- `does_not_establish[]`.

The list lives in the commit (`src/key_history.js`), not in server configuration. Each change is anchored on the JIDEC
ledger: the ledger entry's `claim_sha256` equals `history_sha256`, so the list has a date the operator cannot move
(`make_key_history_seed.mjs` builds the entry and refuses unless the deployed list equals the committed one).

## 3. The rule

Statuses: `active` (signing now), `retired` (rotated out without compromise), `revoked` (compromised or suspected).

1. A key not in the history is not this domain's key.
2. `active`: a signature by it is attributable to the operator.
3. `retired`: signatures made while it was active stay attributable. Bytes proven to exist only after `retired_at` are
   not.
4. `revoked`: a signature by it is attributable **only** when the signed bytes are shown, by a clock the operator does
   not control (for example an OpenTimestamps proof anchored in Bitcoin), to have existed before `compromised_from`.
   Without that proof it is not attributable.
5. Any status: bytes proven to have existed before `since` are not attributable (the key did not exist yet).

`compromised_from` is the earliest time the key could have been exposed, not the time the exposure was noticed. When
in doubt the operator MUST choose the earlier time: that withdraws attribution from more honest signatures, but never
extends it to a forged one.

A JWKS served by this domain MUST contain only `active` and `retired` keys. A `revoked` key MUST NOT be served, so no
new signature by it verifies.

## 4. Rotation (no compromise)

1. Generate the new key where the old one is kept (offline; never in the server).
2. Add the new key to the history as `active`; set the old key to `retired` with `retired_at`.
3. Re-sign every agent card that used the old key with the new one; deploy; the JWKS now carries both.
4. Anchor the new `history_sha256` on the ledger.

## 5. Compromise

1. Set the key to `revoked` with `revoked_at` (now) and `compromised_from` (section 3), `reason` in one sentence.
2. Generate a new key and add it as `active` (for a card key: re-sign every card that used the revoked key).
3. Remove the revoked key from every server configuration and JWKS; deploy.
4. Anchor the new `history_sha256`; record the incident in `ext/FINDINGS_EXTERNAL.md` or the incident log.
5. Signatures by the revoked key made before `compromised_from` keep counting only where a record's own anchor proves
   its time (the ledger's OTS proofs do this for anything anchored there).

## 6. What this does not establish

That no key has been stolen, only what the operator has declared. That a signature by an active key was made by the
operator and not by someone who took the key unnoticed. Anything about a record's content.

## 7. Verifying

`src/key_history.js` exports `attributable(keyRef, existedBefore)`, a pure function of the served history. The rule is
also stated in `rule[]` so a reader can implement it without this code. `test/key_history.test.mjs` fixes the cases
in section 3 and three failure modes (a card rotated without updating the history, a revoked key counted without
proof of time, a revoked key served in the JWKS).
