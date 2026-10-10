# slot-witness-v0: NENRIN as an outside reader of an issuer's one-receipt-per-request record

invinoveritas decision receipts carry a request slot since 2026-10-10: one receipt per (holder, `decider.request_id`), and
`GET https://api.babyblueviper.com/decision-receipt/slot/{request_slot}` lists the receipt that holds it
([decision-receipt SPEC, uniqueness section](https://github.com/babyblueviper1/invinoveritas/blob/main/examples/decision-receipt/SPEC.md)).
The slot closes the case of a holder who keeps an approve and a deny receipt for one decision and reveals the one that
helps (found 2026-10-10, vectors p7, p8, n13, n14 in that suite). The guarantee rests on the issuer's own record, and its
author keeps the slot log on his side. This intake is a witness of that record, not a second copy of it.

## What the ledger does

1. `POST /evidence/slot` with `{"event": <the receipt's signed NIP-01 event>}`. The ledger recomputes the event id
   (NIP-01), verifies the BIP-340 signature under the issuer key pinned in `ISSUERS`, and reads `request_slot` from the
   signed content. A receipt without `request_slot` makes no uniqueness claim and is refused as `no_request_slot`.
2. The ledger fetches the issuer's slot endpoint itself (no redirects, 10 s, at most 16384 bytes kept), keeps the
   response bytes and their sha256, and records a verdict about this receipt:

   | verdict | the slot endpoint said |
   |---|---|
   | `unique` | taken, and `event_ids` is exactly this receipt's event id |
   | `listed_with_others` | taken, lists this receipt and at least one more (or this one twice) |
   | `not_listed` | taken, does not list this receipt |
   | `not_taken` | `taken` is not true |
   | `slot_mismatch` | answered for another slot |
   | `unreadable` | not 200, not a JSON object, `event_ids` not a list of strings, or over the size cap |
   | `fetch_failed` | no answer |

3. It reads the same (slot, receipt) again about daily for 30 days. Each observation names the previous one
   (`previous_observation`, `changed_since_previous`), so a slot that later lists a different or a second receipt is
   visible next to what it listed before. `GET /evidence/slot/s/{request_slot}` returns every observation of a slot and
   `slot_listing_changed`.
4. Observations go oldest first into a daily `nenrin-slot-witness-batch-v0` ledger entry, stamped to Bitcoin with
   OpenTimestamps. `mirror-v0` copies each observation's bytes with the batch.

Reads: `/evidence/slot` (what this is), `/evidence/slot/{sha}` and `?format=raw` (the observation and its exact bytes),
`/evidence/slot/s/{request_slot}` (the history), `/evidence/slot/pending`.

## What an observation establishes, and what it does not

It establishes that the receipt verifies under the issuer key and names this slot; that at `observed_at` this ledger got
exactly the kept bytes from the issuer's slot endpoint; that the verdict is what those bytes say; and, once batched and
stamped, that the observation existed before that Bitcoin block.

It does not establish that only one receipt was issued (that is the issuer's record), that the `request_id` behind the
slot is the decider's own id (the SPEC leaves that to the relying party), that the recorded decision was the decider's
real choice, what the endpoint served between observations or to anyone else, or that the issuer key was not
compromised.

## Check it yourself

```sh
python3 slot_check.py --sha <observation sha>      # the observation, its batch, its OTS proof (add --headers view.json to check the block)
python3 slot_check.py --slot <request_slot>        # every observation of the slot, and whether the listing changed
python3 slot_check.py --record observation.json    # offline, from the bytes ?format=raw served
```

`slot_check.py` verifies BIP-340 with its own code (`bip340.py`, written separately from `bip340.mjs`) and recomputes the
verdict from the kept bytes. Standard library only.

## Files

- `bip340.mjs`, `bip340.py`: BIP-340 verify (and sign, for fixtures) with no dependency, NIP-01 event checks. Both pass
  the BIP's `test-vectors.csv` (`fixtures/bip340_test_vectors.csv`: the BIP's file, sha256 `34c9d1d9...` with CRLF line ends, stored with LF ends, sha256 `01c8cabb...`) and verify a real invinoveritas
  event (`fixtures/invinoveritas_event.json`, from its repository).
- `slot_witness_v0.mjs`: the intake, the daily watch (`watchSlots`) and the daily batch (`anchorSlotWitnessPool`).
- `slot_check.py`: the reader-side checker.
- `fixtures/gen_fixtures.mjs` and `fixtures/slot_fixtures.json`: observations the JS intake wrote for each verdict,
  recomputed by the Python checker; the test asserts the file regenerates byte for byte.

Tests: `node nenrin/slot-witness-v0/slot_witness_v0.test.mjs` (in `workers/hs-ledger`) and
`python3 nenrin/slot-witness-v0/slot_check_test.py`.

## Limits of v0

- Issuers are pinned by key in `ISSUERS`; v0 reads invinoveritas only.
- The slot format is read as a URL-safe string of 16 to 160 characters until a live receipt fixes it.
- One observation per (slot, receipt) per 6 hours on submission; 200 new observations a day, 20 per network.
- The watch reads at most 50 pairs a run, oldest observation first, for 30 days after the first observation.
