#!/usr/bin/env node
// npx a2a-conduct https://agent.example : preflight (card, who pays it, register reading, where to file).
import { preflight } from "./a2a_conduct.mjs";
const a = process.argv[2];
if (!a || process.argv.length !== 3) { console.error("usage: npx a2a-conduct https://agent.example"); process.exit(2); }
const report = await preflight(a);
console.log(JSON.stringify(report, null, 2));
// card_status 0 means no HTTP answer at all. Node's fetch ignores HTTPS_PROXY unless told otherwise; say so rather
// than let "0" read as a fact about the agent.
if (report.card_status === 0 && (process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  console.error("note: no HTTP answer, and HTTPS_PROXY is set. Node's fetch ignores it by default. Retry with NODE_USE_ENV_PROXY=1 (Node 22.21+ or 24.5+). This says nothing about the agent.");
}
