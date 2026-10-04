# NENRIN task-execution-bind-v0 to VATE AL2 v0.3: field and rule mapping (non-normative)

Status: non-normative mapping note, written for a2aproject/A2A#1769. It changes nothing on either
side. It states, for two commit-pinned profiles, which fields correspond directly, under what
condition a digest on one side equals a digest on the other, which rules exist only on one side,
which fields have no counterpart, and what each original signature covers. It claims no
semantic equivalence, no compatibility, and no endorsement in either direction.

Revised 2026-09-30 after review by Poke-nushi (a2aproject/A2A#1769): in section 1 the grant and receipt
preimage formulas now also exclude action_binding, as bind_exec.mjs at the NENRIN pin does, and the paragraph
on derived fields no longer says the ids sit outside every signature. A record's own id is outside that
record's signature; references to it inside other records are signed. The pins are unchanged, and nothing in
sections 2 to 8 changed except the two notes marked "2026-09-30" (the digest equality condition in
section 2 and the provider_id row in section 3), which record the reviewer's answers.

## 0. Pins

NENRIN side: ogasurfproject-jpg/horizon-shield at da98d4bfe0c38ef9fb89e6cfcd50f5fed3f336cd

| path | role |
| --- | --- |
| workers/hs-ledger/nenrin/task-execution-bind-v0/SPEC.md | AuthorizationGrant, ExecutionReceipt, rules E1 to E3, action_binding rule AB |
| workers/hs-ledger/nenrin/task-execution-bind-v0/EXTENSION.md | invariant to test-vector map |
| workers/hs-ledger/nenrin/task-delegation-bind-v0/SPEC.md | WitnessObservation, rules R1 to R4, canonical form musubi-canonical-v0 |
| workers/hs-ledger/nenrin/provenance-v0/provenance_verify.mjs | the composed verifier (report shape: verdict, refusals, findings, establishes, does_not_establish, rules, signers) |
| workers/hs-ledger/nenrin/sdk/nenrin_verify.mjs | the same verifier as one file; published as nenrin-verify 0.2.2 |
| workers/hs-ledger/nenrin/interop-v0/ | five frozen fixtures and expected.json (the verdict signatures reproduced by Poke-nushi) |

Fixture file SHA-256 (first 16 hex) at this pin: pass 88a6765f6fea6af0, disagreement 0378cdf046dbd206,
equivocation de185233380c282c, forged_signature 7084486c457fd7e1, broken_chain 21c4ccf76f1034aa,
expected.json 0bf1c44dfaad81ea.

VATE side: Poke-nushi/Verifiable-Agent-Trust-Envelope at bf9b6fa3cf0c5306ef19c2ce00878818879348e6

| path | role |
| --- | --- |
| schemas/admission-receipt.schema.json | admission receipt (verifier-issued) |
| schemas/post-execution-receipt.schema.json | post-execution receipt (runtime, agent, verifier or broker issued) |
| schemas/a2a-vate-metadata.schema.json, docs/a2a-metadata-binding-v0.3.md | reference-only carriage in A2A metadata |
| docs/profiles/vate-al2-verifier-admission-profile-v0.3.md | post-execution linkage invariants (the table of nine relations) |
| docs/receipt-model-v0.3.md | receipt semantics, attenuation, proof and packaging |
| docs/conformance/digest-basis.md | the digest classes and the current fixture JSON byte basis |
| docs/profiles/vate-proof-profile-jose-jcs-v0.2.md | proof boundary (review profile, not enforced by the reference runner) |

## 1. The records on each side, and who signs what

NENRIN (execution layer, task-execution-bind-v0):

| record | signer | signed bytes | derived fields outside the signed bytes |
| --- | --- | --- | --- |
| AuthorizationGrant | caller (caller_sig) | musubi-canonical-v0(grant minus grant_ref, caller_sig, action_binding): schema, task_id, action{tool,target,args_sha256}, caller_id, provider_id, nonce, not_before, not_after | grant_ref (SHA-256 of those bytes), action_binding |
| ExecutionReceipt | provider named in the grant (provider_sig) | musubi-canonical-v0(receipt minus receipt_id, provider_sig, action_binding): schema, task_id, grant_ref, executed_action, outcome{status, result_sha256, evidence}, provider_id, executed_at | receipt_id (SHA-256 of those bytes), action_binding |
| Intent (preflight) | provider (intent_sig) | musubi-canonical-v0(intent minus intent_id, intent_sig, action_binding): the declared proposed_action referencing the grant by grant_ref | intent_id, action_binding |

NENRIN (observation layer, task-delegation-bind-v0):

| record | signer | signed bytes | derived fields |
| --- | --- | --- | --- |
| WitnessObservation | witness (witness_sig), independent of both hop parties (R1) | musubi-canonical-v0(observation minus evidence_id, witness_sig, edge_sig): task_id, hop{seq,from,to}, prev_evidence_id, conduct{verdict, detail_ref}, witness_id, observed_at | evidence_id (SHA-256 of those bytes) |
| edge attestation | the delegating party hop.from (edge_sig) | musubi-canonical-v0({task_id, hop}) | none |

Key resolution on the NENRIN side is did:key, offline. Signatures in the pinned fixtures are raw
Ed25519 over the canonical bytes, base64, and that is the wire form (SPEC.md, clarified 2026-10-04: no JWS
envelope). Each record's own derived id is outside that record's signature, and is recomputable from
the signed bytes: grant_ref outside caller_sig, receipt_id outside provider_sig, intent_id outside
intent_sig, evidence_id outside witness_sig. That does not make references to those ids unsigned. The
receipt's grant_ref is inside the bytes provider_sig covers, so provider_sig binds the receipt to one
specific grant (E3); the intent's grant_ref is inside intent_sig; a receipt reference carried in
observation.conduct.detail_ref (nenrin-exec://<receipt_id>) is inside witness_sig; and prev_evidence_id is
inside the next observation's witness_sig. These signed references are what bind the records together.
action_binding alone is outside every signature: it is derived from the signed action and refused on
mismatch (rule AB).

VATE (bf9b6fa3):

| record | issuer | what the schema fixes about the proof |
| --- | --- | --- |
| admission receipt | verifier (verifier.id, verifier.key_id) | proof{format in detached_jws, jwt, vc_proof, external, none; alg; kid; signature_ref}. The schemas define no signature scheme (receipt-model-v0.3.md, Proof And Packaging). |
| post-execution receipt | issuer.role in runtime, agent, verifier, broker | same proof object |

What a VATE signature covers is therefore declared by the selected proof profile, not by the
schema: the JOSE/JCS proof profile v0.2 says the signed payload basis is RFC 8785 JCS or exact
media bytes, that the digest target must be named before verification, and that it is a review
profile the reference runner does not enforce. The pinned examples carry proof.signature_ref as an
external reference. This note does not assume any coverage beyond that.

## 2. Identity and digest basis on each side (kept intact, not merged)

| identifier | side | basis | grammar |
| --- | --- | --- | --- |
| grant_ref, receipt_id, intent_id, evidence_id | NENRIN | SHA-256 over musubi-canonical-v0 bytes of the record's preimage; the schema name is inside the bytes | 64 lowercase hex, no prefix |
| action_binding.digest.value | NENRIN | SHA-256 over musubi-canonical-v0(action), action being {tool, target, args_sha256} | 64 lowercase hex inside digestDescriptor {alg: "sha-256", value} |
| receipt_id | VATE | opaque identifier assigned by the issuer (schema: string, minLength 1). Not a content hash. | any |
| admission.digest | VATE | digestDescriptor over the complete admission receipt under the digest basis the applicable profile or binding selects (profile v0.3, Receipt content row) | {alg: "sha-256", value: 64 hex} |
| request.input_hash, attenuation.original_request_hash, attenuation.effective_request_hash, execution.effective_request_hash, result.output_hash | VATE | profileHash: profile-defined SHA-256 over the request or result basis object | "sha-256:" + 64 lowercase hex |
| action_binding (request.action_binding, execution.action_binding) | VATE | optional; type in canonical_request_digest (requires canonicalization), profile_defined_digest (requires preimage_profile), external_reference (requires uri); complements, does not replace, admission.digest | digestDescriptor |

The two canonical byte rules:

| property | musubi-canonical-v0 (NENRIN) | VATE v0.3 fixture JSON byte basis |
| --- | --- | --- |
| definition | task-delegation-bind-v0/SPEC.md, vectors in musubi-v0/canonical_vectors.json (Python and Node, byte identical) | docs/conformance/digest-basis.md: json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8") |
| key order | code point, keys restricted to printable ASCII (refused otherwise) | code point (sort_keys) |
| whitespace | none | none |
| non-ASCII in strings | raw UTF-8 | escaped as \uXXXX (ensure_ascii=True) |
| numbers | integers only within plus or minus 2^53 - 1; fractions and exponents refused | whatever Python serializes; floats allowed |
| duplicate keys | refused before hashing (strict_json.mjs) | not defined |
| claims to be RFC 8785 / JCS | no; it is its own named rule | no; digest-basis.md says not to relabel it as JCS |

Consequence, stated as the rule this note uses everywhere below:

A NENRIN digest and a VATE digest are the same number only when three things agree: the preimage
object (the same JSON value, field for field), the canonical bytes (the two rules above produce
identical bytes for that value), and the hash encoding (VATE carries the sha-256: prefix on
profileHash fields and no prefix inside digestDescriptor.value). Matching object shape, or a matching
canonicalization name, does not establish it.

Worked example at the pins (interop-v0/fixtures/pass.json, grant.action):

    {"args_sha256":"sha_args_ok","target":"/task","tool":"a2a.invoke"}
    musubi-canonical-v0 bytes == VATE fixture basis bytes : true
    SHA-256 (both)                                          : afb9101ea788dc7785a77958e682a800adee8eb93664397f32d2b73b2c300d91

Counterexample, one non-ASCII character in target ({"tool":"a2a.invoke","target":"/見積","args_sha256":"x"}):
the two rules produce different bytes (raw UTF-8 versus 見積) and different digests
(2d7d8edd... versus 1ad6f551...). So the equality holds for the pinned fixtures, which are
printable ASCII with integer-free actions, and it is a per-object fact, not a property of the pair
of rules.

2026-09-30, from Poke-nushi's review: a case that asserts the equality names the exact request preimage,
the canonical byte rule and the hash encoding, and recomputes both digests for that input. Declaring the
basis is not enough on its own; the recomputation is what establishes it for that case.

## 3. Direct correspondences

"direct" here means the same fact, carried as a separate field on both sides, comparable by
equality once the condition in the last column holds.

| NENRIN field | VATE field | relation | condition |
| --- | --- | --- | --- |
| task_id (on grant, receipt, intent, observation; must agree across all presented records) | request.a2a_task_id (admission), execution.a2a_task_id (post-execution) | same A2A Task id literal, carried and never derived on both sides | none |
| action_binding on grant, receipt or intent: {type: "canonical_request_digest", canonicalization: "musubi-canonical-v0", preimage_profile: "task-execution-bind-v0/action", digest: {alg: "sha-256", value}} | request.action_binding, execution.action_binding | same object shape and field names; VATE accepts it as type canonical_request_digest with the canonicalization named | a VATE recipient that cannot recompute musubi-canonical-v0 treats it as an adjacent digest (digest-basis.md, Adjacent Protocol Digest Boundary); NENRIN refuses a binding it cannot recompute (rule AB) |
| action_binding.digest.value on the receipt (equals SHA-256 of musubi-canonical-v0(executed_action), which E1 has already compared to grant.action) | execution.effective_request_hash (minus the "sha-256:" prefix) | equal only under the rule in section 2 | a VATE profile or case must declare its request basis object to be the NENRIN action object {tool, target, args_sha256} and its digest basis to produce the same bytes for that object; absent that declaration the value is carried as action_binding and never substituted for effective_request_hash |
| grant.action.tool | request.action (string) | the action name | request.action is a string in VATE; target and args live in VATE's profile-defined request basis object and constraints, not in this field |
| receipt.executed_at | execution.started_at, execution.finished_at | one instant versus an interval | a profile would state which VATE instant the NENRIN instant is, or record both |
| grant.not_before, grant.not_after | issued_at, expires_at (admission) | a validity window the execution instant must fall in; NENRIN checks executed_at inside the grant window, VATE checks started_at and finished_at inside the admission window | the windows are issued by different parties (caller versus verifier) and are not the same window |
| grant.provider_id (executor the caller authorizes; did:key) | subject.actor (admission), execution.runtime, subject.runtime | identity of the executing party | VATE distinguishes actor from runtime; NENRIN has one executor identity. 2026-09-30, from Poke-nushi's review: the role mapping stays profile-specific, and a profile states whether provider_id identifies the actor, the runtime or both, and what evidence establishes that association. One executor identifier does not populate both roles by default |
| grant.caller_id (the party that signs the authorization) | subject.principal | the party on whose authority the action runs | in VATE principal is the linked principal behind the actor, not necessarily the signer of an authorization artifact |
| receipt.outcome.result_sha256 | result.output_hash | a digest of the output | NENRIN v0 does not pin the grammar or preimage of result_sha256 (compared as an opaque string; the fixtures use placeholders); VATE pins "sha-256:" + 64 hex over its result basis; equality needs a NENRIN profile rule that pins the grammar first |
| receipt.outcome.status | result.outcome (success, partial_success, failed, cancelled) | outcome state | NENRIN v0 does not enumerate status; a value map is a profile rule, not a direct correspondence |
| receipt.outcome.evidence {kind in bitcoin_tx, ledger_record, document_sha256, url_sha256; ref; system} (inside provider_sig) | result.side_effects[] entries carrying references (payment_reference, confirmation_reference); admission evidence[] {type, uri, digest, verification} | an independently checkable pointer committed under the issuer's signature | the vocabularies differ; both sides mark that a pointer being present is not the same as it being confirmed (NENRIN evidence_bound_unchecked finding; VATE evidence[].verification.result) |
| observation.conduct.detail_ref = "nenrin-exec://<receipt_id>" | a2a-vate-metadata artifact reference {uri, digest} (reference_plus_digest) | a digest-bound reference from an A2A-adjacent carrier to a receipt | different carriers: NENRIN puts it inside the witness-signed observation; VATE puts it in A2A message or Agent Card metadata |

## 4. The three distinctions, stated as rules

D1. grant_ref is not admission.digest. grant_ref identifies the caller's signed authorization by
its content hash; it lives inside the provider's signed receipt bytes (E3). admission.digest
identifies the verifier's admission receipt, which carries the verifier's decision and policy. NENRIN
has no admission receipt and no field that maps to admission.digest; VATE's post-execution receipt
has no field that maps to grant_ref. If one execution is described by both a NENRIN receipt and a
VATE post-execution receipt, it carries two references to two different artifacts, and neither one
substitutes for the other. A NENRIN provenance report says so in its does_not_establish list: no
allow or deny, no admission, is established.

D2. action_binding.digest.value corresponds to execution.effective_request_hash only under the
three-way agreement in section 2 (preimage object, canonical bytes, hash encoding). The name
musubi-canonical-v0 on the binding tells a recipient which rule to recompute with; it does not
tell the recipient that the VATE request basis is the same object. The worked example shows the
digests agree for the pinned fixture and the counterexample shows they diverge on one non-ASCII
byte.

D3. grant_ref and receipt_id are content references, recomputable from bytes, and keep that
meaning. They are not transaction or attempt identifiers. NENRIN's lifecycle rule in v0 is: one
grant, one execution. Over the set of receipts presented for one grant_ref, exactly one distinct
receipt_id reconciles; two or more distinct receipt_ids for the same grant_ref are refused as
equivocation, fail-closed, never resolved to the favorable one (E2). A retry that produces
byte-different receipt bytes is therefore not a retry under the same grant; re-authorization means
a new grant with a new nonce and a new grant_ref. The nonce is single-use at a stateful gateway;
the pure verifier checks presence and window only. NENRIN has no field that plays VATE's
execution.transaction_id or request.request_id, and no predecessor or successor relation between
grants; VATE's known-gaps document leaves re-admission lineage implementation-defined at this pin
as well.

## 5. Profile-specific rules (each side's checks with no counterpart on the other)

NENRIN (numbered in every provenance report under rules, with establishes and does_not_establish):

| rule | check | VATE counterpart |
| --- | --- | --- |
| R1 | the witness is neither party of the hop it observes | none |
| R2 | evidence_id recomputes from the observation bytes | closest analogue is admission.digest recompute, but over a different record |
| R3 | hop chain contiguous from seq 0, every prev_evidence_id resolves to a presented prior observation | none |
| R4 | verdicts aggregated over the full witness set; disagreement surfaced, never collapsed | none |
| E1 | canonical bytes of grant.action equal canonical bytes of receipt.executed_action | the effective request relation (input_hash or attenuation.effective_request_hash equals execution.effective_request_hash) is the nearest analogue, but VATE compares two declared hashes and NENRIN compares two signed objects |
| E2 | one distinct receipt_id per grant_ref; more is equivocation | none (VATE has no multi-receipt reconciliation) |
| E3 | receipt hash-references the grant and comes from the executor the grant authorized | Receipt identity and Receipt content rows in the VATE linkage table bind post-execution to admission, not to a caller grant |
| window | executed_at strict RFC3339 UTC inside [not_before, not_after] | Admission window row (issued_at, expires_at versus started_at, finished_at) |
| AB | an action_binding, when present, is recomputed and refused on mismatch, unknown profile or malformation | VATE treats action_binding as optional and complementary; refusal behavior is profile-defined |
| strict JSON | duplicate keys, non-integers, unsafe numbers, non-printable-ASCII keys refused before hashing | not defined in the fixture basis |
| preflight | provider signs proposed_action before execution; declared equals authorized equals executed | admission is the verifier's pre-execution artifact, not the executor's declaration |
| composition | an observation may name a receipt by digest; the witness verdict never inherits the outcome and the outcome never inherits the verdict | none |
| no decision | reports carry a status and surfaced conflicts, never allow, deny or a score | VATE's decision.outcome is exactly the field NENRIN does not have |

VATE (profile v0.3 and receipt model), with no NENRIN counterpart: the verifier ordering status,
identity, runtime, permit, policy; decision.outcome with reason_codes and reason_visibility;
attenuation (original_request_hash, effective_request_hash, changes, effective_constraints,
require_new_permit); the effective constraints checks (the runner derives the aggregate max_amount
from result.side_effects[].amount); status freshness with fail-closed defaults; replay state; trust
anchors and JOSE algorithm allowlists; policy_snapshot references; the A2A metadata phases
admission_requested, admission_issued, post_execution_receipt_issued.

## 6. Unmapped fields

NENRIN fields with no VATE counterpart: nonce; prev_evidence_id and hop{seq, from, to}; witness_id,
witness_sig, edge_sig; conduct.verdict; findings such as self_authorized, open_grant,
evidence_bound_unchecked, witness_disagreement; the report's rules and signers lists.

VATE fields with no NENRIN counterpart: version, profile, receipt_type; verifier{id, key_id};
request.request_id, request.transaction_id, request.constraints; subject.principal as a linked
principal; evidence[] with verification results; policy{policy_id, policy_version, policy_ref,
policy_snapshot}; decision{outcome, reason_codes, reason_visibility, reason_withheld}; attenuation;
issuer.role; result.side_effects, result.policy_violations, result.error; proof.

## 7. Carriage sketch (non-normative)

One execution can be described by both profiles without either absorbing the other:

1. The NENRIN receipt carries action_binding as in section 3. Its grant_ref, receipt_id and
   provider_sig are unchanged by that (rule AB, vectors AB1 and the sign_exec adversarial pair).
2. A VATE post-execution receipt for the same execution carries the identical action_binding
   object in execution.action_binding. Its execution.effective_request_hash stays whatever the
   VATE profile computes over its own request basis. Whether the hex of that hash equals
   action_binding.digest.value is a per-case fact established under section 2, never assumed.
3. The NENRIN witness observation references the receipt as nenrin-exec://<receipt_id>; A2A
   metadata under the VATE binding references the VATE receipt as {uri, digest}. Both are
   digest-bound references; each stays in its own carrier.
4. A reader holding both artifacts has two references to two different authorities: the caller's
   grant (grant_ref) and the verifier's admission (admission.digest). D1 applies.

## 8. Reproduce

    git clone https://github.com/ogasurfproject-jpg/horizon-shield && cd horizon-shield && git checkout da98d4bf
    cd workers/hs-ledger/nenrin/interop-v0 && node run_interop.mjs

    python3 - <<'PY'
    import json, hashlib
    a = json.load(open("fixtures/pass.json"))["grant"]["action"]
    m = json.dumps(a, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    v = json.dumps(a, allow_nan=False, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    print(m == v, hashlib.sha256(m).hexdigest(), hashlib.sha256(v).hexdigest())
    PY

The VATE side of the comparison is the byte basis quoted from docs/conformance/digest-basis.md at
bf9b6fa3; this note does not run the VATE reference runner and makes no claim about it.
