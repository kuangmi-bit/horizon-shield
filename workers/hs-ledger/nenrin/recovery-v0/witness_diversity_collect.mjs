// RUN_ALL: library (CLI, network)  池の各項の公開 DNS の事実を集めて witness_facts.json に書く。採点は witness_diversity_test.mjs (偽 fetch)
//
//   node witness_diversity_collect.mjs [--pool witness_pool.json] [--out witness_facts.json] [--report witness_diversity_report.json]
//
// 取る物 (全部 DNS over HTTPS の公開の答え、鍵も認証も要らん):
//   A / AAAA        signed_domain の IP
//   NS              登録ドメインのネームサーバー
//   ASN             IP ごとに Team Cymru の origin.asn.cymru.com の TXT (IP から AS 番号を引く公開の口)
// 二つの DoH (Cloudflare と Google) に同じ問いを投げ、答えが食い違ったら両方を記録する (片方に寄せん)。
// 書く物は事実と、取った時刻と、取り方だけ。判定は witness_diversity.mjs がする。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizePool } from "./witness_draw.mjs";
import { registrableDomain, diversityReport } from "./witness_diversity.mjs";

export const COLLECT_VERSION = "0.1.1";
export const DOH = [
  { name: "cloudflare", url: (n, t) => "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(n) + "&type=" + t },
  { name: "google", url: (n, t) => "https://dns.google/resolve?name=" + encodeURIComponent(n) + "&type=" + t },
];
const TYPE = { A: 1, NS: 2, TXT: 16, AAAA: 28 };

async function ask(fetchImpl, name, type) {
  const answers = {};
  for (const d of DOH) {
    try {
      const r = await fetchImpl(d.url(name, type), { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) { answers[d.name] = null; continue; }
      const j = await r.json();
      answers[d.name] = (j.Answer || []).filter((a) => a.type === TYPE[type]).map((a) => String(a.data).replace(/^"|"$/g, "").replace(/\.$/, "")).sort();
    } catch { answers[d.name] = null; }
  }
  const lists = Object.values(answers).filter((x) => Array.isArray(x));
  const union = [...new Set(lists.flat())].sort();
  const agree = lists.length === DOH.length && lists.every((l) => JSON.stringify(l) === JSON.stringify(lists[0]));
  return { union, agree, answers, answered: lists.length > 0 };
}

export function cymruName(ip) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split(".").reverse().join(".") + ".origin.asn.cymru.com";
  // v6: nibble 反転
  const full = expandV6(ip);
  if (!full) return null;
  return full.replace(/:/g, "").split("").reverse().join(".") + ".origin6.asn.cymru.com";
}
function expandV6(ip) {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array(parts.length === 2 ? fill : 0).fill("0"), ...tail].map((h) => h.padStart(4, "0")).join(":");
}

export async function collectFact(signedDomain, { fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  const host = signedDomain.toLowerCase();
  const a = await ask(fetchImpl, host, "A");
  const aaaa = await ask(fetchImpl, host, "AAAA");
  const ns = await ask(fetchImpl, registrableDomain(host).registrable, "NS");
  const ips = [...a.union, ...aaaa.union];
  const asns = new Set();
  for (const ip of ips) {
    const q = cymruName(ip); if (!q) continue;
    const t = await ask(fetchImpl, q, "TXT");
    for (const line of t.union) { const as = line.split("|")[0].trim().split(/\s+/)[0]; if (/^\d+$/.test(as)) asns.add(as); }
  }
  const disagreements = [["A", a], ["AAAA", aaaa], ["NS", ns]].filter(([, r]) => !r.agree).map(([t, r]) => ({ type: t, answers: r.answers }));
  // どの resolver も答えんかった型。空の答え (answered で union が []) とは別物として残す。witness_diversity.mjs の
  // factAnswered が、A と AAAA と NS の全部が unanswered の事実を「事実無し」と数える。
  const unanswered = [["A", a], ["AAAA", aaaa], ["NS", ns]].filter(([, r]) => !r.answered).map(([t]) => t);
  return {
    observed_at: now(), method: "doh:" + DOH.map((d) => d.name).join("+") + " cymru-origin-asn collect/" + COLLECT_VERSION,
    ips: ips.sort(), asns: [...asns].sort(), ns: ns.union, ...(unanswered.length ? { unanswered } : {}), ...(disagreements.length ? { resolver_disagreements: disagreements } : {}),
  };
}

async function main(argv) {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const poolPath = arg("--pool", path.join(HERE, "witness_pool.json"));
  const out = arg("--out", path.join(HERE, "witness_facts.json"));
  const rep = arg("--report", path.join(HERE, "witness_diversity_report.json"));
  const pool = JSON.parse(readFileSync(poolPath, "utf8"));
  const facts = {};
  for (const e of normalizePool(pool)) { facts[e.signed_domain.toLowerCase()] = await collectFact(e.signed_domain); process.stdout.write("  " + e.signed_domain + "  ips " + facts[e.signed_domain.toLowerCase()].ips.length + "  asns " + facts[e.signed_domain.toLowerCase()].asns.join(",") + "\n"); }
  writeFileSync(out, JSON.stringify({ schema: "nenrin-witness-facts-v0", collected_by: "witness_diversity_collect.mjs " + COLLECT_VERSION, facts }, null, 2) + "\n");
  const report = await diversityReport(pool, facts);
  writeFileSync(rep, JSON.stringify(report, null, 2) + "\n");
  console.log("pool " + report.pool_size + "  control clusters " + report.control_clusters + "  findings " + (report.findings.join(",") || "none"));
  console.log("wrote " + out + " and " + rep);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
