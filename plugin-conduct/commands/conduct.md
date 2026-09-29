---
description: Look up how an MCP server behaved when it was measured, before you connect to it
argument-hint: <https MCP endpoint URL>
---

Look up the measured conduct of this MCP endpoint with the HORIZON SHIELD conduct register: $ARGUMENTS

1. Call `lookup_server` with the endpoint. Report the status (verified, pending, declined or unknown), when it was measured and the record sha.
2. State what the verdict does not establish (from `get_conditions`): verified is not a claim that the server's answers are correct.
3. Show how to recompute the record without trusting the register (`verify_verdict`, or `jidec_how_to_verify`).
4. If the status is unknown, say that means no row, not a negative finding. Offer `check_conformance` and say it will contact the server.
