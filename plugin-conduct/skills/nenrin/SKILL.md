---
name: nenrin
description: Read an AI agent's or MCP server's recorded conduct history (NENRIN résumé) and verify NENRIN evidence yourself, offline, with no trust in the operator. Use when the user asks what an agent or endpoint has actually done over time, wants its behavior history, wants to verify a NENRIN provenance bundle, a delegation or execution receipt, or a TSUGI recovery chain, asks how to recompute a ledger record, or wants to become a conduct witness. Uses the jidec-ledger MCP tools (nenrin_resume, nenrin_witness, jidec_cite) and the nenrin-verify npm package.
---

# NENRIN: conduct history you can recompute

NENRIN records how agents and MCP endpoints behaved when they were measured, by the gate and by outside witnesses, and anchors each daily batch to Bitcoin through OpenTimestamps. The point is that nobody has to trust HORIZON SHIELD: every record can be recomputed from published bytes.

Read the history of an endpoint (jidec-ledger MCP tools):
1. `nenrin_resume` with the endpoint URL: every recorded measurement that touches its origin, which are Bitcoin-anchored and which are not yet, who measured (the gate or outside witnesses, signed or not), discrepancies, and the records not counted with the reason. `nenrin_trust_signal` is the compact form.
2. `nenrin_witness` with a record SHA-256 checks one walk someone says they submitted. `nenrin_ledger_head` and `nenrin_ledger_entry` read the chain itself.
3. Every answer carries `source_url`: the public ledger URL that returned it, so the user can fetch the same bytes. If these tools are not available, fetch `https://ledger.horizonshield.dev/resume?endpoint=<URL-encoded endpoint>` directly.
4. For the gate's verdicts on the endpoint, use the `verify-mcp-conduct` skill. To cite and recompute a record, `jidec_cite` then `jidec_how_to_verify`.

Verify evidence offline:
- A provenance bundle (delegation, execution receipts, evidence pointer, one task_id): `npx -y nenrin-verify bundle.json`. Exit 0 means accepted, 1 refused; the report lists each refusal by code and carries establishes and does_not_establish.
- A TSUGI recovery chain with its random witness draw: `npx -y -p nenrin-verify tsugi-verify chain.json`.
- Where no shell is available, give the user these commands; the package has zero dependencies and needs only Node 18.
- The package is published with npm provenance, and `reproduce.sh <version>` in the repository rebuilds the tarball from the commit and compares it byte for byte.

Become a witness: the reference walker is `a2a_conduct_walk.py` (https://github.com/ogasurfproject-jpg/horizon-shield/tree/main/workers/hs-ledger/nenrin/a2a-conduct-walk). A walk signed with a key served from the witness's own domain is attributable; joining the re-verification pool takes the four conditions in `workers/hs-ledger/nenrin/recovery-v0/BECOME_A_WITNESS.md`.

Rules:
- A signature proves who asserted something and how records link. It does not prove the assertion is true, and no executed action is proven to have happened in the world. Say so.
- Not yet anchored is not false, and absent from the résumé is not a negative finding. Report both as they are.
- Report refusals and not-counted records; do not smooth them away.
- Never turn a history into a score or a recommendation. Hand over the records and how to check them.
