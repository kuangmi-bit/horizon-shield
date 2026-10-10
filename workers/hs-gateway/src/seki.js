// seki.js (hs-gateway): before a paid /report runs for a store a SEKI door guards, ask the door.
//
// SEKI (a2a-admission-v0) is the relying party's own door: an agent acting under a signed MUSUBI contract asks before
// it acts, and the door answers admit, escalate or refuse with a record it signs. The door's code is private and runs
// in its own worker (hs-seki-door), reached only through the service binding SEKI_SVC. What is public is the record:
// anyone checks it with admission_verify_v0 (pip install nenrin-verify) and settles the execution against it with
// settle v1.11 or v1.12 (workers/hs-ledger/nenrin/musubi-v0).
//
// What this file decides, and nothing more:
//   - which stores are guarded (SEKI_STORES). For those, a /report call runs only after the door said admit; every
//     other answer, and every failure to get an answer, is returned to the caller and nothing is spent (fail closed).
//   - the call as the door must see it: the service, the store, and the tickets the service costs (PRICES). The door
//     admits only a request signed for exactly that, so an admission for one service cannot carry another through.
// A store not in SEKI_STORES is untouched: the door is never asked and /report behaves as before.
//
// The first guarded store is a demonstration: The HORIZONs authorizes its own agent, at its own paid tool, so the
// records show the door working on a live paid path. It is not an outside party and is not counted as one.
export var SEKI_STORES = ["hs-seki-demo"];

// Tickets at a guarded store during the pilot (TOshi, 2026-10-10): the operator grants them free through /admin/grant and
// they carry no monetary value; no payment is taken for them. Commercial SEKI will be sold in US dollars and billed after
// use, decided but not built. Every guarded answer says which of the two it is, so a record of a spend is never read as a
// payment.
export var SEKI_TICKETS = {
  mode: "pilot",
  monetary_value: false,
  note: "During the pilot, tickets at a SEKI-guarded store are granted free by the operator and carry no monetary value. No payment is taken for them. Commercial SEKI will be priced in US dollars and billed after use."
};

// The ticket ledger keeps a store under safeStore(id) (tickets.js: characters outside [A-Za-z0-9._-] are dropped, 40 at
// most), so "hs-seki-demo!" spends from hs-seki-demo. The guard reads the id the same way, or such an alias would spend
// a guarded store's tickets without the door (review 2026-10-10).
export function ledgerStoreId(store) {
  return String(store == null ? "" : store).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
}
export function sekiGuarded(store) {
  return SEKI_STORES.indexOf(ledgerStoreId(store)) >= 0;
}

function closed(status, error, why) {
  return { ok: false, status: status, content_type: "application/json", body: { ok: false, error: error, why: why, spent: 0 } };
}

// The door's answer for one call. Never throws; anything but an admit from the door is { ok: false, status, body }.
export async function sekiAsk(env, store, service, amount, submission) {
  if (!env || !env.SEKI_SVC || typeof env.SEKI_SVC.fetch !== "function") {
    return closed(503, "seki_door_unavailable", "this store is guarded by a SEKI door and the door is not bound here; nothing was spent");
  }
  var out = null;
  try {
    var r = await env.SEKI_SVC.fetch("https://seki.internal/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: store, service: service, amount: amount, submission: submission === undefined ? null : submission })
    });
    out = await r.json();
  } catch (e) {
    return closed(503, "seki_door_unreachable", "the door did not answer (" + String(e && e.message || e) + "); nothing was spent");
  }
  if (!out || typeof out !== "object" || out.applies !== true) {
    return closed(503, "seki_door_does_not_hold_this_store", "the gateway guards this store and the door does not; nothing was spent");
  }
  if (out.ok === true && out.decision === "admit" && typeof out.admission_sha256 === "string") return out;
  return {
    ok: false,
    status: Number.isInteger(out.status) && out.status >= 400 ? out.status : 403,
    content_type: typeof out.content_type === "string" ? out.content_type : "application/problem+json",
    body: out.body && typeof out.body === "object" ? out.body : { ok: false, error: "seki_not_admitted" },
    decision: out.decision || null,
    admission_sha256: out.admission_sha256 || null,
    record_sha256: out.record_sha256 || null,
    published: out.published || null
  };
}

// Headers the gateway adds to a guarded call's answer, so the agent can name the admission in its execution record.
export function sekiHeaders(out) {
  if (!out) return {};
  var h = { "X-Seki-Decision": String(out.decision || ""), "X-Seki-Tickets": SEKI_TICKETS.mode + "; no monetary value" };
  if (out.admission_sha256) h["X-Seki-Admission-Sha256"] = out.admission_sha256;
  if (out.record_sha256) h["X-Seki-Record-Sha256"] = out.record_sha256;
  if (out.published) h["X-Seki-Published"] = out.published.accepted ? "accepted" : "pending";
  return h;
}

// GET /seki (what the door admits under) and GET /seki/record/<sha256> (a record it published), passed through.
export async function sekiRead(env, path) {
  if (!env || !env.SEKI_SVC || typeof env.SEKI_SVC.fetch !== "function") return null;
  var inner = path === "/seki" ? "/policy" : (/^\/seki\/record\/[0-9a-f]{64}$/.test(path) ? path.slice(5) : null);
  if (!inner) return null;
  try {
    var r = await env.SEKI_SVC.fetch("https://seki.internal" + inner, { method: "GET" });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { status: 503, text: JSON.stringify({ error: "seki_door_unreachable" }) };
  }
}
