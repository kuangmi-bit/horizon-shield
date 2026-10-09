// Joint candidate v1 target-coverage cases (aeoess/agent-governance-vocabulary#177): an action-bound source and an
// endpoint-coverage source required together. Runs inside a federation-port checkout at v1-candidates/target-coverage/nenrin-joint/,
// next to target-coverage.test.ts, and uses its decide() unchanged. Importing that file also runs its own eight cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { decide } from '../target-coverage.test.ts'

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'))
const adapters: Record<string, any> = {
  'invinoveritas/verdict-check': (await import('../../../adapters/invinoveritas-verdict/adapter.ts')).createAdapter,
  'horizonshield.nenrin/conduct-walk-check': (await import('../../../adapters/nenrin-conduct-walk/adapter.ts')).createAdapter,
}
type Claim = { claim: string; status: string; reason?: string }

/**
 * The digest form both components fall back to past the 120-unit reason bound. If the runtime also accepts
 * subject:target_sha256=<hex> when <hex> is sha256 of the runtime target's UTF-8 bytes, the exact-string rule holds for any length.
 * Shown here as a rewrite in front of decide(), so decide() itself stays as published.
 */
function withDigestSubject(claims: Claim[], runtimeTarget: string | null): Claim[] {
  if (runtimeTarget === null) return claims
  const h = createHash('sha256').update(runtimeTarget, 'utf8').digest('hex')
  return claims.map(c => c.status === 'established' && c.reason === `subject:target_sha256=${h}` ? { ...c, reason: `subject:target=${runtimeTarget}` } : c)
}

for (const k of V.cases) {
  test(`${k.id} ${k.name}`, async () => {
    const claims: Claim[] = []
    for (const [id, make] of Object.entries(adapters)) {
      const a = make({ config: V.component_config[id], secrets: {}, fetch })
      const input: any = { operation_id: `op_${k.id}`, workflow: 'refund', action: structuredClone(k.action),
                           evidence: new Uint8Array(Buffer.from(JSON.stringify(k.evidence[id]))), now: V.now }
      if (k.runtime_target !== null) input.target = k.runtime_target
      claims.push(...(await a.check(input)).claims)
    }
    for (const [claim, [status, reason]] of Object.entries(k.expected.claims) as [string, [string, string]][]) {
      const c = claims.find(x => x.claim === claim)
      assert.deepEqual([c?.status, c?.reason], [status, reason], claim)
      assert.ok((c?.reason ?? '').length <= 120, `${claim} reason within the bound`)
    }
    const d = decide(k.requirements, claims, V.component_coverage, k.runtime_target)
    assert.equal(d.decision, k.expected.decision, JSON.stringify(d))
    if (k.expected.refusal) assert.equal(d.refusal, k.expected.refusal)
    const dd = decide(k.requirements, withDigestSubject(claims, k.runtime_target), V.component_coverage, k.runtime_target)
    assert.equal(dd.decision, k.expected.decision_with_digest_subject ?? k.expected.decision, 'with the digest subject: ' + JSON.stringify(dd))
  })
}
