// preflight_agent (扉 0.4.17): 任せる前の 1 回を MCP の道具として答える。ネットワーク無し、fetch は差し替え。
// 見るのは 5 点: 道具が一覧に在る / 宣言した相手の読み / 宣言の無い相手を負と書かん / 入口で断る物 / 取れん時に取れんと言う。
// 走らせ方: node test/preflight_agent.test.mjs   (workers/hs-verify-gate で)   1 つでも落ちたら exit 1。
import { createHash } from "node:crypto";
import worker from "../src/worker.js";

const EXT = "https://gate.horizonshield.dev/ext/conduct/v1";
const PERMA = "https://w3id.org/horizonshield/conduct/v1";
const CTX = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const jres = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const store = new Map();
const kv = {
  get: async (k, t) => { const v = store.has(k) ? store.get(k) : null; return ((t === "json" || (t && t.type === "json")) && v !== null) ? JSON.parse(v) : v; },
  put: async (k, v) => { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
  delete: async (k) => { store.delete(k); },
  list: async (o) => ({ keys: [...store.keys()].filter((k) => k.startsWith((o && o.prefix) || "")).map((name) => ({ name })), list_complete: true }),
};
const ENV = { HS_VERIFY_KV: kv, GATE_COMMIT: "preflight-local" };

// 登録簿に 1 行: 最新の定期測定が通った endpoint。
const VERIFIED_EP = "https://paid.redteam.invalid/mcp";
const REC = "a".repeat(64);
store.set("hist:" + createHash("sha256").update(VERIFIED_EP).digest("hex").slice(0, 16),
  JSON.stringify({ endpoint: VERIFIED_EP, entries: [{ status: "verified", measured_at: "2026-09-27T18:00:00Z", record_sha256: REC, record_url: "https://gate.horizonshield.dev/record/" + REC }] }));

const CARDS = {
  "paid.redteam.invalid": { name: "Paid", capabilities: { extensions: [{ uri: EXT, required: false, params: {
    compensation: { paid_by: "buyer", model: "per_task" }, measured_endpoints: [VERIFIED_EP, "https://paid.redteam.invalid/other", "http://paid.redteam.invalid/plain"],
    witness_intake: "https://ledger.redteam.invalid/witness", conduct_record: "https://ledger.redteam.invalid/record" } }] }, signatures: [{ protected: "x", signature: "y" }] },
  "perma.redteam.invalid": { name: "Perma", compensation: { paid_by: "operator" }, capabilities: { extensions: [{ uri: PERMA, params: {} }] } },
  "plain.redteam.invalid": { name: "Plain", capabilities: { streaming: false } },
  "notjson.redteam.invalid": "<html>no</html>",
};
const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(url); seen.push(u.href);
  if (u.hostname === "down.redteam.invalid") throw new Error("connect ECONNREFUSED");
  if (u.pathname !== "/.well-known/agent-card.json" && u.pathname !== "/custom/agent-card.json") return new Response("nf", { status: 404 });
  const c = CARDS[u.hostname];
  if (c === undefined) return new Response("nf", { status: 404 });
  return typeof c === "string" ? new Response(c, { status: 200 }) : jres(c);
};

const O = "https://gate.horizonshield.dev";
let id = 0;
const rpc = async (method, params) => (await (await worker.fetch(new Request(O + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }), ENV, CTX)).json());
const pf = async (args) => (await rpc("tools/call", { name: "preflight_agent", arguments: args })).result;

let fails = 0;
const chk = (name, cond, extra) => { console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  <<< " + (extra || ""))); if (!cond) fails++; };

// 1. 一覧に在る、読むだけと名乗る
const list = await rpc("tools/list", {});
const tool = list.result && list.result.tools.find((x) => x.name === "preflight_agent");
chk("tools/list: preflight_agent is listed, agent required, readOnlyHint", !!tool && tool.inputSchema.required[0] === "agent" && tool.annotations.readOnlyHint === true, JSON.stringify(list).slice(0, 200));

// 2. 宣言した相手
let r = await pf({ agent: "https://paid.redteam.invalid" });
let s = r.structuredContent || {};
chk("declared: not an error, schema gate-preflight-v1", !r.isError && s.schema === "gate-preflight-v1", JSON.stringify(r).slice(0, 300));
chk("declared: extension_declared true under the gate URI", s.extension_declared === true && s.declared_uri === EXT);
chk("declared: compensation shown as declared, source extension params", s.compensation && s.compensation.paid_by === "buyer" && s.compensation_source === "extension params");
chk("declared: signature presence reported (presence only)", s.card_signature_present === true && s.does_not_establish.some((x) => x.includes("signature is valid")));
chk("declared: http endpoint dropped from measured_endpoints", s.measured_endpoints.length === 2 && !s.measured_endpoints.some((x) => x.startsWith("http:")), JSON.stringify(s.measured_endpoints));
const r0 = s.register.find((x) => x.endpoint === VERIFIED_EP), r1 = s.register.find((x) => x.endpoint !== VERIFIED_EP);
chk("declared: register reads verified true with the record hash", r0 && r0.state === "verified" && r0.verified === true && r0.record_sha256 === REC, JSON.stringify(r0));
chk("declared: unmeasured endpoint reads absent and verified null, never false", r1 && r1.state === "absent" && r1.verified === null, JSON.stringify(r1));
chk("declared: witness intake and conduct record carried", s.witness_intake === "https://ledger.redteam.invalid/witness" && s.conduct_record === "https://ledger.redteam.invalid/record");
chk("declared: one outbound fetch only (the card)", seen.length === 1 && seen[0] === "https://paid.redteam.invalid/.well-known/agent-card.json", JSON.stringify(seen));

// 3. 永続識別子、card top-level の compensation
r = await pf({ agent: "https://perma.redteam.invalid/some/path" }); s = r.structuredContent || {};
chk("perma-id: declared under w3id, compensation from card top-level, origin used", s.extension_declared === true && s.declared_uri === PERMA && s.compensation_source === "card top-level" && s.card_url === "https://perma.redteam.invalid/.well-known/agent-card.json", JSON.stringify(s).slice(0, 300));

// 4. 宣言の無い相手: 失敗やなく、無いと書くだけ
r = await pf({ agent: "https://plain.redteam.invalid" }); s = r.structuredContent || {};
chk("no extension: success channel, extension_declared false, no compensation, empty register", !r.isError && s.extension_declared === false && s.compensation === null && s.register.length === 0);
chk("no extension: the description says absence is not a negative verdict", tool.description.includes("not a negative verdict"));

// 5. 明示の card URL
r = await pf({ agent: "https://paid.redteam.invalid/custom/agent-card.json" }); s = r.structuredContent || {};
chk("explicit card URL is fetched as given", s.card_url === "https://paid.redteam.invalid/custom/agent-card.json" && s.extension_declared === true);

// 6. 入口で断る物 (外へは出ん)
const before = seen.length;
for (const [args, err] of [[{ agent: "http://paid.redteam.invalid" }, "https_required"], [{ agent: "not a url" }, "invalid_url"], [{ agent: "https://localhost" }, "agent_not_public"], [{ agent: "https://10.0.0.1" }, "agent_not_public"], [{ agent: "https://u:p@paid.redteam.invalid" }, "agent_not_public"], [{}, "agent_required"]]) {
  r = await pf(args);
  const body = JSON.parse(r.content[0].text);
  chk("refused at the door: " + JSON.stringify(args) + " -> " + err, r.isError === true && body.error === err, JSON.stringify(body));
}
chk("refusals made no outbound fetch", seen.length === before, JSON.stringify(seen.slice(before)));

// 7. 取れん時は取れんと言う (失敗の口で)
r = await pf({ agent: "https://down.redteam.invalid" }); let b = JSON.parse(r.content[0].text);
chk("unreachable: failure channel, card_status 0, card_unreachable", r.isError === true && b.card_status === 0 && String(b.error).startsWith("card_unreachable"), JSON.stringify(b).slice(0, 200));
r = await pf({ agent: "https://notjson.redteam.invalid" }); b = JSON.parse(r.content[0].text);
chk("not json: failure channel, card_not_json", r.isError === true && b.error === "card_not_json" && b.card_status === 200);
r = await pf({ agent: "https://missing.redteam.invalid" }); b = JSON.parse(r.content[0].text);
chk("404 card: failure channel, card_http_404, status kept", r.isError === true && b.card_status === 404 && b.error === "card_http_404", JSON.stringify(b).slice(0, 200));

console.log(fails ? "\n" + fails + " FAIL" : "\nall pass");
process.exit(fails ? 1 : 0);
