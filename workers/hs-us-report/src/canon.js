// Canonical JSON and hashing shared by the engine, the worker and the tests.
// Keys are sorted at every level, no spaces, UTF-8. This matches Python's
// json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
// for the values the reports use (strings, integers, and short decimals).

export function canon(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = sortKeys(v[k]);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in canonical JSON");
  return v;
}

export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function round(x, digits = 0) {
  const f = 10 ** digits;
  return Math.round((x + Number.EPSILON) * f) / f;
}
