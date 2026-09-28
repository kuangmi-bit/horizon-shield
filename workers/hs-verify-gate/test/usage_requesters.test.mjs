// usage_requesters.test.mjs (0.4.20, 2026-09-29): who asked, on /usage.
//
// Why. external_checks counts checks aimed at endpoints outside our zone, whoever asked. When we measure an
// outside server ourselves it lands there as if someone else had used the gate. MCP tools/call had only a
// network count, no per-tool count. This suite pins the new axis: face|tool|requester class|target class.
// What it proves: each face counts under the right class and target; an operator declaration and a request
// without cf-connecting-ip never reach the outside headline; unknown tool names collapse to one bucket; no IP
// and no User-Agent string lands in KV; the existing counters (external_checks, own_checks, networks) move
// exactly as before; a counting failure never changes the answer of the face.
// Offline. fetch is stubbed to fail so /check and the MCP tools answer without the network.
// Run: node test/usage_requesters.test.mjs   (in workers/hs-verify-gate)
import worker from "../src/worker.js";

let fails = 0, n = 0;
const t = (ok, msg, extra) => { n++; console.log((ok ? "ok   " : "FAIL ") + n + ". " + msg + (ok ? "" : ("   " + (extra || "")))); if (!ok) fails++; };
function kv() {
  const store = new Map();
  return {
    store,
    get: async (k, type) => { const v = store.has(k) ? store.get(k) : null; return (type === "json" && v !== null) ? JSON.parse(v) : v; },
    put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
    delete: async (k) => { store.delete(k); },
    list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
  };
}
function ctx() { const ps = []; return { waitUntil(p) { ps.push(Promise.resolve(p).catch(() => {})); }, drain: () => Promise.all(ps) }; }
globalThis.fetch = async () => { throw new Error("offline test: no network"); };

const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
const ORIGIN = "https://gate.horizonshield.dev";
const today = new Date().toISOString().slice(0, 10);
const EXT = "https://open.redteam.invalid/mcp";
const OWN = "https://mcp.horizonshield.dev/mcp";
async function hit(path, body, headers) {
  const c = ctx();
  const r = await worker.fetch(new Request(ORIGIN + path, { method: body ? "POST" : "GET", headers: Object.assign({ "content-type": "application/json" }, headers || {}), body: body ? JSON.stringify(body) : undefined }), env, c);
  await c.drain();
  return r;
}
const H = (ua, extra) => Object.assign({ "cf-connecting-ip": "203.0.113.7", "user-agent": ua }, extra || {});
const counts = async () => ((await env.HS_VERIFY_KV.get("usage:req:" + today, "json")) || { counts: {} }).counts;
const usage = async () => (await hit("/usage")).json();

// ---- /check -----------------------------------------------------------------------------------------
let r = await hit("/check", { endpoint: EXT }, H("curl/8.4.0"));
t(r.status === 200 || r.status === 500, "/check still answers with the network stubbed away", String(r.status));
let c = await counts();
t(c["check|-|other|external"] === 1, "an undeclared curl client measuring an outside endpoint: check|-|other|external = 1", JSON.stringify(c));
await hit("/check", { endpoint: EXT }, H("curl/8.4.0", { "x-hs-requester": "operator" }));
c = await counts();
t(c["check|-|operator_declared|external"] === 1, "the same request declared as ours lands in operator_declared", JSON.stringify(c));
await hit("/check", { endpoint: OWN }, H("Mozilla/5.0"));
c = await counts();
t(c["check|-|other|own"] === 1, "an outside client measuring our endpoint: target own", JSON.stringify(c));
await hit("/check", { endpoint: EXT }, { "user-agent": "curl/8.4.0" });
c = await counts();
t(c["check|-|no_client_ip|external"] === 1, "no cf-connecting-ip (binding or local test) is no_client_ip, not outside", JSON.stringify(c));

// ---- MCP tools/call ------------------------------------------------------------------------------------
const call = (name, args, headers) => hit("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, headers);
await call("check_conformance", { endpoint: EXT }, H("Claude-User/1.0 (+https://www.anthropic.com)"));
await call("check_conformance", { url: EXT }, H("openai-mcp/1.0"));
await call("is_verified", { endpoint: OWN }, H("python-httpx/0.27"));
await call("get_conditions", {}, H("python-httpx/0.27"));
await call("preflight_agent", { agent: "https://agent.redteam.invalid" }, H("python-httpx/0.27"));
await call("definitely_not_a_tool", { endpoint: EXT }, H("python-httpx/0.27"));
await call("check_conformance", { endpoint: "not a url" }, H("python-httpx/0.27"));
c = await counts();
t(c["mcp|check_conformance|ua_claude|external"] === 1, "a Claude-named client calling check_conformance on an outside endpoint", JSON.stringify(c));
t(c["mcp|check_conformance|ua_openai|external"] === 1, "an OpenAI-named client, with the endpoint passed as url (alias), counts the same way", JSON.stringify(c));
t(c["mcp|is_verified|other|own"] === 1 && c["mcp|get_conditions|other|none"] === 1, "lookups are counted per tool with their target (own / none)", JSON.stringify(c));
t(c["mcp|preflight_agent|other|external"] === 1, "preflight_agent reads its agent argument as the target", JSON.stringify(c));
t(c["mcp|unknown_tool|other|external"] === 1 && !Object.keys(c).some((k) => k.includes("definitely_not")), "an unknown tool name collapses to unknown_tool; a caller cannot write keys of its choosing", JSON.stringify(c));
t(c["mcp|check_conformance|other|none"] === 1, "an argument that is not an https URL is target none", JSON.stringify(c));
const listRes = await hit("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list" }, H("x"));
t(listRes.status === 200 && Object.keys(await counts()).length === Object.keys(c).length, "tools/list is not a call and is not counted");

// ---- A2A --------------------------------------------------------------------------------------------------
await hit("/a2a", { jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: EXT }] } } }, H("a2a-client"));
c = await counts();
t(c["a2a|-|other|none"] === 1, "POST /a2a counts under a2a with target none", JSON.stringify(c));

// ---- the report -------------------------------------------------------------------------------------------
const u = await usage();
const rq = u.requesters;
t(rq && rq.counting_since === "2026-09-28", "/usage carries requesters with its counting_since (the UTC day it was deployed)");
t(rq.headline.outside_measurements_of_external_endpoints === 4,
  "headline = undeclared, non-internal measurements of outside endpoints: /check 1 + check_conformance by Claude 1 + by OpenAI 1 + preflight_agent 1 (unknown_tool and lookups are not measurements)",
  JSON.stringify(rq.headline));
t(rq.headline.operator_or_internal_requests === 2, "the operator declaration and the no-client-ip request are set apart", JSON.stringify(rq.headline));
t(rq.headline.outside_measurements_of_our_endpoints === 1, "outside measurements of our own endpoints are their own line", JSON.stringify(rq.headline));
t(Array.isArray(rq.known_own_schedules) && rq.known_own_schedules.length >= 3, "our own scheduled callers are listed so a reader can subtract them");
t(/Unauthenticated on purpose/.test(rq.class_rules.operator_declared), "the report says the operator declaration is not authenticated, and why that is safe");

// ---- existing counters untouched --------------------------------------------------------------------------
t(u.totals.external_checks === 3 && u.totals.own_checks === 1, "external_checks / own_checks move exactly as in 0.4.19 (target based, three outside targets and one own)", JSON.stringify(u.totals));
t(u.distinct_requester_networks && u.distinct_requester_networks.counting_since === "2026-09-15", "the network counter is still there, unchanged");

// ---- privacy ----------------------------------------------------------------------------------------------
const dump = JSON.stringify([...env.HS_VERIFY_KV.store.entries()]);
t(!/203\.0\.113/.test(dump), "no IP address or prefix in KV");
t(!/curl\/8|Claude-User|openai-mcp|python-httpx|Mozilla/.test(dump), "no User-Agent string in KV, only the class names");

// ---- a counting failure does not change the answer ----------------------------------------------------------
const brokenEnv = { HS_VERIFY_KV: { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); }, list: async () => ({ keys: [] }), delete: async () => {} }, SWEEP_TOKEN: "t", GATE_COMMIT: "local" };
const c2 = ctx();
const rb = await worker.fetch(new Request(ORIGIN + "/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_conditions", arguments: {} } }) }), brokenEnv, c2);
await c2.drain();
t(rb.status === 200, "with KV failing, get_conditions still answers 200", String(rb.status));

console.log("\n=== " + (n - fails) + " / " + n + " 合格 (usage requesters、扉 0.4.20) ===");
process.exit(fails ? 1 : 0);
