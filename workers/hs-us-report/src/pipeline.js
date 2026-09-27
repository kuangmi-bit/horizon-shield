// From an extracted quote (or job description) to engine input, with references resolved.
// Anything the data cannot support becomes "no public benchmark" with a reason, never a guess.

import { computeReport, ENGINE_VERSION } from "./engine.js";
import { canon, sha256Hex } from "./canon.js";
import { TRADES, tradeKey } from "./trades.js";
import { wagesFor, chainFor, LOADING_BY_STATE, permitRuleFor } from "./refs.js";
import { PERMIT_RULES } from "./engine.js";
import { GEO_SOURCES, placeLabel } from "./geo.js";
import { sourceUrls } from "./sources.js";
import { roofSquaresFrom, crewHoursFrom, flagsFor, hearingSummary, HEARING_VERSION } from "./hearing.js";

// The trade comes from the homeowner's choice on the form when they made one; the AI's
// reading of the quote is the fallback.
export function tradeOf(order, extracted) {
  if (order && order.trade && TRADES[order.trade] && order.trade !== "other") return order.trade;
  return tradeKey(extracted && extracted.doc && extracted.doc.trade);
}

export async function buildInput(env, order, extracted, geo) {
  const tk = tradeOf(order, extracted);
  const trade = TRADES[tk];
  const answers = (order && order.hearing && order.hearing.answers) || null;
  const lines = [];
  const sources = new Set(GEO_SOURCES);
  const notes = [];
  let dataVersion = null;
  const fromAnswers = { squares: roofSquaresFrom(answers), crew: crewHoursFrom(answers) };
  let usedSquares = false, usedCrew = false;

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
  let permitRule = permitRuleFor(geo, tk, extracted.lines);
  let permitNote;
  if (permitRule && answers && answers.inside_city === "no") {
    // City exemptions apply inside the limits only. Outside, the county's rules apply.
    permitNote = `The homeowner says the property is outside the city limits, so the city's exemption does not apply; check the county's permit requirements and fee schedule.`;
    permitRule = null;
  }

  for (const l of extracted.lines) {
    const base = { item: l.item };
    if (order.plan !== "detailed_estimate" && typeof l.amount === "number") base.quoted = l.amount;
    if (l.qty_text) base.qty_text = l.qty_text;
    if (l.kind === "labor" && wage) {
      const w = l.labor || {};
      const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
      let hours = num(w.hours);
      let hoursBasis;
      let workers = num(w.workers), days = num(w.days);
      if (hours == null && workers && days) { hours = workers * days * 8; hoursBasis = `${w.workers} workers x ${w.days} days x 8 hours (8-hour day assumed)`; }
      if (hours == null && fromAnswers.crew && !usedCrew) { hours = fromAnswers.crew.hours; hoursBasis = fromAnswers.crew.basis; workers = fromAnswers.crew.workers; days = fromAnswers.crew.days; usedCrew = true; }
      const lineSources = [wage.source_id];
      if (loading) { lineSources.push(loading.source); sources.add(loading.source); }
      sources.add(wage.source_id);
      lines.push({ ...base, kind: "labor", sources: lineSources, labor: { workers: workers ?? undefined, days: days ?? undefined, hours, hours_basis: hoursBasis, wage_mean_usd_h: wage.mean, wage_p90_usd_h: wage.p90, loading_parts: loading ? loading.parts : [] } });
      continue;
    }
    if (l.kind === "material" && l.material && l.material.type === "asphalt_shingles" && chain) {
      const m = l.material;
      let squares = m.squares, squaresBasis;
      if (!squares && fromAnswers.squares && !usedSquares) { squares = fromAnswers.squares.squares; squaresBasis = fromAnswers.squares.basis; usedSquares = true; }
      let weight = m.weight_lb_per_square, weightBasis;
      if (!weight && answers && typeof answers.shingle_weight === "number") { weight = answers.shingle_weight; weightBasis = "weight per square from the product sheet, given by the homeowner"; }
      if (squares && weight) {
        chain.sources.forEach((s) => sources.add(s));
        const material = { form: "roofing_squares", squares, weight_lb_per_square: weight, landed_usd_per_kg: chain.landed_usd_per_kg, wholesale_gross_margin: chain.wholesale_gross_margin, contractor_markup_range: chain.contractor_markup_range };
        if (squaresBasis) material.squares_basis = squaresBasis;
        if (weightBasis) material.weight_basis = weightBasis;
        lines.push({ ...base, kind: "material", sources: chain.sources.slice(0, 4), material });
        continue;
      }
      lines.push({ ...base, kind: "no_data", note: squares ? "The shingle weight per square is needed for a public reference; ask for the product sheet." : "Number of squares and the shingle weight per square are needed for a public reference; ask for the product sheet." });
      continue;
    }
    if (l.kind === "permit") {
      if (permitRule) sources.add(PERMIT_RULES[permitRule].source);
      const pl = { ...base, kind: "permit", permit: { rule_id: permitRule }, sources: permitRule ? [PERMIT_RULES[permitRule].source] : undefined };
      if (permitNote) pl.note = permitNote;
      lines.push(pl);
      continue;
    }
    if (l.kind === "overhead") { lines.push({ ...base, kind: "overhead" }); continue; }
    lines.push({ ...base, kind: "no_data" });
  }
  const flags = flagsFor(answers, geo, tk);
  for (const f of flags) sources.add(f.source);
  const srcList = [...sources];
  const input = {
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
  };
  if (answers && Object.keys(answers).length) {
    input.hearing = { version: HEARING_VERSION, answers: hearingSummary(answers, tk) };
    if (flags.length) input.flags = flags;
    if (usedSquares) notes.push("roof area taken from the homeowner's answers");
    if (usedCrew) notes.push("crew size and days taken from the homeowner's answers");
  }
  return { input, notes, trade_key: tk };
}

export async function buildReport(input) {
  const report = computeReport(input);
  const bytes = canon(report);
  return { report, bytes, sha256: await sha256Hex(bytes), engine: ENGINE_VERSION };
}
