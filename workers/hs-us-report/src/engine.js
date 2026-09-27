// HORIZON SHIELD US report engine.
// Pure and deterministic: the same input always gives the same report and the same sha256.
// No network, no clock, no randomness. The worker resolves references (wages, price chain,
// DOT markups, permit rules) first and passes the numbers in; this file only computes.
//
// The sample on /us/ is the canary: its input (test/fixtures/sample_input.json) must
// reproduce /us/sample-report.json byte for byte. See test/engine.test.mjs.

import { round } from "./canon.js";

export const ENGINE_VERSION = "hs-us-engine 1.0.0";
export const LB_TO_KG = 0.45359237;

// Permit rules we have read in the original city pages. Each rule is quoted in `note`.
export const PERMIT_RULES = {
  "austin-reroof-exempt": {
    source: "austin-dsd-work-exempt",
    note: "City of Austin: for a property inside the city limits, asphalt shingles replacing asphalt shingles on one- and two-family dwellings and townhouses up to three stories are exempt from a building permit, unless the property is in the Wildland-Urban Interface area and 50% or more of the roofing is replaced.",
    status: "ask_permit_exemption",
  },
};

export const STATUS_TEXT = {
  above: "ABOVE",
  within: "WITHIN",
  below: "BELOW",
  above_floor: "ABOVE FLOOR",
  at_or_below_floor: "AT OR BELOW FLOOR",
  no_public_benchmark: "NO PUBLIC DATA",
  ask_permit_exemption: "ASK",
  verify_city_fee_schedule: "VERIFY",
  overlaps_reference_markups: "OVERLAPS",
  estimate: "ESTIMATE",
  rate_only: "RATE ONLY",
  wages_only: "WAGES ONLY",
};

// ---------------------------------------------------------------- lines

function materialLine(line) {
  const m = line.material;
  const unitRange = m.contractor_markup_range.map((mk) => round((m.landed_usd_per_kg / (1 - m.wholesale_gross_margin)) * (1 + mk), 3));
  if (m.form === "roofing_squares") {
    const kgPerSquare = round(m.weight_lb_per_square * LB_TO_KG, 2);
    const ref = unitRange.map((u) => Math.round(m.squares * kgPerSquare * u));
    const basis = {
      contractor_markup_range: m.contractor_markup_range,
      contractor_usd_per_kg: unitRange,
      kg_per_square: kgPerSquare,
      landed_usd_per_kg: m.landed_usd_per_kg,
      not_included: ["freight to the site", "brand premium", "additional distribution tiers"],
      reference_formula: `${m.squares} x ${kgPerSquare} x landed / (1 - wholesale margin) x (1 + markup)`,
      squares: m.squares,
      weight_lb_per_square: m.weight_lb_per_square,
      wholesale_gross_margin: m.wholesale_gross_margin,
    };
    if (m.squares_basis) basis.squares_basis = m.squares_basis;
    if (m.weight_basis) basis.weight_basis = m.weight_basis;
    return { ref, basis };
  }
  // generic: quantity already in kilograms
  const ref = unitRange.map((u) => Math.round(m.kg * u));
  return {
    ref,
    basis: {
      contractor_markup_range: m.contractor_markup_range,
      contractor_usd_per_kg: unitRange,
      kg: m.kg,
      kg_formula: m.kg_formula,
      landed_usd_per_kg: m.landed_usd_per_kg,
      not_included: ["freight to the site", "brand premium", "additional distribution tiers"],
      reference_formula: `${m.kg} x landed / (1 - wholesale margin) x (1 + markup)`,
      wholesale_gross_margin: m.wholesale_gross_margin,
    },
  };
}

function laborLine(line) {
  const l = line.labor;
  const parts = l.loading_parts || [];
  const loading = round(1 + parts.reduce((s, p) => s + p.rate, 0), 4);
  const loadingFormula = parts.length
    ? "1 + " + parts.map((p) => `${p.rate} (${p.label})`).join(" + ") + ", both on base wages"
    : "no state DOT labor markup on file; wages shown without loading";
  const ref = [l.wage_mean_usd_h, l.wage_p90_usd_h].map((w) => Math.round(l.hours * w * loading));
  const basis = {
    hours: l.hours,
    loading,
    loading_formula: parts.length === 1 ? loadingFormula.replace(", both on base wages", ", on base wages") : loadingFormula,
    reference_formula: `${l.hours} x wage x ${loading.toFixed(2)}`,
    wage_mean_usd_h: l.wage_mean_usd_h,
    wage_p90_usd_h: l.wage_p90_usd_h,
  };
  if (l.hours_basis) basis.hours_basis = l.hours_basis;
  if (l.workers != null) basis.workers = l.workers;
  if (l.days != null) basis.days = l.days;
  return { ref, basis, unloaded: !parts.length };
}

function statusFor(quoted, ref, kind) {
  if (quoted == null) return "estimate";
  if (kind === "floor") return quoted > ref[1] ? "above_floor" : "at_or_below_floor";
  if (quoted > ref[1]) return "above";
  if (quoted < ref[0]) return "below";
  return "within";
}

export function computeLine(line) {
  const out = { item: line.item };
  if (line.quoted != null) out.quoted = line.quoted;
  if (line.qty_text) out.qty_text = line.qty_text;
  switch (line.kind) {
    case "material": {
      const { ref, basis } = materialLine(line);
      out.basis = basis;
      out.reference_kind = "floor";
      out.reference_usd = ref;
      out.status = statusFor(line.quoted, ref, "floor");
      break;
    }
    case "labor": {
      if (line.labor.hours == null) {
        const parts = line.labor.loading_parts || [];
        const loading = round(1 + parts.reduce((s, p) => s + p.rate, 0), 4);
        out.basis = {
          loading,
          loading_formula: parts.length ? "1 + " + parts.map((p) => `${p.rate} (${p.label})`).join(" + ") + ", both on base wages" : "no state DOT labor markup on file; wages shown without loading",
          wage_mean_usd_h: line.labor.wage_mean_usd_h,
          wage_p90_usd_h: line.labor.wage_p90_usd_h,
        };
        out.reference_usd_per_hour = [round(line.labor.wage_mean_usd_h * loading, 2), round(line.labor.wage_p90_usd_h * loading, 2)];
        out.status = "rate_only";
        break;
      }
      if (!(Number.isFinite(line.labor.hours) && line.labor.hours > 0)) { out.status = "no_public_benchmark"; out.note = "Hours are not stated in a usable form."; break; }
      const { ref, basis, unloaded } = laborLine(line);
      out.basis = basis;
      out.reference_usd = ref;
      if (unloaded) { out.reference_kind = "unloaded_wage"; out.status = line.quoted == null ? "estimate" : "wages_only"; break; }
      out.status = statusFor(line.quoted, ref, "range");
      break;
    }
    case "permit": {
      const rule = line.permit && PERMIT_RULES[line.permit.rule_id];
      if (rule) {
        out.note = rule.note;
        out.status = rule.status;
      } else {
        out.status = "verify_city_fee_schedule";
      }
      break;
    }
    case "overhead":
      out.status = "overlaps_reference_markups";
      break;
    default:
      out.status = "no_public_benchmark";
  }
  if (line.note && !out.note) out.note = line.note;
  if (Array.isArray(line.sources) && line.sources.length) out.sources = line.sources;
  return out;
}

// ---------------------------------------------------------------- report

export function computeReport(input) {
  const lines = input.lines.map(computeLine);
  const report = {
    data_version: input.data_version,
    lines,
    place: input.place,
    sources: input.sources,
    source_urls: input.source_urls,
    trade: input.trade,
  };
  if (input.sample) report.sample = true;
  const quoted = lines.filter((l) => l.quoted != null);
  if (quoted.length) report.quote_total = quoted.reduce((s, l) => s + l.quoted, 0);
  if (input.kind) report.kind = input.kind;
  if (input.order_id) report.order_id = input.order_id;
  if (input.geo) report.geo = input.geo;
  if (input.engine) report.engine = ENGINE_VERSION;
  if (input.kind === "detailed_estimate") {
    const withRef = lines.filter((l) => Array.isArray(l.reference_usd));
    report.estimate_total_usd = [0, 1].map((i) => withRef.reduce((s, l) => s + l.reference_usd[i], 0));
    report.lines_without_benchmark = lines.filter((l) => l.status === "no_public_benchmark").length;
  }
  // The hearing: the homeowner's answers as given, and the warning signs they match, each
  // with its public source. Copied, not computed, so the receipt covers them too.
  if (input.hearing) report.hearing = input.hearing;
  if (Array.isArray(input.flags) && input.flags.length) report.flags = input.flags;
  if (input.with_questions) report.questions = buildQuestions(report);
  return report;
}

export function summarize(report) {
  const lines = report.lines;
  const above = lines.filter((l) => (l.status === "above" || l.status === "above_floor") && Array.isArray(l.reference_usd));
  return {
    total: report.quote_total ?? null,
    lines: lines.length,
    above_count: above.length,
    above_usd: above.reduce((s, l) => s + (l.quoted - l.reference_usd[1]), 0),
    no_data_count: lines.filter((l) => l.status === "no_public_benchmark").length,
    ask_count: lines.filter((l) => l.status === "ask_permit_exemption" || l.status === "verify_city_fee_schedule").length,
  };
}

// ---------------------------------------------------------------- questions for the contractor
// Plain, polite questions the homeowner can send. They ask for facts, never accuse.

export function buildQuestions(report) {
  const qs = [];
  for (const l of report.lines) {
    const name = l.item;
    switch (l.status) {
      case "above_floor":
        qs.push({ item: name, text: `For "${name}", could you share the brand, the product line and the supplier invoice or price list? Public import and distribution figures for this material are lower than the quoted amount, and I would like to understand the difference, including freight.` });
        break;
      case "above":
        if (l.basis && l.basis.hours != null) qs.push({ item: name, text: `For "${name}", could you confirm the crew size, the number of days and the hourly rate you used? The quote works out to $${Math.round(l.quoted / l.basis.hours)} per hour for ${l.basis.hours} hours.` });
        else qs.push({ item: name, text: `For "${name}", could you break the amount into quantity and unit price so I can compare it with public references?` });
        break;
      case "wages_only":
        qs.push({ item: name, text: `For "${name}", could you confirm the crew size, the number of days and the hourly rate you used? Public wage statistics for this trade in your area are $${l.basis.wage_mean_usd_h} to $${l.basis.wage_p90_usd_h} per hour before the contractor's insurance, taxes and markup, which I would like to see itemized.` });
        break;
      case "rate_only":
        qs.push({ item: name, text: `For "${name}", could you state the crew size, the number of days or hours, and the hourly rate? Public wage data for this trade in your area, with standard public-works loading, come to $${l.reference_usd_per_hour[0]} to $${l.reference_usd_per_hour[1]} per hour.` });
        break;
      case "no_public_benchmark":
        qs.push({ item: name, text: `For "${name}", could you split the amount by item and quantity (for example, dumpster size and landfill fee, or each material and its amount)?` });
        break;
      case "ask_permit_exemption":
        qs.push({ item: name, text: `For "${name}", will a building permit be pulled for this job? If so, please share the city receipt. If the city does not require one for this work, please remove the line or explain what it covers.` });
        break;
      case "verify_city_fee_schedule":
        qs.push({ item: name, text: `For "${name}", which permit is this, and could you share the city fee schedule line or the receipt?` });
        break;
      case "overlaps_reference_markups":
        qs.push({ item: name, text: `For "${name}", is overhead and profit already included in the unit prices above? Please confirm how it is calculated so it is not counted twice.` });
        break;
      default:
        break;
    }
  }
  // Questions that follow from the hearing, not from a line.
  const flagIds = new Set((report.flags || []).map((f) => f.id));
  if (flagIds.has("deductible_tx") || flagIds.has("deductible_general")) qs.push({ item: "insurance deductible", text: "Could you confirm in writing that I will pay my insurance deductible in full and that no part of it is absorbed, waived or rebated in this quote?" });
  if (flagIds.has("adjuster_tx")) qs.push({ item: "insurance scope", text: "Could you send the line-item scope you gave the insurer, so I can match each line of this quote to the adjuster's estimate?" });
  if (flagIds.has("lead_rrp")) qs.push({ item: "lead-safe certification", text: "The house was built before 1978. Could you send your EPA Lead-Safe Certified Firm number and confirm that a certified renovator will be on site?" });
  if (flagIds.has("no_contract")) qs.push({ item: "written contract", text: "Could you send a written contract that lists the work, the materials by brand and line, the price, the schedule, who pulls the permit, and the warranty?" });
  if (flagIds.has("license_tx") || flagIds.has("license_ca") || flagIds.has("license_general")) qs.push({ item: "license and insurance", text: "Could you send your license number where one applies, and a certificate of general liability insurance issued to me directly by your insurer?" });
  if (flagIds.has("deposit_ca") || flagIds.has("deposit_md") || flagIds.has("deposit_large") || flagIds.has("full_upfront")) qs.push({ item: "payment schedule", text: "Could you propose a payment schedule tied to completed stages of the work, with a smaller amount before work starts?" });
  return qs;
}
