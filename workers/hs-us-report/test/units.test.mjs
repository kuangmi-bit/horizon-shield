import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { stripMetadata, sniff } from "../src/exif.js";
import { signPath, verifyPath, ctEqual } from "../src/sign.js";
import { priceFor, checkIpnAgainstOrder, checkoutUrl } from "../src/paypal.js";
import { gates } from "../src/extract.js";
import { resolveZip } from "../src/geo.js";
import { tradeKey } from "../src/trades.js";
import { esc } from "../src/templates.js";

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
console.log("units ok");
