// 本番の MCP の答え(initialize と tools/list)を、手元の worker のファイルが返す答えと比べる(2026-10-04 番人)。
//   pre : deploy の前。本番と手元の違いが数字だけか(数字を 9 に伏せて同じか)。違えば、手元が本番と別の版。
//   post: deploy の後。本番が手元と 1 字も違わないか。
// 使い方: node prod_compare.mjs <worker のファイル> <MCP の URL> pre|post [出力の置き場] [pre で比べない道具の名前]
//   hs-mcp の pre では get_jccdb_dataset_info を外す(その道具は公開の台本が中身を足すので、数字だけの違いにならない)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const [, , file, url, mode, outDir, ignoreTool] = process.argv;
if (!file || !url || !["pre", "post"].includes(mode)) {
  console.log("使い方: node prod_compare.mjs <worker のファイル> <MCP の URL> pre|post [出力の置き場]");
  process.exit(2);
}
const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "counts-check", version: "0" } };
const body = (method, params) => JSON.stringify({ jsonrpc: "2.0", id: method === "initialize" ? 1 : 2, method, params });
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const parse = (t) => {
  const m = t.match(/^data: (\{.*\})$/m);
  return JSON.parse(m ? m[1] : t);
};
const worker = (await import(pathToFileURL(path.resolve(file)).href)).default;
const local = async (method, params) => parse(await (await worker.fetch(new Request(url, { method: "POST", headers, body: body(method, params) }), {}, { waitUntil() {} })).text()).result;
// 本番には curl で聞く(Mac でも、proxy のある場所でも同じように届く)。
const prod = async (method, params) => {
  let t;
  try {
    t = execFileSync("curl", ["-sS", "--max-time", "40", "-X", "POST", url, "-H", "content-type: application/json",
      "-H", "accept: application/json, text/event-stream", "--data", body(method, params)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.log("本番に届かない: " + url + " " + String(e.message).slice(0, 200));
    process.exit(3);
  }
  const r = parse(t);
  if (!r.result) { console.log("本番の答えに result が無い: " + t.slice(0, 300)); process.exit(3); }
  return r.result;
};
const mask = (s) => s.replace(/[0-9]/g, "9");
let bad = 0;
const out = {};
const drop = (r) => {
  if (mode === "pre" && ignoreTool && r && Array.isArray(r.tools)) return { ...r, tools: r.tools.filter((t) => t.name !== ignoreTool) };
  return r;
};
for (const [method, params] of [["initialize", INIT], ["tools/list", {}]]) {
  const a = JSON.stringify(drop(await prod(method, params)));
  const b = JSON.stringify(drop(await local(method, params)));
  out[method] = { prod: a, local: b };
  const same = mode === "post" ? a === b : mask(a) === mask(b);
  console.log((same ? "  同じ   " : "  違う   ") + method + (mode === "pre" ? "(数字を伏せて比べた)" : "(1 字も違わないか)"));
  if (!same) {
    bad++;
    if (method === "tools/list") {
      const pa = JSON.parse(a).tools, pb = JSON.parse(b).tools;
      const na = new Map(pa.map((t) => [t.name, JSON.stringify(t)])), nb = new Map(pb.map((t) => [t.name, JSON.stringify(t)]));
      for (const k of new Set([...na.keys(), ...nb.keys()])) {
        const x = na.get(k), y = nb.get(k);
        const d = mode === "post" ? x !== y : (x === undefined || y === undefined || mask(x) !== mask(y));
        if (d) console.log("         道具 " + k + (x === undefined ? " が本番に無い" : y === undefined ? " が手元に無い" : " の中身が違う"));
      }
    }
  }
}
if (outDir) fs.writeFileSync(path.join(outDir, "prod_compare_" + new URL(url).hostname + "_" + mode + ".json"), JSON.stringify(out, null, 1));
process.exit(bad ? 1 : 0);
