// test/response.test.mjs
// nenrin-response-v0 wired into the real worker: POST /response through worker.fetch, the reply shown on
// GET /witness/<sha>, on /resume's envelope (outside resume_sha256) and on /trust-signal, and a gate verdict
// answered through the GATE service binding. Offline: fetch is replaced for the subject's key_url.
// Run: node test/response.test.mjs

import { generateKeyPairSync, sign as edSign, createHash } from "node:crypto";
import { loadWorker, mockKV, checker } from "./load.mjs";

const worker = await loadWorker("src/worker.js");
const chk = checker("hs-ledger response wiring");
const ORIGIN = "https://ledger.horizonshield.dev";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
const KEY_URL = "https://api.subject.example/keys/agreement.json";
globalThis.fetch = async (url) => {
  if (String(url) === KEY_URL) return new Response(JSON.stringify({ public_key_ed25519_b64: PUB }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("nope", { status: 404 });
};

const WIT = "a".repeat(64);
const GATE_BODY = JSON.stringify({ endpoint: "https://api.subject.example/mcp", status: "declined" });
const GATE_SHA = sha(GATE_BODY);
const kv = mockKV([
  ["wit:pending:" + WIT, JSON.stringify({ sha: WIT, endpoint: "https://api.subject.example/a2a", record_canonical: "{}", purpose: "a2a-conduct-walk-v1: https://api.subject.example/a2a" })],
]);
const GATE = { fetch: async (req) => (new URL(req.url).pathname === "/record/" + GATE_SHA ? new Response(GATE_BODY, { status: 200 }) : new Response("{}", { status: 404 })) };
const env = { LEDGER: kv.binding, GATE };

const canon = (o) => JSON.stringify(sortKeys(o));
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
function submit(about, text) {
  const rec = { schema: "nenrin-response-v0", subject_origin: "https://api.subject.example", about, text,
    responded_at: new Date(Date.now() - 60000).toISOString().replace(/\.\d{3}Z$/, "Z"), key_url: KEY_URL, public_key_ed25519_b64: PUB };
  const t = canon(rec);
  return { record_canonical: t, signature_ed25519_b64: edSign(null, Buffer.from("nenrin-response-v0\n" + t, "utf8"), privateKey).toString("base64") };
}
const post = async (b) => { const r = await worker.fetch(new Request(ORIGIN + "/response", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env); return { status: r.status, body: await r.json() }; };

const r1 = await post(submit([{ kind: "witness", sha256: WIT }], "That FAIL was our maintenance window."));
chk("POST /response through the worker -> 201", r1.status === 201 && r1.body.ok === true, JSON.stringify(r1.body));
const w = await (await worker.fetch(new Request(ORIGIN + "/witness/" + WIT), env)).json();
chk("GET /witness/<sha> carries the reply beside the record", Array.isArray(w.responses) && w.responses.length === 1 && w.responses[0].response_sha === r1.body.sha, JSON.stringify(w.responses));
const r2 = await post(submit([{ kind: "gate", sha256: GATE_SHA }], "The declined verdict predates our card fix."));
chk("a gate verdict is answered through the GATE binding -> 201", r2.status === 201, JSON.stringify(r2.body));
const q = await (await worker.fetch(new Request(ORIGIN + "/response?about=" + GATE_SHA), env)).json();
chk("GET /response?about=<gate sha> lists it", q.responses.length === 1 && q.responses[0].response_sha === r2.body.sha);
const res = await (await worker.fetch(new Request(ORIGIN + "/resume?endpoint=" + encodeURIComponent("https://api.subject.example/a2a")), env)).json();
chk("the résumé envelope lists both replies for the subject", Array.isArray(res.subject_responses) && res.subject_responses.length === 2, JSON.stringify(res.subject_responses || res));
chk("the résumé itself still assembles; the replies are an envelope field beside not_counted, not résumé content", typeof res.resume_sha256 === "string" && "not_counted" in res);
const ts = await (await worker.fetch(new Request(ORIGIN + "/trust-signal?endpoint=" + encodeURIComponent("https://api.subject.example/a2a")), env)).json();
chk("the trust signal says how many replies there are and where", ts.subject_responses && ts.subject_responses.count === 2 && /response\?subject=/.test(ts.subject_responses.url), JSON.stringify(ts.subject_responses));
const other = await (await worker.fetch(new Request(ORIGIN + "/resume?endpoint=" + encodeURIComponent("https://someone.example/a2a")), env)).json();
chk("another endpoint's résumé carries none of them", Array.isArray(other.subject_responses) && other.subject_responses.length === 0);
const desc = await (await worker.fetch(new Request(ORIGIN + "/response"), env)).json();
chk("GET /response describes the rule", desc.schema === "nenrin-response-v0");

process.exit(chk.done() ? 1 : 0);
