// Run the real pipeline (stand-ins only for AI reading, KV, R2 and the data service) and
// render the documents with Chromium the way Browser Rendering does: JavaScript off, no network.
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { generateDraft } from "../src/index.js";
import { kv, r2, jccdbService, outside, EXTRACTED } from "./mocks.mjs";

globalThis.fetch = outside([]);
const env = { US_ORDERS: kv(), US_FILES: r2(), JCCDB: jccdbService(), PUBLIC_WORKER_URL: "https://hs-us-report.oga-surf-project.workers.dev", LINK_SECRET: "x", SITE_URL: "https://shield.the-horizons-innovation.com" };
const browser = await chromium.launch();
const bctx = await browser.newContext({ javaScriptEnabled: false });
const page = await bctx.newPage();
await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
const htmlToPdf = async (e, htmls) => { const out = []; for (const html of htmls) { await page.setContent(html, { waitUntil: "load" }); out.push(new Uint8Array(await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true }))); } return out; };
mkdirSync("out/pipeline", { recursive: true });
const orders = [
  { id: "US-20260927-DEMO01", plan: "quote_check", plan_name: "Quote Check", price: 39, email: "h@example.com", name: "Pat Example", contractor: "", zip: "78745", geo: (await import("../src/geo.js")).resolveZip("78745"), files: [], status: "paid", created_at: new Date().toISOString(), paid_at: new Date().toISOString() },
  { id: "US-20260927-DEMO02", plan: "detailed_estimate", plan_name: "Detailed Estimate", price: 119, email: "h@example.com", name: "", contractor: "", zip: "78745", geo: (await import("../src/geo.js")).resolveZip("78745"), files: [], status: "paid", created_at: new Date().toISOString(), paid_at: new Date().toISOString() },
];
const JOB = { schema_version: "us-extract-0.1", doc: { contractor: null, quote_no: null, quote_date: null, total: null, trade: "roof replacement" }, lines: [
  { item: "Tear-off of existing asphalt shingles, 1 layer, and disposal", qty_text: "24 squares", kind: "disposal" },
  { item: "Architectural asphalt shingles", qty_text: "26 squares (24 squares of roof plus waste), 240 lb per square", kind: "material", material: { type: "asphalt_shingles", squares: 26, weight_lb_per_square: 240 } },
  { item: "Synthetic underlayment", qty_text: "24 squares", kind: "other" },
  { item: "Drip edge, starter strip and ridge cap", qty_text: "quantity needed", kind: "other" },
  { item: "Roofing labor", qty_text: "crew hours to be stated by each contractor", kind: "labor", labor: { workers: null, days: null, hours: null } },
  { item: "Building permit, if the city requires one", qty_text: "1", kind: "permit" },
] };
for (const o of orders) {
  await env.US_ORDERS.put(`order:${o.id}`, JSON.stringify(o));
  const done = await generateDraft(env, o.id, { extract: async () => ({ extracted: o.plan === "detailed_estimate" ? JOB : EXTRACTED, gates: { pass: true, notes: [] } }), htmlToPdf });
  for (const d of done.draft.docs) {
    writeFileSync(`out/pipeline/${o.id}_${d.name}`, env.US_FILES.m.get(`reports/${o.id}/${done.draft.sha256.slice(0, 16)}/${d.name}`).bytes);
  }
  console.log(o.id, done.status, done.draft.sha256.slice(0, 16), done.draft.docs.map((d) => d.name).join(", "), "notes:", done.draft.notes.join("; ") || "none");
}
await browser.close();
