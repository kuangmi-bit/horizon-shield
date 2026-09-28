// response_v0.mjs : the measured party's reply, shown beside the measurement (record-privacy-v1, class A).
//
// RECORD_PRIVACY_v1.md says adverse facts are published "always with the subject's response when there is one".
// Until now there was no way to give one. This is that way: the operator of a measured endpoint signs a short
// statement about named measurements, with a key served on its own domain, and the ledger shows it wherever those
// measurements are shown. The ledger does not judge the statement, edit it, or rank it against the measurement.
//
// A response (nenrin-response-v0) is canonical JSON, submitted as the exact text:
//   { schema: "nenrin-response-v0",
//     subject_origin: "https://api.agent.example",          the measured party: an https origin, no path
//     about: [ { kind: "witness" | "gate", sha256 } ],       1..16 measurements it answers
//     text: "...",                                           1..2000 characters, the statement itself
//     responded_at: "2026-09-28T07:00:00Z",                  the subject's own clock
//     key_url: "https://api.agent.example/keys/...",         serves {public_key_ed25519_b64}, on the subject's domain
//     public_key_ed25519_b64: "..." }
// with signature_ed25519_b64 over UTF-8("nenrin-response-v0\n" + record_canonical).
//
// Who may respond: only the party the measurement is about. The key must be served from a host related to the
// subject (the same host, or one under the other), and every named measurement must have measured that subject:
// a witness walk's endpoint, or a gate verdict's endpoint, must sit on a related host. Nobody can answer for
// someone else, and nobody can attach a statement to a measurement of a different party.
//
// What it does not do (v0): it is not anchored to Bitcoin (responded_at is the subject's claim; the signature and
// the key on the subject's domain attribute it); it never changes a verdict, a count or a résumé hash; it is not a
// dispute process. It is the subject's own words, placed next to the record they answer.
//
// Routes: POST /response, GET /response/<sha>, GET /response?about=<sha>, GET /response?subject=<https origin>.
// KV: resp:rec:<sha>, resp:about:<measurement sha>:<sha>, resp:host:<host>:<sha>, resp:cap:<day>:<host>, resp:count:<day>.

import { parseStrict } from "../task-delegation-bind-v0/strict_json.mjs";
import { canonical, isPublicSurface, sha256hex } from "../task-delegation-bind-v0/task_ledger_v0.mjs";

export const RESPONSE_SCHEMA = "nenrin-response-v0";
export const RESPONSE_CONTEXT = "nenrin-response-v0\n";
export const RESPONSE_MAX_BYTES = 8192;
export const RESPONSE_TEXT_MAX = 2000;
export const RESPONSE_ABOUT_MAX = 16;
export const RESPONSE_DAILY_PER_HOST = 10;
export const RESPONSE_DAILY_GLOBAL = 200;
const FIELDS = ["about", "key_url", "public_key_ed25519_b64", "responded_at", "schema", "subject_origin", "text"];
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const enc = new TextEncoder();

function j(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}
function hostOf(u) { try { const x = new URL(u); return x.protocol === "https:" ? x.hostname.toLowerCase() : null; } catch { return null; } }
export function related(a, b) { return !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a)); }
function b64ToBytes(b64) {
  try { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch { return null; }
}
async function ed25519Verify(pubB64, sigB64, msg) {
  const pub = b64ToBytes(pubB64), sig = b64ToBytes(sigB64);
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(msg));
  } catch { return false; }
}

// Pure shape check of a parsed response. Returns null or { code, why }.
export function shapeProblem(r, nowMs) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return { code: "bad_record", why: "the response must be a JSON object" };
  const extra = Object.keys(r).filter((k) => !FIELDS.includes(k)).sort();
  if (extra.length) return { code: "unknown_field", why: "fields not in nenrin-response-v0: " + JSON.stringify(extra) };
  if (r.schema !== RESPONSE_SCHEMA) return { code: "bad_schema", why: "schema must be " + RESPONSE_SCHEMA };
  if (typeof r.subject_origin !== "string" || !isPublicSurface(r.subject_origin) || new URL(r.subject_origin).origin !== r.subject_origin)
    return { code: "bad_subject", why: "subject_origin must be an https origin on a public host, with no path (https://api.agent.example)" };
  if (!Array.isArray(r.about) || r.about.length < 1 || r.about.length > RESPONSE_ABOUT_MAX)
    return { code: "bad_about", why: "about must list 1 to " + RESPONSE_ABOUT_MAX + " measurements" };
  const seen = new Set();
  for (const a of r.about) {
    if (!a || typeof a !== "object" || Object.keys(a).sort().join() !== "kind,sha256" || !["witness", "gate"].includes(a.kind) || typeof a.sha256 !== "string" || !HEX64.test(a.sha256))
      return { code: "bad_about", why: "each about entry is exactly { kind: \"witness\" | \"gate\", sha256: 64 lowercase hex }" };
    if (seen.has(a.sha256)) return { code: "bad_about", why: "the same measurement is named twice" };
    seen.add(a.sha256);
  }
  if (typeof r.text !== "string") return { code: "bad_text", why: "text must be a string" };
  const chars = [...r.text];
  if (chars.length < 1 || chars.length > RESPONSE_TEXT_MAX) return { code: "bad_text", why: "text must be 1 to " + RESPONSE_TEXT_MAX + " characters" };
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(r.text)) return { code: "bad_text", why: "text may contain newlines but no other control characters" };
  if (typeof r.responded_at !== "string" || !ISO.test(r.responded_at) || isNaN(Date.parse(r.responded_at)))
    return { code: "bad_time", why: "responded_at must look like 2026-09-28T07:00:00Z" };
  if (Date.parse(r.responded_at) > nowMs + 10 * 60 * 1000) return { code: "bad_time", why: "responded_at is more than ten minutes in the future" };
  const kh = hostOf(r.key_url);
  if (!kh) return { code: "bad_key_url", why: "key_url must be an https URL" };
  if (!related(kh, new URL(r.subject_origin).hostname.toLowerCase()))
    return { code: "key_off_subject", why: "key_url must be served from the subject's own host, or a host under or above it; a key elsewhere cannot speak for the subject" };
  const pk = b64ToBytes(r.public_key_ed25519_b64);
  if (typeof r.public_key_ed25519_b64 !== "string" || !pk || pk.length !== 32) return { code: "bad_public_key", why: "public_key_ed25519_b64 must be 32 bytes of base64" };
  return null;
}

// deps: { fetchKey(keyUrl) -> {ok, key, why}, fetchGateRecord(sha) -> {ok, text, why}, now() -> ms }
export async function handleResponsePost(request, env, deps, origin) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b.record_canonical !== "string" || typeof b.signature_ed25519_b64 !== "string")
    return j({ ok: false, error: "record_canonical and signature_ed25519_b64 (strings) required", help: origin + "/response" }, 400);
  if (enc.encode(b.record_canonical).length > RESPONSE_MAX_BYTES) return j({ ok: false, error: "too_large", max_bytes: RESPONSE_MAX_BYTES }, 413);
  let r;
  try { r = parseStrict(b.record_canonical); } catch (e) { return j({ ok: false, error: (e && e.code) || "bad_json" }, 400); }
  let can;
  try { can = canonical(r); } catch (e) { return j({ ok: false, error: (e && e.code) || "bad_json" }, 400); }
  if (can !== b.record_canonical) return j({ ok: false, error: "not_canonical", why: "submit the canonical text (sorted keys, no whitespace); the signature covers exactly these bytes" }, 422);
  const nowMs = deps.now();
  const sp = shapeProblem(r, nowMs);
  if (sp) return j({ ok: false, error: sp.code, why: sp.why }, 422);
  if (!(await ed25519Verify(r.public_key_ed25519_b64, b.signature_ed25519_b64, RESPONSE_CONTEXT + b.record_canonical)))
    return j({ ok: false, error: "signature_invalid", why: "the signature does not verify over \"nenrin-response-v0\\n\" + record_canonical with the key in the record" }, 422);

  const subjectHost = new URL(r.subject_origin).hostname.toLowerCase();
  // every named measurement must exist and must have measured this subject
  for (const a of r.about) {
    let measured = null;
    if (a.kind === "witness") {
      const raw = (await env.LEDGER.get("wit:anchored:" + a.sha256)) || (await env.LEDGER.get("wit:pending:" + a.sha256));
      if (!raw) return j({ ok: false, error: "about_not_found", sha256: a.sha256, why: "no witness record with this sha in this ledger" }, 422);
      let s = null; try { s = JSON.parse(raw); } catch { s = null; }
      const st = s && s.stored ? s.stored : s;
      measured = st && (st.endpoint || null);
      if (!measured && st && typeof st.record_canonical === "string") { try { measured = JSON.parse(st.record_canonical).base || null; } catch { measured = null; } }
    } else {
      const g = await deps.fetchGateRecord(a.sha256);
      if (!g || !g.ok) return j({ ok: false, error: g && g.status === 404 ? "about_not_found" : "gate_unreachable", sha256: a.sha256, why: (g && g.why) || "the gate did not serve this record" }, g && g.status === 404 ? 422 : 503);
      if ((await sha256hex(g.text)) !== a.sha256) return j({ ok: false, error: "gate_record_mismatch", sha256: a.sha256, why: "the bytes the gate served do not hash to this sha" }, 502);
      try { measured = JSON.parse(g.text).endpoint || null; } catch { measured = null; }
    }
    if (!related(hostOf(measured), subjectHost))
      return j({ ok: false, error: "not_about_subject", sha256: a.sha256, measured: measured || null, why: "this measurement did not measure " + r.subject_origin + "; a party can answer only measurements of itself" }, 422);
  }

  const dk = await deps.fetchKey(r.key_url);
  if (!dk || !dk.ok) return j({ ok: false, error: "key_url_unreachable", why: (dk && dk.why) || "the key could not be fetched", note: "not a verdict; retry later" }, 503);
  if (dk.key !== r.public_key_ed25519_b64) return j({ ok: false, error: "key_url_mismatch", why: "the key served at key_url is not the key that signed this response" }, 422);

  const sha = await sha256hex(b.record_canonical);
  if (await env.LEDGER.get("resp:rec:" + sha)) return j({ ok: true, sha, dedup: true, url: origin + "/response/" + sha });
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const g = Number((await env.LEDGER.get("resp:count:" + day)) || 0);
  if (g >= RESPONSE_DAILY_GLOBAL) return j({ ok: false, error: "daily_global_cap_reached", cap: RESPONSE_DAILY_GLOBAL }, 429);
  const hk = "resp:cap:" + day + ":" + subjectHost;
  const hc = Number((await env.LEDGER.get(hk)) || 0);
  if (hc >= RESPONSE_DAILY_PER_HOST) return j({ ok: false, error: "daily_per_subject_cap_reached", cap: RESPONSE_DAILY_PER_HOST }, 429);

  const received_at = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  await env.LEDGER.put("resp:rec:" + sha, JSON.stringify({ sha, record_canonical: b.record_canonical, signature_ed25519_b64: b.signature_ed25519_b64, received_at }));
  for (const a of r.about) await env.LEDGER.put("resp:about:" + a.sha256 + ":" + sha, JSON.stringify({ sha, subject_origin: r.subject_origin, responded_at: r.responded_at }));
  await env.LEDGER.put("resp:host:" + subjectHost + ":" + sha, JSON.stringify({ sha, responded_at: r.responded_at }));
  await env.LEDGER.put("resp:count:" + day, String(g + 1), { expirationTtl: 90000 });
  await env.LEDGER.put(hk, String(hc + 1), { expirationTtl: 90000 });
  return j({
    ok: true, sha, url: origin + "/response/" + sha, subject_origin: r.subject_origin, about: r.about,
    shown_at: r.about.map((a) => a.kind === "witness" ? origin + "/witness/" + a.sha256 : origin + "/response?about=" + a.sha256),
    note: "shown beside the measurements it names and in the subject's résumé. It changes no verdict, no count and no hash. Not anchored in v0: responded_at is your claim; the signature and your domain's key attribute the text to you",
  }, 201);
}

async function listPrefix(env, prefix) {
  const out = [];
  const l = await env.LEDGER.list({ prefix });
  for (const k of (l.keys || [])) { const raw = await env.LEDGER.get(k.name); if (!raw) continue; try { out.push(JSON.parse(raw)); } catch {} }
  return out;
}
export async function responsesAbout(env, sha, origin) {
  if (!HEX64.test(sha || "")) return [];
  const rows = await listPrefix(env, "resp:about:" + sha + ":");
  return rows.map((x) => ({ response_sha: x.sha, url: origin + "/response/" + x.sha, subject_origin: x.subject_origin, responded_at: x.responded_at }))
    .sort((a, b) => (a.responded_at < b.responded_at ? -1 : a.responded_at > b.responded_at ? 1 : (a.response_sha < b.response_sha ? -1 : 1)));
}
export async function responsesForHost(env, host, origin) {
  if (!host) return [];
  const rows = await listPrefix(env, "resp:host:" + host.toLowerCase() + ":");
  return rows.map((x) => ({ response_sha: x.sha, url: origin + "/response/" + x.sha, responded_at: x.responded_at }))
    .sort((a, b) => (a.responded_at < b.responded_at ? -1 : a.responded_at > b.responded_at ? 1 : (a.response_sha < b.response_sha ? -1 : 1)));
}

export function responseSelfDescription(origin) {
  return {
    schema: RESPONSE_SCHEMA,
    purpose: "the measured party's own statement, shown beside the measurements it names (record-privacy-v1: adverse facts are published with the subject's response when there is one)",
    submit: "POST " + origin + "/response with {record_canonical, signature_ed25519_b64}; the signature is Ed25519 over UTF-8(\"nenrin-response-v0\\n\" + record_canonical)",
    record_fields: FIELDS,
    who_may_respond: "only the party measured: key_url on the subject's host (or a host under or above it), and every named measurement must have measured that host",
    limits: { text_characters: RESPONSE_TEXT_MAX, about_max: RESPONSE_ABOUT_MAX, bytes: RESPONSE_MAX_BYTES, daily_per_subject: RESPONSE_DAILY_PER_HOST, daily_global: RESPONSE_DAILY_GLOBAL },
    does_not: ["change any verdict, count or résumé hash", "judge, edit or rank the statement", "anchor the response to Bitcoin in v0"],
    read: ["GET " + origin + "/response/<sha>", "GET " + origin + "/response?about=<measurement sha>", "GET " + origin + "/response?subject=<https origin>"],
  };
}

// dispatcher: returns null when the path is not ours
export async function handleResponse(p, request, url, env, deps, origin) {
  if (p === "/response" && request.method === "POST") {
    try { return await handleResponsePost(request, env, deps, origin); }
    catch (e) { return j({ ok: false, error: "response_internal", detail: String((e && e.message) || e) }, 500); }
  }
  if (p === "/response" && request.method === "GET") {
    const about = url.searchParams.get("about");
    const subject = url.searchParams.get("subject");
    if (about) return j({ about, responses: await responsesAbout(env, about.toLowerCase(), origin) });
    if (subject) { const h = hostOf(subject); if (!h) return j({ ok: false, error: "subject must be an https origin" }, 400); return j({ subject, responses: await responsesForHost(env, h, origin) }); }
    return j(responseSelfDescription(origin));
  }
  const m = p.match(/^\/response\/([0-9a-f]{64})$/);
  if (m && request.method === "GET") {
    const raw = await env.LEDGER.get("resp:rec:" + m[1]);
    if (!raw) return j({ ok: false, error: "not_found", sha: m[1] }, 404);
    const s = JSON.parse(raw);
    return j({ ...s, recompute: "sha256(record_canonical) must equal sha; verify signature_ed25519_b64 over UTF-8(\"nenrin-response-v0\\n\" + record_canonical) with public_key_ed25519_b64, and GET key_url to see the subject serves that key" });
  }
  return null;
}
