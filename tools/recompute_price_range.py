#!/usr/bin/env python3
"""Recompute a HORIZON SHIELD get_price_range answer from the published souba-db.json bytes.

Standard library only. Nothing is trusted from the server except the bytes you hash yourself.

  python3 recompute_price_range.py answer.json                 fetch recompute.dataset_url
  python3 recompute_price_range.py answer.json --dataset souba-db.json

answer.json is the JSON object get_price_range returned (the text of the tool result).
Exit 0 when every row matches, 1 when any row differs or the bytes do not match, 2 on bad input.
Recomputing shows that the answer equals the published table under the stated formula.
It does not show that the table values are right; they are curated, not computed by a formula.
"""
import hashlib, json, math, sys, urllib.request

def round_half_up(x):
    return int(math.floor(x + 0.5))

def main(argv):
    if len(argv) < 2:
        print(__doc__); return 2
    ans = json.load(open(argv[1], encoding="utf-8"))
    rc = ans.get("recompute")
    if not isinstance(rc, dict):
        print("no recompute block in this answer"); return 2
    if "--dataset" in argv:
        raw = open(argv[argv.index("--dataset") + 1], "rb").read()
        where = argv[argv.index("--dataset") + 1]
    else:
        where = rc["dataset_url"]
        with urllib.request.urlopen(where, timeout=30) as r:
            raw = r.read()
    sha = hashlib.sha256(raw).hexdigest()
    ok = True
    if rc.get("dataset_sha256") and sha != rc["dataset_sha256"]:
        print(f"BYTES  differ: sha256 of {where} is {sha}, the answer names {rc['dataset_sha256']}")
        print("       The table changed since the answer, or a different copy was fetched. Fetch the copy at that sha.")
        return 1
    print(f"BYTES  ok  sha256 {sha}  ({where})")
    db = json.loads(raw.decode("utf-8"))
    entries = {e.get("id"): e for e in db.get("categories", [])}
    rm = (rc.get("region_multiplier") or {})
    key = rm.get("key")
    mult = db.get("_meta", {}).get("region_multipliers", {}).get(key) if key else None
    if key and mult != rm.get("value"):
        print(f"REGION differ: table multiplier for {key} is {mult}, the answer says {rm.get('value')}"); ok = False
    for row in ans.get("prices", []):
        e = entries.get(row.get("id"))
        if e is None:
            print(f"ROW    {row.get('id')}: no entry with this id in the table"); ok = False; continue
        scaled = key is not None and "base" in row
        for f in ("min", "avg", "max"):
            want = e.get(f)
            if scaled and isinstance(want, (int, float)):
                if row["base"].get(f) != want:
                    print(f"ROW    {row['id']} base.{f}: table {want}, answer {row['base'].get(f)}"); ok = False
                want = round_half_up(want * mult)
            if row.get(f) != want:
                print(f"ROW    {row['id']} {f}: recomputed {want}, answer {row.get(f)}"); ok = False
        if e.get("work") != row.get("work"):
            print(f"ROW    {row['id']} work: table {e.get('work')!r}, answer {row.get('work')!r}"); ok = False
    n = len(ans.get("prices", []))
    print(("MATCH  " if ok else "DIFFER ") + f"{n} row(s)" + (f", region {key} x {mult}" if key else ", no region applied"))
    print("Shows: the answer equals the published table. Does not show: that the table values are right.")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))
