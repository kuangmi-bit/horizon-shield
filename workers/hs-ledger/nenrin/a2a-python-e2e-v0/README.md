# a2a-python-e2e-v0

One A2A task, run end to end with the official A2A Python SDK, turned into NENRIN evidence, and recomputed offline by two verifiers in two languages that have to return the same report.

```
caller (SDK client) --grant in message metadata--> provider (SDK server: DefaultRequestHandler, JSON-RPC, A2A 1.0)
                                                      checks the grant, signs an intent, does the work,
                                                      signs a receipt pointing at the artifact it served
witness (its own SDK client) --GetTask--> recomputes the skill from the task history, compares artifact and receipt,
                                           signs one observation of the hop caller -> provider (pass or fail)

bundle {grant, intent, receipt, observation}  +  transcript (the GetTask response the witness saw)
        |                                                   |
        +--> nenrin-verify (Python, PyPI)  ----\            |  evidence lookup: the receipt's evidence ref must be
        +--> nenrin_verify.mjs (npm)       ----+-- same report sha256      the sha256 of the artifact text served
```

## Run

```
pip install "a2a-sdk[http-server]==1.2.1" nenrin-verify==0.4.8 uvicorn
python e2e.py --check     # the committed fixtures, verified by both verifiers; no server, no network
python e2e.py             # run both cases live on 127.0.0.1 and verify what they produce
```

`verify_js.mjs` loads `../sdk/nenrin_verify.mjs` (the file published as npm `nenrin-verify`); set `NENRIN_VERIFY_MJS` to use another copy. The bundles also verify with the plain CLIs, without the lookup:

```
nenrin-verify fixtures/honest.bundle.json        # Python
npx nenrin-verify fixtures/honest.bundle.json    # JavaScript, byte-identical output
```

## The two cases

| case | what happens | with the evidence lookup | without it (plain CLI) |
|---|---|---|---|
| honest | the receipt points at what the provider served | accepted, no findings | accepted, `evidence_bound_unchecked` |
| lying_provider | the provider serves the right artifact and signs a receipt claiming another result; the witness signs `fail` | refused, `evidence_invalid` | accepted, `evidence_bound_unchecked`, and `layers.delegation.hop_verdicts` shows the witness's `fail` |

The last cell is the point of the example, not a gap in it. A receipt is a validly signed claim, so a verifier that does not resolve the evidence accepts it as a claim and says so (`evidence_bound_unchecked`). The witness's disagreement is recorded, not turned into a decision. The lie is refused only when the reader resolves the evidence against what was served, which the lookup does from the transcript. NENRIN records evidence and surfaced conflicts; it makes no allow or deny decision.

Each check also verifies the bundle without the lookup and four tampered copies (receipt status, grant provider, intent time, witness verdict) with both verifiers: they must agree, and every tampered copy must be refused. A live run also sends the provider four messages it must refuse before acting: no grant, a grant for other input, a grant signed by someone other than its caller, and a grant naming another provider.

## What this is and is not

- The producer side (`nenrin_records.py`) is written in Python from the record spec and imports nothing from the verifiers, so a mistake there is a refusal, not a silent pass.
- The Python verifier is a line-by-line port of the JavaScript one by the same author. Two languages agreeing on these bundles is not a second, independent implementation. That is what [interop-v0](../interop-v0/INTEROP.md) asks for: any author, any language, the five verdict signatures in `expected.json`.
- Test keys are derived from a public phrase in `nenrin_records.py`. They sign nothing but these examples.
- The fixtures were produced by a live run on 127.0.0.1; task ids and timestamps are from that run. `--freeze` writes new fixtures.
