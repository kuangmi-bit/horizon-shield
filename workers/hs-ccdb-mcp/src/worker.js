// hs-ccdb-mcp: HORIZON SHIELD Construction Cost Data (JCCDB + USCCDB), MCP over Streamable HTTP.
// 2026-10-02: the 15 data tools moved here from hs-mcp so each server has one job (hs-mcp: fair-price audit, 15 tools;
// this server: construction cost data, 15 tools). Names, descriptions and schemas are the ones hs-mcp served, byte for byte
// (built by build_worker.py from data_tools.json). Every call is forwarded to hs-jccdb-obs over a service binding.
// "Could not fetch" and "fetched zero rows" are never the same value (fetch_failed:true vs count:0).
// Generated file. Edit build_worker.py, not this file.

const SERVER = { name: "horizon-shield-construction-cost-data", title: "HORIZON SHIELD Construction Cost Data (JCCDB + USCCDB)", version: "1.0.0" };
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "HORIZON SHIELD Construction Cost Data: public construction cost data for Japan (JCCDB) and the United States (USCCDB, the United States Construction Cost Database), as tools. Japan: search_jccdb_items for the line items of JCCDB v5.1 (526,128 records: 95,403 line items and 430,725 source-cited observations); get_jccdb_observations, get_jccdb_labor_rate, compare_jccdb_regions, get_jccdb_work_unit_price and get_jccdb_index_series for dated, sourced values; get_jccdb_coverage to see what exists before answering. United States: get_us_construction_prices, get_us_prevailing_wage, get_us_permits and get_us_area_factor for public data; get_us_price_chain, get_us_import_landed_cost, get_us_trade_margins and get_us_contract_discounts for distribution-chain estimates (landed import cost, wholesale, retail, contractor), computed on request and not distributed as files. Every row carries its source URL and licence, and values computed by this service are marked computed:true. A lookup that could not be made is returned as fetch_failed:true, never as zero rows. Public-works unit prices, statistics and chain estimates are reference data, not renovation quotes. To check whether a Japanese renovation quote is fair, use the HORIZON SHIELD server at https://mcp.horizonshield.dev/mcp. / 建設費のデータ(日本は JCCDB、米国は USCCDB = United States Construction Cost Database)を道具で引く口。品目は search_jccdb_items(JCCDB v5.1 は計 526,128 件、うち品目 95,403)、地域・時点・値は get_jccdb_observations・get_jccdb_labor_rate・compare_jccdb_regions・get_jccdb_work_unit_price・get_jccdb_index_series、何があるかは get_jccdb_coverage で先に確かめる。米国の公的データは get_us_construction_prices・get_us_prevailing_wage・get_us_permits・get_us_area_factor、流通の各段の推計(輸入の陸揚げ原価・卸・小売・元請)は get_us_price_chain・get_us_import_landed_cost・get_us_trade_margins・get_us_contract_discounts(問われたときに計算して返し、ファイルとしては配らない)。各行に出典の URL と利用条件が付き、このサービスが計算した値には computed:true が付く。取りに行けなかった時は fetch_failed:true で返し、0 件とは言わない。公共工事の単価・統計・推計は参照値で、リフォームの見積単価ではない。リフォームの見積もりが適正かは HORIZON SHIELD の口(https://mcp.horizonshield.dev/mcp)で確かめる。";
const TOOLS = [
 {
  "name": "search_jccdb_items",
  "title": "Search JCCDB Line Items",
  "annotations": {
   "title": "JCCDB 品目検索",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "日本の建設費オープンデータ JCCDB(v5.1 は計526,128件)の品目の目録(95,403)を名前で探す。生コン・異形棒鋼・ヒューム管・側溝など資材や製品、労務の品目が公的資料に実在するかと証拠URLを返す。工事カテゴリ(search_cost_category)に無い資材はこちら。地域・時点・価格は get_jccdb_observations。 / Search the JCCDB item catalogue (95,403 line items of the 526,128 records in v5.1; materials, products, labor) by name; returns whether each exists in a public document, with its evidence URL. Use for materials that are not renovation work categories.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "品目名(日本語。例: 生コンクリート 21-8-25)。 / Item name in Japanese."
    },
    "category": {
     "type": "string",
     "description": "(任意) JCCDB のカテゴリ名で絞る。 / optional JCCDB category."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 50,
     "description": "返す行の上限(1〜50)。 / Maximum rows to return (1 to 50)."
    }
   },
   "required": [
    "query"
   ]
  },
  "outputSchema": {
   "type": "object",
   "description": "JCCDB の品目の目録(95,403、v5.1 は観測を含め計526,128件)の名前検索。 / Name search over the JCCDB item catalogue (95,403 line items; v5.1 has 526,128 records including observations).",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "description": "当たった件数 / matches"
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "items": {
     "description": "品目(名前・カテゴリ・単位・evidence_url) / line items with evidence URLs"
    },
    "observations_by_layer": {
     "description": "観測層にある件数 / observation rows by layer"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_jccdb_observations",
  "title": "Get JCCDB Observations (region, date, price status; Japan and U.S.)",
  "annotations": {
   "title": "JCCDB 観測(地域・時点・価格状態)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "品目が『どの地域・地区で・いつ・いくらで(または非公開の理由)』公的資料に載っているかを返す(日本と米国)。値は再配布を許す出典のときだけ入り、各行に license・attribution・evidence_url が付く。県が刊行物単価を使って値を公開していない地区は publication_based_not_public と返す(欠落ではなく事実)。例: query='生コンクリート', pref='奈良県'。公共工事の設計単価であり、リフォームの見積単価ではない。 / Region, date and price status of an item in Japanese and U.S. public documents. Values only where the licence allows redistribution; every row carries licence, attribution and evidence URL; cells where the public body uses commercial price publications are reported as such, not guessed.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "品目名(例: 生コンクリート)。 / Item name."
    },
    "pref": {
     "type": "string",
     "description": "都道府県(奈良県 / 奈良 / nara)。 / Prefecture."
    },
    "geo": {
     "type": "string",
     "description": "地域: 都道府県名・JIS コード(29, JP-29)、州名・略号・FIPS(California, CA, US-06)。 / Region: prefecture name or JIS code, U.S. state name, abbreviation or FIPS."
    },
    "country": {
     "type": "string",
     "enum": [
      "JP",
      "US"
     ],
     "description": "国で絞る: JP 日本、US 米国。 / Country filter: JP for Japan, US for the United States."
    },
    "layer": {
     "type": "string",
     "enum": [
      "material",
      "labor",
      "work",
      "equipment",
      "index",
      "wage",
      "bid_item",
      "cost_sqft",
      "spending",
      "house_price",
      "cost_limit"
     ],
     "description": "データの種類: material 資材、labor 労務単価、work 工事の単価、equipment 機械損料、index 指数、wage 賃金統計、bid_item 入札の品目単価、cost_sqft 面積あたり工事費、spending 工事支出と建築許可、house_price 住宅価格、cost_limit 費用の上限。国ごとの有無は get_jccdb_coverage で確かめる。 / Data type: material, labor (design labor rates), work (work-item unit prices), equipment (rental rates), index, wage (wage statistics), bid_item (bid unit prices), cost_sqft (cost per square foot), spending (construction spending and permits), house_price, cost_limit. Check availability per country with get_jccdb_coverage."
    },
    "status": {
     "type": "string",
     "enum": [
      "published_pdl",
      "published_cc_by",
      "public_domain",
      "published_open_terms",
      "published_restricted_not_copied",
      "publication_based_not_public",
      "not_set"
     ],
     "description": "値の公開状態で絞る: published_pdl・published_cc_by・public_domain・published_open_terms は値あり、published_restricted_not_copied は出典はあるが値を写していない、publication_based_not_public は県が刊行物単価を使い値を公開していない地区、not_set は未判定。 / Publication status filter: the first four carry values; published_restricted_not_copied cites the source without copying values; publication_based_not_public marks districts whose prefecture uses commercial price books and publishes no value; not_set is unclassified."
    },
    "period": {
     "type": "string",
     "description": "時点(2026, 2026-09, 2025Q4, FY2025)。 / Period."
    },
    "source_id": {
     "type": "string",
     "description": "出典 ID(get_jccdb_coverage で分かる)。 / Source id."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "地域・時点・値(か非公開の理由)の観測。 / Observations by region and date, with price status.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "1 行 1 観測(値・単位・状態・license・attribution・evidence_url) / one row per observation"
    },
    "by_status": {
     "description": "状態別の件数 / counts by price status"
    },
    "license_note": {
     "description": "利用条件 / licence note"
    },
    "next_offset": {
     "description": "続きの offset / next page"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_jccdb_labor_rate",
  "title": "Get Public-Works Design Labor Rate (Japan)",
  "annotations": {
   "title": "公共工事設計労務単価",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "国交省の公共工事設計労務単価(47都道府県 x 50職種、所定労働時間内8時間あたりの賃金)を引く。既定は地域ごとの最新の時点、history:true で年ごとの系列。例: pref='奈良県', job='大工'。 / MLIT public-works design labor rates by prefecture and trade (wage per 8 hours); latest by default, yearly series with history:true.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "pref": {
     "type": "string",
     "description": "都道府県。 / Prefecture."
    },
    "job": {
     "type": "string",
     "description": "職種(例: 大工, 左官, 特殊作業員)。 / Trade in Japanese."
    },
    "history": {
     "type": "boolean",
     "description": "true で年ごとの系列。 / true for the yearly series."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 200,
     "description": "返す行の上限(1〜200)。 / Maximum rows to return (1 to 200)."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "公共工事設計労務単価。 / MLIT public-works design labor rates.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "都道府県 x 職種の賃金(8 時間あたり) / wage per 8 hours by prefecture and trade"
    },
    "periods": {
     "description": "時点 / periods"
    },
    "sources_used": {
     "description": "出典 / sources"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "compare_jccdb_regions",
  "title": "Compare JCCDB Values Across Regions (latest)",
  "annotations": {
   "title": "地域ごとの比較(最新時点)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "品目と規格で、地域ごとの最新時点の値を並べ、最小・中央・最大と状態別の件数を返す。規格・単位・値の種類が同じものだけを比べる(普通と高炉は別の組)。中央値はこのサービスの計算(computed:true)。例: query='生コンクリート', spec='24-8-25(20)', layer='material', normalize='namacon'(局ごとの規格の書き方の違いを越えて束ねる)。 / Latest value per region for an item and spec, with min, median (computed) and max and counts by price status; only identical spec, unit and basis are compared.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "品目名。 / Item name."
    },
    "spec": {
     "type": "string",
     "description": "規格(例: 21-8-25(20))。 / Specification."
    },
    "country": {
     "type": "string",
     "enum": [
      "JP",
      "US"
     ],
     "description": "国で絞る: JP 日本、US 米国。 / Country filter: JP for Japan, US for the United States."
    },
    "layer": {
     "type": "string",
     "enum": [
      "material",
      "labor",
      "work",
      "equipment",
      "index",
      "wage",
      "bid_item",
      "cost_sqft",
      "spending",
      "house_price",
      "cost_limit"
     ],
     "description": "データの種類: material 資材、labor 労務単価、work 工事の単価、equipment 機械損料、index 指数、wage 賃金統計、bid_item 入札の品目単価、cost_sqft 面積あたり工事費、spending 工事支出と建築許可、house_price 住宅価格、cost_limit 費用の上限。国ごとの有無は get_jccdb_coverage で確かめる。 / Data type: material, labor (design labor rates), work (work-item unit prices), equipment (rental rates), index, wage (wage statistics), bid_item (bid unit prices), cost_sqft (cost per square foot), spending (construction spending and permits), house_price, cost_limit. Check availability per country with get_jccdb_coverage."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 20,
     "description": "比べる組(品目・規格・単位の組み合わせ)の上限(1〜20)。 / Maximum comparison groups to return (1 to 20)."
    },
    "normalize": {
     "type": "string",
     "enum": [
      "exact",
      "namacon"
     ],
     "description": "exact(既定: 規格の文字が同じものだけ)/ namacon(生コンの規格を局をまたいで束ねる: セメント・呼び強度-スランプ-骨材・水セメント比・単位セメント量)。 / namacon groups ready-mix concrete specs across bureaus."
    }
   },
   "required": [
    "query"
   ]
  },
  "outputSchema": {
   "type": "object",
   "description": "地域ごとの最新の値の比較。 / Latest value per region.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "groups": {
     "description": "規格・単位・値の種類ごとの組(最小・中央・最大) / groups with min, median, max"
    },
    "by_status": {
     "description": "状態別の件数 / counts by status"
    },
    "computed_note": {
     "description": "計算した値の説明 / computed fields"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_jccdb_work_unit_price",
  "title": "Get Public-Works Unit Prices for Work Items (Japan)",
  "annotations": {
   "title": "工事の単価(施工パッケージ等)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "工事の単価(材料・労務・機械の複合。施工パッケージ型積算の標準単価など)を引き、構成比の行を同じパッケージの行に添えて返す。公共土木の積算単価であり、リフォームの見積単価ではない。例: query='掘削', pref='東京都'。 / Public-works unit prices for work items (materials, labor and equipment combined), with composition-ratio rows attached to their package. Not renovation quote prices.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "工種・品目(例: 掘削)。 / Work item."
    },
    "pref": {
     "type": "string",
     "description": "都道府県。 / Prefecture."
    },
    "period": {
     "type": "string",
     "description": "時点(2026, 2026-09, 2025Q4, FY2025)。 / Period."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "工事の単価と構成比。 / Public-works unit prices with composition ratios.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "packages": {
     "description": "施工パッケージの単価 / unit price packages"
    },
    "composition_rows_attached": {
     "description": "添えた構成比の行数 / attached composition rows"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_jccdb_index_series",
  "title": "Get Construction Cost Index Series with Year-over-Year Change",
  "annotations": {
   "title": "指数の系列と前年同期比",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "建設費の指数(NHCCI、PPI、建設工事費デフレーター等)の系列を期間で返し、前年同期比を添える。前年同期比はこのサービスが計算した値(computed:true)で、原本には無い。query も source_id も無いときは系列の一覧。例: query='NHCCI', from='2020Q1'。 / Construction cost index series over a period with year-over-year change computed by this service (computed:true). Without query or source_id, lists the series.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "系列名(例: NHCCI)。 / Series name."
    },
    "country": {
     "type": "string",
     "enum": [
      "JP",
      "US"
     ],
     "description": "国で絞る: JP 日本、US 米国。 / Country filter: JP for Japan, US for the United States."
    },
    "source_id": {
     "type": "string",
     "description": "出典 ID で絞る(get_jccdb_coverage に detail:true を渡すと一覧が出る)。 / Source id filter; get_jccdb_coverage with detail:true lists the ids."
    },
    "from": {
     "type": "string",
     "description": "始め(2020, 2020Q1, 2020-01, FY2020)。 / Start period."
    },
    "to": {
     "type": "string",
     "description": "終わり(含む)。 / End period (inclusive)."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 20,
     "description": "返す系列の上限(1〜20)。 / Maximum series to return (1 to 20)."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "建設費の指数の系列。 / Construction cost index series.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "series": {
     "description": "系列(時点と値、前年同期比は computed:true) / series with computed year-over-year"
    },
    "yoy_note": {
     "description": "前年同期比の説明 / year-over-year note"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_construction_prices",
  "title": "Get U.S. Construction Prices (all layers: prevailing wages, wages, bids, equipment, permits, indexes, cost limits)",
  "annotations": {
   "title": "米国の建設費(全 layer)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国の公的な建設費データベースを layer・地域・時点・品目で引く: labor(Davis-Bacon の法定賃金)、wage(BLS OEWS・QCEW の賃金)、work(DoD・FTA の単価)、equipment(FEMA・USACE の機械損料)、index(PPI・NHCCI・CWCCIS・DoD の地域係数)、spending(Census の工事支出と建築許可、市の許可)、cost_sqft(面積あたり工事費)、cost_limit(HUD の 1 戸あたり上限)、bid_item(州 DOT の入札単価)、house_price、material。geo は州・郡 FIPS(county:06037)・都市圏(cbsa:31080)・市(Austin, TX)。州を指定すると全国一律の行と USACE の地域の行も添える。1m2 あたりへの換算は computed:true。住宅リフォームの見積単価ではない。 / The U.S. public construction cost database by layer, region (state, county FIPS, CBSA, place), period and item: Davis-Bacon prevailing wages, BLS wages, public unit costs, equipment rates, permits and spending, indexes and area factors, HUD cost limits and state DOT bid prices. National and USACE regional rows are added for a state; per-m2 conversions are computed:true. Not residential remodeling quotes.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "品目・職種(英語。例: excavation, carpenters)。 / Item or occupation in English."
    },
    "state": {
     "type": "string",
     "description": "州名・略号・FIPS(California, CA, 06, カリフォルニア)。 / State name, abbreviation or FIPS."
    },
    "geo": {
     "type": "string",
     "description": "州・郡 FIPS(county:06037)・都市圏 CBSA(cbsa:31080)・市(Austin, TX)・郡の名前(Los Angeles County, CA)。 / State, county FIPS, CBSA, place or county name."
    },
    "layer": {
     "type": "string",
     "enum": [
      "labor",
      "wage",
      "work",
      "equipment",
      "index",
      "spending",
      "cost_sqft",
      "cost_limit",
      "bid_item",
      "house_price",
      "material"
     ],
     "description": "データの種類: material 資材、labor 労務単価、work 工事の単価、equipment 機械損料、index 指数、wage 賃金統計、bid_item 入札の品目単価、cost_sqft 面積あたり工事費、spending 工事支出と建築許可、house_price 住宅価格、cost_limit 費用の上限。国ごとの有無は get_jccdb_coverage で確かめる。 / Data type: material, labor (design labor rates), work (work-item unit prices), equipment (rental rates), index, wage (wage statistics), bid_item (bid unit prices), cost_sqft (cost per square foot), spending (construction spending and permits), house_price, cost_limit. Check availability per country with get_jccdb_coverage."
    },
    "period": {
     "type": "string",
     "description": "時点(2024, 2025-05, 2025Q4, FY2026)。 / Period."
    },
    "source_id": {
     "type": "string",
     "description": "出典 ID で絞る(get_jccdb_coverage に detail:true を渡すと一覧が出る)。 / Source id filter; get_jccdb_coverage with detail:true lists the ids."
    },
    "include_national": {
     "type": "boolean",
     "description": "州を指定したとき全国一律・地域一律の行も返す(既定 true。郡・都市圏・市では既定 false)。 / Include national and regional rows (default true for a state)."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の公的な建設費データ(USCCDB)。 / U.S. public construction cost data (USCCDB).",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "1 行 1 観測 / one row per observation"
    },
    "by_layer": {
     "description": "種類別の件数 / counts by layer"
    },
    "license_note": {
     "description": "利用条件 / licence note"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_jccdb_coverage",
  "title": "Get JCCDB Observation Coverage (what exists, what does not)",
  "annotations": {
   "title": "何がどこまであるか",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "JCCDB の観測層に何がどこまであるかを返す: 国 x 種類(layer) x 出典の件数、値のある件数、状態別、出典の時点。0 行の組み合わせは absent に『無い(取り込んでいない)』と明記する。答える前に、その国・種類のデータがあるかをここで確かめる。 / What the JCCDB observation layer holds: rows per country x layer x source, priced rows, status counts and source periods; empty combinations are listed as absent (not ingested).",
  "inputSchema": {
   "type": "object",
   "properties": {
    "country": {
     "type": "string",
     "enum": [
      "JP",
      "US"
     ],
     "description": "国で絞る: JP 日本、US 米国。 / Country filter: JP for Japan, US for the United States."
    },
    "layer": {
     "type": "string",
     "enum": [
      "material",
      "labor",
      "work",
      "equipment",
      "index",
      "wage",
      "bid_item",
      "cost_sqft",
      "spending",
      "house_price",
      "cost_limit"
     ],
     "description": "データの種類: material 資材、labor 労務単価、work 工事の単価、equipment 機械損料、index 指数、wage 賃金統計、bid_item 入札の品目単価、cost_sqft 面積あたり工事費、spending 工事支出と建築許可、house_price 住宅価格、cost_limit 費用の上限。国ごとの有無は get_jccdb_coverage で確かめる。 / Data type: material, labor (design labor rates), work (work-item unit prices), equipment (rental rates), index, wage (wage statistics), bid_item (bid unit prices), cost_sqft (cost per square foot), spending (construction spending and permits), house_price, cost_limit. Check availability per country with get_jccdb_coverage."
    },
    "geo": {
     "type": "string",
     "description": "地域(都道府県・州)。 / Region."
    },
    "detail": {
     "type": "boolean",
     "description": "true で出典ごとの行も返す(既定は要約: layer ごとの件数と出典の系統の上位 5。米国の非公開の層の件数も付く)。 / true for per-source rows; the default is a summary."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "観測層に何があるか。 / What the observation layers hold.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "matrix": {
     "description": "国 x 種類 x 出典の件数 / rows by country, layer and source"
    },
    "absent": {
     "description": "無い組み合わせ / combinations not ingested"
    },
    "total_rows": {
     "description": "行数 / total rows"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_prevailing_wage",
  "title": "Get U.S. Davis-Bacon Prevailing Wages (base and fringe)",
  "annotations": {
   "title": "米国 Davis-Bacon の法定賃金",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国 Davis-Bacon 法の一般賃金決定(連邦の資金が入る建設工事で払うべき最低の基本時給と付加給付)を、州・郡・職種で引く。1 件ごとに基本時給と付加給付を並べ、決定番号・改訂・公表日・郡の一覧・出典 URL を添える。基本 + 付加給付の合計は computed:true。民間の住宅工事の相場や業者の請求単価ではない。例: state='CA', county='Los Angeles', trade='carpenter'。 / U.S. Davis-Bacon general wage determinations by state, county and trade: base wage and fringe side by side with decision number, revision, publication date and source URL; the total is computed:true. These are minimums for federally funded work, not private market rates.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "state": {
     "type": "string",
     "description": "州名・略号・FIPS。 / State."
    },
    "county": {
     "type": "string",
     "description": "郡 FIPS 5桁か郡の名前(Los Angeles)。 / County FIPS or name."
    },
    "trade": {
     "type": "string",
     "description": "職種(英語。例: carpenter, electrician, laborer)。 / Trade in English."
    },
    "decision": {
     "type": "string",
     "description": "決定番号(例 CA20260001)。 / Wage determination number."
    },
    "construction_type": {
     "type": "string",
     "description": "Building / Heavy / Highway / Residential。 / Construction type."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "Davis-Bacon の一般賃金決定。 / Davis-Bacon general wage determinations.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rates": {
     "description": "基本時給と付加給付(決定番号・出典つき) / base wage and fringe with decision number"
    },
    "coverage_note": {
     "description": "取り込んだ州の範囲 / state coverage"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_permits",
  "title": "Get U.S. Building Permits (counts, valuation, per unit, city quartiles)",
  "annotations": {
   "title": "米国の建築許可(件数・工事額・1戸あたり・市の分位)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国の建築許可を地域と年で引く: Census Building Permits Survey(州・郡・都市圏・市の棟数・戸数・工事額・1戸あたり)と、市の許可データの申告工事額の分布(件数・合計・中央値・25/75 分位・1 sqft あたり)。工事額は申請者の申告で、契約額でも見積の単価でもない。計算した値は computed:true。例: geo='Austin, TX', year='2024'。 / U.S. building permits by region and year: Census BPS buildings, units, valuation and per-unit values, plus distributions of declared valuations in city permit data (median, quartiles, per sq ft). Declared by applicants; not contract prices or quotes.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "geo": {
     "type": "string",
     "description": "州・郡(FIPS か 'Multnomah County, OR')・都市圏(cbsa:38900)・市(Austin, TX)。無ければ全国。 / State, county, CBSA or place; national if omitted."
    },
    "year": {
     "type": "string",
     "description": "年(2024)。 / Year."
    },
    "structure": {
     "type": "string",
     "enum": [
      "1-unit",
      "2-units",
      "3-4 units",
      "5+ units"
     ],
     "description": "建物あたりの戸数の区分: 1-unit 戸建て、2-units、3-4 units、5+ units 集合住宅。 / Units per building: 1-unit, 2-units, 3-4 units, 5+ units."
    },
    "source": {
     "type": "string",
     "enum": [
      "all",
      "bps",
      "city"
     ],
     "description": "出典: bps は Census Building Permits Survey、city は市の許可データ、all は両方(既定)。 / bps for the Census Building Permits Survey, city for city permit records, all for both (default)."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の建築許可。 / U.S. building permits.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "bps": {
     "description": "Census BPS の棟数・戸数・工事額 / Census BPS"
    },
    "city_permits": {
     "description": "市の許可の申告工事額の分布 / city permit valuations"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_area_factor",
  "title": "Get U.S. Location Cost Factors (DoD Area Cost Factor, USACE state adjustment)",
  "annotations": {
   "title": "米国の場所の係数(DoD ACF・USACE)",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国の場所ごとの建設費の係数を引く: 国防総省の Area Cost Factor と Sustainment ACF(軍の施設ごと、96 基準都市の平均 = 1.00)と、陸軍工兵隊 CWCCIS の州の調整係数(現行値と年ごと)。geo は州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外の国(country:JP)。中央値は computed:true。予算用の係数で、見積の良し悪しを判定する係数ではない。 / U.S. location cost factors: DoD Area Cost Factors by installation (96 base-city average = 1.00) and USACE CWCCIS state adjustment factors; geo accepts state, county, ZIP, city or an overseas country. Budgeting factors, not a test of whether a quote is fair.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "geo": {
     "type": "string",
     "description": "州・郡・ZIP(zip:28533)・市(Cherry Point, NC)・国外(country:JP)。 / State, county, ZIP, city or overseas country."
    },
    "installation": {
     "type": "string",
     "description": "施設の名前(例: Fort Bragg)。 / Installation name."
    },
    "include_history": {
     "type": "boolean",
     "description": "true で CWCCIS の州の調整係数を年ごとに返す。 / true to return the yearly CWCCIS state adjustment series."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の場所ごとの建設費の係数。 / U.S. location cost factors.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "sites": {
     "description": "施設ごとの係数 / factors by installation"
    },
    "acf_stats": {
     "description": "係数の要約 / factor summary"
    },
    "state_adjustment_factor": {
     "description": "USACE の州の係数 / USACE state factor"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_price_chain",
  "title": "Get U.S. Material Price Chain (landed import cost to wholesale, retail and contractor)",
  "annotations": {
   "title": "米国の資材の流通の各段の価格",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国で建材や化学品が流通の各段でいくらになるかを計算して返す: 輸入の陸揚げ原価(Census の輸入統計、CIF + 関税、232 条などの追加関税を含む)から、卸(業種の平均の粗利率、Census AIES 2024)、小売(直接輸入と卸経由の幅)、元請(Caltrans の材料の上乗せ 15%)まで。HS 10 桁か英語の品名で引く。各行に式・出典の URL と sha256・卸の業種の当て方の確度・BEA 2007 の流通構造との照合が付く。推計(computed:true)で、見積の良し悪しを判定する値ではない。例: query='plywood'、hs='2523290000'(ポルトランドセメント)。 / Estimated U.S. prices along the distribution chain for construction materials and chemicals: landed import cost (Census, CIF plus duty including Section 232) to wholesale (industry-average gross margin, Census AIES 2024), retail (range: direct import vs via wholesale) and contractor (Caltrans materials markup 15%). Look up by HS code or English product name; every row carries the formula, source URLs and hashes, mapping confidence and a BEA 2007 cross-check. Estimates (computed:true), not a verdict on any quote.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "hs": {
     "type": "string",
     "description": "HS の頭 2〜10 桁(例 2523 セメント、4412 合板、3917 樹脂管、6907 タイル)。 / HS code prefix."
    },
    "query": {
     "type": "string",
     "description": "英語の品名(例 plywood, portland cement, pvc pipe, ceramic tiles)。 / Product name in English."
    },
    "include_thin": {
     "type": "boolean",
     "description": "取引の薄い品目も入れる(既定は外す)。 / Include thinly traded items."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 50,
     "description": "返す行の上限(1〜50)。 / Maximum rows to return (1 to 50)."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の流通の各段の推計(計算して返す)。 / U.S. distribution-chain estimates, computed on request.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "品目ごとの陸揚げ・卸・小売・元請(式・出典・sha256) / landed, wholesale, retail, contractor with formula and sources"
    },
    "markups": {
     "description": "元請の上乗せ率(州の交通局の原本) / contractor markups from state DOT originals"
    },
    "how_to_cite": {
     "description": "引用の仕方 / how to cite"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_import_landed_cost",
  "title": "Get U.S. Landed Import Cost by HS Code and Partner Country",
  "annotations": {
   "title": "米国の輸入の陸揚げ原価",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国に輸入される建材と化学品の陸揚げ原価を HS 10 桁で返す(Census の輸入統計 IMDB、月と年初来): 通関価格・CIF・計算上の関税(232 条などの追加関税を含む)・数量・単価・実効の関税率と、相手国の上位(か country で指定の国)。単価と実効の関税率は computed:true。国内の運賃と通関の手数料は入らない。 / Landed cost of U.S. imports of construction materials and chemicals by HS 10-digit code (Census IMDB, month and year to date): customs value, CIF, calculated duty (including Section 232 and other additional duties), quantity, unit cost and effective duty rate (computed), with top partner countries or one country.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "hs": {
     "type": "string",
     "description": "HS の頭 2〜10 桁(例 7214 棒鋼)。 / HS code prefix."
    },
    "query": {
     "type": "string",
     "description": "英語の品名。 / Product name in English."
    },
    "country": {
     "type": "string",
     "description": "相手国(英語の国名か Census の国コード 4 桁)。 / Partner country."
    },
    "top_countries": {
     "type": "integer",
     "minimum": 1,
     "maximum": 20,
     "description": "相手国の上位を何か国返すか(1〜20、既定 5。country を渡したときは使わない)。 / Number of top partner countries (1 to 20, default 5; ignored when country is given)."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 50,
     "description": "返す行の上限(1〜50)。 / Maximum rows to return (1 to 50)."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の輸入の陸揚げ原価。 / U.S. landed import cost by HS code.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "HS 10 桁ごとの CIF・関税・単価 / CIF, duty and unit cost by HS code"
    },
    "how_to_cite": {
     "description": "引用の仕方 / how to cite"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_trade_margins",
  "title": "Get U.S. Wholesale and Retail Gross Margins (Census) and BEA Margin Structure",
  "annotations": {
   "title": "米国の卸・小売の粗利率",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "米国の卸と小売の粗利率を NAICS で返す(Census AWTS 1992〜2022、ARTS 1993〜2022、AIES 2024)。kake_cost_ratio = 1 - 粗利率(売値のうち仕入れ原価の割合)。commodity か include_bea で BEA 2007 の建設業と家計の購入の流通構造(生産者価格・運賃・卸・小売・購入者価格)も。業種の平均で、個々の会社の仕入れ値ではない。例: naics='4233'(建材卸)、naics='444110'(ホームセンター)。 / U.S. wholesale and retail gross margins by NAICS (Census AWTS, ARTS, AIES 2024) with kake_cost_ratio = 1 - margin; optionally the BEA 2007 margin structure. Industry averages, not any firm's cost.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "naics": {
     "type": "string",
     "description": "NAICS の頭(4233 建材卸、423720 配管・暖房卸、4441 建材小売、444110 ホームセンター)。 / NAICS prefix."
    },
    "query": {
     "type": "string",
     "description": "業種の語(英語。例 plumbing, paint)。 / Industry words in English."
    },
    "trade": {
     "type": "string",
     "enum": [
      "wholesale",
      "retail"
     ],
     "description": "wholesale 卸 か retail 小売 で絞る。 / Filter to wholesale or retail."
    },
    "year": {
     "type": "string",
     "description": "年(例 2022。AIES は 2024)。 / Year, e.g. 2022 (AIES covers 2024)."
    },
    "history": {
     "type": "boolean",
     "description": "true で年ごと。 / All years."
    },
    "include_bea": {
     "type": "boolean",
     "description": "true で BEA 2007 の流通構造(生産者価格・運賃・卸・小売・購入者価格)も返す。 / true to add the BEA 2007 margin structure (producer price, freight, wholesale, retail, purchaser price)."
    },
    "commodity": {
     "type": "string",
     "description": "BEA の品目の語(英語。例 cement, lighting)。 / BEA commodity words."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 200,
     "description": "返す行の上限(1〜200)。 / Maximum rows to return (1 to 200)."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の卸と小売の粗利率。 / U.S. wholesale and retail gross margins.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "NAICS ごとの粗利率と kake_cost_ratio / margins and cost ratio by NAICS"
    },
    "margin_index": {
     "description": "マージン物価指数 / trade-margin price indexes"
    }
   },
   "additionalProperties": true
  }
 },
 {
  "name": "get_us_contract_discounts",
  "title": "Get U.S. Public Contract Discount Rates off List Price (kake ratio)",
  "annotations": {
   "title": "米国の公的な契約の値引き率と掛け率",
   "readOnlyHint": true,
   "destructiveHint": false,
   "openWorldHint": false
  },
  "description": "州と共同購買の契約書が公開している、定価からの値引き率を返す(ワシントン州 DES 23623 配管部材・11121 電気資材、NASPO ValuePoint の資材 MRO の Grainger・Fastenal・MSC・Lawson・HD Supply、Home Depot の塗料)。掛け率 = 1 - 値引き率(computed:true)。定価への上乗せ(Over MSRP)と業者の目録からの値引き(Catalog Off)は別の列で、掛け率には入れない。率は上限で、定価の基準は行ごとに違う。例: query='eaton breakers'。 / Published discount rates off list price in U.S. public contracts (Washington DES plumbing and electrical, NASPO ValuePoint MRO), with kake_ratio = 1 - discount (computed:true). Over-MSRP and catalog-off rows are kept separate. Rates are ceilings; list bases differ by row.",
  "inputSchema": {
   "type": "object",
   "properties": {
    "query": {
     "type": "string",
     "description": "メーカー・製品系列・分野・業者の語(英語)。 / Manufacturer, product line, category or vendor words."
    },
    "vendor": {
     "type": "string",
     "description": "業者名(英語。例 Grainger, Fastenal)。 / Vendor name."
    },
    "manufacturer": {
     "type": "string",
     "description": "メーカー名(英語)。 / Manufacturer name."
    },
    "source_id": {
     "type": "string",
     "enum": [
      "wa-des-23623",
      "wa-des-11121",
      "naspo-mro-ak"
     ],
     "description": "契約の出典: wa-des-23623 ワシントン州の配管部材、wa-des-11121 同じく電気資材、naspo-mro-ak NASPO ValuePoint の資材 MRO。 / Contract source: wa-des-23623 (Washington DES plumbing), wa-des-11121 (Washington DES electrical), naspo-mro-ak (NASPO ValuePoint MRO)."
    },
    "basis": {
     "type": "string",
     "enum": [
      "MSRP Discount",
      "Over MSRP",
      "Catalog Off",
      "Discount off List Price",
      "Discount off shelf price",
      "Discount off shelf price (range)",
      "Cost Plus",
      "N/A",
      "See below"
     ],
     "description": "値引きの基準で絞る: MSRP Discount 定価からの値引き、Over MSRP 定価への上乗せ、Catalog Off 業者の目録からの値引きなど。 / Discount basis filter, e.g. MSRP Discount, Over MSRP, Catalog Off."
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 100,
     "description": "返す行の上限(1〜100)。 / Maximum rows to return (1 to 100)."
    },
    "offset": {
     "type": "integer",
     "minimum": 0,
     "description": "飛ばす行の数。limit と組んで次のページを取る。 / Rows to skip; use with limit to page through results."
    }
   }
  },
  "outputSchema": {
   "type": "object",
   "description": "米国の公共契約の値引き率。 / Discount rates in U.S. public contracts.",
   "properties": {
    "lookup": {
     "type": "string",
     "enum": [
      "ok",
      "absent"
     ],
     "description": "ok = the source was read and something matched. absent = the source was read and nothing matched. A source that could NOT be read never appears here: that returns isError: true and makes no claim about what does or does not exist."
    },
    "source_read": {
     "type": "boolean",
     "description": "true on every successful result. A failed lookup does not return a result at all, so this is never false, it is declared so a consumer can assert on it."
    },
    "count": {
     "type": "number",
     "description": "How many records matched. 0 means the source was read and nothing matched. It never means the source could not be read, that returns isError: true."
    },
    "did_you_mean": {
     "description": "Near matches, when an exact match was not found."
    },
    "rows": {
     "description": "契約・メーカーごとの値引き率と kake_ratio / discount and kake ratio"
    },
    "summary_by_vendor": {
     "description": "メーカーごとの要約 / summary by vendor"
    }
   },
   "additionalProperties": true
  }
 }
];
const OBS_NAME = {"search_jccdb_items": "jccdb_search_items", "get_jccdb_observations": "jccdb_observations", "get_jccdb_labor_rate": "jccdb_labor_rate", "compare_jccdb_regions": "jccdb_compare_regions", "get_jccdb_work_unit_price": "jccdb_work_unit_price", "get_jccdb_index_series": "jccdb_index_series", "get_us_construction_prices": "jccdb_us_prices", "get_jccdb_coverage": "jccdb_coverage", "get_us_prevailing_wage": "jccdb_us_prevailing_wage", "get_us_permits": "jccdb_us_permits", "get_us_area_factor": "jccdb_us_area_factor", "get_us_price_chain": "jccdb_us_price_chain", "get_us_import_landed_cost": "jccdb_us_import_cost", "get_us_trade_margins": "jccdb_us_margin", "get_us_contract_discounts": "jccdb_us_kake"};
const HS_MCP = "https://mcp.horizonshield.dev/mcp";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id"
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra } });
}
const rpc = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
function toolText(obj, isError) {
  const out = { content: [{ type: "text", text: JSON.stringify(obj) }], structuredContent: obj };
  if (isError) out.isError = true;
  return out;
}

async function callTool(name, args, env) {
  if (!Object.prototype.hasOwnProperty.call(OBS_NAME, name)) {
    return toolText({ error: "unknown_tool", message: "Unknown tool: " + name + ". This server has: " + TOOLS.map((t) => t.name).join(", ") + ". Fair-price checks for Japanese renovation quotes are at " + HS_MCP }, true);
  }
  for (const k in (args || {})) {
    if (typeof args[k] === "string" && args[k].length > 16000) return toolText({ error: "input_too_long", invalid_argument: true, fetch_failed: false, message: "Argument " + k + " is too long. Keep it under 16000 characters." }, true);
  }
  if (!env || !env.JCCDB_SVC) return toolText({ error: "jccdb_obs_not_bound", fetch_failed: true, source_read: false, message: "The observation service is not bound. This is a failure to fetch, not an empty result." }, true);
  let r = null, j = null;
  try {
    r = await env.JCCDB_SVC.fetch("https://jccdb-obs.internal/mcp", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: OBS_NAME[name], arguments: args || {} } }) });
    j = await r.json();
  } catch (e) {
    return toolText({ error: "jccdb_obs_fetch_failed", fetch_failed: true, source_read: false, message: "The lookup failed; this is not an empty result." }, true);
  }
  const res = j && j.result;
  const sc = res && res.structuredContent;
  if (!sc) return toolText({ error: "jccdb_obs_bad_response", fetch_failed: true, source_read: false, http_status: r ? r.status : null, message: "Unreadable response; this is not an empty result." }, true);
  if (res.isError || sc.error) {
    return toolText({ ...sc, error: sc.code || "jccdb_obs_error", message: String(sc.error || ""), fetch_failed: sc.fetch_failed === true, invalid_argument: sc.invalid_argument === true, source_read: false }, true);
  }
  return toolText({ ...sc, fetch_failed: false, fair_price_checks: HS_MCP });
}

async function handle(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg && msg.id, -32600, "Invalid Request");
  const { id, method, params } = msg;
  const isNote = id === undefined || id === null;
  if (method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    const asked = params && params.protocolVersion;
    return rpc(id, { protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[1], capabilities: { tools: {} }, serverInfo: SERVER, instructions: INSTRUCTIONS });
  }
  if (method === "ping") return rpc(id, {});
  if (method === "tools/list") return rpc(id, { tools: TOOLS });
  if (method === "tools/call") return rpc(id, await callTool(params && params.name, (params && params.arguments) || {}, env));
  if (method === "resources/list") return rpc(id, { resources: [] });
  if (method === "prompts/list") return rpc(id, { prompts: [] });
  if (isNote) return null;
  return rpcErr(id, -32601, "Method not found: " + method);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/mcp")) {
      return json({ name: SERVER.title, version: SERVER.version, mcp: { endpoint: "/mcp", transport: "streamable-http", stateless: true },
        tools: TOOLS.map((t) => t.name), fair_price_checks: HS_MCP,
        source: "https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ccdb-mcp",
        datasets: { jccdb: "https://doi.org/10.5281/zenodo.23133068", usccdb: "https://doi.org/10.5281/zenodo.22979157" } });
    }
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, version: SERVER.version, tools: TOOLS.length, bound: !!(env && env.JCCDB_SVC) });
    if (request.method !== "POST" || !(url.pathname === "/" || url.pathname === "/mcp")) return json({ error: "not_found" }, 404);
    let body;
    try { body = await request.json(); } catch (e) { return json(rpcErr(null, -32700, "Parse error"), 400); }
    if (Array.isArray(body)) {
      const outs = (await Promise.all(body.map((m) => handle(m, env)))).filter(Boolean);
      return outs.length ? json(outs) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await handle(body, env);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
};
