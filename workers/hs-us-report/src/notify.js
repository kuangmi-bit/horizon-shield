// Email to customers (Resend, the same verified sender as the Japanese service) and
// LINE messages to TOshi. Both fail soft: a failed message never loses an order.

import { esc } from "./templates.js";

const FROM = "HORIZON SHIELD <kira@the-horizons-innovation.com>";
const REPLY_TO = "contact@the-horizons-innovation.com";

export async function sendEmail(env, to, subject, html, fetchImpl = fetch) {
  if (!to || !env.RESEND_API_KEY) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function lineToshi(env, text, fetchImpl = fetch) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) return false;
  try {
    const res = await fetchImpl("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.LINE_CHANNEL_TOKEN}` },
      body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: "text", text: String(text).slice(0, 4900) }] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const wrap = (inner) => `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0a0a0a;font-size:15px;line-height:1.6">
<div style="border-bottom:2px solid #0a0a0a;padding:16px 0 10px;font-weight:600">HORIZON SHIELD <span style="font-size:11px;color:#737373">US</span></div>
<div style="padding:18px 0">${inner}</div>
<div style="border-top:1px solid #e5e5e5;padding-top:10px;font-size:12px;color:#737373">The HORIZONs Co., Ltd. Price benchmarking information only; not a bid, inspection or legal advice. Reply to this email with any question.</div></div>`;

export function emailReceived(order) {
  return {
    subject: `We received your order ${order.id}`,
    html: wrap(`<p>Thank you. We received your payment for the ${esc(order.plan_name)} (order ${esc(order.id)}).</p>
<p>We will send your report ${order.plan === "detailed_estimate" ? "within two business days" : "within one business day"}. A business day is Monday to Friday, except U.S. federal holidays.</p>
<p>If we find no usable public data for your trade and ZIP code, or cannot read your file, we will tell you and refund the full price.</p>`),
  };
}

export function emailDelivered(order, links) {
  const items = links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join("");
  return {
    subject: `Your ${order.plan_name} is ready (${order.id})`,
    html: wrap(`<p>Your ${esc(order.plan_name)} is ready.</p><ul>${items}</ul>
<p>The links work for 12 months. The report file (JSON) lets anyone recompute the receipt printed on the report.</p>
<p>If a report contains a material error, tell us within 30 days and we will correct it within three business days or, if you prefer, refund the full price.</p>`),
  };
}

// Follow-up: two or three questions whose answers change a number in the report.
export function emailQuestions(order, questions, url, hoursToWait) {
  const items = questions.map((q) => `<li>${esc(q.text)}</li>`).join("");
  return {
    subject: `${questions.length === 1 ? "One quick question" : "A few quick questions"} about your quote (${order.id})`,
    html: wrap(`<p>We have read your quote. ${questions.length === 1 ? "One detail" : "A few details"} would make the report sharper, and only you can supply ${questions.length === 1 ? "it" : "them"}:</p>
<ol>${items}</ol>
<p><a href="${esc(url)}" style="display:inline-block;padding:10px 16px;background:#0a0a0a;color:#fff;text-decoration:none">Answer in one minute</a></p>
<p>If we do not hear back within ${hoursToWait} hours we will send the report with what the quote states, and note what was missing. You can still answer later and we will update the report.</p>`),
  };
}
