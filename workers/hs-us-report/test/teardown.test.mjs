// Free Quote Teardown and the board (src/teardown.js), with stand-ins for KV, the AI reader and LINE.
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { handleTeardown, buildTeardown, cardOf, laborHours, statsText, dailyStats, readStats, boardCacheClear, TEARDOWN_PER_HOUR } from "../src/teardown.js";
import { kv, jccdbService, outside } from "./mocks.mjs";
import { signPath } from "../src/sign.js";

const log = [];
globalThis.fetch = outside(log);
const SITE = "https://shield.the-horizons-innovation.com";
const env = { US_ORDERS: kv(), JCCDB: jccdbService([]), SITE_URL: SITE, PUBLIC_WORKER_URL: "https://w.example", ANTHROPIC_API_KEY: "x", LINE_CHANNEL_TOKEN: "x", LINE_USER_ID: "U1", LINK_SECRET: "link-secret-for-tests" };
const ctx = { waitUntil() {} };
const W = "https://w.example";
const lineTexts = () => log.filter((l) => l.url.includes("line.me")).map((l) => JSON.parse(l.body).messages[0].text);

const EX = { doc: { contractor: "Acme Roofing LLC, 512-555-0100", total: 19872, trade: "roof replacement" }, lines: [
  { item: "Remove and dispose existing shingles", amount: 3360, qty: null, unit: null, kind: "disposal" },
  { item: "Architectural shingles, 24 squares", amount: 4420, qty: 24, unit: "squares", kind: "material", material: { type: "asphalt_shingles", squares: 24, weight_lb_per_square: 240 } },
  { item: "Labor, 3 men 4 days", amount: 7200, qty: null, unit: null, kind: "labor", labor: { workers: 3, days: 4, hours: null } },
  { item: "Misc supplies and accessories", amount: 1580, qty: null, unit: null, kind: "other" },
  { item: "Overhead and profit 20%", amount: 3312, qty: null, unit: null, kind: "overhead" },
] };
const fakeExtract = async () => ({ extracted: EX, gates: { pass: true, notes: [] } });
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const req = (path, init = {}) => new Request(W + path, init);
const site = (ip) => ({ origin: SITE, "cf-connecting-ip": ip });

// 1. pure parts
assert.equal(laborHours(EX.lines), 96);
const wage = { mean: 24.08, p90: 33.24, geo_name: "Austin-Round Rock-San Marcos, TX", period: "2025-05", source_id: "bls-oews" };
const t0 = buildTeardown(EX, { tk: "roof", geo: { ok: true, state: "TX" }, wage, loading: { source: "txdot", parts: [{ rate: 0.25, label: "a" }, { rate: 0.55, label: "b" }] } });
const codes = t0.flags.map((f) => f.code);
assert.ok(codes.includes("vague"), "vague line flagged");
assert.ok(codes.includes("overhead"), "overhead flagged");
assert.ok(codes.includes("labor_above"), "labor above flagged");
assert.ok(!codes.includes("big_lump"), "a labor line with crew size and days is not a quantity-less lump");
const lumpOnly = buildTeardown({ doc: { total: 10000 }, lines: [{ item: "Complete job", amount: 9000, qty: null, unit: null, kind: "other" }, { item: "Permit", amount: 1000, kind: "permit" }] }, { tk: "other" });
assert.ok(lumpOnly.flags.some((f) => f.code === "big_lump"), "a big line with no quantity is flagged");
assert.deepEqual(t0.reference.loaded_usd_h, [43.34, 59.83]);
assert.deepEqual(t0.reference.labor.range_usd, [4161, 5744]);
assert.equal(t0.reference.labor.status, "above");
assert.ok(t0.questions.some((q) => /permit/i.test(q)), "permit question when no permit line");
const card = cardOf(t0);
const cardJson = JSON.stringify(card);
assert.ok(!/Acme|512-555|Labor, 3 men|Misc supplies/.test(cardJson), "card carries no contractor, phone or line text");
assert.ok(!("lines" in card), "card has no lines");

// 2. gates
let r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }) }), env, { extract: fakeExtract });
assert.equal(r.status, 403, "no origin");
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }), headers: { origin: "https://evil.example" } }), env, { extract: fakeExtract });
assert.equal(r.status, 403, "foreign origin");
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "short" }), headers: site("1.1.1.1") }), env, { extract: fakeExtract });
assert.equal(r.status, 400, "needs a quote");
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40), zip: "1234" }), headers: site("1.1.1.2") }), env, { extract: fakeExtract });
assert.equal(r.status, 400, "bad zip");

// 3. a full teardown with ZIP (Austin metro from the mock wage rows)
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "Roof quote lines ".repeat(3), zip: "78745", trade: "roof" }), headers: site("2.2.2.2") }), env, { extract: fakeExtract });
let b = await r.json();
assert.equal(r.status, 200, JSON.stringify(b));
assert.ok(/^td_[a-z2-9]{12}$/.test(b.teardown_id));
assert.equal(b.teardown.reference.labor.status, "above");
assert.ok(b.teardown.reference.sources.every((s) => typeof s.title === "string"));
const stored = JSON.parse(await env.US_ORDERS.get(`td:${b.teardown_id}`));
assert.ok(!/Acme|Labor, 3 men/.test(JSON.stringify(stored)), "nothing but the card is stored");
const first = b;

// 4. per-hour limit
for (let i = 1; i < TEARDOWN_PER_HOUR; i++) await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }), headers: site("3.3.3.3") }), env, { extract: fakeExtract });
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }), headers: site("3.3.3.3") }), env, { extract: fakeExtract });
assert.equal(r.status, 200);
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }), headers: site("3.3.3.3") }), env, { extract: fakeExtract });
assert.equal(r.status, 429, "4th from the same network in an hour");

// 5. AI failure is a 422, not a 500
r = await handleTeardown(req("/teardown", { method: "POST", body: form({ text: "x".repeat(40) }), headers: site("4.4.4.4") }), env, { extract: async () => { throw new Error("boom"); } });
assert.equal(r.status, 422);

// 6. board: wrong claim, no consent, then a real post, review, publish, list
const post = (body, ip = "5.5.5.5") => worker.fetch(req("/board/submit", { method: "POST", body: JSON.stringify(body), headers: { ...site(ip), "content-type": "application/json" } }), env, ctx);
r = await post({ teardown_id: first.teardown_id, claim: "nope", consent: true });
assert.equal(r.status, 403);
r = await post({ teardown_id: first.teardown_id, claim: first.claim });
assert.equal(r.status, 400, "consent required");
r = await post({ teardown_id: first.teardown_id, claim: first.claim, consent: true });
assert.equal(r.status, 200);
r = await post({ teardown_id: first.teardown_id, claim: first.claim, consent: true });
assert.equal(r.status, 410, "one teardown, one post");
const lt = lineTexts().pop();
assert.ok(lt.includes("【US 掲示板】") && lt.includes("/board/review/"), lt);
assert.ok(!/Acme|512-555/.test(lt));
const link = lt.match(/https:\/\/w\.example(\/board\/review\/[^\s]+)/)[1];
r = await worker.fetch(req(link.replace("/board/review/" + first.teardown_id, "/board/review/" + first.teardown_id)), env, ctx);
assert.equal(r.status, 200);
r = await worker.fetch(req(link.replace(`/board/review/${first.teardown_id}?`, `/board/review/${first.teardown_id}/publish?`)), env, ctx);
assert.equal(r.status, 405, "publish is POST only");
r = await worker.fetch(req("/board/review/" + first.teardown_id + "/publish?exp=1&sig=x", { method: "POST" }), env, ctx);
assert.equal(r.status, 403, "bad signature");
r = await worker.fetch(req(link.replace(`/board/review/${first.teardown_id}?`, `/board/review/${first.teardown_id}/publish?`), { method: "POST" }), env, ctx);
assert.equal(r.status, 200);
boardCacheClear();
r = await worker.fetch(req("/board", { headers: { origin: SITE } }), env, ctx);
b = await r.json();
assert.equal(b.cards.length, 1);
assert.equal(b.cards[0].id, first.teardown_id);
assert.equal(r.headers.get("access-control-allow-origin"), SITE);
assert.ok(!/Acme|Labor, 3 men/.test(JSON.stringify(b)));

// 7. events and the daily count
const ev = (event, origin = SITE) => worker.fetch(req("/event", { method: "POST", body: JSON.stringify({ event }), headers: { origin, "content-type": "text/plain" } }), env, ctx);
assert.equal((await ev("land_x")).status, 200);
assert.equal((await ev("land_nope")).status, 400);
assert.equal((await ev("teardown_ok")).status, 400, "server-side names cannot be sent from the page");
assert.equal((await ev("land_x", "https://evil.example")).status, 403);
const days = await readStats(env, 1);
assert.equal(days[0].land_x, 1);
assert.ok(days[0].teardown_ok >= 4 && days[0].board_submit === 1 && days[0].board_publish === 1, JSON.stringify(days[0]));
assert.ok(statsText("2026-10-09", days[0]).includes("来た 1(x 1)"));
const now = Date.now();
const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1, 0, 5);
assert.equal(await dailyStats(env, midnight - 3600000), false, "only at 00 UTC");
assert.ok(await dailyStats(env, midnight), "sent at 00 UTC");
assert.equal(await dailyStats(env, midnight + 60000), false, "once a day");

// 8. existing routes still answer
r = await worker.fetch(req("/health"), env, ctx);
assert.equal(r.status, 200);
console.log("teardown ok", first.teardown_id);
