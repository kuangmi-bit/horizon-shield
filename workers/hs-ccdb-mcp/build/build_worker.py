#!/usr/bin/env python3
"""Build workers/hs-ccdb-mcp/src/worker.js from the 15 tool definitions hs-mcp served (data_tools.json),
so the moved tools keep their exact names, descriptions, input and output schemas."""
import json, sys, os
here = os.path.dirname(os.path.abspath(__file__))
tools = json.load(open(os.path.join(here, "data_tools.json"), encoding="utf-8"))
assert len(tools) == 15, len(tools)
INSTR_EN = ("HORIZON SHIELD Construction Cost Data: public construction cost data for Japan (JCCDB) and the United States (USCCDB, the United States Construction Cost Database), as tools. "
 "Japan: search_jccdb_items for the line items of JCCDB v5.0 (425,765 records: 95,403 line items and 330,362 source-cited observations); get_jccdb_observations, get_jccdb_labor_rate, compare_jccdb_regions, get_jccdb_work_unit_price and get_jccdb_index_series for dated, sourced values; get_jccdb_coverage to see what exists before answering. "
 "United States: get_us_construction_prices, get_us_prevailing_wage, get_us_permits and get_us_area_factor for public data; get_us_price_chain, get_us_import_landed_cost, get_us_trade_margins and get_us_contract_discounts for distribution-chain estimates (landed import cost, wholesale, retail, contractor), computed on request and not distributed as files. "
 "Every row carries its source URL and licence, and values computed by this service are marked computed:true. A lookup that could not be made is returned as fetch_failed:true, never as zero rows. "
 "Public-works unit prices, statistics and chain estimates are reference data, not renovation quotes. To check whether a Japanese renovation quote is fair, use the HORIZON SHIELD server at https://mcp.horizonshield.dev/mcp. ")
INSTR_JA = ("建設費のデータ(日本は JCCDB、米国は USCCDB = United States Construction Cost Database)を道具で引く口。品目は search_jccdb_items(JCCDB v5.0 は計 425,765 件、うち品目 95,403)、地域・時点・値は get_jccdb_observations・get_jccdb_labor_rate・compare_jccdb_regions・get_jccdb_work_unit_price・get_jccdb_index_series、何があるかは get_jccdb_coverage で先に確かめる。"
 "米国の公的データは get_us_construction_prices・get_us_prevailing_wage・get_us_permits・get_us_area_factor、流通の各段の推計(輸入の陸揚げ原価・卸・小売・元請)は get_us_price_chain・get_us_import_landed_cost・get_us_trade_margins・get_us_contract_discounts(問われたときに計算して返し、ファイルとしては配らない)。"
 "各行に出典の URL と利用条件が付き、このサービスが計算した値には computed:true が付く。取りに行けなかった時は fetch_failed:true で返し、0 件とは言わない。公共工事の単価・統計・推計は参照値で、リフォームの見積単価ではない。リフォームの見積もりが適正かは HORIZON SHIELD の口(https://mcp.horizonshield.dev/mcp)で確かめる。")
MAP = {"search_jccdb_items": "jccdb_search_items", "get_jccdb_observations": "jccdb_observations", "get_jccdb_labor_rate": "jccdb_labor_rate",
  "compare_jccdb_regions": "jccdb_compare_regions", "get_jccdb_work_unit_price": "jccdb_work_unit_price", "get_jccdb_index_series": "jccdb_index_series",
  "get_us_construction_prices": "jccdb_us_prices", "get_jccdb_coverage": "jccdb_coverage", "get_us_prevailing_wage": "jccdb_us_prevailing_wage",
  "get_us_permits": "jccdb_us_permits", "get_us_area_factor": "jccdb_us_area_factor", "get_us_price_chain": "jccdb_us_price_chain",
  "get_us_import_landed_cost": "jccdb_us_import_cost", "get_us_trade_margins": "jccdb_us_margin", "get_us_contract_discounts": "jccdb_us_kake"}
assert sorted(MAP) == sorted(t["name"] for t in tools)
js = r'''// hs-ccdb-mcp: HORIZON SHIELD Construction Cost Data (JCCDB + USCCDB), MCP over Streamable HTTP.
// 2026-10-02: the 15 data tools moved here from hs-mcp so each server has one job (hs-mcp: fair-price audit, 15 tools;
// this server: construction cost data, 15 tools). Names, descriptions and schemas are the ones hs-mcp served, byte for byte
// (built by build_worker.py from data_tools.json). Every call is forwarded to hs-jccdb-obs over a service binding.
// "Could not fetch" and "fetched zero rows" are never the same value (fetch_failed:true vs count:0).
// Generated file. Edit build_worker.py, not this file.

const SERVER = { name: "horizon-shield-construction-cost-data", title: "HORIZON SHIELD Construction Cost Data (JCCDB + USCCDB)", version: "1.0.0" };
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = __INSTR__;
const TOOLS = __TOOLS__;
const OBS_NAME = __MAP__;
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
        datasets: { jccdb: "https://doi.org/10.5281/zenodo.22980284", usccdb: "https://doi.org/10.5281/zenodo.22979157" } });
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
'''
js = js.replace("__INSTR__", json.dumps(INSTR_EN + "/ " + INSTR_JA, ensure_ascii=False))
js = js.replace("__TOOLS__", json.dumps(tools, ensure_ascii=False, indent=1))
js = js.replace("__MAP__", json.dumps(MAP, ensure_ascii=False))
for ch in ("–", "—", "―"):
    assert ch not in js, "dash"
out = sys.argv[1]
open(out, "w", encoding="utf-8").write(js)
print("wrote", out, len(js))
