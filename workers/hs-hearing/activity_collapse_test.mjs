// hs-hearing: 活動フィードで、同じ店の同じ種類の記録が1行にまとまることを確かめる。
//
// なぜ在るか (2026-10-07)。
// モールの「YAKUMO NOW」に「ミネオトーヨー住器株式会社 がヒアリングに回答しました」が
// 6行並んだ。activityAdd は回答のたびに1行積み、activityList はそのまま返していた。
// 下の FEED は 2026-10-07 に /activity.json が実際に返した並び(新しい順)。
//
// 走らせ方: node activity_collapse_test.mjs
import { activityCollapse, activityAdd, activityList } from "./src/autopilot.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const A2 = (pct, at) => ({ type: "answered", member_no: "No.002", text: "ミネオトーヨー住器株式会社 がヒアリングに回答しました(完成度 " + pct + "%)", at });
const A1 = (at) => ({ type: "answered", member_no: "No.001", text: "リフォーム職人株式会社 がヒアリングに回答しました(完成度 85%)", at });
const P = (no, at) => ({ type: "published", member_no: no, text: "加盟店の紹介ページを11枚 検証通過のうえ公開しました", at });
const FEED = [
  A2(85, "2026-10-05T05:35:15.841Z"), A2(85, "2026-10-05T05:35:08.877Z"), P("No.002", "2026-10-05T05:34:33.549Z"),
  A2(85, "2026-10-05T05:33:32.784Z"), A2(85, "2026-10-05T05:33:21.883Z"), A2(85, "2026-10-05T05:33:01.596Z"),
  A2(85, "2026-10-05T05:31:06.489Z"), P("No.002", "2026-10-05T05:30:38.844Z"), A2(82, "2026-10-05T05:27:10.753Z"),
  P("No.001", "2026-10-04T22:47:10.671Z"), A1("2026-10-04T22:43:45.206Z"), P("No.002", "2026-10-01T03:20:18.895Z"),
  A2(81, "2026-10-01T03:17:11.012Z"), A1("2026-09-30T11:05:29.899Z"), A1("2026-09-30T01:58:00.264Z"),
  P("No.001", "2026-09-27T03:14:37.243Z"), A1("2026-09-27T03:11:27.485Z"), A1("2026-09-25T05:03:22.648Z"),
];

/* ---------------------------------------------- 1. 実際の並びを畳む */
const c = activityCollapse(FEED);
t("18行が4行になる", c.length === 4, "got " + c.length);
const keys = c.map((x) => x.type + "|" + x.member_no);
t("店と種類の組は一つずつ", new Set(keys).size === keys.length);
t("残るのは各組の一番新しい行", c[0].at === "2026-10-05T05:35:15.841Z" && c[1].at === "2026-10-05T05:34:33.549Z"
  && c[2].at === "2026-10-04T22:47:10.671Z" && c[3].at === "2026-10-04T22:43:45.206Z", JSON.stringify(c.map((x) => x.at)));
t("並びは新しい順のまま", c.every((x, i) => i === 0 || c[i - 1].at > x.at));
t("モールが出す先頭6行に同じ店の同じ種類が無い", new Set(c.slice(0, 6).map((x) => x.type + "|" + x.member_no)).size === Math.min(6, c.length));
// 「ページ公開」の文言には店名が入らないので、No.001 と No.002 の行は文言だけ見ると同じに見える。
// 店が違う記録は畳まない。ここはそれを固定する。
t("店が違う「ページ公開」は2行のまま残る", c.filter((x) => x.type === "published").length === 2);
t("元の配列は変えない", FEED.length === 18);

/* ---------------------------------------------- 2. 畳んではいけないもの */
t("同じ店でも種類が違えば別の行", activityCollapse([A2(85, "b"), P("No.002", "a")]).length === 2);
t("同じ種類でも店が違えば別の行", activityCollapse([A2(85, "b"), A1("a")]).length === 2);
const N = (text, at) => ({ type: "note", member_no: null, text, at });
t("店番号の無い記録は文言が違えば別の行", activityCollapse([N("お知らせ1", "b"), N("お知らせ2", "a")]).length === 2);
t("店番号の無い記録は種類と文言が同じなら1行", activityCollapse([N("お知らせ1", "b"), N("お知らせ1", "a")]).length === 1);
t("店番号ありと無しは混ぜない", activityCollapse([{ type: "note", member_no: "No.001", text: "x", at: "b" }, N("x", "a")]).length === 2);

/* ---------------------------------------------- 3. 壊れた入力 */
t("配列でなければ空", activityCollapse(null).length === 0 && activityCollapse("x").length === 0);
t("null の要素は捨てる", activityCollapse([null, A1("a"), undefined, 3]).length === 1);

/* ---------------------------------------------- 4. KV を通した読み書き */
const store = new Map();
const env = { HS_HEARING_KV: {
  async get(k, kind) { const v = store.get(k); return v == null ? null : (kind === "json" ? JSON.parse(v) : v); },
  async put(k, v) { store.set(k, v); },
} };
for (let i = 0; i < 5; i++) await activityAdd(env, { type: "answered", member_no: "No.002", text: "回答 " + i });
await activityAdd(env, { type: "published", member_no: "No.002", text: "公開" });
await activityAdd(env, { type: "answered", member_no: "No.001", text: "回答" });
const raw = JSON.parse(store.get("activity:index"));
t("KV には書いた分がそのまま残る(記録は消さない)", raw.length === 7, "got " + raw.length);
const l = await activityList(env, 30);
t("activityList は3行を返す", l.length === 3, "got " + l.length);
t("No.002 の回答は最後に書いた1行", l.find((x) => x.type === "answered" && x.member_no === "No.002").text === "回答 4");
t("n は畳んだ後に効く", (await activityList(env, 2)).length === 2);
store.set("activity:index", JSON.stringify(FEED));
const l6 = (await activityList(env, 30)).filter((x) => x.type !== "tick").slice(0, 6);
t("/activity.json と同じ手順で先頭6行に重複なし", l6.length === 4 && new Set(l6.map((x) => x.type + "|" + x.member_no)).size === 4);

/* ---------------------------------------------- 5. 畳む前の版では落ちること */
const before = FEED.slice(0, 6);
t("畳まなければ先頭6行に同じ行が出る(この試験が見ている不具合)", new Set(before.map((x) => x.type + x.text)).size < before.length);

console.log("\nactivity_collapse_test: " + pass + " ok, " + fail + " NG");
process.exit(fail ? 1 : 0);
