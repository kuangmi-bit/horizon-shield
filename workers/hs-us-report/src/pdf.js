// HTML to PDF with Cloudflare Browser Rendering, the same engine the Japanese hs-pdf-gen uses.
// JavaScript is off and every request except inline data: URLs is refused, so a document
// can never fetch anything, whatever text ended up inside it.
//
// The Japanese worker renders with launch / newPage / setContent / pdf only. The two extra
// calls here (setJavaScriptEnabled, setRequestInterception) are standard Puppeteer, but they
// have not been exercised on Browser Rendering by this worker yet. If either of them throws,
// the page is rendered again with JavaScript off and without interception, and the result
// carries `fallback: true` so the reviewer sees it in the draft notes. The HTML is ours and
// every customer string in it is escaped, so nothing in it asks for a network resource anyway.

import puppeteer from "@cloudflare/puppeteer";

const PDF_OPTS = { format: "Letter", printBackground: true, preferCSSPageSize: true };

async function renderStrict(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (r) => (r.url().startsWith("data:") ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: "load" });
    return new Uint8Array(await page.pdf(PDF_OPTS));
  } finally {
    await page.close().catch(() => {});
  }
}

async function renderPlain(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false).catch(() => {});
    await page.setContent(html, { waitUntil: "load" });
    return new Uint8Array(await page.pdf(PDF_OPTS));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function htmlToPdf(env, htmls) {
  const list = Array.isArray(htmls) ? htmls : [htmls];
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const out = [];
    let fallback = false;
    for (const html of list) {
      try {
        out.push(await renderStrict(browser, html));
      } catch (e) {
        console.log("pdf strict render failed, rendering without interception:", String((e && e.message) || e).slice(0, 200));
        fallback = true;
        out.push(await renderPlain(browser, html));
      }
    }
    if (fallback) out.fallback = true;
    return Array.isArray(htmls) ? out : out[0];
  } finally {
    await browser.close().catch(() => {});
  }
}
