# run0001: the records behind second_contract_A.json

The second MUSUBI contract (../second_contract_A.json, sha256 fedbd9a44ec2c81a0721fbf37b660dc725ffb4707cc92b7ef40dddd285f2a2ba,
contract_sha256 14474983...) was signed by HORIZON SHIELD on 2026-09-26 after a sieve run over the offer from
api.babyblueviper.com. The contract's selection_provenance names three digests. This directory holds the bytes behind
two of them, plus the agent card bytes the contract pins, so a third party can recompute without asking anyone.

| file | sha256 of the file | what it is |
|---|---|---|
| policy_signed.json | cd2adb321c59b821235f47c3dc311f26da3686b01da2eb31fcb6b83c125c85b1 | the sealed rule (schema a2a-sieve-policy-v0, seven declared rules, default decline), signed by horizonshield.dev; record digest c92bf8868a5793e86a93c3351bed00eed7f853eff54437dbcc2e4242576b75c3, anchored as JIDEC ledger entry 56 (Bitcoin block 968542) before the offer arrived |
| sieve_signed.json | 517df11e4ee3c1e488e98d9a46e4a244877dbbdb3d488b27fa4b646c0c7f7fb5 | the decision record (schema a2a-sieve-v0): every unit of the offer classified, the rule it satisfied, the decision and its grounds, establishes and does_not_establish; record digest 08b735c666538e588d1f651b757194cfa0f826804b85090df73bbadac87cb900 |
| cards/769df245...json | 769df24571c1a0323f6c70cde07fc35854a90010789fb32f24e8c63434dcff5f | the exact bytes of the HORIZON SHIELD gate agent card the contract pins in parties[0].agent_card_sha256 (gate 0.4.14) |
| verify_run0001.py | | the offline recompute, stdlib only |

The offer itself (42bfa20d8e498740d16c15e1facaac7c6f0b1a7b1cb1f0c7d157ee4785ea1f57) is api.babyblueviper.com's signed document
and is theirs to publish; the sieve record carries every value the rules read from it.

## Record digest recipe

    record_sha256 = sha256( schema + "\n" + canonical(record without "signatures") )

schema is the record's own schema string ("a2a-sieve-policy-v0", "a2a-sieve-v0"); canonical is musubi-canonical-v0
(../canonical_vectors.json: keys sorted at every level, no whitespace, UTF-8, integers only). The Ed25519 signatures
are over the same bytes. The contract family uses the same shape with the context "a2a-contract-v0\n" (../contract_v0.py).

## Run

    python3 verify_run0001.py --key "$(curl -s https://gate.horizonshield.dev/keys/agreement.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["public_key_ed25519_b64"])')"

Without --key the digests, the card pin and the rule application are still checked; only the two signatures are skipped.

## What a reader can and cannot recompute here

Can: both record digests; that the sieve cites the policy and the contract cites both; that the pinned card bytes hash
to the pin; that the seven rules, applied to the classified inputs the sieve records, give the recorded decision; the
two signatures against the key the domain serves; and, with the ledger, that c92bf886... was anchored at block 968542,
which is below the offer's beacon (968650), so the rule predates the offer.

Cannot: the classifier that turned the offer into those inputs (a2a-sieve-v0 is not published) and the hidden
instruction detector whose sha the sieve pins. The sieve record says the same in its does_not_establish. A reader who
distrusts the classification can read the offer and the inputs side by side; the values are plain.

## The pinned card bytes, and why they are here

A contract pins each party's agent card by sha256 at signing time. The live card moves on (the gate was 0.4.14 at
signing and is 0.4.15 now), so a later verifier cannot fetch the pinned bytes from the live URL. Finding by Federico
Blanco Sanchez-Llanos, 2026-09-27. The rule adopted from this run on: a party retains the exact card bytes it pinned
and serves or commits them content-addressed. cards/769df245...json was rebuilt from public source, not from a saved
copy: the gate builds its card in code, so the bytes served at commit 5d9c036b are reproducible by anyone:

    git clone --filter=blob:none --no-checkout https://github.com/ogasurfproject-jpg/horizon-shield && cd horizon-shield
    git checkout 5d9c036b && cd workers/hs-verify-gate/src
    printf '\nexport { ownAgentCard, withCardSignature, json };\n' >> worker.js
    node --input-type=module -e 'const m=await import("./worker.js");const o="https://gate.horizonshield.dev";const r=m.json(m.withCardSignature(m.ownAgentCard(o),o));process.stdout.write(await r.text())' > card.json
    sha256sum card.json   # 769df24571c1a0323f6c70cde07fc35854a90010789fb32f24e8c63434dcff5f

The counterparty's pinned card (parties[1].agent_card_sha256 5306018339599f3a8c7f6c932487b86f4c8d88a9766db3a1c2cec2f832816dac)
is theirs to serve; they have said they will serve it content-addressed under /record/{sha}.
