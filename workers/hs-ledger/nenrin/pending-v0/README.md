# pending-v0: the window before the batch

A witness walk or an agreement filed to `ledger.horizonshield.dev` is accepted at once but enters a ledger entry only at the daily batch (00:30 UTC). Until then it lived in one place, Cloudflare KV. After the batch, [`mirror-v0`](../mirror-v0) and [`survive-v0`](../survive-v0) copy it out.

This folder closes most of that window. Every hour (`.github/workflows/pending-mirror.yml`) `pending_mirror.py` reads the public pending lists (`/witness/pending`, `/agreement/pending`), fetches each record exactly as served, and writes the bytes to `snapshots/<kind>/<sha>.json`. `log.jsonl` records the name, the fetch time, the URL and the SHA-256 of the served bytes. No key is used.

What a snapshot shows: these bytes were served under this name before the batch, and the commit dates them within an hour.
What it does not show: that the record is true, or that the name is the right digest of the record's canonical form. That is checked when the record is batched, against the digest the batch names.

Test, offline: `python3 pending_mirror_test.py`.
