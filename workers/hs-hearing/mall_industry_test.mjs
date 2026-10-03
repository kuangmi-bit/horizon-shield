/* Yakumo の名簿(MCP の list_verified_stores などが読む contractorsFromStores)に、
   建設以外の業種の店が出ないことを、実物の src から作った写しで確かめる。KV は模擬。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRCDIR = path.join(HERE, "src");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hsmall-"));
for (const f of fs.readdirSync(SRCDIR)) {
  if (!f.endsWith(".js")) continue;
  let body = fs.readFileSync(path.join(SRCDIR, f), "utf8");
  body = body.replace(/from "\.\/([a-z0-9_]+)\.js"/g, 'from "./$1.mjs"');
  if (f === "hearing.js" && !body.includes("export { contractorsFromStores }")) body += "\nexport { contractorsFromStores };\n";
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, ".mjs")), body);
}
const H = await import(path.join(TMP, "hearing.mjs"));

const kv = new Map([
  ["hearing:hs-partner-001", JSON.stringify({ profile: { industry: "construction", works: ["内装"] } })],
  ["hearing:kira-nurse", JSON.stringify({ profile: { works: ["医療処置", "ターミナルケア"] } })],
]);
const env = { HS_HEARING_KV: { get: async (k, t) => { const v = kv.get(k); return v == null ? null : (t === "json" ? JSON.parse(v) : v); } } };
const stores = [
  { store_id: "hs-partner-001", member_no: "No.001", industry: "construction", verification: "verified", fairness_score: 88, works: ["内装"] },
  { store_id: "kira-nurse", industry: "visiting_nursing", verification: "pending", works: ["医療処置"] },
  { store_id: "legacy-no-industry", member_no: "No.009", verification: "pending", works: ["外壁塗装"] },
];
const out = await H.contractorsFromStores(env, stores);
let fail = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) fail++; };
const names = JSON.stringify(out);
ok(out.length === 2, "建設と業種未定の 2 店だけが残る(今 " + out.length + ")");
ok(!names.includes("医療処置"), "訪問看護の工種が名簿に出ない");
ok(names.includes("内装"), "建設の店はそのまま出る");
ok(names.includes("外壁塗装"), "業種が未定の店は従来どおり残る");
fs.rmSync(TMP, { recursive: true, force: true });
if (fail) { console.log("落ちた: " + fail); process.exit(1); }
console.log("mall_industry 4/4 通過");
