/* 加盟店MCP(001・002)の「強み」に、店の紹介でない返事が出ないかを実物の fetch で確かめる。KV は模擬、ネットワークに出ない。
   なぜ要るか (2026-09-30): 001 の公開 MCP の strengths に、社内の人への挨拶、こちらの設問文、値引きの打診や材料の値上がり、
   代理店の件の返事「進めて下さい」、受け答え「こちら記入すみです」が出ていた(番人が live で確認)。
   extra を全部出して危ない名前だけ弾く作りだったため。公開してよい設問だけを出す作り(PUBLIC_EXTRA)に変えた。 */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pub-"));
let fails = 0, ran = 0;
function ok(name, cond, detail) { ran++; if (cond) return; fails++; console.log("  NG   " + name + (detail !== undefined ? "  <- " + detail : "")); }
async function loadWorker(rel) {
  const srcDir = path.join(REPO, path.dirname(rel));
  const dir = fs.mkdtempSync(path.join(TMP, "w-"));
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.endsWith(".js")) continue;
    const body = fs.readFileSync(path.join(srcDir, f), "utf8").replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
    fs.writeFileSync(path.join(dir, f.replace(/\.js$/, ".mjs")), body);
  }
  return (await import(path.join(dir, path.basename(rel).replace(/\.js$/, ".mjs")) + "?v=" + Math.random())).default;
}
function kv(obj) { const m = new Map(Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)]));
  return { get: async (k, t) => { if (!m.has(k)) return null; const v = m.get(k); return t === "json" ? JSON.parse(v) : v; } }; }
const W = (text, attributed) => ({ text, at: "2026-09-10T00:00:00Z", attributed: attributed || "recent_wave", with: [] });
const JUNK = {
  q_en_recent: W("@社内の人 明日以後宜しくです！"),
  q_fr_support: W("進めて下さい", "legacy_confirmed"),
  q_cn_souba_nai: W("こちら記入すみです"),
  q_cn_takai_iwareta: W("値下げは可能か、などの打診を受けたことはあります。"),
  q_cn_zairyo_ugoki: W("クロスの量産、一般どちらも値上がりしました。"),
  q_ai_found: W("toB営業アポ無し訪問から横のつながりで紹介。"),
  q_estimates: W("御見積書を３部添付させて頂きました。"),
  q_ai_summary: W("総合内装リフォーム業として、レスポンス早くスピーディーに対応します。"),
  q_cases: W("長久手市 店舗内装の全面改修"),
  q_story: W("なし", "recent_wave"),
  q_spec: W("標準仕様は曖昧に当たった返事です。", "ambiguous"),
};
for (const [rel, sid] of [["workers/hs-partner-001-mcp/src/worker.js", "hs-partner-001"], ["workers/hs-partner-002-mcp/src/worker.js", "hs-partner-002"]]) {
  console.log("1. " + sid);
  const worker = await loadWorker(rel);
  const prof = { company: "テスト株式会社", strengths: "取付説明書どおりに施工します。", trust: "1956年創業。",
    faqs: [{ q: "網入りガラスは防犯になる？", a: "防火のためで防犯効果はありません。" }], extra: JUNK,
    works: sid === "hs-partner-002" ? ["窓", "玄関", "玄関"] : undefined };
  const env = { STORE_ID: sid, PARTNER_NAME: "テスト店",
    HS_HEARING_KV: kv({ ["store:" + sid]: { store_id: sid, member_no: "No.0", company: "テスト株式会社", status: "published", tier: "honbu", works: ["内装", "内装", "屋根"], areas: ["愛知県"] },
                        ["hearing:" + sid]: { profile: prof } }) };
  const res = await worker.fetch(new Request("https://p.example/mcp", { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_partner_profile", arguments: {} } }) }), env);
  const body = await res.json();
  const p = body.result && body.result.structuredContent;
  ok(sid + ": 答えが返る", p && p.found === true, JSON.stringify(body).slice(0, 300));
  const txt = JSON.stringify(p);
  ok(sid + ": 私信が出ない", !/明日以後宜しく/.test(txt));
  ok(sid + ": 代理店の返事が出ない", !/進めて下さい/.test(txt));
  ok(sid + ": 受け答えが出ない", !/記入すみ/.test(txt));
  ok(sid + ": 値引きの打診・材料の値上がり(相場の観測)が出ない", !/値下げ|値上がり/.test(txt));
  ok(sid + ": 集客経路(営業の内情)が出ない", !/アポ無し/.test(txt));
  ok(sid + ": 見積提出の連絡が出ない", !/添付させて/.test(txt));
  ok(sid + ": 曖昧に当たった返事は出ない", !/曖昧に当たった/.test(txt));
  ok(sid + ": 短すぎる受け答え(なし)は出ない", !("story" in p.strengths));
  ok(sid + ": 会社の紹介(q_ai_summary)は summary として出る", /スピーディー/.test(p.strengths.summary || ""), JSON.stringify(p.strengths));
  ok(sid + ": 施工事例(q_cases)は cases として出る", /店舗内装/.test(p.strengths.cases || ""));
  ok(sid + ": 整備済みの強みと信頼の根拠が出る", /取付説明書/.test(p.strengths.strengths || "") && /1956/.test(p.strengths.trust || ""));
  ok(sid + ": FAQ が出る", Array.isArray(p.faqs) && p.faqs.length === 1);
  ok(sid + ": 値は本文だけ(at や attributed を出さない)", !/attributed|"at"/.test(JSON.stringify(p.strengths)));
  ok(sid + ": 工種が重複しない", new Set(p.works).size === p.works.length, JSON.stringify(p.works));
}
console.log(fails ? ("=== NG " + fails + " / " + ran + " ===") : ("加盟店MCPの公開フィールド 全" + ran + "件 通過"));
process.exit(fails ? 1 : 0);
