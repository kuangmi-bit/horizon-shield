/**
 * stdio.js : a stdio MCP adapter for registry crawlers (Glama and the like) that relays to the public remote endpoint.
 *
 * The server source is not in this repository (see README.md, "Source"). This file contains none of it: it reads one
 * JSON-RPC message per line from stdin, POSTs it to the public streamable HTTP endpoint, and writes each JSON-RPC
 * message of the reply as one line on stdout. Anyone can do the same with any MCP client; nothing here is privileged.
 *
 *   node workers/hs-mcp/stdio.js                         relays to https://mcp.horizonshield.dev/mcp
 *   HS_MCP_URL=https://... node workers/hs-mcp/stdio.js  relays elsewhere (a local dev worker, say)
 *
 * No dependencies (Node 18 or later, global fetch). Requests are relayed in the order received. The Mcp-Session-Id and
 * the negotiated MCP-Protocol-Version are carried forward when the server sets them. Notifications are relayed and
 * their empty 202 replies dropped. If the endpoint cannot be reached, a request gets a JSON-RPC error with its own id,
 * so the client is told rather than left waiting. stdout carries JSON-RPC only; diagnostics go to stderr.
 */
import { createInterface } from "node:readline";

const URL_ = process.env.HS_MCP_URL || "https://mcp.horizonshield.dev/mcp";
const TIMEOUT_MS = 30000;
const UA = "horizon-shield-stdio-relay/1.0 (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-mcp)";

const log = (...a) => process.stderr.write("[hs-mcp stdio] " + a.map(String).join(" ") + "\n");
console.log = console.info = console.warn = (...a) => log(...a);

let sessionId = null;
let protocolVersion = null;

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function messagesFrom(text, contentType) {
  const t = (text || "").trim();
  if (!t) return [];
  if ((contentType || "").includes("text/event-stream") || t.startsWith("event:") || t.startsWith("data:")) {
    const out = [];
    for (const block of t.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) out.push(JSON.parse(data));
    }
    return out;
  }
  const parsed = JSON.parse(t);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function relay(text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    emit({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const isRequest = msg && typeof msg === "object" && !Array.isArray(msg) && msg.id !== undefined && msg.id !== null && typeof msg.method === "string";
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": UA };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  try {
    const res = await fetch(URL_, { method: "POST", headers, body: text, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) sessionId = sid;
    const body = await res.text();
    let out = [];
    try {
      out = messagesFrom(body, res.headers.get("content-type"));
    } catch (_e) {
      out = [];
    }
    for (const m of out) {
      if (isRequest && msg.method === "initialize" && m && m.id === msg.id && m.result && typeof m.result.protocolVersion === "string") {
        protocolVersion = m.result.protocolVersion;
      }
      emit(m);
    }
    if (isRequest && !out.some((m) => m && m.id === msg.id)) {
      emit({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "remote endpoint answered HTTP " + res.status + " without a JSON-RPC reply" } });
    }
  } catch (e) {
    log("relay failed:", String((e && e.message) || e).slice(0, 200));
    if (isRequest) emit({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "remote endpoint unreachable: " + String((e && e.message) || e).slice(0, 160) } });
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
let queue = Promise.resolve();
rl.on("line", (line) => {
  const text = line.trim();
  if (text) queue = queue.then(() => relay(text));
});
rl.on("close", () => {
  queue.then(() => process.exit(0));
});
