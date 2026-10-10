# a2a-approval-v3: an approver's approval that names the most it covers

Status: v3, 2026-10-10. Reference `approval_v3.py`, twin `approval_v3.mjs`, vectors `fixtures/approval_v3/vectors.json`,
read by settle v1.13 (`settle_v1_13.py`).

## Why

An `a2a-approval-v2` approval ([babyblueviper1's format](fixtures/babyblueviper1_approver_v2/), settle v1.10) has no
amount in its signed bytes, so one approval covers any amount the grant allows. `grant.limits` (settle v1.12) caps an
action, but a cap is the same for every execution. v3 lets the pinned approver say "this approval is for 150,000 and no
more". Agreed on [#29](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29): v2 stays frozen as
babyblueviper1's reference, v3 lives here next to settle and `grant.limits`, with its own domain tag and with
`max_amount` as an integer string, so no float is ever in the signed bytes.

## The entry

An `approvals[]` entry in an execution record, with exactly these keys:

    {"approval": "a2a-approval-v3", "action", "by": "approver", "approver", "max_amount", "unit",
     "valid_until_height", "nonce", "single_use", "sig_b64"}

- `approval`: the literal `"a2a-approval-v3"`. It says which bytes to verify.
- `action`: a `grant.conditional` action that the pinned approver lists and `grant.limits` caps.
- `approver`: the name of an entry in `grant.approval_policy.approvers`.
- `max_amount`: an integer in the unit's smallest denomination, written as a decimal string: `^(0|[1-9][0-9]{0,17})\Z`.
  No sign, no leading zero, no fraction, no exponent, at most 18 digits.
- `unit`: 1 to 64 printable ASCII characters, and equal to `grant.limits[action].unit`.
- `valid_until_height`: an integer from 0 to 2^53 - 1. `nonce`: 32 lowercase hex characters. `single_use`: a boolean.
- `sig_b64`: Ed25519 by the pinned key, canonical base64 of 64 bytes.

## The signed bytes

    b"a2a-approval-v3\n" + canonical({"contract_sha256", "action", "approver_key", "max_amount", "unit",
                                      "valid_until_height", "nonce", "single_use"})

`canonical` is musubi-canonical-v0 (`contract_v0.canonical`, `canonical_v0.mjs`). `contract_sha256` is recomputed from
the contract the reader holds; `approver_key` is the pinned key's base64. The first line differs from v2's
(`a2a-approval-v2\n`), so a v2 signature never verifies as v3 and a v3 signature never verifies as v2 (vectors
`v3/v2_signature_presented_as_v3`, `v2/v3_signature_presented_as_v2`).

## Reading an entry

`verify_approval_v3(contract, entry)` returns `("approved", None)` or `("approval_unverified", reason)`, in this order:

| reason | when |
|---|---|
| `not_a_v3_approval` | not an object, `approval` is not `a2a-approval-v3`, or `by` is not `approver` |
| `malformed` | a key missing or extra, or a field outside its form above |
| `approver_not_pinned` | no pinned approver has this name |
| `action_not_permitted_for_approver` | the pinned approver does not list the action |
| `malformed_key_or_signature` | the pinned key or `sig_b64` is not canonical base64 of 32 or 64 bytes |
| `bad_signature` | the signature does not verify over the v3 bytes |
| `action_has_no_limit` | `grant.limits` sets no limit for the action, so there is no unit to read an amount in |
| `unit_differs_from_limit` | `unit` is not `grant.limits[action].unit` |

Every pattern is anchored with `\Z` in Python and with a `$` that matches only at the end in JavaScript: no field
accepts a trailing newline in either runtime.

An entry is read as parsed from its execution record, which settle parses strictly (`contract_v0.parse_strict`: a
duplicate key is refused). One difference between runtimes is left to the parser: a JSON number written with a fraction
or an exponent (`500.0`, `5e2`) is a float in Python, so `malformed`, and the integer 500 in JavaScript. The Python
reference is the normative reading, and settle is Python. A writer avoids it by writing integers as integers.

`covers(entry, amount)`: a verified entry covers an amount when the amount is an integer from 0 to 2^53 - 1 (the
integers musubi-canonical-v0 writes) and `int(max_amount) >= amount`.

## How settle v1.13 uses it

settle v1.13 applies only when `grant.limits` caps an action a pinned approver gates. Then:

- The approver rule accepts v3 entries (verified as above) and reads v2 entries with the nonce anchored by `\Z`, as
  babyblueviper1's reference reads it since [bcf6592](https://github.com/babyblueviper1/preaction-governance-conformance/commit/bcf6592903abf6585cccf3a270312bc6ac99eb21)
  (sha256 `72f807a4...`). Ordering, expiry against the action's anchor and single use are settle v1.7's walk.
- `amount_not_approved`: an approved execution of a gated, limited action that states an amount must be covered by a v3
  approval for that action, anchored by then, unexpired, unspent if `single_use`, with `max_amount` at or above the
  amount. Approvals are taken first fit in (height, record, list) order. The reason says which: the approval counted
  names no amount (v2, or the principal's), the v3 approval covers less, no v3 approval was usable then, or the v3
  approval shares its nonce with another approval entry.
- Only the records settle v1.7's walk accepted are read, at the heights it verified (`authoritative_event_set`). A
  record's anchor is not covered by the contractor's signature, so a copy with a forged earlier anchor, or a record
  whose binding is inconsistent, carries no approval here.
- The walk spends one nonce across every counted approval, v2 and v3 and every action. A v3 approval whose nonce another
  approval entry also carries is therefore not used to cover an amount.
- `grant.limits` stays a cap no approval lifts (v1.12). An approval for more than the cap does not raise it.

## What v3 does not do

It does not change v2: v2 entries, their bytes and babyblueviper1's nine vectors are untouched, and settle v1.10 to
v1.12 read them as before. It does not bound a principal's approval (settle v1.6), which still names no amount. The
signature proves the pinned approver's key signed that amount, not that the amount was right, and a stolen approver key
signs a valid approval.

## Check it

    python3 approval_v3.py --selftest      # vectors regenerate byte for byte, every reason reached, the JavaScript twin agrees
    node approval_v3.test.mjs              # the vectors through approval_v3.mjs
    python3 settle_v1_13.py --selftest     # settle v1.13, and settle v1.12 and every layer under it
