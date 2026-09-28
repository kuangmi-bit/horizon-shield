#!/usr/bin/env python3
"""Tests for ops/jccdb_vocabulary.py. Needs a local jccdb-v4-verified.csv (the released bytes).

    python3 ops/jccdb_vocabulary_test.py ~/japan-construction-cost-database/jccdb-v4-verified.csv
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import jccdb_vocabulary as J  # noqa: E402
tv0 = J.tv0

OK = []


def t(name, cond, detail=""):
    OK.append(bool(cond))
    print(("  ok    " if cond else "  FAIL  ") + name + ("" if cond else "  " + str(detail)))


def refuses(fn, needle):
    try:
        fn()
    except ValueError as e:
        return needle in str(e)
    return False


csv = open(sys.argv[1], "rb").read()
NAME = "外壁塗装（シリコン 材工 1m2）"
METHODS = ["on_site_tape_measure_v0", "elevation_drawing_takeoff_v0"]
doc = J.cut(csv, [NAME], METHODS)
b = tv0.vocabulary_bytes(doc)
(iid, ent), = doc["items"].items()
t("the cut names the released CSV by its declared sha256", doc["source"]["sha256"] == J.DECLARED_SHA256)
t("item_id is recomputable from the row's exact line", iid == J.item_id_of("塗装・コーキング・接着剤," + NAME + ",m2"), iid)
t("unit and label come from the catalogue", ent["unit"] == "m2" and ent["label"] == NAME)
t("the same inputs give the same bytes", tv0.vocabulary_bytes(J.cut(csv, [NAME], list(reversed(METHODS)))) == b)

terms = tv0.build_terms({"name": J.NAME, "version": J.VERSION, "sha256": tv0.vocabulary_sha256(b), "url": "https://example.org/vocabulary.json"},
                        [{"item_id": iid, "label": NAME, "quantity": {"value": 1500, "scale": 1}, "unit": "m2", "tolerance_bp": 300,
                          "completion_test": {"method": "on_site_tape_measure_v0", "evidence_schema": "a2a-measurement-v0"}}],
                        deadline={"kind": "bitcoin_block", "height": 972000})
rep = tv0.verify_terms(terms, vocabulary_bytes=b)
t("terms pinned to this vocabulary verify with no refusal", not rep.get("refusals"), rep.get("refusals"))
bad = dict(terms); bad["items"] = [dict(terms["items"][0], completion_test={"method": "eyeball_v0", "evidence_schema": "a2a-measurement-v0"})]
rep2 = tv0.verify_terms(bad, vocabulary_bytes=b)
t("a method the parties did not list is refused by terms_v0", any(r.get("code") == "method_not_in_vocabulary" for r in rep2.get("refusals", [])), rep2.get("refusals"))
bad2 = dict(terms); bad2["items"] = [dict(terms["items"][0], unit="m²")]
rep3 = tv0.verify_terms(bad2, vocabulary_bytes=b)
t("a unit other than the catalogue's is refused by terms_v0", any(r.get("code") == "unit_mismatch" for r in rep3.get("refusals", [])), rep3.get("refusals"))

t("refuses a CSV that is not the released bytes", refuses(lambda: J.cut(csv + b"\n", [NAME], METHODS), "declared"))
t("refuses a name that is not a verified row", refuses(lambda: J.cut(csv, ["外壁塗装（存在しない）"], METHODS), "no verified row"))
t("refuses without a method", refuses(lambda: J.cut(csv, [NAME], []), "--method"))
t("refuses a method with a space", refuses(lambda: J.cut(csv, [NAME], ["tape measure"]), "--method"))
two = J.cut(csv, [NAME, "クロス張替（1m2）"], METHODS)
t("several items can be cut at once", len(two["items"]) == 2)

print("=== %d / %d 合格 (jccdb_vocabulary) ===" % (sum(OK), len(OK)))
sys.exit(0 if all(OK) else 1)
