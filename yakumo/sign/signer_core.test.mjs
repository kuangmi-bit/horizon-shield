// signer_core.test.mjs : the browser signer's records must be exactly what the Python verifiers accept.
// Node 20+ (Web Crypto Ed25519) and python3 with the musubi-v0 verifiers in this repo.
// Run: node yakumo/sign/signer_core.test.mjs
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as S from "./signer_core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUSUBI = path.resolve(HERE, "../../workers/hs-ledger/nenrin/musubi-v0");
let fails = 0;
const ok = (n, c, d) => { console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  " + (d || ""))); if (!c) fails++; };

function py(code, input) {
  return JSON.parse(execFileSync("python3", ["-c", code], { input: JSON.stringify(input), cwd: MUSUBI, encoding: "utf-8" }));
}

console.log("yakumo signer core : cross-check with the Python verifiers");
ok("Ed25519 is available in this runtime", await S.supported());

const k = await S.newKey();
ok("public key is 32 bytes of base64", S.unb64(k.publicB64).length === 32);
ok("the public key derived from the private key matches", (await S.publicB64Of(k.privateKey)) === k.publicB64);
const pem = await S.exportPem(k.privateKey);
const back = await S.importPem(pem);
ok("the PEM backup restores the same key", (await S.publicB64Of(back)) === k.publicB64);
ok("key.json is the canonical {public_key_ed25519_b64}", S.keyFile(k.publicB64) === '{"public_key_ed25519_b64":"' + k.publicB64 + '"}\n');

// canonical bytes agree with Python's contract_v0.canonical on awkward strings
const tricky = { b: "改行\nタブ\t引用\"円\\", a: [1, null, true, "\u007f "], c: { z: 0, y: "\u0001" } };
const pyCanon = py("import sys,json; from contract_v0 import canonical; print(json.dumps(canonical(json.load(sys.stdin))))", tricky);
ok("canonical bytes equal Python's contract_v0.canonical", S.canonical(tricky) === pyCanon, S.canonical(tricky) + " vs " + pyCanon);

const decl = await S.signDeclaration(S.buildDeclaration({ publicB64: k.publicB64, domain: "reform-sn.example", keyUrl: "https://reform-sn.example/.well-known/nenrin-key.json",
  houjinBango: "1234567890123", companyName: "テスト株式会社", declaredAt: "2026-09-28T10:00:00Z" }), k.privateKey);
const d = py("import sys,json; import independence_v0 as ind; r,pub=ind.check_declaration(json.load(sys.stdin)); print(json.dumps({'refusals':r.refusals,'findings':r.findings,'pub':pub}))", decl);
ok("independence_v0.check_declaration accepts the declaration with no refusal", d.refusals.length === 0 && d.pub === k.publicB64, JSON.stringify(d.refusals));
const tampered = JSON.parse(JSON.stringify(decl)); tampered.legal_entity.id = "9999999999999";
const dt = py("import sys,json; import independence_v0 as ind; r,pub=ind.check_declaration(json.load(sys.stdin)); print(json.dumps({'codes':[x['code'] for x in r.refusals]}))", tampered);
ok("a declaration edited after signing is refused (not_signed_by_declared_key)", dt.codes.includes("not_signed_by_declared_key"), JSON.stringify(dt.codes));

const H = "ab".repeat(32), T = "cd".repeat(32), BH = "0".repeat(20) + "ef".repeat(22);
const meas = await S.signMeasurement(S.buildMeasurement({ contractSha: H, termsSha: T, itemId: "jccdb-v4v-0123456789abcdef", measured: S.parseQuantity("187.4"),
  method: "on_site_tape_measure_v0", publicB64: k.publicB64, beacon: { kind: "bitcoin_block", height: 969000, hash: BH }, evidenceSha: "ee".repeat(32) }), k.privateKey);
const m = py(`import sys,json
import corroboration_v0 as C
from agreement_verify import ed25519_verify
m=json.load(sys.stdin)
ok=any(ed25519_verify(m['measurer']['public_key_ed25519_b64'], s['sig_b64'], C.measurement_signing_bytes(m)) is True for s in m['signatures'])
extra=sorted(set(m)-set(C.MEAS_KEYS))
print(json.dumps({'sig':ok,'extra':extra,'sha':C.measurement_sha256(m)}))`, meas);
ok("corroboration_v0 verifies the measurer's signature", m.sig === true);
ok("the measurement carries only keys corroboration_v0 reads", m.extra.length === 0, JSON.stringify(m.extra));
const jsSha = await S.sha256Hex(S.canonical(Object.fromEntries(Object.entries(meas).filter(([key]) => key !== "anchor"))));
ok("the measurement digest agrees with corroboration_v0.measurement_sha256", jsSha === m.sha, jsSha + " vs " + m.sha);

ok("parseQuantity: 187.4 -> {1874, 1}", JSON.stringify(S.parseQuantity("187.4")) === '{"value":1874,"scale":1}');
ok("parseQuantity: 150 -> 150", S.parseQuantity("150") === 150);
ok("parseQuantity refuses negatives, exponents, zero and 10 decimals", [S.parseQuantity("-1"), S.parseQuantity("1e3"), S.parseQuantity("0"), S.parseQuantity("1.0000000001")].every((x) => x === null));
ok("a 12 digit houjin bango is refused before signing", /13 桁/.test(S.declarationProblem({ publicB64: k.publicB64, domain: "a.example", keyUrl: "https://a.example/k.json", houjinBango: "123456789012", companyName: "x" })));
ok("a domain written with https:// is refused", /ドメイン/.test(S.declarationProblem({ publicB64: k.publicB64, domain: "https://a.example", keyUrl: "https://a.example/k.json", houjinBango: "1234567890123", companyName: "x" })));
ok("a measurement without a beacon is refused before signing", /目印/.test(S.measurementProblem({ contractSha: H, termsSha: T, itemId: "x", measured: 1, method: "m", publicB64: k.publicB64, beacon: null })));

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASS (yakumo signer core)");
process.exit(fails ? 1 : 0);
