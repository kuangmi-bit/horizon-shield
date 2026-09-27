# JCCDB observation layer v2 (2026-09-26)

Japanese: [README.ja.md](README.ja.md). Columns and statuses: [SCHEMA.md](SCHEMA.md). Ingestion rules for the agents that build this layer: [AGENT_RULES.md](AGENT_RULES.md) (Japanese).

JCCDB v4 (95,403 items) records, one row per item, that an item exists in a public document. It holds no region, date or price.
The observation layer records, one row per observation, in which region, at what point in time, in which source, and at what price (or why no public value exists). v2 puts Japan and the United States in the same columns.

- 3,206,783 rows in total (3,185,391 in the public build, 20,402 from sources that appear only as counts, 990 kept as printed in the original)
- 3,046,920 rows with a value
- 2,458 sources (ledgers in sources/). The checker tools/validate_obs.py reports 0 errors across all rows.
- Column and status definitions: SCHEMA.md. Ingestion rules: AGENT_RULES.md.

Released as two datasets with the same columns: **JCCDB v5.0** (Japan, 330,362 rows, https://doi.org/10.5281/zenodo.22980284, catalogue repository https://github.com/ogasurfproject-jpg/japan-construction-cost-database) and **USCCDB v1.0** (United States, 2,849,829 rows, https://doi.org/10.5281/zenodo.22979157, catalogue repository https://github.com/ogasurfproject-jpg/united-states-construction-cost-database). The release files are built from this directory; rows from restricted sources are left out of the releases.

## Contents

| Directory | Country | Family | Files | Rows | With value |
|---|---|---|---:|---:|---:|
| observations | jp | cost_sqft_mlit_chakko | 2 | 36,819 | 36,819 |
| observations | jp | index_mlit_deflator | 1 | 11,475 | 11,475 |
| observations | jp | index_mlit_deflator_nendo | 1 | 5,460 | 3,919 |
| observations | jp | index_mlit_deflator_realigned | 1 | 990 | 960 |
| observations | jp | index_mlit_shinei_yosan | 1 | 200 | 200 |
| observations | jp | labor_mlit_gijutsusha | 18 | 353 | 353 |
| observations | jp | labor_mlit_roumu | 14 | 32,571 | 30,038 |
| observations | jp | material_cbr_tokuchou_shizai | 1 | 744 | 688 |
| observations | jp | material_cgr_zairyo | 1 | 20,055 | 11,982 |
| observations | jp | material_hkd_zairyo | 1 | 45,320 | 44,492 |
| observations | jp | material_hrr_zairyo | 1 | 4,947 | 4,947 |
| observations | jp | material_kkr_namacon | 6 | 5,080 | 5,080 |
| observations | jp | material_kkr_zairyo | 2 | 48,394 | 34,567 |
| observations | jp | material_ktr_zairyo_as | 5 | 680 | 365 |
| observations | jp | material_ktr_zairyo | 1 | 4,077 | 3,420 |
| observations | jp | material_nara_namacon_status | 1 | 1,584 | 0 |
| observations | jp | material_ogb_zairyo | 1 | 515 | 512 |
| observations | jp | material_qsr_zairyo | 1 | 22,514 | 22,513 |
| observations | jp | spending_mlit_reform | 1 | 804 | 800 |
| observations | jp | work_mlit_sekou_package | 1 | 9,277 | 9,177 |
| observations | jp | work_mlit_sekou_package_ratio | 2 | 79,655 | 79,655 |
| observations | jp | work_mlit_shinei_yosan | 1 | 432 | 217 |
| observations | us | bid_item_fhwa_pricetrends | 1 | 3,834 | 3,317 |
| observations | us | bid_item_mtdot | 1 | 718 | 0 |
| observations | us | bid_item_njdot | 1 | 8,608 | 8,608 |
| observations | us | bid_item_sddot | 1 | 2,898 | 0 |
| observations | us | cost_limit_hud_tdc | 1 | 23,296 | 23,296 |
| observations | us | cost_sqft_census_newhousing | 1 | 730 | 730 |
| observations | us | cost_sqft_city_permits_austin | 1 | 56 | 56 |
| observations | us | cost_sqft_city_permits_boston | 1 | 32 | 32 |
| observations | us | cost_sqft_city_permits_neworleans | 1 | 46 | 46 |
| observations | us | cost_sqft_city_permits_nyc | 1 | 73 | 73 |
| observations | us | cost_sqft_city_permits_sandiego | 1 | 11 | 11 |
| observations | us | cost_sqft_dod_ufc370101 | 1 | 1,118 | 370 |
| observations | us | equipment_fema | 1 | 465 | 465 |
| observations | us | equipment_usace_ep1110 | 2 | 95,520 | 95,520 |
| observations | us | house_price_census_newhousing | 1 | 1,056 | 1,008 |
| observations | us | index_bls_cpi_repair | 1 | 374 | 325 |
| observations | us | index_bls_eci | 1 | 714 | 714 |
| observations | us | index_bls_ppi | 1 | 32,892 | 32,855 |
| observations | us | index_bls_ppi_fd | 1 | 384 | 384 |
| observations | us | index_bls_ppi_resid | 1 | 3,237 | 3,098 |
| observations | us | index_census_cqpi | 1 | 1,383 | 1,383 |
| observations | us | index_dod_acf | 1 | 32,978 | 32,978 |
| observations | us | index_fhwa_nhcci | 1 | 93 | 93 |
| observations | us | index_usace_cwccis | 1 | 8,503 | 8,503 |
| observations | us | labor_dol_davis_bacon | 30 | 133,962 | 133,958 |
| observations | us | spending_census_bps_county | 11 | 458,114 | 458,114 |
| observations | us | spending_census_bps_metro | 11 | 87,054 | 87,054 |
| observations | us | spending_census_bps_place | 11 | 799,991 | 799,991 |
| observations | us | spending_census_bps_state | 1 | 11,718 | 11,718 |
| observations | us | spending_census_econ2022_construction | 1 | 77,330 | 71,332 |
| observations | us | spending_census_vip | 1 | 28,320 | 28,320 |
| observations | us | spending_city_permits_austin | 1 | 653 | 595 |
| observations | us | spending_city_permits_boston | 1 | 1,583 | 1,579 |
| observations | us | spending_city_permits_neworleans | 1 | 2,196 | 1,992 |
| observations | us | spending_city_permits_nyc | 1 | 369 | 369 |
| observations | us | spending_city_permits_sandiego | 1 | 820 | 657 |
| observations | us | spending_city_permits_seattle | 1 | 599 | 598 |
| observations | us | spending_city_permits | 1 | 1,343 | 1,326 |
| observations | us | wage_bls_oews | 5 | 187,993 | 186,599 |
| observations | us | wage_bls_oews_metro | 2 | 131,521 | 130,951 |
| observations | us | wage_bls_qcew | 10 | 706,488 | 611,937 |
| observations | us | work_dod_ufc370101 | 1 | 864 | 0 |
| observations | us | work_fta_capcost | 1 | 3,508 | 2,796 |
| observations_hold | jp | index_mlit_deflator_nendo_suspect_shift | 1 | 165 | 165 |
| observations_hold | jp | index_mlit_deflator_suspect_shift | 1 | 825 | 825 |
| observations_restricted | jp | material_cbr_zairyo | 1 | 7,896 | 0 |
| observations_restricted | jp | material_skr_zairyo | 1 | 6,412 | 0 |
| observations_restricted | jp | material_thr_zairyo | 1 | 6,094 | 0 |

## Decisions added in the second half of 2026-09-26

- Nara prefecture table: the 1,584 status rows (commercial-publication price / value published by the prefecture / blank) were returned to the public build. The prefecture's wording is a copyright notice; the specification names and the statuses are facts. The prefecture's amounts are not copied.
- Design material price tables of the Chubu, Tohoku and Shikoku regional development bureaus: the tables say "input to magnetic media is prohibited", which goes beyond copyright, so they stay as counts only. The Chubu special survey (materials) report list carries no rights notice, so it was included with values (744 rows). The draft requests for permission to the three bureaus and to Nara are drafts not yet sent and are not kept in the public repository (they are with the operator).
- Construction cost deflator: 800 quarterly cells and 160 fiscal-year cells were placed one column to the right of their headings. They matched the monthly averages within 0.1 in every cell, so they were reattached to the correct series (index_mlit_deflator_realigned.csv). The 30 cells with no value in any column are not_set. The rows as printed in the original are kept in observations_hold/.
- Zeros in statistics (housing starts, building permits, the Economic Census, Davis-Bacon fringe benefits, equipment fuel cost) are the value 0. Zeros in unit price tables are not_set.
- Davis-Bacon: the values are public domain. Retrieval was stopped as soon as it became clear that the SAM.gov terms of use prohibit automated retrieval. The 30 states retrieved by then (AK to MT) are included. The rest are not retrieved automatically.
- Line for commercial publications: values that the original says were copied from, or converted only from, a commercial price publication are not included (628 rows derived from RSMeans in UFC 3-701-01, DoD Table 6). Values that a government body computed or synthesised itself from several sources (CWCCIS) and values set as statutory limits (HUD TDC) are government works and are included.
- Files over 45 MB are split by rows to stay under the GitHub limit (split_large in apply_decisions). raw/ is not in the repository.
- Independent verification (V4, V5): all new Japanese rows and 2,632,645 new U.S. rows match their originals (0 mismatches). The 284,850 derived rows match a fresh recomputation.

## Licence decisions (sources whose values are not included)

- The tables of the Chubu (cbr), Tohoku (thr) and Shikoku (skr) regional development bureaus and of Nara prefecture forbid copying, reprinting and input to magnetic media (electronic processing); the rights notice on the table prevails over the site-wide PDL 1.0. Neither values nor row lists enter the public build; only the counts, the reason and the URL of the original (observations_restricted/).
- South Dakota and Montana DOT (United States): the terms allow "personal or informational use" only (Montana adds "as long as it is not modified"). Values are not copied; only the item lists.
- Texas DOT requires written permission. Florida DOT holds copyright under state law with no clause that allows reuse. Neither was ingested (reports/U3-us-state-dot.md).
- No values from commercial price publications (Kensetsu Bukka, Sekisan Shiryo and the like) from any source. Rows that a table marks as "publication" or "price publication" are publication_based_not_public (no value).

## Quality decisions

- The 33 columns (990 rows) of the construction cost deflator for quarters from April to June 2020 onward and fiscal years from FY2021 onward are strongly suspected to be shifted one column to the right relative to the monthly table (the four-quarter average matches the fiscal-year figure but not the monthly figures, and the composite index falls outside the range of its components). Held in observations_hold/. A query to MLIT (Construction Economics Statistics Office) is recommended. The monthly table is usable.
- Zeros in counts and amounts in statistics are values (price 0). Zeros in unit price tables are not_set.

## Independent verification (three parties other than the builders, all rows, by machine)

- All 273,760 Japanese rows with a value (at the time) match the page and cell of the original. Zero mix-ups of area or trade columns (detection power was checked by injecting mix-ups: PDF 3,695 of 3,701, Excel 738 of 739). reports/verify/V1-REPORT.md
- All 111,106 U.S. rows with a value match the cell of the original (BLS flat files, OEWS, Census, FEMA, NJDOT). reports/verify/V2-REPORT.md
- SHA-256 of originals: Japan 66 of 66, United States 25 of 25 match the ledgers (after the three originals that had been left out were placed in raw/).
- Licence texts: for the 85 sources with open terms, 50 ledgers whose quotation was not letter for letter (replaced brackets, heading joined to body) were corrected to match the page (the content is unchanged).
- Found and fixed by verification: 4,927 rows where a statistical 0 had been marked not_set, 4 NJDOT item names missing a "-", 2,862 SD rows with the bid count left in the note, 3 originals that had not been placed.

## How to rebuild

    # 1. parsers (tools/parsers/) produce the CSV files (originals in raw/ and raw_restricted/)
    # 2. apply the decisions (idempotent)
    python3 tools/apply_decisions_20260926.py
    # 3. check
    python3 tools/validate_obs.py . --json reports/validate_all.json
    # 4. SQL for D1 (hs-jccdb-obs)
    python3 <hs-jccdb-obs>/tools/make_d1_sql_v3.py . --country JP --out <hs-jccdb-obs>/sql_jp

## Attribution

When you use a value, show the attribution recorded in the ledger of the row's source_id (PDL 1.0 / Government Standard Terms of Use / CC BY / OPEN-TERMS). Example: "Source: Ministry of Land, Infrastructure, Transport and Tourism website (URL), processed". U.S. federal public-domain values carry no attribution requirement, but cite the source anyway.

Public-works design prices, bid prices and statistics are not renovation quotes. When a value is used to judge an estimate, say what the value is.
