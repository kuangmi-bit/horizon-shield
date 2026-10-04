/* hs-kira-line: グループでの返事と、署名の門を、実物の worker を通して確かめる。ネットワークには出ない。

   なぜ要るか (2026-09-30):
     hs-partner-001 の HORIZON グループで、加盟店さんが @HORIZON SHIELD を付けてこちらの設問に答えたのに、
     公式アカウントは何も返さなかった。8/20 の「グループでは黙る」(HS-KIRA-GROUP-SILENT) が、
     呼ばれた発言まで黙らせていたため。hearing の窓口が返事の文を作っていても、ここで捨てていた。
     あわせて、署名の無い webhook を通していた(fail-open)ので、それも落とす。
   確かめること:
     ・署名の無い要求は 401、署名の違う要求も 401
     ・グループで @ で呼ばれた発言には、hearing の返事の文をそのまま返す(reply API)
     ・グループで呼ばれていない発言には返さない(取り込みはする)
     ・hearing の返事が空なら返さない

   node workers/hs-kira-line/group_reply_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hskl-"));
fs.copyFileSync(path.join(HERE, "src", "worker.js"), path.join(TMP, "worker.mjs"));
const W = (await import(path.join(TMP, "worker.mjs"))).default;

let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const SECRET = "test-channel-secret";
const GID = "C" + "a".repeat(32);
const UID = "U" + "b".repeat(32);
function makeEnv() {
  const kv = new Map();
  return {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: "U" + "c".repeat(32), KIRA_BRIDGE_KEY: "bk", ANTHROPIC_API_KEY: "test-not-a-key",
    SEEN_STORE: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async () => ({ keys: [] }),
    },
  };
}
function sign(body) { return crypto.createHmac("sha256", SECRET).update(body).digest("base64"); }
async function send(env, events, opts) {
  const body = JSON.stringify({ events });
  const headers = { "content-type": "application/json" };
  if (!(opts && opts.noSig)) headers["x-line-signature"] = (opts && opts.badSig) ? "AAAA" : sign(body);
  const waits = [];
  const res = await W.fetch(new Request("https://x/webhook", { method: "POST", headers, body }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
let calls = [];
let bridgeReply = "ご回答ありがとうございます。いただいた内容は担当の大賀が確認し、掲載に反映します。";
let llmOut = null;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(JSON.stringify({ ok: true, reply: bridgeReply }), { status: 200 });
  if (u.includes("api.anthropic.com") && llmOut !== null) return new Response(JSON.stringify({ content: [{ type: "text", text: llmOut }] }), { status: 200 });
  return new Response("{}", { status: 200 });
};
const groupMsg = (text, mention) => ({
  type: "message", replyToken: "rt_group", source: { type: "group", groupId: GID, userId: UID },
  message: Object.assign({ type: "text", id: "1", text }, mention ? { mention: { mentionees: [{ index: 0, length: 15, type: "user", isSelf: true }] } } : {}),
});
const replies = () => calls.filter((c) => c.url.includes("/v2/bot/message/reply"));
const bridges = () => calls.filter((c) => c.url.includes("/kira-bridge"));

console.log("\n1) 署名の門");
{
  calls = [];
  const r1 = await send(makeEnv(), [groupMsg("@HORIZON SHIELD テスト", true)], { noSig: true });
  check("署名が無ければ 401", r1.status === 401, String(r1.status));
  check("署名が無い要求は hearing に何も流さない", bridges().length === 0);
  const r2 = await send(makeEnv(), [groupMsg("@HORIZON SHIELD テスト", true)], { badSig: true });
  check("署名が違えば 401", r2.status === 401, String(r2.status));
  const env3 = makeEnv(); delete env3.LINE_CHANNEL_SECRET;
  const r3 = await send(env3, [groupMsg("@HORIZON SHIELD テスト", true)]);
  check("鍵が無い設定なら 401(通さない)", r3.status === 401, String(r3.status));
}

console.log("\n2) グループで @ で呼ばれた答え(mention.isSelf)");
{
  calls = [];
  const r = await send(makeEnv(), [groupMsg("@HORIZON SHIELD\n設問\n↓\n答えです", true)]);
  check("200", r.status === 200, String(r.status));
  check("hearing に渡した", bridges().length === 1);
  check("hearing に groupId を渡した", bridges()[0] && bridges()[0].body && bridges()[0].body.groupId === GID);
  check("グループに返事を返した(reply API)", replies().length === 1, String(replies().length));
  const txt = replies()[0] && replies()[0].body && replies()[0].body.messages[0].text;
  check("返した文は hearing の窓口の文そのまま", txt === bridgeReply, txt);
  check("replyToken を使った(push ではない)", replies()[0] && replies()[0].body.replyToken === "rt_group");
}

console.log("\n3) mention の印が無くても、本文が @HORIZON SHIELD で始まれば呼ばれたとみる");
{
  calls = [];
  await send(makeEnv(), [groupMsg("@HORIZON SHIELD 受け取りました", false)]);
  check("返事を返した", replies().length === 1);
}

console.log("\n4) 呼ばれていないグループ発言には返さない(取り込みはする)");
{
  calls = [];
  await send(makeEnv(), [groupMsg("森下さん、明日の現場よろしくです", false)]);
  check("hearing には渡す", bridges().length === 1);
  check("グループには返さない", replies().length === 0, String(replies().length));
}

console.log("\n5) hearing の返事が空なら、呼ばれていても返さない");
{
  calls = []; bridgeReply = "";
  await send(makeEnv(), [groupMsg("@HORIZON SHIELD こんにちは", true)]);
  check("返さない", replies().length === 0);
  bridgeReply = "ok";
}

const pushes = () => calls.filter((c) => c.url.includes("/v2/bot/message/push"));
const quoteMsg = (text) => ({
  type: "message", replyToken: "rt_quote", source: { type: "group", groupId: GID, userId: UID },
  message: { type: "text", id: "2", text, quotedMessageId: "600000000000000001" },
});

console.log("\n6) @ が無い「引用で返信」(2026-10-04 森下さんの了承の返事)");
{
  calls = []; bridgeReply = "ご回答ありがとうございます。いただいた内容は担当の大賀が確認し、掲載に反映します。";
  const morishita = "お世話になっております。\n\n1については問題ございません。\n\n2については、金額についてはm単価との認識で問題ございません。\n\nただ、記載内容について、職人さんによっても異なることもあり、一例に過ぎないため";
  await send(makeEnv(), [quoteMsg(morishita)]);
  check("hearing には渡す(取り込みは従来どおり)", bridges().length === 1);
  check("グループに受け取りの一言を返した", replies().length === 1, String(replies().length));
  const txt = replies()[0] && replies()[0].body && replies()[0].body.messages[0].text;
  check("返した文は受け取りの一言で、hearing の定型(掲載に反映)ではない", !!txt && txt.includes("大賀") && !txt.includes("反映"), txt);
  check("大賀に本文を知らせた(push)", pushes().length === 1, String(pushes().length));
  const pt = pushes()[0] && pushes()[0].body && pushes()[0].body.messages[0].text;
  check("知らせに引用返信の印と本文が入る", !!pt && pt.includes("引用で返信") && pt.includes("m単価"), pt && pt.slice(0, 40));
  check("知らせの宛先は LINE_USER_ID", pushes()[0] && pushes()[0].body.to === "U" + "c".repeat(32));
}

console.log("\n7) @ で呼ばれ hearing が返事を作った発言は、その文を返し、夜のまとめに入れる(即時の知らせは出さない)");
{
  calls = []; bridgeReply = "ok";
  const env = makeEnv();
  await send(env, [groupMsg("@HORIZON SHIELD 質問です", true)]);
  check("返事を返した", replies().length === 1);
  check("即時の知らせは出さない(LINE の送信数を使わない)", pushes().length === 0, String(pushes().length));
  const dg = JSON.parse((await env.SEEN_STORE.get("kira_digest:" + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))) || "[]");
  check("まとめに 1 件入った", dg.length === 1 && dg[0].kind === "hearing", String(dg.length));
}

console.log("\n8) 加盟店グループでない所の、呼ばれず引用でもない発言は、返さず知らせもしない");
{
  calls = [];
  await send(makeEnv(), [groupMsg("森下さん、明日の現場よろしくです", false)]);
  check("返さない", replies().length === 0);
  check("知らせない", pushes().length === 0, String(pushes().length));
}

console.log("\n9) 加盟店グループでは、@ も引用も無い発言も大賀に知らせる(グループには返さない)");
{
  calls = [];
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  await send(env, [groupMsg("1については問題ございません。2については m 単価との認識で問題ございません。", false)]);
  check("グループには返さない", replies().length === 0, String(replies().length));
  check("大賀に知らせた", pushes().length === 1, String(pushes().length));
  const pt = pushes()[0] && pushes()[0].body && pushes()[0].body.messages[0].text;
  check("知らせにグループでの発言の印", !!pt && pt.includes("グループでの発言"), pt && pt.slice(0, 30));
}

console.log("\n10) 加盟店グループでも、社内の人への一言(@森下 …)は知らせない");
{
  calls = [];
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  await send(env, [groupMsg("@森下 真也 明日以後宜しくです!", false)]);
  check("知らせない(本文の @)", pushes().length === 0, String(pushes().length));
  calls = [];
  const ev = groupMsg("@堤 よろしく", false); ev.message.mention = { mentionees: [{ index: 0, length: 2, type: "user", isSelf: false }] };
  await send(env, [ev]);
  check("知らせない(mention の先頭が他の人)", pushes().length === 0, String(pushes().length));
}

const llmCalls = () => calls.filter((c) => c.url.includes("api.anthropic.com"));
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

console.log("\n11) 引用での返信に KIRA が自分で返す。決めてはいけない話は大賀に回し、経験帳に書く");
{
  calls = []; bridgeReply = "";
  llmOut = JSON.stringify({ action: "escalate", reply: "森下さん、ご確認ありがとうございます。数字は一例として幅で書く形に直す件、承知しました。確認して、担当の大賀からあらためてお返事します。", reason: "記事の掲載内容の確定", lessons: [
    { scope: "partner", text: "森下さんは原価に近い数字が社名と出るのを嫌う。数字は一例として幅で書く" },
    { scope: "global", text: "相手の心配をまず認めてから、言われた書き方に直す" },
    { scope: "global", text: "手間は 850 円から 1200 円" } ] });
  const env = makeEnv();
  await send(env, [quoteMsg("ただ、記載内容について、一例に過ぎないため幅で書いてください")]);
  check("KIRA に考えさせた", llmCalls().length === 1, String(llmCalls().length));
  const txt = replies()[0] && replies()[0].body.messages[0].text;
  check("KIRA の文をグループに返した", !!txt && txt.includes("大賀から"), txt && txt.slice(0, 20));
  check("大賀に判断が要ると知らせた", pushes().length === 1 && pushes()[0].body.messages[0].text.includes("判断が要る"), String(pushes().length));
  const own = JSON.parse((await env.SEEN_STORE.get("kira_lessons:" + GID)) || "[]");
  const glob = JSON.parse((await env.SEEN_STORE.get("kira_lessons:global")) || "[]");
  check("店の覚え書きはその店の中に入った", own.some((l) => l.t.includes("森下さん")));
  check("数字の入った覚え書きは全体に上げず、店の中に入った", own.some((l) => l.t.includes("850")) && !glob.some((l) => l.t.includes("850")));
  check("数字の無い話し方は全体に入った", glob.some((l) => l.t.includes("心配をまず認め")));
  const conv = JSON.parse((await env.SEEN_STORE.get("kira_gconv:" + GID)) || "[]");
  check("会話に加盟店の発言と KIRA の返事が残った", conv.length === 2 && conv[0].who === "member" && conv[1].who === "kira", String(conv.length));
}

console.log("\n12) 加盟店グループの雑談は KIRA が黙ると決めたら黙る");
{
  calls = []; llmOut = JSON.stringify({ action: "silent", reply: "", reason: "社内のやり取り", lessons: [] });
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  await send(env, [groupMsg("明日は 9 時集合でお願いします", false)]);
  check("KIRA に考えさせた", llmCalls().length === 1);
  check("返さない", replies().length === 0, String(replies().length));
  check("知らせない", pushes().length === 0, String(pushes().length));
}

console.log("\n13) 加盟店グループで KIRA が返せる話は返し、夜のまとめに入れる");
{
  calls = []; llmOut = JSON.stringify({ action: "reply", reply: "ありがとうございます。いただいた半田市の事例は記事の下書きに使わせていただきます。", reason: "", lessons: [] });
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  await send(env, [groupMsg("半田市の件、写真も送れます", false)]);
  check("返した", replies().length === 1);
  check("即時の知らせは出さない", pushes().length === 0);
  const dg = JSON.parse((await env.SEEN_STORE.get("kira_digest:" + today())) || "[]");
  check("まとめに入った", dg.length === 1 && dg[0].kind === "reply");
}

console.log("\n14) KIRA に渡す資料: その店の覚え書きは入り、他の店の覚え書きは入らない");
{
  calls = []; llmOut = JSON.stringify({ action: "silent", reply: "", reason: "", lessons: [] });
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  await env.SEEN_STORE.put("kira_lessons:" + GID, JSON.stringify([{ t: "この店の覚え書きA" }]));
  await env.SEEN_STORE.put("kira_lessons:Cother", JSON.stringify([{ t: "他の店の原価B" }]));
  await send(env, [groupMsg("こんにちは", false)]);
  const sent = llmCalls()[0] && JSON.stringify(llmCalls()[0].body);
  check("その店の覚え書きを渡した", !!sent && sent.includes("この店の覚え書きA"));
  check("他の店の覚え書きは渡さない", !!sent && !sent.includes("他の店の原価B"));
}

console.log("\n15) KIRA が考えられなかったら黙らない(引用なら受け取りの一言、大賀へ知らせ)");
{
  calls = []; llmOut = "考え中です";
  await send(makeEnv(), [quoteMsg("了解です")]);
  const txt = replies()[0] && replies()[0].body.messages[0].text;
  check("受け取りの一言を返した", !!txt && txt.includes("担当の大賀"));
  check("大賀に知らせた", pushes().length === 1 && pushes()[0].body.messages[0].text.includes("作れなかった"));
}

console.log("\n16) 大賀さんの 1 対 1 の経験帳の口(おぼえて / 経験帳 / わすれて)。他の人には効かない");
{
  const env = makeEnv();
  const owner = (text) => ({ type: "message", replyToken: "rt_o", source: { type: "user", userId: "U" + "c".repeat(32) }, message: { type: "text", id: "9", text } });
  calls = []; llmOut = null;
  await send(env, [owner("おぼえて 見積もりの話では必ず出典を添える")]);
  let glob = JSON.parse((await env.SEEN_STORE.get("kira_lessons:global")) || "[]");
  check("おぼえて: 全体に足した", glob.length === 1 && glob[0].by === "owner");
  check("おぼえて: 返事をした", replies().length === 1 && replies()[0].body.messages[0].text.includes("足しました"));
  calls = [];
  await send(env, [owner("経験帳")]);
  check("経験帳: 一覧を返した", replies().length === 1 && replies()[0].body.messages[0].text.includes("出典を添える"));
  calls = [];
  await send(env, [owner("わすれて 1")]);
  glob = JSON.parse((await env.SEEN_STORE.get("kira_lessons:global")) || "[]");
  check("わすれて: 消した", glob.length === 0);
  calls = [];
  const other = { type: "message", replyToken: "rt_x", source: { type: "user", userId: UID }, message: { type: "text", id: "10", text: "おぼえて 他社の悪口を書く" } };
  await send(env, [other]);
  glob = JSON.parse((await env.SEEN_STORE.get("kira_lessons:global")) || "[]");
  check("大賀さん以外の「おぼえて」は経験帳に入らない", glob.length === 0);
}

console.log("\n17) 夜のまとめは 21 時台に 1 回だけ大賀へ");
{
  const env = makeEnv();
  const realNow = Date.now;
  const t21 = Date.parse("2026-10-05T12:30:00Z"); // 21:30 JST
  Date.now = () => t21;
  await env.SEEN_STORE.put("kira_digest:2026-10-05", JSON.stringify([{ kind: "reply", in: "半田市の件", out: "ありがとうございます" }]));
  calls = [];
  const waits = []; await W.scheduled({}, env, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
  const p1 = calls.filter((c) => c.url.includes("/push") && c.body && String(c.body.messages[0].text).includes("今日の加盟店")).length;
  calls = [];
  const waits2 = []; await W.scheduled({}, env, { waitUntil: (p) => waits2.push(p) }); await Promise.all(waits2);
  const p2 = calls.filter((c) => c.url.includes("/push") && c.body && String(c.body.messages[0].text).includes("今日の加盟店")).length;
  Date.now = () => Date.parse("2026-10-05T03:00:00Z"); // 12:00 JST
  await env.SEEN_STORE.put("kira_digest:2026-10-05", JSON.stringify([{ kind: "reply", in: "x", out: "y" }]));
  calls = [];
  const waits3 = []; await W.scheduled({}, env, { waitUntil: (p) => waits3.push(p) }); await Promise.all(waits3);
  const p3 = calls.filter((c) => c.url.includes("/push") && c.body && String(c.body.messages[0].text).includes("今日の加盟店")).length;
  Date.now = realNow;
  check("21 時台に 1 通送った", p1 === 1, String(p1));
  check("同じ日に 2 通目は送らない", p2 === 0, String(p2));
  check("21 時台以外は送らない", p3 === 0, String(p3));
}

console.log("\n18) 大賀さん本人がグループに書いた発言には KIRA は返さない");
{
  calls = []; llmOut = JSON.stringify({ action: "reply", reply: "x", reason: "", lessons: [] });
  const env = makeEnv(); await env.SEEN_STORE.put("groupPartner:" + GID, "1");
  const ev = groupMsg("森下さん、記事を直しました", false); ev.source.userId = "U" + "c".repeat(32);
  await send(env, [ev]);
  check("KIRA に考えさせない", llmCalls().length === 0, String(llmCalls().length));
  check("返さない", replies().length === 0);
}

const EXPECT = 57;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) { console.log("  NG   試験がまるごと走っていません。"); fail++; }
console.log(fail ? fail + " 件 失敗" : "グループの返事と署名の門 すべて通過");
process.exit(fail ? 1 : 0);
