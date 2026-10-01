/**
 * 変異試験。tornado.js の守りを 1 つずつ壊した写しを作り、敵の試験がそれを見つけて落ちるかを見る。
 * 生き残った変異は「試験が見ていない守り」なので、試験か実装を足す。
 *   node test/mutate.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(join(here, "..", "tornado.js"), "utf8");
const suite = join(here, "redteam_tornado.mjs");

const M = [
  ["分類: 値と根拠のつながり", `if (hits[0].e !== entry) return { ok: false, why: "value_not_from_span" };`, ``],
  ["分類: 曖昧な根拠", `if (hits.length > 1) return { ok: false, why: "span_ambiguous" };`, ``],
  ["分類: 総称を数えない", `return kept.some((h) => !h.e.generic) ? kept.filter((h) => !h.e.generic) : kept;`, `return kept;`],
  ["分類: 短い別名の吸収", `const kept = hits.filter((h) => !hits.some((o) => o !== h && normText(o.alias).length > normText(h.alias).length && normText(o.alias).includes(normText(h.alias))));`, `const kept = hits;`],
  ["金額: 数のかたまりごと", `if (whole.length === 0) return { ok: false, why: "span_cuts_a_number" };`, ``],
  ["金額: 金額として書かれた数", `if (field.requireMoney !== false && !whole.some((t) => isMoney(t, ctx.rawScan))) return { ok: false, why: "span_not_money" };`, ``],
  ["金額: 値と根拠のつながり", `if (!Number.isInteger(v) || v !== tok.value)`, `if (!Number.isInteger(v))`],
  ["金額: 根拠の数は 1 つ", `if (tokens.length !== 1) return { ok: false, why: "span_not_one_number" };`, ``],
  ["金額: 万の位", `"万": 1e4,`, `"万": 1e3,`],
  ["金額: 数字どうしの空白を詰めない", `.replace(/([0-9〇-九壱弐参拾十百千])\\s+(?=[万億千百十円])/g, "$1")`, `.replace(/\\s+/g, "")`],
  ["題: 値と根拠のつながり", `if (!normText(span).includes(normText(v))) return { ok: false, why: "value_not_from_span" };`, ``],
  ["共通: 根拠の長さの上限", `if (sc.length > max) return { ok: false, why: "span_too_long" };`, ``],
  ["共通: 根拠が原文にある", `if (!present(sc, ctx)) return { ok: false, why: "span_not_in_raw" };`, ``],
  ["電話: 境界", `if (!ctx.rawCanon.includes(canon(span).trim()) || !boundaryOk(canon(span).trim(), ctx, /[0-9]/)) return { ok: false, why: "span_cuts_a_number" };`, ``],
  ["電話: 値と根拠", `if (vd !== sd) return { ok: false, why: "value_not_from_span" };`, ``],
  ["メール: 境界", `if (!boundaryOk(s, ctx, /[A-Za-z0-9._%+@-]/)) return { ok: false, why: "span_cuts_an_address" };`, ``],
  ["日付: 値と根拠", `if (v !== d) return { ok: false, why: "value_not_from_span" };`, ``],
  ["決定: 抽出器が全滅なら却下", `if (live.length === 0) return { decision: "reject", reasons: ["extractor_unavailable"], agreed };`, ``],
  ["決定: 抽出器が落ちたら人へ", `if (live.length < runs.length) escalates.push("extractor_failed:" + (runs.length - live.length));`, ``],
  ["決定: 不安定なら人へ", `if (good.length < rs.length) { escalates.push(f.name + ":unstable"); continue; }`, ``],
  ["決定: 割れたら人へ", `if (f.consensus !== false && !good.every((g) => g.norm === good[0].norm)) { escalates.push(f.name + ":disagree"); continue; }`, ``],
  ["決定: 範囲", `if (!(value >= min)) return "below_min";`, ``],
  ["決定: 必須の欠け", `if (f.required) rejects.push(f.name + ":absent");`, ``],
  ["注入の兆し", `if (injectionSuspect(raw)) flags.push("injection_suspect");`, ``],
  ["金額の競合", `return !(chosenLabeled && !otherLabeled);`, `return false;`],
  ["原文の長さ", `if (raw.length > max) return`, `if (false) return`],
  ["個人情報: 鍵が無ければ投げる", `if (hasPii && !opts.hmacKey) throw new Error("tornado: hmacKey required for a policy with pii fields");`, ``],
  ["個人情報: 値を鍵付きハッシュに", `piiNames.has(name) ? "hmac:" + (await hmacHex(opts.hmacKey, name + "\\u0000" + String(v))) : v`, `v`],
  ["個人情報: 原文を鍵付きハッシュに", `raw: hasPii ? { hmac: await hmacHex(opts.hmacKey, raw), len: raw.length } : { sha256: await sha256Hex(raw), len: raw.length },`, `raw: { sha256: await sha256Hex(raw), len: raw.length },`],
  ["監査: K 回分を入れる", `    runs: auditRuns,`, `    runs: auditRuns.slice(0, 1),`],
  ["監査: 鍵の順の正規化", `const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();`, `const keys = Object.keys(v).filter((k) => v[k] !== undefined);`],
  ["形: 値の型", `values[f.name] = typeof v === "string" || typeof v === "number" ? (typeof v === "string" ? v.slice(0, 400) : v) : null;`, `values[f.name] = v === undefined ? null : v;`],
  ["形: 形の外を捨てる", `for (const f of policy.fields) {\n    const v = vs[f.name], s = ss[f.name];`, `for (const k of Object.keys(vs)) values[k] = vs[k];\n  for (const f of policy.fields) {\n    const v = vs[f.name], s = ss[f.name];`],
  ["入口: 秘密が無ければ閉じる", `if (!secret) return jres({ error: "gate_not_configured" }, 503);`, ``],
  ["入口: 鍵の照合", `if (!sameHex(got, want)) return jres({ error: "unauthorized" }, 401);`, ``],
  ["入口: 回数制限", `if (!success) return jres({ error: "rate_limited" }, 429);`, ``],
  ["入口: 回数制限が壊れたら閉じる", `} catch (_e) { return jres({ error: "rate_limiter_unavailable" }, 503); }`, `} catch (_e) { /* 通す */ }`],
  ["入口: 本文の大きさ", `if (enc.encode(text).length > maxBody) return jres({ error: "too_large" }, 413);`, ``],
  ["入口: HMAC 鍵が無ければ閉じる", `if (cfg.policy.fields.some((f) => f.pii) && !hmacKey) return jres({ error: "gate_not_configured" }, 503);`, ``],
  ["入口: ログに原文を出さない", `if (cfg.log) cfg.log({ decision: result.decision, reasons: result.reasons, sha: result.decision_inputs_sha256 });`, `if (cfg.log) cfg.log({ decision: result.decision, raw, values: result.extractions[0].values });`],
];

const dir = mkdtempSync(join(tmpdir(), "tornado-mut-"));
let killed = 0;
const survived = [], broken = [];
for (const [name, find, repl] of M) {
  const n = src.split(find).length - 1;
  if (n !== 1) { broken.push(name + " (一致 " + n + " 箇所)"); continue; }
  const file = join(dir, "m" + killed + survived.length + ".mjs");
  writeFileSync(file, src.replace(find, repl));
  const r = spawnSync(process.execPath, [suite], { env: { ...process.env, TORNADO_LIB: file }, encoding: "utf8" });
  if (r.status !== 0) killed++; else survived.push(name);
}
console.log("mutate: " + M.length + " 変異、検出 " + killed + "、生存 " + survived.length + "、適用できず " + broken.length);
for (const s of survived) console.log("  生存 " + s);
for (const b of broken) console.log("  適用できず " + b);
process.exit(survived.length || broken.length ? 1 : 0);
