# nenrin-verify (Python)

Recompute NENRIN evidence yourself, offline, in your own Python process. The Python twin of the npm package
[`nenrin-verify`](https://www.npmjs.com/package/nenrin-verify): same input, same report (the two limits are listed
under "Where the claim stops").

    pip install nenrin-verify
    nenrin-verify --selftest          # 31/31 frozen bundles give the same report as npm nenrin-verify
    nenrin-verify bundle.json         # the provenance report; exit 0 accepted, 1 refused

```python
import json, nenrin_verify as nv

bundle = nv.js_loads(open("bundle.json", "rb").read())   # parsed the way JSON.parse parses it
report = nv.verify_bundle(bundle)             # did:key resolution, no network, no clock
print(report["verdict"], report["does_not_establish"])
print(nv.report_json(report))                 # JSON text as the JavaScript CLI prints it (not json.dumps)
print(nv.report_sha256(report))               # compare with the JavaScript run, byte for byte
```

One dependency, `cryptography`, for Ed25519. Nothing here opens a socket.

## What it verifies

| module | what | held to |
|---|---|---|
| `verify_provenance`, `consume_evidence`, `posture_line`, `candidate_evidence_set`, `preflight_report` | one A2A task's provenance graph: the delegation chain observed by third-party witnesses (R1 to R4, witness and edge signatures), the caller's grant and the provider's execution receipt (E1 to E3, caller and provider signatures), the provider's pre-execution intent, the outcome's evidence pointer, and the digest link between the layers | npm nenrin-verify 0.2.3 (`nenrin_verify.mjs`, verifier 0.1.3): the same report, key for key |
| `agreement_verify.verify`, `nenrin-agreement-verify` | a two-party agreement record (`a2a-agreement-v1`, `v1.1`), including key succession across a rotation | the repository's own Python verifier, unchanged but for one import line and a header comment; it and the JavaScript verifier return the same report on 5,286 frozen cases |

## How "same report" is checked

The JavaScript file is the reference. The port reads it line for line, and every place where Python and
JavaScript disagree by default (`x or y` on `{}`, `==` on `True` and `1`, `Date.parse` accepting February 31st,
Node's lenient base64, an own `__proto__` key that Object.assign turns into a prototype, the order V8's sort
gives values a numeric comparator cannot order) goes through one file,
`src/nenrin_verify/_js.py`, so the differences can be read in one place.

- **Frozen.** 31 bundles signed with keys derived from a public phrase, covering accepted graphs, refusals of every
  layer, witness disagreement, provider equivocation, action bindings, non-ASCII and escapes, and the date edge
  cases. For each, the report, the `consume_evidence` projection and the CLI output are byte-identical to the
  JavaScript's. They ship in the package; `nenrin-verify --selftest` re-runs them on your machine.
- **Live.** Every path of every frozen bundle is broken in about twenty ways (deleted, nulled, retyped, shortened,
  reordered, timestamps and sequence numbers bent, own `__proto__` keys added, the whole bundle replaced by an
  array or null), 27,062 inputs in all. Each is run through the JavaScript verifier and through this port. Pass
  means both threw, or both returned the same report and projection. 0 differ.
- **Semantics.** The helpers in `_js.py` against Node directly: number text, Date.parse, Buffer base64, string
  escaping and mixed-type sorting, several thousand random values each.
- **Agreement.** The packaged agreement verifier returns every one of the 5,286 frozen reports in
  `agreement-v0/agreement_vectors_v1.json`, the file the JavaScript verifier is scored against.
- **Unchanged.** `VENDORED.json` pins the sha256 of the agreement files and their sources; a copy that drifts fails.

`report_sha256(report)` is the sha256 of the report with keys sorted by UTF-16 code unit at every depth, no
whitespace, strings and numbers as JSON.stringify writes them. The JavaScript side of the same hash is
`tests/parity/js_canon.mjs` (twelve lines).

## Where the claim stops

- **Stack depth.** A document nested deep enough to exhaust a runtime's stack has no report in that runtime, and
  Node and Python run out at different depths (Node threw at 3,000 nested arrays inside a signed field, Python's
  default limit is 1,000). Real bundles are a few levels deep.
- **Sixty-four or more non-numeric `hop.seq` values in one bundle.** The order of those keys is V8's merge sort over
  a comparator that cannot order them; the port reproduces V8 for up to 63 keys and raises above that instead of
  guessing.
- Where the JavaScript throws, the port raises; the CLI then prints no report and exits 2 (Node exits 1 on an
  uncaught throw).

## What it does not establish

What every report says itself, accepted or refused: a signature proves who asserted, not that the assertion is
true; E1 compares a provider's signed claim to a caller's signed authorization and has no side-effect oracle;
R1 proves a witness is structurally distinct from the parties, not unaffiliated with them. There is no score and
no allow or deny anywhere in this package. The decision belongs to whoever reads the evidence.

Not in this release: the TSUGI recovery-chain verifier (`tsugi_verify.mjs`) and the MUSUBI contract spine. Each
comes in when it can carry the same guarantee as the two verifiers above: the same report as its JavaScript twin,
checked case by case.

## Reproduce

    cd workers/hs-ledger/nenrin/sdk-python
    pip install -e . pytest
    node tests/fixtures/make_fixtures.mjs --check   # the frozen fixtures re-create byte for byte
    python tools/vendor.py --check                  # the agreement copies are their sources
    pytest tests -q -s                              # frozen, live differential, agreement

Published from GitHub Actions with PyPI Trusted Publishing and attestations
(`.github/workflows/pypi-publish-nenrin-verify.yml`); the parity suite runs on every change to this directory,
to the JavaScript SDK and to the agreement verifier (`.github/workflows/nenrin-verify-py.yml`).

MIT. The HORIZONs Co., Ltd.
