# nenrin-response-v0: the measured party's reply, beside the measurement

RECORD_PRIVACY_v1.md says adverse facts are published with the subject's response when there is one. This is how a
subject gives one.

The operator of a measured endpoint writes a short statement (up to 2000 characters) naming the measurements it
answers, signs it with an Ed25519 key served on its own domain, and posts it to the ledger. The ledger checks three
things and nothing else: the signature, that the key is served on the subject's host (or a host under or above it),
and that every named measurement actually measured that host. Then it shows the statement wherever those
measurements are shown: `GET /witness/<sha>` (`responses`), `/resume` (`subject_responses`, outside the résumé bytes),
`/trust-signal` (count and link), and `GET /response?about=<sha>` for gate verdicts.

It never changes a verdict, a count or a hash, and the ledger does not edit, judge or rank it. It is not anchored to
Bitcoin in v0: `responded_at` is the subject's own clock; the signature and the key on its domain attribute the text.

    node response_sign.mjs --key my_ed25519.pem --subject https://api.example.com \
      --key-url https://api.example.com/keys/agreement.json \
      --about witness:<sha256> --text "What happened, in your words." > body.json
    curl -sS -X POST https://ledger.horizonshield.dev/response -H 'content-type: application/json' --data-binary @body.json

Limits: 1 to 16 measurements per reply, 8192 bytes, 10 replies per subject per day, 200 per day in all.
Tests: `node response_v0.test.mjs` (41 checks, including the reference signer) and `node ../../test/response.test.mjs`
(the wiring in the real worker). 12 mutants of the gates, 12 caught.
