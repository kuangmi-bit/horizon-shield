import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { stripMetadata, sniff } from "../src/exif.js";
import { signPath, verifyPath, ctEqual } from "../src/sign.js";
import { priceFor, checkIpnAgainstOrder, checkoutUrl } from "../src/paypal.js";
import { gates, parseExtraction } from "../src/extract.js";
import { resolveZip } from "../src/geo.js";
import { tradeKey } from "../src/trades.js";
import { esc } from "../src/templates.js";
import { normalizeHearing, roofSquaresFrom, crewHoursFrom, flagsFor, followUpQuestions, hearingSummary, questionsFor, pageDefinition, PITCH_FACTOR } from "../src/hearing.js";
import { SOURCES } from "../src/sources.js";
import { existsSync } from "node:fs";

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const has = (bytes, s) => Buffer.from(bytes).includes(Buffer.from(s));

// metadata
const jpg = fx("gps.jpg");
assert.ok(has(jpg, "Exif") && has(jpg, "TestCam"), "fixture has EXIF");
const cj = stripMetadata(jpg);
assert.equal(cj.kind, "jpeg");
assert.ok(!has(cj.bytes, "Exif") && !has(cj.bytes, "TestCam"), "EXIF removed");
assert.equal(cj.bytes[0], 0xff); assert.equal(cj.bytes[1], 0xd8);
assert.equal(cj.bytes[cj.bytes.length - 2], 0xff); assert.equal(cj.bytes[cj.bytes.length - 1], 0xd9);
const png = fx("text.png");
assert.ok(has(png, "secret location"));
const cp = stripMetadata(png);
assert.equal(cp.kind, "png");
assert.ok(!has(cp.bytes, "secret location") && has(cp.bytes, "IEND"), "PNG text removed");
assert.equal(stripMetadata(fx("not_supported.heic")).kind, null, "HEIC rejected");
const ap = stripMetadata(fx("gps_appended.jpg"));
assert.ok(!has(ap.bytes, "Exif") && !has(ap.bytes, "secret-app3"), "appended second JPEG and APP3 removed");
assert.equal(ap.bytes.length, cj.bytes.length, "same clean bytes as the plain fixture");
assert.throws(() => stripMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00])), /jpeg/);
assert.equal(sniff(new TextEncoder().encode("%PDF-1.7 x")), "pdf");

// signing
const secret = "s3cret-for-tests";
const signed = await signPath(secret, "/files/US-1/a.pdf", 60000);
const u = new URL("https://x" + signed);
assert.ok(await verifyPath(secret, "/files/US-1/a.pdf", u.searchParams.get("exp"), u.searchParams.get("sig")));
assert.ok(!(await verifyPath(secret, "/files/US-2/a.pdf", u.searchParams.get("exp"), u.searchParams.get("sig"))), "other path rejected");
assert.ok(!(await verifyPath(secret, "/files/US-1/a.pdf", String(Date.now() - 1), u.searchParams.get("sig"))), "expired rejected");
assert.ok(ctEqual("abc", "abc") && !ctEqual("abc", "abd") && !ctEqual("", ""));

// prices and PayPal checks
assert.equal(priceFor("quote_check"), 39); assert.equal(priceFor("detailed_estimate"), 119); assert.throws(() => priceFor("constructor"), /unknown plan/);
const env = { PAYPAL_BUSINESS: "pay@example.com", PUBLIC_WORKER_URL: "https://w.example", SITE_URL: "https://s.example" };
const order = { id: "US-20260927-ABCDEF", plan: "quote_check", price: 39 };
const ipn = (o) => new URLSearchParams({ payment_status: "Completed", receiver_email: "PAY@example.com", mc_currency: "USD", mc_gross: "39.00", txn_id: "T1", custom: order.id, ...o });
assert.equal(checkIpnAgainstOrder(ipn({}), order, env).ok, true);
assert.match(checkIpnAgainstOrder(ipn({ mc_gross: "3.90" }), order, env).reason, /amount/);
assert.match(checkIpnAgainstOrder(ipn({ mc_currency: "JPY" }), order, env).reason, /currency/);
assert.match(checkIpnAgainstOrder(ipn({ receiver_email: "x@y.z" }), order, env).reason, /receiver/);
const envId = { ...env, PAYPAL_BUSINESS: "G8ZSZH6ZW3NNC" };
assert.equal(checkIpnAgainstOrder(ipn({ receiver_id: "G8ZSZH6ZW3NNC" }), order, envId).ok, true, "merchant id accepted via receiver_id");
assert.match(checkIpnAgainstOrder(ipn({ receiver_id: "AAAAAAAAAAAAA" }), order, envId).reason, /receiver/);
assert.match(checkIpnAgainstOrder(ipn({ payment_status: "Pending" }), order, env).reason, /status/);
assert.match(checkIpnAgainstOrder(ipn({}), null, env).reason, /unknown/);
const co = new URL(checkoutUrl(order, env));
assert.equal(co.searchParams.get("amount"), "39.00"); assert.equal(co.searchParams.get("currency_code"), "USD"); assert.equal(co.searchParams.get("custom"), order.id);
assert.throws(() => checkoutUrl(order, {}), /PAYPAL_BUSINESS/);

// extraction gates
assert.equal(gates({ lines: [] }, "quote_check").pass, false);
const g = gates({ doc: { total: 1000 }, lines: [{ item: "a", amount: 400, kind: "labor" }, { item: "b", amount: 500, kind: "other" }] }, "quote_check");
assert.equal(g.pass, true); assert.match(g.notes[0], /add up to 900/);
assert.equal(gates({ lines: [{ item: "a", amount: "400", kind: "labor" }] }, "quote_check").pass, false);

// geo and trades
assert.equal(resolveZip("78745").cbsa, "12420");
assert.equal(resolveZip("00000").ok, false);
assert.equal(tradeKey("Roof replacement"), "roof"); assert.equal(tradeKey("Kitchen remodel"), "kitchen"); assert.equal(tradeKey("gutter cleaning"), "other");

// escaping
assert.equal(esc('<img src=x onerror="a">&\''), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");

// the hearing: normalization keeps only defined ids, ranges and options
{
  const get = (n) => ({ h_roof_squares: "26", h_pitch: "medium", h_layers: "9", h_pressure: ["today_only", "nope"], h_deposit_pct: "150", h_stories: "2", h_scope_qty: "x" })[n] ?? null;
  const n = normalizeHearing(get, "roof");
  assert.deepEqual(n.answers, { roof_squares: 26, pitch: "medium", stories: "2", pressure: ["today_only"] });
  assert.deepEqual(n.ignored, ["layers", "deposit_pct"]);
  assert.ok(questionsFor("roof").some((q) => q.id === "roof_squares") && !questionsFor("windows").some((q) => q.id === "roof_squares"));
  // every option value and id is a plain token; every flag source exists
  for (const q of [...questionsFor("roof"), ...questionsFor("hvac"), ...questionsFor("other")]) { assert.match(q.id, /^[a-z_]+$/); for (const o of q.options || []) assert.match(o[0], /^[a-z0-9_]+$/); }
}
// geometry, crew hours
assert.deepEqual(roofSquaresFrom({ roof_squares: 26 }), { squares: 26, basis: "roof area given by the homeowner" });
assert.equal(roofSquaresFrom({ roof_sqft: 2650 }).squares, 26.5);
assert.equal(roofSquaresFrom({ footprint_sqft: 1600, pitch: "medium" }).squares, Math.round(1600 * PITCH_FACTOR.medium / 100 * 10) / 10);
assert.equal(roofSquaresFrom({ footprint_sqft: 1600, pitch: "not_sure" }), null, "no pitch, no estimate");
assert.equal(Math.round(PITCH_FACTOR.medium * 1000) / 1000, Math.round(Math.sqrt(1 + 0.25) * 1000) / 1000, "6/12 slope factor");
assert.deepEqual(crewHoursFrom({ crew_told: "yes", crew_workers: 3, crew_days: 2.5 }).hours, 60);
assert.equal(crewHoursFrom({ crew_told: "no", crew_workers: 3, crew_days: 2 }), null);
// warning signs depend on the state
{
  const tx = flagsFor({ contact_origin: "after_storm", pressure: ["waive_deductible", "no_license_proof"], insurance_claim: "yes", deposit_pct: 60, year_built: "pre_1978" }, { state: "TX" }, "roof");
  assert.deepEqual(tx.map((f) => f.id), ["cooling_off", "license_tx", "deductible_tx", "adjuster_tx", "deposit_large"]);
  const ca = flagsFor({ pressure: ["no_license_proof"], deposit_pct: 20, year_built: "pre_1978" }, { state: "CA" }, "exterior_paint");
  assert.deepEqual(ca.map((f) => f.id), ["license_ca", "deposit_ca", "lead_rrp"]);
  const md = flagsFor({ deposit_pct: 40 }, { state: "MD" }, "roof");
  assert.deepEqual(md.map((f) => f.id), ["deposit_md"]);
  assert.deepEqual(flagsFor({ deposit_pct: 40 }, { state: "MD" }, "roof").map((f) => f.source), ["md-busreg-8-617"]);
  assert.deepEqual(flagsFor({}, { state: "TX" }, "roof"), []);
  for (const f of [...tx, ...ca, ...md]) assert.ok(SOURCES[f.source], "flag source listed: " + f.source);
}
// follow-up: only gaps the homeowner can close, at most three, never for the detailed estimate
{
  const ex = { lines: [{ item: "Shingles", kind: "material", material: { type: "asphalt_shingles", squares: null } }, { item: "Labor", kind: "labor", labor: {} }, { item: "Permit", kind: "permit" }] };
  assert.deepEqual(followUpQuestions(ex, {}, "roof", "quote_check").map((q) => q.id), ["roof_area", "crew", "inside_city"]);
  assert.deepEqual(followUpQuestions(ex, { roof_squares: 20, crew_told: "yes", crew_workers: 2, crew_days: 2, inside_city: "no" }, "roof", "quote_check"), []);
  assert.deepEqual(followUpQuestions(ex, {}, "roof", "detailed_estimate"), []);
  const ex2 = { lines: [{ item: "Shingles", kind: "material", material: { type: "asphalt_shingles", squares: 26, weight_lb_per_square: null } }] };
  assert.deepEqual(followUpQuestions(ex2, {}, "roof", "quote_check").map((q) => q.id), ["shingle_weight"]);
}
assert.deepEqual(hearingSummary({ pressure: ["today_only"], stories: "2", roof_squares: 26 }, "roof").map((r) => r.value), ["26 squares", "2", "Said the price is good only today or this week"]);
// the page carries the same questions as the worker
{
  const cands = ["../../hs-us-site/public/index.html", "../../../us/index.html", "../../../site/us/index.html"].map((r) => new URL(r, import.meta.url).pathname).filter((p) => existsSync(p));
  if (cands.length) {
    const html = readFileSync(cands[0], "utf8");
    const m = html.match(/<script id="hq" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m, "hearing JSON present in the page"); console.log("page sync checked:", cands[0]);
    assert.deepEqual(JSON.parse(m[1]), JSON.parse(JSON.stringify(pageDefinition())), "page questions match hearing.js (run tools/build_hearing_json.mjs)");
  }
}

// the AI reply may wrap the JSON in a sentence or a code fence; the JSON still comes out
assert.deepEqual(parseExtraction('Here is the JSON:\n```json\n{"lines":[{"item":"a"}]}\n```\nDone.'), { lines: [{ item: "a" }] });
assert.deepEqual(parseExtraction('{"a":{"b":1}} trailing'), { a: { b: 1 } });
assert.throws(() => parseExtraction("no json here"), /not valid JSON/);
assert.throws(() => parseExtraction("{broken"), /not valid JSON/);
console.log("units ok");
