#!/usr/bin/env node
// Offline tests for probe.mjs: a fake MCP server on 127.0.0.1, no network.
//   node tools/status/probe_test.mjs
import http from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  parseSse, probeMcp, probeHttp, percentile, prune, mergeRows, summarize, canonical, withSelfHash, checkSelfHash,
  renderMarkdown, commitDue
} from "./probe.mjs";

let failed = 0, passed = 0;
function chk(name, cond, detail) {
  if (cond) { passed++; console.log("ok   " + name); }
  else { failed++; console.log("FAIL " + name + (detail !== undefined ? "  :: " + JSON.stringify(detail).slice(0, 300) : "")); }
}

// ---- a fake MCP server ----------------------------------------------------------------------------------------
const TOOLS = [{ name: "safe_read", annotations: { readOnlyHint: true } }, { name: "other" }];
const seen = [];
function answer(path, msg, headers) {
  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-" + path.slice(1), version: "9.9.9" } } };
  }
  if (msg.method === "tools/list") return { jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } };
  if (msg.method === "tools/call") {
    if (path === "/iserror") return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "nope" }], isError: true } };
    if (path === "/rpcerror") return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "bad params" } };
    return { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "fine" }], structuredContent: { echo: msg.params.arguments } } };
  }
  return null;
}
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const path = req.url;
    seen.push({ path, method: req.method, headers: req.headers, body });
    if (path === "/health") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true,"service":"fake"}'); }
    if (path === "/health-bad") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":false}'); }
    if (path === "/500") { res.writeHead(500, { "content-type": "text/plain" }); return res.end("boom"); }
    if (path === "/slow") return; // never answers; the probe must time out
    if (req.method === "DELETE") { res.writeHead(path === "/session" ? 204 : 405); return res.end(); }
    const msg = JSON.parse(body);
    if (!("id" in msg)) { res.writeHead(202); return res.end(); }
    if (path === "/session") {
      // A stateful server: issues a session id and refuses later requests without it.
      if (msg.method !== "initialize" && req.headers["mcp-session-id"] !== "sess-123") {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "missing session" } }));
      }
    }
    const out = answer(path, msg);
    const h = {};
    if (path === "/session" && msg.method === "initialize") h["mcp-session-id"] = "sess-123";
    if (path === "/sse") {
      res.writeHead(200, { "content-type": "text/event-stream", ...h });
      res.write(": keepalive comment\n\n");
      res.write("event: message\r\ndata: " + JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} }) + "\r\n\r\n");
      res.write("event: message\ndata: " + JSON.stringify(out) + "\n\n");
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json", ...h });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const ep = (path, extra = {}) => ({ id: path.slice(1), kind: "mcp", url: base + path, call: { name: "safe_read", arguments: { q: "x" } }, ...extra });

// ---- SSE parsing --------------------------------------------------------------------------------------------
{
  const msgs = parseSse(": c\n\nevent: message\ndata: {\"a\":1}\n\ndata: not json\n\ndata: {\"b\":\ndata: 2}\n\n");
  chk("parseSse: JSON events, multi line data joined, comments and non JSON skipped", msgs.length === 2 && msgs[0].a === 1 && msgs[1].b === 2, msgs);
}

// ---- JSON answers ---------------------------------------------------------------------------------------------
{
  const s = await probeMcp(ep("/json"), { timeoutMs: 2000 });
  chk("json: initialize ok with serverInfo and protocol", s.initialize.ok && s.initialize.server_name === "fake-json" && s.initialize.server_version === "9.9.9" && s.initialize.protocol_version === "2025-06-18", s.initialize);
  chk("json: tools/list ok, count 2, configured tool listed", s.tools_list.ok && s.tools_list.tool_count === 2 && s.tools_list.tool_listed === true, s.tools_list);
  chk("json: tools/call ok, isError false, ms recorded", s.tools_call.ok && s.tools_call.is_error === false && s.tools_call.status === 200 && typeof s.tools_call.ms === "number", s.tools_call);
  const posts = seen.filter((x) => x.path === "/json" && x.method === "POST");
  chk("json: accept header asks for JSON or SSE", posts[0].headers.accept === "application/json, text/event-stream", posts[0].headers.accept);
  chk("json: initialized notification sent, protocol header on later requests", posts.some((p) => p.body.includes("notifications/initialized")) && posts[2].headers["mcp-protocol-version"] === "2025-06-18");
  chk("json: no session id means no DELETE", !seen.some((x) => x.path === "/json" && x.method === "DELETE"));
}

// ---- SSE answers --------------------------------------------------------------------------------------------
{
  const s = await probeMcp(ep("/sse"), { timeoutMs: 2000 });
  chk("sse: all three steps ok through SSE framing (picks the message with the request id)", s.initialize.ok && s.initialize.sse && s.tools_list.ok && s.tools_list.tool_count === 2 && s.tools_call.ok, s);
}

// ---- session id -----------------------------------------------------------------------------------------------
{
  const s = await probeMcp(ep("/session"), { timeoutMs: 2000 });
  chk("session: id kept and sent back, list and call ok", s.initialize.session === true && s.tools_list.ok && s.tools_call.ok, s);
  chk("session: DELETE sent with the session id", seen.some((x) => x.path === "/session" && x.method === "DELETE" && x.headers["mcp-session-id"] === "sess-123"));
}

// ---- isError, JSON-RPC error, 500, timeout ---------------------------------------------------------------------
{
  const s = await probeMcp(ep("/iserror"), { timeoutMs: 2000 });
  chk("isError: reach ok, call not ok, is_error true", s.initialize.ok && !s.tools_call.ok && s.tools_call.is_error === true && /isError/.test(s.tools_call.error), s.tools_call);
  const r = await probeMcp(ep("/rpcerror"), { timeoutMs: 2000 });
  chk("rpc error: call not ok, code recorded", !r.tools_call.ok && r.tools_call.rpc_error.code === -32602, r.tools_call);
  const f = await probeMcp(ep("/500"), { timeoutMs: 2000 });
  chk("500: initialize not ok with status 500, later steps skipped", !f.initialize.ok && f.initialize.status === 500 && /HTTP 500/.test(f.initialize.error) && f.tools_list.skipped && f.tools_call.skipped, f);
  const t0 = Date.now();
  const t = await probeMcp(ep("/slow"), { timeoutMs: 300 });
  chk("timeout: initialize gives up after the timeout and says so", !t.initialize.ok && t.initialize.timeout === true && /timeout after 300 ms/.test(t.initialize.error) && Date.now() - t0 < 2000, t.initialize);
  const c = await probeMcp({ ...ep("/json"), url: "http://127.0.0.1:1/mcp" }, { timeoutMs: 1000 });
  chk("connection refused: not ok, no status, error text", !c.initialize.ok && c.initialize.status === null && !!c.initialize.error, c.initialize);
}

// ---- plain HTTP -----------------------------------------------------------------------------------------------
{
  const h = await probeHttp({ id: "h", kind: "http", url: base + "/health", expect: { field: "ok", equals: true } }, { timeoutMs: 2000 });
  chk("http: GET ok when the field matches", h.get.ok && h.get.status === 200, h);
  const b = await probeHttp({ id: "h", kind: "http", url: base + "/health-bad", expect: { field: "ok", equals: true } }, { timeoutMs: 2000 });
  chk("http: 200 with the wrong body is not ok", !b.get.ok && /did not match/.test(b.get.error), b);
}
// ---- the command line, end to end, against the fake server ----------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "status-probe-"));
  const cfg = { endpoints: [ep("/json"), { id: "health", kind: "http", url: base + "/health", expect: { field: "ok", equals: true } }, ep("/500")] };
  writeFileSync(join(dir, "endpoints.json"), JSON.stringify(cfg));
  const old = { at: "2026-08-01T00:23:00.000Z", results: [] };
  const recent = { at: "2026-10-09T11:23:00.000Z", results: [] };
  writeFileSync(join(dir, "prev.jsonl"), JSON.stringify(old) + "\n" + JSON.stringify(recent) + "\nnot json\n");
  writeFileSync(join(dir, "committed.json"), JSON.stringify({ generated_at: "2026-10-09T09:00:00.000Z" }));
  const out = join(dir, "out");
  const r = await promisify(execFile)(process.execPath, [new URL("./probe.mjs", import.meta.url).pathname, "--config", join(dir, "endpoints.json"),
    "--history", join(dir, "prev.jsonl"), "--history", join(dir, "missing.jsonl"), "--out", out, "--now", "2026-10-09T12:23:00Z",
    "--committed", join(dir, "committed.json")], { env: { ...process.env, GITHUB_OUTPUT: "" } });
  const rows = readFileSync(join(out, "history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  chk("cli: old row pruned, broken line dropped, this run appended", rows.length === 2 && rows[0].at === recent.at && rows[1].results.length === 3, rows.map((x) => x.at));
  const st = JSON.parse(readFileSync(join(out, "status.json"), "utf8"));
  chk("cli: status.json carries a valid self hash", checkSelfHash(st) && st.endpoints.length === 3);
  chk("cli: a failing endpoint is data, the exit code is 0", st.endpoints[2].last.ok === false && existsSync(join(out, "STATUS.md")));
  chk("cli: committed status 3 h 23 min old is not due at 5.5 h", /commit_due=false/.test(r.stdout));
}
server.close();

// ---- percentile math ------------------------------------------------------------------------------------------
{
  const v = Array.from({ length: 100 }, (_, i) => 100 - i);   // 100..1, unsorted on purpose
  chk("percentile: 1..100 gives P50 50, P95 95, P100 100", percentile(v, 50) === 50 && percentile(v, 95) === 95 && percentile(v, 100) === 100);
  chk("percentile: one value is every percentile", percentile([7], 50) === 7 && percentile([7], 95) === 7);
  chk("percentile: empty and non numbers give null", percentile([], 50) === null && percentile([null, undefined], 95) === null);
  chk("percentile: 10 values, P95 is the largest (nearest rank)", percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10 && percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5);
}

// ---- 30 day pruning and merge ---------------------------------------------------------------------------------
const NOW = Date.parse("2026-10-09T12:23:00Z");
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
{
  const rows = [{ at: iso(24 * 31) }, { at: iso(24 * 30 + 1) }, { at: iso(24 * 30) }, { at: iso(1) }, { bad: true }];
  const kept = prune(rows, NOW);
  chk("prune: drops rows older than 30 days and rows without a time, keeps the boundary", kept.length === 2 && kept[0].at === iso(24 * 30), kept);
  const m = mergeRows([{ at: iso(2), n: 1 }, { at: iso(1), n: 2 }], [{ at: iso(2), n: 1 }, { at: iso(3), n: 3 }]);
  chk("merge: duplicate runs counted once, oldest first", m.length === 3 && m[0].n === 3 && m[2].n === 2, m);
}

// ---- summary numbers ------------------------------------------------------------------------------------------
{
  const config = { endpoints: [{ id: "a", kind: "mcp", url: "u", call: { name: "safe_read" } }, { id: "h", kind: "http", url: "v" }] };
  const okA = (ms) => ({ id: "a", kind: "mcp", steps: { initialize: { ok: true, status: 200, ms: 50, server_name: "s", server_version: "1.2.3", protocol_version: "2025-06-18" }, tools_list: { ok: true, status: 200, tool_count: 15 }, tools_call: { ok: true, status: 200, ms, is_error: false } } });
  const downA = { id: "a", kind: "mcp", steps: { initialize: { ok: false, status: null, ms: 20000, timeout: true, error: "timeout after 20000 ms" }, tools_list: { skipped: true }, tools_call: { skipped: true } } };
  const errA = { id: "a", kind: "mcp", steps: { initialize: { ok: true, status: 200, ms: 40, server_version: "1.2.3" }, tools_list: { ok: true, status: 200, tool_count: 15 }, tools_call: { ok: false, status: 200, ms: 900, is_error: true, error: "tool result isError true" } } };
  const h = (ok) => ({ id: "h", kind: "http", steps: { get: { ok, status: ok ? 200 : 503, ms: 100 } } });
  const rows = [
    { at: iso(24 * 8), results: [okA(99999), h(true)] },     // older than 7 days: outside every window used
    { at: iso(30), results: [okA(100), h(true)] },
    { at: iso(5), results: [downA, h(false)] },
    { at: iso(3), results: [errA, h(true)] },
    { at: iso(1), results: [okA(300), h(true)] }
  ];
  const s = summarize(rows, config, NOW);
  const a = s.endpoints[0], hh = s.endpoints[1];
  chk("summary: reach 24 h counts initialize ok (2 of 3)", a.reach_24h.ok === 2 && a.reach_24h.of === 3 && a.reach_24h_pct === 66.7, a.reach_24h);
  chk("summary: reach 7 d (3 of 4)", a.reach_7d.ok === 3 && a.reach_7d.of === 4 && a.reach_7d_pct === 75, a.reach_7d);
  chk("summary: call success counts unreached runs as failed (2 of 4)", a.call_success_7d.ok === 2 && a.call_success_7d.of === 4, a.call_success_7d);
  chk("summary: skipped call has no latency, isError call does; P50 300 P95 900", a.call_p50_ms_7d === 300 && a.call_p95_ms_7d === 900, [a.call_p50_ms_7d, a.call_p95_ms_7d]);
  chk("summary: version and tool count from the last good handshake", a.server_version === "1.2.3" && a.tool_count === 15);
  chk("summary: last run ok", a.last.ok === true && a.last.at === iso(1));
  chk("summary: http endpoint reach 7 d 3 of 4", hh.reach_7d.ok === 3 && hh.reach_7d.of === 4 && hh.tool_count === null, hh);

  // ---- self hash ------------------------------------------------------------------------------------------------
  const st = withSelfHash(s);
  const body = { ...st }; delete body.status_sha256;
  chk("self hash: sha256 of the canonical form without the hash field", st.status_sha256 === createHash("sha256").update(canonical(body)).digest("hex"));
  chk("self hash: survives a JSON round trip (pretty printed file)", checkSelfHash(JSON.parse(JSON.stringify(st, null, 2))));
  chk("self hash: a changed number is caught", !checkSelfHash({ ...st, rows_in_history: st.rows_in_history + 1 }));
  chk("canonical: keys sorted at every depth, compact, non ASCII kept", canonical({ b: 1, a: { d: [1, { z: 0, y: "生" }], c: null } }) === '{"a":{"c":null,"d":[1,{"y":"生","z":0}]},"b":1}');

  // ---- STATUS.md --------------------------------------------------------------------------------------------------
  const md = renderMarkdown(st);
  chk("markdown: one table row per endpoint plus the limits section", md.includes("| [a](u)") && md.includes("| [h](v)") && md.includes("What it does not establish"));
  chk("markdown: no dash characters", !/[\u2012-\u2015\u2212\uFF0D]/.test(md));
}

// ---- commit cadence -------------------------------------------------------------------------------------------
{
  chk("commit due: missing committed file means due", commitDue("/nonexistent/status.json", NOW, 5.5) === true);
  const d = mkdtempSync(join(tmpdir(), "status-due-"));
  writeFileSync(join(d, "s.json"), JSON.stringify({ generated_at: iso(6) }));
  writeFileSync(join(d, "t.json"), JSON.stringify({ generated_at: iso(5) }));
  chk("commit due: 6 h old is due, 5 h old is not", commitDue(join(d, "s.json"), NOW, 5.5) === true && commitDue(join(d, "t.json"), NOW, 5.5) === false);
}

// ---- the real config only names read only tools that are not known writers --------------------------------------
{
  const cfg = JSON.parse(readFileSync(new URL("./endpoints.json", import.meta.url), "utf8"));
  const writers = new Set(["verify_fair_price", "create_ap2_fairness_attestation", "check_conformance", "find_contractor", "get_contractor_profile"]);
  chk("config: every MCP endpoint has a call, none is a known writer", cfg.endpoints.filter((e) => e.kind === "mcp").every((e) => e.call && !writers.has(e.call.name)));
  chk("config: ids unique, https only", new Set(cfg.endpoints.map((e) => e.id)).size === cfg.endpoints.length && cfg.endpoints.every((e) => e.url.startsWith("https://")));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
