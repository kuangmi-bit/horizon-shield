// RUN_ALL: suite
// 支配の多様性の採点: Sybil の形 (同じ登録ドメイン、同じ IP、同じ独自 NS) を強い信号で束ね、
// 大手 CDN・大手 DNS・同じ基盤は弱い信号に留め (正直な証人に濡れ衣を着せん)、
// drawDiverse が同じ塊から 2 人引かず、全員別の塊なら draw() と同じ k 人を返し、点を一切出さんこと。
import { draw } from "./witness_draw.mjs";
import { registrableDomain, nsOperator, ipPrefix, diversityReport, drawDiverse, controlClusters } from "./witness_diversity.mjs";
import { collectFact, cymruName } from "./witness_diversity_collect.mjs";

let pass = 0, fail = 0; const results = [];
function t(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  <- " + detail)); }

const key = (i) => Buffer.from(("witness-key-" + String(i).padStart(3, "0")).padEnd(32, "x")).toString("base64");
const E = (host, i) => ({ signed_domain: host, key_url: "https://" + host + "/keys/witness.json", public_key_ed25519_b64: key(i) });
const BEACON = "00000000000000000001aa2b3c4d5e6f00000000000000000001aa2b3c4d5e6f";
const SUBJECT = "c92bf886".padEnd(64, "0");

// ---- 1. 登録ドメインと基盤 ----
t("registrable: a.alice.com and b.alice.com share alice.com", registrableDomain("a.alice.com").registrable === "alice.com" && registrableDomain("b.alice.com").registrable === "alice.com");
t("registrable: x.co.jp keeps two labels of suffix (shop.example.co.jp -> example.co.jp)", registrableDomain("shop.example.co.jp").registrable === "example.co.jp");
t("platform: alice.workers.dev and bob.workers.dev are different registrable domains on one platform", registrableDomain("api.alice.workers.dev").registrable === "alice.workers.dev" && registrableDomain("bob.workers.dev").registrable === "bob.workers.dev" && registrableDomain("bob.workers.dev").platform === "workers.dev");
t("nameserver: cloudflare NS is a shared provider (weak), ns1.alice-corp.com is custom (strong)", nsOperator("jake.ns.cloudflare.com").shared_provider === true && nsOperator("ns1.alice-corp.com").shared_provider === false && nsOperator("ns1.alice-corp.com").operator === "alice-corp.com");
t("ip prefix: v4 /24", ipPrefix("203.0.113.77") === "203.0.113.0/24");

// ---- 2. Sybil の形は強い信号で 1 塊になる ----
const sybilPool = { entries: [E("w1.sybil.example", 1), E("w2.sybil.example", 2), E("w3.sybil.example", 3), E("honest-a.org", 4), E("honest-b.net", 5)] };
const facts = {
  "w1.sybil.example": { observed_at: "2026-09-27T10:00:00Z", method: "test", ips: ["198.51.100.10"], asns: ["64500"], ns: ["ns1.sybil-dns.example"] },
  "w2.sybil.example": { observed_at: "2026-09-27T10:00:00Z", method: "test", ips: ["198.51.100.11"], asns: ["64500"], ns: ["ns1.sybil-dns.example"] },
  "w3.sybil.example": { observed_at: "2026-09-27T10:00:00Z", method: "test", ips: ["198.51.100.12"], asns: ["64500"], ns: ["ns1.sybil-dns.example"] },
  "honest-a.org": { observed_at: "2026-09-27T10:00:00Z", method: "test", ips: ["104.16.1.1"], asns: ["13335"], ns: ["jake.ns.cloudflare.com"] },
  "honest-b.net": { observed_at: "2026-09-27T10:00:00Z", method: "test", ips: ["104.17.9.9"], asns: ["13335"], ns: ["courtney.ns.cloudflare.com"] },
};
const rep = await diversityReport(sybilPool, facts);
t("sybil: 5 entries, 3 control clusters (3 sybil subdomains collapse into one)", rep.pool_size === "5" && rep.control_clusters === "3", JSON.stringify(rep.clusters));
t("sybil: shared_control_suspected is raised with the registrable domain named", rep.findings.includes("shared_control_suspected") && rep.strong_shared.some((g) => g.kind === "registrable_domain" && g.value === "sybil.example" && g.members.length === 3));
t("honest on one CDN: same ASN 13335 and same DNS provider are weak only, never merge the two honest entries", rep.weak_shared.some((g) => g.kind === "asn" && g.value === "13335") && rep.clusters.filter((c) => c.members.includes("honest-a.org") || c.members.includes("honest-b.net")).length === 2);

// 別ドメインに散らしても、IP を共有したら捕まる (推移的に 1 塊)
const spread = { entries: [E("alpha-witness.com", 11), E("beta-witness.net", 12), E("gamma-witness.org", 13)] };
const spreadFacts = {
  "alpha-witness.com": { ips: ["192.0.2.5"], asns: ["64501"], ns: ["ns.cloudflare.com"] },
  "beta-witness.net": { ips: ["192.0.2.6"], asns: ["64501"], ns: ["ns.cloudflare.com"] },
  "gamma-witness.org": { ips: ["203.0.113.9"], asns: ["64502"], ns: ["ns1.gamma-own-dns.org"] },
};
const rep2 = await diversityReport(spread, spreadFacts);
t("spread sybil: three domains, but alpha and beta share an IP /24, so 2 clusters", rep2.control_clusters === "2" && rep2.strong_shared.some((g) => g.kind === "ip_prefix" && g.value === "192.0.2.0/24"));
// 独自 NS の共有で捕まる
const nsPool = { entries: [E("one.example-a.com", 21), E("two.example-b.com", 22)] };
const rep3 = await diversityReport(nsPool, { "one.example-a.com": { ips: ["192.0.2.1"], ns: ["ns1.shared-owner.io"] }, "two.example-b.com": { ips: ["198.51.100.1"], ns: ["ns2.shared-owner.io"] } });
t("custom nameserver shared across two registrable domains merges them (strong)", rep3.control_clusters === "1" && rep3.findings.includes("single_control_cluster"));

// 事実が無い項は「別人」と数えん: facts_missing を出す
const rep4 = await diversityReport(sybilPool, {});
t("missing facts are reported (facts_missing), not counted as proof of independence", rep4.findings.includes("facts_missing") && rep4.entries_with_facts === "0");

// ---- 3. 点を付けん ----
const flat = JSON.stringify(rep);
t("report carries no score, rank, trust or rating key", !/"(score|rank|rating|trust_level|trust_score|grade)"/.test(flat));
t("report says what it does not establish (different people, DNS truth, witness truth, no score)", rep.does_not_establish.length === 4 && rep.does_not_establish.some((s) => /determined operator/.test(s)));
t("report is deterministic (same inputs, same bytes)", JSON.stringify(await diversityReport(sybilPool, facts)) === flat);
t("fact order does not change facts_sha256", (await diversityReport(sybilPool, Object.fromEntries(Object.entries(facts).reverse()))).facts_sha256 === rep.facts_sha256);

// ---- 4. drawDiverse ----
for (const k of [1, 2, 3, 4, 5]) {
  const d = await drawDiverse({ pool: sybilPool, facts, beaconHash: BEACON, subjectSha256: SUBJECT, k });
  const { clusterOf } = controlClusters(sybilPool.entries, facts);
  const cl = d.drawn.map((h) => clusterOf.get(h));
  t("drawDiverse k=" + k + ": never two from one control cluster, and never more than the 3 clusters", new Set(cl).size === cl.length && d.drawn.length === Math.min(k, 3), JSON.stringify(d.drawn));
}
const dA = await drawDiverse({ pool: sybilPool, facts, beaconHash: BEACON, subjectSha256: SUBJECT, k: 3 });
const dB = await drawDiverse({ pool: sybilPool, facts, beaconHash: BEACON, subjectSha256: SUBJECT, k: 3 });
t("drawDiverse is recomputable (same inputs, same drawn list and seed)", JSON.stringify(dA.drawn) === JSON.stringify(dB.drawn) && dA.seed_sha256 === dB.seed_sha256);
t("drawDiverse records every skipped entry and which drawn entry it shares a cluster with", dA.skipped.every((s) => dA.drawn.includes(s.same_cluster_as)));
const dOther = await drawDiverse({ pool: sybilPool, facts, beaconHash: BEACON.replace(/.$/, "0"), subjectSha256: SUBJECT, k: 3 });
t("a different beacon gives a different seed", dOther.seed_sha256 !== dA.seed_sha256);

// 全員が別の塊なら、draw() の頭 k 人とまったく同じ (互換: 既存の籤を壊さん)
const honestPool = { entries: [E("a.one.org", 31), E("b.two.net", 32), E("c.three.com", 33), E("d.four.io", 34), E("e.five.jp", 35), E("f.six.dev", 36)] };
const honestFacts = Object.fromEntries(honestPool.entries.map((e, i) => [e.signed_domain, { ips: ["10.0." + i + ".1"], asns: ["13335"], ns: ["x.ns.cloudflare.com"] }]));
for (const k of [1, 3, 6]) {
  const a = await draw({ pool: honestPool, beaconHash: BEACON, subjectSha256: SUBJECT, k });
  const b = await drawDiverse({ pool: honestPool, facts: honestFacts, beaconHash: BEACON, subjectSha256: SUBJECT, k });
  t("all clusters distinct, k=" + k + ": drawDiverse equals draw() exactly (same seed, same pool_sha256, same drawn)", a.seed_sha256 === b.seed_sha256 && a.pool_sha256 === b.pool_sha256 && JSON.stringify(a.drawn) === JSON.stringify(b.drawn), JSON.stringify([a.drawn, b.drawn]));
}
const exOwn = await drawDiverse({ pool: { entries: [...honestPool.entries, E("gate.horizonshield.dev", 99)] }, facts: honestFacts, beaconHash: BEACON, subjectSha256: SUBJECT, k: 7, excludeHost: "gate.horizonshield.dev" });
t("the operator's own host is excluded before the draw (self_witness)", !exOwn.drawn.includes("gate.horizonshield.dev") && exOwn.eligible === "6");
let threw = false; try { await drawDiverse({ pool: honestPool, beaconHash: "zz", subjectSha256: SUBJECT, k: 1 }); } catch { threw = true; }
t("a malformed beacon is refused", threw);

// ---- 5. 集める側 (偽 fetch) ----
t("cymru name for v4 reverses octets", cymruName("104.16.1.2") === "2.1.16.104.origin.asn.cymru.com");
t("cymru name for v6 reverses nibbles", cymruName("2606:4700::1").endsWith(".origin6.asn.cymru.com") && cymruName("2606:4700::1").startsWith("1.0.0.0."));
const fake = (disagree) => async (url) => {
  const u = new URL(url); const name = u.searchParams.get("name"); const type = u.searchParams.get("type");
  const google = u.host === "dns.google";
  let Answer = [];
  if (type === "A") Answer = [{ type: 1, data: disagree && google ? "198.51.100.99" : "198.51.100.7" }];
  if (type === "AAAA") Answer = [];
  if (type === "NS") Answer = [{ type: 2, data: "ns1.example-dns.com." }];
  if (type === "TXT" && name.endsWith("origin.asn.cymru.com")) Answer = [{ type: 16, data: "\"64500 | 198.51.100.0/24 | US | arin | 2010-01-01\"" }];
  return { ok: true, json: async () => ({ Answer }) };
};
const f1 = await collectFact("w.example.com", { fetchImpl: fake(false), now: () => "2026-09-27T10:00:00Z" });
t("collect: IPs, ASN from cymru TXT, NS of the registrable domain, time and method recorded", JSON.stringify(f1.ips) === '["198.51.100.7"]' && JSON.stringify(f1.asns) === '["64500"]' && f1.ns[0] === "ns1.example-dns.com" && f1.observed_at === "2026-09-27T10:00:00Z" && /cymru/.test(f1.method) && !f1.resolver_disagreements);
const f2 = await collectFact("w.example.com", { fetchImpl: fake(true), now: () => "2026-09-27T10:00:00Z" });
t("collect: when the two resolvers disagree, both answers are kept and the union is used (not the favorable one)", f2.ips.length === 2 && f2.resolver_disagreements && f2.resolver_disagreements[0].type === "A");

// ---- 6. 答えが無いのは事実が無いのと同じ (2026-09-27、塞がった網で集めて見つけた穴) ----
const dead = async () => { throw new Error("network blocked"); };
const f3 = await collectFact("w.example.com", { fetchImpl: dead, now: () => "2026-09-27T10:00:00Z" });
t("collect: when no resolver answers, the types are recorded as unanswered (not as an empty answer)", JSON.stringify(f3.unanswered) === '["A","AAAA","NS"]' && f3.ips.length === 0);
t("collect: an empty but real answer is not unanswered", !f1.unanswered || !f1.unanswered.includes("AAAA"));
const twoPool = { entries: [E("a.example.org", 1), E("b.example.net", 2)] };
const repDead = await diversityReport(twoPool, { "a.example.org": f3, "b.example.net": f3 });
t("report: facts that are entirely unanswered count as missing (facts_missing, entries_with_facts 0)", repDead.findings.includes("facts_missing") && repDead.entries_with_facts === "0", JSON.stringify(repDead.findings) + " " + repDead.entries_with_facts);
const partial = { ...f1, unanswered: ["AAAA"] };
const repPartial = await diversityReport(twoPool, { "a.example.org": partial, "b.example.net": partial });
t("report: a partially answered fact still counts, and its shared IP still clusters", repPartial.entries_with_facts === "2" && repPartial.control_clusters === "1", repPartial.entries_with_facts + " " + repPartial.control_clusters);
const repA = await diversityReport(twoPool, { "a.example.org": f3, "b.example.net": f3 });
const repB = await diversityReport(twoPool, { "a.example.org": { ...f3, unanswered: undefined }, "b.example.net": { ...f3, unanswered: undefined } });
t("report: unanswered is inside facts_sha256 (a reader can tell 'blocked' from 'empty')", repA.facts_sha256 !== repB.facts_sha256);

console.log(results.join("\n"));
console.log("\nwitness_diversity: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
