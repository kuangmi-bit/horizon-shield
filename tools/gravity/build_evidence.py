#!/usr/bin/env python3
"""GRAVITY-v0, part 1: canonical evidence objects.

One JSON object per monitor question (tools/gravity/claims.json), written to evidence/<qid>.json, plus
evidence/index.json. Every value comes from data/souba-db.json, whose SHA-256 is written into the object, so any
reader can recompute the object from the dataset. The same object is what the page links to
(<link rel="alternate" type="application/json">) and what llms.txt lists, so the web page, the JSON, llms.txt and
the MCP tool get_price_range all point at one claim with one identity.

What an object carries, and why (from our own measurements, iasf v1 to v6, 2026-09-14, and arXiv 2605.25517 /
2604.25707): the direct answer, the numbers with units, a comparison across variants, and the steps a reader can
take to check it themselves (the woven form, the only verification form that raised selection). It does not carry
raw hashes in the answer text: the dataset hash sits in the source block, for machines.

Usage: python3 tools/gravity/build_evidence.py [--check]   (--check: rebuild in memory, fail if files differ)
Standard library only.
"""
import hashlib, io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"
DB_PATH = os.path.join(ROOT, "data", "souba-db.json")
CLAIMS = os.path.join(ROOT, "tools", "gravity", "claims.json")
OUT = os.path.join(ROOT, "evidence")
SCHEMA = "gravity-evidence-v0"
JIDEC_ENTRY = 42
BAD_DASH = ("\u2014", "\u2013", "\u2015", "\u2012", "\u2212")


def canon(o):
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def man(n):
    v = n / 10000.0
    return ("%d" % v) if abs(v - round(v)) < 1e-9 else ("%.1f" % v)


def fmt(c):
    if c["unit"] in ("㎡", "m2", "平米"):
        return "%s〜%s円/㎡(平均%s円)" % ("{:,}".format(c["min"]), "{:,}".format(c["max"]), "{:,}".format(c["avg"]))
    return "%s〜%s万円(平均%s万円)" % (man(c["min"]), man(c["max"]), man(c["avg"]))


def position(amount, c):
    if amount < c["min"]:
        return "最安(%s万円)より安い" % man(c["min"])
    if amount <= c["avg"]:
        return "最安から平均(%s〜%s万円)の間" % (man(c["min"]), man(c["avg"]))
    if amount <= c["max"]:
        return "平均から最高(%s〜%s万円)の間" % (man(c["avg"]), man(c["max"]))
    return "最高(%s万円)を超える" % man(c["max"])


def build(db, db_sha, claim):
    cat = {c["id"]: c for c in db["categories"]}
    missing = [x for x in claim["cats"] if x not in cat]
    if missing:
        raise SystemExit("unknown souba category in %s: %s" % (claim["qid"], missing))
    cs = [cat[x] for x in claim["cats"]]
    head = cs[0]
    values = [{"category_id": c["id"], "work": c["work"], "unit": c["unit"], "min": c["min"], "avg": c["avg"], "max": c["max"]} for c in cs]
    comparison = ["%s: %s" % (c["work"], fmt(c)) for c in cs]
    amt = claim.get("amount")
    if amt:
        answer = "%s万円は、%s なら %s です。" % (man(amt), head["work"], position(amt, head))
        answer += " " + " / ".join("%s なら %s" % (c["work"], position(amt, c)) for c in cs[1:])
    else:
        answer = "%s の目安は %s です。" % (head["work"], fmt(head))
    steps = [
        "見積書の内訳を項目ごとに数量と単価に分けて書き出す(一式の項目は数量と単価を出してもらう)。",
        "各項目の単価を上の範囲と比べ、最高を超える項目に印を付ける。",
        "印の付いた項目について、理由(材料のグレード、面積、足場、下地補修など)を業者に書面で聞く。",
    ]
    if amt:
        steps[1] = "総額 %s万円 を上の範囲と比べ、どの帯に入るかを確かめる(工事の範囲と仕様が同じかも確かめる)。" % man(amt)
    body = {
        "schema": SCHEMA,
        "qid": claim["qid"],
        "question": claim["question"],
        "answer": answer,
        "comparison": comparison,
        "values": values,
        "currency": "JPY",
        "region": "全国の基準値。地域係数 " + ", ".join("%s %s" % (k, v) for k, v in db["_meta"]["region_multipliers"].items()) + " を掛けると地域の目安になる(MCP get_price_range に region を渡すと掛けた値が返る)。",
        "self_check": steps,
        "valid_from": db["_meta"]["updated_at"],
        "page": SITE + claim["page"],
        "source": {"dataset": SITE + "/data/souba-db.json", "dataset_version": db["_meta"]["version"], "dataset_sha256": db_sha,
                   "curator": "大賀俊勝(建設実務30年)監修", "upstream_sources": db["_meta"]["sources"]},
        "anchor": {"jidec_entry": JIDEC_ENTRY, "ledger_url": "https://ledger.horizonshield.dev/ledger/%d" % JIDEC_ENTRY,
                   "what": "the SHA-256 of this exact souba-db.json release is recorded in JIDEC entry %d with an OpenTimestamps proof" % JIDEC_ENTRY},
        "mcp": {"server": "https://mcp.horizonshield.dev/mcp", "tool": "get_price_range", "arguments": {"work": head["work"]}},
        "neutrality": "No referral, listing or success fee from contractors.",
        "does_not_establish": ["that a specific quote is fair without checking its scope and line items",
                               "that every contractor's price falls in the range; the range is a reference, not a cap"],
        "gravity_version": "0",
    }
    body["claim_id"] = "hs-souba-%s-%s" % (claim["qid"], hashlib.sha256(canon({"q": claim["question"], "v": values, "sha": db_sha}).encode()).hexdigest()[:12])
    body["object_sha256"] = hashlib.sha256(canon({k: v for k, v in body.items() if k != "object_sha256"}).encode()).hexdigest()
    return body


def main():
    check = "--check" in sys.argv
    raw = open(DB_PATH, "rb").read()
    db_sha = hashlib.sha256(raw).hexdigest()
    db = json.loads(raw.decode("utf-8"))
    claims = json.load(io.open(CLAIMS, encoding="utf-8"))["claims"]
    files = {}
    index = {"schema": "gravity-evidence-index-v0", "dataset_sha256": db_sha, "dataset_version": db["_meta"]["version"], "objects": []}
    for c in claims:
        o = build(db, db_sha, c)
        txt = json.dumps(o, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
        if any(d in txt for d in BAD_DASH):
            raise SystemExit("forbidden dash in %s" % c["qid"])
        files["%s.json" % c["qid"]] = txt
        index["objects"].append({"qid": c["qid"], "question": c["question"], "claim_id": o["claim_id"], "object_sha256": o["object_sha256"],
                                 "url": SITE + "/evidence/%s.json" % c["qid"], "page": o["page"]})
    files["index.json"] = json.dumps(index, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if check:
        bad = [n for n, t in files.items() if not os.path.exists(os.path.join(OUT, n)) or io.open(os.path.join(OUT, n), encoding="utf-8").read() != t]
        print("evidence objects: %d, out of date: %s" % (len(claims), bad or "none"))
        return 1 if bad else 0
    os.makedirs(OUT, exist_ok=True)
    for n, t in files.items():
        io.open(os.path.join(OUT, n), "w", encoding="utf-8").write(t)
    print("wrote %d evidence objects + index.json to evidence/ (dataset %s, sha %s)" % (len(claims), db["_meta"]["version"], db_sha[:12]))
    for e in index["objects"]:
        print("  %s  %s  %s" % (e["qid"], e["claim_id"], e["question"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
