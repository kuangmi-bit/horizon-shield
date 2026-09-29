---
name: verify-mcp-conduct
description: Check how an MCP server behaved when it was measured, before connecting to it, using the HORIZON SHIELD conduct register and the JIDEC ledger. Use when the user asks whether an MCP server or endpoint is trustworthy, wants it verified, asks what a conduct verdict means, or wants to recompute a published record themselves. Uses the hs-verify-gate and jidec-ledger MCP tools.
---

# MCP conduct register

You have the `hs-verify-gate` and `jidec-ledger` MCP servers.

1. Read `get_conditions` first. It states the five conditions measured and, just as important, what a verdict does not claim.
2. One read before connecting: `lookup_server` with the endpoint URL (status verified, pending, declined or unknown, the latest record sha, and where the record is). `is_verified` gives the short form.
3. A fresh measurement: `check_conformance` with the endpoint. This contacts that server (initialize, tools/list, its agent card); it runs a tool on it only when the owner published consent at /.well-known/mcp-conduct.json. Tell the user before you run it.
4. To check a verdict without trusting the gate: `verify_verdict`, and on the ledger side `jidec_cite` and `jidec_how_to_verify`, which show how to recompute the hash from the published bytes.

Rules:
- verified means the measured conditions passed at that instant. It does not mean the server's answers are correct, that its compensation declaration is true, or anything about quality. Say so every time.
- unknown means there is no row. It is never a finding about the endpoint.
- Report pending and failed rows as they are.
- Always give the user the way to recompute the record themselves.
