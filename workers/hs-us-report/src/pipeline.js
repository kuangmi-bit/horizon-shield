// From an extracted quote (or job description) to engine input, with references resolved.
// Anything the data cannot support becomes "no public benchmark" with a reason, never a guess.

import { computeReport, ENGINE_VERSION } from "./engine.js";
import { canon, sha256Hex } from "./canon.js";
import { TRADES, tradeKey } from "./trades.js";
import { wagesFor, chainFor, LOADING_BY_STATE, permitRuleFor } from "./refs.js";
import { PERMIT_RULES } from "./engine.js";
import { GEO_SOURCES, placeLabel } from "./geo.js";
import { sourceUrls } from "./sources.js";

export async function buildInput(env, order, extracted, geo) {
  const tk = tradeKey(extracted.doc && extracted.doc.trade);
  const trade = TRADES[tk];
  const lines = [];
  const sources = new Set(GEO_SOURCES);
  const notes = [];
  let dataVersion = null;

  const occ = trade.occupations[0];
  let wage = null;
  if (extracted.lines.some((l) => l.kind === "labor")) {
    wage = await wagesFor(env, geo, occ);
    if (!wage) notes.push(`no wage data for ${occ.label} in ${geo.cbsa ? "the metro area or " : ""}the state`);
  }
  const loading = LOADING_BY_STATE[geo.state] || null;
  let chain = null;
  if (extracted.lines.some((l) => l.material && l.material.type === "asphalt_shingles")) {
    chain = await chainFor(env, "6807900010");
    if (chain) dataVersion = chain.data_version;
  }
  const permitRule = permitRuleFor(geo, tk, extracted.lines);

  for (const l of extracted.lines) {
    const base = { item: l.item };
    if (order.plan !== "detailed_estimate" && typeof l.amount === "number") base.quoted = l.amount;
    if (l.qty_text) base.qty_text = l.qty_text;
    if (l.kind === "labor" && wage) {
      const w = l.labor || {};
      const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
      let hours = num(w.hours);
      let hoursBasis;
      if (hours == null && num(w.workers) && num(w.days)) { hours = num(w.workers) * num(w.days) * 8; hoursBasis = `${w.workers} workers x ${w.days} days x 8 hours (8-hour day assumed)`; }
      const lineSources = [wage.source_id];
      if (loading) { lineSources.push(loading.source); sources.add(loading.source); }
      sources.add(wage.source_id);
      lines.push({ ...base, kind: "labor", sources: lineSources, labor: { workers: num(w.workers) ?? undefined, days: num(w.days) ?? undefined, hours, hours_basis: hoursBasis, wage_mean_usd_h: wage.mean, wage_p90_usd_h: wage.p90, loading_parts: loading ? loading.parts : [] } });
      continue;
    }
    if (l.kind === "material" && l.material && l.material.type === "asphalt_shingles" && chain) {
      const m = l.material;
      if (m.squares && m.weight_lb_per_square) {
        chain.sources.forEach((s) => sources.add(s));
        lines.push({ ...base, kind: "material", sources: chain.sources.slice(0, 4), material: { form: "roofing_squares", squares: m.squares, weight_lb_per_square: m.weight_lb_per_square, landed_usd_per_kg: chain.landed_usd_per_kg, wholesale_gross_margin: chain.wholesale_gross_margin, contractor_markup_range: chain.contractor_markup_range } });
        continue;
      }
      lines.push({ ...base, kind: "no_data", note: "Number of squares and the shingle weight per square are needed for a public reference; ask for the product sheet." });
      continue;
    }
    if (l.kind === "permit") {
      if (permitRule) sources.add(PERMIT_RULES[permitRule].source);
      lines.push({ ...base, kind: "permit", permit: { rule_id: permitRule }, sources: permitRule ? [PERMIT_RULES[permitRule].source] : undefined });
      continue;
    }
    if (l.kind === "overhead") { lines.push({ ...base, kind: "overhead" }); continue; }
    lines.push({ ...base, kind: "no_data" });
  }
  const srcList = [...sources];
  return {
    input: {
      kind: order.plan,
      order_id: order.id,
      engine: true,
      with_questions: true,
      trade: trade.label,
      place: placeLabel(geo),
      geo: { zip: geo.zip, county_fips: geo.county_fips || null, state: geo.state || null, cbsa: geo.cbsa || null, wage_area: wage ? wage.geo_name : null, wage_period: wage ? wage.period : null },
      data_version: dataVersion || (wage ? `OEWS ${wage.period}` : "public data as of order date"),
      sources: srcList,
      source_urls: sourceUrls(srcList),
      lines,
    },
    notes,
    trade_key: tk,
  };
}

export async function buildReport(input) {
  const report = computeReport(input);
  const bytes = canon(report);
  return { report, bytes, sha256: await sha256Hex(bytes), engine: ENGINE_VERSION };
}
