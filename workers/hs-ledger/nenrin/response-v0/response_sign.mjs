#!/usr/bin/env node
// response_sign.mjs : write and sign a nenrin-response-v0 reply to measurements of your own endpoint.
// Zero dependencies (Node 18+). It signs locally and prints the body to POST; it sends nothing unless --post.
//
//   node response_sign.mjs --key my_ed25519.pem --subject https://api.example.com \
//     --key-url https://api.example.com/keys/agreement.json \
//     --about witness:<sha256> --about gate:<sha256> --text "What happened, in your words." > body.json
//   curl -sS -X POST https://ledger.horizonshield.dev/response -H 'content-type: application/json' --data-binary @body.json
//
// The key_url must serve {"public_key_ed25519_b64": "<the public half of --key>"} on your own host.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";

export function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])]));
  return x;
}
export function buildBody({ keyPem, subject, keyUrl, about, text, respondedAt }) {
  const priv = createPrivateKey(keyPem);
  const pub = Buffer.from(createPublicKey(priv).export({ format: "jwk" }).x, "base64url").toString("base64");
  const rec = { schema: "nenrin-response-v0", subject_origin: subject, about, text,
    responded_at: respondedAt || new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), key_url: keyUrl, public_key_ed25519_b64: pub };
  const t = JSON.stringify(sortKeys(rec));
  return { record_canonical: t, signature_ed25519_b64: sign(null, Buffer.from("nenrin-response-v0\n" + t, "utf8"), priv).toString("base64") };
}

async function main(argv) {
  const a = { about: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === "--key") { a.key = v; i++; } else if (k === "--subject") { a.subject = v; i++; } else if (k === "--key-url") { a.keyUrl = v; i++; }
    else if (k === "--text") { a.text = v; i++; } else if (k === "--post") { a.post = v || "https://ledger.horizonshield.dev/response"; i++; }
    else if (k === "--about") { const [kind, sha] = String(v).split(":"); a.about.push({ kind, sha256: sha }); i++; }
  }
  if (!a.key || !a.subject || !a.keyUrl || !a.text || !a.about.length) {
    console.error("usage: node response_sign.mjs --key <pem> --subject <https origin> --key-url <https url> --about witness:<sha>|gate:<sha> [--about ...] --text <text> [--post <url>]");
    return 2;
  }
  const body = buildBody({ keyPem: readFileSync(a.key, "utf8"), subject: a.subject, keyUrl: a.keyUrl, about: a.about, text: a.text });
  if (!a.post) { process.stdout.write(JSON.stringify(body) + "\n"); return 0; }
  const r = await fetch(a.post, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(r.status, await r.text());
  return r.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2)).then((c) => process.exit(c));
