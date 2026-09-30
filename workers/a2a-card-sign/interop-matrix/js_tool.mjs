// JS side of the matrix, official @a2a-js/sdk. sign <case.json> <key.pem> <kid> <jku> | verify <served.json> <jwks.json>
import { readFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { generateAgentCardSignature, verifyAgentCardSignature, canonicalizeAgentCard } from "@a2a-js/sdk";
import { createHash } from "node:crypto";
const [cmd, a, b, kid, jku] = process.argv.slice(2);
const out = (o) => console.log(JSON.stringify(o));
try {
  if (cmd === "sign") {
    const card = JSON.parse(readFileSync(a, "utf8"));
    const signer = generateAgentCardSignature(createPrivateKey(readFileSync(b, "utf8")), { alg: "ES256", typ: "JOSE", kid, jku });
    const signed = await signer(card);
    const s = signed.signatures[signed.signatures.length - 1];
    out({ signature: { protected: s.protected, signature: s.signature } });
  } else if (cmd === "canon") {
    const c = canonicalizeAgentCard(JSON.parse(readFileSync(a, "utf8")));
    out({ len: Buffer.byteLength(c), sha256: createHash("sha256").update(c, "utf8").digest("hex"), text: c });
  } else {
    const card = JSON.parse(readFileSync(a, "utf8"));
    const jwks = JSON.parse(readFileSync(b, "utf8"));
    const verify = verifyAgentCardSignature(async (k) => { const j = jwks.keys.find((x) => x.kid === k); if (!j) throw new Error("kid not in JWKS: " + k); return j; });
    await verify(card);
    out({ ok: true });
  }
} catch (e) {
  out(cmd === "sign" ? { error: String(e && e.message || e) } : { ok: false, error: String(e && e.message || e).slice(0, 300) });
}
