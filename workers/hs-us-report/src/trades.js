// Trades the U.S. service recognizes: which occupations to read wages for, which materials
// have a price-chain reference, and what a complete quote for the job should list.
// The checklists are ordinary items of scope, not prices.

export const TRADES = {
  roof: {
    label: "roof replacement",
    occupations: [{ soc: "47-2181", query: "Roofers", label: "Roofers" }],
    materials: [{ type: "asphalt_shingles", hs: "6807900010", label: "Asphalt shingles (HS 6807.90.0010, roofing and siding of asphalt)" }],
    checklist: ["Tear-off: number of layers removed and disposal (dumpster size, landfill fee)", "Shingle brand, product line, color and wind rating", "Underlayment type and area", "Ice and water shield where the code requires it", "Drip edge, starter strip and ridge cap", "Flashing: step, counter, chimney and pipe boots", "Ventilation: ridge, soffit or box vents", "Decking: price per sheet if rotten boards are found", "Permit, and who pulls it", "Cleanup and magnetic nail sweep", "Manufacturer warranty and workmanship warranty, in years", "Payment schedule tied to completed work"],
  },
  exterior_paint: {
    label: "exterior painting",
    occupations: [{ soc: "47-2141", query: "Painters, Construction and Maintenance", label: "Painters, construction and maintenance" }],
    materials: [],
    checklist: ["Surfaces included and excluded (siding, trim, doors, soffits)", "Surface preparation: washing, scraping, caulking, priming", "Paint brand, product line, sheen and number of coats", "Lead-safe practices for homes built before 1978", "Protection of plants, windows and walkways", "Warranty, in years", "Payment schedule tied to completed work"],
  },
  interior_paint: {
    label: "interior painting",
    occupations: [{ soc: "47-2141", query: "Painters, Construction and Maintenance", label: "Painters, construction and maintenance" }],
    materials: [],
    checklist: ["Rooms and surfaces: walls, ceilings, trim, doors", "Repairs: patching and sanding", "Paint brand, product line, sheen and number of coats", "Furniture moving and floor protection", "Lead-safe practices for homes built before 1978", "Payment schedule"],
  },
  flooring: {
    label: "flooring",
    occupations: [{ soc: "47-2042", query: "Floor Layers, Except Carpet, Wood, and Hard Tiles", label: "Floor layers" }, { soc: "47-2044", query: "Tile and Stone Setters", label: "Tile and stone setters" }],
    materials: [],
    checklist: ["Area in square feet per room and waste allowance", "Product: brand, line, thickness and wear layer", "Removal and disposal of the old floor", "Subfloor preparation and leveling", "Underlayment and moisture barrier", "Transitions, baseboards and shoe molding", "Moving furniture and appliances", "Warranty"],
  },
  kitchen: {
    label: "kitchen remodel",
    occupations: [{ soc: "47-2031", query: "Carpenters", label: "Carpenters" }, { soc: "47-2111", query: "Electricians", label: "Electricians" }, { soc: "47-2152", query: "Plumbers, Pipefitters, and Steamfitters", label: "Plumbers" }],
    materials: [],
    checklist: ["Demolition and disposal", "Cabinets: brand, line, box material, number and sizes", "Countertops: material, square feet, edge, sink cutouts", "Backsplash area and tile", "Plumbing: sink, faucet, dishwasher and gas connections", "Electrical: circuits, outlets and lighting, with permit", "Appliances supplied by whom", "Drywall and paint", "Permits and inspections", "Schedule and payment tied to completed work"],
  },
  bathroom: {
    label: "bathroom remodel",
    occupations: [{ soc: "47-2044", query: "Tile and Stone Setters", label: "Tile and stone setters" }, { soc: "47-2152", query: "Plumbers, Pipefitters, and Steamfitters", label: "Plumbers" }],
    materials: [],
    checklist: ["Demolition and disposal", "Waterproofing method for the shower", "Tile: area in square feet, product and pattern", "Fixtures: tub or shower, toilet, vanity, faucets, supplied by whom", "Plumbing changes and valves", "Ventilation fan and electrical work, with permit", "Permits and inspections", "Payment schedule"],
  },
  hvac: {
    label: "HVAC replacement",
    occupations: [{ soc: "49-9021", query: "Heating, Air Conditioning, and Refrigeration Mechanics and Installers", label: "HVAC mechanics and installers" }],
    materials: [],
    checklist: ["Equipment: brand, model numbers, capacity and efficiency ratings", "Load calculation (Manual J) for sizing", "Removal and disposal of old equipment and refrigerant recovery", "Line set, pad, thermostat and ductwork changes", "Electrical work and disconnect", "Permit and inspection", "Manufacturer and labor warranty, in years", "Rebates or tax credits the equipment qualifies for"],
  },
  water_heater: {
    label: "water heater replacement",
    occupations: [{ soc: "47-2152", query: "Plumbers, Pipefitters, and Steamfitters", label: "Plumbers" }],
    materials: [],
    checklist: ["Unit: brand, model, capacity and fuel type", "Removal and disposal of the old unit", "Expansion tank, pan, venting and connectors", "Permit and inspection", "Warranty on tank and labor"],
  },
  windows: {
    label: "window replacement",
    occupations: [{ soc: "47-2121", query: "Glaziers", label: "Glaziers" }, { soc: "47-2031", query: "Carpenters", label: "Carpenters" }],
    materials: [],
    checklist: ["Number of windows, sizes and styles", "Brand, line, frame material and glass ratings (U-factor, SHGC)", "Insert or full-frame installation", "Trim, flashing and sealing", "Removal and disposal", "Lead-safe practices for homes built before 1978", "Warranty"],
  },
  other: {
    label: "other work",
    occupations: [{ soc: "47-2061", query: "Construction Laborers", label: "Construction laborers" }],
    materials: [],
    checklist: ["Every item with quantity and unit price", "Materials: brand and product line", "Removal and disposal", "Permit, and who pulls it", "Warranty", "Payment schedule tied to completed work"],
  },
};

export function tradeKey(s) {
  const t = String(s || "").toLowerCase();
  if (/\b(roof|roofing|shingles?|re-roof)\b/.test(t)) return "roof";
  if (/\bexterior\b.*\bpaint|\bpaint\w*\b.*\bexterior\b|\bsiding\b.*\bpaint/.test(t)) return "exterior_paint";
  if (/\bpaint(ing)?\b/.test(t)) return "interior_paint";
  if (/\b(floor|flooring|laminate|vinyl plank|hardwood)\b/.test(t)) return "flooring";
  if (/\bkitchen\b/.test(t)) return "kitchen";
  if (/\b(bath|bathroom|shower)\b/.test(t)) return "bathroom";
  if (/\b(hvac|air condition\w*|furnace|heat pump|a\/c)\b/.test(t)) return "hvac";
  if (/\bwater heater\b/.test(t)) return "water_heater";
  if (/\bwindows?\b/.test(t)) return "windows";
  return Object.prototype.hasOwnProperty.call(TRADES, t) ? t : "other";
}
