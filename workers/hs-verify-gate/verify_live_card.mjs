// verify_live_card: 本番の gate から live の agent-card と JWKS を取り、公式 A2A SDK (@a2a-js/sdk) で
// JWS を検証する。外部の検証者 (Agenstry など、SDK を使う側) がやるのと同じ事を、お前の vantage で再現する。
// deploy 前の描画 card を見る card_signature.test と違い、これは deploy 済みの本番バイトそのものを見る。
// 走らせ方 (本番): node workers/hs-verify-gate/verify_live_card.mjs
//        (別 origin): CARD_ORIGIN=https://... node workers/hs-verify-gate/verify_live_card.mjs
//        (offline 試験): node workers/hs-verify-gate/verify_live_card.mjs --card card.json --jwks jwks.json
//        (deploy 門): node workers/hs-verify-gate/verify_live_card.mjs --expect-version 0.4.10   (server.json の version と一致せんと INVALID)
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD_SIGN = path.resolve(HERE, "..", "a2a-card-sign");
const req = createRequire(path.join(CARD_SIGN, "package.json"));
const sdk = await import(pathToFileURL(req.resolve("@a2a-js/sdk")).href);

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
const ORIGIN = (process.env.CARD_ORIGIN || "https://gate.horizonshield.dev").replace(/\/+$/, "");

let card, jwks, whereCard, whereJwks;
if (args.card) {
  whereCard = args.card; whereJwks = args.jwks || args.card.replace(/card/, "jwks");
  card = JSON.parse(readFileSync(whereCard, "utf8"));
  jwks = JSON.parse(readFileSync(whereJwks, "utf8"));
} else {
  whereCard = ORIGIN + "/.well-known/agent-card.json"; whereJwks = ORIGIN + "/.well-known/jwks.json";
  card = await (await fetch(whereCard, { cache: "no-store" })).json();
  jwks = await (await fetch(whereJwks, { cache: "no-store" })).json();
}

const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const sigs = Array.isArray(card.signatures) ? card.signatures : [];
if (!sigs.length) { console.log("INVALID  the live card carries no signatures (" + whereCard + ")"); process.exit(1); }
let kid = "?"; try { kid = JSON.parse(Buffer.from(sigs[0].protected, "base64url").toString("utf8")).kid; } catch (_e) {}
if (args["expect-version"] && String(card.version) !== String(args["expect-version"])) {
  console.log("INVALID   " + whereCard);
  console.log("  served version " + card.version + " is not the expected " + args["expect-version"] + " (edge still serving an older build, or server.json and the card disagree)");
  process.exit(1);
}
const bare = { ...card }; delete bare.signatures;
const canonical = sdk.canonicalizeAgentCard(bare);
const canon12 = (await sha(canonical)).slice(0, 12);

// 署名を 1 本ずつ、2 つの流儀で見る (2026-10-07)。
// この card は 0.4.15 から同じ鍵の署名を 2 本持つ: 先頭が素の RFC 8785 (配った欄を全部覆う)、2 本目が公式 SDK 流
// (proto 往復のあと RFC 8785、schema の外の欄は覆わん)。SDK の verifier は「どれか 1 本が通れば可」で、通らん 1 本ごとに
// "Signature verification on entry was not successful" を console に出す。先頭の 1 本は SDK 流では必ず通らんので、
// その行は毎回 1 回出て、壊れたように見えとった。しかも素の RFC 8785 の 1 本は、ここでは誰も確かめとらんかった。
// せやから SDK の出力は黙らせ、1 本ごとにどの流儀で通ったかをこっちの言葉で書き、どの流儀でも通らん署名が 1 本でもあれば落とす。
const { verifyPlain } = await import(pathToFileURL(path.join(CARD_SIGN, "sign_lib.mjs")).href);
const keyFor = async (k) => { const j = (jwks.keys || []).find((x) => x.kid === k); if (!j) throw new Error("kid " + k + " not in the served JWKS"); return j; };
const quiet = async (fn) => {
  const names = ["log", "warn", "error", "info", "debug"];
  const saved = names.map((n) => console[n]);
  for (const n of names) console[n] = () => {};
  try { await fn(); return null; } catch (e) { return String(e && e.message || e); }
  finally { names.forEach((n, i) => { console[n] = saved[i]; }); }
};
const rows = [];
for (let i = 0; i < sigs.length; i++) {
  const one = { ...card, signatures: [sigs[i]] };
  const sdkErr = await quiet(() => sdk.verifyAgentCardSignature(keyFor)(one));
  const plainErr = await quiet(() => verifyPlain(one, async () => jwks));
  rows.push({ i, sdk: sdkErr === null, plain: plainErr === null, sdkErr, plainErr });
}
const wholeErr = await quiet(() => sdk.verifyAgentCardSignature(keyFor)(card));
const dead = rows.filter((r) => !r.sdk && !r.plain);
const anySdk = rows.some((r) => r.sdk), anyPlain = rows.some((r) => r.plain);
const line = (r) => "  signature[" + r.i + "]  " + (r.sdk ? "verifies in the official SDK form (schema fields)" : r.plain ? "verifies over plain RFC 8785 (every served field)" : "VERIFIES IN NEITHER FORM  sdk: " + r.sdkErr + "  plain: " + r.plainErr);
// 2 本持つ card は、両方の流儀が 1 本ずつ通らんとあかん。1 本だけの card (古い版、別 origin) は SDK 流が通れば可。
const ok = wholeErr === null && anySdk && dead.length === 0 && (sigs.length < 2 || anyPlain);
if (ok) {
  console.log("VERIFIED  " + whereCard);
  console.log("  version " + card.version + "   kid " + kid + "   canonical " + canon12 + "   signatures " + sigs.length);
  for (const r of rows) console.log(line(r));
  if (sigs.length > 1) console.log("  公式 SDK は 1 本でも通れば可とし、通らん 1 本ごとに \"Signature verification on entry was not successful\" を出す。素の RFC 8785 の 1 本は SDK 流では通らんのが正しい。上の行がその内訳。");
  console.log("  検証は公式 @a2a-js/sdk。SDK を使う外部検証者はこの vantage で同じ結果を得る。");
} else {
  console.log("INVALID   " + whereCard);
  console.log("  version " + card.version + "   kid " + kid + "   canonical " + canon12 + "   signatures " + sigs.length);
  for (const r of rows) console.log(line(r));
  if (wholeErr !== null) console.log("  reason (official SDK, whole card): " + wholeErr);
  else if (!anySdk) console.log("  reason: no signature verifies in the official SDK form");
  else if (dead.length) console.log("  reason: signature[" + dead.map((r) => r.i).join(",") + "] verifies in neither form");
  else console.log("  reason: the card carries " + sigs.length + " signatures and none verifies over plain RFC 8785 of the served card");
  console.log("  = 本番バイトが署名対象と違う。deploy 後に再署名しとらんか、canonical が別。");
  process.exit(1);
}
