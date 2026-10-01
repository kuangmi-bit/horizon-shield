/* 返信の取り込みで、AI の構造化を元の文に照らす口(env.GROUND、2026-10-01)の配線を確かめる。
   照らし合わせの本体は別の worker にあり、ここでは偽物を置く。確かめるのは配線だけ:
     ・落とした後の形が profile に入る(落とした値は入らない)
     ・hold なら公開ページの生成を止める(取り込みは続ける)
     ・口が無い・落ちたときは GROUND_REQUIRED=1 なら生成を止める。無ければ今まで通り
     ・記録には項目の名前だけが残り、値は残らない
   node workers/hs-hearing/ground_bridge_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsgrd-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js" && !body.includes("export { handlePartnerInbound }")) body += "\nexport { handlePartnerInbound };\n";
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const H = await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random());
const dispatched = [];
globalThis.fetch = async (u) => { if (String(u).includes("api.github.com")) dispatched.push(String(u)); return { ok: true, status: 204, json: async () => ({}), text: async () => "" }; };

let fail = 0, checks = 0;
const check = (label, cond, detail) => { checks++; console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : "")); if (!cond) fail++; };
const SID = "grd-store01";
const AI_OUT = { company: "さざなみ訪問看護ステーション", rep: "架空 太郎", area: "平塚市", works: ["点滴の管理", "服薬管理"], strengths: "創業50年の実績", contact: "0463-99-9999" };
function makeEnv(ground, extra = {}) {
  const kv = new Map();
  const seen = [];
  const env = {
    _kv: kv, _seen: seen,
    AI: { run: async () => ({ response: JSON.stringify(AI_OUT) }) },
    HS_HEARING_KV: { get: async (k, t) => (kv.has(k) ? (t === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [] }) },
    GH_DISPATCH_TOKEN: "t", GH_DISPATCH_REPO: "o/r", GEN_MIN_COMPLETENESS: "0", GEN_DEBOUNCE_MS: "0",
    ...extra,
  };
  if (ground) env.GROUND = { fetch: async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return ground(JSON.parse(init.body)); } };
  return env;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
function seed(env) {
  const store = { store_id: SID, company: "さざなみ訪問看護ステーション", areas: ["平塚市"], works: ["点滴の管理"], tier: "honbu", status: "hearing_done", source: "kira-line", industry: "nursing", token: "ht_grd", created_at: "2026-08-20T00:00:00Z", autopilot: {} };
  env._kv.set("store:" + SID, JSON.stringify(store));
  return store;
}
const ANSWER = "1. 平塚市で訪問看護をしています。点滴の管理と服薬管理をやっています。";
const rec = (env) => JSON.parse(env._kv.get("hearing:" + SID) || "null");

console.log("\n1) 照らし合わせが落とした項目は profile に入らない");
{
  dispatched.length = 0;
  const env = makeEnv((b) => json({ v: "x", decision: "escalate", hold: false, raw: { ...b.raw, rep: "", strengths: "", contact: "" }, dropped: [{ field: "rep", why: "not_in_text" }, { field: "strengths", why: "number_not_in_text" }, { field: "contact", why: "not_in_text" }], flagged: [], sha256: "a".repeat(64) }));
  const store = seed(env);
  const out = await H.handlePartnerInbound(env, SID, store, ANSWER, "line");
  const r = rec(env);
  check("取り込んだ(hearing: がある)", !!r, out && out.kind);
  check("落とした代表者名・強み・電話は入っていない", r && !r.profile.rep && !String(r.profile.strengths || "").includes("50") && !String(r.profile.contact || "").includes("9999"), JSON.stringify(r && r.profile).slice(0, 200));
  check("記録には項目の名前だけ", r && r.ground && r.ground.dropped.join() === "rep:not_in_text,strengths:number_not_in_text,contact:not_in_text" && !JSON.stringify(r.ground).includes("架空"), JSON.stringify(r && r.ground));
  check("hold でなければ生成の合図を出す(2 の『出していない』が意味を持つ証拠)", dispatched.length >= 1, String(dispatched.length));
  check("照らし合わせに AI に渡したのと同じ文と既知の会社名を送った", env._seen.length === 1 && env._seen[0].body.text.includes("点滴の管理") && env._seen[0].body.known.company === "さざなみ訪問看護ステーション");
}

console.log("\n2) hold なら公開ページの生成を止める");
{
  dispatched.length = 0;
  const env = makeEnv((b) => json({ decision: "escalate", hold: true, raw: b.raw, dropped: [], flagged: [{ field: "area", why: "not_in_text" }], sha256: "b".repeat(64) }));
  const store = seed(env);
  await H.handlePartnerInbound(env, SID, store, ANSWER, "line");
  const r = rec(env);
  check("取り込みは続ける(hearing: がある)", !!r);
  check("記録に hold と印", r && r.ground.hold === true && r.ground.flagged.join() === "area:not_in_text", JSON.stringify(r && r.ground));
  check("生成の合図(GitHub)を出していない", dispatched.length === 0, dispatched.join(","));
}

console.log("\n3) 口が無いとき: GROUND_REQUIRED=1 なら止める、無ければ今まで通り");
{
  dispatched.length = 0;
  const env = makeEnv(null, { GROUND_REQUIRED: "1" });
  const store = seed(env);
  await H.handlePartnerInbound(env, SID, store, ANSWER, "line");
  const r = rec(env);
  check("必須なら unavailable で止める", r && r.ground.decision === "unavailable" && r.ground.hold === true && dispatched.length === 0, JSON.stringify(r && r.ground));
  const env2 = makeEnv(null);
  const store2 = seed(env2);
  await H.handlePartnerInbound(env2, SID, store2, ANSWER, "line");
  const r2 = rec(env2);
  check("必須でなければ absent で止めない", r2 && r2.ground.decision === "absent" && r2.ground.hold === false, JSON.stringify(r2 && r2.ground));
}

console.log("\n4) 口が落ちたときも止める(必須)");
{
  dispatched.length = 0;
  const env = makeEnv(() => json({ error: "x" }, 500), { GROUND_REQUIRED: "1" });
  const store = seed(env);
  await H.handlePartnerInbound(env, SID, store, ANSWER, "line");
  const r = rec(env);
  check("500 なら unavailable で止める", r && r.ground.decision === "unavailable" && r.ground.hold && dispatched.length === 0, JSON.stringify(r && r.ground));
  const env2 = makeEnv(() => json({ raw: [1, 2] }), { GROUND_REQUIRED: "1" });
  const store2 = seed(env2);
  await H.handlePartnerInbound(env2, SID, store2, ANSWER, "line");
  check("形の違う返事も unavailable", rec(env2) && rec(env2).ground.decision === "unavailable");
}

console.log("\n" + (fail ? "照らし合わせの配線 " + fail + "/" + checks + " 失敗" : "照らし合わせの配線 すべて通過(" + checks + ")"));
process.exit(fail ? 1 : 0);
