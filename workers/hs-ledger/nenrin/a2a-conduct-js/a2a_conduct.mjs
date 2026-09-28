// a2a_conduct.mjs : the A2A Conduct Extension (conduct-v1.4) as a few calls, for any JavaScript agent and any client.
//
// No dependencies. Node 18+, Deno, Bun, Cloudflare Workers, browsers. The same calls, with byte-identical output, as
// a2a_conduct.py in the Python package a2a-conduct-walk (test/parity.test.mjs holds the two to the same bytes).
//
// Agent side (plain server):
//   card.capabilities.extensions.push(extension(compensation, ["https://you.example/a2a"]));
//   Object.assign(responseHeaders, echoHeaders(request.headers));          // on every A2A response
//   if (activated(request.headers).uri) attach(result, ext, servedUrl);     // result = the JSON-RPC result
//
// Agent side (official @a2a-js/sdk): in your AgentExecutor.execute(requestContext, eventBus)
//   if (activateOn(requestContext)) attachToMessage(message, ext, servedUrl);   // the SDK then echoes the header
//
// Client side, one call before delegating work to an agent you have not used before:
//   const report = await preflight("https://agent.example");
//
// Specification: https://gate.horizonshield.dev/ext/conduct/v1 (Apache-2.0). This module declares, echoes and
// attaches; it does not measure, does not score, and says nothing about whether an agent is any good.

export const EXT_URI = "https://gate.horizonshield.dev/ext/conduct/v1";
export const EXT_PERMANENT_ID = "https://w3id.org/horizonshield/conduct/v1";
export const EXT_URIS = Object.freeze([EXT_URI, EXT_PERMANENT_ID]);
export const GATE = "https://gate.horizonshield.dev";
export const WITNESS_INTAKE = "https://ledger.horizonshield.dev/witness";
export const PAID_BY = Object.freeze(["buyer", "seller", "referral", "advertising", "subscription", "public", "other"]);
export const USER_AGENT = "a2a-conduct/1.4 (+" + EXT_URI + ")";
export const VERSION = "1.4.0";

// Python's urllib.parse.quote(s, safe=""): everything but A-Z a-z 0-9 _ . - ~ is percent-encoded.
function quote(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// https://host[:port]/path of the URL the request arrived at: no query, no fragment (section 14.2).
// Port 80 and 443 are dropped whatever the scheme, as in the Python helper.
export function servedUrl(url) {
  const u = new URL(String(url));
  const port = u.port && u.port !== "80" && u.port !== "443" ? ":" + u.port : "";
  return u.protocol.toLowerCase() + "//" + u.hostname.toLowerCase() + port + (u.pathname || "/");
}

function fail(msg) { const e = new Error(msg); e.name = "A2AConductError"; throw e; }
const isBool = (v) => typeof v === "boolean";

// The AgentExtension entry for capabilities.extensions[] (section 2). Refuses a malformed compensation declaration
// instead of publishing one: a card that says who pays it wrongly is worse than one that does not.
export function extension(compensation, measuredEndpoints, { conductRecord, witnessIntake = WITNESS_INTAKE, ...optional } = {}) {
  const c = { ...(compensation || {}) };
  if (!PAID_BY.includes(c.paid_by)) fail("compensation.paid_by must be one of " + PAID_BY.join(", "));
  for (const k of ["referral_fee", "listing_fee"]) if (!isBool(c[k])) fail("compensation." + k + " must be a boolean");
  if ("success_fee_pct" in c && !(typeof c.success_fee_pct === "number" && Number.isFinite(c.success_fee_pct) && c.success_fee_pct >= 0 && c.success_fee_pct <= 100)) {
    fail("compensation.success_fee_pct must be a number from 0 to 100");
  }
  const eps = Array.from(measuredEndpoints || []);
  if (!eps.length || !eps.every((u) => typeof u === "string" && u.startsWith("https://"))) fail("measured_endpoints must be one or more https URLs");
  const params = {
    compensation: c,
    measured_endpoints: eps,
    conduct_record: conductRecord || GATE + "/history?endpoint=" + quote(eps[0]),
    witness_intake: witnessIntake,
  };
  const snake = { verdictRecipe: "verdict_recipe", consent: "consent", register: "register", rings: "rings" };
  for (const [k, key] of Object.entries(snake)) {
    if (optional[k] !== undefined) params[key] = optional[k];
    else if (optional[key] !== undefined) params[key] = optional[key];
  }
  return { uri: EXT_URI, description: "Who pays this agent, where its measured conduct record lives, and where to file a witness walk.", required: false, params };
}

function headerEntries(h) {
  if (!h) return [];
  if (typeof h.forEach === "function" && typeof h.get === "function" && !(h instanceof Map)) { const out = []; h.forEach((v, k) => out.push([k, v])); return out; }
  if (h instanceof Map) return [...h.entries()];
  if (Array.isArray(h)) return h;
  return Object.entries(h);
}

// Which accepted URI the caller activated, and under which header spelling. {uri: null, spelling: null} when not.
export function activated(requestHeaders) {
  const h = {};
  for (const [k, v] of headerEntries(requestHeaders)) h[String(k).toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v);
  for (const spelling of ["a2a-extensions", "x-a2a-extensions"]) {
    for (const u of (h[spelling] || "").split(",").map((x) => x.trim())) {
      if (EXT_URIS.includes(u)) return { uri: u, spelling };
    }
  }
  return { uri: null, spelling: null };
}

// Response headers for section 3: echo the string the caller sent, under A2A-Extensions, and also under
// X-A2A-Extensions when the caller used that spelling (a 0.3 client reads only the spelling it sent).
export function echoHeaders(requestHeaders) {
  const { uri, spelling } = activated(requestHeaders);
  if (!uri) return {};
  const out = { "A2A-Extensions": uri };
  if (spelling === "x-a2a-extensions") out["X-A2A-Extensions"] = uri;
  return out;
}

// The section 3 metadata keys for a Message or Task, always under the canonical URI (section 12.4).
// endpoint = the measured endpoint whose record applies (the served URL itself when it is measured);
// served_by = where this request actually arrived (section 14), taken from the request, never a constant.
export function metadata(ext, served) {
  const p = ext.params;
  const s = servedUrl(served);
  const eps = p.measured_endpoints;
  const endpoint = eps.includes(s) ? s : eps[0];
  return {
    [EXT_URI + "/endpoint"]: endpoint,
    [EXT_URI + "/conduct_record"]: p.conduct_record,
    [EXT_URI + "/witness_intake"]: p.witness_intake,
    [EXT_URI + "/served_by"]: s,
  };
}

function listUri(target) {
  const ex = Array.from(target.extensions || []);
  if (!ex.includes(EXT_URI)) ex.push(EXT_URI);
  target.extensions = ex;
}

// Attach metadata and list the URI in extensions on a 0.3 Message/Task object or a 1.0 {message}/{task} wrapper.
export function attach(result, ext, served) {
  const obj = result.message || result.task || result;
  obj.metadata = { ...(obj.metadata || {}), ...metadata(ext, served) };
  let target = obj;
  if ((obj.kind === "task" || "status" in obj) && obj.status && typeof obj.status === "object" && obj.status.message && typeof obj.status.message === "object") {
    target = obj.status.message;
  }
  listUri(target);
  return result;
}

// Same as attach, on one Message or Task object you are about to publish (for example through the @a2a-js/sdk
// event bus, which wraps it on the wire itself).
export function attachToMessage(messageOrTask, ext, served) {
  return attach(messageOrTask, ext, served);
}

// @a2a-js/sdk: activate the extension on the call context when the caller asked for it, so the SDK echoes
// A2A-Extensions (or X-A2A-Extensions on the 0.3 wire) on the response. Accepts a RequestContext or a
// ServerCallContext. Returns the activated URI, or null. The SDK only keeps requested URIs the card declares.
export function activateOn(ctx) {
  const c = ctx && ctx.context && typeof ctx.context.addActivatedExtension === "function" ? ctx.context : ctx;
  if (!c || typeof c.addActivatedExtension !== "function") return null;
  const requested = c.requestedExtensions ? Array.from(c.requestedExtensions) : [];
  const uri = requested.find((u) => EXT_URIS.includes(u)) || null;
  if (uri) c.addActivatedExtension(uri);
  return uri;
}

async function defaultGetJson(url, fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await f(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  } catch (_e) { return [0, null]; }
  if (!(res.status >= 200 && res.status < 300)) return [res.status, null];
  try { return [res.status, JSON.parse(await res.text())]; } catch (_e) { return [0, null]; }
}

// Before delegating work: read the agent's card, who it says pays it, and the register's reading for each measured
// endpoint. Counts and pointers, never a score; the register answers verified only when the latest scheduled
// measurement passed, and null (not false) in every other case. Options: getJson(url) returning [status, json]
// (for tests and custom transports), fetch (a fetch-compatible function), gate.
export async function preflight(agentOrigin, { getJson, fetch: fetchImpl, gate = GATE } = {}) {
  const get = getJson ? async (u) => getJson(u) : (u) => defaultGetJson(u, fetchImpl);
  const origin = String(agentOrigin).replace(/\/+$/, "");
  const [st, card] = await get(origin + "/.well-known/agent-card.json");
  const out = {
    agent: origin, card_status: st, extension_declared: false, compensation: null,
    measured_endpoints: [], register: [], witness_intake: null,
    does_not_establish: ["that the agent is trustworthy or competent", "that the compensation declaration is true",
      "that the agent behaves now as it did when measured"],
  };
  if (!card || typeof card !== "object" || Array.isArray(card)) return out;
  const exts = (card.capabilities && card.capabilities.extensions) || [];
  const ext = (Array.isArray(exts) ? exts : []).find((e) => e && typeof e === "object" && !Array.isArray(e) && EXT_URIS.includes(e.uri)) || null;
  const params = (ext && ext.params) || {};
  out.extension_declared = ext !== null;
  out.compensation = params.compensation || card.compensation || null;
  out.measured_endpoints = (params.measured_endpoints || []).filter((u) => typeof u === "string");
  out.witness_intake = params.witness_intake ?? null;
  for (const ep of out.measured_endpoints.slice(0, 5)) {
    const [s, r0] = await get(gate + "/is-verified?endpoint=" + quote(ep));
    const r = r0 && typeof r0 === "object" && !Array.isArray(r0) ? r0 : {};
    out.register.push({ endpoint: ep, http: s, state: r.state ?? null, verified: r.verified ?? null, record_url: r.record_url ?? null, history_url: r.history_url ?? null });
  }
  return out;
}
