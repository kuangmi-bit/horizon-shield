// Human-readable titles and URLs for every source id a report can cite.
// Reports store ids; documents print these titles. Add a row here before citing a new source.

export const SOURCES = {
  "bls-oews-m2025-metro": { title: "U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, May 2025, metropolitan areas", url: "https://www.bls.gov/oes/tables.htm" },
  "bls-oews-m2025-state": { title: "U.S. Bureau of Labor Statistics, Occupational Employment and Wage Statistics, May 2025, states", url: "https://www.bls.gov/oes/tables.htm" },
  "txdot-2024-item-9.7": { title: "Texas Department of Transportation, Standard Specifications 2024, Item 9, Articles 9.7.1.1 to 9.7.1.3", url: "https://ftp.txdot.gov/pub/txdot-info/cmd/cserve/specs/2024/standard/s009.pdf" },
  "census-imdb-2607": { title: "U.S. Census Bureau, U.S. imports for consumption, landed duty-paid value, January to July 2026 (IMDB 2026-07)", url: "https://www.census.gov/trade/downloads/2026/Merch/im_m/IMDB2607.ZIP" },
  "census-aies-2024": { title: "U.S. Census Bureau, Annual Integrated Economic Survey 2024, gross margins (wholesale and retail)", url: "https://www2.census.gov/programs-surveys/aies/data/2024/" },
  "caltrans-ctss-9-1.04": { title: "Caltrans Standard Specifications 9-1.04, force account markups (Local Assistance training, Module 8, 2026)", url: "https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/training/2025/8-payment-20260106.pdf" },
  "fdot-fy2026-27-4-3.2.1": { title: "Florida Department of Transportation, Standard Specifications FY 2026-27, 4-3.2.1(4)(a)", url: "https://fdotwww.blob.core.windows.net/sitefinity/docs/default-source/specifications/by-year/fy-2026-27/ebook/fy-2026-27-ebook-compressed.pdf" },
  "bls-ppi-WPUSI012011": { title: "U.S. Bureau of Labor Statistics, Producer Price Index, Construction Materials (WPUSI012011), via FRED", url: "https://fred.stlouisfed.org/series/WPUSI012011" },
  "austin-dsd-work-exempt": { title: "City of Austin Development Services Department, Work Exempt from Building Permits", url: "https://www.austintexas.gov/page/work-exempt-building-permits" },
  "geonames-postal-us": { title: "GeoNames postal codes, United States (ZIP code to county), CC BY 4.0", url: "https://download.geonames.org/export/zip/" },
  "census-cbsa-delineation": { title: "U.S. Census Bureau metropolitan area delineation, county to metro (via the Act Now Coalition regions package, MIT)", url: "https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html" },
};

export function sourceUrls(ids) {
  const out = {};
  for (const id of ids) if (SOURCES[id]) out[id] = SOURCES[id].url;
  return out;
}

export function sourceTitles(ids) {
  const out = {};
  for (const id of ids) if (SOURCES[id]) out[id] = SOURCES[id].title;
  return out;
}
