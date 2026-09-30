// RUN_ALL: library
// Key succession records (a2a-key-succession-v0). The JavaScript twin of key_succession.py.
// Every string and every branch is the same as in python, in the same order, because the
// verifier's report must be byte-identical in both languages (agreement_succession_parity_test.mjs).
// Why this exists and the four rules it enforces: see the docstring of key_succession.py.
import { canonicalUtf8 } from "./agreement_canonical.mjs";

export const SCHEMA = "a2a-key-succession-v0";
export const CONTEXT = "a2a-key-succession-v0\n";
export const MAX_CHAIN = 64;
export const FIELDS = ["schema", "domain", "purpose", "old_public_key_ed25519_b64", "new_public_key_ed25519_b64",
  "reason", "effective_block", "prev_succession_sha256", "signatures"];
export const REASONS = ["rotation", "compromise"];

const enc = new TextEncoder();
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameKeys = (o, want) => {
  const k = Object.keys(o);
  return k.length === want.length && want.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

// python の isinstance(x, int) and not bool。parseStrict の整数は bigint で来る。
export function asInt(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  return null;
}

export function signingBytes(entry) {
  const body = {};
  for (const k of Object.keys(entry)) if (k !== "signatures") body[k] = entry[k];
  return enc.encode(CONTEXT + canonicalUtf8(body));
}

export async function entrySha256(entry, V) {
  return V.sha256Hex(canonicalUtf8(entry));
}

function keyOk(V, s) {
  if (typeof s !== "string") return false;
  const raw = V.b64Raw(s, 32);
  return raw !== null && V.publicKeyProblem(raw) === null;
}

// [ok, why, retired]。retired は {block: bigint, reason}。V は agreement_verify.mjs。
export async function checkChain(chain, domain, fromPub, toPub, V) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return [false, "no handover records were supplied for this key_url", null];
  }
  if (chain.length > MAX_CHAIN) {
    return [false, "the handover chain is longer than " + MAX_CHAIN + " records", null];
  }
  const seenOld = new Set();
  let prev = null;
  let retired = null;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    const at = "handover " + i;
    if (!isObj(e)) return [false, at + " is not an object", null];
    if (!sameKeys(e, FIELDS)) {
      return [false, at + " must carry exactly the fields " + FIELDS.slice().sort().join(", "), null];
    }
    if (e.schema !== SCHEMA) return [false, at + " is not " + SCHEMA, null];
    if (V.normDomain(e.domain) !== domain) {
      return [false, at + " is for " + V.pyRepr(e.domain) + ", not for " + domain, null];
    }
    if (e.purpose !== "agreement") {
      return [false, at + " is for purpose " + V.pyRepr(e.purpose) + ", not agreement", null];
    }
    const oldK = e.old_public_key_ed25519_b64, newK = e.new_public_key_ed25519_b64;
    if (!keyOk(V, oldK) || !keyOk(V, newK)) {
      return [false, at + " names a key that is not 32 bytes of usable Ed25519", null];
    }
    if (oldK === newK) return [false, at + " hands a key over to itself", null];
    if (!(typeof e.reason === "string" && REASONS.includes(e.reason))) {
      return [false, at + " has reason " + V.pyRepr(e.reason) + "; it must be rotation or compromise", null];
    }
    const blk = asInt(e.effective_block);
    if (blk === null || blk <= 0n) {
      return [false, at + " effective_block must be a positive integer", null];
    }
    if (i === 0) {
      if (e.prev_succession_sha256 !== null) {
        return [false, "the first handover must have prev_succession_sha256 null", null];
      }
    } else {
      if (e.prev_succession_sha256 !== await entrySha256(prev, V)) {
        return [false, at + " does not name the sha256 of the handover before it; a record was dropped, changed or reordered", null];
      }
      if (oldK !== prev.new_public_key_ed25519_b64) {
        return [false, at + " hands over a key the handover before it did not hand on", null];
      }
      if (blk <= asInt(prev.effective_block)) {
        return [false, at + " takes effect at block " + blk.toString() + ", not after the handover before it", null];
      }
    }
    if (seenOld.has(oldK)) return [false, at + " retires a key that was already retired; the chain loops", null];
    seenOld.add(oldK);
    const sigs = e.signatures;
    if (!Array.isArray(sigs) || !sigs.every((s) => isObj(s) && sameKeys(s, ["by", "sig"]))) {
      return [false, at + " signatures must be a list of {by, sig}", null];
    }
    const bys = sigs.map((s) => s.by);
    if (bys.some((b) => b !== "old" && b !== "new") || new Set(bys).size !== bys.length) {
      return [false, at + " signatures must be at most one by old and one by new", null];
    }
    const msg = signingBytes(e);
    const need = e.reason === "rotation" ? ["old", "new"] : ["new"];
    for (const who of need) {
      if (!bys.includes(who)) {
        return [false, at + " is not signed by the " + who + " key; a " + e.reason + " handover needs " + need.join(" and "), null];
      }
    }
    for (const s of sigs) {
      const key = s.by === "old" ? oldK : newK;
      if ((await V.ed25519Verify(key, s.sig, msg)) !== true) {
        return [false, at + " carries a " + s.by + " signature that does not verify", null];
      }
    }
    if (oldK === fromPub && retired === null) retired = { block: blk, reason: e.reason };
    prev = e;
  }
  if (chain[chain.length - 1].new_public_key_ed25519_b64 !== toPub) {
    return [false, "the chain ends at a key other than the one this key_url serves now", null];
  }
  if (chain.some((e) => e.old_public_key_ed25519_b64 === toPub)) {
    return [false, "the key served now was retired earlier in the chain", null];
  }
  if (retired === null) {
    return [false, "the key that signed this record is not retired anywhere in the chain", null];
  }
  return [true, "", retired];
}
