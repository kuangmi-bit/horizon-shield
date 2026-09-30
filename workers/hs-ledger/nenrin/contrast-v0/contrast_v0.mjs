// nenrin-contrast-v0: what an agent's operator attested (a TRACE Trust Record) set beside what an outside
// runner observed (an a2a-conduct-walk record), facet by facet, for the same subject.
//
// The two records answer different questions. TRACE says what ran, where and under which policy, signed by a
// key the record itself carries. A walk says what the endpoint answered, from where and when, filed by a
// witness the agent did not choose. Most of TRACE is out of an outside runner's sight (model, measurement,
// policy), and this module says so by name instead of pretending to compare it. Three facets can be seen from
// both sides: the host the subject names, the confirmation key, and the time.
//
// The observed side only ever uses bytes the walk already committed to: every supporting document (an agent
// card, a DID document, a key file) must hash to a response body_sha256 inside the walk. So a contrast adds no
// new trust in whoever assembles it. The record carries no clock of its own; anyone holding the three inputs
// rebuilds it byte for byte, which is what verifyContrast does.
import { jcs, checkTraceRecord, Refusal } from "../trace-pin-v0/trace_pin_v0.mjs";

export const CONTRAST_SCHEMA = "nenrin-contrast-v0";
export const WALK_SCHEMA = "jidec-path-v1";
export const TRACE_WINDOW_SECONDS = 86400; // TRACE 3.2.2 default maximum record age
export const MAX_SUPPORT = 8;
export const MAX_SUPPORT_BYTES = 262144;
export const VERDICTS = ["match", "differ", "attested_only", "not_comparable"];

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

async function sha256hexBytes(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64urlEncode(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64Decode(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58Decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === "1") bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
}

// RFC 7638 thumbprints: the required members in lexicographic order, no whitespace, sha256, base64url.
async function thumbprint(jwk) {
  let m;
  if (jwk.kty === "OKP" && typeof jwk.crv === "string" && typeof jwk.x === "string")
    m = '{"crv":' + JSON.stringify(jwk.crv) + ',"kty":"OKP","x":' + JSON.stringify(jwk.x) + "}";
  else if (jwk.kty === "EC" && typeof jwk.crv === "string" && typeof jwk.x === "string" && typeof jwk.y === "string")
    m = '{"crv":' + JSON.stringify(jwk.crv) + ',"kty":"EC","x":' + JSON.stringify(jwk.x) + ',"y":' + JSON.stringify(jwk.y) + "}";
  else return null;
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(m))));
}
const okpFromRaw = (raw) => (raw && raw.length === 32 ? { kty: "OKP", crv: "Ed25519", x: b64urlEncode(raw) } : null);

// Every key a published document states, in the spellings agents actually use: a JWK anywhere in the tree,
// a JWS protected header that carries one (A2A card signatures), the walk tool's own key file, and a DID
// verification method in Ed25519 multibase. Anything else is not a key to this module.
export async function keysIn(doc) {
  const found = new Set();
  const add = async (jwk) => { const t = jwk ? await thumbprint(jwk) : null; if (t) found.add(t); };
  const walk = async (v, depth) => {
    if (depth > 32) return;
    if (Array.isArray(v)) { for (const x of v) await walk(x, depth + 1); return; }
    if (!isObj(v)) return;
    if (typeof v.kty === "string") await add(v);
    if (typeof v.protected === "string") {
      try { const h = JSON.parse(dec.decode(b64Decode(v.protected))); if (isObj(h) && isObj(h.jwk)) await add(h.jwk); } catch (_e) { /* not a JWS header */ }
    }
    if (typeof v.public_key_ed25519_b64 === "string") {
      try { await add(okpFromRaw(b64Decode(v.public_key_ed25519_b64))); } catch (_e) { /* not base64 */ }
    }
    if (typeof v.publicKeyMultibase === "string" && v.publicKeyMultibase.startsWith("z")) {
      const b = b58Decode(v.publicKeyMultibase.slice(1));
      if (b && b.length === 34 && b[0] === 0xed && b[1] === 0x01) await add(okpFromRaw(b.slice(2)));
    }
    for (const k of Object.keys(v)) await walk(v[k], depth + 1);
  };
  await walk(doc, 0);
  return [...found].sort();
}

// ---- inputs -----------------------------------------------------------------------------------------------
function checkWalk(walk) {
  if (!isObj(walk)) throw new Refusal("walk_not_object", "the walk record must be a JSON object");
  if (walk.schema !== WALK_SCHEMA) throw new Refusal("walk_schema", "the walk record's schema must be " + WALK_SCHEMA);
  let base;
  try { base = new URL(walk.base); } catch (_e) { throw new Refusal("walk_base", "walk.base must be an absolute URL"); }
  if (base.protocol !== "https:") throw new Refusal("walk_base", "walk.base must be https");
  if (typeof walk.walked_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(walk.walked_at))
    throw new Refusal("walk_time", "walk.walked_at must be an ISO 8601 UTC time ending in Z");
  if (!Array.isArray(walk.nodes)) throw new Refusal("walk_nodes", "walk.nodes must be an array");
  return { host: base.host, epoch: Math.floor(Date.parse(walk.walked_at) / 1000) };
}
function asBytes(s) {
  if (s instanceof Uint8Array) return s;
  if (typeof s === "string") return enc.encode(s);
  throw new Refusal("support_type", "a supporting document is given as bytes or as the exact text the endpoint served");
}

// What the subject says about a host. did:web is a DNS name by construction (the DID resolves over https at
// that host), so a different host is a real difference. A SPIFFE trust domain is not required to be a DNS name,
// so it only matches when it is the host or a parent of it, and otherwise is not comparable. Other DID methods
// name no host.
export function subjectHost(subject) {
  if (subject.startsWith("did:web:")) {
    const first = subject.slice(8).split(":")[0];
    let host; try { host = decodeURIComponent(first).toLowerCase(); } catch (_e) { host = null; }
    return host ? { kind: "did:web", host } : { kind: "did:web", host: null };
  }
  if (subject.startsWith("spiffe://")) {
    const td = subject.slice(9).split("/")[0].toLowerCase();
    return { kind: "spiffe", host: td || null };
  }
  return { kind: subject.split(":").slice(0, 2).join(":"), host: null };
}

// ---- the contrast -----------------------------------------------------------------------------------------
export const ESTABLISHES = [
  "the TRACE record's Ed25519 signature verified under its own cnf.jwk over its RFC 8785 form without the signature member",
  "every supporting document hashes to a response body_sha256 inside the walk, so the observed side uses only bytes the witness already committed to",
  "given the same three inputs, anyone rebuilds this record byte for byte; it carries no clock and no judgment of its own",
];
export const DOES_NOT_ESTABLISH = [
  "that either side is telling the truth: a match is two statements agreeing, a difference is two statements disagreeing, and neither says which is right",
  "that the confirmation key belongs to the subject; a match shows the endpoint published the same key the record carries, as served on the day of the walk",
  "anything about the members an outside runner cannot see (listed in not_compared)",
  "whether the walk was signed and under which domain; read that from the ledger entry of observed.record_sha256",
  "who assembled the contrast; anyone holding the inputs can",
];
export const NOT_COMPARED = [
  ["model", "a walk sees the endpoint's answers, not the model behind them"],
  ["runtime", "a hardware measurement is visible only to an attestation verifier, not over https"],
  ["policy", "the policy bundle is not served by the endpoint a walk measures"],
  ["data_class", "a label for the data the workload handles; nothing on the wire states it"],
  ["build_provenance", "the build digest is not what the endpoint answers with"],
  ["appraisal", "another verifier's conclusion; a walk does not appraise"],
  ["tool_transcript", "the transcript of calls the workload made; a walk sees the calls it made itself"],
];

export async function buildContrast({ trace, walk, supporting = [] }) {
  if (!isObj(trace)) throw new Refusal("record_not_object", "the TRACE record must be a JSON object");
  // Freshness is a facet here, not a gate: the pin already refuses postdated records, and an old record is
  // exactly what a contrast may be about. So the check runs at the record's own iat.
  const t = await checkTraceRecord(trace, Number.isInteger(trace.iat) ? trace.iat : 0);
  const w = checkWalk(walk);
  if (!Array.isArray(supporting) || supporting.length > MAX_SUPPORT)
    throw new Refusal("support_count", "supporting is a list of at most " + MAX_SUPPORT + " documents");

  const committed = new Map();
  for (const n of walk.nodes) {
    if (isObj(n) && n.kind === "fetch" && isObj(n.response) && typeof n.response.body_sha256 === "string" && !committed.has(n.response.body_sha256))
      committed.set(n.response.body_sha256, n);
  }
  const support = new Map();
  for (const s of supporting) {
    const bytes = asBytes(s);
    if (bytes.length > MAX_SUPPORT_BYTES) throw new Refusal("support_too_large", "a supporting document is capped at " + MAX_SUPPORT_BYTES + " bytes");
    const sha = await sha256hexBytes(bytes);
    const node = committed.get(sha);
    if (!node) throw new Refusal("support_not_committed", "supporting document " + sha + " matches no response body_sha256 in the walk; the observed side may only use bytes the witness committed to");
    if (support.has(sha)) continue;
    let doc;
    try { doc = JSON.parse(dec.decode(bytes)); } catch (_e) { throw new Refusal("support_not_json", "supporting document " + sha + " is not UTF-8 JSON"); }
    support.set(sha, { sha256: sha, node: node.n, url: isObj(node.request) && typeof node.request.url === "string" ? node.request.url : null, keys_found: await keysIn(doc) });
  }
  const supportList = [...support.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
  const observedKeys = [...new Set(supportList.flatMap((s) => s.keys_found))].sort();

  const facets = [];
  const sh = subjectHost(trace.subject);
  if (sh.host === null) {
    facets.push({ facet: "subject_host", attested: trace.subject, observed: w.host, verdict: "not_comparable",
      why: sh.kind + " names no host, so the subject cannot be set beside the host the witness walked" });
  } else if (sh.kind === "did:web") {
    const same = sh.host === w.host;
    facets.push({ facet: "subject_host", attested: sh.host, observed: w.host, verdict: same ? "match" : "differ",
      why: same ? "the did:web subject resolves at the host the witness walked"
                : "the did:web subject resolves at another host than the one the witness walked; the record may describe a different workload" });
  } else {
    const same = w.host === sh.host || w.host.split(":")[0].endsWith("." + sh.host);
    facets.push({ facet: "subject_host", attested: sh.host, observed: w.host, verdict: same ? "match" : "not_comparable",
      why: same ? "the SPIFFE trust domain is the walked host or a parent of it"
                : "a SPIFFE trust domain need not be a DNS name, so a different name is not a contradiction" });
  }

  if (!supportList.length || !observedKeys.length) {
    facets.push({ facet: "confirmation_key", attested: t.key_thumbprint, observed: null, verdict: "attested_only",
      why: supportList.length ? "none of the committed documents states a key" : "no committed document was supplied" });
  } else {
    const hit = observedKeys.includes(t.key_thumbprint);
    facets.push({ facet: "confirmation_key", attested: t.key_thumbprint, observed: observedKeys, verdict: hit ? "match" : "differ",
      why: hit ? "the endpoint published the key that signed the record, in bytes the witness committed to"
               : "the endpoint published keys, none of them the one that signed the record; it may use separate keys, or the record may come from elsewhere" });
  }

  const gap = w.epoch - t.iat;
  const within = Math.abs(gap) <= TRACE_WINDOW_SECONDS;
  facets.push({ facet: "time", attested: t.iat, observed: w.epoch, gap_seconds: gap, verdict: within ? "match" : "differ",
    why: within ? "the walk falls inside the 24 hour window TRACE 3.2.2 gives a record"
                : "the walk falls outside the 24 hour window TRACE 3.2.2 gives a record; the two describe different days" });

  const summary = { match: 0, differ: 0, attested_only: 0, not_comparable: 0 };
  for (const f of facets) summary[f.verdict] += 1;

  return {
    schema: CONTRAST_SCHEMA,
    attested: { source: "trace-v0.2", record_sha256: t.sha, subject: trace.subject, iat: t.iat, key_thumbprint: t.key_thumbprint, transparency: t.transparency },
    observed: {
      source: "a2a-conduct-walk", record_sha256: await sha256hexBytes(enc.encode(jcs(walk))), base: walk.base, walked_at: walk.walked_at,
      witness: isObj(walk.witness) && typeof walk.witness.name === "string" ? walk.witness.name : null,
      vantage: isObj(walk.witness) && typeof walk.witness.vantage === "string" ? walk.witness.vantage : null,
      supporting: supportList,
    },
    facets,
    summary,
    not_compared: NOT_COMPARED.map(([member, why]) => ({ member, why })),
    establishes: ESTABLISHES,
    does_not_establish: DOES_NOT_ESTABLISH,
  };
}

export async function contrastSha(record) { return sha256hexBytes(enc.encode(jcs(record))); }

// Rebuild from the inputs and compare the RFC 8785 bytes. A refusal while rebuilding is a failed verification.
export async function verifyContrast(record, inputs) {
  let rebuilt;
  try { rebuilt = await buildContrast(inputs); } catch (e) { return { ok: false, reason: e instanceof Refusal ? e.code : "error", detail: e.message }; }
  const a = jcs(record), b = jcs(rebuilt);
  if (a !== b) {
    const diffs = [];
    for (const k of new Set([...Object.keys(record || {}), ...Object.keys(rebuilt)]))
      if (jcs(record?.[k] ?? null) !== jcs(rebuilt[k] ?? null)) diffs.push(k);
    return { ok: false, reason: "mismatch", diffs };
  }
  return { ok: true, sha256: await contrastSha(rebuilt) };
}
