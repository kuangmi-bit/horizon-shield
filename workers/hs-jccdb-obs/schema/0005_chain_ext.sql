-- hs-jccdb-obs v0.4.2: 各段の価格(trade_chain)の足し表。MPF・HMF の上限、直近月の陸揚げと実効関税率、卸 2 段の上限、原価率(cost_share)、BEA 2007 との照合。
-- DB_US(hs-jccdb-obs-us)にだけ当てる。0004 の表には触らない(trade_chain はそのまま、hs10 で結ぶ)。流し直すときはこのファイルから。
-- 中身は tools/make_d1_sql_chain_ext.py の生成物だけ。値は hs-mcp の service binding からの呼び出しにだけ返す。
DROP TABLE IF EXISTS trade_chain_ext;
CREATE TABLE trade_chain_ext (
  rid INTEGER PRIMARY KEY, hs10 TEXT NOT NULL, period TEXT NOT NULL, month TEXT NOT NULL,
  customs_value_ytd_usd INTEGER NOT NULL, landed_duty_paid_ytd_usd INTEGER NOT NULL,
  mpf_rate REAL NOT NULL, mpf_min_usd_per_entry REAL NOT NULL, mpf_max_usd_per_entry REAL NOT NULL, hmf_rate REAL NOT NULL,
  mpf_upper_ytd_usd INTEGER NOT NULL, hmf_upper_ytd_usd INTEGER NOT NULL, landed_incl_fees_upper_ytd_usd INTEGER NOT NULL,
  fees_share_upper REAL, unit_landed_incl_fees_upper REAL,
  qty_mo INTEGER, landed_duty_paid_mo_usd INTEGER, unit_landed_mo REAL, duty_rate_eff_mo REAL,
  mult_wholesale_two_tier REAL NOT NULL, unit_wholesale_two_tier REAL,
  cost_share_one_tier_wholesale REAL NOT NULL, cost_share_two_tier_wholesale REAL NOT NULL, cost_share_via_retail REAL,
  bea2007_producer_to_purchaser REAL, bea_nearest TEXT, bea_nearest_abs_diff REAL,
  formula TEXT NOT NULL, caveat TEXT NOT NULL, src_mpf TEXT NOT NULL, src_hmf TEXT NOT NULL, src_import TEXT NOT NULL, src_import_sha256 TEXT NOT NULL
);
CREATE UNIQUE INDEX trade_chain_ext_hs ON trade_chain_ext(hs10);
