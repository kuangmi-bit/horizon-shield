# run0003: the first SEKI door, in front of a paid tool

On 2026-10-10 a SEKI door (a2a-admission-v0) was put in front of HORIZON SHIELD's own paid tool, hs-gateway `/report`,
which sells reports by the ticket. Before the gateway spends a ticket for the store `hs-seki-demo`, it asks the door, and the
door answers admit or refuse under a contract both parties signed, with a record it signs. `GET https://hs-gateway.oga-surf-project.workers.dev/seki` shows
what the door admits under.

**A demonstration, said plainly.** The principal is The HORIZONs Co., Ltd. (`the-horizons-innovation.com`), the
contractor is its own agent (`shield.the-horizons-innovation.com`), and the door is HORIZON SHIELD's too. The contract
shows the door working on a live paid path with records anyone can check. It is not an agreement with anyone outside,
it says so in its own `does_not_establish`, and `tools/adoption` counts it as ours, not as a contract with an outside
party. The door's code is private (hs-seki-private); the record, its verifier and settlement are public.

The grant (`contract.json`, contract_sha256 `e1fa47a049a94fd725efafa0a1d603e51a16158c58d2638d4c9052c1329109c8`): `report` up to 20 tickets, `audit` up to 25 tickets, `compare`
prohibited. The gateway's prices: report 20, audit 30, compare 50.

| call | tickets | the door's answer | what happened | the signed record on the ledger |
|---|---|---|---|---|
| report | 20 | admit within_grant | the report was delivered and 20 tickets were spent; the agent filed its execution record naming the admission | [9044fef2b0d9b02a...](https://ledger.horizonshield.dev/admission/9044fef2b0d9b02ad2d2994d93fd68ed763019bba13c643ac6d9c670614455c1) |
| audit | 30 | refuse amount_over_limit | 403, nothing spent: an audit costs 30 tickets and the signed limit is 25 | [4d65aa3a28ae4a9c...](https://ledger.horizonshield.dev/admission/4d65aa3a28ae4a9c1ae93840802abdb8977c8988bc957d6f75435871d7d138ba) |
| compare | 50 | refuse prohibited_action | 403, nothing spent: the signed grant prohibits compare | [381d4ec9b5cc5b24...](https://ledger.horizonshield.dev/admission/381d4ec9b5cc5b24c47277e0982f19899744e6e0b9b5d9dc10244666011f4c6e) |

The admitted call's execution record (`execution_report.json`, sha256 `e96c164b9ea149e4b2202e962c9dbf72c59b817dd7937bde7b6e7818656f0c74`) names the admission by
`admission_sha256` and states what ran; the report it received is named by sha256 as `nenrin_ref` (`748e21885f7f5915e247233ee35347a0577e9bae728ed3679c018622c34e165a`). It is
filed at https://agreement.horizonshield.dev/execution/e96c164b9ea149e4b2202e962c9dbf72c59b817dd7937bde7b6e7818656f0c74.

## Files

| file | sha256 |
|---|---|
| RUN.json | d339e9e998eea50485b6102dbeb676951851c3bf073f36810425b792f67e576b |
| admission_audit.json | 4d65aa3a28ae4a9c1ae93840802abdb8977c8988bc957d6f75435871d7d138ba |
| admission_compare.json | 381d4ec9b5cc5b24c47277e0982f19899744e6e0b9b5d9dc10244666011f4c6e |
| admission_report.json | 9044fef2b0d9b02ad2d2994d93fd68ed763019bba13c643ac6d9c670614455c1 |
| contract.json | c9a3b07ec7c378c12765bd029552ffd64e189abb2e5a9e97395970a212e2967b |
| execution_report.json | e96c164b9ea149e4b2202e962c9dbf72c59b817dd7937bde7b6e7818656f0c74 |
| request_audit.json | 1538e02f1a13efcfcb0c297759f8477d4f0ddbd2155ac5bbd8dc30b6ccd49ac0 |
| request_compare.json | 62797335dd7f34d058ccd5fee87e5be54dbdbfbbff6c0f643be06a2b66a5564e |
| request_report.json | c5fd9247a487e6dc51148a06e572c6979834ef021a18c3b3b677be70af7c9e50 |

`RUN.json` is what the agent saw, call by call. `request_<call>.json` is the action request the agent signed before the
call, `admission_<call>.json` the record the door signed.

## Check it yourself

From this directory, with Python 3 and `cryptography` (or `pip install "nenrin-verify>=0.5.3"` and `musubi-verify
admission_verify_v0 ...`). The door's key is the one its key_url serves, https://shield.the-horizons-innovation.com/keys/seki-door.json:

    K=$(curl -s https://shield.the-horizons-innovation.com/keys/seki-door.json | python3 -c "import json,sys; print(json.load(sys.stdin)['public_key_ed25519_b64'])")
    for c in report audit compare; do python3 ../admission_verify_v0.py --verify admission_$c.json --key "$K" --contract contract.json; done

Each says `accepted`: the record is the door's, for this contract. The reasons are what the shared clause evaluator
says for these calls, and anyone can ask it the same:

    python3 -c "import sys; sys.path.insert(0, '..'); import clause_eval_v0 as ce; from contract_v0 import parse_strict; \
      c = parse_strict(open('contract.json').read()); [print(a, n, ce.evaluate_action(c, a, amount=n)['clauses']) for a, n in (('report', 20), ('audit', 30), ('compare', 50))]"

`report 20 []`, `audit 30 ['over_limit']`, `compare 50 ['prohibited']`.

## Settlement

The admissions go into the ledger's daily batch (00:30 UTC) and the execution into the agreement intake's (00:45 UTC);
both are anchored to Bitcoin through OpenTimestamps. Once they are, settle v1.12 reads the execution against its
admission (was there one, did it say admit, is what ran what was admitted, was it anchored no later than the act, was the
amount inside the signed limit), and the settlement is added here.

## What this does not establish

That the parties are independent (they are not; see above). That the action was lawful, safe or wise. That anyone's key
was not stolen. The records' own `does_not_establish` lists say the rest.
