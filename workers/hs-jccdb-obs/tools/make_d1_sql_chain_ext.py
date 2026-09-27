#!/usr/bin/env python3
"""hs-jccdb-obs v0.4.2: 各段の価格の足し表(trade_chain_ext)を D1(DB_US)に流す SQL を作る。

使い方:
  python3 tools/make_d1_sql_chain_ext.py --src ~/hs-core-private/ops-private/jccdb_us_kake_20260926 --ym 202607 --out sql_us_chain_ext

入力(非公開): chain_ext_us_hs10_<ym>.csv、chain_ext_summary_<ym>.json、chain_us_hs10_<ym>.csv(build_chain_ext.py の元。行が対応するか見る)
検査(1 つでも外れたら何も書かない):
  出力の sha256 が summary と同じ / hs10 は 10 桁で重複なし / chain の hs10 と 1 対 1
  mpf_upper = round(customs_value × mpf_rate)、hmf_upper = round(customs_value × hmf_rate)、landed_incl_fees_upper = landed + mpf + hmf
  mult_wholesale_two_tier = 1 / (1 - gm_w)^2(gm_w は chain の値)、cost_share_one_tier = 1 - gm_w、cost_share_two_tier = (1 - gm_w)^2
  cost_share_via_retail = 1 / mult_retail_via_wholesale(chain の値)、bea_nearest は cost_share の中で BEA に一番近い名前
  fees_share_upper <= 0.005(法定の率 0.4714% を超えない)
出力: <out>/001.sql ...(1 文 90,000 bytes まで)と MANIFEST.json。最後の文は kake_meta の built_chain_ext(INSERT OR REPLACE。0004 の built_kake は触らない)。
"""
import argparse, csv, hashlib, json, os, sys, datetime, collections
from math import floor, log10

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True); ap.add_argument("--ym", required=True)
ap.add_argument("--out", default="sql_us_chain_ext"); ap.add_argument("--max-mb", type=float, default=20)
A = ap.parse_args(); YM = A.ym
S = lambda f: os.path.join(A.src, f)
files = {"ext": S(f"chain_ext_us_hs10_{YM}.csv"), "ext_summary": S(f"chain_ext_summary_{YM}.json"), "chain": S(f"chain_us_hs10_{YM}.csv")}
missing = [p for p in files.values() if not os.path.exists(p)]
if missing: sys.exit("入力が無い: " + ", ".join(missing))
sha = {k: hashlib.sha256(open(p, "rb").read()).hexdigest() for k, p in files.items()}
rd = lambda k: list(csv.DictReader(open(files[k], newline="", encoding="utf-8")))
errs = []
bad = lambda m: errs.append(m)
def fnum(v): return None if v is None or str(v).strip() == "" else float(v)
def inum(v): return None if v is None or str(v).strip() == "" else int(float(v))
def close(a, b, rel=1e-6, abs_=1e-9): return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))
def sig(x, n=8): return 0.0 if x == 0 else round(x, -int(floor(log10(abs(x)))) + (n - 1))

summ = json.load(open(files["ext_summary"]))
if summ.get("output_sha256") != sha["ext"]: bad(f"ext: sha256 {sha['ext'][:12]} != summary {str(summ.get('output_sha256'))[:12]}")
chain = {r["hs10"]: r for r in rd("chain")}
ext = rd("ext"); seen = set(); rows = []
for r in ext:
    hs = r["hs10"]
    if len(hs) != 10 or not hs.isdigit(): bad(f"ext: hs10 {hs}")
    if hs in seen: bad(f"ext: hs10 重複 {hs}")
    seen.add(hs)
    c = chain.get(hs)
    if not c: bad(f"ext: chain に無い {hs}"); continue
    cv = inum(r["customs_value_ytd_usd"]); landed = inum(r["landed_duty_paid_ytd_usd"])
    mr = fnum(r["mpf_rate"]); hr = fnum(r["hmf_rate"]); mpf = inum(r["mpf_upper_ytd_usd"]); hmf = inum(r["hmf_upper_ytd_usd"]); incl = inum(r["landed_incl_fees_upper_ytd_usd"])
    if landed != inum(c["landed_duty_paid_ytd_usd"]): bad(f"ext: landed differs from chain {hs}")
    if mpf != round(cv * mr) or hmf != round(cv * hr) or incl != landed + mpf + hmf: bad(f"ext: fees arithmetic {hs}")
    fs = fnum(r["fees_share_upper"])
    if fs is not None and not (0 <= fs <= 0.005): bad(f"ext: fees_share_upper {fs} {hs}")
    gw = fnum(c["gm_wholesale"]); two = fnum(r["mult_wholesale_two_tier"])
    if not close(two, 1 / (1 - gw) ** 2): bad(f"ext: two_tier {hs}")
    if not close(fnum(r["cost_share_one_tier_wholesale"]), 1 - gw) or not close(fnum(r["cost_share_two_tier_wholesale"]), (1 - gw) ** 2): bad(f"ext: cost_share {hs}")
    mrv = fnum(c["mult_retail_via_wholesale"]); cvr = fnum(r["cost_share_via_retail"])
    if (mrv is None) != (cvr is None) or (mrv is not None and not close(cvr, 1 / mrv)): bad(f"ext: cost_share_via_retail {hs}")
    ul = fnum(c["unit_landed_ytd"]); uw2 = fnum(r["unit_wholesale_two_tier"]); ui = fnum(r["unit_landed_incl_fees_upper"])
    if ul is not None:
        if uw2 is None or not close(uw2, ul * two, rel=1e-6): bad(f"ext: unit_wholesale_two_tier {hs}")
        q = inum(c["qty_ytd"])
        if ui is None or not close(ui, incl / q, rel=1e-6): bad(f"ext: unit_landed_incl_fees_upper {hs}")
    bea = fnum(r["bea2007_producer_to_purchaser"])
    if bea is not None:
        cs = {"one_tier_wholesale": 1 - gw, "two_tier_wholesale": (1 - gw) ** 2}
        if mrv: cs["via_retail"] = 1 / mrv
        nearest = min(cs, key=lambda k: abs(cs[k] - bea))
        if r["bea_nearest"] != nearest: bad(f"ext: bea_nearest {hs}")
    elif r["bea_nearest"]: bad(f"ext: bea_nearest without bea {hs}")
    if not r["formula"] or not r["caveat"] or not r["src_mpf"] or not r["src_hmf"] or len(r["src_import_sha256"]) != 64: bad(f"ext: text/source missing {hs}")
    rec = {k: r[k] for k in ("hs10", "period", "month", "bea_nearest", "formula", "caveat", "src_mpf", "src_hmf", "src_import", "src_import_sha256")}
    for k in ("customs_value_ytd_usd", "landed_duty_paid_ytd_usd", "mpf_upper_ytd_usd", "hmf_upper_ytd_usd", "landed_incl_fees_upper_ytd_usd", "qty_mo", "landed_duty_paid_mo_usd"):
        rec[k] = inum(r[k])
    for k in ("mpf_rate", "mpf_min_usd_per_entry", "mpf_max_usd_per_entry", "hmf_rate", "fees_share_upper", "unit_landed_incl_fees_upper", "unit_landed_mo", "duty_rate_eff_mo",
              "mult_wholesale_two_tier", "unit_wholesale_two_tier", "cost_share_one_tier_wholesale", "cost_share_two_tier_wholesale", "cost_share_via_retail",
              "bea2007_producer_to_purchaser", "bea_nearest_abs_diff"):
        rec[k] = fnum(r[k])
    rows.append(rec)
if set(chain) - seen: bad(f"ext: chain の hs10 が ext に無い: {len(set(chain) - seen)} 件")
if errs:
    print(f"検査で {len(errs)} 件の誤り。何も書かない。", file=sys.stderr)
    for e in errs[:30]: print("  " + e, file=sys.stderr)
    sys.exit(1)

os.makedirs(A.out, exist_ok=True)
MAX_STMT = 90_000; MAX_FILE = int(A.max_mb * 1024 * 1024)
out_files = []; cur = []; cur_size = 0
def lit(v):
    if v is None: return "NULL"
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
cols = list(rows[0].keys())
head = f"INSERT INTO trade_chain_ext (rid, {', '.join(cols)}) VALUES "
buf, size = [], len(head.encode("utf-8")) + 2
for i, r in enumerate(rows, start=1):
    t = "(" + ", ".join([str(i)] + [lit(r[c]) for c in cols]) + ")"; tb = len(t.encode("utf-8")) + 1
    if buf and size + tb > MAX_STMT: emit(head + ",".join(buf) + ";\n"); buf, size = [], len(head.encode("utf-8")) + 2
    buf.append(t); size += tb
if buf: emit(head + ",".join(buf) + ";\n")
built = {"built_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ym": YM, "rows": {"trade_chain_ext": len(rows)},
         "inputs_sha256": sha, "constants": summ.get("constants"), "bea_nearest": dict(collections.Counter(r["bea_nearest"] for r in rows if r["bea_nearest"]))}
emit("INSERT OR REPLACE INTO kake_meta (k, v) VALUES ('built_chain_ext', " + lit(json.dumps(built, ensure_ascii=False, sort_keys=True)) + ");\n")
flush()
man = {"built": built, "files": {f: hashlib.sha256(open(os.path.join(A.out, f), "rb").read()).hexdigest() for f in out_files},
       "apply_order": ["schema/0005_chain_ext.sql"] + [os.path.join(os.path.basename(os.path.normpath(A.out)), f) for f in out_files]}
json.dump(man, open(os.path.join(A.out, "MANIFEST.json"), "w"), indent=1, ensure_ascii=False)
print(json.dumps({"files": len(out_files), "bytes": sum(os.path.getsize(os.path.join(A.out, f)) for f in out_files), "rows": built["rows"], "bea_nearest": built["bea_nearest"]}, ensure_ascii=False))
