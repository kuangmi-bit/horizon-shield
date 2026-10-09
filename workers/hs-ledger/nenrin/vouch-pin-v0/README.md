# vouch-pin-v0: a Bitcoin time bound for Vouch Protocol credentials

[Vouch Protocol](https://pypi.org/project/vouch-protocol/) signs who an agent is and under whose authority it acts, as
W3C Verifiable Credentials with `eddsa-jcs-2022` proofs. A credential's time (`validFrom`, `proof.created`) is the
issuer's own clock. Vouch's accountability module says so itself and leaves a slot for an outside clock:
`timestamp_anchor(method, reference, recomputeCmd, establishes)` on an `OutcomeCommitmentCredential`, with the rule that
a consumer concludes commit-before-outcome only when it confirms the stamped time precedes the settlement time.

This intake fills that slot. The NENRIN ledger checks the credential's proof, keeps the exact signed bytes under the
sha256 of their RFC 8785 form, lists the sha in a daily batch, and stamps the batch to Bitcoin with OpenTimestamps.
`vouch_check.py` then recomputes all of it without trusting the ledger or the issuer.

## Commit before the outcome, with an anchor nobody can move

```python
from vouch import Signer, accountability

cid = "urn:uuid:7f1c2a90-4b1e-4f7a-9d55-0a1b2c3d4e5f"          # choose the id first: it is the anchor's reference
anchor = accountability.timestamp_anchor(
    "nenrin-opentimestamps",
    "https://ledger.horizonshield.dev/evidence/vouch/id/" + urllib.parse.quote(cid, safe=""),
    "curl -sO https://raw.githubusercontent.com/ogasurfproject-jpg/horizon-shield/main/workers/hs-ledger/nenrin/vouch-pin-v0/vouch_check.py"
    " && python3 vouch_check.py --ledger https://ledger.horizonshield.dev --credential <this credential as JSON> --outcome-time <the settlement time>",
    "pre-outcome-ordering")
cred, secret = accountability.commit_outcome(signer, claim=claim, settlement=settlement, anchor=anchor, credential_id=cid)
```

Then pin it (anyone can; the ledger checks the proof, not who sends it):

```sh
curl -s https://ledger.horizonshield.dev/evidence/vouch -H 'content-type: application/json' \
     -d "{\"credential\": $(cat commitment.json)}"
```

`GET /evidence/vouch` returns the same anchor entry ready to paste, and what the intake checks.

## What a reader runs

```sh
python3 vouch_check.py --credential commitment.json --outcome-time 2027-01-01T00:00:00Z --headers view.json
```

It verifies the proof here, finds the batch that lists the credential's sha, checks the batch is the ledger entry's
claim, reads the `.ots` with no library, and with a header view (headers from two explorers that agree) checks the
attested block's merkle root, linkage and work and takes the block time from the header itself. `precedes` only when
the block time plus 7,260 seconds (Bitcoin's two-hour future limit plus a minute) is before the outcome time.

## Why the reference is the credential id

Every credential pinned under one id is listed at `/evidence/vouch/id/<id>`, oldest first. An issuer who signs two
commitments under one id (one per possible outcome) and later shows the winner is visible there, and `vouch_check.py`
reports it as equivocation. A single credential cannot show this; a log that keeps every credential it is given, under a clock the issuer does not hold, can.

## What it establishes, and what it does not

Establishes: the ledger received exactly these bytes; at intake the proof verified under the issuer's own key (did:key,
or did:web with the document's sha256 recorded), the key was a prime-order Ed25519 point, `proof.created` was not in
the ledger's future; once stamped, the bytes existed before that Bitcoin block.

Does not establish: that the claim is true or the outcome happened; that the key was not stolen or revoked (no status
list is read); that a did:web document served the same key at another time; who submitted the credential.

## Tested against Vouch's own SDK

`fixtures/gen_fixtures.py` makes the fixtures with vouch-protocol 2.2.1 (`commit_outcome`, `attest_outcome`, did:key and
did:web signers, and Vouch's pre-alignment digest, which its `verify_proof` still accepts). `vouch_pin_v0.test.mjs`
(73 checks) and `vouch_check_test.py` (31 checks) hold the intake and the reader to Vouch's answers and digests, and
to refusals by name: an edited claim, a back-dated `validFrom`, an issuer that is not the signer, a small-order key,
a postdated proof, redirects and private hosts for did:web, a batch that does not list the sha, a header with another
merkle root or too little work.

Read in v0: did:key and did:web (host only), Ed25519, W3C hashData and Vouch's pre-alignment digest. Not read: ML-DSA
and hybrid proofs, proof sets and chains, JOSE and COSE, status lists, other DID methods.
