// openapi_agent_ready (2026-09-27): /openapi.json が、読む側がエージェントでも一読で動ける記述になっとるか。
// 発端は外部の agent-readiness 監査 (38/100): operationId 0、例 0、冪等性・副作用・取り消し方の記述 0、
// 無認証の明示 0、匿名登録の口 (POST /watch) と型の付いた通知が記述に無い。
// 守る物: 全操作に operationId (一意) と tags と x-side-effects / x-idempotent / x-reversibility、
// 宣言した口が全部この worker に実在する (記述と実装のズレを許さん)、例は本物の形、webhook の event 名は
// 実装が送る文字列と一致、運営者の鍵を要る操作は 1 つも載っとらん、禁止のダッシュが本文に無い。
// 測るのは deploy される src/worker.js のバイトそのもの。外への fetch は全部即座に断る (網に出ん)。
// 走らせ方: node test/openapi_agent_ready.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import worker from "../src/worker.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "src", "worker.js"), "utf8");
globalThis.fetch = async () => { throw new Error("offline test: no network"); };

const O = "https://gate.horizonshield.dev";
const CTX = { waitUntil() {} };
let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail)); };
const MEM = new Map();
const KV = { get: async (k, type) => { const v = MEM.get(k); return v === undefined ? null : (type === "json" ? JSON.parse(v) : v); }, put: async (k, v) => { MEM.set(k, String(v)); }, delete: async (k) => { MEM.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
const ENV = { HS_VERIFY_KV: KV };
const call = (req) => Promise.race([worker.fetch(req, ENV, CTX).catch((e) => ({ threw: String(e && e.message || e) })), new Promise((r) => setTimeout(() => r(null), 8000))]);

const res = await call(new Request(O + "/openapi.json"));
const doc = await res.json();
const text = JSON.stringify(doc);
const health = await (await call(new Request(O + "/health"))).json();

t("openapi is 3.1.0", doc.openapi === "3.1.0", doc.openapi);
t("info.version equals the deployed gate version", doc.info.version === health.gate_version, doc.info.version + " vs " + health.gate_version);
t("top-level security is an empty list (anonymous, stated rather than omitted)", Array.isArray(doc.security) && doc.security.length === 0, JSON.stringify(doc.security));
t("the operator scheme is declared under components", doc.components && doc.components.securitySchemes && doc.components.securitySchemes.operator && doc.components.securitySchemes.operator.name === "x-sweep-token");

const METHODS = ["get", "post", "put", "patch", "delete"];
const ops = [];
for (const [p, item] of Object.entries(doc.paths)) for (const m of METHODS) if (item[m]) ops.push({ p, m, op: item[m] });
t("at least 35 operations are described", ops.length >= 35, String(ops.length));

const ids = ops.map((o) => o.op.operationId);
t("every operation has an operationId", ids.every((x) => typeof x === "string" && /^[a-z][A-Za-z0-9]+$/.test(x)), ops.filter((o) => !o.op.operationId).map((o) => o.m + " " + o.p).join(", "));
t("operationIds are unique", new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(","));
const tagNames = new Set((doc.tags || []).map((x) => x.name));
t("every operation carries a tag that is declared", ops.every((o) => Array.isArray(o.op.tags) && o.op.tags.length && o.op.tags.every((g) => tagNames.has(g))), ops.filter((o) => !(o.op.tags || []).every((g) => tagNames.has(g))).map((o) => o.p).join(","));
t("every operation states x-side-effects as a list", ops.every((o) => Array.isArray(o.op["x-side-effects"])), ops.filter((o) => !Array.isArray(o.op["x-side-effects"])).map((o) => o.m + " " + o.p).join(", "));
t("every operation states x-idempotent as a boolean", ops.every((o) => typeof o.op["x-idempotent"] === "boolean"), ops.filter((o) => typeof o.op["x-idempotent"] !== "boolean").map((o) => o.m + " " + o.p).join(", "));
t("every operation states x-reversibility with a kind and a reason", ops.every((o) => o.op["x-reversibility"] && o.op["x-reversibility"].kind && o.op["x-reversibility"].reason), ops.filter((o) => !(o.op["x-reversibility"] && o.op["x-reversibility"].kind)).map((o) => o.m + " " + o.p).join(", "));
t("every GET is idempotent", ops.filter((o) => o.m === "get").every((o) => o.op["x-idempotent"] === true));
t("every operation's 200 names a media type", ops.every((o) => o.op.responses && o.op.responses["200"] && o.op.responses["200"].content && Object.keys(o.op.responses["200"].content).length === 1), ops.filter((o) => !(o.op.responses["200"] && o.op.responses["200"].content)).map((o) => o.m + " " + o.p).join(", "));
t("no operation requires a security scheme", ops.every((o) => o.op.security === undefined || (Array.isArray(o.op.security) && o.op.security.length === 0)));

const byId = Object.fromEntries(ops.map((o) => [o.op.operationId, o.op]));
t("POST /check is declared not idempotent and names its third-party requests", byId.checkEndpoint && byId.checkEndpoint["x-idempotent"] === false && byId.checkEndpoint["x-side-effects"].some((s) => /sends HTTP requests to the named endpoint/.test(s)));
t("POST /check says it writes no verdict (only the sweep does)", byId.checkEndpoint && byId.checkEndpoint["x-side-effects"].some((s) => /does not write a verdict/.test(s)));
t("POST /recompute and /verify-event are pure (no side effects, idempotent)", ["recomputeHash", "verifyNostrEvent"].every((k) => byId[k] && byId[k]["x-idempotent"] === true && byId[k]["x-side-effects"].length === 0));
t("POST /watch is described: anonymous registration, idempotent, reversible by owner or operator", byId.watchEndpoint && byId.watchEndpoint["x-idempotent"] === true && byId.watchEndpoint["x-reversibility"].kind === "owner_or_operator" && byId.watchEndpoint.responses["429"]);
t("endpoint-taking operations declare the endpoint query parameter", ["getHistory", "getBadge", "getEmbed", "getSeal", "lookupEndpoint", "isVerified", "getWatch"].every((k) => byId[k] && (byId[k].parameters || []).some((x) => x.name === "endpoint" && x.in === "query" && x.required === true)));
t("the endpoint query param in the source is what the code reads (searchParams.get(\"endpoint\"))", /searchParams\.get\("endpoint"\)/.test(SRC));

// Examples: real shape, labelled as captured.
const ex = (id) => { const c = byId[id].responses["200"].content["application/json"]; return c && c.examples && c.examples.live_2026_09_27; };
const h = ex("getHealth");
t("GET /health example has exactly the keys the worker returns", !!h && JSON.stringify(Object.keys(h.value).sort()) === JSON.stringify(Object.keys(health).sort()), h && Object.keys(h.value).join(","));
t("examples say they are captured live responses and when", ["getHealth", "lookupEndpoint", "isVerified"].every((k) => { const e = ex(k); return e && /captured from gate\.horizonshield\.dev on 2026-09-27/.test(e.summary); }));
t("example record_sha256 is 64 hex and record_url ends with it", ["lookupEndpoint", "isVerified"].every((k) => { const v = ex(k).value; const s = v.record_sha256 || (v.last_measured && v.last_measured.record_sha256); const u = v.record_url || (v.last_measured && v.last_measured.record_url); return /^[0-9a-f]{64}$/.test(s) && u.endsWith("/record/" + s); }));

// Webhooks: event names are the strings the implementation sends.
for (const w of ["conformance_change", "measured"]) {
  const s = doc.webhooks && doc.webhooks[w] && doc.webhooks[w].post.requestBody.content["application/json"].schema;
  t("webhook " + w + " is typed and its event const matches what the sweep sends", !!s && s.properties.event.const === w && SRC.includes('event: "' + w + '"'));
}

const g = doc["x-agent-guidance"] || {};
t("x-agent-guidance answers auth, registration, idempotency, dry run, rate limits, consent, UA, commerce, errors, events", ["authentication", "registration", "idempotency", "dry_run", "rate_limits", "consent", "measurement_user_agent", "commerce", "errors", "events", "what_this_does_not_establish"].every((k) => typeof g[k] === "string" && g[k].length > 20));
t("the guidance names every operator-only route the code guards with x-sweep-token", ["POST /sweep", "POST /mould", "DELETE /watch", "POST /register/quarantine", "GET /nenrin/probe"].every((r) => g.authentication.includes(r)));

// Every documented operation exists on this worker (never the not_found fall-through).
const fill = (p) => p.replace("{host}{path}", "mcp.horizonshield.dev/mcp").replace("{record_sha256}", "0".repeat(64));
const missing = [];
for (const o of ops) {
  let u = O + fill(o.p);
  if ((o.op.parameters || []).some((x) => x.name === "endpoint")) u += "?endpoint=" + encodeURIComponent("https://mcp.horizonshield.dev/mcp");
  const init = o.m === "get" ? {} : { method: o.m.toUpperCase(), headers: { "content-type": "application/json" }, body: "{}" };
  const r = await call(new Request(u, init));
  if (!r) { missing.push(o.m + " " + o.p + " (timeout)"); continue; }
  if (r.threw) continue; // the route exists and ran; it failed only for want of a binding this offline test does not provide
  let b = null; try { b = await r.clone().json(); } catch (_e) { /* not json: a real route */ }
  if (b && b.error === "not_found" && Array.isArray(b.endpoints)) missing.push(o.m + " " + o.p);
}
t("every documented operation is a real route on this worker", missing.length === 0, missing.join(", "));

t("no forbidden dash characters in the document", !/[\u2012\u2013\u2014\u2015\u2212]/.test(text));

console.log("");
console.log("=== " + pass + " / " + (pass + fail) + (fail ? " 不合格あり" : " 合格") + " (openapi agent-ready、扉 " + health.gate_version + ") ===");
process.exit(fail ? 1 : 0);
