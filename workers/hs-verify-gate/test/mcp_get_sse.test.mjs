// mcp_get_sse: GET /mcp must not invite a reconnect loop.
//
// 2026-10-10. Streamable HTTP clients open the server-to-client SSE stream with GET /mcp. MCP 2025-06-18 (transports)
// says the server MUST answer that GET with text/event-stream or with 405 Method Not Allowed. The gate answered 200 with
// a JSON description, which clients read as a stream that opened and ended, so they reopened it about once a second for
// as long as they stayed connected: about 19 million requests a day (wrangler tail sample: 127 of 128 requests were
// GET /mcp, from codex-mcp-client and claude-code), billed from 2026-10-04. With @modelcontextprotocol/sdk 1.32.1 against
// the old code a client sent 15 GETs in 15 s; against this code it sends one and stops on the 405.
import worker from "../src/worker.js";

const O = "https://gate.horizonshield.dev";
const CTX = { waitUntil() {} };
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail)); };
const get = (accept) => worker.fetch(new Request(O + "/mcp", { method: "GET", headers: accept === null ? {} : { accept } }), {}, CTX);

for (const [label, accept] of [["Accept: text/event-stream (what an MCP client sends)", "text/event-stream"],
                               ["Accept: application/json, text/event-stream", "application/json, text/event-stream"],
                               ["no Accept header", null], ["Accept: */*", "*/*"]]) {
  const r = await get(accept);
  t(label + ": 405", r.status === 405, r.status);
  t(label + ": Allow names POST and DELETE", r.headers.get("allow") === "POST, DELETE", r.headers.get("allow"));
  t(label + ": not an event stream, not cached", !(r.headers.get("content-type") || "").includes("event-stream") && r.headers.get("cache-control") === "no-store");
  t(label + ": CORS still open", r.headers.get("access-control-allow-origin") === "*");
}
const html = await get("text/html,application/xhtml+xml");
const hb = await html.json();
t("a browser (Accept: text/html) still gets the description with 200", html.status === 200 && hb.ok === true && Array.isArray(hb.tools) && hb.tools.length > 0, html.status);
const both = await get("text/html, text/event-stream");
t("text/html together with text/event-stream is treated as a stream request: 405", both.status === 405, both.status);
const body405 = await (await get("text/event-stream")).json();
t("the 405 body says why and how to call the server", body405.error === "method_not_allowed" && /POST/.test(body405.why) && Array.isArray(body405.tools));
const init = await worker.fetch(new Request(O + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) }), {}, CTX);
t("POST initialize is unchanged: 200 with a session id", init.status === 200 && !!init.headers.get("mcp-session-id"), init.status);

console.log("\n=== " + pass + " / " + (pass + fail) + " 合格 (mcp_get_sse: GET /mcp answers 405, 2026-10-10) ===");
process.exit(fail ? 1 : 0);
