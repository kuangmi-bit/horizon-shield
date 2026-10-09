# Files from the Agent Passport System, for the admission adapter aps-v2

Source: https://github.com/agent-passport-system/agent-passport-system (aeoess), Apache-2.0, package
`agent-passport-system` 7.2.1, commit `c31d94aad86713ae9b2e4cbc811deeab4b5d91ed`, read on 2026-10-10. `LICENSE` is
that repository's licence file, unchanged.

| file here | path there | sha256 |
|---|---|---|
| `valid-signed-passport.json` | `fuzz/corpus/verify-passport/valid-signed-passport.json` | `dfd440006a268ba8495a57f8d2c08581a89dd073bfa6054de23c186fc6b4c8fd` |

What this file is. A signed passport in the SDK's first shape (`version` "1.0.0"), written by the SDK's own
`createPassport()` (see `fuzz/scripts/generate-passport-seed.mjs` there). `adapter_aps_v2.py --selftest` verifies its
signature with a port of the SDK's `canonicalize()` and its hex Ed25519, and checks that one changed byte fails.
That is evidence that the port reads the SDK's legacy canonical form and signatures. It is one artifact, and it is not
a passport in the `aps.agent-passport` 2.0 shape.

What is not here, and why it matters. For the 2.0 shape (`src/v2/identity-binding/passport.ts`: `passport_id` and
`signature` over RFC 8785 bytes behind the domain strings `APS-PASSPORT-ID-V2\0` and `APS-PASSPORT-SIG-V2\0`) the
repository carries the implementation and a test that draws fresh keys on every run
(`tests/identity-binding-v2.test.ts`). It carries no frozen vectors: no signed 2.0 passport with the result a
verifier must give. Until such vectors exist and this adapter agrees with every one of them, the adapter returns
`"verified": null` for every 2.0 passport, whatever its own arithmetic says. Its arithmetic is reported beside that,
under `aps.local_check`, and is named as unconfirmed.

To lift it. Put the official vectors at `passport-v2-vectors.json` in this directory, in the form
`{"source": {"repository", "commit"}, "vectors": [{"id", "passport", "now", "expect": {"state", "code"}}]}`, and record
their sha256 in `adapter_aps_v2.py` (`VECTORS_SHA256`). The adapter then runs all of them on every call path that
would return true, and returns true only when it agrees with all.
