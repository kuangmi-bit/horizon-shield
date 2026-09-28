// consent_testkit.mjs : test-only helpers for record-privacy-v1 on /witness/task. Real Ed25519 did:keys for the
// short party names the selftests use ("did:key:A", "did:key:B", "did:key:C"), and a signer for the consent entry.
// Witness names (W1, W2, ...) are left alone: a witness does not consent, the parties do.
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { consentMessage } from "./task_ledger_v0.mjs";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ""; while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
export function newParty() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { did: "did:key:z" + b58encode(Buffer.concat([Buffer.from([0xed, 0x01]), raw])), priv: privateKey };
}
const REG = new Map();   // short name -> { did, priv }
for (const n of ["A", "B", "C", "D"]) REG.set("did:key:" + n, newParty());
const BY_DID = new Map([...REG.values()].map((p) => [p.did, p]));
export const D = (name) => (REG.has(name) ? REG.get(name).did : name);
export function consentEntry(obs, did, overrideMsg) {
  const p = BY_DID.get(did); if (!p) throw new Error("no key for " + did);
  return { party: did, sig: edSign(null, Buffer.from(overrideMsg || consentMessage(obs), "utf8"), p.priv).toString("base64") };
}
// both hop parties consent (when both are keys this kit holds); returns a new object
export function consented(obs) {
  if (!obs || !obs.hop || !BY_DID.has(obs.hop.from) || !BY_DID.has(obs.hop.to)) return obs;
  return Object.assign({}, obs, { consent: [consentEntry(obs, obs.hop.from), consentEntry(obs, obs.hop.to)] });
}
