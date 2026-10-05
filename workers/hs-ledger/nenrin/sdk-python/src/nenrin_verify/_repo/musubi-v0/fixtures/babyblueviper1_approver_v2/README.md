# a2a-approval-v2 approver vectors (babyblueviper1)

Copied byte for byte from [babyblueviper1/preaction-governance-conformance@9860841](https://github.com/babyblueviper1/preaction-governance-conformance/tree/9860841/examples/musubi-approver-v2), written for settle v1.10 at our request ([#29](https://github.com/ogasurfproject-jpg/horizon-shield/issues/29)).

- `vectors.json`: nine vectors (CC0-1.0), the fields, the signed bytes and the reasons settle v1.10 is built against. The base contract inside is our `second_contract_AB.json` with a conditional `emit_witness` and a pinned approver added. The keys are test keys from fixed seeds.
- `verify_approval_v2.py` and `_ed25519.py`: their reference verifier and its verification-only Ed25519, MIT, (c) 2026 babyblueviper1 (`LICENSE`). Run `python3 verify_approval_v2.py` here: 9/9.

`python3 ../../settle_v1_10.py --selftest` runs the same nine vectors through settle v1.10's own verifier (check 1) and, when these two files are present, runs their verifier too. Two implementations by two authors, one set of vectors.
