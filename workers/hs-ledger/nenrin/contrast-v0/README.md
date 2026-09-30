# nenrin-contrast-v0

Set what an agent's operator attested beside what an outside runner observed, for the same subject, facet by facet.

The attested side is a TRACE v0.2 Trust Record ([agentrust-io/trace-spec](https://github.com/agentrust-io/trace-spec)), the same bytes [trace-pin-v0](../trace-pin-v0/) pins. The observed side is an [a2a-conduct-walk](../a2a-conduct-walk/) record filed by a witness the agent did not choose. The two answer different questions, and most of a TRACE record is out of an outside runner's sight. So the record compares only what both sides can see, and names the rest as not compared instead of guessing.

## Facets

| facet | attested | observed | verdicts |
|---|---|---|---|
| `subject_host` | the host the TRACE `subject` names | the host the witness walked | `did:web`: match or differ. SPIFFE: match when the trust domain is the host or a parent of it, otherwise not_comparable (a trust domain need not be a DNS name). Other DIDs: not_comparable |
| `confirmation_key` | RFC 7638 thumbprint of `cnf.jwk` | thumbprints of every key stated in documents the walk committed to | match, differ, attested_only |
| `time` | `iat` | `walked_at` | match inside the 24 hour window TRACE 3.2.2 gives a record, otherwise differ; `gap_seconds` is kept either way |

Keys are read in the spellings agents use: a JWK anywhere in the document (OKP or EC), a JWS protected header that carries a `jwk` (A2A card `signatures`), the walk tool's key file `{"public_key_ed25519_b64": ...}`, and a DID verification method in Ed25519 multibase.

Not compared, by name: `model`, `runtime`, `policy`, `data_class`, `build_provenance`, `appraisal`, `tool_transcript`. Each carries the reason in the record.

## Rules

1. The TRACE signature must verify under its own `cnf.jwk`. Freshness is not a gate here; it is the `time` facet.
2. Every supporting document must hash to a response `body_sha256` inside the walk. The observed side uses only bytes the witness already committed to, so whoever assembles a contrast adds no trust of their own. A document that matches nothing is refused as `support_not_committed`.
3. The record has no clock. Anyone holding the TRACE record, the walk and the supporting documents rebuilds it byte for byte (`verifyContrast`). Its identity is the sha256 of its RFC 8785 form.
4. `observed.record_sha256` is the sha256 of the walk's RFC 8785 form, which for walk records (strings and integers only) equals `a2a_conduct_walk.py` `canonical()`. Checked against a real walk in the tests.

## What a contrast does not establish

- That either side is telling the truth. A match is two statements agreeing; a difference is two statements disagreeing. Neither says which is right.
- That the key belongs to the subject. A match shows the endpoint published the key the record carries, as served on the day of the walk.
- Anything about the members listed as not compared.
- Whether the walk was signed and under which domain. Read that from the ledger entry of `observed.record_sha256`.
- Who assembled the contrast.

## Use

    node contrast_cli.mjs --trace trace.json --walk walk.json --support card.json
    node contrast_cli.mjs --trace trace.json --walk walk.json --support card.json --verify contrast.json

## Tests

`node nenrin/contrast-v0/contrast_v0.test.mjs` (in `workers/hs-ledger`): 42 checks, 13 of them attacks. The key facet runs against the record TRACE's own library made (trace-pin-v0 fixtures); other subjects are signed in the test over the RFC 8785 body, the way TRACE signs. One real walk (api.babyblueviper.com, 2026-09-22) checks the walk hash against the Python tool. 8 deliberate mutants each fail at least one check.
