// HTML to PDF with Cloudflare Browser Rendering, the same engine the Japanese hs-pdf-gen uses.
// JavaScript is off and every request except inline data: URLs is refused, so a document
// can never fetch anything, whatever text ended up inside it.

import puppeteer from "@cloudflare/puppeteer";

export async function htmlToPdf(env, htmls) {
  const list = Array.isArray(htmls) ? htmls : [htmls];
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const out = [];
    for (const html of list) {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (r) => (r.url().startsWith("data:") ? r.continue() : r.abort()));
      await page.setContent(html, { waitUntil: "load" });
      out.push(new Uint8Array(await page.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true })));
      await page.close();
    }
    return Array.isArray(htmls) ? out : out[0];
  } finally {
    await browser.close();
  }
}
