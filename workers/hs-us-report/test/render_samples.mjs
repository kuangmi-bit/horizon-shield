// Render the three English documents from the sample, the way the worker does:
// JavaScript off, every network request blocked, fonts inline, US Letter.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import { computeReport } from "../src/engine.js";
import { canon, sha256Hex } from "../src/canon.js";
import { renderQuoteCheck, renderDetailedEstimate, renderQuestionsLetter } from "../src/templates.js";

const fonts = {
  sans: readFileSync("/tmp/claude-0/us/site/assets/us/fonts/Geist-Variable.woff2").toString("base64"),
  mono: readFileSync("/tmp/claude-0/us/site/assets/us/fonts/GeistMono-Variable.woff2").toString("base64"),
};
const input = JSON.parse(readFileSync(new URL("./fixtures/sample_input.json", import.meta.url)));
const canonical = computeReport(input);
const sha = await sha256Hex(canon(canonical));
const report = computeReport({ ...input, with_questions: true });
const lineSources = [[], [2, 3, 4, 5], [], [1, 2], [8], [2, 5]].map((a) => a.map((n) => input.sources[n - 1]));
const meta = { fonts, order_id: "SAMPLE-0001", date: "September 27, 2026", report_sha256: sha, engine: "hs-us-engine 1.0.0", line_sources: lineSources,
  contractor_name: "[Contractor name]", customer_name: "[Your name]", job_address: "Austin, TX 78745" };
const de = computeReport({ ...input, sample: false, kind: "detailed_estimate", with_questions: false,
  lines: input.lines.map(({ quoted, ...l }) => ({ ...l, qty_text: l.item.startsWith("Architectural") ? "26 squares (24 squares of roof plus waste), 240 lb per square" : l.item.startsWith("Labor") ? "3 roofers x 3 days" : undefined })) });
const deSha = await sha256Hex(canon(de));
const docs = [
  ["quote_check", renderQuoteCheck(report, meta)],
  ["detailed_estimate", renderDetailedEstimate(de, { ...meta, report_sha256: deSha })],
  ["questions_letter", renderQuestionsLetter(report, meta)],
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ javaScriptEnabled: false });
const page = await ctx.newPage();
let blocked = 0;
await page.route("**/*", (r) => { blocked++; return r.abort(); });
for (const [name, html] of docs) {
  writeFileSync(`out/${name}.html`, html);
  await page.setContent(html, { waitUntil: "load" });
  const pdf = await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
  writeFileSync(`out/${name}.pdf`, pdf);
  console.log(name, pdf.length, "bytes");
}
console.log("network requests attempted:", blocked);
await browser.close();
