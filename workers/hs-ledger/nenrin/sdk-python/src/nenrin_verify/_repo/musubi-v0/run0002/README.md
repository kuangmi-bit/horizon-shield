# run0002: walk 2 settled under the second contract

The first settlement of a real, Bitcoin-anchored execution under a MUSUBI contract. The contractor is
api.babyblueviper.com and the principal is horizonshield.dev. The contract is ../second_contract_AB.json:
file sha256 cf31fe816140345526e3c0b1822833625c93906a09d30630f44bfa6aa7390b41, contract_sha256 14474983...,
and it carries both signatures.

Result: verdict `within_grant`, status `final`, no deviations, nothing underspecified.

| file | sha256 of the file | what it is |
|---|---|---|
| exec_19c44a79.json | 19c44a791a007f2a7f9038c455f70ab2d137083e9e06491136b8895d191e7a53 | the execution record (a2a-execution-v0), signed by the contractor, exactly as agreement.horizonshield.dev/execution/19c44a79... serves it. It is canonical, so this is also the digest settle starts from |
| entry63.raw | 368f319616f80fd155c0d89b35cafec0094c5041a4ce1a8f99371299f61a5e75 | JIDEC ledger entry 63, the 2026-09-29 00:46 UTC agreement batch, which lists the execution by that sha |
| entry63.ots | 4b33f9d5529ceed86a9f01f7f41d6744ea05e7adff2d3787a30315f58ffcf77a | the OpenTimestamps proof the ledger serves for entry 63, confirmed in Bitcoin block 969090 |
| view.json | 0720f48c1ca9e3139959063e7a782f6a2085180a20aee1e3ebbcc8e8d6884a15 | 535 raw headers, 968650 (the contract checkpoint) to 969184. They were fetched from blockstream.info and mempool.space; every header was rebuilt from each explorer's fields and was byte identical across the two |
| exec_19c44a79.anchored.json | b13a38692a9b170199d26618f52afe773c0c7d6a90eb73def2736a9abd9b0221 | the same record with the composed anchor: height 969090, block 000000000000000000004e4a0d49c6f9e8ccaaf4dcc3b70a9163fe520a816046, 85 proof ops |
| walk_8bf29f1a.json | 8bf29f1ad15165b970b508703a5b49cbd816cbfcc4a3fb6f77a9f80a4cb69771 | the walk the execution cites as nenrin_ref (ledger entry 61). Its context.contract_sha256 names these terms, so the NENRIN cross check finds nothing |
| settlement_walk2.json | 11c27fcfe18895cef09f9683136984a50ffdf2bea10f0d9a44566653f052243f | the settlement (a2a-settlement-v1.6) |

The anchor proof has three legs:

1. **Record to batch.** Hexlify the digest, prepend the batch bytes before it, append the bytes after it, then sha256. The result is 368f3196..., and the digest must sit as the value of a `"sha"` member.
2. **Batch to Bitcoin.** Follow the .ots operations up to the Bitcoin attestation.
3. **Bitcoin to header.** The result must equal the merkle root in header 969090 of the verified view.

The horizon is 969179 (tip 969184, finality depth 6), so the settlement is final.

## Recompute

Run from this directory, offline. You need Python 3 and `cryptography`.

    python3 ../anchor_compose.py --record exec_19c44a79.json --batch entry63.raw --ots entry63.ots \
      --contract ../second_contract_AB.json --view view.json --out /tmp/anchored.json
    python3 ../settle_v1_6.py --settle ../second_contract_AB.json --event /tmp/anchored.json \
      --view view.json --nenrin walk_8bf29f1a.json --out /tmp/settlement.json
    shasum -a 256 /tmp/anchored.json /tmp/settlement.json

Both hashes must equal the ones in the table (b13a3869..., 11c27fcf...). They did on macOS (Python 3.14) and on Linux (Python 3.10).

To start from the network instead, use ../header_view_fetch.py for a fresh view and fetch the record, entry and
proof from the URLs above. A longer view moves the tip and the horizon, so the settlement bytes change with
it. The verdict and the anchor do not.

## What this does not establish

These are the settlement's own does_not_establish: full Bitcoin consensus validity, that no key was stolen, that acts nobody recorded did not happen. The verdict is a function anyone can recompute; HORIZON SHIELD does not judge it.
