# a2a-conduct

The [A2A Conduct Extension](https://gate.horizonshield.dev/ext/conduct/v1) (conduct-v1.4) in a few calls, for any
JavaScript agent and any client. No dependencies. Node 18+, Deno, Bun, Cloudflare Workers.

Before one agent hands work to another, it can read three things: who pays the other agent, where a record of that
agent's measured conduct lives that the agent itself did not write, and where to file its own observation. This
package lets an agent publish those three things and lets a client read them.

```
npm install a2a-conduct
```

## Agent, with the official @a2a-js/sdk

```js
import { extension, activateOn, attachToMessage } from "a2a-conduct";

const conduct = extension(
  { paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 0 },
  ["https://agent.example/a2a"],                       // the endpoints you ask to be measured on
);
agentCard.capabilities.extensions.push(conduct);

// in your AgentExecutor.execute(requestContext, eventBus)
if (activateOn(requestContext)) attachToMessage(message, conduct, "https://agent.example/a2a");
eventBus.publish({ kind: "message", data: message });
```

`activateOn` activates the extension on the SDK's call context when the caller asked for it, so the SDK writes the
`A2A-Extensions` echo itself (`X-A2A-Extensions` on the 0.3 wire). `attachToMessage` adds the four conduct metadata
keys and lists the URI. The last argument is the public URL this handler is served at. It becomes `served_by`
(section 14): where the request arrived, never a constant. Works on a Message or a Task.

The SDK keeps only requested extension URIs that your card declares. A caller that activates by the permanent
identifier `https://w3id.org/horizonshield/conduct/v1` is therefore not echoed by an SDK agent whose card declares
the canonical URI. Callers should send the canonical URI; the reference walk client does.

## Agent, any server

```js
import { extension, echoHeaders, activated, attach } from "a2a-conduct";

Object.assign(responseHeaders, echoHeaders(request.headers));               // on every A2A response
if (activated(request.headers).uri) attach(result, conduct, request.url);   // result = the JSON-RPC result
```

`attach` takes a 1.0 `{message}` / `{task}` wrapper or a 0.3 Message / Task object.

## Client: before delegating work

```js
import { preflight } from "a2a-conduct";
const report = await preflight("https://agent.example");
```

```
npx a2a-conduct https://agent.example
```

Reads the agent's card, who it says pays it (as declared, not verified), and the gate register's reading for each
endpoint it asks to be measured on. `verified` is `true` only when the latest scheduled measurement passed, and
`null` in every other case, never `false`. An agent that does not declare the extension is reported as such, which
is not a negative verdict. The same check is one MCP tool call on the gate: `preflight_agent` at
`https://gate.horizonshield.dev/mcp`.

`card_status: 0` means no HTTP answer at all, which is a fact about the path and not about the agent. Behind an
HTTP proxy, Node's built-in fetch ignores `HTTPS_PROXY` by default: run with `NODE_USE_ENV_PROXY=1` (Node 22.21+ or
24.5+) or pass your own `fetch` in the options.

## What this does not do

It declares, echoes, attaches and reads. It does not measure an agent, does not score one, and says nothing about
whether an agent is trustworthy, competent, or telling the truth about who pays it. `extension()` refuses a
malformed compensation declaration instead of publishing one.

## How it is checked

- `test/parity.test.mjs`: every call gives the same bytes as `a2a_conduct.py` in the Python package
  [a2a-conduct-walk](https://pypi.org/project/a2a-conduct-walk/) for the same input (43 vectors, refusals included).
- `test/sdk_walk.test.mjs`: an agent built with the official `@a2a-js/sdk` 1.2.1 plus the two calls above is walked
  over HTTP by the unchanged reference client, on A2A 1.0 and 0.3, message and task, at a measured endpoint and at an
  A2A URL that is not measured: 8 walks, 7 of 7 each. The same agent without `activateOn` fails the echo assertion.

```
npm install && npm test
```

## Walk an agent yourself

```
pip install a2a-conduct-walk
a2a-conduct-walk --origin https://agent.example --mode a2a --submit
```

## License

Apache-2.0. The HORIZ音s株式会社.
