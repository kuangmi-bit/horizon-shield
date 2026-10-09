# trace-intake-v0

What the NENRIN ledger's TRACE intake (`POST /evidence/trace`, [trace-pin-v0](../trace-pin-v0)) does with each TRACE Trust Record among the conformance vectors of [agentrust-io/trace-spec](https://github.com/agentrust-io/trace-spec) (`conformance/tests/vectors`), as a TSUNAGI corpus. 28 cases: the four canonicalization records, the two signed records, the six invalid records, the five valid records without an embedded signature or in an envelope, and the eleven policy-resolution records. The policy bundles, the resolution table and the anchor-inclusion vectors are not Trust Records and are not cases.

A case is `{"now": <seconds>, "vector": <the vector file's exact text>}`. The rule is section 2 of [../trace-bind-v0/SPEC.md](../trace-bind-v0/SPEC.md).

    git clone https://github.com/agentrust-io/trace-spec /tmp/trace-spec
    node build_corpus.mjs /tmp/trace-spec --check     # exit 1 when a vector changed upstream

`SOURCE.json` names the trace-spec commit and the sha256 of every vector file used. The vectors are Apache-2.0; see NOTICE.
