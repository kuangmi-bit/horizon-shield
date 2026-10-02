#!/usr/bin/env python3
"""pending-v0: copy records the ledger has accepted but not yet batched, out of Cloudflare, every hour.

Why: a witness walk or an agreement filed to ledger.horizonshield.dev lives only in Cloudflare KV until the
daily batch at 00:30 UTC puts it in a ledger entry (after which mirror-v0 and survive-v0 copy it). That window
is up to a day. This script reads the public pending lists, fetches each pending record exactly as served,
and writes the served bytes to snapshots/<kind>/<sha>.json in this public repository. It needs no key.

What a snapshot shows: these bytes were served under this name before the batch, and the git commit dates them.
What it does not show: that the record is true, or that its name is the right digest of its canonical form.
That check happens when the record is batched: mirror-v0 verifies batch objects against the digests the batch names.

  python3 pending_mirror.py --out <dir> [--base https://ledger.horizonshield.dev]
Exit 0 when every list was read (new snapshots or none), 1 when a list or a record could not be read.
"""
import hashlib, json, os, re, sys, time, urllib.request

BASE = "https://ledger.horizonshield.dev"
KINDS = {"witness": ("/witness/pending", "sha", "/witness/%s"),
         "agreement": ("/agreement/pending", "canonical_sha256", "/agreement/%s")}
HEX64 = re.compile(r"^[0-9a-f]{64}$")

def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"user-agent": "hs-pending-mirror/0.1 (+https://github.com/ogasurfproject-jpg/horizon-shield)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()

def main(argv):
    out = argv[argv.index("--out") + 1] if "--out" in argv else "snapshots_root"
    base = (argv[argv.index("--base") + 1] if "--base" in argv else BASE).rstrip("/")
    if not (base.startswith("https://") or base.startswith("http://127.0.0.1")):
        print("refusing a non https base:", base); return 2
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    log, failed, new = [], 0, 0
    for kind, (list_path, key, rec_path) in KINDS.items():
        try:
            st, body = get(base + list_path)
            items = json.loads(body).get("pending", [])
        except Exception as e:
            print(f"LIST   {kind}: could not read {list_path}: {e}"); failed += 1; continue
        print(f"LIST   {kind}: {len(items)} pending")
        for it in items:
            sha = str(it.get(key) or "").lower()
            if not HEX64.match(sha):
                print(f"SKIP   {kind}: not a sha256 name: {sha[:80]!r}"); continue
            d = os.path.join(out, "snapshots", kind)
            path = os.path.join(d, sha + ".json")
            if os.path.exists(path):
                continue
            try:
                st, raw = get(base + rec_path % sha)
            except Exception as e:
                print(f"RECORD {kind} {sha[:12]}: could not read: {e}"); failed += 1; continue
            os.makedirs(d, exist_ok=True)
            with open(path, "wb") as f:
                f.write(raw)
            served = hashlib.sha256(raw).hexdigest()
            log.append({"kind": kind, "name": sha, "fetched_at": now, "url": base + rec_path % sha,
                        "served_bytes_sha256": served, "bytes": len(raw)})
            new += 1
            print(f"NEW    {kind} {sha[:12]} ({len(raw)} bytes, served sha256 {served[:12]})")
    if log:
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, "log.jsonl"), "a", encoding="utf-8") as f:
            for row in log:
                f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"DONE   {new} new snapshot(s), {failed} read failure(s), at {now}")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
