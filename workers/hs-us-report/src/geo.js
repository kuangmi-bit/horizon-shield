// ZIP code to county and metro area, with no network call.
// ZIP to county: GeoNames postal codes (CC BY 4.0). County to metro: Census delineation
// via the Act Now Coalition regions package (MIT). Both are cited in reports that use them.

import ZIPS from "./data/zips.json" with { type: "json" };
import COUNTIES from "./data/counties.json" with { type: "json" };
import METROS from "./data/metros.json" with { type: "json" };

export const GEO_SOURCES = ["geonames-postal-us", "census-cbsa-delineation"];

export function resolveZip(zip) {
  const z = String(zip || "").trim();
  if (!/^\d{5}$/.test(z)) return { ok: false, error: "ZIP code must be 5 digits" };
  const row = ZIPS[z];
  if (!row) return { ok: false, error: "ZIP code not found", zip: z };
  const [countyFips, place] = row;
  const c = COUNTIES[countyFips];
  const out = { ok: true, zip: z, place, county_fips: countyFips, state_fips: countyFips.slice(0, 2) };
  if (c) {
    out.county = c[0];
    out.state = c[1];
    if (c[2]) {
      out.cbsa = c[2];
      out.metro_name_delineation = METROS[c[2]] || null;
    }
  }
  return out;
}

export function placeLabel(g) {
  if (!g || !g.ok) return "";
  return `${g.place}, ${g.state || ""} ${g.zip}`.replace(/\s+/g, " ").trim();
}
