// trace_pin_cli.test.mjs : the one-command pin client against the real ledger module, in memory.
// fetch is routed to handleTracePin from ../trace-pin-v0/trace_pin_v0.mjs over an in-memory KV, so the client is
// tested against the code the ledger runs, not against a copy of its own assumptions. The records are the ones
// TRACE's own library signed (agentrust-trace 0.11.0, ../trace-pin-v0/fixtures). No network.
// Run: node trace_pin_cli.test.mjs   (in workers/hs-ledger/nenrin/sdk)   exit 1 on any failure.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pinRecord, pinStatus, DEFAULT_LEDGER } from "./trace_pin_cli.mjs";
import { handleTracePin } from "../trace-pin-v0/trace_pin_v0.mjs";

const FX = JSON.parse(readFileSync(new URL("../trace-pin-v0/fixtures/trace_fixtures.json", import.meta.url), "utf8"));
const NOW = FX._about.iat + 60;
const ORIGIN = "https://ledger.example";
const R = [];
const t = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: String(detail) });
const clone = (x) => JSON.parse(JSON.stringify(x));
const sha = (b) => createHash("sha256").update(b).digest("hex");

function memEnv() {
  const m = new Map();
  return {
    m,
    LEDGER: {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      put: async (k, v) => { m.set(k, String(v)); },
      list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })) }),
    },
  };
}

function ledgerFetch(env, calls) {
  return async (input, init = {}) => {
    calls.push({ url: String(input), method: init.method || "GET" });
    const url = new URL(String(input));
    const req = new Request(url, { method: init.method || "GET", headers: init.headers, body: init.body });
    const res = await handleTracePin(url.pathname, req, url, env, ORIGIN, NOW);
    return res || new Response("not ours", { status: 404 });
  };
}

// 1. dry run: local intake only, nothing sent
{
  const env = memEnv(); const calls = [];
  const r = await pinRecord(clone(FX.valid.record), { ledger: ORIGIN, nowSec: NOW, fetchImpl: ledgerFetch(env, calls) });
  t("dry run: pinnable, nothing sent", r.ok && r.stage === "dry_run" && !r.sent && calls.length === 0, JSON.stringify(r));
  t("dry run: sha is the sha256 of Python's RFC 8785 bytes of the signed record", r.sha === FX.valid.jcs_sha256, r.sha);
  t("dry run: key thumbprint is agentrust_trace.jwk_thumbprint", r.key_thumbprint === FX.valid.thumbprint, r.key_thumbprint);
  t("dry run: says the record would become public", /cannot be withdrawn/.test(r.notice || ""));
}

// 2. a record the ledger would refuse is refused locally and never sent
{
  const env = memEnv(); const calls = [];
  const bad = clone(FX.valid.record); bad.subject = "spiffe://example.org/agent/someone-else";
  const r = await pinRecord(bad, { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: ledgerFetch(env, calls) });
  t("tampered record: refused locally as signature_invalid, not sent", !r.ok && r.stage === "local_intake" && r.refused === "signature_invalid" && calls.length === 0, JSON.stringify(r));
  const old = clone(FX.v01_profile.record);
  const r2 = await pinRecord(old, { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: ledgerFetch(env, calls) });
  t("v0.1 profile: refused locally as superseded_profile, not sent", !r2.ok && r2.refused === "superseded_profile" && calls.length === 0, JSON.stringify(r2));
}

// 3. pin for real against the ledger module, then check status and bytes
{
  const env = memEnv(); const calls = [];
  const f = ledgerFetch(env, calls);
  const r = await pinRecord(clone(FX.nonascii.record), { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: f });
  t("pin: ledger accepted, status pending, receipt sha equals the local sha", r.ok && r.stage === "pinned" && r.status === "pending" && r.sha === FX.nonascii.jcs_sha256, JSON.stringify(r));
  t("pin: exactly one POST to <ledger>/evidence/trace", calls.length === 1 && calls[0].method === "POST" && calls[0].url === ORIGIN + "/evidence/trace", JSON.stringify(calls));
  t("pin: check_later names the non-default ledger", r.check_later.endsWith("--ledger " + ORIGIN), r.check_later);
  const again = await pinRecord(clone(FX.nonascii.record), { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: f });
  t("pin twice: second answer is the same sha, marked dedup", again.ok && again.dedup && again.sha === r.sha, JSON.stringify(again));
  const s = await pinStatus(r.sha, { ledger: ORIGIN, fetchImpl: f });
  t("status: found, pending, served bytes hash to the sha", s.ok && s.found && s.status === "pending" && s.bytes_match, JSON.stringify(s));
  const missing = await pinStatus("0".repeat(64), { ledger: ORIGIN, fetchImpl: f });
  t("status: an unknown sha is not found", !missing.ok && missing.found === false, JSON.stringify(missing));
  // a ledger that serves other bytes under the sha is caught
  const lying = async (input, init) => {
    const res = await f(input, init);
    if (String(input).endsWith("?format=raw")) return new Response((await res.text()).replace("}", ',"x":1}'), { status: 200 });
    return res;
  };
  const s2 = await pinStatus(r.sha, { ledger: ORIGIN, fetchImpl: lying });
  t("status: a ledger serving altered bytes under the sha fails bytes_match", !s2.ok && s2.bytes_match === false && s2.served_sha256 !== r.sha, JSON.stringify(s2));
}

// 4. a receipt for other bytes is refused
{
  const f = async () => new Response(JSON.stringify({ sha: "a".repeat(64), status: "pending" }), { status: 201 });
  const r = await pinRecord(clone(FX.valid.record), { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: f });
  t("receipt naming another sha: fails at stage receipt", !r.ok && r.stage === "receipt", JSON.stringify(r));
}

// 5. a ledger refusal is reported with its reason code
{
  const f = async () => new Response(JSON.stringify({ error: "refused", reason_code: "iat_in_future", why: "x" }), { status: 422 });
  const r = await pinRecord(clone(FX.valid.record), { ledger: ORIGIN, send: true, nowSec: NOW, fetchImpl: f });
  t("ledger refusal: reported with http 422 and reason_code", !r.ok && r.stage === "ledger" && r.http === 422 && r.refused === "iat_in_future", JSON.stringify(r));
}

// 6. the ledger parameter
{
  let threw = null;
  try { await pinRecord(clone(FX.valid.record), { ledger: "http://ledger.example", nowSec: NOW }); } catch (e) { threw = e.message; }
  t("plain http to a non-local host is refused", threw && /https/.test(threw), threw);
  const r = await pinRecord(clone(FX.valid.record), { ledger: "http://127.0.0.1:8787", nowSec: NOW });
  t("http is allowed for localhost", r.ok && r.ledger === "http://127.0.0.1:8787", JSON.stringify(r));
  t("default ledger is the public NENRIN ledger", DEFAULT_LEDGER === "https://ledger.horizonshield.dev");
}

const bad = R.filter((r) => !r.ok);
for (const r of R) console.log((r.ok ? "ok    " : "FAIL  ") + r.name + (r.ok ? "" : "  :: " + r.detail));
console.log("\n" + (R.length - bad.length) + "/" + R.length + " passed");
process.exitCode = bad.length ? 1 : 0;
