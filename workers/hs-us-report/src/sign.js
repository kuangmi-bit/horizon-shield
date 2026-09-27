// HMAC-signed links for customer downloads and the review page, and a constant-time compare.

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ctEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signPath(secret, path, ttlMs) {
  if (!secret) throw new Error("signing secret missing");
  const exp = Date.now() + ttlMs;
  const sig = await hmacHex(secret, `${path}|${exp}`);
  return `${path}?exp=${exp}&sig=${sig}`;
}

export async function verifyPath(secret, path, exp, sig) {
  if (!secret) return false;
  const e = Number(exp || 0);
  if (!e || Date.now() > e) return false;
  return ctEqual(sig, await hmacHex(secret, `${path}|${e}`));
}
