// NENRIN conduct-walk component (tool_admission), run through the unmodified runtime. Uses only the published contract.
// Fixtures: three real signed witness records as GET https://ledger.horizonshield.dev/witness/<sha> serves them, filed by two
// outside witnesses: pipavlo82.github.io (a walk of https://gate.horizonshield.dev/a2a, 2026-10-07) and kuangmi-bit.github.io
// (walks of https://mcp.horizonshield.dev/mcp and https://gate.horizonshield.dev/mcp, 2026-10-07). Records whose time or verdict
// a test needs to choose are signed here with a throwaway key for the domain witness.test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { APS, APS_CLAIMS, ROOT, pinFromDisk, request, setup } from './helpers.ts'
import { createAdapter } from '../adapters/nenrin-conduct-walk/adapter.ts'

const ID = 'horizonshield.nenrin/conduct-walk-check'
const C = { auth: 'nenrin.walk_authentic', covers: 'nenrin.walk_covers_endpoint', passed: 'nenrin.walk_passed_recently' }
const W = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/nenrin/walks.json'), 'utf8')).walks
const GATE_A2A = 'https://gate.horizonshield.dev/a2a'
const PAVLO = { 'pipavlo82.github.io': { public_key_ed25519_b64: W.pavlo_gate_a2a.public_key_ed25519_b64, key_url: 'https://pipavlo82.github.io/keys/witness.json' } }
const KUANGMI = { 'kuangmi-bit.github.io': { public_key_ed25519_b64: W.kuangmi_mcp.public_key_ed25519_b64 } }
const LONG = 10 * 365 * 86400   // the real records were signed once; freshness has its own tests
const bytes = (o: unknown) => new Uint8Array(Buffer.from(JSON.stringify(o)))
const apsRequired = APS_CLAIMS.map(claim => ({ component: APS, claim }))

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}

// a throwaway witness at witness.test: the real Pavlo record with the fields a test chooses, re-signed
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const TEST_PUB = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('base64')
const TEST = { 'witness.test': { public_key_ed25519_b64: TEST_PUB } }
function testWalk(edit: (r: any) => void) {
  const r = JSON.parse(W.pavlo_gate_a2a.record_canonical)
  r.witness = { ...r.witness, key_url: 'https://witness.test/keys/witness.json', name: 'witness.test' }
  edit(r)
  const rc = canonical(r)
  return { record_canonical: rc, signature_ed25519_b64: sign(null, Buffer.from(rc, 'utf8'), privateKey).toString('base64') }
}
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

async function env(config: Record<string, unknown>, as: 'required' | 'optional' = 'required') {
  const pin = pinFromDisk(join(ROOT, 'adapters/nenrin-conduct-walk'), { config })
  const refs = [C.auth, C.covers, C.passed].map(claim => ({ component: ID, claim }))
  return setup({ extraComponents: { [ID]: pin }, required: as === 'required' ? [...apsRequired, ...refs] : apsRequired, optional: as === 'optional' ? refs : [] })
}
const claims = (e: Awaited<ReturnType<typeof setup>>, op: string) =>
  Object.fromEntries((e.rt.provenance(op) as any).admissions.at(-1).claims.filter((c: any) => c.component === ID).map((c: any) => [c.claim, c.status]))
async function refusedWith(config: Record<string, unknown>, evidence: Uint8Array | undefined, reason: string) {
  const e = await env(config)
  try {
    const { req } = request(e)
    if (evidence) (req.evidence as Record<string, Uint8Array>)[ID] = evidence
    const r = await e.rt.submit(req)
    assert.equal(r.status, 'refused')
    assert.ok((r as any).reasons.includes(reason), JSON.stringify((r as any).reasons))
    assert.equal(e.provider.requests, 0)
  } finally { await e.close() }
}

test('N01 a real signed walk of the configured endpoint by a trusted outside witness: admitted, all three claims established, record kept as evidence', async () => {
  const e = await env({ endpoint: GATE_A2A, trusted_witnesses: { ...PAVLO, ...KUANGMI }, max_age_s: LONG })
  try {
    const { req } = request(e); (req.evidence as Record<string, Uint8Array>)[ID] = bytes(W.pavlo_gate_a2a)
    assert.equal((await e.rt.submit(req)).status, 'provider_confirmed')
    assert.deepEqual(claims(e, req.operation_id), { [C.auth]: 'established', [C.covers]: 'established', [C.passed]: 'established' })
    assert.equal(Buffer.from(e.rt.store.evidence(req.operation_id, ID, 'check:0')!).toString(), JSON.stringify(W.pavlo_gate_a2a))
  } finally { await e.close() }
  // the {record: ...} wrapper (the shape the NENRIN MCP tool nenrin_witness returns) is accepted too, from the other witness
  const e2 = await env({ endpoint: 'https://mcp.horizonshield.dev/mcp', trusted_witnesses: KUANGMI, max_age_s: LONG })
  try {
    const { req } = request(e2); (req.evidence as Record<string, Uint8Array>)[ID] = bytes({ lookup: 'ok', record: W.kuangmi_mcp })
    assert.equal((await e2.rt.submit(req)).status, 'provider_confirmed')
  } finally { await e2.close() }
})

test('N02 a genuine signed walk of a different endpoint does not cover this one', async () => {
  const e = await env({ endpoint: GATE_A2A, trusted_witnesses: KUANGMI, max_age_s: LONG })
  try {
    const { req } = request(e); (req.evidence as Record<string, Uint8Array>)[ID] = bytes(W.kuangmi_gate_mcp)   // gate.horizonshield.dev/mcp, not /a2a
    const r = await e.rt.submit(req)
    assert.equal(r.status, 'refused')
    assert.deepEqual(claims(e, req.operation_id), { [C.auth]: 'established', [C.covers]: 'not_established', [C.passed]: 'not_established' })
    assert.ok((r as any).reasons.includes(`required_claim_not_established:${ID}#${C.covers}:walk_is_of_a_different_endpoint`), JSON.stringify((r as any).reasons))
    assert.equal(e.provider.requests, 0)
  } finally { await e.close() }
})

test('N03 a real walk by a witness the customer does not trust, or by a domain it lists as the operator, is refused on authenticity', async () => {
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: KUANGMI, max_age_s: LONG }, bytes(W.pavlo_gate_a2a),
    `required_claim_not_established:${ID}#${C.auth}:witness_domain_not_trusted`)
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: PAVLO, operator_domains: ['PIPAVLO82.github.io'], max_age_s: LONG }, bytes(W.pavlo_gate_a2a),
    `required_claim_not_established:${ID}#${C.auth}:witness_is_the_operator`)
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: { 'pipavlo82.github.io': { ...PAVLO['pipavlo82.github.io'], key_url: 'https://pipavlo82.github.io/keys/other.json' } }, max_age_s: LONG },
    bytes(W.pavlo_gate_a2a), `required_claim_not_established:${ID}#${C.auth}:key_url_is_not_the_pinned_one`)
})

test('N04 tampering: an edited record, a reformatted record, a flipped signature bit and a key swap are each refused on authenticity', async () => {
  const cfg = { endpoint: GATE_A2A, trusted_witnesses: PAVLO, max_age_s: LONG }
  const w = W.pavlo_gate_a2a
  const edited = w.record_canonical.replace('"n_pass":7', '"n_pass":8')
  assert.notEqual(edited, w.record_canonical)
  const reformatted = JSON.stringify(JSON.parse(w.record_canonical), null, 1)
  const sig = Buffer.from(w.signature_ed25519_b64, 'base64'); sig[0] ^= 1
  const cases: [unknown, string][] = [
    [{ ...w, record_canonical: edited }, 'sha_does_not_recompute'],                       // the served sha no longer matches
    [{ ...w, sha: undefined, record_canonical: edited }, 'signature_invalid'],            // without the sha, the signature catches it
    [{ ...w, sha: undefined, record_canonical: reformatted }, 'record_not_canonical'],    // same JSON, other bytes
    [{ ...w, signature_ed25519_b64: sig.toString('base64') }, 'signature_invalid'],
    [{ ...w, public_key_ed25519_b64: W.kuangmi_mcp.public_key_ed25519_b64 }, 'presented_key_is_not_the_pinned_key'],
    [{ ...w, signature_ed25519_b64: w.signature_ed25519_b64.slice(0, -2) }, 'signature_missing_or_malformed'],
  ]
  for (const [ev, reason] of cases) await refusedWith(cfg, bytes(ev), `required_claim_not_established:${ID}#${C.auth}:${reason}`)
  // the customer pinned the wrong key for the right domain: the record's own key field is dropped, so only the signature can tell
  await refusedWith({ ...cfg, trusted_witnesses: { 'pipavlo82.github.io': { public_key_ed25519_b64: W.kuangmi_mcp.public_key_ed25519_b64 } } },
    bytes({ ...w, public_key_ed25519_b64: undefined }), `required_claim_not_established:${ID}#${C.auth}:signature_invalid`)
})

test('N05 the result: a failed walk, a future walk and a stale walk are refused; a fresh passing walk is admitted, valid until walked_at + max_age_s', async () => {
  const now = Date.now()
  const cfg = { endpoint: GATE_A2A, trusted_witnesses: TEST }
  await refusedWith(cfg, bytes(testWalk(r => { r.walked_at = iso(now - 60_000); r.verdict = { n_pass: 6, n_total: 7, ok: false, outcome: 'FAIL' } })),
    `required_claim_not_established:${ID}#${C.passed}:walk_outcome_FAIL`)
  await refusedWith(cfg, bytes(testWalk(r => { r.walked_at = iso(now - 60_000); r.verdict = { n_pass: 7, n_total: 8, ok: true, outcome: 'PASS' } })),
    `required_claim_not_established:${ID}#${C.passed}:walk_outcome_PASS`)   // a PASS label whose counts disagree is not a pass
  await refusedWith(cfg, bytes(testWalk(r => { r.walked_at = iso(now + 3600_000) })),
    `required_claim_not_established:${ID}#${C.passed}:walked_at_in_the_future`)
  await refusedWith({ ...cfg, max_age_s: 60 }, bytes(testWalk(r => { r.walked_at = iso(now - 3600_000) })),
    `required_claim_not_established:${ID}#${C.passed}:walk_older_than_max_age`)
  await refusedWith(cfg, bytes(testWalk(r => { r.walked_at = '2026-02-30T00:00:00Z' })),
    `required_claim_failed:${ID}#${C.passed}:walked_at_malformed`)
  // valid_until is walked_at + max_age_s, in the runtime's exact millisecond form (any other form would make every claim unavailable)
  const walkedAt = iso(now - 60_000)
  const out = await createAdapter({ config: { ...cfg, max_age_s: 3600 }, secrets: {}, fetch })
    .check!({ operation_id: 'x', workflow: 'refund', action: { tool: 'refund', args: {} }, evidence: bytes(testWalk(r => { r.walked_at = walkedAt })), now: new Date(now).toISOString() })
  assert.equal(out.valid_until, new Date(Date.parse(walkedAt) + 3600_000).toISOString())
  assert.match(out.valid_until!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  const e = await env(cfg)
  try {
    const { req } = request(e); (req.evidence as Record<string, Uint8Array>)[ID] = bytes(testWalk(r => { r.walked_at = walkedAt }))
    assert.equal((await e.rt.submit(req)).status, 'provider_confirmed')
    assert.deepEqual(claims(e, req.operation_id), { [C.auth]: 'established', [C.covers]: 'established', [C.passed]: 'established' })
  } finally { await e.close() }
})

test('N06 no walk presented, malformed bytes, a record that is not a witness record, and a component with no endpoint configured', async () => {
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: PAVLO }, undefined, `required_claim_not_established:${ID}#${C.auth}:no_walk_presented`)
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: PAVLO }, new Uint8Array(Buffer.from('not json')), `required_claim_failed:${ID}#${C.auth}:evidence_not_json`)
  await refusedWith({ endpoint: GATE_A2A, trusted_witnesses: PAVLO }, bytes({ sha: W.pavlo_gate_a2a.sha }), `required_claim_failed:${ID}#${C.auth}:evidence_not_a_witness_record`)
  await refusedWith({ trusted_witnesses: PAVLO, max_age_s: LONG }, bytes(W.pavlo_gate_a2a), `required_claim_failed:${ID}#${C.auth}:config_endpoint_missing`)
})

test('N07 as an optional component it never blocks: admitted without a walk, statuses recorded', async () => {
  const e = await env({ endpoint: GATE_A2A, trusted_witnesses: PAVLO }, 'optional')
  try {
    const { req } = request(e)
    assert.equal((await e.rt.submit(req)).status, 'provider_confirmed')
    assert.deepEqual(claims(e, req.operation_id), { [C.auth]: 'not_established', [C.covers]: 'not_established', [C.passed]: 'not_established' })
  } finally { await e.close() }
})

// 0.2.0: nenrin.walk_covers_target, for the candidate v1 CheckInput.target (aeoess/agent-governance-vocabulary#177). v0's runtime
// passes no target, so these call the component directly with the field set, as the v1 candidate vectors do.
const T = 'nenrin.walk_covers_target'
async function targetClaim(walk: unknown, target: string | undefined, trusted: Record<string, unknown> = { ...PAVLO, ...KUANGMI }) {
  const a = createAdapter({ config: { endpoint: GATE_A2A, trusted_witnesses: trusted, max_age_s: LONG }, secrets: {}, fetch })
  const input: any = { operation_id: 'op_t', workflow: 'refund', action: { tool: 'refund', args: {} }, evidence: bytes(walk), now: new Date().toISOString() }
  if (target !== undefined) input.target = target
  const out = await a.check!(input)
  return out.claims.find((c: any) => c.claim === T)!
}

test('N08 target: a real walk of the runtime target establishes it and reports the walked URL as the subject; another endpoint, a trailing slash and no runtime target do not', async () => {
  assert.deepEqual(await targetClaim(W.pavlo_gate_a2a, GATE_A2A), { claim: T, status: 'established', reason: `subject:target=${GATE_A2A}` })
  assert.deepEqual(await targetClaim(W.kuangmi_gate_mcp, GATE_A2A), { claim: T, status: 'not_established', reason: 'walk_is_not_of_the_runtime_target' })
  assert.deepEqual(await targetClaim(W.pavlo_gate_a2a, GATE_A2A + '/'), { claim: T, status: 'not_established', reason: 'walk_is_not_of_the_runtime_target' })
  assert.deepEqual(await targetClaim(W.pavlo_gate_a2a, 'https://GATE.horizonshield.dev/a2a'), { claim: T, status: 'not_established', reason: 'walk_is_not_of_the_runtime_target' })
  assert.deepEqual(await targetClaim(W.pavlo_gate_a2a, undefined), { claim: T, status: 'not_established', reason: 'no_runtime_target' })
  assert.deepEqual(await targetClaim(W.pavlo_gate_a2a, GATE_A2A, KUANGMI), { claim: T, status: 'not_established', reason: 'walk_not_authentic' })
})

test('N09 target: a subject longer than the runtime reason bound is reported by sha256 of the URL, never cut', async () => {
  const long = 'https://witness-target.example/' + 'a'.repeat(120) + '/a2a'
  const w = testWalk(r => { r.purpose = 'a2a-conduct-walk-v1: ' + long })
  const c = await targetClaim(w, long, TEST)
  assert.equal(c.status, 'established')
  assert.equal(c.reason, 'subject:target_sha256=' + createHash('sha256').update(long, 'utf8').digest('hex'))
  assert.ok(c.reason.length <= 120)
  const exact = 'https://x.example/' + 'b'.repeat(120 - 'subject:target=https://x.example/'.length)
  const w2 = testWalk(r => { r.purpose = 'a2a-conduct-walk-v1: ' + exact })
  assert.deepEqual(await targetClaim(w2, exact, TEST), { claim: T, status: 'established', reason: 'subject:target=' + exact })
})
