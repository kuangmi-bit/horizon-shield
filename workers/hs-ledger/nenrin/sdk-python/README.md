# nenrin-verify (Python)

Recompute NENRIN evidence yourself, offline, in your own Python process. The Python twin of the npm package
[`nenrin-verify`](https://www.npmjs.com/package/nenrin-verify) and of the TSUGI recovery-chain verifier
`tsugi_verify.mjs`: same input, same report (the limits are listed under "Where the claim stops"). It also carries
the MUSUBI contract verifier, which is written in Python, byte for byte.

    pip install nenrin-verify
    nenrin-verify --selftest          # 31/31 frozen bundles and 98/98 TSUGI chains match the JavaScript; MUSUBI run0002 recomputes
    nenrin-verify bundle.json         # the provenance report; exit 0 accepted, 1 refused
    tsugi-verify chain.json --operator-key <b64>   # a TSUGI recovery chain, printed as node tsugi_verify.mjs prints it
    musubi-verify contract_v0 --verify contract.json   # a MUSUBI module, run exactly as python3 contract_v0.py in the repository

```python
import json, nenrin_verify as nv

bundle = nv.js_loads(open("bundle.json", "rb").read())   # parsed the way JSON.parse parses it
report = nv.verify_bundle(bundle)             # did:key resolution, no network, no clock
print(report["verdict"], report["does_not_establish"])
print(nv.report_json(report))                 # JSON text as the JavaScript CLI prints it (not json.dumps)
print(nv.report_sha256(report))               # compare with the JavaScript run, byte for byte
```

One dependency, `cryptography`, for Ed25519. Nothing here opens a socket, except `tsugi-verify --fetch-operator-key
<origin>`, which fetches the operator key from the origin you name.

## What it verifies

| module | what | held to |
|---|---|---|
| `verify_provenance`, `consume_evidence`, `posture_line`, `candidate_evidence_set`, `preflight_report` | one A2A task's provenance graph: the delegation chain observed by third-party witnesses (R1 to R4, witness and edge signatures), the caller's grant and the provider's execution receipt (E1 to E3, caller and provider signatures), the provider's pre-execution intent, the outcome's evidence pointer, and the digest link between the layers | npm nenrin-verify 0.3.0 (`nenrin_verify.mjs`, verifier 0.1.3; the same file as in 0.2.3): the same report, key for key |
| `agreement_verify.verify`, `nenrin-agreement-verify` | a two-party agreement record (`a2a-agreement-v1`, `v1.1`), including key succession across a rotation | the repository's own Python verifier, unchanged but for one import line and a header comment; it and the JavaScript verifier return the same report on 5,286 frozen cases, and from npm nenrin-verify 0.3.0 the JavaScript command `nenrin-agreement-verify` prints what this one prints |
| `musubi.load`, `musubi-verify` | MUSUBI (a2a-contract-v0): a contract both parties signed, its settlement against anchored execution records (settle v1 to v1.7), offers, bonds, corrections, terms, independence, corroboration, and the spine that threads one contract through all of them | the repository's own files (`musubi-v0/`), byte for byte: MUSUBI is written in Python and has no JavaScript twin, so the guarantee is that installing changes nothing, each of its 18 modules passes its own self-test from the package, and the first settled execution (run0002) recomputes to its published hashes |
| `tsugi.verify_chain`, `tsugi-verify` | a TSUGI recovery chain (drift, proposal, authorization, execution, verify): every record's schema, hash and Ed25519 signature, order and links, strict mode (a human-approval repair needs an authorization signed by a trusted operator key, unexpired), the random witness draw recomputed from beacon, pool and subject, the commit-then-reveal anchor, the embedded witness observations and the quorum | `tsugi_verify.mjs` (verifier 0.3.0): the same stdout, byte for byte, and the same exit code |

## How "same report" is checked

The JavaScript file is the reference. The port reads it line for line, and every place where Python and
JavaScript disagree by default (`x or y` on `{}`, `==` on `True` and `1`, `Date.parse` accepting February 31st,
Node's lenient base64, an own `__proto__` key that Object.assign turns into a prototype, the order V8's sort
gives values a numeric comparator cannot order, `new URL(s).host`) goes through `src/nenrin_verify/_js.py` and
`src/nenrin_verify/_url.py`, so the differences can be read in one place.

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
- **MUSUBI, byte for byte.** The 18 modules of `musubi-v0/` and the data their self-tests read sit in
  `src/nenrin_verify/_repo/musubi-v0/`, beside a byte-identical `agreement-v0/`, the layout each module expects; no
  line is edited, and `VENDORED.json` pins each to its source (the same sha256 twice). Byte identity matters beyond
  the proof: `correction_v0` fingerprints its own code files, so a correction bundle built from the repository
  verifies here only if the files are the same bytes. From the installed wheel, every module's own self-test
  passes (`musubi-verify --selftest`, 18/18) and run0002 recomputes to `b13a3869...` and `11c27fcf...`
  (`musubi-verify --run0002`). Not shipped: `gen_anchor_compose_fixture.py` (needs `opentimestamps`, regenerates a
  fixture) and `header_view_fetch.py` (fetches block headers over the network).
- **TSUGI, frozen.** 98 cases: the repository's three real chains (incident 2 with the real operator signature,
  12 records; the 7-record incident of the same week; that incident re-verified by a random draw of witnesses),
  under the command lines that matter, and edits of them that reach every one of the 69 refusal codes
  `tsugi_verify.mjs` has, plus the five inputs on which the JavaScript itself throws. Edited chains are re-sealed so
  an edit meets the rule it targets, not only a hash mismatch. For each, `node tsugi_verify.mjs` was run and its
  stdout and exit code frozen; they ship in the package and `nenrin-verify --selftest` re-runs them.
- **TSUGI, live.** Every path of the real chains and of the witness pool is edited in about twenty ways, raw and
  re-sealed: 29,326 inputs with the frozen cases. Each is run through `tsugi_verify.mjs` and through this port.
  0 differ; 3 edits put a non-ASCII host in an endpoint, and there the port raises `NotReproduced` instead of
  answering (see below).
- **TSUGI semantics.** `new URL(s).host`, `toLowerCase`, `Buffer.from` on any JSON value and string conversion of
  any JSON value, against Node directly, several thousand inputs each.

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
- **TSUGI: hosts that need UTS #46.** The verifier compares and prints URL hosts as WHATWG `new URL(s).host` gives
  them. The port follows the standard for ASCII hosts, IPv4 in every form the standard reads, ports and userinfo,
  and raises `NotReproduced` (no report, exit 2) for a host that is not ASCII after percent-decoding or has an
  `xn--` label, an IPv6 literal, or a `file:` URL. Lowercasing a code point this Python's Unicode tables do not
  assign raises the same way (Node 24 knows Unicode 16; Python 3.9 knows 13).
- **TSUGI: one refusal text depends on the Node release.** For an Ed25519 public key that is not 32 bytes, Node 24
  writes "Invalid keyData" and Node 22 "Ed25519 raw keys must be exactly 32-bytes". The port writes Node 24's
  (`tsugi.KEY_LENGTH_MESSAGE`); the tests compare Node 22's output after that one substitution.
- **TSUGI: `--fetch-operator-key`** makes the same request as the JavaScript (GET `<origin>/keys/operator.json`,
  404 read as no key) but is not part of the comparison, which runs offline.

## What it does not establish

What every report says itself, accepted or refused: a signature proves who asserted, not that the assertion is
true; E1 compares a provider's signed claim to a caller's signed authorization and has no side-effect oracle;
R1 proves a witness is structurally distinct from the parties, not unaffiliated with them. There is no score and
no allow or deny anywhere in this package. The decision belongs to whoever reads the evidence.

MUSUBI is the one part held to no second implementation, because there is none: its Python is the reference.
`musubi.load(name)` puts the two vendored directories at the front of `sys.path`, since that is how the modules
find each other (by bare name, as in the repository).

## Reproduce

    cd workers/hs-ledger/nenrin/sdk-python
    pip install -e . pytest
    node tests/fixtures/make_fixtures.mjs --check   # the frozen fixtures re-create byte for byte
    python tests/fixtures/make_tsugi_cases.py --check   # the frozen TSUGI cases and their JavaScript output re-create
    python tools/vendor.py --check                  # the agreement and MUSUBI copies are their sources
    pytest tests -q -s                              # frozen, live differential, agreement, TSUGI, MUSUBI

Published from GitHub Actions with PyPI Trusted Publishing and attestations
(`.github/workflows/pypi-publish-nenrin-verify.yml`); the parity suite runs on every change to this directory,
to the JavaScript SDK, to the agreement verifier, to the TSUGI chains and to MUSUBI
(`.github/workflows/nenrin-verify-py.yml`).

MIT. The HORIZONs Co., Ltd.
