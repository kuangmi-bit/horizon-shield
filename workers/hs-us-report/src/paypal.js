// PayPal (the only payment processor): Buy Now checkout links in USD and IPN verification.
// The checkout link identifies the account by its Merchant ID (or primary email), so no email is exposed.
// The amount in the checkout link can be edited by anyone, so the IPN handler checks the
// receiver, the currency and the exact amount against the order we stored, and uses the
// transaction id to process each payment once.

export const PRICES = { quote_check: 39, detailed_estimate: 119 };
export const PLAN_NAMES = { quote_check: "Quote Check", detailed_estimate: "Detailed Estimate" };

export function priceFor(plan) {
  if (!Object.prototype.hasOwnProperty.call(PRICES, plan)) throw new Error("unknown plan");
  return PRICES[plan];
}

export function checkoutUrl(order, env) {
  if (!env.PAYPAL_BUSINESS) throw new Error("PAYPAL_BUSINESS is not set");
  const p = new URLSearchParams({
    cmd: "_xclick",
    business: env.PAYPAL_BUSINESS,
    item_name: `HORIZON SHIELD ${PLAN_NAMES[order.plan]}`,
    item_number: order.id,
    amount: order.price.toFixed(2),
    currency_code: "USD",
    custom: order.id,
    no_shipping: "1",
    charset: "utf-8",
    lc: "US",
    notify_url: `${env.PUBLIC_WORKER_URL}/webhook/paypal`,
    return: `${env.SITE_URL}/us/thanks/?order=${encodeURIComponent(order.id)}`,
    cancel_return: `${env.SITE_URL}/us/?cancelled=1`,
  });
  return `https://www.paypal.com/cgi-bin/webscr?${p.toString()}`;
}

export async function verifyIpn(rawBody, fetchImpl = fetch) {
  const res = await fetchImpl("https://ipnpb.paypal.com/cgi-bin/webscr", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "HORIZON-SHIELD-US-IPN" },
    body: "cmd=_notify-validate&" + rawBody,
  });
  return (await res.text()).trim() === "VERIFIED";
}

// Returns { ok, reason, orderId, txnId, gross, payerEmail } without side effects.
export function checkIpnAgainstOrder(params, order, env) {
  const status = params.get("payment_status");
  if (status !== "Completed") return { ok: false, reason: `status ${status}` };
  // PAYPAL_BUSINESS is the account's PayPal Merchant ID (13 characters, shown under Account Settings >
  // Business information) or its primary email. IPN carries the merchant id as receiver_id and the
  // primary email as receiver_email, so either form is accepted here.
  const mine = String(env.PAYPAL_BUSINESS || "").toLowerCase();
  const receivers = [params.get("receiver_id"), params.get("receiver_email"), params.get("business")].filter(Boolean).map((v) => String(v).toLowerCase());
  if (!mine || !receivers.includes(mine)) return { ok: false, reason: "receiver mismatch" };
  if (params.get("mc_currency") !== "USD") return { ok: false, reason: "currency mismatch" };
  if (!order) return { ok: false, reason: "unknown order" };
  const gross = Number(params.get("mc_gross"));
  if (!(Math.abs(gross - order.price) < 0.005)) return { ok: false, reason: `amount mismatch ${gross} vs ${order.price}` };
  return { ok: true, orderId: order.id, txnId: params.get("txn_id"), gross, payerEmail: params.get("payer_email") || "" };
}
