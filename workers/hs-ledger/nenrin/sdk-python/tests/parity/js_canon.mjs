// jsCanon(v): the bytes both languages hash for the parity check. Keys sorted by UTF-16 code unit at every depth,
// no whitespace, strings and numbers exactly as JSON.stringify writes them, undefined object members dropped and
// undefined array members written as null. Written as a string builder on purpose: rebuilding a sorted object and
// calling JSON.stringify would let JavaScript move integer-like keys ("9" before "10") and break the sort.
export function jsCanon(v) {
  if (v === undefined || typeof v === "function") return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => { const s = jsCanon(x); return s === undefined ? "null" : s; }).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jsCanon(v[k])).join(",") + "}";
}
