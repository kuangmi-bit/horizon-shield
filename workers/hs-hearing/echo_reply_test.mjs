/* 加盟店の返事の形(貼った設問 ↓ 答え)を、実物の関数で確かめる。KV は模擬。ネットワークに出ない。

   なぜ要るか (2026-09-30):
     hs-partner-001 の HORIZON グループで、森下さまと堤さまが、こちらの設問を貼って
     「↓」の下に答えてくださった。先頭には @HORIZON SHIELD のメンション。
     これまでは全文をひとかたまりで読み、
       ・値段の話を訊いた設問への答え(材料の値上がり、高いと言われたときの説明)が、
         お金の語で「料金の問い合わせ」とされ、取り込まれずに捨てられた
       ・貼った設問の「教えてください」「大丈夫です」で、答えが「質問」とされ、取り込まれなかった
     ここで次を毎回確かめる。
       ・実文の2通が、どちらも回答として取り込まれる(hearing: と linereply: が書かれる)
       ・返事のログには、貼った設問ごと生の全文が残る
       ・返事の文に「料金・金額については」が出ない(答えた相手に料金の案内を返さない)
       ・こちらへのお金の問い合わせ(掲載料・いくら)は、設問を貼っていても大賀に回る
       ・値段の話を訊いていない時の、お金の語の入った一文は、これまでどおり大賀に回る(門を緩めすぎない)
       ・貼った設問の下が問いの形なら、質問として扱う

   node workers/hs-hearing/echo_reply_test.mjs
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsecho-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js" && !body.includes("export { handlePartnerInbound }")) body += "\nexport { handlePartnerInbound };\n";
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const H = await import(path.join(TMP, "hearing.mjs") + "?v=" + Math.random());
const C = await import(path.join(TMP, "concierge.mjs") + "?v=" + Math.random());
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });

let fail = 0, checks = 0;
function check(label, cond, detail) {
  checks++;
  console.log((cond ? "  ok   " : "  NG   ") + label + (detail ? "  " + detail : ""));
  if (!cond) fail++;
}

const PROFILE = { company: "リフォーム職人株式会社", area: "長久手市", works: ["内装", "クロス張替え"] };
function makeEnv(replyText) {
  const kv = new Map();
  return {
    _kv: kv,
    AI: { run: async (_m, o) => {
      const sys = String((o && o.messages && o.messages[0] && o.messages[0].content) || "");
      if (sys.includes("窓口担当")) return { response: replyText || "ご回答ありがとうございます。掲載に反映いたします。" };
      return { response: JSON.stringify(PROFILE) };
    } },
    HS_HEARING_KV: {
      get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null),
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
      list: async () => ({ keys: [] }),
    },
  };
}
const keys = (env) => [...env._kv.keys()];
const has = (env, pre) => keys(env).some((k) => k.startsWith(pre));
const logText = (env, pre) => { const k = keys(env).find((x) => x.startsWith(pre)); return k ? JSON.parse(env._kv.get(k)).text : ""; };

const SID = "hs-partner-001";
const Q_TAKAI = "施主さまから「他社と比べて高い」と言われたことのある項目はありますか。項目名と、そのときどう説明されたかを教えてください。";
const Q_ZAIRYO = "この1年で、仕入れ値が目に見えて動いた材料はありますか。材料名と、上がったか下がったか、感覚で構いません。";
const Q_CASE = "直近で完了した工事を1件、差し支えない範囲で教えてください(工種・地域・築年数・工夫した点)。そのまま御社の事例ページの素材になります。";
function seed(env, pendingQids, texts) {
  const store = {
    store_id: SID, company: "リフォーム職人株式会社", areas: ["長久手市"], works: ["内装"],
    status: "published", source: "kira-line", industry: "construction", token: "ht_test00000000",
    autopilot: {
      penalty: 0, unanswered_sends: 1, nudges: 0,
      pending: { qids: pendingQids, text: Object.values(texts).join("\n"), asked_texts: texts,
                 waves: [{ qids: pendingQids, texts, sent_at: "2026-09-29T00:00:00Z", kind: "followup" }],
                 sent_at: "2026-09-29T00:00:00Z" },
    },
  };
  env._kv.set("store:" + SID, JSON.stringify(store));
  env._kv.set("hearing:" + SID, JSON.stringify({ store_id: SID, profile: PROFILE }));
  return store;
}

/* 実文(2026-09-30 HORIZON グループ、画面から書き起こし。末尾は画面で切れている所まで) */
const MORISHITA = "@HORIZON SHIELD\n最近、施主様から「他社より高い」と言われた際に、どう説明してご納得いただいたか。一例で構いません。\nこの1年で仕入れ値が目に見えて動いた材料があれば、材料名と、上がったか下がったかを感覚で。\n恐れ入りますが、9月30日(火)までにこのトークへご返信いただけると助かります。\n分かる範囲、途中まででも大丈夫です。1枚の用紙からでも回答できます。\n↓\n高いと言われた場合は、お見積もりの金額の根拠を丁寧にご説明をいたします。\n特に、メールで送りつけるだけでなく、電話や対面にて丁寧に詳細のご説明を行うことを心がけております。\n仕入れ値が変わった材料は、7月から全体的に内装資材の価格は上がっております。\nというのも、中東情勢の影響から、一時クロスや床の糊が仕入れが止まってしまったり、内装業だけでなく、建築業界全体に大きく影響が出る世界情勢となっておりましたので、\nそこを機に、便乗値上げも生じて、資材系は一律値上げされております。\n職人さんの人工や手間代もそれに乗じて上がっている傾向もございます。\n具体的にはクロスm単価が、量産、一品ともに20〜30円ほど上がり、職人単価も手間800円だった方が、850〜900円と値上げ";
const ROLL = "@HORIZON SHIELD\n直近で完了した工事を1件、差し支えない範囲で教えてください(工種・地域・築年数・工夫した点)。そのまま御社の事例ページの素材になります。\n↓\n昨日、完了した工事がありまして、\n工種：ロールスクリーン取付\n地域：愛知県半田市\n築年数：不明(築23年以上ではある)\n工夫した点：お客様がご多忙のため、現地確認等での同行が難しく、事前にご要望を伺っておき、\n現地確認はこちらだけで行い、写真や参考パースなどを用いてイメージのすり合わせを遠隔にて行った。\n詳細のすり合わせとレスポンス早く対応することでお客様との信頼関係を構築できたため、\n正確には、ロールスクリーンの寸法違いがおき、予定の昨日中には工事が収められなかったのだが、\nお客様からなんなくご理解いただき、改めて後日施工日を設けていただくことも了承いただくことができている。\nお客様のご要望をご予算内で、如何に実現させるかが工務店の技量が試されるところですが、そのためには迅速な対応と丁寧な詳細説明がお客様とより円滑に打ち合わせを進めるために重要な動きだと、今回の工事で再認識できました。";

console.log("\n1) splitEchoReply(形の読み分け)");
{
  const a = C.splitEchoReply(MORISHITA);
  check("メンションを検出", a.mentioned === true);
  check("貼った設問を echo に分けた", a.echo.startsWith("最近、施主様から"), a.echo.slice(0, 20));
  check("答えを answer に分けた", a.answer.startsWith("高いと言われた場合は"), a.answer.slice(0, 20));
  check("答えにメンションが残らない", !a.answer.includes("@HORIZON"));
  const b = C.splitEchoReply("@HORIZON SHIELD 受け取りました。来週また送ります。");
  check("矢印が無ければ全文が答え(メンションは外す)", b.echo === "" && b.answer === "受け取りました。来週また送ります。", JSON.stringify(b.answer));
  const c = C.splitEchoReply("設問です\n⬇️\n答えです");
  check("⬇️ の行でも分ける", c.echo === "設問です" && c.answer === "答えです");
  const d = C.splitEchoReply("↓\n答えだけ");
  check("先頭が矢印(前が空)なら分けない", d.echo === "" && d.answer.includes("答えだけ"));
  check("答えの意図: 平叙で終わる → answer", C.answerIntentAfterEcho(a.answer) === "answer");
  check("答えの意図: ？で終わる → question", C.answerIntentAfterEcho("これで足りますか？") === "question");
  check("値段の話を訊いた設問を見分ける", C.askedAboutPrices(Q_TAKAI) && C.askedAboutPrices(Q_ZAIRYO) && !C.askedAboutPrices("営業時間を教えてください"));
  check("答えの中の『価格は上がっております』は料金の問い合わせではない", !C.FEE_INQUIRY_RE.test(a.answer));
  check("『掲載料はいくらですか』は料金の問い合わせ", C.FEE_INQUIRY_RE.test("掲載料はいくらですか"));
}

console.log("\n2) 森下さまの実文(値段の話への答え、設問を貼って ↓)");
{
  const env = makeEnv();
  const store = seed(env, ["q_cn_takai_iwareta", "q_cn_zairyo_ugoki"], { q_cn_takai_iwareta: Q_TAKAI, q_cn_zairyo_ugoki: Q_ZAIRYO });
  const out = await H.handlePartnerInbound(env, SID, store, MORISHITA, "line");
  console.log("     kind=" + out.kind + " 返信: " + String(out.reply).split("\n")[0].slice(0, 60));
  check("料金の問い合わせにしない(kind≠money)", out.kind !== "money", out.kind);
  check("質問にしない(kind≠question)", out.kind !== "question", out.kind);
  check("取り込んだ(linereply: がある)", has(env, "linereply:"), keys(env).join(","));
  check("返事のログは生の全文(貼った設問ごと)", logText(env, "linereply:").includes("最近、施主様から") && logText(env, "linereply:").includes("850〜900円"));
  check("返事に料金の案内が出ない", !String(out.reply).includes("料金・金額については"), out.reply);
  check("返事が空でない", !!String(out.reply || "").trim());
}

console.log("\n3) 同じ実文、返事の文にお金の語が出てしまった場合(機械の返事の門)");
{
  const env = makeEnv("職人単価が850円に上がった件、承知しました。");
  const store = seed(env, ["q_cn_zairyo_ugoki"], { q_cn_zairyo_ugoki: Q_ZAIRYO });
  const out = await H.handlePartnerInbound(env, SID, store, MORISHITA, "line");
  console.log("     kind=" + out.kind + " 返信: " + String(out.reply).split("\n")[0].slice(0, 60));
  check("金額を含む返事は送らない", !/[0-9０-９]\s*円/.test(String(out.reply)), out.reply);
  check("料金の案内にもしない(受領の定型)", !String(out.reply).includes("料金・金額については"), out.reply);
}

console.log("\n4) ロールスクリーンの実文(貼った設問に『教えてください』)");
{
  const env = makeEnv();
  const store = seed(env, ["q_cases"], { q_cases: Q_CASE });
  const out = await H.handlePartnerInbound(env, SID, store, ROLL, "line");
  console.log("     kind=" + out.kind + " 返信: " + String(out.reply).split("\n")[0].slice(0, 60));
  check("質問にしない(kind≠question)", out.kind !== "question", out.kind);
  check("料金の問い合わせにしない", out.kind !== "money", out.kind);
  check("取り込んだ(linereply: がある)", has(env, "linereply:"));
  check("質問棚に積んでいない(partnerq: 無し)", !has(env, "partnerq:"));
  check("『取り違えている可能性』と返さない", !String(out.reply).includes("取り違え"), out.reply);
}

console.log("\n5) 設問を貼っていても、こちらへのお金の問い合わせは大賀へ");
{
  const env = makeEnv();
  const store = seed(env, ["q_cn_zairyo_ugoki"], { q_cn_zairyo_ugoki: Q_ZAIRYO });
  const out = await H.handlePartnerInbound(env, SID, store, "@HORIZON SHIELD\n" + Q_ZAIRYO + "\n↓\nクロスが上がりました。ところで掲載料はいくらですか", "line");
  check("kind は money", out.kind === "money", out.kind);
  check("取り込まない(linereply: 無し)", !has(env, "linereply:"));
  const env2 = makeEnv();
  const store2 = seed(env2, ["q_cn_zairyo_ugoki"], { q_cn_zairyo_ugoki: Q_ZAIRYO });
  const out2 = await H.handlePartnerInbound(env2, SID, store2, "掲載の料金はいくらですか？", "line");
  check("値段の設問が返事待ちでも『掲載の料金はいくら』は money", out2.kind === "money", out2.kind);
}

console.log("\n6) 値段の話を訊いていない時の、お金の語の一文は、これまでどおり大賀へ");
{
  const env = makeEnv();
  const store = seed(env, ["q_hours"], { q_hours: "営業時間と定休日を教えてください。" });
  const out = await H.handlePartnerInbound(env, SID, store, "今月から価格を見直しました", "line");
  check("kind は money(門を緩めすぎない)", out.kind === "money", out.kind);
}

console.log("\n7) 設問を貼った下が問いの形なら、質問として扱う");
{
  const env = makeEnv();
  const store = seed(env, ["q_cases"], { q_cases: Q_CASE });
  const out = await H.handlePartnerInbound(env, SID, store, "@HORIZON SHIELD\n" + Q_CASE + "\n↓\n途中まで書いて止めても大丈夫ですか？", "line");
  check("kind は question", out.kind === "question", out.kind);
  check("窓口が『途中で止めても大丈夫』と答える", String(out.reply).includes("途中で止めても大丈夫"), out.reply);
}

console.log("\n8) 同じ会社の人への一言(9/27 の実文)は、答えにしない");
{
  const env = makeEnv();
  const store = seed(env, ["q_en_recent"], { q_en_recent: Q_CASE });
  const out = await H.handlePartnerInbound(env, SID, store, "@森下 真也 \n明日以後宜しくです！", "line");
  check("kind は aside", out.kind === "aside", out.kind);
  check("返事はしない(空)", out.reply === "", JSON.stringify(out.reply));
  check("取り込まない(linereply: 無し)", !has(env, "linereply:"));
  check("生の文は aside: に残す", has(env, "aside:"));
  const s = JSON.parse(env._kv.get("store:" + SID));
  check("返事待ちは消さない(本当の答えを待つ)", !!(s.autopilot.pending && s.autopilot.pending.qids && s.autopilot.pending.qids.includes("q_en_recent")));
  check("1行の『@森下 真也 宜しくです！』も aside", C.isPersonalAside("@森下 真也 宜しくです！"));
  check("@HORIZON SHIELD 宛ては aside ではない", !C.isPersonalAside("@HORIZON SHIELD 受け取りました"));
  check("同僚への @ の後に長い答えが続くなら aside ではない", !C.isPersonalAside("@森下 真也\n工種：ロールスクリーン取付\n地域：愛知県半田市\n工夫した点：お客様がご多忙のため、写真や参考パースで遠隔ですり合わせた"));
}

const EXPECT = 39;
console.log("\n確かめた数: " + checks + " (最低 " + EXPECT + ")");
if (checks < EXPECT) { console.log("  NG   試験がまるごと走っていません。"); fail++; }
console.log(fail ? fail + " 件 失敗" : "返事の形の読み分け すべて通過");
process.exit(fail ? 1 : 0);
