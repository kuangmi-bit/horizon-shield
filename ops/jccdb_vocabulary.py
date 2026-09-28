#!/usr/bin/env python3
"""
ops/jccdb_vocabulary.py

Wraps named rows of the JCCDB v4 verified catalogue in an a2a-vocabulary-v0 document, so a MUSUBI
contract can pin its deliverables to them by sha256 (terms_v0: meaning inside the signed bytes).

Why a wrapper and not the CSV itself: terms_v0 resolves items from an a2a-vocabulary-v0 document keyed by
item_id. The wrapper carries source {url, sha256} of the exact CSV it was cut from, and it refuses to cut
from any CSV whose sha256 is not the one declared in JCCDB_v4_RELEASE_DECLARATION.md. So the chain is:
contract signatures -> terms_sha256 -> vocabulary sha256 -> source CSV sha256 -> the release declaration.

item_id is "jccdb-v4v-" + the first 16 hex of sha256 over the row's exact CSV line (category,item_name,unit),
so the id is fixed by the row's content and anyone holding the CSV recomputes it. The label is the item name;
the unit is the catalogue's unit; methods are the measurement methods the parties agree to name in advance
(terms_v0 refuses a completion test whose method the vocabulary does not list).

Standard library only. It reads a local copy of the CSV; it fetches nothing.

    python3 ops/jccdb_vocabulary.py --csv ~/japan-construction-cost-database/jccdb-v4-verified.csv \\
        --item "外壁塗装（シリコン 材工 1m2）" --method on_site_tape_measure_v0 --method elevation_drawing_takeoff_v0 \\
        --out ops/third_contract/vocabulary.json
"""
import argparse, hashlib, io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.abspath(os.path.join(HERE, "..", "workers", "hs-ledger", "nenrin", "musubi-v0"))
sys.path.insert(0, M)
import terms_v0 as tv0  # noqa: E402

# JCCDB_v4_RELEASE_DECLARATION.md (catalogue v4.0, unchanged in v5.0; dataset DOI 10.5281/zenodo.22127752)
DECLARED_SHA256 = "97151421fb97decccb94d7db24fd19747702dd04041cb2d3ebcb060eb9c4cf2e"
SOURCE_URL = ("https://raw.githubusercontent.com/ogasurfproject-jpg/japan-construction-cost-database/"
              "658ea469a3246f0582b3981289301d20d33807a1/jccdb-v4-verified.csv")
NAME = "jccdb-v4-verified-subset"
VERSION = "v4.0"


def die(m):
    print("refused: " + m, file=sys.stderr)
    sys.exit(2)


def item_id_of(line):
    return "jccdb-v4v-" + hashlib.sha256(line.encode("utf-8")).hexdigest()[:16]


def cut(csv_bytes, names, methods):
    """Pure: the vocabulary document for the named rows. Raises ValueError on any refusal."""
    got = hashlib.sha256(csv_bytes).hexdigest()
    if got != DECLARED_SHA256:
        raise ValueError("the CSV hashes to %s, not the declared %s; cut only from the released bytes" % (got, DECLARED_SHA256))
    if not names:
        raise ValueError("name at least one --item")
    if not methods or any(not isinstance(m, str) or not m or " " in m for m in methods):
        raise ValueError("name at least one --method, each a single token such as on_site_tape_measure_v0")
    lines = csv_bytes.decode("utf-8").splitlines()
    rows = {}
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 3:
            continue
        name = ",".join(parts[1:-1])
        rows.setdefault(name, []).append((line, parts[0], parts[-1]))
    items = {}
    for n in names:
        hits = rows.get(n, [])
        if not hits:
            raise ValueError("no verified row is named exactly %r" % n)
        if len(hits) > 1:
            raise ValueError("%d verified rows are named %r; the name does not pick one row" % (len(hits), n))
        line, category, unit = hits[0]
        items[item_id_of(line)] = {"label": n, "unit": unit, "category": category, "methods": sorted(set(methods))}
    return tv0.make_vocabulary(NAME, VERSION, items, source={"url": SOURCE_URL, "sha256": DECLARED_SHA256})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", required=True, help="local copy of jccdb-v4-verified.csv")
    ap.add_argument("--item", action="append", default=[], help="exact item_name, repeatable")
    ap.add_argument("--method", action="append", default=[], help="an agreed measurement method, repeatable")
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    try:
        with open(a.csv, "rb") as f:
            doc = cut(f.read(), a.item, a.method)
    except (OSError, ValueError) as e:
        die(str(e))
    b = tv0.vocabulary_bytes(doc)
    out = a.out or os.path.join(HERE, "third_contract", "vocabulary.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with io.open(out, "wb") as f:
        f.write(b)
    print("vocabulary " + out + "  bytes " + str(len(b)) + "  sha256 " + tv0.vocabulary_sha256(b))
    for iid, ent in sorted(doc["items"].items()):
        print("  " + iid + "  " + ent["unit"] + "  " + ent["label"] + "  methods " + ",".join(ent["methods"]))
    print("pin it in terms as vocabulary {name: %r, version: %r, sha256: <above>, url: <where you publish these bytes>}" % (NAME, VERSION))
    return 0


if __name__ == "__main__":
    sys.exit(main())
