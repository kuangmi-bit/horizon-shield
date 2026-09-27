// The hearing: what we ask the homeowner, how the answers are normalized, which answers
// change the numbers, and which follow-up questions a gap in the quote calls for.
//
// Three rules. Every question has a reason that shows up in the report (a quantity the
// reference needs, a rule that depends on it, or a warning sign with a public source).
// Answers are copied as given, never enriched. Nothing here is a price.

export const HEARING_VERSION = "us-hearing-1.0";

const yesNoNotSure = [["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]];

// Questions shown for every job. `plans` limits a question to one plan; default both.
export const COMMON_QUESTIONS = [
  { id: "property_type", label: "Property", type: "select", options: [["single_family", "Single-family house"], ["townhouse", "Townhouse or duplex"], ["condo", "Condo or apartment"], ["multi_family", "Multi-family building"], ["other", "Other"]], why: "Permit rules and wage areas differ by property type." },
  { id: "stories", label: "Stories", type: "select", options: [["1", "1"], ["2", "2"], ["3", "3 or more"]], why: "Height changes labor and access; it is also part of the Austin permit exemption." },
  { id: "year_built", label: "Built", type: "select", options: [["pre_1978", "Before 1978"], ["post_1978", "1978 or later"], ["not_sure", "Not sure"]], why: "Homes built before 1978 fall under the EPA lead-safe rule for painting, windows and demolition." },
  { id: "inside_city", label: "Inside the city limits?", type: "select", options: yesNoNotSure, why: "City permit rules apply inside the limits; outside, the county's rules apply." },
  { id: "insurance_claim", label: "Insurance claim involved?", type: "select", options: [["no", "No"], ["yes", "Yes, storm or other damage claim"], ["not_sure", "Not sure"]], why: "A claim changes what to ask for: the adjuster's scope and, in Texas, the deductible rule." },
  { id: "contact_origin", label: "How did you and the contractor meet?", type: "select", options: [["i_contacted", "I contacted them"], ["referral", "Referral from someone I know"], ["online", "Online listing or lead service"], ["door", "They came to my door"], ["after_storm", "They approached me after a storm"], ["other", "Other"]], why: "A sale made at your home gives you a federal three-day right to cancel." },
  { id: "quotes_count", label: "Quotes you have so far", type: "select", options: [["1", "This is the only one"], ["2", "Two"], ["3", "Three or more"]], why: "One quote alone cannot show a market; the letter asks for what a second quote would need." },
  { id: "deposit_pct", label: "Deposit asked, as a percent of the price", type: "number", unit: "%", min: 0, max: 100, why: "Several states cap home improvement deposits; large deposits before work starts are a known risk." },
  { id: "pressure", label: "Did the contractor do any of these?", type: "multi", options: [["today_only", "Said the price is good only today or this week"], ["cash_only", "Asked for cash only"], ["waive_deductible", "Offered to cover or waive my insurance deductible"], ["no_contract", "No written contract offered"], ["full_upfront", "Asked for full payment before starting"], ["no_license_proof", "Could not show license or insurance proof when asked"], ["started_early", "Started or wanted to start work before I signed"]], why: "Each of these matches a warning sign that the FTC or a state law describes." },
];

// Questions that depend on the job. The first entries carry quantities the references need.
export const TRADE_QUESTIONS = {
  roof: [
    { id: "roof_area_known", label: "Do you know the roof area?", type: "select", options: [["squares", "Yes, in squares (100 sq ft each)"], ["sqft", "Yes, in square feet"], ["footprint", "No, but I know the house footprint"], ["no", "No"]], why: "The shingle reference is a floor per square; without an area there is no floor." },
    { id: "roof_squares", label: "Roof area in squares", type: "number", unit: "squares", min: 1, max: 200, showIf: { roof_area_known: ["squares"] } },
    { id: "roof_sqft", label: "Roof area in square feet", type: "number", unit: "sq ft", min: 100, max: 20000, showIf: { roof_area_known: ["sqft"] } },
    { id: "footprint_sqft", label: "House footprint, ground floor area", type: "number", unit: "sq ft", min: 200, max: 10000, showIf: { roof_area_known: ["footprint"] }, why: "Roof area is estimated from the footprint and the pitch, by geometry alone." },
    { id: "pitch", label: "Roof pitch", type: "select", options: [["low", "Low, up to 4/12"], ["medium", "Medium, 5/12 to 8/12"], ["steep", "Steep, over 8/12"], ["not_sure", "Not sure"]], why: "Pitch sets the slope factor between footprint and roof area, and affects labor." },
    { id: "layers", label: "Existing shingle layers", type: "select", options: [["1", "One"], ["2", "Two"], ["3", "Three or more"], ["not_sure", "Not sure"]], why: "Tear-off and disposal scale with the layers; more than two usually must come off." },
    { id: "shingle_weight", label: "Shingle weight per square, if the product sheet states it", type: "number", unit: "lb", min: 150, max: 500, why: "The floor is computed by weight; the sample used 240 lb per square from the product sheet." },
    { id: "crew_told", label: "Did the contractor say how many people and how many days?", type: "select", options: [["yes", "Yes"], ["no", "No"]], why: "Hours let the wage reference become a dollar range instead of an hourly rate." },
    { id: "crew_workers", label: "People on the crew", type: "number", unit: "people", min: 1, max: 30, showIf: { crew_told: ["yes"] } },
    { id: "crew_days", label: "Days on site", type: "number", unit: "days", min: 0.5, max: 60, step: 0.5, showIf: { crew_told: ["yes"] } },
    { id: "penetrations", label: "Chimneys, skylights and vents to flash", type: "number", unit: "count", min: 0, max: 40 },
    { id: "roof_age", label: "Age of the current roof", type: "select", options: [["under_10", "Under 10 years"], ["10_20", "10 to 20 years"], ["over_20", "Over 20 years"], ["not_sure", "Not sure"]] },
  ],
  exterior_paint: [
    { id: "wall_sqft", label: "Paintable wall area, if known", type: "number", unit: "sq ft", min: 100, max: 30000, why: "Paint and labor references need an area." },
    { id: "siding", label: "Siding", type: "select", options: [["wood", "Wood"], ["fiber_cement", "Fiber cement"], ["stucco", "Stucco"], ["vinyl", "Vinyl"], ["brick", "Brick or masonry"], ["other", "Other"]] },
    { id: "condition", label: "Surface condition", type: "select", options: [["good", "Sound, little peeling"], ["peeling", "Peeling or chalking in places"], ["repairs", "Rotten or damaged boards to replace"], ["not_sure", "Not sure"]], why: "Preparation is where painting quotes differ most." },
    { id: "coats", label: "Coats quoted", type: "select", options: [["1", "One"], ["2", "Two"], ["not_stated", "Not stated"]] },
    { id: "crew_told", label: "Did the contractor say how many people and how many days?", type: "select", options: [["yes", "Yes"], ["no", "No"]] },
    { id: "crew_workers", label: "People on the crew", type: "number", unit: "people", min: 1, max: 30, showIf: { crew_told: ["yes"] } },
    { id: "crew_days", label: "Days on site", type: "number", unit: "days", min: 0.5, max: 60, step: 0.5, showIf: { crew_told: ["yes"] } },
  ],
  interior_paint: [
    { id: "rooms", label: "Rooms included", type: "number", unit: "rooms", min: 1, max: 40 },
    { id: "wall_sqft", label: "Wall area, if known", type: "number", unit: "sq ft", min: 50, max: 30000 },
    { id: "ceilings", label: "Ceilings included?", type: "select", options: [["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]] },
    { id: "ceiling_height", label: "Ceiling height", type: "select", options: [["8", "8 ft"], ["9", "9 ft"], ["10_plus", "10 ft or more"], ["mixed", "Mixed"]] },
    { id: "repairs", label: "Wall repairs needed?", type: "select", options: [["none", "None"], ["minor", "Minor patching"], ["major", "Major repairs"], ["not_sure", "Not sure"]] },
    { id: "crew_told", label: "Did the contractor say how many people and how many days?", type: "select", options: [["yes", "Yes"], ["no", "No"]] },
    { id: "crew_workers", label: "People on the crew", type: "number", unit: "people", min: 1, max: 30, showIf: { crew_told: ["yes"] } },
    { id: "crew_days", label: "Days on site", type: "number", unit: "days", min: 0.5, max: 60, step: 0.5, showIf: { crew_told: ["yes"] } },
  ],
  flooring: [
    { id: "floor_sqft", label: "Floor area", type: "number", unit: "sq ft", min: 20, max: 20000, why: "Flooring is priced by area; the reference needs it." },
    { id: "floor_type", label: "New floor", type: "select", options: [["lvp", "Luxury vinyl plank or tile"], ["laminate", "Laminate"], ["hardwood", "Hardwood"], ["engineered", "Engineered wood"], ["tile", "Ceramic or porcelain tile"], ["carpet", "Carpet"], ["other", "Other"]] },
    { id: "remove_existing", label: "Old floor to remove?", type: "select", options: [["yes", "Yes"], ["no", "No"], ["not_sure", "Not sure"]] },
    { id: "subfloor", label: "Subfloor issues known?", type: "select", options: [["none", "None known"], ["uneven", "Uneven or needs leveling"], ["damage", "Damage to repair"], ["not_sure", "Not sure"]] },
    { id: "stairs", label: "Stairs included", type: "number", unit: "steps", min: 0, max: 60 },
  ],
  kitchen: [
    { id: "kitchen_sqft", label: "Kitchen size", type: "number", unit: "sq ft", min: 30, max: 1500 },
    { id: "cabinet_lf", label: "Cabinets, linear feet", type: "number", unit: "lin ft", min: 1, max: 200 },
    { id: "counter_sqft", label: "Countertop area", type: "number", unit: "sq ft", min: 5, max: 400 },
    { id: "layout_change", label: "Plumbing or electrical moved?", type: "select", options: [["no", "No, same layout"], ["some", "Some points moved"], ["major", "Major relayout"], ["not_sure", "Not sure"]], why: "Moving lines is what pulls permits and trades into the job." },
    { id: "appliances_by", label: "Appliances supplied by", type: "select", options: [["me", "Me"], ["contractor", "The contractor"], ["not_stated", "Not stated"]] },
  ],
  bathroom: [
    { id: "bath_sqft", label: "Bathroom size", type: "number", unit: "sq ft", min: 15, max: 600 },
    { id: "bath_type", label: "Type", type: "select", options: [["full", "Full bath"], ["half", "Half bath"], ["primary", "Primary bath"]] },
    { id: "tile_sqft", label: "Tile area, walls and floor", type: "number", unit: "sq ft", min: 5, max: 1000 },
    { id: "fixtures_moved", label: "Fixtures moved?", type: "select", options: [["no", "No"], ["yes", "Yes"], ["not_sure", "Not sure"]] },
    { id: "fixtures_by", label: "Fixtures and tile supplied by", type: "select", options: [["me", "Me"], ["contractor", "The contractor"], ["mixed", "Mixed"], ["not_stated", "Not stated"]] },
  ],
  hvac: [
    { id: "system_type", label: "System", type: "select", options: [["split_ac_furnace", "Central AC with gas furnace"], ["heat_pump", "Heat pump"], ["mini_split", "Ductless mini-split"], ["package", "Package unit"], ["other", "Other or not sure"]] },
    { id: "tons", label: "Capacity quoted", type: "number", unit: "tons", min: 1, max: 10, step: 0.5, why: "Capacity is the number to compare across quotes; oversizing is common." },
    { id: "load_calc", label: "Was a load calculation (Manual J) offered?", type: "select", options: yesNoNotSure },
    { id: "ductwork", label: "Ductwork changes?", type: "select", options: [["none", "None"], ["some", "Some"], ["replace", "Full replacement"], ["not_sure", "Not sure"]] },
    { id: "unit_age", label: "Age of the current system", type: "select", options: [["under_10", "Under 10 years"], ["10_15", "10 to 15 years"], ["over_15", "Over 15 years"], ["not_sure", "Not sure"]] },
  ],
  water_heater: [
    { id: "wh_type", label: "New unit", type: "select", options: [["tank", "Tank"], ["tankless", "Tankless"], ["hybrid", "Heat pump (hybrid)"], ["not_sure", "Not sure"]] },
    { id: "gallons", label: "Tank size", type: "number", unit: "gallons", min: 20, max: 120 },
    { id: "fuel", label: "Fuel", type: "select", options: [["gas", "Gas"], ["electric", "Electric"], ["propane", "Propane"], ["not_sure", "Not sure"]] },
    { id: "location", label: "Location", type: "select", options: [["garage", "Garage"], ["closet", "Closet or utility room"], ["attic", "Attic"], ["basement", "Basement"], ["outside", "Outside"]] },
    { id: "vent_change", label: "Venting or gas line changes?", type: "select", options: yesNoNotSure },
  ],
  windows: [
    { id: "window_count", label: "Windows to replace", type: "number", unit: "windows", min: 1, max: 80, why: "The count is the unit the quote should be priced by." },
    { id: "window_size", label: "Typical size", type: "select", options: [["small", "Small, under 3 x 4 ft"], ["medium", "Medium, about 3 x 5 ft"], ["large", "Large or picture windows"], ["mixed", "Mixed"]] },
    { id: "install_type", label: "Installation", type: "select", options: [["insert", "Insert (frame stays)"], ["full_frame", "Full-frame"], ["not_stated", "Not stated"]] },
    { id: "frame", label: "Frame", type: "select", options: [["vinyl", "Vinyl"], ["fiberglass", "Fiberglass"], ["wood", "Wood or clad wood"], ["aluminum", "Aluminum"], ["not_stated", "Not stated"]] },
    { id: "upper_floor", label: "Any on an upper floor?", type: "select", options: [["yes", "Yes"], ["no", "No"]] },
  ],
  other: [
    { id: "scope_qty", label: "Main quantity of the job (area, count or length)", type: "text", maxlength: 120, why: "The quote should be priced by this unit." },
    { id: "crew_told", label: "Did the contractor say how many people and how many days?", type: "select", options: [["yes", "Yes"], ["no", "No"]] },
    { id: "crew_workers", label: "People on the crew", type: "number", unit: "people", min: 1, max: 30, showIf: { crew_told: ["yes"] } },
    { id: "crew_days", label: "Days on site", type: "number", unit: "days", min: 0.5, max: 60, step: 0.5, showIf: { crew_told: ["yes"] } },
  ],
};

export function questionsFor(tradeKey) {
  return [...(TRADE_QUESTIONS[tradeKey] || TRADE_QUESTIONS.other), ...COMMON_QUESTIONS];
}

// The page needs the same definitions. This is what tools/build_hearing_json.mjs writes.
export function pageDefinition() {
  return { version: HEARING_VERSION, common: COMMON_QUESTIONS, trades: TRADE_QUESTIONS };
}

// ---------------------------------------------------------------- normalize

// Takes a getter (name -> string or string[]) and returns { answers, ignored }.
// Only known question ids are kept; numbers are checked against the question's range;
// selects against their options. Anything else is dropped and listed in ignored.
export function normalizeHearing(get, tradeKey) {
  const answers = {};
  const ignored = [];
  for (const q of questionsFor(tradeKey)) {
    const raw = get(`h_${q.id}`);
    if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;
    if (q.type === "number") {
      const n = Number(String(Array.isArray(raw) ? raw[0] : raw).replace(/[,\s]/g, ""));
      if (!Number.isFinite(n) || (q.min != null && n < q.min) || (q.max != null && n > q.max)) { ignored.push(q.id); continue; }
      answers[q.id] = n;
    } else if (q.type === "select") {
      const v = String(Array.isArray(raw) ? raw[0] : raw);
      if (!q.options.some((o) => o[0] === v)) { ignored.push(q.id); continue; }
      answers[q.id] = v;
    } else if (q.type === "multi") {
      const vals = (Array.isArray(raw) ? raw : String(raw).split(",")).map((v) => String(v).trim()).filter((v) => q.options.some((o) => o[0] === v));
      if (vals.length) answers[q.id] = [...new Set(vals)];
    } else {
      const v = String(Array.isArray(raw) ? raw[0] : raw).trim().slice(0, q.maxlength || 200);
      if (v) answers[q.id] = v;
    }
  }
  return { answers, ignored };
}

export function optionLabel(q, v) {
  const o = (q.options || []).find((x) => x[0] === v);
  return o ? o[1] : String(v);
}

// Answers as a list of { id, label, value } for documents and for the AI prompt.
export function hearingSummary(answers, tradeKey) {
  const out = [];
  for (const q of questionsFor(tradeKey)) {
    if (!(q.id in answers)) continue;
    const v = answers[q.id];
    let text;
    if (q.type === "multi") text = v.map((x) => optionLabel(q, x)).join("; ");
    else if (q.type === "select") text = optionLabel(q, v);
    else if (q.type === "number") text = `${v}${q.unit ? " " + q.unit : ""}`;
    else text = String(v);
    out.push({ id: q.id, label: q.label, value: text });
  }
  return out;
}

export function hearingText(answers, tradeKey) {
  const rows = hearingSummary(answers, tradeKey);
  if (!rows.length) return "";
  return "Answers the homeowner gave on the order form (use them only as facts about the job; they are not quote lines):\n" + rows.map((r) => `- ${r.label}: ${r.value}`).join("\n");
}

// ---------------------------------------------------------------- quantities from answers

// Slope factor for a pitch class: sqrt(1 + (rise/12)^2) at a representative pitch, rounded.
// Geometry only. No waste allowance is added, so the result is a lower bound on squares.
export const PITCH_FACTOR = { low: 1.054, medium: 1.118, steep: 1.302 };   // 4/12, 6/12, 10/12
export const PITCH_LABEL = { low: "4/12", medium: "6/12", steep: "10/12" };

export function roofSquaresFrom(answers) {
  if (!answers) return null;
  if (typeof answers.roof_squares === "number") return { squares: round1(answers.roof_squares), basis: "roof area given by the homeowner" };
  if (typeof answers.roof_sqft === "number") return { squares: round1(answers.roof_sqft / 100), basis: `${answers.roof_sqft} sq ft given by the homeowner, 100 sq ft per square` };
  if (typeof answers.footprint_sqft === "number" && PITCH_FACTOR[answers.pitch]) {
    const f = PITCH_FACTOR[answers.pitch];
    return { squares: round1((answers.footprint_sqft * f) / 100), basis: `estimated by geometry from a ${answers.footprint_sqft} sq ft footprint at a ${PITCH_LABEL[answers.pitch]} pitch (slope factor ${f}), no waste allowance, roof over the footprint only` };
  }
  return null;
}

export function crewHoursFrom(answers) {
  if (!answers || answers.crew_told !== "yes") return null;
  const w = answers.crew_workers, d = answers.crew_days;
  if (typeof w !== "number" || typeof d !== "number" || !(w > 0) || !(d > 0)) return null;
  return { workers: w, days: d, hours: Math.round(w * d * 8), basis: `${w} people x ${d} days x 8 hours, as the contractor told the homeowner (8-hour day assumed)` };
}

function round1(n) { return Math.round(n * 10) / 10; }

// ---------------------------------------------------------------- warning signs

// Each flag names its public source (an id in sources.js). Text states the rule or the
// guidance; it does not judge the contractor.
export function flagsFor(answers, geo, tradeKey) {
  const out = [];
  if (!answers) return out;
  const state = geo && geo.state;
  const p = new Set(answers.pressure || []);
  const add = (id, text, source) => out.push({ id, text, source });
  if (answers.contact_origin === "door" || answers.contact_origin === "after_storm") {
    add("cooling_off", "The contractor came to you. Under the FTC Cooling-Off Rule, a sale of $25 or more made at your home can be cancelled within three business days, and the seller must give you a written notice of that right.", "ftc-cooling-off-16cfr429");
  }
  if (p.has("today_only")) add("today_only", "A price that is good only today or this week is a pressure tactic the FTC tells consumers to walk away from. A fair quote holds long enough to get a second one.", "ftc-hiring-contractor");
  if (p.has("cash_only")) add("cash_only", "The FTC lists cash-only payment among the signs of a home improvement scam. Pay by check or card and keep the record.", "ftc-hiring-contractor");
  if (p.has("no_contract")) add("no_contract", "Get a written contract before any payment. The FTC says it should list the work, materials, price, schedule and who pulls permits.", "ftc-hiring-contractor");
  if (p.has("full_upfront")) add("full_upfront", "Full payment before work starts leaves you no leverage. The FTC advises a limited down payment and paying the rest as work is completed.", "ftc-hiring-contractor");
  if (p.has("started_early")) add("started_early", "Work that starts before you sign is a pressure tactic. Nothing should begin before the contract, the permit (if any) and the insurance certificate are in hand.", "ftc-hiring-contractor");
  if (p.has("no_license_proof")) {
    if (state === "TX") add("license_tx", "Texas does not license roofing contractors, so a roofer cannot show a state license; electricians and HVAC contractors are licensed by TDLR and plumbers by the TSBPE, and those licenses can be looked up. Ask for the general liability certificate directly from the insurer.", "tdlr-license-search");
    else if (state === "CA") add("license_ca", "In California, look the contractor up on the CSLB license check before you sign; the license number should appear on the quote.", "cslb-check-license");
    else add("license_general", "Ask for the license number and the general liability certificate, and verify both with the issuing office and the insurer, not with the contractor.", "ftc-hiring-contractor");
  }
  if (p.has("waive_deductible") || (answers.insurance_claim === "yes" && state === "TX")) {
    if (state === "TX") add("deductible_tx", "In Texas it is a violation of the Business and Commerce Code for a contractor to pay, waive, absorb or rebate an insurance deductible; the insurer may also refuse to pay the withheld part of the claim until the deductible is paid.", "tx-bcc-27.02");
    else if (p.has("waive_deductible")) add("deductible_general", "An offer to cover or waive your deductible usually means the amount is added back somewhere in the claim. Many states treat it as insurance fraud; check with your state insurance department.", "ftc-hiring-contractor");
  }
  if (answers.insurance_claim === "yes" && state === "TX" && tradeKey === "roof") add("adjuster_tx", "In Texas a roofing contractor may not act as a public adjuster or adjust the claim on your behalf on the same roof. Get the adjuster's line-item scope and compare it with the quote yourself.", "tx-ins-4102.163");
  if (typeof answers.deposit_pct === "number") {
    if (state === "CA" && answers.deposit_pct > 10) add("deposit_ca", `California caps the down payment on a home improvement contract at $1,000 or 10% of the price, whichever is less. The deposit asked here is ${answers.deposit_pct}%.`, "ca-bpc-7159");
    else if (state === "MD" && answers.deposit_pct > 33.4) add("deposit_md", `Maryland's Home Improvement Law limits the deposit to one third of the contract price. The deposit asked here is ${answers.deposit_pct}%.`, "md-busreg-8-617");
    else if (answers.deposit_pct >= 50) add("deposit_large", `A deposit of ${answers.deposit_pct}% before work starts is on the high side. The FTC advises limiting the down payment and tying payments to completed work.`, "ftc-hiring-contractor");
  }
  if (answers.year_built === "pre_1978" && ["exterior_paint", "interior_paint", "windows", "kitchen", "bathroom", "other"].includes(tradeKey)) {
    add("lead_rrp", "The home was built before 1978. Under the EPA Renovation, Repair and Painting Rule the contractor must be EPA lead-safe certified and follow lead-safe work practices; ask for the firm certificate number.", "epa-rrp");
  }
  if (answers.quotes_count === "1") add("one_quote", "This is the only quote. One price cannot show where the market is; the letter asks for the itemization a second quote would need to match.", "ftc-hiring-contractor");
  return out;
}

// ---------------------------------------------------------------- follow-up

// Gaps that a homeowner can close and that would change a number. At most three.
export function followUpQuestions(extracted, answers, tradeKey, plan) {
  const qs = [];
  const a = answers || {};
  const lines = (extracted && extracted.lines) || [];
  if (plan === "quote_check") {
    const shingles = lines.find((l) => l.material && l.material.type === "asphalt_shingles");
    if (shingles && !shingles.material.squares && !roofSquaresFrom(a)) {
      qs.push({ id: "roof_area", text: "The quote does not state the roof area. Do you know it, in squares or square feet? If not, the ground-floor footprint in square feet and the pitch will do.", fields: [{ id: "roof_squares", label: "Roof area in squares", type: "number", unit: "squares", min: 1, max: 200 }, { id: "roof_sqft", label: "or in square feet", type: "number", unit: "sq ft", min: 100, max: 20000 }, { id: "footprint_sqft", label: "or the house footprint", type: "number", unit: "sq ft", min: 200, max: 10000 }, { id: "pitch", label: "Roof pitch", type: "select", options: [["low", "Low, up to 4/12"], ["medium", "Medium, 5/12 to 8/12"], ["steep", "Steep, over 8/12"], ["not_sure", "Not sure"]] }] });
    }
    if (shingles && shingles.material.squares && !shingles.material.weight_lb_per_square && typeof a.shingle_weight !== "number") {
      qs.push({ id: "shingle_weight", text: "The shingle product's weight per square is not in the quote. If you have the product sheet or brochure, what weight does it state?", fields: [{ id: "shingle_weight", label: "Weight per square", type: "number", unit: "lb", min: 150, max: 500 }] });
    }
    const labor = lines.find((l) => l.kind === "labor" && !(l.labor && (l.labor.hours || (l.labor.workers && l.labor.days))));
    if (labor && a.crew_told !== "yes" && !crewHoursFrom(a)) {
      qs.push({ id: "crew", text: "The labor line gives no hours. Did the contractor mention how many people would come and for how many days?", fields: [{ id: "crew_told", label: "Did they say?", type: "select", options: [["yes", "Yes"], ["no", "No"]] }, { id: "crew_workers", label: "People on the crew", type: "number", unit: "people", min: 1, max: 30 }, { id: "crew_days", label: "Days on site", type: "number", unit: "days", min: 0.5, max: 60, step: 0.5 }] });
    }
    if (lines.some((l) => l.kind === "permit") && !a.inside_city) {
      qs.push({ id: "inside_city", text: "The quote includes a permit line. Is the property inside the city limits? City exemptions apply only inside them.", fields: [{ id: "inside_city", label: "Inside the city limits?", type: "select", options: yesNoNotSure }] });
    }
  }
  return qs.slice(0, 3);
}

// Fields a follow-up form may set (only these are accepted by /answer).
export function followUpFieldIds(qs) {
  const ids = new Set();
  for (const q of qs) for (const f of q.fields) ids.add(f.id);
  return ids;
}
