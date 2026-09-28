// signer_core.js : the signing core of the Yakumo record signer (yakumo/sign/). No dependencies; runs in a browser
// and in Node 20+ (globalThis.crypto.subtle). It builds and signs two MUSUBI records exactly as the Python
// verifiers read them:
//   a2a-actor-declaration-v0  (independence_v0.py: which legal entity answers for this key)
//   a2a-measurement-v0        (corroboration_v0.py: one measurer, one item, one figure, a Bitcoin beacon)
// The private key never leaves the device. Nothing here sends anything anywhere.

export const DECL_SCHEMA = "a2a-actor-declaration-v0";
export const DECL_CONTEXT = "a2a-actor-declaration-v0\n";
export const MEAS_SCHEMA = "a2a-measurement-v0";
export const MEAS_CONTEXT = "a2a-measurement-v0\n";
const SAFE = 9007199254740991;
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

// musubi-canonical-v0 (contract_v0.canonical / canonical_v0.mjs): sorted keys, no whitespace, raw non-ASCII,
// only '"', '\\' and U+0000..U+001F escaped, integers only.
function str(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}
export function canonical(v) {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isInteger(v) || Math.abs(v) > SAFE) throw new Error("no canonical form for " + String(v));
    return String(v);
  }
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    for (const k of keys) for (let i = 0; i < k.length; i++) { const c = k.charCodeAt(i); if (c < 0x20 || c > 0x7e) throw new Error("key not printable ASCII: " + k); }
    return "{" + keys.map((k) => str(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Error("no canonical form for " + typeof v);
}

export function b64(bytes) {
  let s = ""; const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export async function sha256Hex(bytes) {
  const d = await subtle().digest("SHA-256", typeof bytes === "string" ? enc.encode(bytes) : bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function supported() {
  try { await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"]); return true; } catch { return false; }
}
export async function newKey() {
  const kp = await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  return { privateKey: kp.privateKey, publicB64: b64(await subtle().exportKey("raw", kp.publicKey)) };
}
export async function publicB64Of(privateKey) {
  // Ed25519 PKCS#8 carries no public key in Web Crypto's export; derive it through the JWK form.
  const jwk = await subtle().exportKey("jwk", privateKey);
  return b64(unb64(jwk.x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((jwk.x.length + 3) % 4)));
}
export async function exportPem(privateKey) {
  const der = b64(await subtle().exportKey("pkcs8", privateKey));
  return "-----BEGIN PRIVATE KEY-----\n" + der.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
}
export async function importPem(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return subtle().importKey("pkcs8", unb64(body), { name: "Ed25519" }, true, ["sign"]);
}
export function keyFile(publicB64) {
  return canonical({ public_key_ed25519_b64: publicB64 }) + "\n";
}

async function signWith(privateKey, context, body) {
  const sig = await subtle().sign({ name: "Ed25519" }, privateKey, enc.encode(context + canonical(body)));
  return { alg: "ed25519", sig_b64: b64(sig) };
}
function without(obj, drop) {
  const o = {}; for (const k of Object.keys(obj)) if (!drop.includes(k)) o[k] = obj[k]; return o;
}

const HOUJIN = /^[0-9]{13}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function declarationProblem({ publicB64, domain, keyUrl, houjinBango, companyName }) {
  if (!publicB64) return "鍵がありません。先に鍵を作ってください";
  if (!HOST.test(String(domain || "").toLowerCase())) return "ドメインは reform-sn.com のような形で書いてください(https:// は付けません)";
  let u = null; try { u = new URL(keyUrl); } catch { u = null; }
  if (!u || u.protocol !== "https:") return "公開鍵の置き場所は https:// から始まる URL で書いてください";
  if (!HOUJIN.test(String(houjinBango || ""))) return "法人番号は 13 桁の数字です";
  if (!String(companyName || "").trim()) return "会社名を書いてください";
  return null;
}
export function buildDeclaration({ publicB64, domain, keyUrl, houjinBango, companyName, declaredAt }) {
  const p = declarationProblem({ publicB64, domain, keyUrl, houjinBango, companyName });
  if (p) throw new Error(p);
  return {
    schema: DECL_SCHEMA, public_key_ed25519_b64: publicB64, domain: String(domain).toLowerCase(), key_url: keyUrl,
    legal_entity: { registry: "JP", scheme: "houjin-bango", id: String(houjinBango), name: String(companyName).trim(),
      lookup_url: "https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=" + String(houjinBango) },
    declared_at: declaredAt, signatures: [],
  };
}
export async function signDeclaration(decl, privateKey) {
  const s = await signWith(privateKey, DECL_CONTEXT, without(decl, ["signatures"]));
  return Object.assign({}, decl, { signatures: (decl.signatures || []).concat([s]) });
}

// "187.4" -> {value: 1874, scale: 1}; "150" -> 150. Refuses negatives, exponents and more than 9 decimals.
export function parseQuantity(text) {
  const t = String(text || "").trim();
  const m = /^([0-9]+)(?:\.([0-9]{1,9}))?$/.exec(t);
  if (!m) return null;
  if (!m[2]) { const n = Number(m[1]); return Number.isSafeInteger(n) && n > 0 ? n : null; }
  const n = Number(m[1] + m[2]);
  if (!Number.isSafeInteger(n) || n === 0) return null;
  return { value: n, scale: m[2].length };
}
const HEX64 = /^[0-9a-f]{64}$/;
export function measurementProblem({ contractSha, termsSha, itemId, measured, method, publicB64, beacon }) {
  if (!publicB64) return "鍵がありません。先に鍵を作ってください";
  if (!HEX64.test(contractSha || "")) return "契約の番号(64 桁)が正しくありません。当社から届いた値をそのまま貼ってください";
  if (!HEX64.test(termsSha || "")) return "条件の番号(64 桁)が正しくありません。当社から届いた値をそのまま貼ってください";
  if (!itemId) return "品目の番号がありません";
  if (measured == null) return "測った値は、150 や 187.4 のような正の数で書いてください";
  if (!method) return "測り方を選んでください";
  if (!beacon || beacon.kind !== "bitcoin_block" || !Number.isSafeInteger(beacon.height) || !HEX64.test(beacon.hash || "")) return "時刻の目印(Bitcoin の最新ブロック)がありません。「目印を取る」を押してください";
  return null;
}
export function buildMeasurement({ contractSha, termsSha, itemId, measured, method, publicB64, beacon, evidenceSha }) {
  const p = measurementProblem({ contractSha, termsSha, itemId, measured, method, publicB64, beacon });
  if (p) throw new Error(p);
  const m = { schema: MEAS_SCHEMA, terms_sha256: termsSha, contract_sha256: contractSha, item_id: itemId, measured, method,
    beacon: { kind: "bitcoin_block", height: beacon.height, hash: beacon.hash }, measurer: { public_key_ed25519_b64: publicB64 }, signatures: [] };
  if (evidenceSha) m.evidence_ref = { file_sha256: evidenceSha };
  return m;
}
export async function signMeasurement(m, privateKey) {
  const s = await signWith(privateKey, MEAS_CONTEXT, without(m, ["signatures", "anchor"]));
  return Object.assign({}, m, { signatures: (m.signatures || []).concat([s]) });
}
