#!/usr/bin/env python3
"""hs-jccdb-obs v0.4.3: 施工込み ÷ 陸揚げ(trade_installed)を D1(DB_US)に流す SQL を作る。

使い方:
  python3 tools/make_d1_sql_installed.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 --obs ~/horizon-shield/data/jccdb-obs-v2/observations/us --ym 202607 --out sql_us_installed

入力(非公開): installed_us_njdot_2023q2.csv、installed_summary_2023q2.json、chain_us_hs10_<ym>.csv(build_installed_ratio.py の元)
入力(公開の観測層): bid_item_njdot_2023q2.csv(入札の単価が原本の行と同じか見る)
検査(1 つでも外れたら何も書かない):
  出力の sha256 が summary と同じ / hs10_set の HS は全部 chain にあり単位 KG / hs10_primary は set の先頭
  landed_usd_per_kg = chain の Σ陸揚げ ÷ Σ数量(set の合算) / material_landed = landed_usd_per_kg × 0.45359237 × lb
  installed_over_landed = bid_price ÷ material_landed(丸め 2 桁) / installed_over_contractor_stage = bid_price ÷ (material_landed × mult_contractor)
  ppi_adj = bid_price × ppi_factor ÷ material_landed(丸め 2 桁) / 原本の行(scope が region_* と statewide_12mo)の単価は観測層の CSV の price と同じ
  state_12mo_from_regions の単価 = Σawarded_dollars ÷ Σawarded_qty(同じ品目の region_12mo の加重平均の行) / 品目ごとに representative が 1 行だけ
出力: <out>/001.sql ...(1 文 90,000 bytes まで)と MANIFEST.json。最後の文は kake_meta の built_installed(INSERT OR REPLACE。built_kake・built_chain_ext は触らない)。
"""
import argparse, csv, hashlib, json, os, sys, datetime, collections

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True); ap.add_argument("--obs", required=True); ap.add_argument("--ym", required=True)
ap.add_argument("--out", default="sql_us_installed"); ap.add_argument("--max-mb", type=float, default=20)
A = ap.parse_args(); YM = A.ym
files = {"installed": os.path.join(A.src, "installed_us_njdot_2023q2.csv"), "installed_summary": os.path.join(A.src, "installed_summary_2023q2.json"),
         "chain": os.path.join(A.src, f"chain_us_hs10_{YM}.csv"), "bid": os.path.join(A.obs, "bid_item_njdot_2023q2.csv")}
missing = [p for p in files.values() if not os.path.exists(p)]
if missing: sys.exit("入力が無い: " + ", ".join(missing))
sha = {k: hashlib.sha256(open(p, "rb").read()).hexdigest() for k, p in files.items()}
rd = lambda k: list(csv.DictReader(open(files[k], newline="", encoding="utf-8")))
errs = []; bad = lambda m: errs.append(m)
def fnum(v): return None if v is None or str(v).strip() == "" else float(v)
def inum(v): return None if v is None or str(v).strip() == "" else int(float(v))
def close(a, b, rel=1e-6, abs_=1e-9): return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))
LB_KG = 0.45359237

summ = json.load(open(files["installed_summary"]))
if summ.get("output_sha256") != sha["installed"]: bad(f"installed: sha256 {sha['installed'][:12]} != summary {str(summ.get('output_sha256'))[:12]}")
if summ.get("input_sha256", {}).get(os.path.basename(files["bid"])) != sha["bid"]: bad("installed: 観測層の bid CSV の sha256 が summary の入力と違う")
if summ.get("input_sha256", {}).get(os.path.basename(files["chain"])) != sha["chain"]: bad("installed: chain CSV の sha256 が summary の入力と違う")
chain = {r["hs10"]: r for r in rd("chain")}
bidrows = rd("bid")
bid_index = collections.defaultdict(list)
for r in bidrows:
    if r["price"]: bid_index[(r["item_name"], r["geo_level"], r["area_label"], r["period"], r["price_basis"])].append(float(r["price"]))
rows = rd("installed"); recs = []; rep_count = collections.Counter(); by_item_reg = collections.defaultdict(list)
for i, r in enumerate(rows, start=1):
    hss = r["hs10_set"].split("+")
    if r["hs10_primary"] != hss[0]: bad(f"installed: hs10_primary {r['hs10_primary']} != set head {hss[0]}")
    for h in hss:
        if h not in chain: bad(f"installed: chain に無い HS {h}"); continue
        if chain[h]["unit1"] != "KG": bad(f"installed: HS {h} の単位が KG でない")
    if any(h not in chain for h in hss): continue
    lk_full = sum(int(chain[h]["landed_duty_paid_ytd_usd"]) for h in hss) / sum(int(chain[h]["qty_ytd"]) for h in hss)
    lk = fnum(r["landed_usd_per_kg"])
    if not close(lk, lk_full, rel=1e-7): bad(f"installed: landed_usd_per_kg {r['bid_item']}")
    lb = fnum(r["material_lb_per_bid_unit"]); ml = fnum(r["material_landed_usd_per_bid_unit"]); mc = fnum(r["material_contractor_usd_per_bid_unit"]); mult_c = fnum(r["mult_contractor"])
    if not close(ml, lk * LB_KG * lb, rel=1e-7): bad(f"installed: material_landed {r['bid_item']}")
    if not close(mult_c, fnum(chain[hss[0]]["mult_contractor"])): bad(f"installed: mult_contractor {r['bid_item']}")
    if not close(mc, ml * mult_c, rel=1e-7): bad(f"installed: material_contractor {r['bid_item']}")
    price = fnum(r["bid_price_usd"])
    if price is None or price <= 0: bad(f"installed: bid_price {r['bid_item']} {r['scope']}")
    if round(price / ml, 2) != fnum(r["installed_over_landed"]): bad(f"installed: installed_over_landed {r['bid_item']} {r['scope']} {r['area']} {r['bid_basis']}")
    if round(price / mc, 2) != fnum(r["installed_over_contractor_stage"]): bad(f"installed: installed_over_contractor_stage {r['bid_item']} {r['scope']}")
    pf = fnum(r["ppi_factor"]); adj = fnum(r["installed_over_landed_ppi_adj"]); est = fnum(r["bid_price_landed_period_est"])
    if (pf is None) != (adj is None): bad(f"installed: ppi columns inconsistent {r['bid_item']}")
    if pf is not None:
        if not (0.3 < pf < 3): bad(f"installed: ppi_factor {pf} out of range {r['bid_item']}")
        if round(est / ml, 2) != adj or not close(est, price * pf, rel=1e-7): bad(f"installed: ppi_adj {r['bid_item']} {r['scope']}")
        pb = fnum(r["ppi_bid_period_avg"]); pl = fnum(r["ppi_landed_period_avg"])
        if pb is None or pl is None or not close(pf, pl / pb, rel=1e-7): bad(f"installed: ppi_factor != landed/bid avg {r['bid_item']}")
    if r["scope"] in ("region_12mo", "region_2023Q2", "statewide_12mo"):
        key = (r["bid_item"], "state" if r["scope"] == "statewide_12mo" else "district", "" if r["scope"] == "statewide_12mo" else r["area"], r["bid_period"], r["bid_basis"])
        if key not in bid_index or not any(close(p, price, rel=1e-9) for p in bid_index[key]): bad(f"installed: 観測層に同じ単価の行が無い {key}")
        if r["scope"] == "region_12mo" and r["bid_basis"] == "bid_weighted_avg": by_item_reg[r["bid_item"]].append(r)
    elif r["scope"] == "state_12mo_from_regions":
        pass  # 下で合算を確かめる
    else: bad(f"installed: scope {r['scope']}")
    if r["representative"] not in ("true", "false"): bad(f"installed: representative {r['representative']}")
    if r["representative"] == "true": rep_count[r["bid_item"]] += 1
    if r["conversion_confidence"] not in ("high", "medium", "low"): bad(f"installed: confidence {r['conversion_confidence']}")
    if not r["conversion_basis"] or not r["formula"] or not r["caveat"] or not r["reading"] or not r["src_bid"] or len(r["src_chain_import_sha256"]) != 64: bad(f"installed: text/source missing {r['bid_item']}")
    rec = collections.OrderedDict()
    for k in ("hs10_primary", "hs10_set", "hs_desc", "bid_item", "bid_spec", "bid_unit", "scope", "area", "bid_basis", "bid_period"): rec[k] = r[k]
    rec["bid_price_usd"] = price; rec["awarded_qty"] = fnum(r["awarded_qty"]); rec["awarded_dollars_usd"] = fnum(r["awarded_dollars_usd"]); rec["n_occurrences"] = inum(r["n_occurrences"])
    rec["representative"] = 1 if r["representative"] == "true" else 0
    for k in ("bid_source", "bid_evidence_url", "bid_source_page", "bid_license"): rec[k] = r[k]
    for k in ("landed_usd_per_kg",): rec[k] = fnum(r[k])
    rec["landed_period"] = r["landed_period"]; rec["mult_contractor"] = mult_c
    for k in ("material_lb_per_bid_unit", "material_landed_usd_per_bid_unit", "material_contractor_usd_per_bid_unit", "installed_over_landed", "installed_over_contractor_stage"): rec[k] = fnum(r[k])
    rec["ppi_series"] = r["ppi_series"]; rec["ppi_series_title"] = r["ppi_series_title"]
    for k in ("ppi_bid_period_avg",): rec[k] = fnum(r[k])
    rec["ppi_bid_period_months"] = inum(r["ppi_bid_period_months"]); rec["ppi_landed_period_avg"] = fnum(r["ppi_landed_period_avg"]); rec["ppi_landed_period_months"] = inum(r["ppi_landed_period_months"])
    for k in ("ppi_factor", "bid_price_landed_period_est", "installed_over_landed_ppi_adj"): rec[k] = fnum(r[k])
    for k in ("conversion_confidence", "conversion_basis", "computed_from", "reading", "formula", "caveat", "src_bid", "src_chain_import", "src_chain_import_sha256", "src_ppi"): rec[k] = r[k] if r[k] != "" else None
    recs.append(rec)
for r in rows:
    if r["scope"] != "state_12mo_from_regions": continue
    regs = by_item_reg.get(r["bid_item"], [])
    Q = sum(fnum(x["awarded_qty"]) for x in regs); D = sum(fnum(x["awarded_dollars_usd"]) for x in regs)
    if not regs or Q <= 0 or not close(fnum(r["bid_price_usd"]), D / Q, rel=1e-4): bad(f"installed: state_12mo_from_regions の合算が合わない {r['bid_item']}")
    if not close(fnum(r["awarded_qty"]), Q) or not close(fnum(r["awarded_dollars_usd"]), D): bad(f"installed: state_12mo_from_regions の qty/dollars {r['bid_item']}")
items = set(r["bid_item"] for r in rows)
for it in items:
    if rep_count[it] != 1: bad(f"installed: representative が {rep_count[it]} 行 {it}")
if summ.get("rows") != len(rows) or summ.get("items") != len(items): bad("installed: summary の rows/items が CSV と違う")
if errs:
    print(f"検査で {len(errs)} 件の誤り。何も書かない。", file=sys.stderr)
    for e in errs[:30]: print("  " + e, file=sys.stderr)
    sys.exit(1)

os.makedirs(A.out, exist_ok=True)
MAX_STMT = 90_000; MAX_FILE = int(A.max_mb * 1024 * 1024)
out_files = []; cur = []; cur_size = 0
def lit(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "1" if v else "0"
    if isinstance(v, (int, float)): return repr(v)
    return "'" + str(v).replace("'", "''") + "'"
def flush():
    global cur, cur_size
    if not cur: return
    name = f"{len(out_files) + 1:03d}.sql"
    open(os.path.join(A.out, name), "w", encoding="utf-8").write("".join(cur)); out_files.append(name); cur, cur_size = [], 0
def emit(stmt):
    global cur_size
    b = len(stmt.encode("utf-8"))
    if cur_size + b > MAX_FILE: flush()
    cur.append(stmt); cur_size += b
def batch(head, tuples):
    buf, size = [], len(head.encode("utf-8")) + 2
    for t in tuples:
        tb = len(t.encode("utf-8")) + 1
        if buf and size + tb > MAX_STMT: emit(head + ",".join(buf) + ";\n"); buf, size = [], len(head.encode("utf-8")) + 2
        buf.append(t); size += tb
    if buf: emit(head + ",".join(buf) + ";\n")
cols = list(recs[0].keys())
batch(f"INSERT INTO trade_installed (rid, {', '.join(cols)}) VALUES ", ["(" + ", ".join([str(i)] + [lit(r[c]) for c in cols]) + ")" for i, r in enumerate(recs, start=1)])
hs_pairs = []
for i, r in enumerate(recs, start=1):
    for h in r["hs10_set"].split("+"): hs_pairs.append(f"('{h}', {i})")
batch("INSERT INTO trade_installed_hs (hs10, rid) VALUES ", hs_pairs)
reps = [r for r in recs if r["representative"] == 1]
built = {"built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ym": YM, "bid_source": "njdot-wavg-2023-q2",
         "rows": {"trade_installed": len(recs), "trade_installed_hs": len(hs_pairs), "items": len(items), "hs10": len(set(h for r in recs for h in r["hs10_set"].split("+")))},
         "inputs_sha256": sha, "by_confidence_representative": dict(collections.Counter(r["conversion_confidence"] for r in reps)),
         "ratio_representative": {"min": min(r["installed_over_landed"] for r in reps), "max": max(r["installed_over_landed"] for r in reps)}, "constants": summ.get("constants")}
emit("INSERT OR REPLACE INTO kake_meta (k, v) VALUES ('built_installed', " + lit(json.dumps(built, ensure_ascii=False, sort_keys=True)) + ");\n")
flush()
man = {"built": built, "files": {f: hashlib.sha256(open(os.path.join(A.out, f), "rb").read()).hexdigest() for f in out_files},
       "apply_order": ["schema/0006_installed.sql"] + [os.path.join(os.path.basename(os.path.normpath(A.out)), f) for f in out_files]}
json.dump(man, open(os.path.join(A.out, "MANIFEST.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps({"files": len(out_files), "bytes": sum(os.path.getsize(os.path.join(A.out, f)) for f in out_files), "rows": built["rows"], "by_confidence_representative": built["by_confidence_representative"], "ratio_representative": built["ratio_representative"]}, ensure_ascii=False))
