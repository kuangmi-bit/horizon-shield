// vouch_pin_v0.test.mjs: the Vouch pin intake against credentials made by Vouch Protocol's own SDK (fixtures/
// gen_fixtures.py, vouch-protocol 2.2.1): its commit_outcome, attest_outcome, Signer and verify_proof. So "this ledger
// reads Vouch" is tested against the other implementation's bytes and answers.
// Offline. Run: node nenrin/vouch-pin-v0/vouch_pin_v0.test.mjs   (in workers/hs-ledger)   exit 1 on any failure.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkVouchCredential, anchorEntry, handleVouchPin, anchorVouchPinPool, b58decode, BATCH_MAX } from "./vouch_pin_v0.mjs";
import { Refusal } from "../trace-pin-v0/trace_pin_v0.mjs";

const FX = JSON.parse(readFileSync(new URL("./fixtures/vouch_fixtures.json", import.meta.url), "utf8"));

// the ledger's clock in these tests: a minute after the latest proof.created in the fixtures (they are signed when made)
const NOW = Math.max(...FX.cases.map((c) => Math.floor(Date.parse(c.credential.proof.created) / 1000))) + 60;
const R = [];
const t = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: String(detail) });
const sha = (s) => createHash("sha256").update(typeof s === "string" ? Buffer.from(s, "utf8") : s).digest("hex");
const clone = (x) => JSON.parse(JSON.stringify(x));
const C = Object.fromEntries(FX.cases.map((c) => [c.name, c]));

// a did:web resolver that serves the fixture documents, and can be told to misbehave
function fetchFx(opts = {}) {
  return async (u, init) => {
    if (opts.throws) throw new Error("connection refused");
    if (opts.redirect) return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/did.json" } });
    if (init && init.redirect !== "manual") return new Response("redirects must not be followed", { status: 500 });
    const host = new URL(u).host;
    const did = "did:web:" + host;
    let doc = FX.did_documents[did];
    if (!doc) return new Response("not found", { status: 404 });
    if (opts.mutate) doc = opts.mutate(clone(doc));
    return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
  };
}
async function refusal(cred, o = {}) {
  try { await checkVouchCredential(cred, { nowSec: NOW, fetchImpl: fetchFx(), ...o }); return null; }
  catch (e) { return e instanceof Refusal ? e.code : "THREW:" + e.message; }
}

// ---- every credential Vouch made is read, and pinned under Vouch's own JCS digest --------------------------
for (const c of FX.cases) {
  t(c.name + ": Vouch's own verify_proof accepted it (fixture sanity)", c.vouch_verify_proof === true);
  let r = null, err = null;
  try { r = await checkVouchCredential(clone(c.credential), { nowSec: NOW, fetchImpl: fetchFx() }); } catch (e) { err = e; }
  t(c.name + ": accepted here", r && !err, err && err.message);
  t(c.name + ": pinned sha == sha256 of Vouch's JCS of the whole credential", r && r.sha === c.vouch_jcs_sha256, r && r.sha);
  t(c.name + ": the key resolved here is the issuer's key", r && r.public_key_b64 === c.issuer_public_key_b64);
  t(c.name + ": record_jcs hashes to the sha (what ?format=raw serves)", r && sha(r.record_jcs) === r.sha);
  const want = c.name.startsWith("legacy") ? "vouch-pre-alignment-digest" : "w3c-vc-di-eddsa-hashdata";
  t(c.name + ": proof rule recorded as " + want, r && r.proof_rule === want, r && r.proof_rule);
}
{
  const r = await checkVouchCredential(clone(C.commitment_didkey.credential), { nowSec: NOW });
  t("commitment_didkey: Vouch's verify_commitment and claims_precedence were true (fixture sanity)", C.commitment_didkey.vouch_verify_commitment && C.commitment_didkey.vouch_claims_precedence);
  t("commitment_didkey: the intake sees that it names this ledger as its anchor, pre-outcome-ordering", r.names_this_ledger_as_anchor && r.anchor_establishes[0] === "pre-outcome-ordering", JSON.stringify(r.anchor_establishes));
  const fxAnchor = C.commitment_didkey.credential.credentialSubject.commitment.anchor[0];
  const mine = anchorEntry(C.commitment_didkey.credential.id, { establishes: "pre-outcome-ordering" });
  t("anchorEntry here is the entry vouch.accountability.timestamp_anchor built in the fixture, member for member", JSON.stringify(mine, Object.keys(mine).sort()) === JSON.stringify(fxAnchor, Object.keys(fxAnchor).sort()), JSON.stringify(mine));
  const w = await checkVouchCredential(clone(C.commitment_didweb_jwk.credential), { nowSec: NOW, fetchImpl: fetchFx() });
  t("did:web: the document's sha256 at intake is recorded", w.did_document_sha256 === sha(JSON.stringify(FX.did_documents["did:web:witness-jwk.example.org"])) && w.did_document_url === "https://witness-jwk.example.org/.well-known/did.json");
}

// ---- refusals, each by its own code ------------------------------------------------------------------------
const base = C.commitment_didkey.credential;
{
  const x = clone(base); x.credentialSubject.claim.verdict = "no";
  t("an edited claim: signature_invalid", (await refusal(x)) === "signature_invalid");
  const y = clone(base); y.validFrom = "2026-10-01T00:00:00Z";
  t("a back-dated validFrom: signature_invalid", (await refusal(y)) === "signature_invalid");
  const z = clone(base); z.issuer = "did:web:vouch-protocol.com";
  t("issuer swapped for another identity, proof by the original key: verification_method_not_issuer", (await refusal(z)) === "verification_method_not_issuer");
  const s = clone(base); s.proof.verificationMethod = "did:key:z" + "6Mk" + "x".repeat(10) + "#key-1"; s.issuer = s.proof.verificationMethod.split("#")[0];
  t("a did:key that is not an Ed25519 Multikey: bad_multikey or unsupported_key_type", ["bad_base58", "unsupported_key_type"].includes(await refusal(s)), await refusal(s));
  // the identity point as a did:key: small order, any signature verifies under it; refused before the signature
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const enc58 = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s2 = ""; while (n > 0n) { s2 = B58[Number(n % 58n)] + s2; n /= 58n; } for (const b of bytes) { if (b) break; s2 = "1" + s2; } return s2; };
  const ident = new Uint8Array(34); ident[0] = 0xed; ident[1] = 0x01; ident[2] = 1;
  const weak = clone(base); const wd = "did:key:z" + enc58(ident); weak.issuer = wd; weak.proof.verificationMethod = wd + "#key-1";
  weak.proof.proofValue = "z" + enc58(new Uint8Array(64).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
  t("a small-order did:key (the identity point) with the identity signature: weak_key", (await refusal(weak)) === "weak_key", await refusal(weak));
  t("b58decode round trip of a real did:key", b58decode(base.issuer.slice("did:key:z".length)).length === 34);
  t("proof.created 20 minutes after the ledger's clock: created_in_future", (await refusal(clone(base), { nowSec: NOW - 1500 })) === "created_in_future");
  const cs = clone(base); cs.proof.cryptosuite = "ecdsa-jcs-2019";
  t("another cryptosuite: unsupported_cryptosuite", (await refusal(cs)) === "unsupported_cryptosuite");
  const np = clone(base); delete np.proof;
  t("no proof: no_proof", (await refusal(np)) === "no_proof");
  const nt = clone(base); nt.type = ["OutcomeCommitmentCredential"];
  t("type without VerifiableCredential: not_a_verifiable_credential", (await refusal(nt)) === "not_a_verifiable_credential");
  const ion = clone(base); ion.issuer = "did:ion:abc"; ion.proof.verificationMethod = "did:ion:abc#key-1";
  t("did:ion: did_method_not_read_in_v0", (await refusal(ion)) === "did_method_not_read_in_v0");
  const big = clone(base); big.credentialSubject.pad = "x".repeat(70000);
  t("over 64 KiB: too_large", (await refusal(big)) === "too_large");
}
{
  const w = C.commitment_didweb_jwk.credential;
  t("did:web host unreachable: did_web_unreachable", (await refusal(clone(w), { fetchImpl: fetchFx({ throws: true }) })) === "did_web_unreachable");
  t("did:web answering with a redirect: not followed, did_web_unreachable", (await refusal(clone(w), { fetchImpl: fetchFx({ redirect: true }) })) === "did_web_unreachable");
  t("did:web document naming another id: did_document_id_mismatch", (await refusal(clone(w), { fetchImpl: fetchFx({ mutate: (d) => ({ ...d, id: "did:web:other.example" }) }) })) === "did_document_id_mismatch");
  t("did:web key listed but not under assertionMethod: not_an_assertion_method", (await refusal(clone(w), { fetchImpl: fetchFx({ mutate: (d) => ({ ...d, assertionMethod: [] }) }) })) === "not_an_assertion_method");
  t("did:web document whose key was rotated: signature_invalid", (await refusal(clone(w), { fetchImpl: fetchFx({ mutate: (d) => { d.verificationMethod[0].publicKeyJwk = FX.did_documents["did:web:witness-jwk.example.org"].verificationMethod[0].publicKeyJwk; d.verificationMethod[0].publicKeyJwk = { ...d.verificationMethod[0].publicKeyJwk, x: Buffer.from(Buffer.from(C.commitment_didkey.issuer_public_key_b64, "base64")).toString("base64url") }; return d; } }) })) === "signature_invalid");
  for (const bad of ["did:web:example.org%3A8443", "did:web:example.org:users:alice", "did:web:127.0.0.1", "did:web:localhost", "did:web:host.internal"]) {
    const x = clone(w); x.issuer = bad; x.proof.verificationMethod = bad + "#key-1";
    const code = await refusal(x);
    t("did:web " + bad + ": refused (" + code + ")", ["did_web_form_not_read_in_v0", "did_web_host_not_public"].includes(code), code);
  }
}

// ---- the HTTP surface on a fake KV: pin, dedup, equivocation under one id, raw bytes, batch oldest first -------
function fakeEnv() {
  const m = new Map();
  return { m, LEDGER: {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "", cursor } = {}) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0, page = all.slice(start, start + 1000);
      const done = start + 1000 >= all.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 1000) };
    },
  } };
}
const ORIGIN = "https://ledger.horizonshield.dev";
const call = async (env, method, path, body, now = NOW, ip = "203.0.113.7") => {
  const url = new URL(ORIGIN + path);
  const req = new Request(url, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: body ? JSON.stringify(body) : undefined });
  const res = await handleVouchPin(url.pathname, req, url, env, ORIGIN, now, fetchFx());
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_e) {}
  return { status: res.status, json, text };
};
{
  const env = fakeEnv();
  const a = await call(env, "POST", "/evidence/vouch", { credential: clone(C.commitment_didkey.credential) });
  t("POST a Vouch commitment: 201 pending under Vouch's JCS sha", a.status === 201 && a.json.sha === C.commitment_didkey.vouch_jcs_sha256 && a.json.status === "pending", a.text.slice(0, 200));
  const again = await call(env, "POST", "/evidence/vouch", { credential: clone(C.commitment_didkey.credential) });
  t("POST it again: dedup, not a second pin", again.status === 200 && again.json.dedup === true);
  const b = await call(env, "POST", "/evidence/vouch", { credential: clone(C.commitment_didkey_same_id_other_verdict.credential) }, NOW + 60);
  t("the opposite verdict under the same id: pinned, and the receipt names the other credential under this id", b.status === 201 && b.json.other_credentials_pinned_under_this_id.length === 1 && b.json.other_credentials_pinned_under_this_id[0] === a.json.sha);
  const byId = await call(env, "GET", "/evidence/vouch/id/" + encodeURIComponent(C.commitment_didkey.credential.id));
  t("GET by id lists both, oldest first, and names the issuer that signed two credentials under one id",
    byId.status === 200 && byId.json.count === 2 && byId.json.pins[0].sha === a.json.sha && byId.json.issuers_with_more_than_one_credential_under_this_id[0] === C.commitment_didkey.credential.issuer, byId.text.slice(0, 300));
  const raw = await call(env, "GET", "/evidence/vouch/" + a.json.sha + "?format=raw");
  t("?format=raw serves bytes whose sha256 is the pin, and which parse back to the credential Vouch signed", sha(raw.text) === a.json.sha && JSON.stringify(JSON.parse(raw.text).proof) === JSON.stringify(C.commitment_didkey.credential.proof));
  const bad = clone(C.commitment_didkey.credential); bad.credentialSubject.claim.verdict = "maybe";
  const r = await call(env, "POST", "/evidence/vouch", { credential: bad });
  t("POST an edited credential: 422 refused with reason_code signature_invalid", r.status === 422 && r.json.reason_code === "signature_invalid");
  const pend = await call(env, "GET", "/evidence/vouch/pending");
  t("pending lists the two, oldest first", pend.json.count === 2 && pend.json.pending[0].sha === a.json.sha);
  const an = await anchorVouchPinPool(env, ORIGIN, "test", "2026-10-10T00:30:00Z");
  const entry = JSON.parse(env.m.get("entry:" + an.body.n));
  const batch = JSON.parse(entry.record_canonical);
  t("the daily batch lists both shas, oldest first, under nenrin-vouch-pin-batch-v0, and its claim is sha256 of the batch bytes",
    batch.schema === "nenrin-vouch-pin-batch-v0" && batch.records.map((x) => x.sha).join() === [a.json.sha, b.json.sha].join() && entry.claim_sha256 === sha(entry.record_canonical));
  const got = await call(env, "GET", "/evidence/vouch/" + a.json.sha);
  t("after the batch: status anchored, with the ledger entry named", got.json.status === "anchored" && got.json.anchor.ledger_entry === an.body.n);
  const self = await call(env, "GET", "/evidence/vouch");
  t("GET /evidence/vouch describes itself with the anchor entry to put in commit_outcome", self.json.vouch_anchor_entry.method === "nenrin-opentimestamps");
}
{
  // R3-2 from the start: more than BATCH_MAX pending, spread over KV pages, the oldest go first and one is left
  const env = fakeEnv();
  const n = BATCH_MAX + 1;
  for (let i = 0; i < n; i++) {
    const s = sha("cred" + i);
    env.m.set("vpin:pending:" + s, JSON.stringify({ sha: s, issuer: "did:key:x", credential_id_sha256: null, proof_created: null, received_at: new Date(Date.UTC(2026, 9, 9, 0, 0, n - i)).toISOString() }));
  }
  const an = await anchorVouchPinPool(env, ORIGIN, "test", "2026-10-10T00:30:00Z");
  const batch = JSON.parse(JSON.parse(env.m.get("entry:" + an.body.n)).record_canonical);
  const newest = sha("cred0");
  t("201 pending: a batch of " + BATCH_MAX + " oldest first, 1 remaining, and the one left is the newest", an.body.anchored === BATCH_MAX && an.body.remaining === 1 && !batch.records.some((x) => x.sha === newest) && env.m.has("vpin:pending:" + newest));
}

const bad = R.filter((r) => !r.ok);
for (const r of R) console.log((r.ok ? "ok    " : "FAIL  ") + r.name + (r.ok ? "" : "  [" + r.detail + "]"));
console.log("\n" + (R.length - bad.length) + "/" + R.length + " passed");
process.exit(bad.length ? 1 : 0);
