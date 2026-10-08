#!/usr/bin/env node
// Outside liveness and speed probe for this project's public MCP and HTTP endpoints.
//
//   node tools/status/probe.mjs --out status-out --history ops/status/history.jsonl [--history prev/history.jsonl]
//        [--config tools/status/endpoints.json] [--committed ops/status/status.json] [--due-hours 5.5]
//
// For each MCP endpoint in endpoints.json: initialize, tools/list, and one read only tools/call. For each HTTP
// endpoint: one GET of a documented JSON path. Every step records ok, HTTP status and milliseconds. An endpoint
// that fails is data, written down, and the exit code stays 0. Only a crash of this tool exits non zero.
//
// Writes into --out: history.jsonl (every row of the last 30 days, merged from all --history files plus this run),
// status.json (summary with its own sha256) and STATUS.md (the table people read).
// When --committed is given, writes commit_due=true|false to $GITHUB_OUTPUT: true when the committed status.json is
// missing or older than --due-hours. The workflow uses it to commit at most every 6 hours.
//
// Zero dependencies. Node 22 or later (global fetch, AbortSignal.timeout).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROTOCOL_VERSION = "2025-06-18";
export const TIMEOUT_MS = 20000;
export const KEEP_DAYS = 30;
export const SCHEMA = "hs-status-v0";
const DAY = 86400000;
const UA = "horizon-shield-status-probe/0 (+https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/ops/status)";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---- the wire ------------------------------------------------------------------------------------------------

// Server Sent Events: one event per blank line separated block, its data lines joined. Non JSON events are skipped.
export function parseSse(text) {
  const out = [];
  for (const block of String(text).replace(/\r\n?/g, "\n").split("\n\n")) {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
    if (!data) continue;
    try { out.push(JSON.parse(data)); } catch { /* not JSON, ignored */ }
  }
  return out;
}

function errText(e, timeoutMs) {
  if (e && (e.name === "TimeoutError" || e.name === "AbortError")) return "timeout after " + timeoutMs + " ms";
  const code = e && e.cause && e.cause.code;
  return String(code || (e && e.message) || e).slice(0, 200);
}

// One request. Returns { step, msg, session }. step.ms runs until the whole body is read.
async function send(url, init, timeoutMs, wantId) {
  const t0 = performance.now();
  const step = { ok: false, status: null, ms: null };
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    step.status = res.status;
    const text = await res.text();
    step.ms = Math.round(performance.now() - t0);
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    let msg = null;
    if (res.status !== 200) step.error = "HTTP " + res.status;
    if (ctype.includes("text/event-stream")) {
      step.sse = true;
      const msgs = parseSse(text);
      msg = msgs.find((m) => m && m.id === wantId) || null;
    } else if (text) {
      try { msg = JSON.parse(text); } catch { step.error = step.error || "response is not JSON"; }
    }
    return { step, msg, session: res.headers.get("mcp-session-id") };
  } catch (e) {
    step.ms = Math.round(performance.now() - t0);
    step.error = errText(e, timeoutMs);
    if (step.error.startsWith("timeout")) step.timeout = true;
    return { step, msg: null, session: null };
  }
}

function rpcHeaders(extra) {
  // x-hs-requester: operator marks this as the operator's own traffic, so the gate does not count it as an outside lookup
  return { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": UA, "x-hs-requester": "operator", ...extra };
}

function noteRpc(step, msg) {
  if (msg && msg.error) step.rpc_error = { code: msg.error.code ?? null, message: String(msg.error.message ?? "").slice(0, 160) };
  if (!step.error && step.status !== 200) step.error = "HTTP " + step.status;
  if (!step.error && step.rpc_error) step.error = "JSON-RPC error " + step.rpc_error.code;
  if (!step.error && !msg) step.error = "no JSON-RPC response with the request id";
}

export async function probeMcp(ep, { timeoutMs = TIMEOUT_MS } = {}) {
  const steps = {};
  const rpc = (id, method, params, extra) =>
    send(ep.url, { method: "POST", headers: rpcHeaders(extra), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }, timeoutMs, id);

  const init = await rpc(1, "initialize", {
    protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "horizon-shield-status-probe", version: "0" }
  });
  const ir = init.msg && init.msg.result;
  const s = init.step;
  s.ok = s.status === 200 && !!ir && typeof ir.protocolVersion === "string";
  noteRpc(s, init.msg);
  if (ir) {
    s.protocol_version = ir.protocolVersion ?? null;
    s.server_name = (ir.serverInfo && ir.serverInfo.name) ?? null;
    s.server_version = (ir.serverInfo && ir.serverInfo.version) ?? null;
  }
  s.session = !!init.session;
  if (s.ok) delete s.error;
  steps.initialize = s;
  if (!s.ok) {
    steps.tools_list = { skipped: true };
    steps.tools_call = { skipped: true, tool: ep.call.name };
    return steps;
  }

  const h = { "mcp-protocol-version": ir.protocolVersion };
  if (init.session) h["mcp-session-id"] = init.session;
  // The initialized notification is part of the handshake. Its answer is not measured.
  await send(ep.url, { method: "POST", headers: rpcHeaders(h), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }, timeoutMs, null);

  const list = await rpc(2, "tools/list", {}, h);
  const lr = list.msg && list.msg.result;
  const ls = list.step;
  ls.ok = ls.status === 200 && !!lr && Array.isArray(lr.tools);
  noteRpc(ls, list.msg);
  if (ls.ok) {
    delete ls.error;
    ls.tool_count = lr.tools.length;
    ls.more_pages = !!lr.nextCursor;
    ls.tool_listed = lr.tools.some((t) => t && t.name === ep.call.name);
  }
  steps.tools_list = ls;

  const call = await rpc(3, "tools/call", { name: ep.call.name, arguments: ep.call.arguments || {} }, h);
  const cr = call.msg && call.msg.result;
  const cs = call.step;
  cs.tool = ep.call.name;
  cs.is_error = cr ? cr.isError === true : null;
  cs.ok = cs.status === 200 && !!cr && !cs.is_error;
  noteRpc(cs, call.msg);
  if (cs.is_error && !cs.error) cs.error = "tool result isError true";
  if (cs.ok) delete cs.error;
  steps.tools_call = cs;

  if (init.session) {
    // Close the session politely. Not measured; a 405 from a stateless server is fine.
    await send(ep.url, { method: "DELETE", headers: { "user-agent": UA, ...h } }, 5000, null);
  }
  return steps;
}

export async function probeHttp(ep, { timeoutMs = TIMEOUT_MS } = {}) {
  const r = await send(ep.url, { method: "GET", headers: { accept: "application/json", "user-agent": UA } }, timeoutMs, null);
  const s = r.step;
  const want = ep.expect;
  const okBody = r.msg && typeof r.msg === "object" && (!want || r.msg[want.field] === want.equals);
  s.ok = s.status === 200 && !!okBody;
  if (!s.ok && !s.error) s.error = s.status !== 200 ? "HTTP " + s.status : "body did not match " + (want ? want.field + " == " + JSON.stringify(want.equals) : "JSON");
  return { get: s };
}

export async function probeAll(config, opts = {}) {
  const results = [];
  for (const ep of config.endpoints) {   // one at a time, so one slow endpoint does not slow the others' numbers
    const steps = ep.kind === "http" ? await probeHttp(ep, opts) : await probeMcp(ep, opts);
    results.push({ id: ep.id, kind: ep.kind, url: ep.url, steps });
  }
  return results;
}

// ---- rows, windows, numbers ------------------------------------------------------------------------------------

// The first step answers "did it answer at all"; the last step answers "did the real work succeed".
export function reachStep(res) { return res.kind === "http" ? res.steps.get : res.steps.initialize; }
export function callStep(res) { return res.kind === "http" ? res.steps.get : res.steps.tools_call; }

// Nearest rank percentile: the smallest value with at least p percent of values at or below it.
export function percentile(values, p) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[i];
}

export function prune(rows, nowMs, days = KEEP_DAYS) {
  const cut = nowMs - days * DAY;
  return rows.filter((r) => r && typeof r.at === "string" && Date.parse(r.at) >= cut);
}

// Rows from several files merged by their timestamp (the same run may be in two of them), oldest first.
export function mergeRows(...lists) {
  const by = new Map();
  for (const list of lists) for (const r of list || []) if (r && typeof r.at === "string") by.set(r.at, r);
  return [...by.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function readJsonl(path) {
  if (!path || !existsSync(path)) return [];
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a broken line is dropped, not fatal */ }
  }
  return rows;
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// Latency of a call counts when an HTTP answer came back or the call ran into the timeout (counted at the timeout,
// so a timeout raises the percentile instead of vanishing). Connection errors and skipped calls have no latency.
function latencyOf(step) {
  if (!step || step.skipped) return null;
  if (step.status !== null && step.status !== undefined) return step.ms;
  if (step.timeout) return step.ms;
  return null;
}

export function summarize(rows, config, nowMs) {
  const endpoints = config.endpoints.map((ep) => {
    const seen = (days) => rows.filter((r) => Date.parse(r.at) >= nowMs - days * DAY)
      .map((r) => (r.results || []).find((x) => x.id === ep.id)).filter(Boolean);
    const d1 = seen(1), d7 = seen(7);
    const last = d7.length ? d7[d7.length - 1] : null;
    const lastRow = rows.filter((r) => (r.results || []).some((x) => x.id === ep.id)).slice(-1)[0] || null;
    const reach = (list) => ({ ok: list.filter((x) => reachStep(x) && reachStep(x).ok).length, of: list.length });
    const calls7 = d7.map(callStep);
    const lat7 = calls7.map(latencyOf);
    const init = last && ep.kind === "mcp" ? last.steps.initialize : null;
    const lastVersioned = [...d7].reverse().find((x) => x.kind === "mcp" && x.steps.initialize && x.steps.initialize.ok);
    const lastListed = [...d7].reverse().find((x) => x.kind === "mcp" && x.steps.tools_list && x.steps.tools_list.ok);
    const r1 = reach(d1), r7 = reach(d7);
    const callOk = calls7.filter((c) => c && c.ok).length;
    return {
      id: ep.id, kind: ep.kind, url: ep.url, tool: ep.kind === "mcp" ? ep.call.name : null,
      last: last ? {
        at: lastRow ? lastRow.at : null,
        ok: !!(callStep(last) && callStep(last).ok && reachStep(last) && reachStep(last).ok),
        error: (reachStep(last) && reachStep(last).error) || (callStep(last) && callStep(last).error) || null,
        call_ms: callStep(last) ? callStep(last).ms ?? null : null
      } : null,
      reach_24h_pct: pct(r1.ok, r1.of), reach_24h: r1,
      reach_7d_pct: pct(r7.ok, r7.of), reach_7d: r7,
      call_success_7d_pct: pct(callOk, calls7.length), call_success_7d: { ok: callOk, of: calls7.length },
      call_p50_ms_7d: percentile(lat7, 50),
      call_p95_ms_7d: percentile(lat7, 95),
      server_name: lastVersioned ? lastVersioned.steps.initialize.server_name : null,
      server_version: lastVersioned ? lastVersioned.steps.initialize.server_version : null,
      protocol_version: lastVersioned ? lastVersioned.steps.initialize.protocol_version : null,
      tool_count: lastListed ? lastListed.steps.tools_list.tool_count : null,
      last_initialize_ms: init ? init.ms ?? null : null
    };
  });
  return {
    schema: SCHEMA,
    generated_at: new Date(nowMs).toISOString(),
    measured_from: "one GitHub Actions hosted runner per run (GitHub does not say where; usually the United States)",
    cadence: "every endpoint once an hour, one after another",
    timeout_ms: TIMEOUT_MS,
    history_days: KEEP_DAYS,
    percentile_method: "nearest rank over the last 7 days of tools/call (or GET) latencies; timeouts count at the timeout",
    rows_in_history: rows.length,
    endpoints
  };
}

// ---- canonical form and the self hash (same recipe as ops/tsunagi/board.json) ---------------------------------

export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function withSelfHash(obj, key = "status_sha256") {
  const body = { ...obj };
  delete body[key];
  return { ...body, [key]: createHash("sha256").update(canonical(body), "utf8").digest("hex") };
}

export function checkSelfHash(obj, key = "status_sha256") {
  const body = { ...obj };
  delete body[key];
  return createHash("sha256").update(canonical(body), "utf8").digest("hex") === obj[key];
}

// ---- STATUS.md -----------------------------------------------------------------------------------------------

const NO_DASH = /[\u2012-\u2015\u2212\uFF0D]/g;   // keep the page free of dash characters even if an error text has one
const cell = (v) => String(v ?? "n/a").replace(/\|/g, "/").replace(/\s+/g, " ").replace(NO_DASH, "-");
const ratio = (p, r) => (p === null ? "n/a" : p + "% (" + r.ok + "/" + r.of + ")");
const ms = (v) => (v === null || v === undefined ? "n/a" : v + " ms");

export function renderMarkdown(status) {
  const L = [];
  L.push("# Endpoint status", "");
  L.push("Written by `tools/status/probe.mjs` at " + status.generated_at + ". Machine readable: [status.json](status.json) " +
    "(status_sha256 `" + status.status_sha256 + "`). Raw rows of the last " + status.history_days + " days: [history.jsonl](history.jsonl).", "");
  L.push("| Endpoint | Last run | Reach 24 h | Reach 7 d | Call success 7 d | Call P50 7 d | Call P95 7 d | Server version | Tools |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const e of status.endpoints) {
    const last = !e.last ? "no data" : (e.last.ok ? "ok" : "FAIL: " + e.last.error) + " at " + e.last.at;
    const name = "[" + e.id + "](" + e.url + ")" + (e.tool ? "<br>`" + e.tool + "`" : "<br>GET");
    L.push("| " + [name, cell(last), ratio(e.reach_24h_pct, e.reach_24h), ratio(e.reach_7d_pct, e.reach_7d),
      ratio(e.call_success_7d_pct, e.call_success_7d), ms(e.call_p50_ms_7d), ms(e.call_p95_ms_7d),
      cell(e.server_version), cell(e.tool_count)].map((x, i) => (i === 0 ? x : cell(x))).join(" | ") + " |");
  }
  L.push("", "## How it is measured", "");
  L.push("- Once an hour a GitHub Actions hosted runner probes each endpoint in turn, with a " + status.timeout_ms / 1000 + " second timeout per request.");
  L.push("- MCP endpoints: `initialize` (protocol " + PROTOCOL_VERSION + ", accepting JSON or an SSE framed answer, keeping any `mcp-session-id`), `tools/list`, then one read only `tools/call` named in `tools/status/endpoints.json`. HTTP endpoints: one GET of a documented JSON path.");
  L.push("- Reach: the first step answered correctly (`initialize` returned a result, or the GET returned the expected JSON). Call success: the `tools/call` returned a result without `isError` (for HTTP, the GET). Runs where the endpoint was not reached count as failed calls.");
  L.push("- Latency is the time until the whole answer was read. P50 and P95 are nearest rank over the last 7 days; a timeout counts as " + status.timeout_ms + " ms; connection errors have no latency.");
  L.push("- Server version and tool count are what the endpoint itself reported in its last successful `initialize` and `tools/list`.");
  L.push("", "## What it does not establish", "");
  L.push("- One vantage point: one runner region per run, chosen by GitHub and not disclosed (usually the United States). Users in Japan or elsewhere may see very different times.");
  L.push("- One sample per endpoint per hour. A short outage between samples is not seen; one slow sample moves a 24 hour figure a lot.");
  L.push("- It is not a measure of user experience, of correctness of the answers, or of any tool other than the one called.");
  L.push("- Scheduled GitHub runs can start late or be skipped under load; a missing hour is a gap in the data, not an outage.");
  L.push("- The probe's own calls are counted by the servers' usage counters where those exist.");
  L.push("");
  return L.join("\n");
}

// ---- CLI -----------------------------------------------------------------------------------------------------

function args(argv) {
  const a = { history: [], config: join(HERE, "endpoints.json"), out: null, committed: null, dueHours: 5.5, now: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--history") { a.history.push(v); i++; }
    else if (k === "--config") { a.config = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--committed") { a.committed = v; i++; }
    else if (k === "--due-hours") { a.dueHours = Number(v); i++; }
    else if (k === "--now") { a.now = v; i++; }
    else throw new Error("unknown argument " + k);
  }
  if (!a.out) throw new Error("--out DIR is required");
  return a;
}

export function commitDue(committedPath, nowMs, dueHours) {
  try {
    const prev = JSON.parse(readFileSync(committedPath, "utf8"));
    const t = Date.parse(prev.generated_at);
    return !Number.isFinite(t) || nowMs - t >= dueHours * 3600000;
  } catch {
    return true;
  }
}

async function main() {
  const a = args(process.argv.slice(2));
  const config = JSON.parse(readFileSync(a.config, "utf8"));
  const results = await probeAll(config);
  const nowMs = a.now ? Date.parse(a.now) : Date.now();
  const row = { at: new Date(nowMs).toISOString(), probe: "hs-status-probe-v0", runner: process.env.GITHUB_ACTIONS ? "github-actions" : "local", results };
  const rows = prune(mergeRows(...a.history.map(readJsonl), [row]), nowMs);
  const status = withSelfHash(summarize(rows, config, nowMs));
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, "history.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(a.out, "status.json"), JSON.stringify(status, null, 2) + "\n");
  const md = renderMarkdown(status);
  writeFileSync(join(a.out, "STATUS.md"), md);
  console.log(md);
  if (a.committed) {
    const due = commitDue(a.committed, nowMs, a.dueHours);
    console.log("commit_due=" + due);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "commit_due=" + due + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
}
