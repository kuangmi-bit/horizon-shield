# Admission records (a2a-admission-v0)

A relying party (a shop, an API, the principal itself) can decide at its own door, before an action, whether an agent
that says it acts under a signed MUSUBI contract may go ahead, and sign what it decided. That signed answer is an
admission record. Settlement reads the execution against it afterwards.

**The implementation of the door is not public. The record is public, and anyone can check it with the verifier in
this directory.** This page describes the shape of the record and how to check and recompute it. Nothing here issues an
identity, and nobody but the relying party stops anything. HORIZON SHIELD anchors records sent to its ledger and
settles after the fact. It renders no decision.

## Files

| file | what it is |
|---|---|
| `admission_verify_v0.py`, `admission_verify_v0.mjs` | the verifying side: `verify_admission`, `admission_sha256`, `action_digest`, the applicant's signed request, the principal's revocation record. Python is the reference |
| `schemas/a2a-admission-v0.schema.json`, `schemas/a2a-revocation-v0.schema.json` | the shape of the two records (the verifier is the reference) |
| `clause_eval_v0.py`, `clause_eval_v0.mjs` | how one action reads against a signed grant, limits included. Every admission names the Python file by sha256, and settlement imports it |
| `settle_v1_11.py` | settle v1.10 plus one rule, applied only when `requirements.admission` is `required_before_execution` |
| `settle_v1_12.py` | settle v1.11 plus one rule, applied only when the grant carries `limits` |
| `contract_v0.py`, `contract_door_v0.mjs` | the contract door, with `grant.limits`, in Python and JavaScript |
| `admission_intake.mjs` | `POST /admission` and `POST /revocation` for the ledger worker. Stores and anchors what was signed. It decides nothing |
| `peer_kit.py` | the applicant's side: `request` before acting, `exec` naming the admission, `settle` |
| `fixtures/` | records a door signed, with the sha256 of each file in `fixtures/ADMISSION_FIXTURES.sha256` |

## The record

    {"schema": "a2a-admission-v0", "admission_id", "relying_party": {"domain", "key_url"},
     "contract_ref": {"contract_id", "contract_sha256"}, "action_ref": {"action_binding_digest", "nonce"},
     "presentation_ref": [{"adapter", "sha256", "verified", "self_asserted"?, "self_declared"?}],
     "chain_view": {"height", "header_sha256"}, "revocations_seen": [...],
     "decision": "admit" | "escalate" | "refuse", "reasons": [...], "clause",
     "rules": {"admit": "a2a-admission-v0", "version": "0.1", "evaluator_sha256"},
     "establishes": [...], "does_not_establish": [...], "publication"?: "public", "signatures": [{"domain", "alg": "ed25519", "sig"}]}

- **Signed bytes**: the ASCII line `a2a-admission-v0`, a newline, then the musubi-canonical-v0 bytes of the record
  without `signatures`. `admission_sha256` is the sha256 of those bytes; an execution record names it.
- **Who signs**: the relying party, with a key served at `relying_party.key_url`, which must be https on
  `relying_party.domain`. A record signed with the applicant's own contract key is refused (`self_admission`).
- **Reasons**, a closed list: `within_grant`, `conditional_needs_approval`, `prohibited_action`, `outside_grant`,
  `amount_over_limit`, `delegation_exceeds_parent`, `contract_expired`, `nonce_reused`, `grant_revoked`, `key_revoked`,
  `presentation_unverifiable`, `signer_not_on_own_domain`, `action_digest_mismatch`. There is no score.
- **`action_ref.action_binding_digest`**: sha256 of the musubi-canonical-v0 bytes of
  `{contract_sha256, action, target, amount, nonce, expiry_height}`. It binds what was asked to what was admitted, and
  settlement requires the execution to state the same values.
- **`presentation_ref`**: what the applicant showed, by the sha256 of its canonical bytes, and whether the relying
  party verified it. `verified: null` means not verified. `self_declared` lists fields the applicant brought as its own
  result; a record that carries it is a refusal.
- **`revocations_seen`**: the revocations the relying party obeyed, each as `{sha256, anchored, height}`. A revocation
  without an anchor has no proven time, and the record's `does_not_establish` says so.
- **`rules.evaluator_sha256`**: the sha256 of `clause_eval_v0.py` as the relying party ran it. Settlement recomputes the
  clauses with the same file.
- **Versions**: a record with `rules.version: "0.1"` (2026-10-10) is as above. A record with no `rules.version` is v0:
  its `revocations_seen` are sha256 strings and the third line of its `does_not_establish` differs. The verifier, the
  intake and settlement accept each with its own stated limits and refuse one that carries the other's.
- **Publication**: a record leaves the relying party only by the relying party's choice. The ledger intake stores a
  record only when its signed bytes say `"publication": "public"`.

## Checking a record

    python3 admission_verify_v0.py --verify adm.json --key <base64 Ed25519 key from relying_party.key_url> --contract c.AB.json

`verify_admission` returns `accepted`, or `refused` with codes: `malformed`, `does_not_establish_altered`,
`signer_not_on_own_domain`, `bad_signature`, `other_contract`, `self_admission`. It checks that the record is the
relying party's, unaltered, for these terms. It does not say whether the decision was right. That is what settlement
recomputes.

## The applicant's request and the principal's revocation

The applicant asks with an `a2a-action-request-v0`: `{contract_ref, action: {action, target, amount}, nonce,
expiry_height, approvals, requester: {role}, action_binding, signatures}`, signed over the ASCII line
`a2a-action-request-v0`, a newline and the canonical bytes without `signatures`, with the key the contract names for
its role (`peer_kit.py request`, `admission_verify_v0.build_action_request`). `amount` is an integer in the unit
`grant.limits` states for the action.

The principal ends a grant, or one key's use of it, with an `a2a-revocation-v0` signed over the ASCII line
`a2a-revocation-v0`, a newline and the canonical bytes without `signatures` and `anchor`
(`admission_verify_v0.build_revocation`, `revocation_signed_by_principal`).

## How settlement reads it

An execution record under a contract that requires admission carries
`admission_ref: [{action, admission_sha256, executed: {action, target, amount, nonce, expiry_height}}]`.

**v1.11.** Only for a contract with `requirements.admission = "required_before_execution"`; every other contract
settles to settle v1.10's bytes.

| deviation | when |
|---|---|
| `unadmitted_execution` | no admission is named, or the one named is not in hand, does not verify, or was already used |
| `executed_after_refusal` | the admission said refuse, or escalate with no countable approval carried |
| `executed_other_than_admitted` | the digest of what was executed is not the admission's `action_binding_digest` |
| `admission_after_execution` | the admission is anchored above the execution, or not anchored |
| `admitted_out_of_grant` | the admission said admit and the clause evaluator, run again, puts the action outside the grant |

**v1.12.** Only for a contract whose grant carries `limits`; every other contract settles to v1.11's bytes.

| deviation | when |
|---|---|
| `amount_over_limit` | `executed.amount` is above `grant.limits[action].max_amount`, or the record states no amount for a limited action |
| `admitted_out_of_grant` | that action was admitted: the relying party's signed admission says admit |

`grant.limits` is `{"<action>": {"max_amount": <integer >= 1>, "unit": "JPY"}}`. A limit is a cap; no approval lifts it.
The contract door refuses limits in a contract that does not require admission, because the amount of an execution
is stated only with its admission.

    python3 settle_v1_12.py --settle c.AB.json --event e.anchored.json --view headers.json --admission adm.anchored.json --relying-key shop.example=<base64>

## Stated limits

- A record shows what a relying party signed. It does not show that the relying party ran any particular code;
  settlement does not need that, because it recomputes the clauses from the contract.
- The amount settlement reads is the one the execution record states and the admission's digest binds. Whether that
  amount moved in the world is outside these records.
- A revocation without an anchor has no proven time. A revocation the relying party did not hold is not in its record.
- The fixture records were made with fixed test keys by a door this repository does not carry. Their sha256 is listed
  so that a change to them is visible; the settlements they lead to are recomputed here on every run.

## Tests

    python3 admission_verify_v0.py --selftest        # records of both versions, the request, the revocation, the JavaScript twin
    python3 admission_verify_v0.py --check-fixtures
    python3 settle_v1_11.py --selftest
    python3 settle_v1_12.py --selftest
    python3 settle_regression.py                     # run0002, the outside parties' contract, the corpus, the published contracts
    python3 contract_door_check.py                   # the contract door in Python and JavaScript
    python3 contract_v0.py --selftest
    python3 clause_eval_v0.py --selftest
    node admission_intake.test.mjs
    python3 peer_kit.py selftest
