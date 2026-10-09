# nenrin-trace-pin-v0

Pin a TRACE Trust Record to the NENRIN ledger by the sha256 of its RFC 8785 form.

TRACE ([agentrust-io/trace-spec](https://github.com/agentrust-io/trace-spec), v0.2, hosted as a Series of LF Projects) answers what ran, where and under which policy. A record is signed with Ed25519 by the key in `cnf.jwk`, over the RFC 8785 form of the record without its `signature` member. Its time is `iat`, which the issuer writes, and spec section 3.2.2 has verifiers reject a record older than 24 hours by default.

So a record that proves something today cannot be checked by a conformant verifier next month, and nothing in it bounds `iat` from outside. This module adds that half. It checks the signature at intake, keeps the exact bytes, and anchors their sha in a daily batch that is stamped to Bitcoin.

How a relying party uses a bound like this is described, without naming any service, in TRACE's informative page [Verifying a record after the freshness window](https://github.com/agentrust-io/trace-spec/blob/main/docs/verifying-after-the-freshness-window.md) (proposed in [agentrust-io Discussion #47](https://github.com/orgs/agentrust-io/discussions/47), merged in [agentrust-io/trace-spec#480](https://github.com/agentrust-io/trace-spec/pull/480) on 2026-10-08): replay the section 3.2.2 freshness comparison at a time T taken from evidence that the exact bytes existed, and report it as a separate, historical check with T and its source stated. A Bitcoin block over the pinned sha is a T of the kind that page calls a second, independent bound: it binds the RFC 8785 bytes, a reader checks it without us, and it bounds when the bytes existed and nothing about what they say.

## Pin one in one command

    npx -p nenrin-verify nenrin-trace-pin trace.json --yes      # or: pipx run --spec nenrin-verify nenrin-trace-pin trace.json --yes
    npx -p nenrin-verify nenrin-trace-pin status <sha>

Without `--yes` it is a dry run that sends nothing. The client runs this module's intake first, refuses locally what the
ledger would refuse, and fails if the ledger's sha differs from its own (nenrin-verify 0.5.1).

## Routes (hs-ledger)

| | |
|---|---|
| `GET /evidence/trace` | rules, caps, what a pin establishes and what it does not |
| `POST /evidence/trace` | body `{"record": <signed TRACE record>}`; 201 pending, 200 dedup, 422 refused with `reason_code` |
| `GET /evidence/trace/{sha}` | status, thumbprint, anchor, the parsed record |
| `GET /evidence/trace/{sha}?format=raw` | the pinned bytes; `sha256(body) == sha` |
| `GET /evidence/trace/pending` | the pool waiting for the 00:30 UTC batch |

## Checked at intake

1. `eat_profile` is `tag:agentrust-io.com,2026:trace-v0.2`. The v0.1 identifier is refused, as TRACE v0.2 requires.
2. The ten members the v0.2 schema requires are present. The full schema is not validated here.
3. `signature` is canonical unpadded base64url of 64 bytes. `cnf.jwk` is OKP / Ed25519. The signature verifies.
4. `iat` is no more than 300 seconds after the ledger's clock. A postdated record is refused, because the anchor would otherwise seem to confirm a time the issuer chose.
5. Every value has one RFC 8785 form in every language. Lone surrogates and non-finite numbers are refused. So are integers outside the safe range, which is stricter than Python's `rfc8785` on a float like `1e21` on purpose.

Old records are accepted, since keeping them checkable is the point. The answer carries `fresh_at_intake`.

## What a pin does not establish

- Any claim inside the record (model, measurement, policy, data class, tools).
- That the key belongs to the subject. The key is the one the record carries, so compare `key_thumbprint` (RFC 7638) with a key you trust.
- Revocation status, whether the transparency receipt resolves, the true issue time, or who submitted it.

## Not read in v0

Enveloped signatures (JWS, COSE, cMCP RuntimeClaim), non-Ed25519 confirmation keys, revocation bundles and SCITT receipts. Each is refused or ignored by name, never guessed.

## Tests

- `node nenrin/trace-pin-v0/trace_pin_v0.test.mjs`: 42 checks. They run against records made by TRACE's own library (`agentrust-trace` 0.11.0 on PyPI, `fixtures/gen_fixtures.py`). The pinned sha must equal Python's RFC 8785 bytes, the thumbprint must equal `jwk_thumbprint`, and RFC 8785 vectors must be byte identical. The attack checks cover tampered claims, signature spellings, profile, time, size, depth and number range.
- `node test/trace_pin.test.mjs`: the real worker end to end, from intake through the scheduled batch to the anchored view and the chain head.
- 8 deliberate mutants each fail at least one of the two.
- `node nenrin/trace-pin-v0/run_trace_tests_vectors.mjs <checkout>/tests/vectors`: the shared vectors of [agentrust-io/trace-tests](https://github.com/agentrust-io/trace-tests) (33 files; the copy under trace-spec `conformance/tests/vectors` has 60 with the anchor-inclusion set), run as the spec maintainers asked in [agentrust-io Discussion #47](https://github.com/orgs/agentrust-io/discussions/47). Every file has a stated expectation: the four canonicalization records and the two signed records are pinned; the six `invalid_*` records are refused with the matching reason (integer range, lone surrogate, non-finite number, missing `runtime`, wrong profile); the valid records that carry no embedded signature are refused as `no_embedded_signature` and the cMCP envelope as `enveloped_form`, because a pin attests a verified signature; policy bundles, the resolution table and the anchor-inclusion vectors are not Trust Records and are marked n/a. Checked 2026-10-08 against trace-tests and trace-spec main: all as expected.

To regenerate the fixtures, use Python 3.11 or later with `pip install agentrust-trace==0.11.0` and run `python gen_fixtures.py` in `fixtures/`. The key is derived from a fixed public phrase and is a test key only.

## Registered producers (2026-10-09)

A pinned record whose key thumbprint is one [agentrust-io/trace-registry](https://github.com/agentrust-io/trace-registry) lists under `producers/` is answered with `registered_producer`: the producer id and the registry file at a fixed commit (`GET /evidence/trace/producers` lists them; `TRACE_PRODUCERS` in the module, checked against the copied files in `../trace-bind-v0/sources`). It narrows "the key the record carries" to "the key the TRACE registry published as this producer's". It does not make a claim inside the record true, does not rule out a stolen key, and says nothing against a key that is not listed.

The join from a pinned record to a NENRIN or MUSUBI record is [trace-bind-v0](../trace-bind-v0).
