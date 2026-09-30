// Build or verify a nenrin-contrast-v0 record from files.
//   node contrast_cli.mjs --trace trace.json --walk walk.json [--support card.json ...]            prints the record
//   node contrast_cli.mjs --trace trace.json --walk walk.json [--support card.json ...] --verify c.json   exit 0 if identical
// Supporting files are read as raw bytes: they must be exactly what the endpoint served, or they will not hash
// to the walk's body_sha256.
import { readFileSync } from "node:fs";
import { buildContrast, verifyContrast, contrastSha } from "./contrast_v0.mjs";

const args = process.argv.slice(2);
const opt = { support: [] };
for (let i = 0; i < args.length; i += 2) {
  const k = args[i], v = args[i + 1];
  if (k === "--support") opt.support.push(v);
  else if (k === "--trace" || k === "--walk" || k === "--verify") opt[k.slice(2)] = v;
  else { console.error("unknown argument " + k); process.exit(2); }
}
if (!opt.trace || !opt.walk) { console.error("--trace and --walk are required"); process.exit(2); }
const inputs = {
  trace: JSON.parse(readFileSync(opt.trace, "utf8")),
  walk: JSON.parse(readFileSync(opt.walk, "utf8")),
  supporting: opt.support.map((f) => new Uint8Array(readFileSync(f))),
};
try {
  if (opt.verify) {
    const r = await verifyContrast(JSON.parse(readFileSync(opt.verify, "utf8")), inputs);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const c = await buildContrast(inputs);
  console.log(JSON.stringify(c, null, 2));
  console.error("contrast_sha256 " + (await contrastSha(c)));
} catch (e) {
  console.error((e.code || "error") + ": " + e.message);
  process.exit(1);
}
