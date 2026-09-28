// parity: the JS helpers and the Python helpers (a2a_conduct.py, pip install a2a-conduct-walk) give the same bytes
// for the same input. Every vector goes through both, and the canonical JSON (sorted keys) must match exactly.
// Refusals must refuse on both sides. Needs python3 and the sibling directory ../a2a-conduct-walk.
// Run: node test/parity.test.mjs   Exit 1 on any difference.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ac from "../a2a_conduct.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYDIR = path.resolve(HERE, "../../a2a-conduct-walk");
const O = "https://agent.parity.invalid";
const COMP = { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 0 };
const EPS = [O + "/mcp", O + "/a2a"];

const V = [];
const ext = (comp, eps, opt) => V.push({ op: "extension", comp, eps, opt: opt || {} });
ext(COMP, EPS);
ext({ ...COMP, paid_by: "subscription", success_fee_pct: 12.5, disclosure_url: "https://agent.parity.invalid/pricing" }, [O + "/a2a?x=1&y=(2)!*"]);
ext(COMP, [O + "/a2a"], { conduct_record: "https://rec.parity.invalid/r", witness_intake: "https://w.parity.invalid/w", verdict_recipe: "https://r.invalid/v", consent: { walk: true }, register: "https://reg.invalid", rings: "https://rings.invalid" });
ext(COMP, ["https://hé.parity.invalid/a2a"]);
ext({ ...COMP, paid_by: "Buyer" }, EPS);
ext({ ...COMP, referral_fee: "no" }, EPS);
ext({ ...COMP, listing_fee: null }, EPS);
ext({ ...COMP, success_fee_pct: 101 }, EPS);
ext({ ...COMP, success_fee_pct: "5" }, EPS);
ext(COMP, ["http://x.parity.invalid/a2a"]);
ext(COMP, []);
const EXT = ac.extension(COMP, EPS);
for (const u of [O + "/a2a", O + "/a2a?probe=1#frag", O + "/mcp", "HTTPS://AGENT.Parity.INVALID/a2a", O + ":443/a2a", O + ":8443/a2a", "http://agent.parity.invalid:80/a2a", O, O + "/A2A/"]) V.push({ op: "metadata", served: u });
const H = [{}, { "A2A-Extensions": ac.EXT_URI }, { "a2a-extensions": "https://other.invalid/v1, " + ac.EXT_PERMANENT_ID }, { "X-A2A-Extensions": ac.EXT_URI }, { "X-A2A-Extensions": ac.EXT_URI + "/" }, { "A2A-Extensions": "https://w3id.org/horizonshield/conduct/v2" }, { "Content-Type": "application/json", "x-a2a-extensions": " " + ac.EXT_URI + " " }];
for (const h of H) V.push({ op: "echo", h });
const R = [
  { message: { role: "ROLE_AGENT", messageId: "m", parts: [{ text: "ok" }] } },
  { task: { id: "t", contextId: "c", status: { state: "TASK_STATE_COMPLETED", message: { role: "ROLE_AGENT", messageId: "s", parts: [{ text: "done" }], extensions: ["https://other.invalid/v1"] } } } },
  { kind: "message", role: "agent", messageId: "m", parts: [{ kind: "text", text: "ok" }], metadata: { keep: 1 } },
  { kind: "task", id: "t", contextId: "c", status: { state: "completed" } },
  { kind: "message", role: "agent", messageId: "m", parts: [], extensions: [ac.EXT_URI] },
];
for (const r of R) for (const s of [O + "/a2a", O + "/mcp?q=1"]) V.push({ op: "attach", r, served: s });
const NET = {
  [O + "/.well-known/agent-card.json"]: [200, { name: "p", capabilities: { extensions: [EXT] } }],
  ["https://gate.horizonshield.dev/is-verified?endpoint=" + encodeURIComponent(O + "/mcp")]: [200, { state: "verified", verified: true, record_url: "https://gate.horizonshield.dev/record/aa", history_url: "https://gate.horizonshield.dev/history?endpoint=x" }],
  ["https://noext.parity.invalid/.well-known/agent-card.json"]: [200, { name: "n", compensation: { paid_by: "seller" } }],
  ["https://perma.parity.invalid/.well-known/agent-card.json"]: [200, { capabilities: { extensions: [{ uri: ac.EXT_PERMANENT_ID, params: { measured_endpoints: ["https://perma.parity.invalid/a2a", 7] } }] } }],
  ["https://list.parity.invalid/.well-known/agent-card.json"]: [200, ["not", "an", "object"]],
};
for (const a of [O, O + "/", "https://noext.parity.invalid", "https://perma.parity.invalid", "https://list.parity.invalid", "https://gone.parity.invalid"]) V.push({ op: "preflight", agent: a });

// JS side
const jsOut = [];
for (const v of V) {
  try {
    if (v.op === "extension") {
      const o = v.opt;
      // camelCase options, with absent ones passed as undefined on purpose: undefined must not create a key.
      jsOut.push(ac.extension(v.comp, v.eps, { conductRecord: o.conduct_record, witnessIntake: o.witness_intake, verdictRecipe: o.verdict_recipe, consent: o.consent, register: o.register, rings: o.rings }));
    } else if (v.op === "metadata") jsOut.push(ac.metadata(EXT, v.served));
    else if (v.op === "echo") jsOut.push(ac.echoHeaders(v.h));
    else if (v.op === "attach") jsOut.push(ac.attach(structuredClone(v.r), EXT, v.served));
    else if (v.op === "preflight") jsOut.push(await ac.preflight(v.agent, { getJson: (u) => NET[u] || [404, null] }));
  } catch (e) { jsOut.push({ refused: true }); }
}
// an option passed as undefined must not create the key (found by this test: it did, 2026-09-28)
for (const [i, v] of V.entries()) if (v.op === "extension" && jsOut[i].params) for (const k of ["verdict_recipe", "consent", "register", "rings"]) if (!(k in v.opt) && k in jsOut[i].params) jsOut[i] = { bug: k + " created from undefined" };
// the snake_case spellings are accepted too and give the same bytes
{
  const o = V.find((v) => v.op === "extension" && "rings" in v.opt).opt;
  const a = ac.extension(COMP, [O + "/a2a"], { conductRecord: o.conduct_record, witnessIntake: o.witness_intake, verdict_recipe: o.verdict_recipe, consent: o.consent, register: o.register, rings: o.rings });
  const b = ac.extension(COMP, [O + "/a2a"], { conductRecord: o.conduct_record, witnessIntake: o.witness_intake, verdictRecipe: o.verdict_recipe, consent: o.consent, register: o.register, rings: o.rings });
  if (JSON.stringify(a) !== JSON.stringify(b)) { console.log("DIFF  snake_case and camelCase option spellings"); process.exitCode = 1; }
}

// Python side
const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(PYDIR)})
import a2a_conduct as ac
d = json.load(sys.stdin)
EXT = ac.extension(d["comp"], d["eps"])
NET = d["net"]
out = []
for v in d["vectors"]:
    try:
        if v["op"] == "extension":
            out.append(ac.extension(v["comp"], v["eps"], **v["opt"]))
        elif v["op"] == "metadata":
            out.append(ac.metadata(EXT, v["served"]))
        elif v["op"] == "echo":
            out.append(ac.echo_headers(v["h"]))
        elif v["op"] == "attach":
            out.append(ac.attach(v["r"], EXT, v["served"]))
        elif v["op"] == "preflight":
            out.append(ac.preflight(v["agent"], fetch=lambda u: tuple(NET[u]) if u in NET else (404, None)))
    except ValueError:
        out.append({"refused": True})
print(json.dumps(out, sort_keys=True, separators=(",", ":"), ensure_ascii=False))
`;
const py = spawnSync("python3", ["-c", driver], { input: JSON.stringify({ vectors: V, net: NET, comp: COMP, eps: EPS }), encoding: "utf8" });
if (py.status !== 0) { console.error("python side failed:\n" + py.stderr); process.exit(1); }
const pyOut = JSON.parse(py.stdout);

const canon = (x) => Array.isArray(x) ? "[" + x.map(canon).join(",") + "]" : (x && typeof x === "object") ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}" : JSON.stringify(x);
let fails = 0, refusals = 0;
V.forEach((v, i) => {
  const a = canon(jsOut[i]), b = canon(pyOut[i]);
  if (jsOut[i] && jsOut[i].refused) refusals++;
  const ok = a === b;
  if (!ok) fails++;
  console.log((ok ? "same  " : "DIFF  ") + v.op + " #" + i + (ok ? "" : "\n   js: " + a.slice(0, 400) + "\n   py: " + b.slice(0, 400)));
});
const counts = V.reduce((m, v) => (m[v.op] = (m[v.op] || 0) + 1, m), {});
console.log("\n=== " + (V.length - fails) + " / " + V.length + " identical to a2a_conduct.py (" + Object.entries(counts).map(([k, n]) => k + " " + n).join(", ") + "; refusals on both sides " + refusals + ") ===");
process.exit(fails || process.exitCode ? 1 : 0);
