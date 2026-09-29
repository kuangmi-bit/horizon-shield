# HORIZON SHIELD (Claude plugin)

Check Japanese construction and renovation estimates against the open JCCDB dataset (v5.0: 425,765 records, 95,403 line items and 330,362 source-cited observations, CC BY 4.0), get fair-price receipts anyone can recompute, and find contractors that passed the same independent check.

Listed in the Claude directory (Claude Code, Cowork, Claude apps).

## What is inside

Two remote MCP servers, no API key:

| server | what it answers |
|---|---|
| `horizon-shield` (https://mcp.horizonshield.dev) | Japanese fair-price checks (JCCDB), red flags in estimates, recomputable receipts, U.S. public construction-cost data (USCCDB). 30 tools |
| `yakumo-contractors` (https://hearing.horizonshield.dev/mcp) | contractors in Japan that passed the fair-price check, and checks on a contractor the user names |

Two skills that tell Claude when to use them: `horizon-shield` (estimates) and `find-contractor`.

Three commands:

- `/audit <work name> <quoted price in JPY>`: verdict, fair range and gap from the average.
- `/red-flags <estimate or sales wording>`: known overcharge and high-pressure tactics.
- `/verify <work name>`: a fair-price receipt with a SHA-256 hash, recomputable at its verify URL.

## Install

In the Claude directory, search for HORIZON SHIELD. From Claude Code:

```
/plugin marketplace add ogasurfproject-jpg/horizon-shield
/plugin install horizon-shield@the-horizons
/reload-plugins
```

## What it reads and writes

- Two tools write: `verify_fair_price` and `create_ap2_fairness_attestation` append a record to the public ledger. The skill tells Claude to say so before calling them. Everything else reads.
- Nothing moves money or cryptocurrency. Bitcoin is used only as an OpenTimestamps time anchor. Inputs are a work name, a price, an area or a search term; no account and no personal data are needed.

## What it does not claim

- A fair-price verdict is a reference range from public data for the homeowner to act on. It does not declare a contractor dishonest. Japan only, in JPY.
- A contractor listing means that store passed the fair-price check. It is not a recommendation, and no referral or listing fee is taken.

## Related

The MCP Conduct Register plugin (https://github.com/ogasurfproject-jpg/mcp-conduct-register-plugin) shows how MCP servers and AI agents behaved when they were measured.

## Source and data

- Code and data: https://github.com/ogasurfproject-jpg/horizon-shield
- JCCDB v5.0: https://doi.org/10.5281/zenodo.22980284
- Live service: https://shield.the-horizons-innovation.com
- Privacy policy: https://shield.the-horizons-innovation.com/privacy

## Author

Toshikatsu Oga, The HORIZONs Co., Ltd., Japan. ORCID 0009-0000-9180-903X.

## License

MIT (plugin). JCCDB data is CC BY 4.0.
