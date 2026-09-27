// Reference lookups from the U.S. data in hs-jccdb-obs, over the service binding.
// hs-jccdb-obs returns U.S. values only to calls whose URL host is jccdb-obs.internal,
// which only a service binding can send. Every value keeps its source id and URL.

export const INTERNAL = "https://jccdb-obs.internal";

// Labor loading from state DOT force-account rules that we have read in the original.
// Only states listed here get a loading; elsewhere wages are shown without loading and the
// report says so.
export const LOADING_BY_STATE = {
  TX: { source: "txdot-2024-item-9.7", parts: [{ rate: 0.25, label: "TxDOT 9.7.1.1 labor" }, { rate: 0.55, label: "TxDOT 9.7.1.2 insurance and taxes" }] },
};

export async function jccdb(env, path, params) {
  if (!env.JCCDB || typeof env.JCCDB.fetch !== "function") throw new Error("JCCDB service binding missing");
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  const res = await env.JCCDB.fetch(new Request(`${INTERNAL}${path}${qs ? "?" + qs : ""}`));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`jccdb ${path} ${res.status}`);
  return body;
}

function pickWage(rows, soc) {
  const hourly = rows.filter((r) => r.unit === "USD/hour" && String(r.spec || "").includes(`SOC ${soc}`) && r.has_value);
  if (!hourly.length) return null;
  const latest = hourly.map((r) => r.period).sort().pop();
  const at = hourly.filter((r) => r.period === latest);
  const get = (basis) => (at.find((r) => r.price_basis === basis) || {}).price;
  const mean = get("wage_hourly_mean");
  const p90 = get("wage_hourly_p90");
  if (mean == null || p90 == null) return null;
  const r0 = at[0];
  return { mean, p90, p10: get("wage_hourly_p10") ?? null, median: get("wage_hourly_median") ?? null, period: latest, geo_level: r0.geo_level, geo_name: r0.geo_name, source_id: r0.source_id, evidence_url: r0.evidence_url };
}

async function scanWage(env, params, soc, levelFilter) {
  // The text search can rank helpers ahead of the trade itself and spreads periods across
  // pages, so collect every row of this SOC code (up to 400 rows) before choosing.
  const mine = [];
  let offset = 0;
  for (let page = 0; page < 4; page++) {
    const r = await jccdb(env, "/us", { ...params, layer: "wage", limit: 100, offset });
    for (const row of r.rows || []) if (levelFilter(row) && String(row.spec || "").includes(`SOC ${soc}`)) mine.push(row);
    if (r.next_offset == null) break;
    offset = r.next_offset;
  }
  return pickWage(mine, soc);
}

export async function wagesFor(env, geo, occ) {
  if (geo.cbsa) {
    const w = await scanWage(env, { q: occ.query, geo: `cbsa:${geo.cbsa}` }, occ.soc, (r) => r.geo_level === "metro");
    if (w) return w;
  }
  if (geo.state) {
    const w = await scanWage(env, { q: occ.query, state: geo.state, include_national: "false" }, occ.soc, (r) => r.geo_level === "state");
    if (w) return w;
  }
  return null;
}

export async function chainFor(env, hs) {
  const c = await jccdb(env, "/us/chain", { hs });
  const row = (c.rows || [])[0];
  if (!row) return null;
  const ym = (c.data_version && c.data_version.ym) || "";
  return {
    landed_usd_per_kg: Math.round(row.landed.unit_landed_usd * 10000) / 10000,
    wholesale_gross_margin: Math.round(row.wholesale.gross_margin * 10000) / 10000,
    contractor_markup_range: row.contractor.range.markup,
    unit: row.unit,
    period: row.period,
    data_version: c.data_version && c.data_version.built_at,
    sources: [`census-imdb-${ym.slice(2)}`, "census-aies-2024", "caltrans-ctss-9-1.04", "fdot-fy2026-27-4-3.2.1", "txdot-2024-item-9.7"],
  };
}

export function permitRuleFor(geo, tradeKeyValue, lines) {
  const asphalt = (lines || []).some((l) => l.material && l.material.type === "asphalt_shingles");
  if (geo && geo.place === "Austin" && geo.state === "TX" && tradeKeyValue === "roof" && asphalt) return "austin-reroof-exempt";
  return null;
}
