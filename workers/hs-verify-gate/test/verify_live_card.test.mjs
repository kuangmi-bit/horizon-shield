// verify_live_card.test.mjs (2026-10-07): the deploy gate's card check looks at every signature, in both forms.
//
// Why this exists. The served card carries two signatures by the same key since 0.4.15: one over plain RFC 8785 of
// the card as served (every field), one in the official SDK form (proto round trip, then RFC 8785; fields outside
// the A2A schema are not covered). verify_live_card.mjs used to ask the official SDK one question, "does any
// signature verify", and print whatever the SDK printed. Two things followed. Every deploy showed
// "Signature verification on entry was not successful (JWSSignatureVerificationFailed)" once, for the plain entry,
// which is correct and looked like a fault. And nothing checked the plain entry at all: a card whose `compensation`
// (who pays the operator, a field outside the schema) was edited after signing still came out VERIFIED.
//
// fixtures_live_card/ holds the card and JWKS that gate.horizonshield.dev served on 2026-10-07 (version 0.4.20).
// They are public bytes. The suite never contacts the network and never signs anything.
// Run: node test/verify_live_card.test.mjs   (in workers/hs-verify-gate)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(HERE, "..", "verify_live_card.mjs");
const FIX = path.join(HERE, "fixtures_live_card");
const CARD = JSON.parse(readFileSync(path.join(FIX, "card.json"), "utf8"));
const JWKS = path.join(FIX, "jwks.json");
const TMP = mkdtempSync(path.join(tmpdir(), "verify-live-card-"));

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log((ok ? "ok   " : "NG   ") + name + (ok || detail === undefined ? "" : "  <<< " + detail));
};
const clone = () => JSON.parse(JSON.stringify(CARD));
const flip = (s) => (s[0] === "A" ? "B" : "A") + s.slice(1);
let n = 0;
function run(card, extra = []) {
  const p = path.join(TMP, "card" + (++n) + ".json");
  writeFileSync(p, JSON.stringify(card));
  const r = spawnSync(process.execPath, [TOOL, "--card", p, "--jwks", JWKS, ...extra], { encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

t("the fixture is the two-signature card", Array.isArray(CARD.signatures) && CARD.signatures.length === 2);

let r = run(clone());
t("the served card: VERIFIED, exit 0", r.code === 0 && /^VERIFIED/m.test(r.out), r.out.slice(0, 300));
t("it says which signature verifies in which form", /signature\[0\]\s+verifies over plain RFC 8785/.test(r.out) && /signature\[1\]\s+verifies in the official SDK form/.test(r.out), r.out);
t("the SDK's own per-entry message is not passed through as if it were a fault", !/JWSSignatureVerificationFailed|ERR_JWS_SIGNATURE_VERIFICATION_FAILED/.test(r.out), r.out.slice(0, 300));
t("the message is explained instead", /Signature verification on entry was not successful/.test(r.out));

let c = clone(); c.signatures.reverse(); r = run(c);
t("order does not matter: swapped signatures still VERIFIED", r.code === 0 && /signature\[0\]\s+verifies in the official SDK form/.test(r.out), r.out);

c = clone(); c.signatures[0].signature = flip(c.signatures[0].signature); r = run(c);
t("a broken plain signature is INVALID (it used to pass unseen)", r.code === 1 && /signature\[0\]\s+VERIFIES IN NEITHER FORM/.test(r.out), r.out);

c = clone(); c.signatures[1].signature = flip(c.signatures[1].signature); r = run(c);
t("a broken SDK-form signature is INVALID", r.code === 1 && /signature\[1\]\s+VERIFIES IN NEITHER FORM/.test(r.out), r.out);

c = clone(); c.compensation = { ...c.compensation, paid_by: c.compensation.paid_by === "seller" ? "buyer" : "seller" }; r = run(c);
t("compensation edited after signing is INVALID (outside the schema, only the plain signature covers it)", r.code === 1 && /signature\[0\]\s+VERIFIES IN NEITHER FORM/.test(r.out) && /signature\[1\]\s+verifies in the official SDK form/.test(r.out), r.out);

c = clone(); c.description = c.description + " x"; r = run(c);
t("a schema field edited after signing breaks both signatures", r.code === 1 && (r.out.match(/VERIFIES IN NEITHER FORM/g) || []).length === 2, r.out);

c = clone(); c.signatures = [c.signatures[1]]; r = run(c);
t("a card with only the SDK-form signature is VERIFIED (older versions, other origins)", r.code === 0 && /^VERIFIED/m.test(r.out), r.out);

c = clone(); c.signatures = [c.signatures[0]]; r = run(c);
t("a card with only the plain signature is INVALID: an official SDK verifier would refuse it", r.code === 1 && /official SDK, whole card/.test(r.out), r.out);

c = clone(); c.signatures = []; r = run(c);
t("a card with no signatures is INVALID", r.code === 1 && /carries no signatures/.test(r.out), r.out);

r = run(clone(), ["--expect-version", CARD.version]);
t("--expect-version with the served version passes", r.code === 0, r.out.slice(0, 200));
r = run(clone(), ["--expect-version", "9.9.9"]);
t("--expect-version with another version is INVALID", r.code === 1 && /is not the expected 9\.9\.9/.test(r.out), r.out.slice(0, 200));

rmSync(TMP, { recursive: true, force: true });
console.log("");
if (fail) { console.log("FAIL " + fail + " of " + (pass + fail) + " (verify_live_card)"); process.exit(1); }
console.log("PASS " + pass + "/" + pass + " (verify_live_card: every signature is checked, in both forms)");
process.exit(0);
