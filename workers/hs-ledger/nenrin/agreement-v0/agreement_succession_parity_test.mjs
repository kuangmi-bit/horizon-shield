// RUN_ALL: suite
// 鍵の引き継ぎ (草案 6.10) で、JavaScript の検証器が python と 1 バイトも違わん報告書を返すか。
// 2026-09-30。python が agreement_succession_cases.py で場面を作り、自分の報告書を添える。
// こっちは同じ記録・同じ鍵・同じ鎖・同じ anchor block を JS の verify に渡して、
// 報告書の canonical バイトを突き合わせる。合うとるかどうか以外に点はやらん。
// 凍った 5,221 件 (agreement_verify_test.mjs) は鎖を渡さん場面やから、ここが別に要る。
//
// Run: node agreement_succession_parity_test.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalUtf8, parseStrict } from "./agreement_canonical.mjs";
import { verify } from "./agreement_verify.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const text = execFileSync("python3", [path.join(HERE, "agreement_succession_cases.py")],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const cases = parseStrict(text).cases;

let pass = 0;
const bad = [];
const seen = { accepted: 0, refused: 0, incomplete: 0 };
for (const c of cases) {
  const rep = await verify(c.record, {
    keys: c.keys, successions: c.successions, anchoredBlock: c.anchored_block,
  });
  const a = canonicalUtf8(rep), b = canonicalUtf8(c.report);
  if (a === b) pass++;
  else bad.push([c.name, a, b]);
  seen[c.report.verdict]++;
}
for (const [n, a, b] of bad.slice(0, 5)) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  console.log("NG   " + n + "\n     js: ..." + a.slice(Math.max(0, i - 60), i + 120) + "\n     py: ..." + b.slice(Math.max(0, i - 60), i + 120));
}
const kinds = seen.accepted > 0 && seen.refused > 0;
console.log("verdicts " + JSON.stringify(seen));
console.log("=== " + pass + " / " + cases.length + " 一致 (鍵の引き継ぎ、JS と Python)" + (kinds ? "" : "  受理と拒否の両方が無い") + " ===");
process.exit(pass === cases.length && cases.length >= 400 && kinds ? 0 : 1);
