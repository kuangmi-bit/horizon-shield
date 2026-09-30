// RUN_ALL: suite
// 鍵の引き継ぎの JS 側 (key_succession.mjs と agreement_verify.mjs の succession) を 1 本ずつ壊して、
// agreement_succession_parity_test.mjs が気付くかを見る。2026-09-30。
// 凍った 5,221 件は鎖を渡さんから、agreement_verify_mutation.mjs ではここの変異は死なん。せやから別に要る。
//
// 写しは symlink やのうて本物の copy にする。node は import を realpath で解くから、link にすると
// 壊した写しやのうて元の file を読んでしまう。作った日に 1 回それで「生き残った」を見た。
//
// Run: node agreement_succession_mutation.mjs
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KS = "key_succession.mjs", AV = "agreement_verify.mjs";

// [名前, 元の文字列, 置き換え, file]
export const MUTANTS = [
  ["a rotation needs only the new key", 'const need = e.reason === "rotation" ? ["old", "new"] : ["new"];', 'const need = ["new"];', KS],
  ["handover signatures are never checked", "if ((await V.ed25519Verify(key, s.sig, msg)) !== true) {", "if (false) {", KS],
  ["the chain is not linked by sha", "if (e.prev_succession_sha256 !== await entrySha256(prev, V)) {", "if (false) {", KS],
  ["a handover may pass on a key it was never given", "if (oldK !== prev.new_public_key_ed25519_b64) {", "if (false) {", KS],
  ["blocks may go backwards", "if (blk <= asInt(prev.effective_block)) {", "if (false) {", KS],
  ["a key may be retired twice", "if (seenOld.has(oldK)) return", "if (false) return", KS],
  ["the chain need not end at the served key", "if (chain[chain.length - 1].new_public_key_ed25519_b64 !== toPub) {", "if (false) {", KS],
  ["a handover for another domain counts", "if (V.normDomain(e.domain) !== domain) {", "if (false) {", KS],
  ["extra fields are allowed", "if (!sameKeys(e, FIELDS)) {", "if (false) {", KS],
  ["unusable keys are allowed", "if (!keyOk(V, oldK) || !keyOk(V, newK)) {", "if (false) {", KS],
  ["a boolean block counts as a block", 'if (typeof v === "bigint") return v;', 'if (typeof v === "bigint") return v;\n  if (typeof v === "boolean") return v ? 1n : 0n;', KS],
  ["attribute nothing across a rotation", "} else if (served !== pub && successions !== null && successions !== undefined", "} else if (false", AV],
  ["a record anchored AT the handover block counts as before it", "if (ab !== null && ab < retired.block) {", "if (ab !== null && ab <= retired.block) {", AV],
  ["a record naming the retirement block itself is not caught", "if (lbh !== null && lbh >= retired.block) {", "if (lbh !== null && lbh > retired.block) {", AV],
  ["a rotated key on somebody else's host is attributed", "    r.rotated.push(d);\n    return !r.off_domain.some((x) => x[0] === d);", "    r.rotated.push(d);\n    return true;", AV],
  ["the report claims the served key after a rotation", "if (urlsChecked && r.rotated.length) {", "if (false) {", AV],
];

const IS_MAIN = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (IS_MAIN) {
  const src = { [KS]: readFileSync(path.join(HERE, KS), "utf8"), [AV]: readFileSync(path.join(HERE, AV), "utf8") };
  const work = mkdtempSync(path.join(os.tmpdir(), "agreement-succession-mutation-"));
  for (const f of readdirSync(HERE)) if (f.endsWith(".py") || f.endsWith(".mjs")) copyFileSync(path.join(HERE, f), path.join(work, f));
  const putAll = () => { for (const [f, t] of Object.entries(src)) writeFileSync(path.join(work, f), t); };
  const run = () => spawnSync(process.execPath, [path.join(work, "agreement_succession_parity_test.mjs")],
    { cwd: work, encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  putAll();
  const base = run();
  if (base.status !== 0) {
    console.error("★ 拒否: 変異を入れる前から採点板が赤い。ここから先は何も測れん。");
    console.error((base.stdout || "").slice(-800) + (base.stderr || "").slice(-800));
    process.exit(2);
  }
  console.log("  " + "変異なし".padEnd(60) + "緑");
  const wrong = [];
  for (const [name, old, neu, file] of MUTANTS) {
    const hits = src[file].split(old).length - 1;
    if (hits !== 1) { console.log("  " + name.padEnd(60) + "錨が " + hits + " 箇所"); wrong.push(name + " (錨)"); continue; }
    putAll();
    writeFileSync(path.join(work, file), src[file].replace(old, neu));
    const r = run();
    const score = ((r.stdout || "").split("\n").find((l) => l.startsWith("===")) || "").trim();
    const caught = r.status !== 0;
    if (!caught) wrong.push(name);
    console.log("  " + name.padEnd(60) + (caught ? "捕まえた  " : "★ 生き残った  ") + score);
  }
  const same = Object.entries(src).every(([f, t]) => readFileSync(path.join(HERE, f), "utf8") === t);
  rmSync(work, { recursive: true, force: true });
  console.log("元の file  " + (same ? "1 バイトも触っとらん" : "★ 変わっとる"));
  if (wrong.length || !same) {
    console.log("=== " + (MUTANTS.length - wrong.length) + " / " + MUTANTS.length + "、捕まえられんかったんは: " + wrong.join("、") + " ===");
    process.exit(1);
  }
  console.log("=== " + MUTANTS.length + " / " + MUTANTS.length + " 合格 (鍵の引き継ぎ、JS の変異) ===");
}
