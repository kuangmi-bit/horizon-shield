// key_history (gate 0.4.18): the key history route, the JWKS it feeds, and the attribution rule for revoked keys.
// The two failures this suite exists for: a key rotated in the card without the history being updated, and a
// revoked key's signature counted without independent proof of time. Run: node test/key_history.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../src/worker.js";
import { KEY_HISTORY, KEY_HISTORY_ANCHORS, anchorsFor, attributable, cardJwksKeys, findKey } from "../src/key_history.js";
import { canonicalUtf8, sha256Hex } from "../src/witness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const O = "https://gate.horizonshield.dev";
const pick = (use) => KEY_HISTORY.find((k) => k.use === use);
const ENV_OK = { GATE_COMMIT: "key-history-local", WITNESS_PUBKEY_B64: pick("witness").public_key_ed25519_b64, OPERATOR_PUBKEY_B64: pick("operator").public_key_ed25519_b64, AGREEMENT_PUBKEY_B64: pick("agreement").public_key_ed25519_b64 };
const get = async (p, env) => { const r = await worker.fetch(new Request(O + p), env, CTX); return { s: r.status, text: await r.text() }; };

let pass = 0, fail = 0;
const t = (name, ok, d) => { ok ? pass++ : fail++; console.log((ok ? "  ok   " : "  NG   ") + name + (ok || d === undefined ? "" : "  <<< " + d)); };

// route
let r = await get("/.well-known/key-history.json", ENV_OK);
const doc = JSON.parse(r.text);
t("route: 200, schema key-history-v1, 4 keys (agent-card, agreement, witness, operator)", r.s === 200 && doc.schema === "key-history-v1" && doc.keys.length === 4 && ["agent-card", "agreement", "witness", "operator"].every((u) => doc.keys.some((k) => k.use === u)), r.text.slice(0, 200));
const recomputed = await sha256Hex(canonicalUtf8({ schema: doc.schema, subject: doc.subject, keys: doc.keys, rule: doc.rule }));
t("route: history_sha256 recomputes from the served keys and rule (what the ledger anchors)", doc.history_sha256 === recomputed && /^[0-9a-f]{64}$/.test(recomputed), doc.history_sha256 + " vs " + recomputed);
t("route: every configured key matches the active key in the history", doc.env_consistency.every((c) => c.configured === true && c.matches_active === true), JSON.stringify(doc.env_consistency));
t("route: says what it does not establish (3 lines, incl. undetected theft)", doc.does_not_establish.length === 3 && doc.does_not_establish.some((x) => x.includes("stolen")));
r = await get("/.well-known/key-history.json", { GATE_COMMIT: "x", WITNESS_PUBKEY_B64: "AAAA" + pick("witness").public_key_ed25519_b64.slice(4) });
const doc2 = JSON.parse(r.text);
const w = doc2.env_consistency.find((c) => c.use === "witness"), o = doc2.env_consistency.find((c) => c.use === "operator");
t("route: a configured key that is not the active one is shown as a mismatch, not hidden", w.configured === true && w.matches_active === false);
t("route: an unset key says configured false (not a mismatch, not a match)", o.configured === false && o.matches_active === null);
t("route: the history does not change with env (same history_sha256)", doc2.history_sha256 === doc.history_sha256);

// JWKS
r = await get("/.well-known/jwks.json", ENV_OK);
const fixture = readFileSync(path.resolve(HERE, "../../a2a-card-sign/interop-go/fixtures/gate_jwks_20260928.json"), "utf8");
t("jwks: served bytes identical to the 0.4.17 JWKS pinned on 2026-09-28 (one active key, nothing changed)", r.text === fixture, r.text.slice(0, 120));
const served = JSON.parse(r.text).keys[0], active = pick("agent-card");
t("jwks: the key the card is signed with is the active agent-card key in the history (rotation guard)", served.kid === active.kid && served.x === active.public_jwk.x && served.y === active.public_jwk.y && active.status === "active", served.kid + " / " + active.kid);
const synth = [
  { use: "agent-card", kid: "a", status: "active" }, { use: "agent-card", kid: "b", status: "retired" }, { use: "agent-card", kid: "c", status: "revoked" }, { use: "witness", kid: "w", status: "active" },
];
t("jwks: verifiers get active and retired card keys, never a revoked one", JSON.stringify(cardJwksKeys(synth).map((k) => k.kid)) === JSON.stringify(["a", "b"]));
const pubs = KEY_HISTORY.map((k) => k.public_key_ed25519_b64 || k.public_jwk.x);
t("history: no public key is used for two purposes", new Set(pubs).size === pubs.length);
t("history: every entry names the commit that first published it and a since date", KEY_HISTORY.every((k) => /^[0-9a-f]{8}$/.test(k.since_commit) && /^\d{4}-\d{2}-\d{2}$/.test(k.since)));

// the rule
const H = [
  { use: "agent-card", kid: "act", public_jwk: { x: "X1" }, since: "2026-09-01", status: "active" },
  { use: "agent-card", kid: "ret", public_jwk: { x: "X2" }, since: "2026-03-01", status: "retired", retired_at: "2026-09-01T00:00:00Z" },
  { use: "witness", kid: "rev", public_key_ed25519_b64: "REV=", since: "2026-06-01", status: "revoked", revoked_at: "2026-09-20T00:00:00Z", compromised_from: "2026-09-15T00:00:00Z" },
];
const A = (ref, when) => attributable(ref, when, H).attributable;
t("rule: active key, no time proof: attributable", A({ kid: "act" }, null) === true);
t("rule: retired key, no time proof: still attributable (normal rotation)", A({ kid: "ret" }, null) === true);
t("rule: retired key, bytes proven only after retirement: not attributable", A({ kid: "ret" }, "2026-09-10T00:00:00Z") === false);
t("rule: revoked key, no time proof: NOT attributable", A({ public_key_ed25519_b64: "REV=" }, null) === false);
t("rule: revoked key, bytes proven before compromised_from: attributable", A({ public_key_ed25519_b64: "REV=" }, "2026-09-14T23:59:59Z") === true);
t("rule: revoked key, bytes proven at compromised_from or later: NOT attributable", A({ public_key_ed25519_b64: "REV=" }, "2026-09-15T00:00:00Z") === false && A({ public_key_ed25519_b64: "REV=" }, "2026-09-18T00:00:00Z") === false);
t("rule: bytes proven before the key existed: not attributable (backdating)", A({ kid: "act" }, "2026-08-01T00:00:00Z") === false);
t("rule: a key not in the history: null (this history cannot say), never true", A({ kid: "stranger" }, null) === null);
t("rule: an unparsable time is refused, not read as no proof", A({ public_key_ed25519_b64: "REV=" }, "yesterday") === false);
t("rule: kid plus a different x is not the listed key", findKey({ kid: "act", jwk_x: "OTHER" }, H) === null);
t("rule: the served rule states the revoked-key condition", doc.rule.some((x) => x.startsWith("revoked:") && x.includes("before compromised_from")));

// anchors (2026-10-03): the list fixed outside this server, and never claimed for a list it did not fix
t("anchors: served, and kept out of history_sha256 (the hash still recomputes from schema, subject, keys, rule only)", doc.anchors && doc.anchors.not_covered_by_history_sha256 === true && doc.history_sha256 === recomputed);
t("anchors: every current anchor carries exactly the served history_sha256", doc.anchors.current.every((a) => a.history_sha256 === doc.history_sha256) && doc.anchors.covers_served_list === (doc.anchors.current.length > 0));
t("anchors: every listed anchor is well formed (64-hex hash, ledger entry, Bitcoin block, OTS proof URL, seed in the repository)", KEY_HISTORY_ANCHORS.length > 0 && KEY_HISTORY_ANCHORS.every((a) => /^[0-9a-f]{64}$/.test(a.history_sha256) && Number.isInteger(a.jidec_entry) && Number.isInteger(a.bitcoin_block) && /^https:\/\//.test(a.ots_url) && /^https:\/\/github\.com\//.test(a.seed_in_repository)));
const rotated = anchorsFor("0".repeat(64));
t("anchors: a rotated list with no anchor of its own is reported as not anchored, and the old anchor moves to previous", rotated.covers_served_list === false && rotated.current.length === 0 && rotated.previous.length === KEY_HISTORY_ANCHORS.length);
t("anchors: says what the anchor does not establish (theft)", typeof doc.anchors.does_not_establish === "string" && doc.anchors.does_not_establish.includes("stolen"));
console.log("  info  served history " + doc.history_sha256.slice(0, 12) + (doc.anchors.covers_served_list ? " is anchored (JIDEC entry " + doc.anchors.current.map((a) => a.jidec_entry).join(",") + ")" : " is NOT yet anchored"));

console.log("\n=== " + pass + " / " + (pass + fail) + " 合格 (key history、扉 0.4.18) ===");
process.exit(fail ? 1 : 0);
