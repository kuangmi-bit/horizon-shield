-- hs-jccdb-obs v0.4.3: 施工込みの入札単価 ÷ 材料の陸揚げ原価(installed_over_landed)。州 DOT の入札単価(USCCDB の bid_item 層、NJDOT 2023Q2)と HS 10 桁の対応表。
-- DB_US(hs-jccdb-obs-us)にだけ当てる。0004・0005 の表には触らない(trade_chain・trade_chain_ext はそのまま、hs10 で結ぶ)。流し直すときはこのファイルから。
-- 中身は tools/make_d1_sql_installed.py の生成物だけ。値は hs-mcp の service binding からの呼び出しにだけ返す。
DROP TABLE IF EXISTS trade_installed_hs;
DROP TABLE IF EXISTS trade_installed;
CREATE TABLE trade_installed (
  rid INTEGER PRIMARY KEY, hs10_primary TEXT NOT NULL, hs10_set TEXT NOT NULL, hs_desc TEXT NOT NULL,
  bid_item TEXT NOT NULL, bid_spec TEXT NOT NULL, bid_unit TEXT NOT NULL, scope TEXT NOT NULL, area TEXT NOT NULL, bid_basis TEXT NOT NULL, bid_period TEXT NOT NULL,
  bid_price_usd REAL NOT NULL, awarded_qty REAL, awarded_dollars_usd REAL, n_occurrences INTEGER, representative INTEGER NOT NULL,
  bid_source TEXT NOT NULL, bid_evidence_url TEXT NOT NULL, bid_source_page TEXT, bid_license TEXT NOT NULL,
  landed_usd_per_kg REAL NOT NULL, landed_period TEXT NOT NULL, mult_contractor REAL NOT NULL,
  material_lb_per_bid_unit REAL NOT NULL, material_landed_usd_per_bid_unit REAL NOT NULL, material_contractor_usd_per_bid_unit REAL NOT NULL,
  installed_over_landed REAL NOT NULL, installed_over_contractor_stage REAL NOT NULL,
  ppi_series TEXT NOT NULL, ppi_series_title TEXT NOT NULL, ppi_bid_period_avg REAL, ppi_bid_period_months INTEGER, ppi_landed_period_avg REAL, ppi_landed_period_months INTEGER,
  ppi_factor REAL, bid_price_landed_period_est REAL, installed_over_landed_ppi_adj REAL,
  conversion_confidence TEXT NOT NULL, conversion_basis TEXT NOT NULL, computed_from TEXT,
  reading TEXT NOT NULL, formula TEXT NOT NULL, caveat TEXT NOT NULL,
  src_bid TEXT NOT NULL, src_chain_import TEXT NOT NULL, src_chain_import_sha256 TEXT NOT NULL, src_ppi TEXT
);
CREATE INDEX trade_installed_item ON trade_installed(bid_item, scope);
-- 1 つの入札項目が複数の HS(銅線の 7408.19 の 2 本など)に対応するので、hs10 ごとに引ける結び表を持つ
CREATE TABLE trade_installed_hs (hs10 TEXT NOT NULL, rid INTEGER NOT NULL, PRIMARY KEY (hs10, rid));
