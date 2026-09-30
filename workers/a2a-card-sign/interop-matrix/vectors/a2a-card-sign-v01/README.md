# `a2a-card-sign-v01`: Agent Card signature vectors

Layer **C** of the Agent Card canonicalization corpus: which **signatures** a verifier accepts.

| layer | corpus | question |
|---|---|---|
| A | `a2a-jcs-v01` (a2aproject/a2a-tck#228) | RFC 8785 canonicalization and the `signatures` exclusion |
| B | `a2a-jcs-rule1-v01` (a2aproject/a2a-tck#245) | section 8.4.1 rule 1 on bytes, one expectation per resolution |
| C | `a2a-card-sign-v01` (this) | given a signed card, accept or reject |

Layers A and B pin bytes. A card in the wild arrives with a signature, and the verifier has to decide which bytes
that signature covers. This corpus pins that decision.

## Readings

The bytes a card signature covers are read in three ways today:

| reading | what it does | matches |
|---|---|---|
| `rule-1-as-written` | Section 8.4.1 rule 1 on the card as served: a REQUIRED field (proto annotation) stays even at its default value, a field with the `optional` keyword stays when set, any other field at its default value is dropped. Then RFC 8785. | the section's own worked example, which keeps `description: ""` and `skills: []` and omits `extensions: []` |
| `prune-empty` | Empty strings, arrays and objects removed recursively, REQUIRED or not. Then RFC 8785. | a2a-sdk 1.2.1, @a2a-js/sdk 1.3.0 |
| `served-as-is` | The served JSON with `signatures` removed, nothing else. Then RFC 8785. | a2a-go a2acrypto at main 534a60fc |

The generator refuses to write a vector unless `prune-empty` equals the a2a-python and @a2a-js/sdk canonical bytes
and `served-as-is` equals a2a-go's, case by case, so the second and third rows describe the SDKs, not a guess about
them.

Every card here carries every REQUIRED field of `AgentCard`. Layer B's open point (a REQUIRED field absent from the
input) therefore does not arise, and on these inputs its `presence-preserving` and `inject-required-defaults`
resolutions both give the `rule-1-as-written` bytes.

## Groups

`s0-control`: one card with no field at its default value, so all three readings give the same bytes.

| id | signer | disposition |
|---|---|---|
| S0-001 | reference | MUST-ACCEPT under every reading |
| S0-002 | a2a-sdk 1.2.1 | MUST-ACCEPT under every reading |
| S0-003 | @a2a-js/sdk 1.3.0 | MUST-ACCEPT under every reading |
| S0-004 | a2a-go main 534a60fc | MUST-ACCEPT under every reading |
| S0-REJECT-005 | reference, card edited after signing | MUST-REJECT under every reading |

These hold whichever way a2aproject/A2A#2122 is settled.

`s1-default-valued`: the control card with one field at its default value. Each case is a pair of vectors, one
signature per distinct canonical form. Under any one reading exactly one vector of the pair is accepted.

| case | vector | accepted under |
|---|---|---|
| `description = ""` (REQUIRED) | S1-001 | rule-1-as-written, served-as-is |
| | S1-002 | prune-empty |
| `skills = []` (REQUIRED) | S1-003 | rule-1-as-written, served-as-is |
| | S1-004 | prune-empty |
| `skills[0].tags = []` (REQUIRED on AgentSkill) | S1-005 | rule-1-as-written, served-as-is |
| | S1-006 | prune-empty |
| `capabilities.extensions = []` (not REQUIRED) | S1-007 | rule-1-as-written, prune-empty |
| | S1-008 | served-as-is |

A nested empty value (`securityRequirements: [{}]`) is left out on purpose: whether an element that becomes empty
collapses is itself part of the #2122 question, and a vector would have to assume the answer.

## Observed on 2026-10-01

Not part of the expectations; recorded in `MANIFEST.json` under `observed`. Each SDK's own verifier on each served card:

| vector | a2a-python | a2a-js | a2a-go |
|---|---|---|---|
| S0-001 to S0-004 | accept | accept | accept |
| S0-REJECT-005 | reject | reject | reject |
| S1-001, S1-003, S1-005 | reject | reject | accept |
| S1-002, S1-004, S1-006 | accept | accept | reject |
| S1-007 | accept | accept | reject |
| S1-008 | reject | reject | accept |

The observed column follows directly from the readings table: each SDK accepts the vectors tagged with its own
reading.

## Key and reproduction

`testkey_jwks.json` holds the public half of a published test key (kid `hs-interop-test-v1`, ES256). The `jku` in
every protected header is an `example.com` placeholder: never fetch it, resolve the key from `testkey_jwks.json` by
`kid`. The private
key is derived from a public phrase given in `MANIFEST.json`, so anyone can re-create it. Reference signatures use
RFC 6979 deterministic ECDSA, so re-running the generator reproduces every reference vector byte for byte; S0-002 to
S0-004 are kept as the SDKs produced them. The key signs test vectors only and is nobody's production key.

Canonical bytes were produced by two independent RFC 8785 implementations, which agree exactly:

- `rfc8785` (PyPI, 0.1.4)
- `gowebpki/jcs` (Go, v1.0.1)

Spec text: a2aproject/A2A `specification/specification.md` at `173695755607` (v1.0.0). REQUIRED set: the
`field_behavior` annotations of `a2a.proto` (details in `MANIFEST.json` under `spec_provenance`).

Generator: `workers/a2a-card-sign/interop-matrix/vectors.py` in ogasurfproject-jpg/horizon-shield, with
`vectors_check.mjs` beside it, an independent WebCrypto check of every hash and signature.

No file here overlaps `a2a-jcs-v01` or `a2a-jcs-rule1-v01`, and nothing depends on the order in which the three
corpora are merged.
