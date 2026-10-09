# Admission (a2a-admission-v0)

A relying party runs one deterministic function at its own door before an action, and signs what it returned.
Settlement reads the execution against that record afterwards. The working name is SEKI.

    admit(contract, action_request, presentation, chain_view, revocations) -> admission

This directory holds the function, the record, the one settle rule that reads it, and the tests. Nothing here issues
an identity, and nobody but the relying party stops anything. HORIZON SHIELD publishes the function, anchors records
sent to its ledger, and settles after the fact. It renders no decision.

## Files

| file | what it is |
|---|---|
| `clause_eval_v0.py`, `clause_eval_v0.mjs` | the clauses: how one action reads against a signed grant. `settle_v1_10.py`, `settle_v1_11.py` and `admit_v0.py` import the Python file; the JavaScript file is its twin. An admission names the Python file by sha256 |
| `admit_v0.py`, `admit_v0.mjs` | `admit()`, the action request, the record, `sign_admission`, `verify_admission`, revocations read by height. Python is the reference |
| `settle_v1_11.py` | settle v1.10 plus one rule, applied only when `requirements.admission` is `required_before_execution` |
| `adapter_musubi_native.py`, `adapter_aps_v2.py` | read a MUSUBI contract or an Agent Passport System passport into a presentation item. They decide nothing |
| `admission_intake.mjs` | `POST /admission` and `POST /revocation` for the ledger worker. Stores and anchors what was signed |
| `peer_kit.py` | `request` and `admit` for two parties with nobody else in the path |
| `schemas/` | JSON Schema for the two records (shape only; the verifiers are the reference) |

## Decisions and reasons

Three decisions: `admit`, `escalate`, `refuse`. Reasons, a closed list: `within_grant`,
`conditional_needs_approval`, `prohibited_action`, `outside_grant`, `amount_over_limit`, `delegation_exceeds_parent`,
`contract_expired`, `nonce_reused`, `grant_revoked`, `key_revoked`, `presentation_unverifiable`,
`signer_not_on_own_domain`, `action_digest_mismatch`. There is no score.

A presentation item whose `verified` is `null` is not verified. `admit()` refuses on it, or escalates when the relying
party's policy says so. It never admits on it.

## The settle rule (v1.11)

Only for a contract with `requirements.admission = "required_before_execution"`; every other contract settles to
settle v1.10's bytes. An execution record carries
`admission_ref: [{action, admission_sha256, executed: {action, target, amount, nonce, expiry_height}}]`.

| deviation | when |
|---|---|
| `unadmitted_execution` | no admission is named, or the one named is not in hand, does not verify, or was already used |
| `executed_after_refusal` | the admission said refuse, or escalate with no countable approval carried |
| `executed_other_than_admitted` | the digest of what was executed is not the admission's `action_binding_digest` |
| `admission_after_execution` | the admission is anchored above the execution, or not anchored |
| `admitted_out_of_grant` | the admission said admit and the clause evaluator, run again, puts the action outside the grant |

## Adapters

`musubi-native`: `verified` is true when `contract_v0.verify_contract` accepts the contract and each party's `key_url`
is https on its own domain. With a delegated child it adds `within_parent` (`contract_v0.grant_subset`) and the
child's grant.

`aps-v2`: reads an `aps.agent-passport` version `2.0` record from the Agent Passport System
(https://github.com/agent-passport-system/agent-passport-system, Apache-2.0, package 7.2.1, commit
`c31d94aad86713ae9b2e4cbc811deeab4b5d91ed`, read 2026-10-10). **`verified` is `null` for every 2.0 passport.** That
repository carries the implementation and a test that draws fresh keys on each run; it carries no frozen vectors for
the 2.0 shape. What this adapter computed is reported under `aps.local_check` and named unconfirmed.
`fixtures/aps_agent_passport_system/README.md` lists the one official artifact that is checked (a signed passport in
the legacy shape, sha256 `dfd440006a268ba8495a57f8d2c08581a89dd073bfa6054de23c186fc6b4c8fd`) and says what has to exist
before `null` can become a boolean.

## Stated limits

- A revocation anchored after the chain view is not visible to that admission. The record says so.
- `admit()` compares a revocation's stated anchor height with the view and checks the principal's signature. Checking
  the anchor proof against headers is the relying party's step, and settlement does it again.
- The JavaScript twin checks that both parties' signatures verify over the contract; it does not re-run the rest of
  the contract door (`contract_v0.verify_contract`). For a contract the door accepts, the two runtimes give the same bytes.
- The clause lines inside `settle_v1_6.py` and `settle_v1_7.py` are published and are not edited. `clause_eval_v0.py`
  restates them for one action, and `admit_consistency.py` holds the restatement to them on every run.

## Tests

    python3 clause_eval_v0.py --selftest
    python3 admit_v0.py --selftest
    python3 settle_v1_11.py --selftest
    python3 adapter_musubi_native.py --selftest
    python3 adapter_aps_v2.py --selftest
    python3 admit_bytematch.py        # Python and JavaScript: the same record bytes, sha256 and reasons
    python3 admit_redteam.py          # every attack in the threat model, each with the code that stops it
    python3 admit_consistency.py      # admit before and settle after do not disagree
    python3 admit_regression.py       # run0002, the second contract, the outside parties' contract, the corpus
    node admission_intake.test.mjs
    python3 peer_kit.py selftest
