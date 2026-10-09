#!/usr/bin/env node
// trace_pin_cli.mjs : pin a TRACE Trust Record to a NENRIN ledger in one command, and check a pin later (nenrin-verify).
//
//   npx -p nenrin-verify nenrin-trace-pin <record.json>                  check locally, show what would be sent, send nothing
//   npx -p nenrin-verify nenrin-trace-pin <record.json> --yes            pin it (the record becomes public; it cannot be withdrawn)
//   npx -p nenrin-verify nenrin-trace-pin status <sha>                   pending or anchored, and do the stored bytes hash to <sha>?
//   options: --ledger <origin>   (default https://ledger.horizonshield.dev)   --out <receipt.json>
//
// Before anything leaves the machine, the record goes through the same intake the ledger runs (trace_verify.mjs,
// SPEC.md section 2), so a record the ledger would refuse is refused here and never sent. After a pin, the ledger's
// sha must equal the sha computed here, or the command fails. The ledger is a parameter: any service that speaks the
// same contract (POST {"record"} -> {sha, status}; GET /evidence/trace/<sha>[?format=raw]) can be named.
//
// Exit 0 = done (or a dry run that would be pinnable), 1 = refused, mismatched or not found, 2 = input or network error.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { checkTraceRecord, unwrapVector, Refusal } from "./trace_verify.mjs";

export const DEFAULT_LEDGER = "https://ledger.horizonshield.dev";
export const PUBLIC_NOTICE = "A pinned record is public and cannot be withdrawn. Pin only a record you are willing to publish.";
const HEX64 = /^[0-9a-f]{64}$/;

function ledgerOrigin(s) {
  let u;
  try { u = new URL(s); } catch (_e) { throw new Error("--ledger is not a URL: " + s); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("--ledger must be https (http only for localhost)");
  return u.origin;
}

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch (_e) { return { _unparsed: text.slice(0, 200) }; }
}

/** Local intake, then (only when send is true) POST to the ledger and check the receipt. */
export async function pinRecord(recordValue, { ledger = DEFAULT_LEDGER, send = false, nowSec = Math.floor(Date.now() / 1000), fetchImpl = fetch } = {}) {
  const origin = ledgerOrigin(ledger);
  const record = unwrapVector(recordValue);
  let local;
  try { local = checkTraceRecord(record, nowSec); }
  catch (e) {
    if (e instanceof Refusal) return { ok: false, stage: "local_intake", refused: e.code, why: e.message, sent: false };
    throw e;
  }
  const base = { sha: local.sha, key_thumbprint: local.key_thumbprint, iat: local.iat, subject: local.subject, ledger: origin };
  if (!send) return { ok: true, stage: "dry_run", sent: false, ...base, notice: PUBLIC_NOTICE, next: "rerun with --yes to pin" };

  const res = await fetchImpl(origin + "/evidence/trace", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ record }), redirect: "error",
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, stage: "ledger", sent: true, http: res.status, refused: body.reason_code || body.error || null, why: body.why || null, ...base };
  if (body.sha !== local.sha) return { ok: false, stage: "receipt", sent: true, error: "the ledger answered with sha " + body.sha + ", not this record's " + local.sha, ...base };
  return {
    ok: true, stage: "pinned", sent: true, ...base,
    status: body.status, dedup: !!body.dedup, url: body.url,
    registered_producer: body.registered_producer ? body.registered_producer.producer_id || body.registered_producer : null,
    raw_url: origin + "/evidence/trace/" + local.sha + "?format=raw",
    check_later: "npx -p nenrin-verify nenrin-trace-pin status " + local.sha + (origin === DEFAULT_LEDGER ? "" : " --ledger " + origin),
  };
}

/** Is <sha> pinned, and do the bytes the ledger serves hash to it? */
export async function pinStatus(sha, { ledger = DEFAULT_LEDGER, fetchImpl = fetch } = {}) {
  const origin = ledgerOrigin(ledger);
  const s = String(sha).toLowerCase();
  if (!HEX64.test(s)) throw new Error("sha must be 64 hex characters");
  const res = await fetchImpl(origin + "/evidence/trace/" + s, { headers: { accept: "application/json" }, redirect: "error" });
  if (res.status === 404) return { ok: false, sha: s, found: false, ledger: origin };
  const body = await readJson(res);
  if (!res.ok) return { ok: false, sha: s, found: null, http: res.status, error: body.error || null, ledger: origin };
  const raw = await fetchImpl(origin + "/evidence/trace/" + s + "?format=raw", { redirect: "error" });
  const bytes = Buffer.from(await raw.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  const anchor = body.anchor || null;
  return {
    ok: raw.ok && got === s, sha: s, found: true, ledger: origin,
    status: body.status, bytes_match: got === s, served_sha256: got,
    registered_producer: body.registered_producer ? body.registered_producer.producer_id || body.registered_producer : null,
    bitcoin_block: anchor ? anchor.block : null, ledger_entry: anchor ? anchor.ledger_entry : null,
    note: body.status === "anchored" ? "the bytes existed no later than the Bitcoin block above" : "queued for the daily batch at 00:30 UTC; run again after it is stamped",
  };
}

async function main(a) {
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  const ledger = opt("--ledger") || DEFAULT_LEDGER;
  if (a[0] === "status" && a[1]) {
    const r = await pinStatus(a[1], { ledger });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  const file = a[0] && !a[0].startsWith("--") ? a[0] : null;
  if (!file) {
    console.error("usage: nenrin-trace-pin <record.json> [--yes] [--ledger URL] [--out receipt.json] | nenrin-trace-pin status <sha> [--ledger URL]");
    return 2;
  }
  const r = await pinRecord(JSON.parse(readFileSync(file, "utf8")), { ledger, send: a.includes("--yes") });
  const out = opt("--out");
  if (out) writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
  console.log(JSON.stringify(r, null, 2));
  if (r.stage === "dry_run") console.error(PUBLIC_NOTICE + " Nothing was sent; add --yes to pin.");
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(String((e && e.message) || e)); process.exitCode = 2; });
}
