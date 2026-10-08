# NENRIN conduct-walk component for federation-port/v0

A project-owned `federation-port/v0` adapter with role `tool_admission`, written against the published contract only
([aeoess/federation-port](https://github.com/aeoess/federation-port) at `92d5078`). It lets a runtime require, before it
dispatches to an endpoint, a signed NENRIN witness record of that endpoint: a conduct walk by an outside witness the
customer trusts, that passed, recently enough. It checks the record offline. There is no network access
(`data_destinations: []`), no dependencies, no secrets and no privileges.

This is the check the NENRIN ledger already runs when a witness files a record: the record bytes, the Ed25519 signature
over them, and the key of the domain that signed. Here the customer pins that key in config instead of the ledger
fetching it.

The caller presents, as this component's evidence, the record exactly as `GET https://ledger.horizonshield.dev/witness/<sha>`
serves it (bare, or under `{"record": ...}` as the NENRIN MCP tool `nenrin_witness` returns it). The component reports three
claims, so a policy can require exactly what it needs:

| claim | established when |
|---|---|
| `nenrin.walk_authentic` | `record_canonical` is a canonical `jidec-path-v1` record (sorted keys, no spaces; its sha256 recomputes when `sha` is given), its `witness.key_url` is on a domain in `trusted_witnesses` and not in `operator_domains`, and its Ed25519 signature over those exact bytes verifies under the key pinned for that domain |
| `nenrin.walk_covers_endpoint` | the record's purpose is `a2a-conduct-walk-v1: <url>` and `<url>` equals the configured `endpoint` byte for byte |
| `nenrin.walk_passed_recently` | it covers the endpoint, the verdict is `PASS` with `n_pass == n_total > 0`, and `walked_at` is no older than `max_age_s` (default 604800, seven days) and not later than now + `future_skew_s` (default 300). `valid_until` is `walked_at + max_age_s`, so the runtime's admission deadline enforces freshness |

Malformed input (bytes that are not JSON, not a witness record, a record that is not JSON, an impossible `walked_at`, or no
`endpoint` in config) is `failed`. Anything else that does not hold is `not_established`, each with its own reason:
`no_walk_presented`, `sha_does_not_recompute`, `record_not_canonical`, `not_a_jidec_path_record`,
`record_names_no_https_key_url`, `witness_is_the_operator`, `witness_domain_not_trusted`, `key_url_is_not_the_pinned_one`,
`presented_key_is_not_the_pinned_key`, `signature_missing_or_malformed`, `signature_invalid`,
`walk_is_of_a_different_endpoint`, `walk_outcome_<outcome>`, `walked_at_in_the_future` or `walk_older_than_max_age`.

**Limits.**
- **A signature shows who asserted the record, not that it is true.** A walk is one observation from one vantage at one
  instant.
- **Binds the endpoint only.** Not the tool, the arguments, the tenant, the approval id or the operation id. The same record
  can be presented for any action dispatched to that endpoint.
- **No Bitcoin check.** Whether the ledger has batched the record and its stamp has confirmed is not checked here; that needs
  the OpenTimestamps proof and block headers (`GET /ledger/<n>/ots`).
- **Trusted keys are the customer's choice.** No key rotation or revocation in v0.1, and the component does not fetch the key
  a domain serves today.
- **No trusted time.** Freshness uses the signed `walked_at` and the runtime's clock.

## Config

```json
{
  "endpoint": "https://gate.horizonshield.dev/a2a",
  "trusted_witnesses": {
    "pipavlo82.github.io": { "public_key_ed25519_b64": "A9cRj87tZ6Ob5FbRU12LazXRD7fNUJcSNK80Rp1U3zM=", "key_url": "https://pipavlo82.github.io/keys/witness.json" }
  },
  "operator_domains": ["horizonshield.dev", "gate.horizonshield.dev"],
  "max_age_s": 604800,
  "future_skew_s": 300
}
```

`key_url` in a trusted entry is optional; when given, the record must name exactly that URL. Witness domains are the
hostname of the record's `witness.key_url`, compared exactly (case-insensitive), in both `trusted_witnesses` and
`operator_domains`; list every operator hostname that could sign.

## Getting a record

```bash
curl -s https://ledger.horizonshield.dev/witness/747ecd97635e104e75185212cfb70e3cc37310ea1f41966a818bfb5b5d57df15
```

Anyone can file one: `a2a_conduct_walk.py` in `../../a2a-conduct-walk/` walks an endpoint, signs the record with your key
and submits it.

## Verified

Run `./reproduce.sh`. It clones `aeoess/federation-port` at `92d5078`, adds this component without touching `src/`, seals it
with the repo's own `scripts/seal.ts` (the sealed manifest is byte-identical to the one here), and runs the full suite:
**51/51 (the 44 existing tests plus 7 here)**. The repo's `tsc -p tsconfig.json` reports 0 errors. Sealed digests: artifact
`sha256:50bff064d3e3b9db25b63c96968b617c69182023f5e7d82e8aa515d000804205`, manifest
`sha256:0d888abe203b1395efea14e4d841e21201708a3629a642c0cefd4731c49f791e`.

The tests run on three real signed records from the ledger (`test/fixtures/walks.json`), by two outside witnesses:
- **pipavlo82.github.io**, a walk of `https://gate.horizonshield.dev/a2a`, 7/7 PASS, 2026-10-07 (record `747ecd97…`).
- **kuangmi-bit.github.io**, walks of `https://mcp.horizonshield.dev/mcp` (7/7) and `https://gate.horizonshield.dev/mcp` (4/4),
  2026-10-07 (records `587d28a7…`, `e1521f11…`).

Cases covered: admitted with all three claims established (both evidence shapes); a genuine walk of another endpoint refused
on coverage; an untrusted witness, an operator domain and a different pinned key_url refused on authenticity; an edited
record (caught by the sha, and without the sha by the signature), a reformatted record, a flipped signature bit, a presented
key that is not the pinned one, a truncated signature and a wrong pinned key each refused on authenticity; a FAIL walk, a
PASS whose counts disagree, a future walk, a stale walk and an impossible date each refused on the result; `valid_until`
equal to `walked_at + max_age_s` in the runtime's exact form; no walk, malformed bytes, a non-record and a missing endpoint
each with their own reason; and, as an optional component, never blocking. In every refused case the provider receives no
request. Records whose time or verdict a test chooses are signed in the test with a throwaway key for `witness.test`.

Two mutations of the adapter were run as a check on the tests: accepting every signature fails N04, and accepting every
endpoint fails N02.

MIT. Horizon Shield (The HORIZONs Co., Ltd.).
