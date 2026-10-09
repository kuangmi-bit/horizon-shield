// Generates vectors.json: joint candidate v1 target-coverage cases, an action-bound source (invinoveritas/verdict-check) and an
// endpoint-coverage source (NENRIN conduct walk) required together in one workflow (aeoess/agent-governance-vocabulary#177).
// Deterministic. The NENRIN walks are real signed records from the ledger (../nenrin-conduct-walk/test/fixtures/walks.json),
// except J6, whose walk is signed by a test witness from a fixed seed. Verdicts are signed with a BIP-340 test key from a fixed
// string, zero aux randomness, fixed created_at; the signer below is the one in federation-port's
// v1-candidates/target-coverage/gen-vectors.ts (Apache-2.0, aeoess/federation-port#4), copied unchanged.
// Run: node --experimental-strip-types gen-vectors.mts
import { createHash, createPrivateKey, createPublicKey, sign as edSign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn, N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
type Pt = [bigint, bigint] | null
const md = (a: bigint, m = P) => ((a % m) + m) % m
const pw = (b: bigint, e: bigint): bigint => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n } return r }
const ad = (a: Pt, b: Pt): Pt => {
  if (a === null) return b; if (b === null) return a
  if (a[0] === b[0] && md(a[1] + b[1]) === 0n) return null
  const l = a[0] === b[0] && a[1] === b[1] ? md(3n * a[0] * a[0] * pw(2n * a[1], P - 2n)) : md((b[1] - a[1]) * pw(b[0] - a[0], P - 2n))
  const x = md(l * l - a[0] - b[0]); return [x, md(l * (a[0] - x) - a[1])]
}
const ml = (p: Pt, k: bigint): Pt => { let r: Pt = null; for (let i = 255; i >= 0; i--) { r = ad(r, r); if ((k >> BigInt(i)) & 1n) r = ad(r, p) } return r }
const G: Pt = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n]
const b32 = (x: bigint) => Buffer.from(x.toString(16).padStart(64, '0'), 'hex')
const int = (b: Uint8Array) => BigInt('0x' + Buffer.from(b).toString('hex'))
const th = (tag: string, ...parts: Uint8Array[]) => { const t = createHash('sha256').update(tag).digest(); const h = createHash('sha256').update(t).update(t); for (const x of parts) h.update(x); return h.digest() }
function sign(sk: bigint, msg: Buffer): Buffer {
  const Pk = ml(G, sk)!; const d = Pk[1] % 2n === 0n ? sk : N - sk
  const t = Buffer.from(b32(d).map((v, i) => v ^ th('BIP0340/aux', Buffer.alloc(32))[i]))
  const k0 = md(int(th('BIP0340/nonce', t, b32(Pk[0]), msg)), N); const R = ml(G, k0)!; const k = R[1] % 2n === 0n ? k0 : N - k0
  const e = md(int(th('BIP0340/challenge', b32(R[0]), b32(Pk[0]), msg)), N)
  return Buffer.concat([b32(R[0]), b32(md(k + e * d, N))])
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const SK = md(int(createHash('sha256').update('nenrin joint target-coverage verdict test key').digest()), N)
const PUB = b32(ml(G, SK)![0]).toString('hex')
function verdictOn(action: unknown) {
  const ev: any = { pubkey: PUB, created_at: 1791504000, kind: 30078, tags: [['schema', 'invinoveritas.verdict_proof.v1']],
                    content: JSON.stringify({ artifact_hash: sha(canonical(action)), verdict: 'approve' }) }
  ev.id = sha(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))
  ev.sig = sign(SK, Buffer.from(ev.id, 'hex')).toString('hex')
  return ev
}

// NENRIN side: real walks, and one test witness from a fixed Ed25519 seed for a target longer than the reason bound
const W = JSON.parse(readFileSync(new URL('../nenrin-conduct-walk/test/fixtures/walks.json', import.meta.url), 'utf8')).walks
const seed = createHash('sha256').update('nenrin joint target-coverage test witness').digest()
const witnessKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })
const WITNESS_PUB = (createPublicKey(witnessKey).export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64')
function testWalkOf(url: string) {
  const r = JSON.parse(W.pavlo_gate_a2a.record_canonical)
  r.purpose = 'a2a-conduct-walk-v1: ' + url
  r.witness = { ...r.witness, key_url: 'https://witness.test/keys/witness.json', name: 'witness.test', vantage: 'test witness, fixed seed' }
  const rc = canonical(r)
  return { record_canonical: rc, signature_ed25519_b64: edSign(null, Buffer.from(rc, 'utf8'), witnessKey).toString('base64') }
}
const walk = (w: any) => ({ record_canonical: w.record_canonical, signature_ed25519_b64: w.signature_ed25519_b64 })
/** The trusted-witness pin for a walk's domain: its Ed25519 public key and key URL, as the ledger served them. */
const PK = 'public_key_ed25519_b64'
const pinOf = (w: any) => ({ [PK]: w[PK], key_url: w.key_url })

const A = 'https://gate.horizonshield.dev/a2a', M = 'https://gate.horizonshield.dev/mcp', B = 'https://b.example/a2a'
const L = 'https://witness-target.example/' + 'path/'.repeat(20) + 'a2a'
const act = (target?: string) => ({ tool: 'refund', args: { payment_id: 'pay_A', amount_minor: 4000, currency: 'EUR', ...(target ? { target } : {}) } })
const IV = 'invinoveritas/verdict-check', NN = 'horizonshield.nenrin/conduct-walk-check'
const IV_T = 'invinoveritas.verdict_covers_target', NN_T = 'nenrin.walk_covers_target'
const both = [{ claim: IV_T, binds: 'target' }, { claim: NN_T, binds: 'target' }]
const subj = (t: string) => { const r = `subject:target=${t}`; return r.length <= 120 ? r : `subject:target_sha256=${sha(t)}` }

const cases = [
  { id: 'J1', name: 'both_sources_cover_the_runtime_target',
    description: 'The verdict was issued on an action naming A, a trusted witness walked A, the runtime dispatches to A. Both target-bound claims are established and report A.',
    action: act(A), runtime_target: A, evidence: { [IV]: verdictOn(act(A)), [NN]: walk(W.pavlo_gate_a2a) }, requirements: both,
    expected: { claims: { [IV_T]: ['established', subj(A)], [NN_T]: ['established', subj(A)] }, decision: 'admit' } },
  { id: 'J2', name: 'walk_of_another_path_on_the_same_host',
    description: 'The same verdict, but the walk presented is a genuine walk of /mcp on the same host. NENRIN does not cover A; the verdict still does. Refused, attributed to NENRIN.',
    action: act(A), runtime_target: A, evidence: { [IV]: verdictOn(act(A)), [NN]: walk(W.kuangmi_gate_mcp) }, requirements: both,
    expected: { claims: { [IV_T]: ['established', subj(A)], [NN_T]: ['not_established', 'walk_is_not_of_the_runtime_target'] }, decision: 'refuse', refusal: `required_claim_not_established:${NN_T}` } },
  { id: 'J3', name: 'verdict_issued_for_another_target',
    description: 'A matching walk of A, but the verdict was issued on the same action naming B. The verdict covers nothing here; the walk still covers A. Refused, attributed to invinoveritas.',
    action: act(A), runtime_target: A, evidence: { [IV]: verdictOn(act(B)), [NN]: walk(W.pavlo_gate_a2a) }, requirements: both,
    expected: { claims: { [IV_T]: ['not_established', 'verdict_is_for_a_different_action'], [NN_T]: ['established', subj(A)] }, decision: 'refuse', refusal: `required_claim_not_established:${IV_T}` } },
  { id: 'J4', name: 'trailing_slash_is_another_target',
    description: 'The action, its verdict and the runtime target are A with a trailing slash; the walk is of A. Exact string comparison, no normalisation: the verdict covers A/, the walk does not. Refused, attributed to NENRIN.',
    action: act(A + '/'), runtime_target: A + '/', evidence: { [IV]: verdictOn(act(A + '/')), [NN]: walk(W.pavlo_gate_a2a) }, requirements: both,
    expected: { claims: { [IV_T]: ['established', subj(A + '/')], [NN_T]: ['not_established', 'walk_is_not_of_the_runtime_target'] }, decision: 'refuse', refusal: `required_claim_not_established:${NN_T}` } },
  { id: 'J5', name: 'no_runtime_target',
    description: 'Both sources would cover A, but the workflow declares no runtime target. Neither target-bound claim can be established and the requirement refuses.',
    action: act(A), runtime_target: null, evidence: { [IV]: verdictOn(act(A)), [NN]: walk(W.pavlo_gate_a2a) }, requirements: both,
    expected: { claims: { [IV_T]: ['not_established', 'no_runtime_target'], [NN_T]: ['not_established', 'no_runtime_target'] }, decision: 'refuse', refusal: 'no_runtime_target' } },
  { id: 'J6', name: 'target_longer_than_the_reason_bound',
    description: 'A target of ' + L.length + ' characters. Both sources establish it and, independently, report it by digest (subject:target_sha256=<hex>) because subject:target=<url> exceeds the 120-unit reason bound. The candidate rule reads only subject:target= and refuses; a rule that also compares the digest with sha256 of the runtime target admits.',
    action: act(L), runtime_target: L, evidence: { [IV]: verdictOn(act(L)), [NN]: testWalkOf(L) }, requirements: both,
    expected: { claims: { [IV_T]: ['established', subj(L)], [NN_T]: ['established', subj(L)] }, decision: 'refuse', refusal: 'no_reported_subject', decision_with_digest_subject: 'admit' } },
]
const out = { schema: 'federation-port/v1-candidate/target-coverage-joint', status: 'candidate, not part of any contract version',
  components: { [IV]: 'invinoveritas/verdict-check 0.3.0', [NN]: 'NENRIN conduct-walk-check 0.2.0' },
  component_coverage: { 'invinoveritas.verdict_authentic': 'context', 'invinoveritas.verdict_covers_action': 'action', 'invinoveritas.verdict_permits_action': 'action', [IV_T]: 'target',
                        'nenrin.walk_authentic': 'context', 'nenrin.walk_covers_endpoint': 'context', 'nenrin.walk_passed_recently': 'context', [NN_T]: 'target' },
  component_config: {
    [IV]: { pubkey: PUB, accept_verdicts: ['approve'], max_age_s: 315360000 },
    [NN]: { endpoint: A, max_age_s: 315360000, operator_domains: ['horizonshield.dev', 'gate.horizonshield.dev', 'mcp.horizonshield.dev'], trusted_witnesses: {
      'pipavlo82.github.io': pinOf(W.pavlo_gate_a2a),
      'kuangmi-bit.github.io': pinOf(W.kuangmi_gate_mcp),
      'witness.test': pinOf({ [PK]: WITNESS_PUB, key_url: 'https://witness.test/keys/witness.json' }) } } },
  now: '2026-10-09T12:00:00.000Z',
  key_note: 'J1 to J5 use real NENRIN walks signed by two outside witnesses (pipavlo82.github.io, kuangmi-bit.github.io). J6 uses a test witness from a fixed seed. Verdicts use a BIP-340 test key from a fixed string, not the production invinoveritas key.',
  cases }
writeFileSync(new URL('./vectors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${cases.length} cases, verdict test pubkey ${PUB}, test witness ${WITNESS_PUB}`)
