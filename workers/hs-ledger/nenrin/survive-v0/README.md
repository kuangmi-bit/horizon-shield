# nenrin-survive-v0: can the history be rebuilt without us?

The claim: if The HORIZONs Co., Ltd. and every host it runs disappeared tomorrow, a stranger could rebuild yesterday's JIDEC ledger from copies held elsewhere and check every entry against Bitcoin alone.

A claim like that is worth nothing until someone tries it on a schedule and publishes what happened. This directory does both. Every day a workflow in this repository runs the drill below from a GitHub runner with the operator's names sinkholed, and commits the report beside this file, whatever it says.

## The drill

    pip install -r requirements.txt
    python3 survive.py drill --source swh --fenced --out report.json

1. **A copy, not from us.** `--source swh` asks Software Heritage for the archived copy of `kept/` (a mirror-v0 copy of the ledger committed here daily) and has it cooked into a tarball. `--source github` takes a GitHub tarball instead; that account is ours, so the report marks it `operator_controlled: true` and it proves the copy's form, not its survival. `--source dir:/path` takes your own copy, for example one made with [mirror-v0](../mirror-v0/BECOME_A_MIRROR.md).
2. **No operator host.** Every URL is checked before any connection: operator names are refused by suffix (`horizonshield.dev`, `the-horizons-innovation.com`, `oga-surf-project.workers.dev`), and anything that is not Software Heritage, the GitHub tarball host or one of two block explorers is refused too. With `--fenced`, a canary connection to `ledger.horizonshield.dev` must fail before the drill starts; in CI those names resolve to 0.0.0.0.
3. **Digests.** sha256 of every `ledger/<n>.raw` must equal that entry's `claim_sha256`.
4. **Chain.** jidec-chain-v1 is recomputed over entries 1..N from the copy alone, with the recipe in [`chain_v1.mjs`](../../src/chain_v1.mjs). Every head that a checkpoint or batch carries inside its own anchored bytes (`ledger_head`: n, entry_sha256, marker_sha256) must match the recomputation. A missing entry breaks the walk and is reported where it breaks.
5. **Anchors.** Every `ledger/<n>.ots` is walked with the OpenTimestamps library. A Bitcoin attestation counts only if the merkle root it commits to equals the block header's merkle root as served by both blockstream.info and mempool.space. Proofs that are still pending are listed, never counted.

The report is `nenrin-survive-drill-v0` JSON with `outcome` one of `rebuilt`, `findings`, `custodian_unavailable`, `empty_copy` or `fence_failed`, the custodian and its snapshot identifiers, the counts, every failure by entry number, `establishes`, `does_not_establish` and its own `report_sha256`.

## If ledger.horizonshield.dev is down: read the kept copy

`kept/` is a full copy of the ledger (every entry as served, its claim bytes and its OpenTimestamps proof), refreshed daily at 03:17 UTC by the keep job of `.github/workflows/survive-drill.yml` and archived by Software Heritage. Since 2026-10-09 it also holds the ledger's own `export.jsonl` (one jidec-chain-v1 row per entry, then the head marker) and `head.json` as they were served at that run. It is a second copy at GitHub, still published by the same operator; Software Heritage is the copy the operator does not host.

Check it offline with the standard library only:

    git clone --depth 1 --filter=blob:none --sparse https://github.com/ogasurfproject-jpg/horizon-shield
    cd horizon-shield
    git sparse-checkout set workers/hs-ledger/nenrin/survive-v0 workers/hs-ledger/src
    cd workers/hs-ledger/nenrin/survive-v0
    python3 verify_chain.py --dir kept --export kept/export.jsonl --head kept/head.json

`verify_chain.py` checks that entries run 1..N with no gap, that every `ledger/<n>.raw` hashes to its `claim_sha256`, recomputes the chain with the same recipe as `survive.py` and `src/chain_v1.mjs`, checks every head a stamped checkpoint carries, re-hashes every export row and its `prev_entry_sha256` link and its head marker, and compares the copy's head with `head.json`. It prints the head it recomputed. Exit 0 means no findings.

Two limits. `head.json` is what the operator served on the day of the copy, so it is only as independent as the operator; the stronger comparison is with a head you obtained yourself on an earlier day, or with a head inside a checkpoint whose claim is stamped to Bitcoin (the `stamped heads matched` line, and `survive.py drill --source dir:kept` to check those stamps against block headers, which needs `requirements.txt`). And the copy stops at its last run: entries appended after 03:17 UTC that day are not in it.

Tests, offline, synthetic ledgers (valid, tampered bytes, a consistently rewritten entry, a missing sequence number, a broken prev link, a missing export row, an edited marker, truncation, a live ledger ahead of the copy, a wrong stamped head, and an export built by `chain_v1.mjs` when node is installed):

    python3 verify_chain_test.py

## What it does not establish

That any claim in the ledger is true. That the copy is complete past its highest entry: the newest entries reach the custodian a day or more later. That two explorers agreeing is Bitcoin consensus; check the headers against your own node for that. Anything about pending proofs.

## Where the reports are

`drills/latest-swh.json`, `drills/latest-github.json` and one line per run in `drills/history.jsonl`. A red run is kept, not rerun until it turns green.

## Tests

    python3 survive_test.py

Offline, no network. Synthetic ledgers that break one thing each (a changed byte, a removed entry, a checkpoint that disagrees, explorers that disagree, a proof for other bytes, operator hosts), one real proof (ledger entry 66, confirmed in blocks 969240 and 969244), and a check that the Python chain recipe gives the same bytes as the ledger's JavaScript.
