# SEKI heartbeat

The first SEKI door stands in front of HORIZON SHIELD's own paid tool, hs-gateway `/report`, for the store
`hs-seki-demo`, under the demonstration contract `../musubi-v0/run0003/contract.json`. Principal, agent and door are all
The HORIZONs Co., Ltd., and the contract says so. A door exercised only on the day it was built proves little, so it is
exercised every day, and every day is settled.

| file | what it is |
|---|---|
| `heartbeat.py` | `run`: the agent's three calls of the day (report admitted, audit over its limit refused, compare prohibited refused), each with a fresh nonce; every record checked under the key `keys/seki-door.json` publishes and found on the ledger. `settle`: every earlier day whose ledger batch Bitcoin has confirmed, settled with settle v1.15 (v1.12 must agree on the verdict). `--selftest` runs offline |
| `runs/<UTC date>/` | `RUN.json`, the signed requests, the door's records, the execution record; once settled, the anchored records, `settlement.json` and `SETTLED.json` (verdict, view, ledger entries, how to recompute) |
| `runs/README.md` | one line per day |
| `view-chunks/` | final Bitcoin headers from the contract's checkpoint, 1000 per file, written once and never rewritten; the whole view is checked under the contract's rules on every run |

The workflow is `.github/workflows/seki-heartbeat.yml`, daily at 23:17 UTC, so the records reach the ledger before
its 00:30 UTC batch. It uses only the agent's key (an Actions secret) and the store's gateway token. The door's key
stays in Cloudflare. The pilot's tickets carry no monetary value.

## Recompute a settled day

From `runs/<date>/`, with Python 3 and `cryptography`:

    python3 ../../../musubi-v0/header_view_fetch.py --contract ../../../musubi-v0/run0003/contract.json --out view.json --to <view.to in SETTLED.json>
    python3 ../../../musubi-v0/settle_v1_15.py --settle ../../../musubi-v0/run0003/contract.json \
      --event execution_report.anchored.json \
      --admission admission_report.anchored.json --admission admission_audit.anchored.json --admission admission_compare.anchored.json \
      --relying-key shield.the-horizons-innovation.com=<public_key_ed25519_b64 from keys/seki-door.json> \
      --view view.json --out /tmp/settlement.json
    shasum -a 256 /tmp/settlement.json

The hash must equal `settlement_sha256` in `SETTLED.json`. Each anchored record's anchor can be checked on its own with
`../../../musubi-v0/anchor_compose.py` against the ledger entry named in `SETTLED.json` (`/ledger/<n>?format=raw` and
`/ledger/<n>/ots`).

## What this does not establish

That anyone outside uses the door. It is our own door, our own agent and our own contract, exercised on a schedule.
What it does establish is narrower and checkable: on each day listed, the door gave these answers to these signed
requests, the answers were on the public ledger before Bitcoin confirmed them, and the settlement recomputes.
