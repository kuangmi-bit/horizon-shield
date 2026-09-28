// 0.4.19 (2026-09-29): 道具の hint と _meta が黙って変わったら、扉の記録に日付付きで残るか。
// 発端: Arthur Teboul (DokuTrak) が 2026-09-28 に、tool_hashes が name / description / inputSchema しか
// 覆わんことを見つけた。destructiveHint: true を黙って外した版は、manifest_hash も tool_hashes も 1 桁も
// 動かさず、/changes にも履歴にも載らんかった。client が人に確認を求めるかどうかを決める欄が、見えとらんかった。
// この試験は 3 つを守る。
//   (1) 既存の欄は 1 バイトも変わらん: tool_hashes と manifest_hash を、この試験の中の独立した JCS で計算し直して一致させる。
//   (2) 新しい欄 extras_* が annotations / _meta / outputSchema / title の変化を拾い、閉じた一覧の外は拾わん。
//   (3) 0.4.18 の形の前回 (extras を持たん) との比較では誤報せん。掃引を 2 回回す結合試験で、実際の配線も確かめる。
// Offline。走らせ方: node test/surface_extras.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import worker, { _surface } from "../src/worker.js";
import { createHash } from "node:crypto";

const { surfaceHashes, surfaceChange, SURFACE_EXTRAS_COVERS } = _surface;
const R = [];
const t = (kind, name, ok, detail = "") => R.push({ kind, name, ok: !!ok, detail: String(detail) });
const sha16 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").slice(0, 16);
// 独立した JCS (RFC 8785) の最小実装。この試験の値は文字列・真偽・null・小さい整数・object・array だけ。
const jcs = (v) => v === undefined ? "undefined" : v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
const clone = (x) => JSON.parse(JSON.stringify(x));

const SEND = {
  name: "create_request", title: "Create a document request",
  description: "Builds a request and emails it to the client.",
  inputSchema: { type: "object", properties: { recipient_email: { type: "string" } }, required: ["recipient_email"] },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
  _meta: { "anthropic/requiresUserInteraction": true }
};
const READ = { name: "list_requests", description: "Lists requests.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } };
const BASE = [SEND, READ];
const surf = (tools) => surfaceHashes(clone(tools), { serverInfo: { name: "x", version: "1" } }, 1, true, { detectable: true, lost: [] });

// ---- (1) 既存の欄は不変 -------------------------------------------------------------------------------
const s0 = await surf(BASE);
const oldStrip = (x) => ({ name: x.name, description: x.description || "", inputSchema: x.inputSchema || null });
const sortedBase = clone(BASE).sort((a, b) => (a.name < b.name ? -1 : 1));
t("control", "tool_hashes still covers name, description and inputSchema only (recomputed here with an independent JCS)",
  s0.tool_hashes.create_request === sha16(jcs(oldStrip(SEND))) && s0.tool_hashes.list_requests === sha16(jcs(oldStrip(READ))), JSON.stringify(s0.tool_hashes));
t("control", "manifest_hash is the 0.4.18 recipe byte for byte", s0.manifest_hash === sha16(jcs(sortedBase.map(oldStrip))), s0.manifest_hash);
const bare = BASE.map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema }));
const sBare = await surf(bare);
t("control", "the same tools without annotations, _meta or title give the same manifest_hash and tool_hashes (old fingerprints stay comparable)",
  sBare.manifest_hash === s0.manifest_hash && jcs(sBare.tool_hashes) === jcs(s0.tool_hashes));

// ---- (2) 新しい欄 ---------------------------------------------------------------------------------------
t("control", "extras_covers is written into the record as the closed list annotations, _meta, outputSchema, title",
  jcs(s0.extras_covers) === jcs(["annotations", "_meta", "outputSchema", "title"]) && jcs(SURFACE_EXTRAS_COVERS) === jcs(s0.extras_covers), jcs(s0.extras_covers));
const extraOf = (x) => ({ annotations: x.annotations ?? null, _meta: x._meta ?? null, outputSchema: x.outputSchema ?? null, title: x.title ?? null });
t("control", "extras_hashes per tool recompute independently", s0.extras_hashes.create_request === sha16(jcs(extraOf(SEND))) && s0.extras_hashes.list_requests === sha16(jcs(extraOf(READ))), jcs(s0.extras_hashes));
t("control", "extras_manifest_hash recomputes independently", s0.extras_manifest_hash === sha16(jcs(sortedBase.map((x) => ({ name: x.name, ...extraOf(x) })))), s0.extras_manifest_hash);

async function moved(mutate) {
  const next = clone(BASE); mutate(next);
  const s1 = await surf(next);
  return { s1, sc: surfaceChange(s0, s1) };
}
{
  const { s1, sc } = await moved((ts) => { delete ts[0].annotations.destructiveHint; });
  t("attack", "Arthur's case: destructiveHint dropped silently. The old fields do not move (that was the hole)...",
    s1.manifest_hash === s0.manifest_hash && s1.tool_hashes.create_request === s0.tool_hashes.create_request);
  t("attack", "...and the record now says so: surface_change.extras_changed names create_request, definition_changed stays empty",
    sc && jcs(sc.extras_changed) === jcs(["create_request"]) && sc.definition_changed.length === 0 && sc.added.length === 0 && sc.removed.length === 0, jcs(sc));
  t("control", "the note says hints are self-declared and not judged", sc && /self-declared hints/.test(sc.note) && /does not judge/.test(sc.note));
}
{
  const { sc } = await moved((ts) => { ts[0]._meta = {}; });
  t("attack", "_meta confirmation key removed is recorded", sc && jcs(sc.extras_changed) === jcs(["create_request"]), jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[1].outputSchema = { type: "object", properties: { items: { type: "array" } } }; });
  t("attack", "outputSchema added to a read tool is recorded (it breaks callers the way inputSchema does)", sc && jcs(sc.extras_changed) === jcs(["list_requests"]), jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[0].title = "Send now"; });
  t("attack", "title change is recorded", sc && jcs(sc.extras_changed) === jcs(["create_request"]), jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[1].annotations = { readOnlyHint: false, destructiveHint: true }; });
  t("attack", "a read tool that starts calling itself destructive is recorded", sc && jcs(sc.extras_changed) === jcs(["list_requests"]), jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[0].icons = [{ src: "https://example.invalid/i.png" }]; ts[0].x_served_at = String(Date.now()); });
  t("control", "a field outside the closed list (icons, a per-response timestamp) moves nothing: no daily false change", sc === null, jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[0].annotations = { openWorldHint: true, idempotentHint: false, destructiveHint: true }; });
  t("control", "the same annotations in a different key order are the same (JCS), no change", sc === null, jcs(sc));
}
{
  const { sc } = await moved((ts) => { ts[0].inputSchema.properties.cc = { type: "string" }; });
  t("control", "an inputSchema change is still definition_changed, and extras_changed is empty", sc && jcs(sc.definition_changed) === jcs(["create_request"]) && sc.extras_changed.length === 0, jcs(sc));
}

// ---- (3) 0.4.18 の前回、部分読み、拒否 -------------------------------------------------------------------
const legacy = clone(s0); delete legacy.extras_covers; delete legacy.extras_manifest_hash; delete legacy.extras_hashes;
t("control", "first measurement after deploy: previous entry has no extras, manifest equal, so no change is reported", surfaceChange(legacy, s0) === null);
{
  const next = clone(BASE); next.push({ name: "zeta", description: "z", inputSchema: null });
  const sc = surfaceChange(legacy, await surf(next));
  t("control", "against a 0.4.18 entry a real manifest move is still reported in the 0.4.18 shape (no extras_changed key)", sc && jcs(sc.added) === jcs(["zeta"]) && !("extras_changed" in sc), jcs(sc));
}
{
  const next = clone(BASE); delete next[0].annotations.destructiveHint;
  const s1 = await surf(next);
  t("control", "an incomplete read on either side is never compared", surfaceChange({ ...s0, complete: false }, s1) === null && surfaceChange(s0, { ...s1, complete: false }) === null);
  t("control", "a withheld extras hash (canonicalization refused) is not compared against a real one", surfaceChange({ ...s0, extras_manifest_hash: null }, s1) === null);
}
{
  const refused = await surfaceHashes(clone(BASE), null, 1, true, { detectable: true, lost: ["9007199254740993"] });
  t("control", "when canonicalization is refused, the extras hashes are withheld too (null), never a number nobody can reproduce",
    refused.extras_manifest_hash === null && Object.values(refused.extras_hashes).every((v) => v === null) && refused.manifest_hash === null);
}

// ---- 結合: 掃引を 2 回回し、2 回目の前に destructiveHint を外す -----------------------------------------------
let TOOLS = clone(BASE);
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
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
const HASH_A = "aa".repeat(32);
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  if (u.hostname === "mempool.space" || u.hostname === "blockstream.info") {
    if (u.pathname === "/api/blocks/tip/height") return new Response(u.hostname === "mempool.space" ? "900006" : "900007");
    if (/^\/api\/block-height\/900000$/.test(u.pathname)) return new Response(HASH_A);
    if (u.pathname === "/api/block/" + HASH_A) return jres({ id: HASH_A, height: 900000, timestamp: Math.floor(Date.now() / 1000) + 3600 });
    return new Response("", { status: 404 });
  }
  if (u.hostname === "ledger.horizonshield.dev") return jres({ ok: true, accepted: true, id: "x", sha256: "00".repeat(32) }, 201);
  if (!/\.redteam\.invalid$/.test(u.hostname)) return new Response("no", { status: 500 });
  if (u.pathname === "/mcp" && (init && init.method) === "POST") {
    const body = JSON.parse(init.body); const id = body.id;
    if (body.method === "initialize") return jres({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "rt", version: "0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return jres({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return jres({ jsonrpc: "2.0", id, error: { code: -32601, message: "nope" } });
  }
  return new Response("not found", { status: 404 });
};
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const env = { HS_VERIFY_KV: kv(), SWEEP_TOKEN: "rt-token", GATE_COMMIT: "rt-local", SUBREQUEST_BUDGET: 1000 };
const call = (p, init) => worker.fetch(new Request("https://gate.horizonshield.dev" + p, init), env, CTX);
const post = (p, body, headers) => call(p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body) });
const EP = "https://dok.redteam.invalid/mcp";
const entriesOf = async () => ((await (await call("/history?endpoint=" + encodeURIComponent(EP))).json()).entries || []);
async function sweepUntil(n) {
  for (let i = 0; i < 4 && (await entriesOf()).length < n; i++) await post("/sweep", { force: true }, { "x-sweep-token": "rt-token" });
  return entriesOf();
}
await post("/watch", { endpoint: EP });
let es = await sweepUntil(1);
t("control", "integration: first sweep wrote one entry whose surface carries extras (0.4.19 record shape)",
  es.length === 1 && es[0].surface && typeof es[0].surface.extras_manifest_hash === "string" && !es[0].surface_change, jcs(es[0] && es[0].surface).slice(0, 200));
delete TOOLS[0].annotations.destructiveHint;
es = await sweepUntil(2);
const e2 = es[es.length - 1];
t("attack", "integration: the second sweep's history entry carries surface_change.extras_changed = [create_request]",
  es.length === 2 && e2.surface_change && jcs(e2.surface_change.extras_changed) === jcs(["create_request"]), jcs(e2 && e2.surface_change).slice(0, 240));
const ch = await (await call("/changes")).json();
const list = Array.isArray(ch) ? ch : (ch.changes || ch.recent || []);
const mine = list.filter((c) => c.endpoint === EP);
t("attack", "integration: /changes lists it, and the summary says hints or metadata changed",
  mine.length >= 1 && /hints or metadata changed \(create_request\)/.test(mine[mine.length - 1].summary || ""), jcs(mine).slice(0, 300));
const regHtml = await (await call("/register")).text();
t("control", "integration: /register still renders after the change (no exception from the new field)", typeof regHtml === "string" && regHtml.length > 100, String(regHtml).slice(0, 80));

// ---- 報告 ----------------------------------------------------------------------------------------------
const kinds = {};
for (const r of R) { const k = kinds[r.kind] || [0, 0]; kinds[r.kind] = [k[0] + (r.ok ? 1 : 0), k[1] + 1]; }
for (const k of ["attack", "control"]) if (kinds[k]) console.log("  " + k.padEnd(10) + " " + kinds[k][0] + " / " + kinds[k][1]);
for (const r of R) if (!r.ok) console.log("  NG  [" + r.kind + "] " + r.name + "\n      " + r.detail);
const passed = R.filter((r) => r.ok).length;
console.log("=== " + passed + " / " + R.length + " 合格 (surface extras、扉 0.4.19) ===");
process.exit(passed === R.length ? 0 : 1);
