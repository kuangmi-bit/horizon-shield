# A2A Agent Card signing: interop matrix

Every official A2A SDK signs, every official A2A SDK verifies, on the same cards. Run on 2026-10-01 with
a2a-sdk 1.2.1, @a2a-js/sdk 1.3.0 and a2a-go main 534a60fc (2026-09-30) (a2acrypto copied verbatim apart from one import path; upstream
sha256 in `go/UPSTREAM_SHA256.txt`, licence in `go/UPSTREAM_LICENSE`).

## Result

| case | python signs, python verifies | python signs, js verifies | python signs, go verifies | js signs, python verifies | js signs, js verifies | js signs, go verifies | go signs, python verifies | go signs, js verifies | go signs, go verifies |
|---|---|---|---|---|---|---|---|---|---|
| `control` (no field at its default value) | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| `empty_description` (description = "" (REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_skills` (skills = [] (REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_skill_tags` (skills[0].tags = [] (REQUIRED on AgentSkill)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `empty_extensions` (capabilities.extensions = [] (not REQUIRED)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |
| `nested_empty_security` (securityRequirements = [{}] (not REQUIRED, nested empty)) | pass | pass | FAIL | pass | pass | FAIL | FAIL | FAIL | pass |

The served card is the case JSON exactly as written, with the signer's signature appended. Each verifier reads that JSON the way its SDK reads a card.

**Python and JS agree with each other on every case. Go agrees with neither as soon as the card holds any empty value**, REQUIRED or not.

## The specification's own example (A2A section 8.4.1)

Input: `{"name":"Example Agent","description":"","capabilities":{"streaming":false,"pushNotifications":false,"extensions":[]},"skills":[]}`

| | canonical form | matches the specification |
|---|---|---|
| specification | `{"capabilities":{"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}` | |
| a2a-python | `{"capabilities":{"pushNotifications":false,"streaming":false},"name":"Example Agent"}` | no |
| @a2a-js/sdk | `{"capabilities":{"pushNotifications":false,"streaming":false},"name":"Example Agent"}` | no |
| a2a-go | `{"capabilities":{"extensions":[],"pushNotifications":false,"streaming":false},"description":"","name":"Example Agent","skills":[]}` | no |

None of the three reproduces the worked example. Python and JS drop the REQUIRED `description` and `skills`; Go keeps the non-REQUIRED `capabilities.extensions`.

## Frozen production card

`../interop-go/fixtures/gate_card_20260928.json` (sha256 `2df33ff120745a7f...`, JS-signed with two signatures, key set sha256 `692fd49da681cc0d...`) verifies in all three: python pass, js pass, go pass (Go accepts signature 0, the plain RFC 8785 one). It has no empty value, which is why it does not show the split above.

## The key

`testkey_jwks.json` (kid `hs-interop-test-v1`) is a test key derived from a public phrase in `matrix.py`, so anyone can re-create the private key and re-run every row. It signs test vectors only and is nobody's production key.

## Run

    pip install -r requirements.txt
    npm install
    (cd go && go build -o interop-go .)
    A2A_GO_COMMIT="a2a-go <commit>" python3 matrix.py

`out/` receives each case, each signed card and `results.json`. This directory's `results_20261001.json` is the run above.

## What this does not establish

- Which canonical form is right beyond the specification text; the question of how REQUIRED fields at their default value are represented is open in a2aproject/A2A#2122.
- Anything about cards served by other implementations.
- That a passing row means the card is trustworthy; it means one SDK accepted another SDK's signature over the same JSON.
