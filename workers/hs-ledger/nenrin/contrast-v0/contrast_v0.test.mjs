// contrast_v0.test.mjs: TRACE attested against a walk observed.
// Offline. Run: node nenrin/contrast-v0/contrast_v0.test.mjs   (in workers/hs-ledger)   exit 1 on any failure.
// The TRACE record for the key facet is the one TRACE's own library made (trace-pin-v0 fixtures). Records with
// other subjects are signed here with a fresh Ed25519 key, over the RFC 8785 body, the way TRACE signs.
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { jcs, Refusal } from "../trace-pin-v0/trace_pin_v0.mjs";
import { buildContrast, verifyContrast, contrastSha, keysIn, subjectHost, VERDICTS } from "./contrast_v0.mjs";

const FX = JSON.parse(readFileSync(new URL("../trace-pin-v0/fixtures/trace_fixtures.json", import.meta.url), "utf8"));
const REAL_WALK = JSON.parse(readFileSync(new URL("../a2a-conduct-walk/walk_federico_1p0.json", import.meta.url), "utf8"));
const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });
const sha = (b) => createHash("sha256").update(typeof b === "string" ? Buffer.from(b, "utf8") : b).digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const V = FX.valid.record;
const IAT = V.iat;
const iso = (s) => new Date(s * 1000).toISOString().replace(".000Z", "Z");

function walkFor(base, docs, walkedAt) {
  return {
    schema: "jidec-path-v1", base, walked_at: walkedAt, purpose: "a2a-conduct-walk-v1: " + base + "/a2a",
    witness: { name: "test witness", vantage: "test vantage" }, walker: { tool: "a2a_conduct_walk.py", version: "1" },
    nodes: docs.map((d, i) => ({ n: i, kind: "fetch", request: { method: "GET", url: base + "/doc" + i }, response: { status: 200, body_sha256: sha(d) } })),
    assertions: [], verdict: { ok: true },
  };
}
async function refusal(inputs) {
  try { await buildContrast(inputs); return null; } catch (e) { return e instanceof Refusal ? e.code : "THREW:" + e.message; }
}
function signed(subject, iat = IAT) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  const body = clone(V); delete body.signature;
  body.subject = subject; body.iat = iat; body.cnf = { jwk: { kty: "OKP", crv: "Ed25519", x } };
  body.signature = edSign(null, Buffer.from(jcs(Object.fromEntries(Object.entries(body).filter(([k]) => k !== "signature"))), "utf8"), privateKey).toString("base64url");
  return { record: body, x };
}
const facet = (c, name) => c.facets.find((f) => f.facet === name);

// ---- the key facet, against TRACE's own record ---------------------------------------------------------
const cardWithKey = JSON.stringify({ name: "estimator", url: "https://agent.example.org/a2a", signatures: [], witness_key: { kty: "OKP", crv: "Ed25519", x: V.cnf.jwk.x } });
{
  const walk = walkFor("https://agent.example.org", [cardWithKey], iso(IAT + 3600));
  const c = await buildContrast({ trace: clone(V), walk, supporting: [cardWithKey] });
  t("control", "TRACE's own record, card publishing its cnf key: confirmation_key is match", facet(c, "confirmation_key").verdict === "match", JSON.stringify(facet(c, "confirmation_key")));
  t("control", "attested key_thumbprint is agentrust_trace.jwk_thumbprint", c.attested.key_thumbprint === FX.valid.thumbprint);
  t("control", "attested record_sha256 is the trace pin sha of the same bytes", c.attested.record_sha256 === FX.valid.jcs_sha256);
  t("control", "spiffe://example.org against agent.example.org: subject_host match (trust domain is a parent)", facet(c, "subject_host").verdict === "match");
  t("control", "walk an hour after iat: time is match, gap 3600", facet(c, "time").verdict === "match" && facet(c, "time").gap_seconds === 3600);
  t("control", "summary counts the facets", c.summary.match === 3 && c.summary.differ === 0);
  t("control", "every verdict is one of the four", c.facets.every((f) => VERDICTS.includes(f.verdict)));
  t("control", "the seven members an outside runner cannot see are named, not guessed", c.not_compared.length === 7 && c.not_compared.map((m) => m.member).includes("runtime"));
  const v = await verifyContrast(c, { trace: clone(V), walk, supporting: [cardWithKey] });
  t("control", "verifyContrast rebuilds it byte for byte", v.ok && v.sha256 === (await contrastSha(c)), JSON.stringify(v));
  const c2 = await buildContrast({ trace: clone(V), walk, supporting: [cardWithKey, cardWithKey] });
  t("control", "the same document twice is one supporting entry, same record", jcs(c2) === jcs(c));
  t("control", "the record carries no clock: two builds are identical", jcs(await buildContrast({ trace: clone(V), walk, supporting: [cardWithKey] })) === jcs(c));
}
{
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;
  const card = JSON.stringify({ name: "estimator", keys: [{ kty: "OKP", crv: "Ed25519", x: other }] });
  const walk = walkFor("https://agent.example.org", [card], iso(IAT + 60));
  const c = await buildContrast({ trace: clone(V), walk, supporting: [card] });
  t("control", "card publishing a different key: confirmation_key is differ, and says it may be a separate key", facet(c, "confirmation_key").verdict === "differ" && /separate keys/.test(facet(c, "confirmation_key").why));
}
{
  const card = JSON.stringify({ name: "estimator", skills: [] });
  const walk = walkFor("https://agent.example.org", [card], iso(IAT + 60));
  const c = await buildContrast({ trace: clone(V), walk, supporting: [card] });
  t("control", "card with no key: confirmation_key is attested_only", facet(c, "confirmation_key").verdict === "attested_only" && c.observed.supporting[0].keys_found.length === 0);
  const c0 = await buildContrast({ trace: clone(V), walk, supporting: [] });
  t("control", "no supporting document: attested_only, says none was supplied", facet(c0, "confirmation_key").verdict === "attested_only" && /no committed document/.test(facet(c0, "confirmation_key").why));
}

// ---- key spellings -------------------------------------------------------------------------------------
{
  const raw = Buffer.from(V.cnf.jwk.x, "base64url");
  const want = FX.valid.thumbprint;
  t("control", "walk tool key file {public_key_ed25519_b64} is read", (await keysIn({ public_key_ed25519_b64: raw.toString("base64") })).includes(want));
  const hdr = Buffer.from(JSON.stringify({ alg: "EdDSA", jwk: V.cnf.jwk })).toString("base64url");
  t("control", "an A2A card signature whose JWS protected header carries a jwk is read", (await keysIn({ signatures: [{ protected: hdr, signature: "x" }] })).includes(want));
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + Buffer.concat([Buffer.from([0xed, 0x01]), raw]).toString("hex")), s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  t("control", "a DID verification method in Ed25519 multibase (z6Mk...) is read", (await keysIn({ verificationMethod: [{ type: "Ed25519VerificationKey2020", publicKeyMultibase: "z" + s }] })).includes(want), "z" + s);
  const ec = { kty: "EC", crv: "P-256", x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU", y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0" };
  const ecT = createHash("sha256").update('{"crv":"P-256","kty":"EC","x":"' + ec.x + '","y":"' + ec.y + '"}').digest("base64url");
  const wrongCodec = Buffer.concat([Buffer.from([0xed, 0x02]), raw]);
  let m = BigInt("0x" + wrongCodec.toString("hex")), s2 = "";
  while (m > 0n) { s2 = B58[Number(m % 58n)] + s2; m /= 58n; }
  t("attack", "a multibase key with another multicodec prefix is not read as Ed25519", (await keysIn({ publicKeyMultibase: "z" + s2 })).length === 0);
  t("control", "an EC JWK gets its RFC 7638 thumbprint", (await keysIn({ jwks: { keys: [ec] } })).includes(ecT));
  t("control", "a jwk-looking object without x is ignored, not guessed", (await keysIn({ kty: "OKP", crv: "Ed25519" })).length === 0);
}

// ---- subject_host --------------------------------------------------------------------------------------
t("control", "did:web with an encoded port names host:port", subjectHost("did:web:agent.example.org%3A8443:users:a").host === "agent.example.org:8443");
{
  const { record, x } = signed("did:web:agent.example.org");
  const card = JSON.stringify({ k: { kty: "OKP", crv: "Ed25519", x } });
  const walk = walkFor("https://agent.example.org", [card], iso(IAT + 10));
  const c = await buildContrast({ trace: record, walk, supporting: [card] });
  t("control", "did:web subject at the walked host: subject_host match, key match", facet(c, "subject_host").verdict === "match" && facet(c, "confirmation_key").verdict === "match");
}
{
  const { record } = signed("did:web:elsewhere.example");
  const walk = walkFor("https://agent.example.org", [], iso(IAT + 10));
  const c = await buildContrast({ trace: record, walk });
  t("control", "did:web subject at another host: subject_host differ", facet(c, "subject_host").verdict === "differ");
}
{
  const { record } = signed("spiffe://prod.internal/agent/x");
  const c = await buildContrast({ trace: record, walk: walkFor("https://agent.example.org", [], iso(IAT)) });
  t("control", "SPIFFE trust domain unrelated to the host: not_comparable, not differ", facet(c, "subject_host").verdict === "not_comparable");
}
{
  const { record } = signed("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK");
  const c = await buildContrast({ trace: record, walk: walkFor("https://agent.example.org", [], iso(IAT)) });
  t("control", "did:key names no host: not_comparable", facet(c, "subject_host").verdict === "not_comparable" && /names no host/.test(facet(c, "subject_host").why));
}
{
  const c = await buildContrast({ trace: clone(V), walk: walkFor("https://agent.example.org", [], iso(IAT + 86400 * 30)) });
  t("control", "a walk a month after iat: time differ (outside TRACE's 24 hour window), gap reported", facet(c, "time").verdict === "differ" && facet(c, "time").gap_seconds === 86400 * 30);
  const c1 = await buildContrast({ trace: clone(V), walk: walkFor("https://agent.example.org", [], iso(IAT - 86400)) });
  t("control", "a walk exactly 24 hours before iat is inside the window (negative gap kept)", facet(c1, "time").verdict === "match" && facet(c1, "time").gap_seconds === -86400);
}

// ---- the real walk ------------------------------------------------------------------------------------
{
  const c = await buildContrast({ trace: clone(V), walk: clone(REAL_WALK) });
  t("control", "real walk (api.babyblueviper.com, 2026-09-22): observed.record_sha256 equals a2a_conduct_walk.py canonical() sha", c.observed.record_sha256 === "5adfde2c42ca1d7cf700d5729804f44ef6a8f3e6aaab55f705bdd21294a125c0", c.observed.record_sha256);
  const reordered = {}; for (const k of Object.keys(REAL_WALK).reverse()) reordered[k] = REAL_WALK[k];
  const cr = await buildContrast({ trace: clone(V), walk: reordered });
  t("control", "real walk with its members in another order: same record_sha256 (RFC 8785, not insertion order)", cr.observed.record_sha256 === c.observed.record_sha256);
  t("control", "real walk against the example TRACE record: subject_host not_comparable (example.org is not his host)", facet(c, "subject_host").verdict === "not_comparable");
  t("attack", "real walk: a card that is not the one he served is refused as support_not_committed",
    (await refusal({ trace: clone(V), walk: clone(REAL_WALK), supporting: [cardWithKey] })) === "support_not_committed");
}

// ---- attacks -------------------------------------------------------------------------------------------
{
  const walk = walkFor("https://agent.example.org", [cardWithKey], iso(IAT + 60));
  const r = clone(V); r.subject = "did:web:agent.example.org";
  t("attack", "a TRACE record edited to name the walked host fails its own signature", (await refusal({ trace: r, walk, supporting: [cardWithKey] })) === "signature_invalid");
  t("attack", "a card edited after the walk (one byte) is refused", (await refusal({ trace: clone(V), walk, supporting: [cardWithKey.replace("estimator", "estimatoR")] })) === "support_not_committed");
  const w2 = clone(walk); w2.base = "http://agent.example.org";
  t("attack", "an http base is refused", (await refusal({ trace: clone(V), walk: w2 })) === "walk_base");
  const w3 = clone(walk); w3.schema = "something-else";
  t("attack", "a record that is not a walk is refused", (await refusal({ trace: clone(V), walk: w3 })) === "walk_schema");
  const w4 = clone(walk); w4.walked_at = "yesterday";
  t("attack", "a walk without a UTC time is refused", (await refusal({ trace: clone(V), walk: w4 })) === "walk_time");
  t("attack", "more than eight supporting documents are refused", (await refusal({ trace: clone(V), walk, supporting: Array(9).fill(cardWithKey) })) === "support_count");
  const notJson = "not json";
  t("attack", "committed bytes that are not JSON are refused, not skipped", (await refusal({ trace: clone(V), walk: walkFor("https://agent.example.org", [notJson], iso(IAT)), supporting: [notJson] })) === "support_not_json");

  const c = await buildContrast({ trace: clone(V), walk, supporting: [cardWithKey] });
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;
  const card2 = JSON.stringify({ keys: [{ kty: "OKP", crv: "Ed25519", x: other }] });
  const walk2 = walkFor("https://agent.example.org", [card2], iso(IAT + 60));
  const real2 = await buildContrast({ trace: clone(V), walk: walk2, supporting: [card2] });
  const forged2 = clone(real2); forged2.facets[1].verdict = "match"; forged2.summary = { match: 3, differ: 0, attested_only: 0, not_comparable: 0 };
  const vf = await verifyContrast(forged2, { trace: clone(V), walk: walk2, supporting: [card2] });
  t("attack", "a differ edited to match fails verification, naming facets and summary", !vf.ok && vf.reason === "mismatch" && vf.diffs.includes("facets") && vf.diffs.includes("summary"), JSON.stringify(vf));
  const vw = await verifyContrast(c, { trace: clone(V), walk: walk2, supporting: [card2] });
  t("attack", "a contrast checked against another walk fails", !vw.ok);
  const vs = await verifyContrast(c, { trace: clone(V), walk, supporting: [] });
  t("attack", "a contrast checked without its supporting document fails", !vs.ok && vs.diffs.includes("facets"));
  const dropped = clone(c); dropped.does_not_establish = dropped.does_not_establish.slice(1);
  t("attack", "dropping a does_not_establish line fails verification", !(await verifyContrast(dropped, { trace: clone(V), walk, supporting: [cardWithKey] })).ok);
}

const fails = R.filter((r) => !r.ok);
for (const r of R) console.log((r.ok ? "ok   " : "FAIL ") + "[" + r.kind + "] " + r.name + (r.ok ? "" : "  :: " + r.detail));
console.log("\ncontrast-v0 " + (R.length - fails.length) + "/" + R.length + " (" + R.filter((r) => r.kind === "attack").length + " attacks)");
process.exit(fails.length ? 1 : 0);
