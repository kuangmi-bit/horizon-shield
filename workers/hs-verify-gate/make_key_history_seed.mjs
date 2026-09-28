#!/usr/bin/env node
// Anchor the key history on the JIDEC ledger. Builds a ledger seed whose record_canonical is exactly the canonical
// JSON that history_sha256 covers, so claim_sha256 == history_sha256. Refuses to write anything unless the live
// /.well-known/key-history.json and this commit's src/key_history.js give the same bytes (the deployed history is
// the committed one). Run after deploying a change to the key history:
//
//   node workers/hs-verify-gate/make_key_history_seed.mjs
//   zsh workers/hs-ledger/append_witness.sh seed_entry_key_history_<date>.json      (the token is typed, hidden)
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { KEY_HISTORY, KEY_HISTORY_RULE, KEY_HISTORY_SCHEMA } from "./src/key_history.js";
import { canonicalUtf8 } from "./src/witness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = process.env.KEY_HISTORY_URL || "https://gate.horizonshield.dev/.well-known/key-history.json";
const local = { schema: KEY_HISTORY_SCHEMA, subject: "https://gate.horizonshield.dev", keys: KEY_HISTORY, rule: KEY_HISTORY_RULE };
const text = canonicalUtf8(local);
const sha = createHash("sha256").update(text, "utf8").digest("hex");

let live;
try { live = await (await fetch(LIVE, { headers: { accept: "application/json" } })).json(); }
catch (e) { console.error("could not read " + LIVE + ": " + e.message + ". Nothing written."); process.exit(1); }
if (!live || live.schema !== KEY_HISTORY_SCHEMA || !Array.isArray(live.keys) || !Array.isArray(live.rule)) {
  console.error(LIVE + " does not serve a key-history-v1 document (the deployed gate predates 0.4.18?). Deploy first. Nothing written.");
  process.exit(1);
}
let liveText;
try { liveText = canonicalUtf8({ schema: live.schema, subject: live.subject, keys: live.keys, rule: live.rule }); }
catch (e) { console.error("the live key history cannot be canonicalized (" + e.message + "). Nothing written."); process.exit(1); }
const liveSha = createHash("sha256").update(liveText, "utf8").digest("hex");
if (liveText !== text || live.history_sha256 !== sha || liveSha !== sha) {
  console.error("live and committed key history differ (live " + String(live.history_sha256).slice(0, 12) + ", committed " + sha.slice(0, 12) + "). Deploy first. Nothing written.");
  process.exit(1);
}
const bad = (live.env_consistency || []).filter((c) => c.configured && c.matches_active === false);
if (bad.length) { console.error("the live Worker is configured with keys that are not the active ones: " + bad.map((c) => c.use).join(", ") + ". Nothing written."); process.exit(1); }

const date = new Date().toISOString().slice(0, 10);
const summary = KEY_HISTORY.map((k) => k.use + " " + k.kid + " " + k.status).join("; ");
const seed = {
  claim_sha256: sha,
  record_canonical: text,
  work: "Key history (key-history-v1) of gate.horizonshield.dev as served on " + date + ": " + summary + ". claim_sha256 equals the history_sha256 served at /.well-known/key-history.json. It records which public keys this domain declared, when each began and its status; it does not establish that no key was stolen.",
};
const out = path.resolve(HERE, "../hs-ledger/seed_entry_key_history_" + date + ".json");
writeFileSync(out, JSON.stringify(seed) + "\n");
const back = JSON.parse(readFileSync(out, "utf8"));
if (createHash("sha256").update(back.record_canonical, "utf8").digest("hex") !== sha) { console.error("read-back mismatch"); process.exit(1); }
console.log("history_sha256 " + sha + "\nwrote " + path.relative(process.cwd(), out) + "\nnext: zsh workers/hs-ledger/append_witness.sh " + path.basename(out));
