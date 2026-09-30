// Independent check of vectors/a2a-card-sign-v01: every sha256 in MANIFEST, and every signature against its canonical_utf8_hex with WebCrypto (no code shared with vectors.py).
// node vectors_check.mjs vectors/a2a-card-sign-v01
import { readFileSync } from "fs"; import { createHash, webcrypto } from "crypto";
const dir = process.argv[2]; const man = JSON.parse(readFileSync(dir + "/MANIFEST.json"));
const jwk = JSON.parse(readFileSync(dir + "/testkey_jwks.json")).keys[0];
const key = await webcrypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const b64u = (b) => Buffer.from(b).toString("base64url");
let bad = 0;
for (const v of man.vectors) {
  const raw = readFileSync(dir + "/" + v.path);
  if (createHash("sha256").update(raw).digest("hex") !== v.sha256) { console.log("sha mismatch", v.path); bad++; }
  const d = JSON.parse(raw); const s = d.served_card.signatures[0];
  const payload = Buffer.from(d.canonical_utf8_hex, "hex");
  const ok = await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(s.signature, "base64url"), Buffer.from(s.protected + "." + b64u(payload)));
  const want = d.disposition === "MUST-REJECT" ? false : true;
  if (d.disposition === "MUST-REJECT") {
    const sigOverServed = ok; if (sigOverServed) { console.log("reject vector verifies over its own canonical", d.id); bad++; }
  } else if (!ok) { console.log("signature does not cover canonical", d.id); bad++; }
  console.log(d.id, ok, d.accept_under.join(","));
}
console.log(bad ? "FAIL " + bad : "all consistent");
