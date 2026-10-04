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
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_TOKEN: "tok", LINE_USER_ID: "U" + "c".repeat(32), KIRA_BRIDGE_KEY: "bk",
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
globalThis.fetch = async (url, init) => {
  const u = String(url);
  let body = null; try { body = JSON.parse((init && init.body) || "null"); } catch (_e) { body = null; }
  calls.push({ url: u, body });
  if (u.includes("/kira-bridge")) return new Response(JSON.stringify({ ok: true, reply: bridgeReply }), { status: 200 });
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

console.log("\n7) @ で呼ばれた発言も、大賀に知らせる");
{
  calls = []; bridgeReply = "ok";
  await send(makeEnv(), [groupMsg("@HORIZON SHIELD 質問です", true)]);
  check("返事を返した", replies().length === 1);
  check("大賀に知らせた", pushes().length === 1, String(pushes().length));
}

console.log("\n8) 呼ばれず引用でもない発言は、返さず知らせもしない");
{
  calls = [];
  await send(makeEnv(), [groupMsg("森下さん、明日の現場よろしくです", false)]);
  check("返さない", replies().length === 0);
  check("知らせない", pushes().length === 0, String(pushes().length));
}

const EXPECT = 24;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) { console.log("  NG   試験がまるごと走っていません。"); fail++; }
console.log(fail ? fail + " 件 失敗" : "グループの返事と署名の門 すべて通過");
process.exit(fail ? 1 : 0);
