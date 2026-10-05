# Reviewing mirror.py before you vendor it

For an organisation that holds a copy of the NENRIN ledger with `github-action/nenrin-mirror-vendored.yml`. The point of the vendored variant is that you review this file once, commit it into your own repository, and pin its sha256 in the workflow. No code is fetched at run time, and a change upstream changes nothing on your side until you commit a new copy and a new pin.

File: `mirror.py`, 362 lines, Python 3 standard library only (`argparse, hashlib, json, os, sys, time, urllib`). No subprocess, no `eval`/`exec`, no dynamic import, no third-party package. sha256 at the time of writing: `76cefe5c3eaaacd4ac630a3c8242d644611410497bd59a0a66e3f2f8ee7958bc`.

## Every network call (all HTTP GET, through one function, `fetch`, line 54)

| Line | URL | What is kept |
|---|---|---|
| 141 | `<base>/ledger?format=json` | the entry count |
| 155 | `<base>/ledger/<n>?format=json` | the entry as served |
| 171 | `<base>/ledger/<n>?format=raw` | the claim bytes, kept only if their sha256 equals the entry's `claim_sha256` |
| 188 | `<base>/ledger/<n>/ots` | the OpenTimestamps proof bytes |
| 201 | the `bytes_url` a batch entry names for each record it carries | the bytes, kept only if they hash to the digest the batch names them by (`object_ok`, line 100) |

`<base>` is `https://ledger.horizonshield.dev` unless `--base` says otherwise. Plain `http://` is refused except for a loopback address in the self test (`_url_ok`, line 85). Nothing is ever sent: there is no POST, no upload and no credential.

## Every write

Only under the directory given by `--dir`, through `_write` (line 65), which writes `<path>.part` and renames it. Layout: `ledger/<n>.json`, `ledger/<n>.raw`, `ledger/<n>.ots`, `objects/<sha256>`, `manifest.json`. In the workflow that directory is `work/mirror` on the mirror branch, and the job's token can push only to the repository it runs in.

## What a copy establishes, and what it does not

It establishes that these bytes, with these digests, were obtainable from the ledger at `mirrored_at`, and that anyone holding the branch can recompute every digest offline (`python3 mirror.py verify --dir mirror`). It does not establish that any claim in the ledger is true, or that an anchor is valid; check the `.ots` files against Bitcoin headers with any OpenTimestamps client.

## Updating

When you want a newer `mirror.py`, read the diff, commit the file, and change `MIRROR_PY_SHA256` in the workflow in the same commit. Until you do, the workflow refuses any other bytes at that path.
