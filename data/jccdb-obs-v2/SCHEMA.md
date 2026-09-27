# JCCDB observation layer v2: columns and statuses

Japanese: [SCHEMA.ja.md](SCHEMA.ja.md)

One row = one observation = (item x region x point in time x source). Japan and the United States use the same columns.
The JCCDB v4 catalogue (95,403 items: category, item_name, unit and an evidence URL) records that an item exists in a public document. The observation layer records where, when and at what price (or why no public value exists).

## Columns

| Column | Meaning |
|---|---|
| obs_id | 16 hex digits, obs_common.make_id(source_id, the values that identify the row...). The same input always gives the same id |
| country | JP / US |
| layer | material (materials and products) / labor (publicly set labor rates and wage determinations) / work (unit prices of work: material, labor and equipment combined) / equipment (equipment ownership and operating rates) / index (indexes) / wage (statistical wages) / bid_item (aggregated bid prices) / cost_sqft (statistics of cost per floor area) / spending (statistics of construction put in place and spending) / cost_limit (statutory cost limits) / house_price (house price statistics) |
| category | chapter or class in the source, in the source's own words |
| item_name | name of the item, trade, work item or series, in the source's own words |
| spec | specification, size or condition, exactly as printed |
| unit | unit exactly as printed (m3, t, 本, 人日, USD/hour, index (2003Q1 = 1), and so on) |
| geo_level | national / bureau_area / pref / pref_area / city / census_region / state / metro / county / district / place |
| geo_code | JP or US for national; JIS two digits for prefectures; FIPS two digits for states; FIPS five digits for counties; CBSA and similar for metros; for bureau_area the prefecture code when known |
| geo_name | name of geo_code (prefecture or state name) |
| area_label | the source's own area label, unchanged |
| area_code | the source's own area code |
| area_members | the municipalities and so on that the area contains, as written in the source |
| price | the value, only when the status is open; a plain number without digit separators |
| currency | JPY / USD; empty for indexes |
| price_basis | what the value is (obs_common.PRICE_BASES): design_unit_price_ex_tax, labor_wage_8h, work_unit_price_ex_tax, index_value, wage_hourly_mean, bid_weighted_avg, equipment_rate_hourly, and so on |
| price_status | see the table below |
| ref_value / ref_note | a reference value and what it is (for example the "reference value including necessary expenses" printed next to a labor rate, or the seasonally adjusted value of an index) |
| period | point in time: YYYY / YYYY-MM / YYYY-MM-DD / YYYYQn / FYYYYY / YYYYHn |
| effective_from | effective date when known (YYYY-MM-DD) |
| source_id | the ledger file sources/<source_id>.json |
| source_page | page in the original (PDF page number, or the page number printed in the original) |
| evidence_url | URL of the original |
| license | PDL1.0 / GOV-STD-2.0 / CC-BY-4.0 / US-PD-17USC105 / PD / OPEN-TERMS / restricted |
| jccdb_v4_item_id | the JCCDB v4 item_id when the row could be linked to an item |
| note | what to keep in mind when reading the row |

## price_status

| Status | Value | Meaning |
|---|---|---|
| published_pdl | present | published by the source and redistributable under the Public Data License 1.0 (Japan) |
| published_cc_by | present | Japanese Government Standard Terms of Use 2.0 or CC BY 4.0 |
| public_domain | present | a work of the U.S. federal government or another public-domain value |
| published_open_terms | present | the source's terms explicitly allow reuse (the text is quoted in the ledger) |
| published_restricted_not_copied | absent | the source publishes a value but its terms do not allow redistribution; read it in the original |
| publication_based_not_public | absent | the source's table uses values from a commercial price publication and publishes no value; no publicly published value exists |
| not_set | absent | blank, "-", or 0 in a unit price table (no market, and so on): not set for that area and time; not zero yen |

A 0 in a count or an amount in statistics (for example no housing starts of that kind) is the value zero: price is 0 and the status is open. This is allowed only when price_basis is count / construction_cost_planned_total / orders_received_total / spending_* / ratio. A 0 in a unit price table is not_set.

## Source ledgers: sources/<source_id>.json

Required: source_id, country, title, publisher, url, retrieved_at, license, license_url, license_quote (the terms quoted verbatim), how_read (how the file was read and checked), values_copied (whether values were copied), sha256 (of the original file, or of the saved API response). When the terms require attribution, attribution as well.

## Directories

| Directory | Contents | In the public build (the D1 database behind hs-jccdb-obs) |
|---|---|---|
| observations/ | rows from sources whose values may be included, and rows that record only the status without copying a value | yes |
| observations_restricted/ | sources whose table itself forbids reproduction, reprinting or electronic processing (the ledger says row_listing = not_in_public_build and why); no values | rows are not included; only the counts appear in the coverage |
| observations_hold/ | rows held back because the original is suspected to be wrong (for example a suspected column shift in a deflator table) | no |
| raw/ | originals of sources that may be redistributed | n/a |
| raw_restricted/ | originals of sources that may not be redistributed (not in the repository) | n/a |

After re-running a parser, always run tools/apply_decisions_20260926.py (it applies the licence and quality decisions; running it again gives the same result).

## Checking

    python3 tools/validate_obs.py . [--only observations/jp/xxx.csv ...] [--json output]

Every row is counted by machine. A single error gives exit code 1.
