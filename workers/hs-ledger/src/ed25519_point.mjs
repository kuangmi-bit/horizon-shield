// ed25519_point.mjs : the ledger worker's copy of nenrin/task-delegation-bind-v0/ed25519_key.mjs ed25519KeyCheck.
// That module keys its cache with Buffer, which this Worker does not have (no nodejs_compat), and it is vendored byte
// for byte into the SDKs and the witness worker, so it is not edited; this file copies its arithmetic unchanged.
// test/ed25519_point.test.mjs holds the two to the same answers. true only for the canonical encoding of a point of
// the prime-order subgroup: not small order (R = identity, S = 0 would verify every message), not mixed order, not
// a second spelling of one point.
const ED_P = (1n << 255n) - 19n;
const ED_L = (1n << 252n) + 27742317777372353535851937790883648493n;
const edMod = (a) => { const r = a % ED_P; return r < 0n ? r + ED_P : r; };
function edPow(b, e) { let r = 1n; b = edMod(b); while (e > 0n) { if (e & 1n) r = (r * b) % ED_P; b = (b * b) % ED_P; e >>= 1n; } return r; }
const ED_D = edMod(-121665n * edPow(121666n, ED_P - 2n));
const ED_D2 = (2n * ED_D) % ED_P;
const ED_SQRT_M1 = edPow(2n, (ED_P - 1n) / 4n);

// extended coordinates (X, Y, Z, T): x = X/Z, y = Y/Z, x*y = T/Z. add-2008-hwcd-3, complete for a = -1.
function edAdd(P, Q) {
  const A = edMod((P[1] - P[0]) * (Q[1] - Q[0])), B = edMod((P[1] + P[0]) * (Q[1] + Q[0]));
  const C = edMod(P[3] * ED_D2 % ED_P * Q[3]), D = edMod(2n * P[2] * Q[2]);
  const E = edMod(B - A), F = edMod(D - C), G = edMod(D + C), H = edMod(B + A);
  return [E * F % ED_P, G * H % ED_P, F * G % ED_P, E * H % ED_P];
}
function edMul(P, n) {
  let R = [0n, 1n, 1n, 0n], Q = P;
  while (n > 0n) { if (n & 1n) R = edAdd(R, Q); Q = edAdd(Q, Q); n >>= 1n; }
  return R;
}
const edIsIdentity = (P) => P[0] % ED_P === 0n && edMod(P[1] - P[2]) === 0n;

export function ed25519PointOk(raw) {
  if (!raw || raw.length !== 32) return false;
  return ed25519KeyCheck(raw);
}

function ed25519KeyCheck(raw) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? raw[i] & 0x7f : raw[i]);
  const sign = (raw[31] >> 7) & 1;
  if (y >= ED_P) return false;                                   // non-canonical y
  const u = edMod(y * y - 1n), v = edMod(ED_D * y * y + 1n);
  const x2 = (u * edPow(v, ED_P - 2n)) % ED_P;
  let x = edPow(x2, (ED_P + 3n) / 8n);
  if ((x * x) % ED_P !== x2) x = (x * ED_SQRT_M1) % ED_P;
  if ((x * x) % ED_P !== x2) return false;                       // not on the curve
  if (x === 0n && sign === 1) return false;                      // -0: non-canonical
  if (Number(x & 1n) !== sign) x = ED_P - x;
  const P = [x, y, 1n, (x * y) % ED_P];
  if (edIsIdentity(P)) return false;                             // the identity (order 1)
  return edIsIdentity(edMul(P, ED_L));                           // L * P = O: prime-order subgroup, not small or mixed order
}

