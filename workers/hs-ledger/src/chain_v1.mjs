// jidec-chain-v1 (2026-09-28). A predecessor binding over the JIDEC ledger, derived from fields every entry
// already carries, so no stored entry is rewritten and no claim_sha256 or Bitcoin anchor moves.
//
// Why. Scored against VLC-1 (MattyIceMatrix/vlc-1 PR #5) the ledger was L0: each claim_sha256 is anchored to
// Bitcoin on its own, but no entry bound its predecessor and nothing stated the head, so removing an entry or
// truncating the newest left every survivor valid. This file is the binding; GET /ledger/head states the head;
// the daily witness batch carries the head inside its anchored bytes, so a head exists that the operator
// cannot later move without the Bitcoin-stamped batch disagreeing.
//
// Recipe, identical to VLC-1's sha256-canonical-fields mechanism so its checker recomputes it unchanged:
//   entry_sha256(n) = sha256( canon({ n, schema, claim_sha256, created_at, prev_entry_sha256 }) )
//   canon = keys sorted, separators "," and ":", no spaces, non-ASCII escaped as \uXXXX (Python json.dumps
//           sort_keys=True, separators=(",",":"), ensure_ascii=True). An absent schema or created_at is omitted,
//           never written as null. prev_entry_sha256 of entry 1 is 64 zeros (the root).
export const CHAIN_SCHEMA = "jidec-chain-v1";
export const HEAD_SCHEMA = "jidec-head-v1";
export const CHAIN_ROOT = "0".repeat(64);
export const CHAIN_FIELDS = ["n", "schema", "claim_sha256", "created_at", "prev_entry_sha256"];
export const CHAIN_RECIPE = "entry_sha256 = sha256(canon({n, schema, claim_sha256, created_at, prev_entry_sha256})); canon = keys sorted, separators , and : without spaces, non-ASCII escaped (json.dumps sort_keys=True, separators=(',',':'), ensure_ascii=True); an absent schema or created_at is omitted, never null; entry 1 links to 64 zeros";

function esc(s) {
  return JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
export function canon(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("canon: only safe integers");
    return String(v);
  }
  if (typeof v === "string") return esc(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => esc(k) + ":" + canon(v[k])).join(",") + "}";
}
export function chainBody(entry, prev) {
  const b = { n: entry.n, claim_sha256: entry.claim_sha256, prev_entry_sha256: prev };
  if (typeof entry.schema === "string") b.schema = entry.schema;
  if (typeof entry.created_at === "string") b.created_at = entry.created_at;
  return b;
}
export async function sha256hexStr(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function entrySha(entry, prev) { return sha256hexStr(canon(chainBody(entry, prev))); }

// Walk entries 1..upTo. getEntry(n) returns the stored entry or null. A missing entry breaks the chain and is
// reported, never skipped: a hole is exactly what the binding exists to show.
export async function walkChain(getEntry, upTo, onRow) {
  let prev = CHAIN_ROOT;
  for (let n = 1; n <= upTo; n++) {
    const e = await getEntry(n);
    if (!e || e.n !== n || typeof e.claim_sha256 !== "string") return { ok: false, broken_at: n, head: prev, n: n - 1 };
    const h = await entrySha(e, prev);
    if (onRow) await onRow(e, prev, h);
    prev = h;
  }
  return { ok: true, head: prev, n: upTo };
}

export function exportRow(entry, prev, h) {
  const r = chainBody(entry, prev);
  r.entry_sha256 = h;
  return r;
}
export function headRecord(n, head) {
  return { schema: HEAD_SCHEMA, n, head, root: CHAIN_ROOT, chain: CHAIN_SCHEMA };
}

// 2026-09-29. The end marker is bound by the chain too. VLC-1 1.4.1-draft (Corrigendum 6, EXT-022) found that an
// end marker the chain does not bind proves nothing about the tail on the log alone: drop the newest entries,
// copy the new last entry_sha256 into the marker's head, compute no hash, and the head comparison still passes.
// Under 1.4.1 the export therefore scored L0 on the log alone and L1 only against a held head. Here the marker
// links to the last entry and carries its own entry_sha256 by the same recipe, over the fields it has:
//   marker entry_sha256 = sha256( canon({ n, schema: "jidec-head-v1", prev_entry_sha256: head, head }) )
// so a rewritten marker breaks a hash. A verifier holding a stamped head (n and entry_sha256 from a batch's
// ledger_head) derives the marker hash from those two values alone, so the stamped batches stay usable as the
// independently held value.
export const HEAD_FIELDS = ["n", "schema", "prev_entry_sha256", "head"];
export const HEAD_RECIPE = "marker entry_sha256 = sha256(canon({n, schema: \"jidec-head-v1\", prev_entry_sha256: head, head})), the same canon as entries; prev_entry_sha256 and head are both the last entry_sha256";
export async function markerSha(n, head) {
  return sha256hexStr(canon({ n, schema: HEAD_SCHEMA, prev_entry_sha256: head, head }));
}
export async function boundHeadRecord(n, head) {
  const r = headRecord(n, head);
  r.prev_entry_sha256 = head;
  r.entry_sha256 = await markerSha(n, head);
  return r;
}
