// seki.test.mjs: /report in front of a SEKI door (src/seki.js), through the worker's own fetch handler.
// The ticket ledger is the real TicketLedgerDO over an in-memory SQL stub; the door and hs-pdf-gen are stubs that
// record what they were sent. What is held: a guarded store spends only after the door said admit, every other answer
// (and every failure to get one) is returned with nothing spent; other stores are untouched and the door is never asked.
import worker from "../src/index.js";
import { TicketLedgerDO } from "../src/ticket_do.js";
import { SEKI_STORES } from "../src/seki.js";
import { PRICES } from "../src/tickets.js";

var pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log("  ok  " + name); } else { fail++; console.log("  FAIL " + name + (detail === undefined ? "" : "   <<< " + JSON.stringify(detail).slice(0, 300))); } }

function sqlStub() {
  var bal = new Map(), seen = new Map();
  var none = { toArray() { return []; } };
  return { exec(q) {
    var args = Array.prototype.slice.call(arguments, 1), s = q.replace(/\s+/g, " ").trim();
    if (s.startsWith("CREATE TABLE")) return none;
    if (s.startsWith("SELECT tickets FROM bal WHERE store = ?")) return { toArray() { return bal.has(args[0]) ? [{ tickets: bal.get(args[0]) }] : []; } };
    if (s.startsWith("INSERT INTO bal")) { bal.set(args[0], args[1]); return none; }
    if (s.startsWith("SELECT store, delta, at FROM seen WHERE kind = ? AND ref = ?")) { var k = args[0] + "|" + args[1]; return { toArray() { return seen.has(k) ? [seen.get(k)] : []; } }; }
    if (s.startsWith("INSERT OR IGNORE INTO seen")) { var kk = args[0] + "|" + args[1]; if (!seen.has(kk)) seen.set(kk, { kind: args[0], ref: args[1], store: args[2], delta: args[3], at: args[4] }); return none; }
    if (s.indexOf("SUM(tickets)") > -1) { var sum = 0; bal.forEach(function (v) { sum += Number(v); }); return { toArray() { return [{ s: sum }]; } }; }
    if (s.startsWith("DELETE FROM seen")) return none;
    throw new Error("stub: unhandled SQL: " + s);
  } };
}

var SALT = "test-salt";
async function tok(store) {
  var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SALT), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("hs-gateway-store:" + store));
  return Array.from(new Uint8Array(sig)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
function makeEnv(door) {
  var d = new TicketLedgerDO({ storage: { sql: sqlStub() } }, {});
  var pdfCalls = [], doorCalls = [];
  var env = {
    ADMIN_KEY: "test-admin",
    GATEWAY_STORE_SALT: SALT,
    TICKETS_DO: { idFromName: function () { return "v1"; }, get: function () { return { fetch: function (u, init) { return d.fetch(new Request(u, init)); } }; } },
    PDFGEN_SVC: { fetch: async function (u, init) { pdfCalls.push({ url: u, body: JSON.parse(init.body) }); return new Response("%PDF-1.7 stub", { headers: { "Content-Type": "application/pdf" } }); } }
  };
  if (door !== undefined) env.SEKI_SVC = { fetch: async function (u, init) { doorCalls.push({ url: u, body: init && init.body ? JSON.parse(init.body) : null }); return door(u, init); } };
  return { env: env, pdfCalls: pdfCalls, doorCalls: doorCalls };
}
function j(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } }); }
async function grant(env, store, n) {
  var r = await worker.fetch(new Request("https://gw/admin/grant?store=" + store + "&tickets=" + n, { headers: { "X-Admin-Key": "test-admin" } }), env, {});
  return r.json();
}
async function balance(env, store) { return (await worker.fetch(new Request("https://gw/balance?store=" + store, { headers: { "x-store-token": await tok(store) } }), env, {})).json(); }
async function report(env, store, service, body) {
  return worker.fetch(new Request("https://gw/report?store=" + store + "&service=" + service, { method: "POST", headers: { "Content-Type": "application/json", "x-store-token": await tok(store) }, body: JSON.stringify(body) }), env, {});
}
async function mcpAsk(env, store) {
  var r = await worker.fetch(new Request("https://gw/mcp?store=" + encodeURIComponent(store), { method: "POST", headers: { "Content-Type": "application/json", "x-store-token": await tok(store) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "gateway_ask", arguments: { ask: "外壁塗装 30坪 120万円は適正?" } } }) }), env, { waitUntil: function () {} });
  return (await r.json()).result.structuredContent;
}
var G = SEKI_STORES[0];
var ADMIT = { applies: true, ok: true, status: 200, decision: "admit", reasons: ["within_grant"], admission_sha256: "ab".repeat(32), record_sha256: "cd".repeat(32), published: { accepted: true } };
var REFUSE = { applies: true, ok: false, status: 403, content_type: "application/problem+json", decision: "refuse", reasons: ["amount_over_limit"],
  admission_sha256: "ef".repeat(32), record_sha256: "12".repeat(32), body: { type: "https://iana.org/assignments/http-problem-types#ae-required", status: 403, admission_requirements: { reasons: ["amount_over_limit"] } } };

console.log("[a store no door guards]");
var e1 = makeEnv(function () { throw new Error("the door must not be asked"); });
await grant(e1.env, "hs-partner-001", 100);
var r1 = await report(e1.env, "hs-partner-001", "report", { koji_type: "gaiheki_30tsubo", teiji_kingaku: 1200000 });
ok("runs as before: 200, a PDF, 20 tickets spent", r1.status === 200 && r1.headers.get("X-Tickets-Spent") === "20");
ok("the door was never asked", e1.doorCalls.length === 0);
ok("no X-Seki header on an unguarded call", r1.headers.get("X-Seki-Decision") === null);
var r1b = await report(e1.env, "hs-partner-001", "report", { koji_type: "x", teiji_kingaku: 1, seki: { action_request: {} } });
ok("a seki member for an unguarded store: 400, nothing spent", r1b.status === 400 && (await balance(e1.env, "hs-partner-001")).tickets === 80);

console.log("[a guarded store, the door admits]");
var e2 = makeEnv(function () { return j(ADMIT); });
await grant(e2.env, G, 100);
var sub = { action_request: { nonce: "11".repeat(16) }, presentation: [] };
var r2 = await report(e2.env, G, "report", { koji_type: "gaiheki_30tsubo", teiji_kingaku: 1200000, seki: sub });
ok("200, a PDF, 20 tickets spent", r2.status === 200 && r2.headers.get("X-Tickets-Spent") === "20" && (await balance(e2.env, G)).tickets === 80);
ok("the door was asked once with the call as the gateway will run it", e2.doorCalls.length === 1 && e2.doorCalls[0].body.store === G && e2.doorCalls[0].body.service === "report"
  && e2.doorCalls[0].body.amount === PRICES.report && JSON.stringify(e2.doorCalls[0].body.submission) === JSON.stringify(sub), e2.doorCalls[0]);
ok("the admission is named in the answer's headers", r2.headers.get("X-Seki-Decision") === "admit" && r2.headers.get("X-Seki-Admission-Sha256") === ADMIT.admission_sha256
  && r2.headers.get("X-Seki-Record-Sha256") === ADMIT.record_sha256 && r2.headers.get("X-Seki-Published") === "accepted");
ok("the answer says its tickets carry no monetary value (pilot)", r2.headers.get("X-Seki-Tickets") === "pilot; no monetary value", r2.headers.get("X-Seki-Tickets"));
ok("hs-pdf-gen did not receive the seki member", e2.pdfCalls.length === 1 && !("seki" in e2.pdfCalls[0].body) && e2.pdfCalls[0].body.teiji_kingaku === 1200000);

console.log("[a guarded store, the door refuses]");
var e3 = makeEnv(function () { return j(REFUSE); });
await grant(e3.env, G, 100);
var r3 = await report(e3.env, G, "audit", { seki: sub });
var b3 = await r3.json();
ok("the door's 403 and problem object are returned as they are", r3.status === 403 && r3.headers.get("Content-Type") === "application/problem+json" && b3.admission_requirements.reasons[0] === "amount_over_limit");
ok("the refusal's record is named, and nothing was spent", r3.headers.get("X-Seki-Admission-Sha256") === REFUSE.admission_sha256 && (await balance(e3.env, G)).tickets === 100);
ok("hs-pdf-gen was not called", e3.pdfCalls.length === 0);
ok("the door was asked for the audit at its price", e3.doorCalls[0].body.service === "audit" && e3.doorCalls[0].body.amount === PRICES.audit);

console.log("[a guarded store, no admit for any other reason: fail closed]");
var cases = [
  ["the door is not bound", undefined, 503],
  ["the door throws", function () { throw new Error("down"); }, 503],
  ["the door answers something that is not JSON", function () { return new Response("<html>", { status: 500 }); }, 503],
  ["the door says it does not hold the store", function () { return j({ applies: false }); }, 503],
  ["the door says ok without an admit", function () { return j({ applies: true, ok: true, status: 200, decision: "escalate", admission_sha256: "ab".repeat(32) }); }, 403],
  ["the door says ok without an admission sha", function () { return j({ applies: true, ok: true, status: 200, decision: "admit" }); }, 403],
  ["the door answers 503 (no Bitcoin view)", function () { return j({ applies: true, ok: false, status: 503, content_type: "application/json", body: { error: "chain_view_unavailable" } }); }, 503],
];
for (var c of cases) {
  var e = makeEnv(c[1]);
  await grant(e.env, G, 100);
  var rr = await report(e.env, G, "report", { seki: sub });
  ok(c[0] + ": " + c[2] + ", nothing spent, hs-pdf-gen not called", rr.status === c[2] && (await balance(e.env, G)).tickets === 100 && e.pdfCalls.length === 0, rr.status);
}

console.log("[a guarded store named by an alias the ticket ledger folds onto it]");
for (var alias of [G + "!", G + " ", G + "/", " " + G, G + "\u00e9", "<" + G + ">"]) {
  var ea = makeEnv(function () { return j(ADMIT); });
  await grant(ea.env, G, 100);
  var ra = await worker.fetch(new Request("https://gw/report?store=" + encodeURIComponent(alias) + "&service=compare", { method: "POST", headers: { "Content-Type": "application/json", "x-store-token": await tok(alias) }, body: JSON.stringify({}) }), ea.env, {});
  ok("store=" + JSON.stringify(alias) + ": 400, nothing spent from " + G + ", the door not asked, hs-pdf-gen not called",
    ra.status === 400 && (await balance(ea.env, G)).tickets === 100 && ea.doorCalls.length === 0 && ea.pdfCalls.length === 0, ra.status);
}

console.log("[tickets before the door]");
var e4 = makeEnv(function () { return j(ADMIT); });
await grant(e4.env, G, 10);
var r4 = await report(e4.env, G, "report", { seki: sub });
ok("not enough tickets: 402 and the door is not asked, so it admits nothing that cannot be paid for", r4.status === 402 && e4.doorCalls.length === 0);

console.log("[MCP tools/call never spends from a guarded store (audit 2026-10-10, F1)]");
for (var ms of [G, G + "!", " " + G]) {
  var em = makeEnv(function () { throw new Error("the door must not be asked"); });
  em.env.TICKETS_KV = {};
  await grant(em.env, G, 100);
  var sc = await mcpAsk(em.env, ms);
  ok("store=" + JSON.stringify(ms) + ": gateway_ask refused as seki_guarded_store, nothing spent, the door not asked",
    sc && sc.ok === false && sc.reason === "seki_guarded_store" && sc.spent === 0 && (await balance(em.env, G)).tickets === 100 && em.doorCalls.length === 0, sc);
}
var emu = makeEnv(function () { throw new Error("the door must not be asked"); });
emu.env.TICKETS_KV = {};
var scu = await mcpAsk(emu.env, "hs-partner-001");
ok("an unguarded store is not refused for SEKI on the MCP path", !scu || scu.reason !== "seki_guarded_store", scu);

console.log("[the store token is never optional for a guarded store (audit 2026-10-10, F4)]");
var en = makeEnv(function () { return j(ADMIT); });
await grant(en.env, G, 100);
delete en.env.GATEWAY_STORE_SALT;
var rn = await worker.fetch(new Request("https://gw/report?store=" + G + "&service=report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seki: sub }) }), en.env, {});
ok("no GATEWAY_STORE_SALT: a guarded store without a token is 401, the door not asked, nothing spent", rn.status === 401 && en.doorCalls.length === 0 && en.pdfCalls.length === 0, rn.status);
en.env.GATEWAY_STORE_SALT = SALT;
ok("and its balance is untouched", (await balance(en.env, G)).tickets === 100);
var eu = makeEnv(function () { throw new Error("the door must not be asked"); });
await grant(eu.env, "hs-partner-001", 100);
delete eu.env.GATEWAY_STORE_SALT;
var ru = await worker.fetch(new Request("https://gw/report?store=hs-partner-001&service=report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ koji_type: "x", teiji_kingaku: 1 }) }), eu.env, {});
ok("no GATEWAY_STORE_SALT: an unguarded store runs as before (200)", ru.status === 200, ru.status);

console.log("[GET /seki]");
var e5 = makeEnv(function (u) { return u.endsWith("/policy") ? j({ schema: "seki-door-policy-v0" }) : (u.indexOf("/record/") > 0 ? new Response("{\"a\":1}") : j({}, 404)); });
var p5 = await worker.fetch(new Request("https://gw/seki"), e5.env, {});
ok("GET /seki passes the door's policy through", p5.status === 200 && (await p5.json()).schema === "seki-door-policy-v0");
var p6 = await worker.fetch(new Request("https://gw/seki/record/" + "ab".repeat(32)), e5.env, {});
ok("GET /seki/record/<sha256> passes a record through", p6.status === 200 && (await p6.text()) === "{\"a\":1}");
var p7 = await worker.fetch(new Request("https://gw/seki/record/../policy"), e5.env, {});
ok("anything else under /seki is 404 and never reaches the door", p7.status === 404 && e5.doorCalls.every(function (x) { return x.url.endsWith("/policy") || /\/record\/[0-9a-f]{64}$/.test(x.url); }));
var e6 = makeEnv(undefined);
ok("no door bound: GET /seki is 404", (await worker.fetch(new Request("https://gw/seki"), e6.env, {})).status === 404);

console.log("\n==== " + pass + " passed, " + fail + " failed ====");
process.exit(fail ? 1 : 0);
