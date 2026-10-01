/**
 * トルネード v2 (tornado-v2.0.0)
 *
 * 信用できない文章を、構造化された記録に変える場所の門。検証可能性の密度の低い値を外へ振り落とし、
 * 中心には原文までたどれる値だけを残す。
 *
 *   L1 propose   抽出器(信用しない)が値と根拠の文字列を出す。K 本。抽出器に書き込みの力は無い。
 *   L2 ground    値がその根拠の文字列から取れること、根拠の文字列が原文に丸ごとあることを決定論で確かめる。
 *   L3 plausible 型と範囲だけを見る。価格などの参照値は読まない(判定が参照値への近さにならないように)。
 *   L4 decide    純関数。adopt(採用) / reject(却下) / escalate(人が見る)。
 *
 * v1 (hs-ehn-verify 2026-06) からの直し。2026-10-01 に v1 の L2 を直接試し、次の 4 つを確かめた:
 *   1. 根拠の文字列が原文にあれば、値が別物でも通った(根拠は神奈川県、値は大阪府)。→ 値と根拠をつなぐ。
 *   2. 金額は原文の全数字をつなげた列の一部なら通った(日付と電話番号の数字から作った数)。→ 数のかたまりごと照合。
 *   3. 「80万円」の 800000 が落ちた。→ 万・億・千・漢数字・大字を読む。
 *   4. K 回の一致は 1 回目しか接地を見ていなかった。→ K 回すべてを接地させ、一致もその上で見る。
 * 足したもの: 根拠の長さの上限(原文まるごとを根拠にする抜け道を塞ぐ)、根拠に分類が 2 つ入る時は曖昧として落とす、
 * 金額の競合(原文に別の金額があり、選んだ物だけに合計の見出しが付いていなければ人に回す)、指示文の注入の兆し、
 * 監査ハッシュを正規化 JSON で K 回分・抽出器名・指示文の版・方針の版ごと取る、個人情報は鍵付きハッシュ(HMAC)。
 *
 * 守らないもの(門の外で守る):
 *   ・投稿者本人が原文に書いた嘘。原文にある値は接地する。トルネードは「原文に無い値」を落とす門であって、
 *     原文が本当かは判定しない。
 *   ・同じ人の大量投稿(1 件ずつしか見ない)。
 *   ・誰が読めるか(認証と権限)、会社ごとの分離、個人情報の保管と削除。
 */

export const TORNADO_VERSION = "tornado-v2.0.0";

/* ------------------------------------------------------------------ 正規化 */

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

export function canon(s) {
  if (s === null || s === undefined) return "";
  return String(s).normalize("NFKC").replace(INVISIBLE, "");
}
export function noWs(s) { return canon(s).replace(/\s+/g, ""); }
export function normText(s) { return noWs(s).toLowerCase(); }
export function digits(s) { return canon(s).replace(/[^0-9]/g, ""); }

/* ------------------------------------------------------------- 数を読む */

const KDIGIT = { "〇": 0, "零": 0, "一": 1, "壱": 1, "二": 2, "弐": 2, "三": 3, "参": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const KSMALL = { "十": 10, "拾": 10, "百": 100, "千": 1000 };
const KBIG = { "万": 1e4, "億": 1e8 };
const NUM_CHARS = "0-9.,〇零一二三四五六七八九壱弐参拾十百千万億";
const NUM_RUN = new RegExp("[" + NUM_CHARS + "]+", "g");
const HAS_DIGIT = /[0-9〇零一二三四五六七八九壱弐参拾十百千]/;

/** 「800,000」「80万」「1億2,000万」「12.5万」「1,200千」「八十万」「壱百万」を整数に。読めなければ null。 */
export function parseJaNumber(input) {
  const s = canon(input).replace(/,/g, "");
  if (!s || !HAS_DIGIT.test(s)) return null;
  if (/[^0-9.〇零一二三四五六七八九壱弐参拾十百千万億]/.test(s)) return null;
  let total = 0, section = 0, cur = null, lastKind = "";
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (/[0-9.]/.test(ch)) {
      if (lastKind === "arabic" || lastKind === "kdigit") return null;
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const run = s.slice(i, j);
      if ((run.match(/\./g) || []).length > 1 || run.startsWith(".") || run.endsWith(".")) return null;
      cur = Number(run);
      lastKind = "arabic";
      i = j;
      continue;
    }
    if (ch in KDIGIT) {
      if (lastKind === "arabic") return null;
      cur = lastKind === "kdigit" ? cur * 10 + KDIGIT[ch] : KDIGIT[ch];
      lastKind = "kdigit";
    } else if (ch in KSMALL) {
      section += (cur === null ? 1 : cur) * KSMALL[ch];
      cur = null;
      lastKind = "small";
    } else if (ch in KBIG) {
      const part = section + (cur === null ? 0 : cur);
      if (part === 0) return null;
      total += part * KBIG[ch];
      section = 0;
      cur = null;
      lastKind = "big";
    } else {
      return null;
    }
    i++;
  }
  total += section + (cur === null ? 0 : cur);
  if (!Number.isFinite(total) || !Number.isInteger(total) || total <= 0 || total > 1e15) return null;
  return total;
}

/** 数字と単位のあいだの空白だけ詰める(「80 万円」)。数字どうしのあいだの空白は詰めない(別の数を 1 つにしない)。 */
function scanForm(s) {
  return canon(s).replace(/([0-9〇-九壱弐参拾十百千])\s+(?=[万億千百十円])/g, "$1");
}

/** 文中の数のかたまり。読めない物(「十分」の十は読めるので残る、「万一」は読めないので落ちる)は捨てる。 */
export function numberTokens(s) {
  const t = scanForm(s);
  const out = [];
  NUM_RUN.lastIndex = 0;
  let m;
  while ((m = NUM_RUN.exec(t)) !== null) {
    let text = m[0], start = m.index;
    while (/^[.,]/.test(text)) { text = text.slice(1); start++; }
    while (/[.,]$/.test(text)) text = text.slice(0, -1);
    if (!text) continue;
    const value = parseJaNumber(text);
    if (value === null) continue;
    out.push({ text, key: text.replace(/,/g, ""), value, start, end: start + text.length });
  }
  return out;
}

/* --------------------------------------------------------------- 日付を読む */

const ERA = { "令和": 2018, "R": 2018, "平成": 1988, "H": 1988, "昭和": 1925, "S": 1925 };
function validYMD(y, m, d) {
  if (!(y >= 1900 && y <= 2100)) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function ymd(y, m, d) { return validYMD(y, m, d) ? y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0") : ""; }

/** 「2026-10-01」「2026/10/1」「2026年10月1日」「令和8年10月1日」「R8.10.1」を YYYY-MM-DD に。それ以外は "" 。 */
export function parseDate(input) {
  const s = noWs(input);
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(令和|平成|昭和|R|H|S)(\d{1,2}|元)[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/i);
  if (m) return ymd(ERA[m[1].toUpperCase()] + (m[2] === "元" ? 1 : +m[2]), +m[3], +m[4]);
  return "";
}

/* ------------------------------------------------------------ 注入の兆し */

const INJECTION = new RegExp([
  "(以上|上記|前|これまで)の(指示|命令|内容)を?(無視|忘れ)",
  "指示(を|に)(無視|従|変更)",
  "システム(プロンプト|指示|メッセージ)",
  "あなたは.{0,12}(AI|ＡＩ|アシスタント|抽出器|モデル|係)",
  "出力(せよ|しろ|してください)",
  "(金額|amount|region|genre|値)(は|を).{0,10}(とせよ|にせよ|として出力|と出力|にしてください)",
  "ignore (all |the )?(previous|above|prior)",
  "disregard (all |the )?(previous|above|prior)",
  "system prompt",
  "you are (an? )?(ai|assistant|extractor|model)",
  "<\\/?(system|instruction|assistant|tool)[^>]*>",
  "\\b(assistant|system)\\s*:",
  "\"?source_spans\"?\\s*:",
].join("|"), "i");

export function injectionSuspect(raw) { return INJECTION.test(canon(raw)); }

/* -------------------------------------------------------- 正規化 JSON とハッシュ */

export function canonicalJSON(v) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isFinite(v)) return "null";
    return JSON.stringify(v === undefined ? null : v);
  }
  if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(v[k])).join(",") + "}";
}
const enc = new TextEncoder();
function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function sha256Hex(str) { return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(str)))); }
export async function hmacHex(key, str) {
  const k = await crypto.subtle.importKey("raw", enc.encode(String(key)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(String(str))));
}
/** 長さの違いを漏らさない比較(両方とも 64 桁の hex に揃えてから比べる)。 */
export function sameHex(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/* ------------------------------------------------------------- 接地(L2) */

const SPAN_MAX = { amount_jpy: 30, enum: 24, phone: 24, email: 120, date: 24 };

function present(spanCanon, ctx) {
  return ctx.rawCanon.includes(spanCanon) || ctx.rawNoWs.includes(spanCanon.replace(/\s+/g, ""));
}
function emptyVal(v) { return v === null || v === undefined || (typeof v === "string" && v.trim() === ""); }

function groundAmount(value, span, field, ctx) {
  const tokens = numberTokens(span);
  if (tokens.length !== 1) return { ok: false, why: "span_not_one_number" };
  const tok = tokens[0];
  const whole = ctx.rawTokens.filter((t) => t.key === tok.key);
  if (whole.length === 0) return { ok: false, why: "span_cuts_a_number" };
  // 金額は「金額として書かれた数」に限る(後ろに円、前に ¥ か 金、または 万・億 の単位)。電話番号や日付の数を金額にしない。
  if (field.requireMoney !== false && !whole.some((t) => isMoney(t, ctx.rawScan))) return { ok: false, why: "span_not_money" };
  const v = typeof value === "number" ? value : parseJaNumber(String(value).replace(/[円¥￥\s]|税込|税抜/g, ""));
  if (!Number.isInteger(v) || v !== tok.value) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: String(v), value: v, token: tok };
}

function taxonomyHits(text, taxonomy) {
  const t = normText(text);
  const hits = [];
  for (const e of taxonomy) {
    const as = e.aliases.filter((a) => t.includes(normText(a)));
    if (as.length) hits.push({ e, alias: as.sort((a, b) => b.length - a.length)[0] });
  }
  // 長い別名に含まれる短い別名の当たりは数えない(「屋根塗装」の中の「屋根」)
  const kept = hits.filter((h) => !hits.some((o) => o !== h && normText(o.alias).length > normText(h.alias).length && normText(o.alias).includes(normText(h.alias))));
  // 総称(「リフォーム」など generic: true)は、具体的な当たりがあれば数えない(「浴室リフォーム」は浴室)
  return kept.some((h) => !h.e.generic) ? kept.filter((h) => !h.e.generic) : kept;
}
function groundEnum(value, span, field, ctx) {
  // 値は正規の名前か、正規の名前に一意に写る書き方(「浴室リフォーム」は浴室)。写し方は決定論で、根拠の側と同じ規則。
  let entry = field.taxonomy.find((e) => normText(e.canonical) === normText(value));
  if (!entry) {
    const vh = taxonomyHits(value, field.taxonomy);
    if (vh.length === 1 && canon(value).trim().length <= SPAN_MAX.enum) entry = vh[0].e;
  }
  if (!entry) return { ok: false, why: "value_not_in_taxonomy" };
  const hits = taxonomyHits(span, field.taxonomy);
  if (hits.length === 0) return { ok: false, why: "value_not_from_span" };
  if (hits.length > 1) return { ok: false, why: "span_ambiguous" };
  if (hits[0].e !== entry) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: entry.canonical, value: entry.canonical };
}

function groundText(value, span, field) {
  const v = canon(value).replace(/\s+/g, " ").trim();
  if (!v) return { ok: false, why: "empty" };
  if (v.length > (field.maxLen || 80)) return { ok: false, why: "value_too_long" };
  if (!normText(span).includes(normText(v))) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: normText(v), value: v };
}

function boundaryOk(spanCanon, ctx, bad) {
  let i = ctx.rawCanon.indexOf(spanCanon);
  while (i !== -1) {
    const before = ctx.rawCanon[i - 1] || "", after = ctx.rawCanon[i + spanCanon.length] || "";
    if (!bad.test(before) && !bad.test(after)) return true;
    i = ctx.rawCanon.indexOf(spanCanon, i + 1);
  }
  return false;
}
function groundPhone(value, span, field, ctx) {
  const sd = digits(span), vd = digits(value);
  if (!/^0\d{9,10}$/.test(sd)) return { ok: false, why: "span_not_phone" };
  if (/[^0-9()\-\s+]/.test(canon(span).trim())) return { ok: false, why: "span_not_phone" };
  if (!ctx.rawCanon.includes(canon(span).trim()) || !boundaryOk(canon(span).trim(), ctx, /[0-9]/)) return { ok: false, why: "span_cuts_a_number" };
  if (vd !== sd) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: vd, value: vd };
}
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
function groundEmail(value, span, field, ctx) {
  const s = canon(span).trim(), v = canon(value).trim().toLowerCase();
  if (!EMAIL.test(s)) return { ok: false, why: "span_not_email" };
  if (!boundaryOk(s, ctx, /[A-Za-z0-9._%+@-]/)) return { ok: false, why: "span_cuts_an_address" };
  if (v !== s.toLowerCase()) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: v, value: v };
}
function groundDate(value, span) {
  const d = parseDate(span);
  if (!d) return { ok: false, why: "span_not_one_date" };
  const v = parseDate(value);
  if (v !== d) return { ok: false, why: "value_not_from_span" };
  return { ok: true, norm: d, value: d };
}

const GROUNDERS = { amount_jpy: groundAmount, enum: groundEnum, text: groundText, phone: groundPhone, email: groundEmail, date: groundDate };

/** 1 つの項目の L2。値が空なら absent。 */
export function groundField(field, value, span, ctx) {
  if (emptyVal(value)) return { ok: false, why: "absent", absent: true };
  if (emptyVal(span) || typeof span !== "string") return { ok: false, why: "no_span" };
  const sc = canon(span).trim();
  const max = field.type === "text" ? (field.maxLen || 80) + 20 : SPAN_MAX[field.type];
  if (sc.length > max) return { ok: false, why: "span_too_long" };
  if (!present(sc, ctx)) return { ok: false, why: "span_not_in_raw" };
  const g = GROUNDERS[field.type];
  if (!g) return { ok: false, why: "unknown_type" };
  return g(value, sc, field, ctx);
}

export function makeContext(raw) {
  const rawCanon = canon(raw);
  return { rawCanon, rawNoWs: rawCanon.replace(/\s+/g, ""), rawScan: scanForm(raw), rawTokens: numberTokens(raw) };
}

/* -------------------------------------------------------- 金額の競合(L2 の付け足し) */

function isMoney(tok, scan) {
  const after = scan.slice(tok.end, tok.end + 2), before = scan.slice(Math.max(0, tok.start - 1), tok.start);
  return /^\s*円/.test(after) || /[¥￥\\金]$/.test(before) || /[万億]/.test(tok.text);
}
/** 原文に値の違う金額が他にあり、選んだ金額だけに合計の見出しが付いているのでなければ true(人に回す)。 */
export function competingAmount(chosen, field, ctx) {
  const money = ctx.rawTokens.filter((t) => isMoney(t, ctx.rawScan));
  const others = money.filter((t) => t.value !== chosen);
  if (others.length === 0) return false;
  const label = field.totalLabel || /(合計|総額|総計|御?見積(金額|額)|請求(金額|額)|税込(合計|金額)|工事(金額|代金)|契約(金額|額))/;
  const labeled = (t) => label.test(ctx.rawScan.slice(Math.max(0, t.start - 14), t.start));
  const chosenLabeled = money.some((t) => t.value === chosen && labeled(t));
  const otherLabeled = others.some(labeled);
  return !(chosenLabeled && !otherLabeled);
}

/* ------------------------------------------------------------- 妥当性(L3) */

export function plausible(field, value) {
  if (field.type === "amount_jpy") {
    const min = field.min ?? 1, max = field.max ?? 1e12;
    if (!(value >= min)) return "below_min";
    if (!(value <= max)) return "above_max";
  }
  if (field.type === "text" && field.forbid && field.forbid.test(String(value))) return "forbidden_words";
  if (typeof field.check === "function") return field.check(value) || null;
  return null;
}

/* ------------------------------------------------------- 抽出結果の形を切り詰める */

/** 抽出器の返り値を { values, spans } に。{ field, source_spans:{field} } 形と { values, spans } 形の両方を受ける。形の外は捨てる。 */
export function shapeExtraction(obj, policy) {
  const values = {}, spans = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { values, spans };
  const vs = obj.values && typeof obj.values === "object" ? obj.values : obj;
  const ss = obj.spans && typeof obj.spans === "object" ? obj.spans : (obj.source_spans && typeof obj.source_spans === "object" ? obj.source_spans : {});
  for (const f of policy.fields) {
    const v = vs[f.name], s = ss[f.name];
    values[f.name] = typeof v === "string" || typeof v === "number" ? (typeof v === "string" ? v.slice(0, 400) : v) : null;
    spans[f.name] = typeof s === "string" ? s.slice(0, 400) : null;
  }
  return { values, spans };
}

/* ------------------------------------------------------------- 決定(L4) */

/**
 * 純関数。groundedRuns: 抽出器ごとの { ok, error?, fields: { name: groundResult } }。
 * 戻り: { decision, reasons, agreed }
 */
export function decide(policy, runs, flags) {
  const rejects = [], escalates = [], agreed = {};
  const live = runs.filter((r) => r.ok);
  if (live.length === 0) return { decision: "reject", reasons: ["extractor_unavailable"], agreed };
  if (live.length < runs.length) escalates.push("extractor_failed:" + (runs.length - live.length));
  for (const f of policy.fields) {
    const rs = live.map((r) => r.fields[f.name]);
    if (rs.every((g) => g.absent)) {
      if (f.required) rejects.push(f.name + ":absent");
      continue;
    }
    const good = rs.filter((g) => g.ok);
    if (good.length === 0) { rejects.push(f.name + ":" + rs.find((g) => !g.absent)?.why); continue; }
    if (good.length < rs.length) { escalates.push(f.name + ":unstable"); continue; }
    if (f.consensus !== false && !good.every((g) => g.norm === good[0].norm)) { escalates.push(f.name + ":disagree"); continue; }
    const why = plausible(f, good[0].value);
    if (why) { rejects.push(f.name + ":" + why); continue; }
    agreed[f.name] = good[0].value;
  }
  for (const fl of flags) escalates.push(fl);
  if (rejects.length) return { decision: "reject", reasons: rejects, agreed: {} };
  if (escalates.length) return { decision: "escalate", reasons: escalates, agreed };
  return { decision: "adopt", reasons: [], agreed };
}

/* ---------------------------------------------------------------- 本体 */

/**
 * policy: { id, version, fields: [{ name, type, required, consensus, pii, taxonomy, min, max, maxLen, competing, totalLabel, forbid, check }],
 *           maxChars }
 * extractors: [{ id, prompt_sha256?, run: async (raw) => object }]  K = extractors.length
 * opts: { hmacKey }  個人情報の項目がある方針では必須。無ければ投げる(fail-closed)。
 */
export async function runTornado(raw, policy, extractors, opts = {}) {
  if (typeof raw !== "string") throw new TypeError("raw must be a string");
  const max = policy.maxChars || 8000;
  if (raw.length > max) return { v: TORNADO_VERSION, decision: "reject", reasons: ["raw_too_long"], agreed: {}, extractions: [] };
  const hasPii = policy.fields.some((f) => f.pii);
  if (hasPii && !opts.hmacKey) throw new Error("tornado: hmacKey required for a policy with pii fields");
  const ctx = makeContext(raw);

  const runs = await Promise.all(extractors.map(async (ex) => {
    try {
      const out = await ex.run(raw);
      if (out && out.__error) return { id: ex.id, ok: false, error: String(out.__error).slice(0, 120), shaped: { values: {}, spans: {} }, fields: {} };
      const shaped = shapeExtraction(out, policy);
      const fields = {};
      for (const f of policy.fields) fields[f.name] = groundField(f, shaped.values[f.name], shaped.spans[f.name], ctx);
      return { id: ex.id, ok: true, shaped, fields };
    } catch (e) {
      return { id: ex.id, ok: false, error: String((e && e.message) || e).slice(0, 120), shaped: { values: {}, spans: {} }, fields: {} };
    }
  }));

  const flags = [];
  if (injectionSuspect(raw)) flags.push("injection_suspect");
  const pre = decide(policy, runs, []);
  for (const f of policy.fields) {
    if (f.type === "amount_jpy" && f.competing !== "allow" && pre.agreed[f.name] !== undefined && competingAmount(pre.agreed[f.name], f, ctx)) {
      flags.push(f.name + ":competing_amounts");
    }
  }
  const verdict = flags.length ? decide(policy, runs, flags) : pre;

  // 監査の記録。個人情報の項目と原文は鍵付きハッシュにする(値そのものは記録に入れない)。
  const piiNames = new Set(policy.fields.filter((f) => f.pii).map((f) => f.name));
  const seal = async (name, v) => (v === null || v === undefined ? null : piiNames.has(name) ? "hmac:" + (await hmacHex(opts.hmacKey, name + "\u0000" + String(v))) : v);
  const auditRuns = [];
  for (const r of runs) {
    const values = {}, spans = {}, grounding = {};
    for (const f of policy.fields) {
      values[f.name] = await seal(f.name, r.shaped.values[f.name]);
      spans[f.name] = await seal(f.name, r.shaped.spans[f.name]);
      grounding[f.name] = r.ok ? (r.fields[f.name].ok ? "ok" : r.fields[f.name].why) : null;
    }
    auditRuns.push({ id: r.id, ok: r.ok, error: r.error || null, values, spans, grounding });
  }
  const audit = {
    v: TORNADO_VERSION,
    policy: { id: policy.id, version: policy.version || null },
    extractors: extractors.map((e) => ({ id: e.id, prompt_sha256: e.prompt_sha256 || null })),
    raw: hasPii ? { hmac: await hmacHex(opts.hmacKey, raw), len: raw.length } : { sha256: await sha256Hex(raw), len: raw.length },
    runs: auditRuns,
    flags,
    decision: verdict.decision,
    reasons: verdict.reasons,
  };
  const decision_inputs_sha256 = await sha256Hex(canonicalJSON(audit));
  return {
    v: TORNADO_VERSION,
    decision: verdict.decision,
    reasons: verdict.reasons,
    agreed: verdict.agreed,
    flags,
    extractions: runs.map((r) => ({ id: r.id, ok: r.ok, error: r.error || null, values: r.shaped.values, spans: r.shaped.spans, grounding: Object.fromEntries(Object.entries(r.fields).map(([k, g]) => [k, g.ok ? "ok" : g.why])) })),
    audit,
    decision_inputs_sha256,
  };
}

/* ------------------------------------------------------------- 入口の門 */

function jres(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }

/**
 * Worker の fetch から呼ぶ。認証(Bearer、秘密は sha256 で比較)、回数制限(Cloudflare の rate limit バインディングがあれば)、
 * 大きさの上限、JSON の形。秘密が設定されていなければ 503 で閉じる(fail-closed)。
 * cfg: { policy, extractors: (env) => [...], authSecret: "TORNADO_TOKEN", hmacSecret?: "TORNADO_HMAC_KEY",
 *        rateLimiter?: "TORNADO_RL", maxBodyBytes?: 32768, log?: (o) => void }
 */
export async function gateHandle(request, env, cfg) {
  if (request.method !== "POST") return jres({ error: "method_not_allowed" }, 405);
  const secret = env && env[cfg.authSecret || "TORNADO_TOKEN"];
  if (!secret) return jres({ error: "gate_not_configured" }, 503);
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(\S{16,512})$/);
  if (!m) return jres({ error: "unauthorized" }, 401);
  const [got, want] = await Promise.all([sha256Hex(m[1]), sha256Hex(secret)]);
  if (!sameHex(got, want)) return jres({ error: "unauthorized" }, 401);
  const rlName = cfg.rateLimiter || "TORNADO_RL";
  if (env[rlName] && typeof env[rlName].limit === "function") {
    try {
      const { success } = await env[rlName].limit({ key: got.slice(0, 32) });
      if (!success) return jres({ error: "rate_limited" }, 429);
    } catch (_e) { return jres({ error: "rate_limiter_unavailable" }, 503); }
  }
  const maxBody = cfg.maxBodyBytes || 32768;
  const len = Number(request.headers.get("content-length") || "0");
  if (len > maxBody) return jres({ error: "too_large" }, 413);
  let text;
  try { text = await request.text(); } catch { return jres({ error: "unreadable_body" }, 400); }
  if (enc.encode(text).length > maxBody) return jres({ error: "too_large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return jres({ error: "invalid_json" }, 400); }
  const raw = body && typeof body.raw === "string" ? body.raw : body && typeof body.text === "string" ? body.text : null;
  if (raw === null) return jres({ error: "missing_raw_text" }, 400);
  if (raw.length > (cfg.policy.maxChars || 8000)) return jres({ error: "too_large" }, 413);
  const hmacKey = cfg.hmacSecret ? env[cfg.hmacSecret] : undefined;
  if (cfg.policy.fields.some((f) => f.pii) && !hmacKey) return jres({ error: "gate_not_configured" }, 503);
  const result = await runTornado(raw, cfg.policy, await cfg.extractors(env), { hmacKey });
  if (cfg.log) cfg.log({ decision: result.decision, reasons: result.reasons, sha: result.decision_inputs_sha256 });
  return jres(result);
}
