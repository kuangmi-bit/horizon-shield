// response_v0.test.mjs : offline test of nenrin-response-v0 (the measured party's reply beside the measurement).
// In-memory KV, throwaway Ed25519 keys, mocked key server and gate. Run: node response_v0.test.mjs
import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";
import { handleResponse, responsesAbout, responsesForHost, related, RESPONSE_TEXT_MAX } from "./response_v0.mjs";
import { canonical } from "../task-delegation-bind-v0/task_ledger_v0.mjs";
import { buildBody } from "./response_sign.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
function kv() {
  const m = new Map();
  return { m, async put(k, v) { m.set(k, v); }, async get(k) { return m.has(k) ? m.get(k) : null; },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; } };
}
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey, pub: Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64") };
}
let fails = 0;
const ok = (n, c, d) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  " + (d || ""))); if (!c) fails++; };
const NOW = Date.parse("2026-09-28T08:00:00Z");
const ORIGIN = "https://ledger.test";

const K = keypair(), OTHER = keypair();
const KEY_URL = "https://api.agent.example/keys/agreement.json";
const WIT = "a".repeat(64), WIT_OTHER = "b".repeat(64), WIT_SUB = "c".repeat(64);
const GATE_BODY = JSON.stringify({ endpoint: "https://api.agent.example/mcp", status: "declined" });
const GATE_SHA = sha(GATE_BODY);

function env0() {
  const LEDGER = kv();
  LEDGER.m.set("wit:anchored:" + WIT, JSON.stringify({ n: 44, stored: { sha: WIT, endpoint: "https://api.agent.example/a2a", record_canonical: "{}" } }));
  LEDGER.m.set("wit:pending:" + WIT_OTHER, JSON.stringify({ sha: WIT_OTHER, endpoint: "https://someone-else.example/a2a" }));
  LEDGER.m.set("wit:pending:" + WIT_SUB, JSON.stringify({ sha: WIT_SUB, endpoint: "https://api.agent.example/a2a" }));
  return { LEDGER };
}
function deps(opts = {}) {
  return {
    now: () => NOW,
    fetchKey: async (u) => { if (opts.keyDown) return { ok: false, why: "down" }; if (u === KEY_URL || u === "https://agent.example/keys/a.json") return { ok: true, key: opts.servedKey || K.pub }; return { ok: false, why: "404" }; },
    fetchGateRecord: async (s) => { if (s === GATE_SHA) return { ok: true, status: 200, text: opts.gateTamper ? GATE_BODY + " " : GATE_BODY }; return { ok: false, status: 404, why: "not found" }; },
  };
}
function rec(over = {}) {
  return Object.assign({ schema: "nenrin-response-v0", subject_origin: "https://api.agent.example", about: [{ kind: "witness", sha256: WIT }],
    text: "The FAIL on 2026-09-20 was our deploy window; fixed in v2.1.", responded_at: "2026-09-28T07:30:00Z", key_url: KEY_URL, public_key_ed25519_b64: K.pub }, over);
}
function body(r, signer = K, text) {
  const t = text !== undefined ? text : canonical(r);
  return { record_canonical: t, signature_ed25519_b64: edSign(null, Buffer.from("nenrin-response-v0\n" + t, "utf8"), signer.priv).toString("base64") };
}
async function post(env, b, d = deps()) {
  const r = await handleResponse("/response", { method: "POST", json: async () => b }, null, env, d, ORIGIN);
  return { status: r.status, body: JSON.parse(await r.text()) };
}
async function get(env, path, qs = "") {
  const r = await handleResponse(path, { method: "GET" }, new URL(ORIGIN + path + qs), env, deps(), ORIGIN);
  return r === null ? null : { status: r.status, body: JSON.parse(await r.text()) };
}

console.log("nenrin-response-v0 : selftest");

{ const env = env0(); const b = body(rec()); const r = await post(env, b);
  ok("R1 the measured party answers its own measurement -> 201", r.status === 201 && r.body.ok && r.body.sha === sha(b.record_canonical), JSON.stringify(r.body));
  const ab = await responsesAbout(env, WIT, ORIGIN);
  ok("R1 shown beside the measurement", ab.length === 1 && ab[0].response_sha === r.body.sha && ab[0].subject_origin === "https://api.agent.example");
  ok("R1 listed for the subject's host", (await responsesForHost(env, "api.agent.example", ORIGIN)).length === 1);
  const g = await get(env, "/response/" + r.body.sha);
  ok("R1 served as the exact bytes, sha recomputes", g.status === 200 && g.body.record_canonical === b.record_canonical && sha(g.body.record_canonical) === r.body.sha);
  const q = await get(env, "/response", "?about=" + WIT); ok("R1 GET ?about lists it", q.body.responses.length === 1);
  const d = await post(env, b); ok("R2 the same bytes again -> dedup", d.status === 200 && d.body.dedup === true);
  ok("R2b stored text is the subject's own, unedited", JSON.parse(JSON.parse(env.LEDGER.m.get("resp:rec:" + r.body.sha)).record_canonical).text === rec().text); }

{ const env = env0();
  const spaced = JSON.stringify(rec(), null, 1);
  const r1 = await post(env, body(rec(), K, spaced)); ok("R3 non-canonical text -> 422 not_canonical", r1.status === 422 && r1.body.error === "not_canonical");
  const r2 = await post(env, body(rec({ score: 5 }))); ok("R4 unknown field -> 422 unknown_field", r2.status === 422 && r2.body.error === "unknown_field");
  for (const [label, s] of [["http", "http://api.agent.example"], ["path", "https://api.agent.example/a2a"], ["localhost", "https://localhost"], ["bare IP", "https://10.1.2.3"]]) {
    const r = await post(env, body(rec({ subject_origin: s }))); ok("R5 subject " + label + " -> 422 bad_subject", r.status === 422 && r.body.error === "bad_subject", JSON.stringify(r.body));
  }
  const r6 = await post(env, body(rec({ key_url: "https://keys.other.example/k.json" }))); ok("R6 key on a host unrelated to the subject -> 422 key_off_subject", r6.status === 422 && r6.body.error === "key_off_subject");
  const r6b = await post(env, body(rec({ key_url: "https://evilapi.agent.example.attacker.example/k.json" }))); ok("R6b look-alike host -> key_off_subject", r6b.body.error === "key_off_subject");
  const r7 = await post(env, body(rec(), OTHER)); ok("R7 signed by a key that is not the pinned key -> 422 signature_invalid", r7.status === 422 && r7.body.error === "signature_invalid");
  const t = canonical(rec()); const noCtx = { record_canonical: t, signature_ed25519_b64: edSign(null, Buffer.from(t, "utf8"), K.priv).toString("base64") };
  const r8 = await post(env, noCtx); ok("R8 a signature without the context prefix -> signature_invalid", r8.body.error === "signature_invalid");
  const r9 = await post(env, body(rec({ about: [{ kind: "witness", sha256: "d".repeat(64) }] }))); ok("R9 an unknown measurement -> 422 about_not_found", r9.status === 422 && r9.body.error === "about_not_found");
  const r10 = await post(env, body(rec({ about: [{ kind: "witness", sha256: WIT_OTHER }] }))); ok("R10 a measurement of someone else -> 422 not_about_subject", r10.status === 422 && r10.body.error === "not_about_subject");
  const r10b = await post(env, body(rec({ about: [{ kind: "witness", sha256: WIT }, { kind: "witness", sha256: WIT_OTHER }] }))); ok("R10b one foreign measurement in the list refuses the whole response", r10b.body.error === "not_about_subject");
  ok("R10c nothing was stored by any refusal", [...env.LEDGER.m.keys()].every((k) => !k.startsWith("resp:"))); }

{ const env = env0();
  const r = await post(env, body(rec({ subject_origin: "https://agent.example", key_url: "https://agent.example/keys/a.json" })));
  ok("R11 the parent domain answers a measurement of its subdomain -> 201", r.status === 201, JSON.stringify(r.body));
  ok("R12 related() does not treat a look-alike as related", related("evilagent.example", "agent.example") === false && related("api.agent.example", "agent.example") === true); }

{ const env = env0();
  const r1 = await post(env, body(rec()), deps({ servedKey: OTHER.pub })); ok("R13 the subject's domain serves a different key -> 422 key_url_mismatch", r1.status === 422 && r1.body.error === "key_url_mismatch");
  const r2 = await post(env, body(rec()), deps({ keyDown: true })); ok("R13b key unreachable -> 503, not a verdict", r2.status === 503 && r2.body.error === "key_url_unreachable"); }

{ const env = env0();
  const r1 = await post(env, body(rec({ about: [{ kind: "gate", sha256: GATE_SHA }] }))); ok("R14 answers a gate verdict of itself -> 201", r1.status === 201, JSON.stringify(r1.body));
  const r2 = await post(env, body(rec({ about: [{ kind: "gate", sha256: GATE_SHA }], text: "second" })), deps({ gateTamper: true })); ok("R14b gate bytes that do not hash to the sha -> 502 gate_record_mismatch", r2.status === 502 && r2.body.error === "gate_record_mismatch");
  const r3 = await post(env, body(rec({ about: [{ kind: "gate", sha256: "e".repeat(64) }] }))); ok("R14c an unknown gate record -> 422 about_not_found", r3.status === 422 && r3.body.error === "about_not_found"); }

{ const env = env0();
  const long = "あ".repeat(RESPONSE_TEXT_MAX + 1);
  ok("R15 text over the limit -> bad_text", (await post(env, body(rec({ text: long })))).body.error === "bad_text");
  ok("R15b text at the limit in Japanese -> accepted", (await post(env, body(rec({ text: "あ".repeat(RESPONSE_TEXT_MAX) })))).status === 201);
  ok("R15c a control character -> bad_text", (await post(env, body(rec({ text: "a\u0007b" })))).body.error === "bad_text");
  ok("R15d a newline is fine", (await post(env, body(rec({ text: "line one\nline two" })))).status === 201);
  ok("R15e empty text -> bad_text", (await post(env, body(rec({ text: "" })))).body.error === "bad_text");
  ok("R16 responded_at an hour ahead -> bad_time", (await post(env, body(rec({ responded_at: "2026-09-28T09:00:00Z" })))).body.error === "bad_time");
  ok("R18 the same measurement named twice -> bad_about", (await post(env, body(rec({ about: [{ kind: "witness", sha256: WIT }, { kind: "witness", sha256: WIT }] })))).body.error === "bad_about");
  const many = Array.from({ length: 17 }, (_, i) => ({ kind: "witness", sha256: String(i % 10).repeat(64).slice(0, 63) + "f" }));
  ok("R19 seventeen measurements -> bad_about", (await post(env, body(rec({ about: many })))).body.error === "bad_about");
  ok("R19b an about entry with an extra key -> bad_about", (await post(env, body(rec({ about: [{ kind: "witness", sha256: WIT, verdict: "PASS" }] })))).body.error === "bad_about"); }

{ const env = env0(); let last = null;
  for (let i = 0; i < 11; i++) last = await post(env, body(rec({ text: "reply " + i })));
  ok("R17 the eleventh response from one subject in a day -> 429", last.status === 429 && last.body.error === "daily_per_subject_cap_reached"); }

{ const env = env0(); const d = await get(env, "/response");
  ok("R20 GET /response describes the rule, including who may respond and what it does not do", /only the party measured/.test(d.body.who_may_respond) && d.body.does_not.length === 3);
  ok("R20b other paths are not ours", (await handleResponse("/witness", { method: "GET" }, new URL(ORIGIN + "/witness"), env, deps(), ORIGIN)) === null); }

{ // the reference signer produces a body the ledger accepts (and its sorted JSON equals the ledger's canonical)
  const env = env0();
  const pem = K.priv.export({ type: "pkcs8", format: "pem" });
  const bb = buildBody({ keyPem: pem, subject: "https://api.agent.example", keyUrl: KEY_URL, about: [{ kind: "witness", sha256: WIT }], text: "signed with response_sign.mjs", respondedAt: "2026-09-28T07:59:00Z" });
  const r = await post(env, bb);
  ok("R21 response_sign.mjs output is accepted by the ledger", r.status === 201, JSON.stringify(r.body)); }

console.log(fails ? ("\n" + fails + " FAILED") : "\nALL PASS (nenrin-response-v0)");
process.exit(fails ? 1 : 0);
