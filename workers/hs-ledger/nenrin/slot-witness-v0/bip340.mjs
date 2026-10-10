// bip340.mjs: BIP-340 Schnorr signatures over secp256k1, verify (and sign, for tests), with no dependency.
// Written from BIP-340 (github.com/bitcoin/bips, bip-0340.mediawiki and reference.py) and checked against its
// test-vectors.csv (fixtures/bip340_test_vectors.csv). Jacobian coordinates, so one field inversion per scalar
// multiplication. Not constant time: verify handles public data only; sign is for building test fixtures.
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;

const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function powmod(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
const inv = (a) => powmod(a, P - 2n, P);

// Jacobian point [X, Y, Z]; Z = 0n is infinity
const INF = [0n, 1n, 0n];
function dbl([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return INF;
  const YY = (Y * Y) % P, S = (4n * X * YY) % P, M = (3n * X * X) % P;
  const X3 = mod(M * M - 2n * S), Y3 = mod(M * (S - X3) - 8n * YY * YY), Z3 = (2n * Y * Z) % P;
  return [X3, Y3, Z3];
}
function add(A, B) {
  if (A[2] === 0n) return B;
  if (B[2] === 0n) return A;
  const [X1, Y1, Z1] = A, [X2, Y2, Z2] = B;
  const Z1Z1 = (Z1 * Z1) % P, Z2Z2 = (Z2 * Z2) % P;
  const U1 = (X1 * Z2Z2) % P, U2 = (X2 * Z1Z1) % P;
  const S1 = (Y1 * Z2 * Z2Z2) % P, S2 = (Y2 * Z1 * Z1Z1) % P;
  if (U1 === U2) return S1 === S2 ? dbl(A) : INF;
  const H = mod(U2 - U1), R = mod(S2 - S1), HH = (H * H) % P, HHH = (H * HH) % P, V = (U1 * HH) % P;
  const X3 = mod(R * R - HHH - 2n * V), Y3 = mod(R * (V - X3) - S1 * HHH), Z3 = (Z1 * Z2 * H) % P;
  return [X3, Y3, Z3];
}
function mul(Pt, k) { let R = INF, A = Pt; while (k > 0n) { if (k & 1n) R = add(R, A); A = dbl(A); k >>= 1n; } return R; }
function affine([X, Y, Z]) { if (Z === 0n) return null; const zi = inv(Z), zi2 = (zi * zi) % P; return [(X * zi2) % P, (Y * zi2 * zi) % P]; }
const G = [GX, GY, 1n];

const enc = new TextEncoder();
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
export function hexToBytes(h) {
  if (typeof h !== "string" || h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}
const intFrom = (b) => BigInt("0x" + (toHex(b) || "0"));
const bytes32 = (x) => hexToBytes(x.toString(16).padStart(64, "0"));
const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function sha256(b) { return new Uint8Array(await crypto.subtle.digest("SHA-256", b)); }
async function taggedHash(tag, msg) { const t = await sha256(enc.encode(tag)); return sha256(cat(t, t, msg)); }

function liftX(x) {
  if (x >= P) return null;
  const ySq = mod(powmod(x, 3n, P) + 7n);
  const y = powmod(ySq, (P + 1n) / 4n, P);
  if ((y * y) % P !== ySq) return null;
  return [x, (y & 1n) === 0n ? y : P - y, 1n];
}

// verify(pubkey 32 bytes x-only, msg bytes of any length, sig 64 bytes) -> boolean, exactly BIP-340 Verification
export async function schnorrVerify(pub, msg, sig) {
  if (!(pub instanceof Uint8Array) || pub.length !== 32 || !(sig instanceof Uint8Array) || sig.length !== 64 || !(msg instanceof Uint8Array)) return false;
  const Pt = liftX(intFrom(pub));
  if (!Pt) return false;
  const r = intFrom(sig.slice(0, 32)), s = intFrom(sig.slice(32));
  if (r >= P || s >= N) return false;
  const e = mod(intFrom(await taggedHash("BIP0340/challenge", cat(sig.slice(0, 32), pub, msg))), N);
  const R = affine(add(mul(G, s), mul(Pt, mod(N - e, N))));
  if (!R) return false;
  if ((R[1] & 1n) !== 0n) return false;
  return R[0] === r;
}

// sign(secret 32 bytes, msg bytes, aux 32 bytes) -> 64 byte signature, BIP-340 Default Signing (for fixtures only)
export async function schnorrSign(sk, msg, aux) {
  let d0 = intFrom(sk);
  if (d0 <= 0n || d0 >= N) throw new Error("secret key out of range");
  const Pa = affine(mul(G, d0));
  const d = (Pa[1] & 1n) === 0n ? d0 : N - d0;
  const t = bytes32(d ^ intFrom(await taggedHash("BIP0340/aux", aux)));
  const px = bytes32(Pa[0]);
  const k0 = mod(intFrom(await taggedHash("BIP0340/nonce", cat(t, px, msg))), N);
  if (k0 === 0n) throw new Error("nonce is zero");
  const R = affine(mul(G, k0));
  const k = (R[1] & 1n) === 0n ? k0 : N - k0;
  const rx = bytes32(R[0]);
  const e = mod(intFrom(await taggedHash("BIP0340/challenge", cat(rx, px, msg))), N);
  const sig = cat(rx, bytes32(mod(k + e * d, N)));
  if (!(await schnorrVerify(px, msg, sig))) throw new Error("produced an invalid signature");
  return sig;
}

export async function xOnlyPub(sk) { return bytes32(affine(mul(G, intFrom(sk)))[0]); }

// NIP-01: event id = sha256 of the UTF-8 JSON array [0, pubkey, created_at, kind, tags, content], no whitespace.
// JSON.stringify escapes exactly what NIP-01 lists (", \, and control characters) and leaves other characters raw.
export async function nostrEventId(ev) {
  return toHex(await sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
}

// a NIP-01 event is valid when its id recomputes and sig is a BIP-340 signature by pubkey over the id bytes
export async function nostrEventCheck(ev) {
  const shapeOk = ev && typeof ev === "object" && /^[0-9a-f]{64}$/.test(ev.id || "") && /^[0-9a-f]{64}$/.test(ev.pubkey || "")
    && /^[0-9a-f]{128}$/.test(ev.sig || "") && Number.isSafeInteger(ev.created_at) && ev.created_at >= 0
    && Number.isSafeInteger(ev.kind) && ev.kind >= 0 && Array.isArray(ev.tags) && ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
    && typeof ev.content === "string";
  if (!shapeOk) return { ok: false, why: "not a NIP-01 event (id, pubkey, created_at, kind, tags, content, sig with their types, lower-case hex)" };
  const id = await nostrEventId(ev);
  if (id !== ev.id) return { ok: false, why: "the event id does not recompute from its fields (NIP-01)", recomputed_id: id };
  if (!(await schnorrVerify(hexToBytes(ev.pubkey), hexToBytes(ev.id), hexToBytes(ev.sig)))) return { ok: false, why: "sig is not a valid BIP-340 signature by pubkey over the event id" };
  return { ok: true, id };
}
