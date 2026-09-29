# MCP Conduct Register (Claude plugin)

Before you connect an MCP server or trust an AI agent, see how it behaved when it was measured, and check the record yourself instead of taking anyone's word for it.

## What is inside

Two remote MCP servers, read-only, no API key:

| server | what it answers |
|---|---|
| `hs-verify-gate` (https://gate.horizonshield.dev/mcp) | the conduct register: five measured conditions (speaks MCP, publishes an agent card, declares who pays it, deterministic output, recomputable verdict), a one-read lookup before connecting, and what a verdict does not claim |
| `jidec-ledger` (https://jidec.horizonshield.dev/mcp) | the Bitcoin-anchored ledger: an endpoint's NENRIN history (`nenrin_resume`), one witness record, the chain head, and how to cite and recompute any record |

Two skills: `verify-mcp-conduct` and `nenrin`. Two commands:

- `/conduct <MCP endpoint>`: the register's verdict and how to recompute it.
- `/nenrin <endpoint>`: the recorded, Bitcoin-anchored history, by the gate and by outside witnesses.

Where a shell is available, the `nenrin` skill also runs the zero-dependency offline verifier `npx -y nenrin-verify bundle.json` (npm, published with provenance and reproducible from its commit).

## Install

From Claude Code:

```
/plugin marketplace add ogasurfproject-jpg/horizon-shield
/plugin install mcp-conduct-register@the-horizons
/reload-plugins
```

## What it reads and writes

- Every tool reads. Nothing is written by this plugin.
- `check_conformance` contacts the endpoint you name (initialize, tools/list, its agent card). It runs a tool there only if that server's owner published consent at `/.well-known/mcp-conduct.json`. The skill tells Claude to say so first.

## What it does not claim

- verified means the measured conditions passed at that instant. It does not mean the server's answers are correct, that its compensation declaration is true, or anything about quality.
- A signature proves who asserted a record and how records link, not that the assertion is true. No executed action is proven to have happened in the world.
- unknown or absent means no record, never a negative finding. There is no score and no recommendation.

## Source

- Gate and ledger code: https://github.com/ogasurfproject-jpg/horizon-shield (workers/hs-verify-gate, workers/hs-ledger, workers/hs-jidec-mcp)
- Public register: https://shield.the-horizons-innovation.com/verify-directory/
- Offline verifier: https://www.npmjs.com/package/nenrin-verify
- Privacy policy: https://shield.the-horizons-innovation.com/verify-directory/privacy/

## Author

Toshikatsu Oga, The HORIZONs Co., Ltd., Japan. ORCID 0009-0000-9180-903X.

## License

MIT
