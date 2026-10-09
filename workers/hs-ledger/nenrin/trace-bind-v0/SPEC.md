# nenrin-trace-bind-v0

Two procedures over a TRACE Trust Record ([agentrust-io/trace-spec](https://github.com/agentrust-io/trace-spec) v0.2), each returning a verdict signature `{verdict, refusals, findings}` the way TSUNAGI compares them (codes as sets).

1. **Intake.** Is this TRACE record one the NENRIN ledger pins? The same rule as `POST /evidence/trace` ([trace-pin-v0](../trace-pin-v0/)).
2. **Bind.** Does a signed link say, in a way anyone can recompute, that one NENRIN record (an execution record, a walk, a settlement) was performed under the runtime one TRACE record attests, and is the TRACE key one the relying party pinned?

TRACE answers what ran, where and under which policy. NENRIN and MUSUBI answer what was done, under which grant, and when (Bitcoin). The bind record is the join: it is signed by the party whose act it is, it names both records by sha256, and it holds no claim of its own beyond "this act was performed under that attestation".

The reference is `sdk/trace_verify.mjs` (npm `nenrin-verify`). The Python port is `nenrin_verify/trace.py`, the Go port `sdk-go/nenrinverify/trace.go`. The corpora are `../trace-intake-v0` and `../trace-bind-v0`.

## 1. Values and the canonical form

Inputs are read as JSON is read by `JSON.parse`: every number is an IEEE 754 double, duplicate member names keep the last value, a string may hold a lone UTF-16 surrogate.

`JCS(v)` is RFC 8785, with refusals instead of guesses. It walks `v` depth first. At each object the member names are sorted by UTF-16 code unit, and for each name in that order the name is checked, then its value. The first problem met ends the walk with its code:

| code | when |
|---|---|
| `too_deep` | nesting deeper than 64 below the root |
| `non_finite_number` | a number that is not finite (a literal like `1e400` parses to Infinity) |
| `unsafe_integer` | an integer-valued number whose magnitude exceeds 2^53 - 1 (the parser has already rounded it) |
| `lone_surrogate` | a string or member name holding an unpaired surrogate |

Numbers are written as ECMAScript `Number::toString`; strings as `JSON.stringify` writes them.

`sha(v)` is the lowercase hex sha256 of the UTF-8 bytes of `JCS(v)`.

## 2. Intake

Input: `{"now": <integer seconds>, "vector": <value>}`. The record `R` is `vector.record` when `vector` is an object whose own `record` member is an object (the wrapped form the TRACE conformance vectors use), otherwise `vector` itself.

The checks run in this order; the first that fails is the only refusal.

1. `record_not_object`: `R` is not an object.
2. `JCS(R)` (section 1).
3. `too_large`: `JCS(R)` is more than 65536 UTF-8 bytes.
4. `enveloped_form`: `R` has `cmcp_version` and `trace` and no `eat_profile` (a cMCP RuntimeClaim; the outer signature is the gateway's).
5. `superseded_profile`: `eat_profile` is `tag:agentrust.io,2026:trace-v0.1`. `unsupported_profile`: `eat_profile` is absent, or is any other value but `tag:agentrust-io.com,2026:trace-v0.2`. A record that names no profile is not identified as TRACE v0.2, and the member list in step 6 is the v0.2 list, so this check comes first.
6. `missing_required`: one of `iat subject model runtime policy data_class build_provenance appraisal cnf` is absent. (`eat_profile` is also required by TRACE v0.2; its absence is decided at step 5.)
7. `bad_iat`: `iat` is not an integer-valued number, or is below 1700000000.
8. `bad_subject`: `subject` is not a non-empty string.
9. `no_embedded_signature`: no `signature` member.
10. `bad_base64url` / `bad_signature_length`: `signature` is not canonical unpadded base64url (RFC 4648 section 5, unused bits zero), or does not decode to 64 bytes.
11. `no_confirmation_key`: `cnf` or `cnf.jwk` is not an object. `unsupported_key_type`: `cnf.jwk.kty` is not `OKP` or `crv` is not `Ed25519`. `bad_base64url` / `bad_key_length`: `cnf.jwk.x` is not canonical base64url of 32 bytes.
12. `signature_invalid`: Ed25519 does not verify the signature under `cnf.jwk.x` over the UTF-8 bytes of `JCS(R without signature)`.
13. `iat_in_future`: `iat > now + 300`.

Verdict: `pinnable` with no refusals, or `refused` with the one code. Findings are always empty in v0.

Step 5 read "any other value" until 2026-10-09, which left a record with no `eat_profile` open to two readings (`unsupported_profile` at step 5, or `missing_required` at step 6, which listed `eat_profile`). luiksksk's clean-room verifier, written from this section alone, took the second; the reference, the ledger and the ports took the first. The text now says the first, and `trace-intake-v0` has the two cases (`local__no_eat_profile`, `local__no_eat_profile_no_runtime`). Found by luiksksk ([horizon-shield#38](https://github.com/ogasurfproject-jpg/horizon-shield/pull/38)).

When pinnable, the record's pin identity is `sha(R)` (the signature member included) and its key is named by the RFC 7638 thumbprint of `cnf.jwk`: base64url, unpadded, of sha256 over `{"crv":<crv>,"kty":<kty>,"x":<x>}` written in that order with no whitespace.

## 3. The bind record

```json
{
  "schema": "nenrin-trace-bind-v0",
  "relation": "performed_under",
  "record_sha256": "<sha of the NENRIN record>",
  "trace_sha256": "<sha of the TRACE record, signature included: its pin identity>",
  "trace_key_thumbprint": "<RFC 7638 thumbprint of the TRACE cnf.jwk>",
  "acted_at": 1790000000,
  "binder_public_key_ed25519_b64": "<32 byte Ed25519 key, standard base64 with padding>",
  "sig_b64": "<64 byte Ed25519 signature, standard base64 with padding>"
}
```

Exactly these eight members. `acted_at` is the binder's statement of when the act happened, integer seconds. The key and signature use the spelling MUSUBI records use (`public_key_ed25519_b64`, `sig_b64`), so the binder can be the contractor whose key a signed contract already pins.

The signature is Ed25519 over the UTF-8 bytes of `"nenrin-trace-bind-v0\n" + JCS(bind without sig_b64)`. The context line keeps a bind signature from being replayed as any other NENRIN or MUSUBI signature.

## 4. Bind

Input: `{"bind": <object>, "trace": <object>, "record": <object>, "policy": <object>}`. A bundle without four objects is an input error, not a verdict.

`policy` is the relying party's, not the binder's:

```json
{
  "binder_keys": ["<standard base64 Ed25519 key>", "..."],
  "trace_key_thumbprints": ["<RFC 7638 thumbprint>", "..."],
  "max_age_seconds": 86400
}
```

`max_age_seconds` is optional (default 86400, TRACE 3.2.2's default record age) and when present is an integer from 0 to 31536000.

Stage A, the first failure is the only refusal:

1. `JCS(bind)`, then `JCS(trace)`, then `JCS(record)` (section 1): the code of the first problem.
2. `policy_malformed`: `binder_keys` or `trace_key_thumbprints` is not an array of strings, or `max_age_seconds` is present and not an integer in range.
3. `bind_schema`: `bind.schema` is not `nenrin-trace-bind-v0`.
4. `bind_malformed`: the members are not exactly the eight above; or `relation` is not `performed_under`; or `record_sha256` or `trace_sha256` is not 64 lowercase hex; or `trace_key_thumbprint` is not 43 characters of base64url; or `acted_at` is not an integer-valued number from 1700000000 to 2^53 - 1; or `binder_public_key_ed25519_b64` is not canonical padded standard base64 of 32 bytes; or `sig_b64` is not canonical padded standard base64 of 64 bytes.

Stage B, every check runs and every failure is listed:

5. `bind_signature_invalid`: the bind signature does not verify (section 3).
6. `binder_not_pinned`: `binder_public_key_ed25519_b64` is not in `policy.binder_keys` (exact string).
7. `record_sha_mismatch`: `sha(record) != record_sha256`.
8. `trace_sha_mismatch`: `sha(trace) != trace_sha256`.
9. `trace:<code>`: intake (section 2) of `trace` with `now = acted_at` refuses with `<code>`. So a TRACE record issued more than 300 seconds after the act is `trace:iat_in_future`. When this fires, 10 to 12 are not run.
10. `trace_key_thumbprint_mismatch`: the thumbprint of `trace.cnf.jwk` is not `bind.trace_key_thumbprint`.
11. `trace_key_not_pinned`: the thumbprint of `trace.cnf.jwk` is not in `policy.trace_key_thumbprints`.
12. `trace_stale_at_act`: `acted_at - trace.iat > max_age_seconds`.

Verdict: `bound` when no refusal is listed, otherwise `not_bound`. Findings are always `acted_at_is_stated` and `trace_claims_not_appraised`, because both are true of every bind.

## 5. What a bound verdict establishes, and what it does not

Establishes:

- The holder of the binder key signed a statement that the act recorded in exactly these record bytes was performed under the runtime attested by exactly these TRACE bytes, at the time it states.
- The TRACE record's own signature verifies under its confirmation key, that key is one the relying party pinned, and the record was issued no later than 300 seconds after the stated act and no earlier than the policy's maximum age before it.

Does not establish:

- That any claim inside the TRACE record is true (model, measurement, policy, data class, tools). Appraising them is the relying party's work, as TRACE itself says of its signature.
- That `acted_at` is true. Bound it from outside: once the NENRIN record and the TRACE record are each anchored, their Bitcoin blocks bound when they existed. The bind does not do that for you.
- That the binder is who the record says acted. Pin the binder key from a source you trust, for example the contractor key in a signed MUSUBI contract.
- That the key named by a pinned thumbprint belongs to the subject. Pinning a thumbprint is the relying party's decision; the TRACE registry's `producers/` list is one public source for it.
- Revocation of either key.

## 6. Why the link is a separate record

MUSUBI's settle layers refuse a record that carries a member they do not read (`nonconforming_record` since settle v1.3, `grant_key_unknown` for grants). That is deliberate: a field no verifier reads is a field some reader can be made to trust. So a TRACE reference cannot be written into an `a2a-execution-v0` record today without every existing settle charging it. The bind record carries the link beside the record instead, by sha, and leaves every published settle layer unchanged. A later settle layer may read binds by name.

## 7. OpenTelemetry

An agent that already emits OpenTelemetry GenAI spans (`gen_ai.operation.name` `execute_tool` for one tool call, `invoke_agent` for one agent run; the GenAI conventions are at Development stability) can put the bind's identifiers on the span for the act, so the trace in its own backend names records anyone can recompute:

| attribute | value |
|---|---|
| `nenrin.otel.schema` | `nenrin-otel-v0` |
| `nenrin.bind.sha256` | `sha(bind)` |
| `nenrin.record.sha256` | `bind.record_sha256` |
| `nenrin.trace.sha256` | `bind.trace_sha256` |
| `nenrin.trace.key_thumbprint` | `bind.trace_key_thumbprint` |
| `nenrin.trace.url` | `<ledger>/evidence/trace/<trace_sha256>`, a convenience link, not compared |

The attributes live under their own `nenrin.` namespace and add nothing to the `gen_ai.` ones.

Span check. Input `{"span": <attributes as exported>, "bind_bundle": <a bind bundle>}`. Run section 4 on the bundle; then for each of the five identifiers above (the url is not one), add `span_attribute_mismatch:<attribute>` when the exported value is not a string, or the bind does not carry that identifier as a string, or the two differ. When `JCS(bind)` refuses, every identifier mismatches. Verdict `span_bound` when nothing is listed, otherwise `span_not_bound`; findings are the bind's.

A `span_bound` verdict establishes that the exported span names exactly the records of a bind that is bound for this relying party. It does not establish that the span describes the act truthfully (the agent writes its own spans), or that the span was not copied onto another trace.
