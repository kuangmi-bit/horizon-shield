// key-history-v1 (gate 0.4.18, 2026-09-28). Every public key this domain has signed with, when it began, and what
// happened to it. Served at /.well-known/key-history.json. Written here, in the commit, not in env: a key history
// that the running Worker could change without a commit would be a history nobody can hold the operator to.
//
// Why. A signature says who holds a key, not when it was made. If a key is stolen, every signature made with it
// from then on is the thief's, and nothing in the signed bytes says which ones those are. So a revoked key's
// signature counts only when the signed bytes can be shown to have existed before the key could have been stolen,
// by a clock the operator does not control (a Bitcoin-anchored timestamp, for example). Without that proof it does
// not count. A retired key (normal rotation, not stolen) keeps verifying what it signed. A key that is not in this
// history is not the domain's key.
//
// Rotation and compromise procedure: ext/KEY_HISTORY_v1.md. Each change to this list is anchored on the JIDEC ledger
// (the ledger entry carries history_sha256), so the list itself has a date nobody here can move.
import { canonicalUtf8, sha256Hex } from "./witness.js";

export const KEY_HISTORY_SCHEMA = "key-history-v1";
export const KEY_HISTORY_SPEC = "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-verify-gate/ext/KEY_HISTORY_v1.md";

// status: "active" (signing now) | "retired" (rotated out normally, still verifies what it signed) |
//         "revoked" (compromised or suspected; see compromised_from).
// since: the date the key was first published by a commit in this repository (the commit is named).
export const KEY_HISTORY = [
  {
    use: "agent-card",
    kid: "hs-2026-09",
    alg: "ES256",
    public_jwk: { kty: "EC", crv: "P-256", x: "CytwnuXFtXi7PFCcF-TCbvW5OgOg4KuWRLeRvdfHWLs", y: "Zha3FI2QplMaGveXjrIg8PxrZ6dTjHmESoGs88uAIiA" },
    served_at: ["https://gate.horizonshield.dev/.well-known/jwks.json", "https://mcp.horizonshield.dev/.well-known/jwks.json",
      "https://ledger.horizonshield.dev/.well-known/jwks.json", "https://jidec.horizonshield.dev/.well-known/jwks.json"],
    signs: "the A2A section 8.4 JWS signatures on the agent cards of gate, mcp, ledger and jidec",
    since: "2026-09-06", since_commit: "849a3724",
    status: "active", retired_at: null, revoked_at: null, compromised_from: null, reason: null,
  },
  {
    use: "agreement",
    kid: "agreement",
    alg: "Ed25519",
    public_key_ed25519_b64: "Q8DJu/tXWNNzsrmIkIUm4r2cR4MYaXNf1E2j+oZi+oo=",
    served_at: ["https://gate.horizonshield.dev/keys/agreement.json"],
    signs: "a2a-agreement-v1.1 records (the key is also carried inside each record's signed bytes)",
    since: "2026-09-11", since_commit: "20499efa",
    status: "active", retired_at: null, revoked_at: null, compromised_from: null, reason: null,
  },
  {
    use: "witness",
    kid: "witness",
    alg: "Ed25519",
    public_key_ed25519_b64: "jYoi4mw714eyuAUJoWwj58BGswDo4n27RNmAmIWZg4w=",
    served_at: ["https://gate.horizonshield.dev/keys/witness.json"],
    signs: "conduct-witness records, nenrin-witness-observation-v1 replies, and task-bound observations (witness_sig)",
    since: "2026-09-16", since_commit: "fe2de792",
    status: "active", retired_at: null, revoked_at: null, compromised_from: null, reason: null,
  },
  {
    use: "operator",
    kid: "operator",
    alg: "Ed25519",
    public_key_ed25519_b64: "fqrEpRuYScHz52eeiuAWAFEeJB3T7VtZJlducNIhzZM=",
    served_at: ["https://gate.horizonshield.dev/keys/operator.json"],
    signs: "nenrin-authorization-v1 recovery authorizations (TSUGI)",
    since: "2026-09-20", since_commit: "62745120",
    status: "active", retired_at: null, revoked_at: null, compromised_from: null, reason: null,
  },
];

export const KEY_HISTORY_RULE = [
  "A key not listed here is not this domain's key.",
  "active: signatures by this key are attributable to the operator.",
  "retired: rotated out without compromise; signatures made while it was active stay attributable.",
  "revoked: a signature by this key is attributable only when the signed bytes are shown, by a clock the operator does not control (for example a Bitcoin-anchored timestamp), to have existed before compromised_from. Without that proof it is not attributable.",
  "Any key: signed bytes shown to have existed before since are not attributable (the key did not exist yet).",
];


// Where a served history has been fixed outside this server, by a clock the operator does not control. An anchor is
// made after the list it anchors, so this list is NOT covered by history_sha256 (adding an anchor never changes the
// hash it anchors). Only an anchor whose history_sha256 equals the hash computed now is reported as covering the
// served list; the others are listed as previous. After a rotation the new list is honestly reported as not yet
// anchored until its own entry is added here.
// The canonical bytes of the list are the ledger entry's record (also record_canonical in the seed committed to the
// repository), and the OpenTimestamps proof stamps SHA-256 of exactly those bytes. Holding the bytes and the proof,
// anyone can check them against Bitcoin without this server or the ledger.
export const KEY_HISTORY_ANCHORS = [
  {
    history_sha256: "d479e3e036625b87e40cc1d0882e7f569843939d34f193e9e4da9b033559b7a9",
    as_of: "2026-09-28",
    jidec_entry: 60,
    ledger_url: "https://ledger.horizonshield.dev/ledger/60",
    canonical_bytes_url: "https://ledger.horizonshield.dev/ledger/60?format=raw",
    ots_url: "https://ledger.horizonshield.dev/ledger/60/ots",
    bitcoin_block: 968923,
    bitcoin_block_time: "2026-09-28 02:48 UTC",
    seed_in_repository: "https://github.com/ogasurfproject-jpg/horizon-shield/blob/main/workers/hs-ledger/seed_entry_key_history_2026-09-28.json",
    seed_commit: "8f2e02c6",
    // The same bytes and the same OpenTimestamps proof, deposited outside this domain (CERN Zenodo, 2026-10-03).
    zenodo_doi: "10.5281/zenodo.23122049",
    zenodo_record: "https://zenodo.org/records/23122049",
  },
];

// Pure: which anchors cover the history whose hash is given.
export function anchorsFor(historySha256, anchors = KEY_HISTORY_ANCHORS) {
  const current = anchors.filter((a) => a.history_sha256 === historySha256);
  const previous = anchors.filter((a) => a.history_sha256 !== historySha256);
  return { covers_served_list: current.length > 0, current, previous };
}


// The entry for a key, found by kid (card) or by the Ed25519 public key (the others).
export function findKey({ use, kid, public_key_ed25519_b64, jwk_x } = {}, history = KEY_HISTORY) {
  return history.find((k) => (!use || k.use === use) && (
    (kid && k.kid === kid && (!jwk_x || (k.public_jwk && k.public_jwk.x === jwk_x))) ||
    (public_key_ed25519_b64 && k.public_key_ed25519_b64 === public_key_ed25519_b64) ||
    (jwk_x && k.public_jwk && k.public_jwk.x === jwk_x)
  )) || null;
}

const t = (s) => { const v = Date.parse(s); return Number.isFinite(v) ? v : null; };

// Is a signature by this key attributable to the operator, given the earliest independently proven time the signed
// bytes existed (existed_before, ISO 8601, or null when there is no such proof)?
// Returns { attributable: true | false | null, reason }. null means this history cannot say (unknown key).
export function attributable(keyRef, existedBefore, history = KEY_HISTORY) {
  const k = findKey(keyRef, history);
  if (!k) return { attributable: null, reason: "key not in this domain's key history" };
  const proven = existedBefore == null ? null : t(existedBefore);
  if (existedBefore != null && proven === null) return { attributable: false, reason: "existed_before is not a valid time" };
  if (proven !== null && t(k.since) !== null && proven < t(k.since)) {
    return { attributable: false, reason: "the bytes are proven to predate the key (" + k.since + ")", kid: k.kid, status: k.status };
  }
  if (k.status === "active") return { attributable: true, reason: "key is active", kid: k.kid, status: k.status };
  if (k.status === "retired") {
    if (proven === null) return { attributable: true, reason: "key retired without compromise; signatures from its active period stay attributable", kid: k.kid, status: k.status };
    if (k.retired_at && proven > t(k.retired_at)) return { attributable: false, reason: "the bytes are proven only after the key was retired (" + k.retired_at + ")", kid: k.kid, status: k.status };
    return { attributable: true, reason: "retired key, bytes proven within its active period", kid: k.kid, status: k.status };
  }
  if (k.status === "revoked") {
    if (proven === null) return { attributable: false, reason: "key revoked and no independent proof that the bytes existed before " + k.compromised_from, kid: k.kid, status: k.status };
    if (!k.compromised_from || proven >= t(k.compromised_from)) return { attributable: false, reason: "the bytes are proven only at or after compromised_from (" + k.compromised_from + ")", kid: k.kid, status: k.status };
    return { attributable: true, reason: "revoked key, but the bytes are proven to have existed before compromised_from (" + k.compromised_from + ")", kid: k.kid, status: k.status };
  }
  return { attributable: null, reason: "unknown status " + k.status };
}

// Card keys a verifier may use: active and retired, never revoked.
export function cardJwksKeys(history = KEY_HISTORY) {
  return history.filter((k) => k.use === "agent-card" && (k.status === "active" || k.status === "retired"));
}

// The served document. history_sha256 covers keys and rule (canonical JSON, the same canonicalization as the witness
// records), so the ledger can anchor exactly what is served. env_consistency says whether the keys this Worker is
// configured with are the active keys in this history; a mismatch is shown, not hidden.
export async function keyHistoryDocument(env, cardSignature) {
  const body = { schema: KEY_HISTORY_SCHEMA, subject: "https://gate.horizonshield.dev", keys: KEY_HISTORY, rule: KEY_HISTORY_RULE };
  const history_sha256 = await sha256Hex(canonicalUtf8(body));
  const envKey = (name) => (env && env[name] ? String(env[name]).trim() : null);
  const check = (use, configured) => {
    const active = KEY_HISTORY.find((k) => k.use === use && k.status === "active") || null;
    if (!configured) return { use, configured: false, matches_active: null };
    return { use, configured: true, matches_active: !!(active && active.public_key_ed25519_b64 === configured) };
  };
  const cardActive = KEY_HISTORY.find((k) => k.use === "agent-card" && k.status === "active") || null;
  const env_consistency = [
    { use: "agent-card", configured: !!(cardSignature && cardSignature.jwk),
      matches_active: !!(cardSignature && cardSignature.jwk && cardActive && cardSignature.kid === cardActive.kid && cardSignature.jwk.x === cardActive.public_jwk.x && cardSignature.jwk.y === cardActive.public_jwk.y) },
    check("witness", envKey("WITNESS_PUBKEY_B64")),
    check("operator", envKey("OPERATOR_PUBKEY_B64")),
    check("agreement", envKey("AGREEMENT_PUBKEY_B64")),
  ];
  return {
    ...body,
    history_sha256,
    history_sha256_covers: "canonical JSON (sorted keys, UTF-8) of {schema, subject, keys, rule}",
    env_consistency,
    anchors: {
      ...anchorsFor(history_sha256),
      not_covered_by_history_sha256: true,
      how_to_verify: [
        "Take the canonical bytes (the file in zenodo_record, canonical_bytes_url, or record_canonical in seed_in_repository) and check that their SHA-256 equals history_sha256.",
        "Run ots verify on those bytes with the proof (the .ots file in zenodo_record, or ots_url); it must point to the Bitcoin block named here. The Zenodo record holds both, so no HORIZON SHIELD server is needed.",
      ],
      establishes: "the served list of public keys existed, byte for byte, no later than the Bitcoin block named in the anchor",
      does_not_establish: "that the keys were not stolen before or after that time; only when this list was fixed",
    },
    spec: KEY_HISTORY_SPEC,
    does_not_establish: [
      "that no key has been stolen; only what the operator has declared",
      "that a signature by an active key was made by the operator and not by someone who took the key without the operator knowing",
      "anything about a record's content; it says only whose key signed it and under which rule that counts",
    ],
  };
}
