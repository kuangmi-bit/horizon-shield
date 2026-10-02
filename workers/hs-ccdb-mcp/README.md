# HORIZON SHIELD Construction Cost Data (JCCDB + USCCDB)

An MCP server (Streamable HTTP, stateless, no key) for public construction cost data:

- Japan, JCCDB v5.0: 425,765 records, 95,403 line items and 330,362 source-cited observations. DOI [10.5281/zenodo.22980284](https://doi.org/10.5281/zenodo.22980284)
- United States, USCCDB (United States Construction Cost Database). DOI [10.5281/zenodo.22979157](https://doi.org/10.5281/zenodo.22979157)

Endpoint: `https://ccdb.horizonshield.dev/mcp`

| Tool | What it returns |
|---|---|
| `search_jccdb_items` | JCCDB line items by name, with evidence URLs |
| `get_jccdb_observations` | Where and when an item appears in public documents, with its price or the reason it is not public |
| `get_jccdb_labor_rate` | MLIT public-works design labor rates by prefecture and trade |
| `compare_jccdb_regions` | Latest value per region for the same item, spec and unit |
| `get_jccdb_work_unit_price` | Public-works unit prices for work items, with composition rows |
| `get_jccdb_index_series` | Construction cost index series with year-over-year change |
| `get_jccdb_coverage` | What exists and what does not, before answering |
| `get_us_construction_prices` | U.S. public data across layers (wages, bids, equipment, indexes, permits, cost limits) |
| `get_us_prevailing_wage` | Davis-Bacon base and fringe by state, county and trade |
| `get_us_permits` | Census building permits and city permit valuations |
| `get_us_area_factor` | DoD Area Cost Factors and USACE state adjustments |
| `get_us_price_chain` | A material's price from landed import cost to wholesale, retail and contractor |
| `get_us_import_landed_cost` | Landed import cost by HS code and partner country |
| `get_us_trade_margins` | Wholesale and retail gross margins and the BEA margin structure |
| `get_us_contract_discounts` | Public contract discounts off list price |

Every row carries its source URL and licence. Values this service computes are marked `computed:true`. A lookup that could not be made comes back as `fetch_failed:true`, never as zero rows. Public-works unit prices, statistics and chain estimates are reference data, not renovation quotes.

To check whether a Japanese renovation quote is fair, use the HORIZON SHIELD server: `https://mcp.horizonshield.dev/mcp`. The two servers were one until 2026-10-02; the data tools moved here so each server does one job. The moved tools still answer on the old server for now, with a pointer here.

The tool definitions are generated from what the old server served (`build/build_worker.py`, `build/data_tools.json`), so names, descriptions and schemas did not change in the move. Test, offline: `node test/ccdb.test.mjs`.
