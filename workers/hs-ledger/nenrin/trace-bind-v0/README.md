# nenrin-trace-bind-v0

Join a TRACE Trust Record to a NENRIN or MUSUBI record, signed by the party whose act it is, and check it offline in JavaScript, Python or Go.

TRACE ([agentrust-io/trace-spec](https://github.com/agentrust-io/trace-spec)) answers what ran, where and under which policy. NENRIN and MUSUBI answer what was done, under which grant, and when, anchored to Bitcoin. A bind record names one of each by sha256 and says the act was performed under that attestation. The normative text is [SPEC.md](SPEC.md).

## Check one

    npx -p nenrin-verify nenrin-trace-verify bind bundle.json          # {"bind","trace","record","policy"}
    pip install nenrin-verify && nenrin-trace-verify bind bundle.json
    go run ./cmd/nenrin-verify-go --trace-batch bind in.json out.json  # in sdk-go

Make one (the binder's key is a 32 byte Ed25519 seed in `{"private_key_ed25519_b64": ...}`):

    npx -p nenrin-verify nenrin-trace-verify sign-bind --record exec.json --trace trace.json --acted-at 1790000000 --key key.json

Put its identifiers on the agent's OpenTelemetry span: `annotateSpan(span, bind)` (JavaScript) or `annotate_span(span, bind)` (Python). Check an exported span against the bind: `nenrin-trace-verify span attrs.json bundle.json`.

## The corpora

| corpus | cases | what |
|---|---|---|
| [trace-intake-v0](../trace-intake-v0) | 28 | every TRACE Trust Record among the trace-spec conformance vectors, and what the ledger's intake does with it |
| [trace-bind-v0](.) | 28 | bind bundles over real TRACE records (Bernstein 3.20.0 and the summit demo from trace-registry, and records signed by agentrust-trace 0.11.0) |
| [trace-span-v0](../trace-span-v0) | 16 | exported span attributes against bind bundles |

All three are refereed by the TSUNAGI board every night (`ops/tsunagi/BOARD.md`) for the JavaScript reference, the Python port and the Go port, and trace-intake-v0 also for the ledger's production intake module. Every expectation is written by hand from SPEC.md in the generators (`gen_fixtures.mjs`, `../trace-intake-v0/build_corpus.mjs`, `../trace-span-v0/gen_fixtures.mjs`), not copied from a verifier's output.

How the three languages are held together, measured 2026-10-09: each corpus 28/28, 28/28 and 16/16 in all three; 8,640 mutated bundles run through all three with 0 differences in verdict signature; 13 deliberate mutants of the reference (skip the bind signature, drop the context line, sort keys by code point, accept a ninth member, trust the stated thumbprint, an off-by-one in the age, and others), each caught by at least one case.

## Where it stops

Written by the same author in three languages; not an independent implementation. The Ed25519 edge points on which OpenSSL and Go's `crypto/ed25519` can disagree are not in the corpora (TRACE keys are honest keys); a disagreement there would show as a TSUNAGI difference. What a bound verdict does not establish is in SPEC.md section 5, and the reason the link is a record of its own rather than a field in an execution record is in section 6.

## Sources and licences

`sources/` holds files copied from [agentrust-io/trace-registry](https://github.com/agentrust-io/trace-registry) at commit `58850e9d0f7113be2a4c89b3c2e7b03447f2dcce`: the producer key files under `producers/` and two submitted records from `staging/processed/`. Registry data is licensed CC BY 4.0 by its authors; the files are unchanged. The NENRIN record is MUSUBI's first settled execution record, `../musubi-v0/run0002/exec_19c44a79.json`.
