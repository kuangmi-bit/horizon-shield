// node test/nenrin_tools.test.mjs : the 1.3.0 NENRIN read tools against a mock ledger (no network).
import worker from "../src/worker.js";
let n = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } n++; };
const seen = [];
const routes = {
  "/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp": [200, { schema: "nenrin-resume-v1", counts: { measurements: 3 }, resume_sha256: "a".repeat(64) }],
  "/trust-signal?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp": [200, { schema: "nenrin-trust-signal-v1", counts: { anchored: 3 } }],
  ["/witness/" + "b".repeat(64)]: [200, { status: "anchored", entry: 58 }],
  "/ledger/head": [200, { n: 64, head: "c".repeat(64) }],
  "/ledger/64": [200, { n: 64, claim_sha256: "f6400d87" }],
  "/ledger/999": [404, { error: "not_found" }],
  "/ledger/65": [503, "upstream"],
};
const env = { LEDGER_SVC: { fetch: async (req) => {
  const u = new URL(req.url); const k = u.pathname + u.search; seen.push(k);
  const [st, body] = routes[k] || [404, { error: "not_found" }];
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: st });
} } };
async function rpc(method, params) {
  const r = await worker.fetch(new Request("https://jidec.horizonshield.dev/mcp", { method: "POST", headers: { "content-type": "application/json", origin: "https://claude.ai" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
  return (await r.json()).result;
}
const call = (name, args) => rpc("tools/call", { name, arguments: args || {} });

const init = await rpc("initialize", {});
ok(init.serverInfo.version === "1.3.0" && init.instructions.includes("nenrin_resume"), "initialize 1.3.0 names nenrin_resume");
const list = (await rpc("tools/list", {})).tools;
const names = list.map((t) => t.name);
for (const t of ["jidec_cite", "jidec_replay", "jidec_list_paths", "jidec_how_to_verify", "nenrin_resume", "nenrin_trust_signal", "nenrin_witness", "nenrin_ledger_head", "nenrin_ledger_entry"]) ok(names.includes(t), "tool listed: " + t);
ok(list.every((t) => t.annotations.readOnlyHint === true && t.outputSchema && t.inputSchema), "every tool read-only with schemas");

let r = await call("nenrin_resume", { endpoint: "https://mcp.horizonshield.dev/mcp" });
ok(!r.isError && r.structuredContent.lookup === "ok" && r.structuredContent.counts.measurements === 3, "resume ok");
ok(r.structuredContent.source_url === "https://ledger.horizonshield.dev/resume?endpoint=https%3A%2F%2Fmcp.horizonshield.dev%2Fmcp", "resume source_url");
ok(r.structuredContent.does_not_establish.length === 4, "resume carries does_not_establish");
r = await call("nenrin_trust_signal", { endpoint: "https://mcp.horizonshield.dev/mcp" });
ok(r.structuredContent.counts.anchored === 3, "trust signal ok");
r = await call("nenrin_resume", { endpoint: "http://insecure.example/mcp" });
ok(r.isError && /https/.test(r.content[0].text), "http endpoint refused");
r = await call("nenrin_witness", { sha256: "B".repeat(64) });
ok(r.structuredContent.lookup === "ok" && r.structuredContent.entry === 58, "witness by sha, case folded");
r = await call("nenrin_witness", { sha256: "xyz" });
ok(r.isError, "bad sha refused");
r = await call("nenrin_ledger_head", {});
ok(r.structuredContent.n === 64, "head");
r = await call("nenrin_ledger_entry", { n: 64 });
ok(r.structuredContent.claim_sha256 === "f6400d87", "entry 64");
r = await call("nenrin_ledger_entry", { n: 999 });
ok(!r.isError && r.structuredContent.lookup === "absent", "404 is absent, not an error");
r = await call("nenrin_ledger_entry", { n: 65 });
ok(r.isError && /NOT a statement/.test(r.content[0].text), "503 is an error, never absent");
r = await call("nenrin_ledger_entry", { n: 0 });
ok(r.isError, "n=0 refused");
const card = await (await worker.fetch(new Request("https://jidec.horizonshield.dev/.well-known/agent-card.json"), env)).json();
ok(card.version === "1.2.1", "signed card version unchanged (1.2.1)");
console.log("ALL PASS (hs-jidec-mcp 1.3.0 NENRIN tools: " + n + " checks)");
