// pilot.test.mjs: tickets during the pilot (2026-10-10). Nothing is sold until TICKET_SALES is "open": /billing/create
// answers 409 sales_paused_pilot and never reaches PayPal, /pricing says so, and a SEKI-guarded answer says its tickets
// carry no monetary value. With TICKET_SALES "open" the purchase path is what it was.
import worker from "../src/index.js";
import { SEKI_STORES, SEKI_TICKETS } from "../src/seki.js";

var pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name + (detail === undefined ? "" : "   <<< " + JSON.stringify(detail).slice(0, 300))); } }

var outbound = [];
var realFetch = globalThis.fetch;
globalThis.fetch = async function (u, init) { outbound.push(String(u)); return new Response(JSON.stringify({ access_token: "t", id: "ORDER1", links: [{ rel: "payer-action", href: "https://paypal.test/approve" }] }), { headers: { "Content-Type": "application/json" } }); };

var TICKETS_DO = { idFromName: function () { return "v1"; }, get: function () { return { fetch: async function () { return new Response(JSON.stringify({ ok: true, total_unused_balance_yen: 0, threshold_yen: 10000000, level: "ok" }), { headers: { "Content-Type": "application/json" } }); } }; } };
function env(extra) { return Object.assign({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", TICKETS_DO: TICKETS_DO }, extra || {}); }
async function create(e, body) {
  return worker.fetch(new Request("https://gw/billing/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), e, { waitUntil: function () {} });
}

console.log("[TICKET_SALES unset: the pilot]");
outbound.length = 0;
var r1 = await create(env(), { store: "hs-partner-001", tickets: 100 });
var b1 = await r1.json();
ok("/billing/create: 409 sales_paused_pilot", r1.status === 409 && b1.ok === false && b1.error === "sales_paused_pilot", b1);
ok("PayPal was never called", outbound.length === 0, outbound);
var p1 = await (await worker.fetch(new Request("https://gw/pricing"), env(), {})).json();
ok("/pricing: ticket_sales paused_pilot, with the note", p1.ticket_sales === "paused_pilot" && typeof p1.ticket_sales_note === "string" && p1.ticket_sales_note.length > 0, p1.ticket_sales);
ok("/pricing: no packs offered while paused (the member page draws its buy buttons from packs, so none appear)", Array.isArray(p1.packs) && p1.packs.length === 0 && p1.packs_when_sales_open.length === 4, p1.packs);
ok("/pricing: the SEKI section says no monetary value", p1.seki && p1.seki.mode === "pilot" && p1.seki.monetary_value === false, p1.seki);
var r1b = await create(env({ TICKET_SALES: "yes" }), { store: "hs-partner-001", tickets: 100 });
ok("any value other than \"open\" keeps sales paused", r1b.status === 409 && outbound.length === 0);
var r1c = await create({ TICKETS_DO: TICKETS_DO }, { store: "hs-partner-001", tickets: 100 });
ok("paused even where PayPal is not configured", r1c.status === 409);

console.log("[TICKET_SALES \"open\": the purchase path as before]");
outbound.length = 0;
var r2 = await create(env({ TICKET_SALES: "open" }), { store: "hs-partner-001", tickets: 100 });
var b2 = await r2.json();
ok("/billing/create makes the order and returns the approve URL", r2.status === 200 && b2.ok === true && b2.order_id === "ORDER1" && b2.approve_url === "https://paypal.test/approve" && b2.yen === 9500, b2);
ok("PayPal was called (token, then order)", outbound.length === 2 && /oauth2\/token/.test(outbound[0]) && /checkout\/orders/.test(outbound[1]), outbound);
var r2b = await create(env({ TICKET_SALES: "open" }), { store: "hs-partner-001", tickets: 7 });
ok("a size that is not a pack is still refused (400)", r2b.status === 400);
var p2 = await (await worker.fetch(new Request("https://gw/pricing"), env({ TICKET_SALES: "open" }), {})).json();
ok("/pricing: ticket_sales open, no note, the four packs offered", p2.ticket_sales === "open" && p2.ticket_sales_note === null && p2.packs.length === 4 && p2.packs[1].tickets === 100 && p2.packs[1].yen === 9500);

console.log("[SEKI tickets]");
ok("the guarded store list is unchanged", JSON.stringify(SEKI_STORES) === JSON.stringify(["hs-seki-demo"]));
ok("SEKI_TICKETS: pilot, no monetary value, says USD and billed after use", SEKI_TICKETS.mode === "pilot" && SEKI_TICKETS.monetary_value === false && /US dollars/.test(SEKI_TICKETS.note) && /after use/.test(SEKI_TICKETS.note));

globalThis.fetch = realFetch;
console.log("\n" + (fail === 0 ? "ALL PASS " + pass : "FAIL " + fail + " of " + (pass + fail)));
process.exit(fail === 0 ? 0 : 1);
