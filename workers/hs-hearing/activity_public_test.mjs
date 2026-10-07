// hs-hearing: 公開の活動フィードに内部の作業の行と店の内部番号が出ないことを確かめる。
//
// なぜ在るか (2026-10-07)。
// /activity.json に「返事待ちの詰まりを解きました(kira-wbbk99p9 直近1波を残す)」が出ていた。
// kira-wbbk99p9 は建設業ではないお客様(訪問看護)の内部番号で、Yakumo の名簿は建設業だけ。
// 下の FEED は 2026-10-07 に /activity.json が実際に返した並び(新しい順)。
//
// 走らせ方: node activity_public_test.mjs
import { activityPublic, activityCollapse } from "./src/autopilot.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("NG   " + name + (detail !== undefined ? "  " + detail : "")); }
};

const FEED = [
  { type: "answered", member_no: "No.002", text: "ミネオトーヨー住器株式会社 がヒアリングに回答しました(完成度 85%)" },
  { type: "published", member_no: "No.002", text: "加盟店の紹介ページを11枚 検証通過のうえ公開しました" },
  { type: "published", member_no: "No.001", text: "加盟店の紹介ページを11枚 検証通過のうえ公開しました" },
  { type: "answered", member_no: "No.001", text: "リフォーム職人株式会社 がヒアリングに回答しました(完成度 85%)" },
  { type: "estimate", member_no: "No.001", text: "リフォーム職人株式会社 が審査用の見積を送付(蓄積 3件)" },
  { type: "verified", member_no: "No.001", text: "リフォーム職人株式会社 が適正価格の第三者検証(KIRA自動)を通過しました" },
  { type: "estimate_file", member_no: "No.001", text: "リフォーム職人株式会社 から見積書が届きました(用紙 / 未読6件)" },
  { type: "unstick", member_no: null, text: "返事待ちの詰まりを解きました(hs-partner-001 直近1波を残す)" },
  { type: "regenerate", member_no: null, text: "頁の生成をやり直しました(hs-partner-002 完成度74%)" },
  { type: "regenerate", member_no: null, text: "頁の生成をやり直しました(hs-partner-001 完成度67%)" },
  { type: "unstick", member_no: null, text: "返事待ちの詰まりを解きました(kira-wbbk99p9 直近1波を残す)" },
  { type: "unstick", member_no: null, text: "返事待ちの詰まりを解きました(hs-partner-002 直近1波を残す)" },
  { type: "tick", member_no: null, text: "自動運用エージェントが巡回しました(対象 3店)" },
  { type: "hearing_mode", member_no: null, text: "初回ヒアリングが終わったので、継続ヒアリングに切り替えました(kira-abc123)" },
  { type: "onboard", member_no: null, text: "訪問看護 のヒアリングが始まりました" },
  { type: "note", member_no: null, text: "運営からのお知らせ" },
  { type: "note", member_no: null, text: "手で書いた行に kira-zz9 が混ざった場合" },
];

const out = activityPublic(activityCollapse(FEED));
t("内部の作業(unstick, regenerate, tick, hearing_mode, onboard)は出ない",
  !out.some((x) => ["unstick", "regenerate", "tick", "hearing_mode", "onboard"].includes(x.type)), JSON.stringify(out.map((x) => x.type)));
t("店の内部番号は文言に出ない", !out.some((x) => /kira-|hs-partner-/.test(x.text)));
t("建設業以外の業種名は出ない", !out.some((x) => /訪問看護/.test(x.text)));
t("加盟店の公開の行は7行とも残る", out.filter((x) => x.member_no).length === 7, String(out.filter((x) => x.member_no).length));
t("運営のお知らせ(note)は残る", out.some((x) => x.type === "note" && x.text === "運営からのお知らせ"));
t("並びは元の順のまま", out.map((x) => x.text).join("|") === FEED.filter((x) => out.includes(x)).map((x) => x.text).join("|"));
t("空や壊れた入力でも落ちない", activityPublic(null).length === 0 && activityPublic([null, 1, "x", {}]).length === 0);

console.log(fail ? "NG: " + fail + " failed, " + pass + " passed" : "全部 通過 (activity_public_test, " + pass + " 件)");
process.exit(fail ? 1 : 0);
