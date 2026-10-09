// English documents for the U.S. service, rendered to PDF by Browser Rendering.
// Every value that comes from a customer or from AI extraction is escaped before it is
// placed in HTML. The renderer runs with JavaScript off and all network requests blocked
// (see pdf.js), so the documents carry their fonts inline.

import { STATUS_TEXT, summarize } from "./engine.js";

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const usd = (n) => (n == null ? "" : (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US"));
const range = (r) => (Array.isArray(r) ? `${usd(r[0])} to ${usd(r[1])}` : "");

export const COMPANY = {
  name: "The HORIZONs Co., Ltd.",
  address: "Win Aoyama 942, 2-2-15 Minami-Aoyama, Minato-ku, Tokyo 107-0062, Japan",
  email: "contact@the-horizons-innovation.com",
  site: "horizonshield.dev",
};

export const DISCLAIMER =
  "HORIZON SHIELD provides price benchmarking information only. We are not a licensed contractor, engineer, architect, home inspector, public adjuster, appraiser or attorney. We did not visit, measure or inspect the property. Reference values come from public sources and are not quotes or bids. A difference between a quote line and a reference does not mean the quote is wrong, and a match does not mean the price is appropriate.";

function css(fonts) {
  const face = (name, b64) => (b64 ? `@font-face{font-family:"${name}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:100 900}` : "");
  return `${face("Geist", fonts && fonts.sans)}${face("Geist Mono", fonts && fonts.mono)}
@page{size:Letter;margin:0.6in 0.6in 0.75in}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;color:#0a0a0a;font:400 10pt/1.5 "Geist",Helvetica,Arial,sans-serif;font-feature-settings:"tnum" 1}
.mono{font-family:"Geist Mono",Menlo,monospace;font-size:7.5pt;letter-spacing:.06em;text-transform:uppercase}
.mute{color:#525252}
.dim{color:#737373}
.acc{color:#4f3cf0}
header.doc{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1.5pt solid #0a0a0a;padding-bottom:8pt;margin-bottom:16pt}
header.doc .brand{font-weight:600;font-size:11pt;letter-spacing:-.01em}
header.doc .brand span{font-family:"Geist Mono",monospace;font-size:7pt;color:#737373;margin-left:6pt}
h1{font-size:24pt;line-height:1.05;letter-spacing:-.035em;font-weight:600;margin:0 0 6pt}
h2{font-size:12.5pt;letter-spacing:-.01em;font-weight:600;margin:20pt 0 8pt;padding-top:8pt;border-top:.5pt solid #d4d4d4}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:.5pt solid #d4d4d4;border-bottom:.5pt solid #d4d4d4;margin:12pt 0 0}
.meta>div{padding:6pt 8pt 6pt 0}
.meta>div+div{padding-left:8pt;border-left:.5pt solid #e5e5e5}
.meta b{display:block;font-weight:500;font-size:9.5pt}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);border-top:1pt solid #0a0a0a;margin:16pt 0 4pt}
.tiles>div{padding:8pt 8pt 8pt 0;border-bottom:.5pt solid #e5e5e5}
.tiles>div+div{padding-left:8pt;border-left:.5pt solid #e5e5e5}
.tiles .v{font-size:17pt;font-weight:600;letter-spacing:-.03em;line-height:1.1;margin-top:3pt}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
th{font:500 6.8pt/1.3 "Geist Mono",monospace;letter-spacing:.06em;text-transform:uppercase;color:#525252;text-align:left;padding:5pt 6pt 5pt 0;border-bottom:1pt solid #0a0a0a;vertical-align:bottom}
td{padding:7pt 6pt 7pt 0;border-bottom:.5pt solid #e5e5e5;vertical-align:top}
td.r,th.r{text-align:right}
tr{break-inside:avoid}
.item{font-weight:500;display:block}
.note{display:block;color:#525252;font-size:8pt;margin-top:2pt;line-height:1.45}
.st{font:500 6.8pt/1.2 "Geist Mono",monospace;letter-spacing:.05em;white-space:nowrap}
.st.flag{color:#4f3cf0}
tfoot td{border-bottom:0;border-top:1pt solid #0a0a0a;font-weight:600}
ol.q{margin:0;padding-left:16pt}
ol.q li{margin:0 0 7pt;break-inside:avoid}
ol.src{margin:0;padding-left:16pt;font-size:8pt;color:#525252}
ol.src li{margin:0 0 3pt;word-break:break-all}
.receipt{font-family:"Geist Mono",monospace;font-size:7.5pt;color:#525252;border-top:.5pt solid #d4d4d4;padding-top:6pt;margin-top:14pt;word-break:break-all}
.legal{font-size:7.5pt;color:#737373;margin-top:14pt;line-height:1.5}
.box{border:.5pt solid #d4d4d4;padding:9pt 11pt;margin:10pt 0}
.letter p{margin:0 0 9pt;font-size:10.5pt;line-height:1.55}
.sig{margin-top:28pt}
.sig div{border-top:.5pt solid #0a0a0a;width:2.6in;padding-top:4pt;font-size:8.5pt;color:#525252}`;
}

function shell(title, body, meta) {
  return `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css(meta.fonts)}</style></head><body>${body}</body></html>`;
}

function head(title, meta) {
  return `<header class="doc"><div class="brand">HORIZON SHIELD<span>US</span></div><div class="mono dim">${esc(title)} &nbsp;/&nbsp; ${esc(meta.order_id || "")}</div></header>`;
}

function metaRow(report, meta) {
  return `<div class="meta">
<div><span class="mono dim">Prepared</span><b>${esc(meta.date)}</b></div>
<div><span class="mono dim">Job</span><b>${esc(report.trade)}</b></div>
<div><span class="mono dim">Place</span><b>${esc(report.place)}</b></div>
<div><span class="mono dim">Data version</span><b>${esc(String(report.data_version).slice(0, 10))}</b></div>
</div>`;
}

function srcRefs(report, line, i, meta) {
  const ids = (line.sources || (meta && meta.line_sources && meta.line_sources[i]) || []).map((id) => report.sources.indexOf(id) + 1).filter((n) => n > 0);
  return ids.join(" ");
}

function sourcesList(report, meta) {
  const titles = (meta && meta.source_titles) || {};
  return `<ol class="src">${report.sources.map((id) => `<li>${esc(titles[id] || id)}. ${esc((report.source_urls || {})[id] || "")}</li>`).join("")}</ol>`;
}

function basisText(l) {
  const b = l.basis;
  if (!b) return "";
  if (b.wage_mean_usd_h != null && b.hours == null) {
    return `Wages: mean $${b.wage_mean_usd_h}, 90th percentile $${b.wage_p90_usd_h} per hour. Loading ${b.loading.toFixed(2)}: ${b.loading_formula}. The quote does not state hours, so only the hourly reference is shown.`;
  }
  if (b.wage_mean_usd_h != null) {
    return `Wages: mean $${b.wage_mean_usd_h}, 90th percentile $${b.wage_p90_usd_h} per hour.${b.hours_basis ? ` Hours: ${b.hours_basis}.` : ""} Loading ${b.loading.toFixed(2)}: ${b.loading_formula}. Formula: ${b.reference_formula}.`;
  }
  if (b.contractor_usd_per_kg) {
    const qty = b.kg_per_square != null ? `${b.squares} squares x ${b.kg_per_square} kg (${b.weight_lb_per_square} lb per square)` : `${b.kg} kg`;
    const extra = [b.squares_basis ? `Area: ${b.squares_basis}.` : "", b.weight_basis ? `Weight: ${b.weight_basis}.` : ""].filter(Boolean).join(" ");
    return `Floor: ${qty} at $${b.contractor_usd_per_kg[0]} to $${b.contractor_usd_per_kg[1]} per kg (landed $${b.landed_usd_per_kg} per kg, wholesale margin ${Math.round(b.wholesale_gross_margin * 1000) / 10}%, contractor markup ${b.contractor_markup_range.map((m) => Math.round(m * 1000) / 10 + "%").join(" to ")}). Not included: ${b.not_included.join(", ")}.${extra ? " " + extra : ""}`;
  }
  return "";
}

// The hearing in the documents: what the homeowner told us, and the warning signs with sources.
function hearingSection(report) {
  const h = report.hearing;
  if (!h || !Array.isArray(h.answers) || !h.answers.length) return "";
  const rows = h.answers.map((a) => `<tr><td style="width:44%">${esc(a.label)}</td><td>${esc(a.value)}</td></tr>`).join("");
  return `<h2>What you told us</h2><p class="note" style="margin:0 0 6pt">Your answers on the order form, as given. Where a reference uses one of them, the line says so.</p><table><tbody>${rows}</tbody></table>`;
}

function flagsSection(report, meta) {
  const fl = report.flags;
  if (!Array.isArray(fl) || !fl.length) return "";
  const items = fl.map((f) => `<li>${esc(f.text)} <span class="mono dim">src ${report.sources.indexOf(f.source) + 1}</span></li>`).join("");
  return `<h2>Before you sign</h2><p class="note" style="margin:0 0 6pt">Each point matches an answer you gave to a public rule or to consumer guidance. They describe the rule, not the contractor.</p><ol class="q">${items}</ol>`;
}

function footnote(report) {
  const parts = [];
  if (report.lines.some((l) => l.reference_kind === "floor")) parts.push("A floor is a lower bound: public import and distribution figures carried to a contractor price, without freight or brand premium. The real gap to a floor is smaller than shown.");
  if (report.lines.some((l) => l.basis && l.basis.wage_mean_usd_h != null && l.reference_kind !== "unloaded_wage")) parts.push("Wage references are public statistics loaded with the markups a state transportation department allows on public work; they are not residential billing rates.");
  if (report.lines.some((l) => l.reference_kind === "unloaded_wage")) parts.push("Where a line says wages only, the reference is public wage statistics before the contractor's insurance, taxes and markup, because we have no public loading rule for that state; no above or below verdict is given for it.");
  return parts.join(" ");
}

function refCell(l) {
  if (l.reference_kind === "unloaded_wage" && Array.isArray(l.reference_usd)) return "wages only " + range(l.reference_usd);
  if (Array.isArray(l.reference_usd_per_hour)) return `$${l.reference_usd_per_hour[0].toFixed(2)} to $${l.reference_usd_per_hour[1].toFixed(2)} per hour`;
  if (Array.isArray(l.reference_usd)) return (l.reference_kind === "floor" ? "floor " : "") + range(l.reference_usd);
  if (l.status === "overlaps_reference_markups") return "in references";
  if (l.status === "ask_permit_exemption") return "often exempt";
  if (l.status === "verify_city_fee_schedule") return "city schedule";
  return "none";
}

function statusCell(l) {
  const t = STATUS_TEXT[l.status] || l.status;
  const flag = l.status === "above" || l.status === "above_floor";
  const diff = flag ? ` +${usd(l.quoted - l.reference_usd[1])}` : "";
  return `<span class="st${flag ? " flag" : ""}">${esc(t + diff)}</span>`;
}

// ---------------------------------------------------------------- Quote Check Report

export function renderQuoteCheck(report, meta) {
  const s = summarize(report);
  const rows = report.lines.map((l, i) => `<tr><td><span class="item">${esc(l.item)}</span>${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}${basisText(l) ? `<span class="note">${esc(basisText(l))}</span>` : ""}</td><td class="r">${usd(l.quoted)}</td><td class="r">${esc(refCell(l))}</td><td>${statusCell(l)}</td><td class="mono">${esc(srcRefs(report, l, i, meta))}</td></tr>`).join("");
  const qs = (report.questions || []).map((q) => `<li>${esc(q.text)}</li>`).join("");
  const body = `${head("Quote Check Report", meta)}
<h1>Quote Check Report</h1>
<p class="mute" style="margin:0">Each line of your quote next to U.S. public cost data, with the source and formula of every reference.${report.sample ? " This is a sample: the quote is invented, the reference data are real." : ""}</p>
${metaRow(report, meta)}
<div class="tiles">
<div><span class="mono dim">Quoted total</span><div class="v">${usd(s.total)}</div></div>
<div><span class="mono dim">Above reference</span><div class="v acc">${s.above_count ? "+" + usd(s.above_usd) : "$0"}</div><span class="dim" style="font-size:8pt">${s.above_count} of ${s.lines} lines</span></div>
<div><span class="mono dim">Lines to ask about</span><div class="v">${s.ask_count}</div></div>
<div><span class="mono dim">No public benchmark</span><div class="v">${s.no_data_count}</div></div>
</div>
<h2>Line by line</h2>
<table><thead><tr><th>Line</th><th class="r">Quoted</th><th class="r">Public reference</th><th>Status</th><th>Src</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td>Total</td><td class="r">${usd(s.total)}</td><td></td><td colspan="2"></td></tr></tfoot></table>
<p class="note" style="margin-top:8pt">${footnote(report)}</p>
${flagsSection(report, meta)}
${qs ? `<h2>Questions to ask the contractor</h2><ol class="q">${qs}</ol><p class="note">A ready-to-send letter with these questions is attached as a separate document.</p>` : ""}
${hearingSection(report)}
<h2>Sources</h2>${sourcesList(report, meta)}
<div class="receipt">Receipt sha256 ${esc(meta.report_sha256)} &nbsp;/&nbsp; ${esc(meta.engine || "")} &nbsp;/&nbsp; recompute it from the report file (JSON) delivered with this document${meta.jidec_entry != null ? ` &nbsp;/&nbsp; JIDEC ledger entry ${esc(meta.jidec_entry)}` : ""}</div>
<p class="legal">${esc(DISCLAIMER)}<br>${esc(COMPANY.name)}, ${esc(COMPANY.address)}. ${esc(COMPANY.email)}. ${esc(COMPANY.site)}</p>`;
  return shell("Quote Check Report", body, meta);
}

// ---------------------------------------------------------------- Detailed Estimate

export function renderDetailedEstimate(report, meta) {
  const rows = report.lines.map((l, i) => `<tr><td><span class="item">${esc(l.item)}</span>${l.qty_text ? `<span class="note">${esc(l.qty_text)}</span>` : ""}${basisText(l) ? `<span class="note">${esc(basisText(l))}</span>` : ""}${l.note ? `<span class="note">${esc(l.note)}</span>` : ""}</td><td class="r">${esc(refCell(l))}</td><td class="mono">${esc(srcRefs(report, l, i, meta))}</td></tr>`).join("");
  const scope = report.lines.map((l) => `<li>${esc(l.item)}${l.qty_text ? `: ${esc(l.qty_text)}` : ""}</li>`).join("");
  const t = report.estimate_total_usd;
  const body = `${head("Detailed Estimate", meta)}
<h1>Detailed Estimate</h1>
<p class="mute" style="margin:0">A line-item cost reference built from the measurements, photos and description you sent, before you ask for quotes. It is not a bid and not an offer to do the work.</p>
${metaRow(report, meta)}
<div class="tiles">
<div><span class="mono dim">Lines</span><div class="v">${report.lines.length}</div></div>
<div><span class="mono dim">Referenced lines, total</span><div class="v">${t && report.lines.some((l) => Array.isArray(l.reference_usd)) ? range(t) : "none yet"}</div></div>
<div><span class="mono dim">No public benchmark</span><div class="v">${report.lines_without_benchmark || 0}</div></div>
<div><span class="mono dim">Site visit</span><div class="v">None</div></div>
</div>
<p class="note">The total covers only the lines that have a public reference with a quantity. Labor is shown as an hourly reference, because the hours are for each contractor to state. Lines without a benchmark are listed so that contractors price them separately.</p>
<h2>Line by line</h2>
<table><thead><tr><th>Line and quantity</th><th class="r">Public reference</th><th>Src</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Scope list to send contractors</h2>
<div class="box"><p class="note" style="margin:0 0 6pt">Send this list with each quote request and ask for a price per line, so the quotes can be compared on the same scope.</p><ol class="q">${scope}</ol></div>
${flagsSection(report, meta)}
${hearingSection(report)}
<h2>Sources</h2>${sourcesList(report, meta)}
<div class="receipt">Receipt sha256 ${esc(meta.report_sha256)} &nbsp;/&nbsp; ${esc(meta.engine || "")}</div>
<p class="legal">Your measurements and description drive these numbers; if they are incomplete, so is this estimate. ${esc(DISCLAIMER)}<br>${esc(COMPANY.name)}, ${esc(COMPANY.address)}. ${esc(COMPANY.email)}.</p>`;
  return shell("Detailed Estimate", body, meta);
}

// ---------------------------------------------------------------- Letter to the contractor
// The U.S. counterpart of the Japanese negotiation proposal: a polite letter the homeowner
// sends in their own name. It asks for facts and itemization; it does not make demands.

export function renderQuestionsLetter(report, meta) {
  const qs = (report.questions || []).map((q) => `<li>${esc(q.text)}</li>`).join("");
  const body = `<div class="letter">
<p class="mono dim" style="margin-bottom:18pt">${esc(meta.date)}</p>
<p>To: ${esc(meta.contractor_name || "[Contractor name]")}<br>Re: Your quote ${meta.quote_ref ? esc(meta.quote_ref) + " " : ""}for ${esc(report.trade)} at ${esc(meta.job_address || report.place)}</p>
<p>Thank you for the quote. Before I decide, I would like to understand a few lines. Could you answer the questions below, in writing if possible?</p>
<ol class="q">${qs}</ol>
<p>A short itemized reply is all I need. If any line covers something I have missed, please point it out.</p>
<p>Thank you,</p>
<div class="sig"><div>${esc(meta.customer_name || "[Your name]")}</div></div>
<p class="legal" style="margin-top:36pt">Questions prepared with HORIZON SHIELD, a buyer-side price benchmarking service that is paid by homeowners only and takes no fees from contractors. Public data sources are available on request. Receipt ${esc(String(meta.report_sha256 || "").slice(0, 16))}.</p>
</div>`;
  return shell("Questions about your quote", body, meta);
}
