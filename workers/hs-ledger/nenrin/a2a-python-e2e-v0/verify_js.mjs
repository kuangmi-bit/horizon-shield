// verify_js.mjs <bundle.json> <transcript.json> : the JavaScript side of the a2a-python-e2e-v0 check.
// Verifies the bundle with the published verifier (nenrin_verify.mjs, npm nenrin-verify) and the same evidence
// lookup the Python side uses: the receipt's evidence ref must be the sha256 of the artifact text the A2A server
// served for that task, as recorded in the transcript. Prints one JSON line: verdict signature and report sha256.
// NENRIN_VERIFY_MJS overrides where the verifier is loaded from (default: ../sdk/nenrin_verify.mjs).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url);
const mjs = process.env.NENRIN_VERIFY_MJS ? pathToFileURL(process.env.NENRIN_VERIFY_MJS).href : new URL("../sdk/nenrin_verify.mjs", here).href;
const { verifyProvenance, didKeyResolver } = await import(mjs);

function jsCanon(v) {
  if (v === undefined || typeof v === "function") return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => { const s = jsCanon(x); return s === undefined ? "null" : s; }).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jsCanon(v[k])).join(",") + "}";
}
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const bundle = JSON.parse(readFileSync(process.argv[2], "utf8"));
const transcript = JSON.parse(readFileSync(process.argv[3], "utf8"));
const served = (transcript.task.artifacts || []).flatMap((a) => (a.parts || []).map((p) => p.text).filter((t) => typeof t === "string"));
const lookup = (ev) => {
  const hit = served.some((t) => sha(t) === ev.ref);
  return { found: served.length > 0, matches: hit };
};
const input = Object.assign({}, bundle, { resolve: didKeyResolver });
if (!process.argv.includes("--no-lookup")) input.lookup = lookup;
const report = verifyProvenance(input);
const signature = { verdict: report.verdict, refusals: report.refusals.map((r) => r.code).sort(), findings: report.findings.map((f) => f.code).sort() };
console.log(JSON.stringify({ signature, report_sha256: sha(jsCanon(report)) }));
