// NENRIN conduct-walk component (tool_admission). Checks, offline, a signed NENRIN witness record of the endpoint this
// workflow dispatches to: that a witness the customer trusts signed exactly these record bytes, that the walk was of that
// endpoint, and that it passed recently enough. The same check the NENRIN ledger runs when a witness files a record.
// No network, no dependencies, no secrets. Written against src/contract only.
// 0.2.0 adds nenrin.walk_covers_target for the candidate v1 CheckInput.target (aeoess/agent-governance-vocabulary#177):
// the walked URL is compared, exact string, with the runtime's declared target, and reported as the claim's subject.
// 0.3.0 follows the v1 draft (aeoess/federation-port#5): binds on every claim in the manifest, the walked URL as the structured
// subject.target of the two target-bound claims, and nenrin.walk_passed_recently bound to the runtime target when the runtime
// declares one (otherwise a workflow could pair a walk of the target with a pass recorded for another endpoint, C6 inside one
// component). v0 runtimes ignore subject; the established target claim keeps its subject:target= reason for them.
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Adapter, AdapterContext, CheckOutput, ClaimResult, Manifest } from '../../src/contract/types.ts'

const manifest: Manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
const C_AUTH = 'nenrin.walk_authentic'
const C_COVERS = 'nenrin.walk_covers_endpoint'
const C_PASSED = 'nenrin.walk_passed_recently'
const C_TARGET = 'nenrin.walk_covers_target'
/** The runtime bounds reasons to this many UTF-16 units (federation-port REASON_MAX); a longer subject is reported by digest. */
const REASON_MAX = 120
const SCHEMA = 'jidec-path-v1'
const PURPOSE = 'a2a-conduct-walk-v1: '
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')
const B64 = /^[A-Za-z0-9+/]+={0,2}$/
const HEX64 = /^[0-9a-f]{64}$/
const WALKED_AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/

/** Sorted-key JSON with no spaces: the form the walker signs (Python json.dumps sort_keys, separators (",", ":"), ensure_ascii=False). */
function canonical(v: unknown): string {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non_finite_number'); return JSON.stringify(v) }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
  }
  throw new Error(`unsupported_type:${typeof v}`)
}

/** Standard base64 that decodes to exactly n bytes and re-encodes to the same text (no other spelling of the same bytes). */
function b64Exact(s: unknown, n: number): Buffer | null {
  if (typeof s !== 'string' || s.length % 4 !== 0 || !B64.test(s)) return null
  const b = Buffer.from(s, 'base64')
  return b.length === n && b.toString('base64') === s ? b : null
}

/** A real UTC calendar instant in the walker's form, to the millisecond, or NaN. */
function walkedAtMs(s: unknown): number {
  if (typeof s !== 'string') return NaN
  const m = WALKED_AT.exec(s)
  if (!m) return NaN
  const t = Date.parse(s)
  const d = new Date(t)
  return Number.isFinite(t) && d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3]
    && d.getUTCHours() === +m[4] && d.getUTCMinutes() === +m[5] && d.getUTCSeconds() === +m[6] ? t : NaN
}

const hostOf = (u: unknown): string | null => {
  if (typeof u !== 'string' || !u.startsWith('https://')) return null
  try { return new URL(u).hostname.toLowerCase() } catch { return null }
}

type Trusted = { public_key_ed25519_b64: string; key_url?: string }
type Config = { endpoint?: string; trusted_witnesses?: Record<string, Trusted>; operator_domains?: string[]; max_age_s?: number; future_skew_s?: number }

/** ClaimResult plus the structured subject proposed for v1 (aeoess/federation-port#5, section 5). v0 runtimes ignore it. */
type ClaimResultV1 = ClaimResult & { subject?: { target: string } }
/** Section 3 of the v1 draft: a non-empty string of Unicode scalar values (no lone surrogates). */
export const isValidTarget = (t: unknown): t is string => typeof t === 'string' && t !== '' && !/\p{Cs}/u.test(t)

function all(status: ClaimResult['status'], reason: string, evidence: Uint8Array = new Uint8Array()): CheckOutput {
  return { evidence, claims: [C_AUTH, C_COVERS, C_PASSED, C_TARGET].map(claim => ({ claim, status, reason })) }
}

/**
 * The subject of an established target claim, as v0 has no subject field: `subject:target=<url>`, or when that would exceed
 * the runtime's reason bound, `subject:target_sha256=<hex of sha256 over the URL's UTF-8 bytes>`, so it is never cut.
 */
export function targetSubject(url: string): string {
  const plain = `subject:target=${url}`
  return plain.length <= REASON_MAX ? plain : `subject:target_sha256=${createHash('sha256').update(url, 'utf8').digest('hex')}`
}

export function createAdapter(ctx: AdapterContext): Adapter {
  const cfg = (ctx.config ?? {}) as Config
  const endpoint = typeof cfg.endpoint === 'string' ? cfg.endpoint : null
  const trusted = Object.fromEntries(Object.entries(cfg.trusted_witnesses ?? {}).map(([d, t]) => [d.toLowerCase(), t]))
  const operator = new Set((cfg.operator_domains ?? []).map(d => d.toLowerCase()))
  const maxAgeS = cfg.max_age_s ?? 7 * 86400
  const skewS = cfg.future_skew_s ?? 300
  return {
    describe: () => manifest,
    async check(input): Promise<CheckOutput> {
      const bytes = input.evidence
      // candidate v1: the runtime's declared dispatch target. v0 has no such field, so it is read only when present as a string.
      const rt = (input as { target?: unknown }).target
      const runtimeTarget = typeof rt === 'string' ? rt : null
      if (!bytes || bytes.byteLength === 0) return all('not_established', 'no_walk_presented')
      if (endpoint === null) return all('failed', 'config_endpoint_missing', bytes)
      let w: Record<string, unknown>
      try {
        const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
        w = (parsed && typeof parsed === 'object' && parsed.record && typeof parsed.record === 'object') ? parsed.record : parsed
      } catch { return all('failed', 'evidence_not_json', bytes) }
      if (!w || typeof w !== 'object' || typeof w.record_canonical !== 'string') return all('failed', 'evidence_not_a_witness_record', bytes)
      const rc = w.record_canonical as string
      let r: Record<string, any>
      try { r = JSON.parse(rc) } catch { return all('failed', 'record_canonical_not_json', bytes) }
      if (!r || typeof r !== 'object' || Array.isArray(r)) return all('failed', 'record_not_an_object', bytes)

      // 1. authenticity: these exact record bytes, signed by the key the customer pinned for the witness's domain
      const sha = createHash('sha256').update(rc, 'utf8').digest('hex')
      const host = hostOf(r.witness?.key_url)
      const pin = host ? trusted[host] : undefined
      const pinKey = pin ? b64Exact(pin.public_key_ed25519_b64, 32) : null
      const sig = b64Exact(w.signature_ed25519_b64, 64)
      let canon: string | null = null
      try { canon = canonical(r) } catch { canon = null }
      let auth: ClaimResult
      if (w.sha !== undefined && (typeof w.sha !== 'string' || !HEX64.test(w.sha) || w.sha !== sha)) auth = { claim: C_AUTH, status: 'not_established', reason: 'sha_does_not_recompute' }
      else if (canon !== rc) auth = { claim: C_AUTH, status: 'not_established', reason: 'record_not_canonical' }
      else if (r.schema !== SCHEMA) auth = { claim: C_AUTH, status: 'not_established', reason: 'not_a_jidec_path_record' }
      else if (!host) auth = { claim: C_AUTH, status: 'not_established', reason: 'record_names_no_https_key_url' }
      else if (operator.has(host)) auth = { claim: C_AUTH, status: 'not_established', reason: 'witness_is_the_operator' }
      else if (!pin) auth = { claim: C_AUTH, status: 'not_established', reason: 'witness_domain_not_trusted' }
      else if (!pinKey) auth = { claim: C_AUTH, status: 'failed', reason: 'config_pinned_key_malformed' }
      else if (pin.key_url !== undefined && pin.key_url !== r.witness.key_url) auth = { claim: C_AUTH, status: 'not_established', reason: 'key_url_is_not_the_pinned_one' }
      else if (w.public_key_ed25519_b64 !== undefined && w.public_key_ed25519_b64 !== pin.public_key_ed25519_b64) auth = { claim: C_AUTH, status: 'not_established', reason: 'presented_key_is_not_the_pinned_key' }
      else if (!sig) auth = { claim: C_AUTH, status: 'not_established', reason: 'signature_missing_or_malformed' }
      else {
        let ok = false
        try { ok = verify(null, Buffer.from(rc, 'utf8'), createPublicKey({ key: Buffer.concat([SPKI_ED25519, pinKey]), format: 'der', type: 'spki' }), sig) } catch { ok = false }
        auth = ok ? { claim: C_AUTH, status: 'established' } : { claim: C_AUTH, status: 'not_established', reason: 'signature_invalid' }
      }
      if (auth.status !== 'established') {
        return { evidence: bytes, claims: [auth, { claim: C_COVERS, status: 'not_established', reason: 'walk_not_authentic' },
                                                  { claim: C_PASSED, status: 'not_established', reason: 'walk_not_authentic' },
                                                  { claim: C_TARGET, status: 'not_established', reason: 'walk_not_authentic' }] }
      }

      // 2. coverage: the walk was of the endpoint this workflow dispatches to, byte for byte
      const walked = typeof r.purpose === 'string' && r.purpose.startsWith(PURPOSE) ? r.purpose.slice(PURPOSE.length) : null
      const covers: ClaimResult = walked === null
        ? { claim: C_COVERS, status: 'unsupported', reason: 'not_an_a2a_conduct_walk' }
        : walked === endpoint
          ? { claim: C_COVERS, status: 'established' }
          : { claim: C_COVERS, status: 'not_established', reason: 'walk_is_of_a_different_endpoint' }

      // 2b. target coverage (candidate v1): the walk was of the runtime's declared target, exact string, no normalisation.
      // The subject is what the signed record names, reported whenever it is a valid target, so the runtime compares it (section 5).
      const subj = walked !== null && isValidTarget(walked) ? { subject: { target: walked } } : {}
      const target: ClaimResultV1 = walked === null
        ? { claim: C_TARGET, status: 'unsupported', reason: 'not_an_a2a_conduct_walk' }
        : !isValidTarget(walked)
          ? { claim: C_TARGET, status: 'not_established', reason: 'walked_url_not_a_valid_target' }
          : runtimeTarget === null
            ? { claim: C_TARGET, status: 'not_established', reason: 'no_runtime_target', ...subj }
            : walked === runtimeTarget
              ? { claim: C_TARGET, status: 'established', reason: targetSubject(walked), ...subj }
              : { claim: C_TARGET, status: 'not_established', reason: 'walk_is_not_of_the_runtime_target', ...subj }

      // 3. result: every assertion of the walk passed, and the walk is fresh enough to act on
      const v = r.verdict ?? {}
      const nowMs = Date.parse(input.now)
      const at = walkedAtMs(r.walked_at)
      const expiresMs = at + maxAgeS * 1000
      // With a runtime target the pass must be a pass of that target (binds: target); without one (a v0 runtime) it is the pass of
      // the configured endpoint, as in 0.2.0.
      let passed: ClaimResultV1
      if (runtimeTarget !== null && walked !== runtimeTarget) passed = { claim: C_PASSED, status: 'not_established', reason: walked === null ? 'not_an_a2a_conduct_walk' : 'walk_is_not_of_the_runtime_target', ...subj }
      else if (runtimeTarget === null && covers.status !== 'established') passed = { claim: C_PASSED, status: 'not_established', reason: covers.reason ?? 'walk_does_not_cover_endpoint' }
      else if (!(v.ok === true && v.outcome === 'PASS' && Number.isInteger(v.n_total) && v.n_total > 0 && v.n_pass === v.n_total)) passed = { claim: C_PASSED, status: 'not_established', reason: `walk_outcome_${String(v.outcome)}` }
      else if (!Number.isFinite(at)) passed = { claim: C_PASSED, status: 'failed', reason: 'walked_at_malformed' }
      else if (at > nowMs + skewS * 1000) passed = { claim: C_PASSED, status: 'not_established', reason: 'walked_at_in_the_future' }
      else if (!(nowMs <= expiresMs)) passed = { claim: C_PASSED, status: 'not_established', reason: 'walk_older_than_max_age' }
      else passed = { claim: C_PASSED, status: 'established' }
      if (runtimeTarget !== null && passed.status !== 'failed') passed = { ...passed, ...subj }
      const out: CheckOutput = { evidence: bytes, claims: [auth, covers, passed, target] }
      if (passed.status === 'established') out.valid_until = new Date(expiresMs).toISOString()
      return out
    },
  }
}
