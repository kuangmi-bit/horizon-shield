---
description: Show the recorded, Bitcoin-anchored conduct history of an agent or MCP endpoint
argument-hint: <https endpoint URL>
---

Show the NENRIN conduct history of this endpoint: $ARGUMENTS

1. Call `nenrin_resume` with the endpoint (if the tool is not available, fetch https://ledger.horizonshield.dev/resume?endpoint=<the URL, URL-encoded>).
2. Report how many measurements touch it, how many are Bitcoin-anchored, who measured (the gate or outside witnesses, signed or unsigned), and the records not counted with their reasons.
3. Show how to check one record without trusting the ledger (`jidec_how_to_verify`, or /ledger/{n} and /ledger/{n}/ots).
4. Do not score or recommend. Absent means no record, not a negative finding.
