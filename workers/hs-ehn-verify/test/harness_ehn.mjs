/**
 * hs-ehn-verify v2 の試験。Workers AI は偽物(env.AI.run が決まった返事をする)。
 *   node test/harness_ehn.mjs
 */
import worker from "../src/verify.js";
import { EHN_POLICY, ehnExtractors, PROMPTS } from "../src/ehn_policy.js";

let pass = 0;
const fails = [];
const check = (name, cond, detail) => { if (cond) pass++; else fails.push(name + (detail ? "  " + detail : "")); };

const TOKEN = "ehn_" + "z".repeat(40);
const RAW = "神奈川県平塚市 外壁塗装の見積もり。御見積金額 1,280,000円(税込)。担当 090-1234-5678";
const GOOD = { amount: 1280000, region: "神奈川県", genre: "外壁塗装", title: "外壁塗装の見積もり",
  source_spans: { amount: "1,280,000円", region: "神奈川県", genre: "外壁塗装", title: "外壁塗装の見積もり" } };

/** 返事の作り方: (system, user, model) => object | string */
function aiEnv(reply, extra = {}) {
  const calls = [];
  return { calls, env: { TORNADO_TOKEN: TOKEN, ...extra, AI: { run: async (model, opts) => { calls.push({ model, opts }); return { response: reply(opts.messages[0].content, opts.messages[1].content, model) }; } } } };
}
async function post(env, raw, token = TOKEN) {
  const req = new Request("https://hs-ehn-verify/verify-dryrun", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ raw }) });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

let res = await worker.fetch(new Request("https://hs-ehn-verify/healthz"), {});
let h = await res.json();
check("healthz は公開のまま、門と方針の版を出す", res.status === 200 && h.gate === "tornado-v2.0.0" && h.policy === "ehn-contribution@2.0.0" && h.mode === "dry-run", JSON.stringify(h));

let a = aiEnv(() => GOOD);
let r = await post(a.env, RAW);
check("正しい寄与は adopt(dry-run の注記つき)", r.status === 200 && r.body.decision === "adopt" && r.body.mode === "dry-run" && /DRY-RUN/.test(r.body.note), JSON.stringify(r.body.reasons));
check("3 本とも呼ばれ、temperature 0", a.calls.length === 3 && a.calls.every((c) => c.opts.temperature === 0));
check("3 本は違う指示文", new Set(a.calls.map((c) => c.opts.messages[0].content)).size === 3);
check("監査に指示文の sha256 が 3 つ", r.body.audit.extractors.length === 3 && new Set(r.body.audit.extractors.map((e) => e.prompt_sha256)).size === 3);

a = aiEnv(() => "```json\n" + JSON.stringify(GOOD) + "\n```");
r = await post(a.env, RAW);
check("コードフェンス付きの返事も読む", r.body.decision === "adopt", JSON.stringify(r.body.reasons));

a = aiEnv(() => ({ ...GOOD, amount: "128万円", source_spans: { ...GOOD.source_spans, amount: "128万円" } }));
r = await post(a.env, "神奈川県 外壁塗装の見積もり 御見積金額 128万円");
check("万円表記の金額で adopt", r.body.decision === "adopt" && r.body.agreed.amount === 1280000, JSON.stringify(r.body.reasons));

a = aiEnv(() => ({ ...GOOD, region: "大阪府" }));
r = await post(a.env, RAW);
check("v1 で通った捏造地域は reject", r.body.decision === "reject", JSON.stringify(r.body.reasons));
a = aiEnv(() => ({ ...GOOD, amount: 12345678, source_spans: { ...GOOD.source_spans, amount: "1,280,000円" } }));
r = await post(a.env, RAW);
check("v1 で通った捏造金額は reject", r.body.decision === "reject", JSON.stringify(r.body.reasons));
a = aiEnv(() => ({ ...GOOD, amount: 12345678, source_spans: { ...GOOD.source_spans, amount: "1234-5678" } }));
r = await post(a.env, RAW);
check("電話番号から作った金額は reject", r.body.decision === "reject", JSON.stringify(r.body.reasons));

a = aiEnv((sys) => (sys === PROMPTS[2] ? { ...GOOD, amount: 999999 } : GOOD));
r = await post(a.env, RAW);
check("3 本目だけ捏造なら escalate", r.body.decision === "escalate", JSON.stringify(r.body.reasons));

r = await post({ TORNADO_TOKEN: TOKEN }, RAW);
check("AI が無ければ reject(fail-closed)", r.body.decision === "reject" && r.body.reasons.includes("extractor_unavailable"), JSON.stringify(r.body.reasons));
a = aiEnv(() => "not json at all");
r = await post(a.env, RAW);
check("返事が JSON でなければ reject", r.body.decision === "reject", JSON.stringify(r.body.reasons));

a = aiEnv(() => GOOD);
r = await post(a.env, RAW, null);
check("鍵なしは 401", r.status === 401);
r = await post({ AI: a.env.AI }, RAW);
check("秘密が未設定なら 503", r.status === 503);
check("鍵なしでは AI を 1 回も呼ばない(費用を燃やさせない)", a.calls.length === 0);

a = aiEnv(() => GOOD, { EXTRACT_MODELS: "@cf/m1, @cf/m2 ,@cf/m3" });
r = await post(a.env, RAW);
check("EXTRACT_MODELS で別モデルを並べられる", a.calls.map((c) => c.model).join() === "@cf/m1,@cf/m2,@cf/m3");

const logs = [];
const orig = console.log;
console.log = (...x) => logs.push(x.join(" "));
a = aiEnv(() => GOOD);
await post(a.env, RAW);
console.log = orig;
const L = logs.join("\n");
check("ログに原文も値も出さない", L.includes("ehn-verify dry-run") && !L.includes("1,280,000") && !L.includes("090") && !L.includes("外壁"), L);

const ex = await ehnExtractors({});
check("抽出器 3 本、方針の項目 4 つ", ex.length === 3 && EHN_POLICY.fields.length === 4);

console.log("harness_ehn: " + pass + " passed, " + fails.length + " failed");
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
