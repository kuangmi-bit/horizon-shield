# NENRIN in the agent framework you already use

Three pieces, each optional, none needing an account or a key from this project:

1. **Before you delegate**: ask the verification gate about the agent, through your framework's own MCP client
   (`https://gate.horizonshield.dev/mcp`, streamable HTTP, free, no key). Tools: `preflight_agent` (an A2A agent's
   card, its declarations and the stored readings), `is_verified` (an MCP endpoint's latest scheduled measurement),
   `verify_verdict` (recompute a verdict's hash yourself). Every answer is a reading with pointers, never a score;
   `verified` is `true` or `null`, never `false`.
2. **While you work**: record every A2A call your agent makes, signed by you (`nenrin_verify.a2a_recorder`, two
   lines with the official A2A Python SDK). Content stays on your machine.
3. **When you decide**: apply your own rule to the agent's resume (`nenrin_verify.policy.evaluate`), a decision
   anyone recomputes from the resume, the rule and the time.

These are snippets over each framework's MCP support, not native adapters. Each object below is built by
`integrations/check_snippets.py` against the version named (no model, key or network call is made by the check);
the tool calls themselves go to the gate over the network when your agent runs.

| framework | checked with |
|---|---|
| LangGraph | langchain-mcp-adapters 0.3.2, langgraph 1.2.12 |
| OpenAI Agents SDK | openai-agents 0.22.3 |
| Google ADK | google-adk 2.11.0 |
| CrewAI | crewai 1.15.23 |
| Claude Agent SDK, Claude Code | claude-agent-sdk 0.2.163 |

## 1. The gate as a tool

**LangGraph**

```python
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

gate = MultiServerMCPClient({"hs-verify-gate": {"url": "https://gate.horizonshield.dev/mcp", "transport": "streamable_http"}})
agent = create_react_agent("openai:gpt-4.1", await gate.get_tools())
```

**OpenAI Agents SDK**

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

async with MCPServerStreamableHttp(params={"url": "https://gate.horizonshield.dev/mcp"}, name="hs-verify-gate") as gate:
    agent = Agent(name="delegator", instructions="Run preflight_agent on any A2A agent before you hand it work.", mcp_servers=[gate])
    print((await Runner.run(agent, "Can I delegate to https://agent.example?")).final_output)
```

**Google ADK**

```python
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams

gate = McpToolset(connection_params=StreamableHTTPConnectionParams(url="https://gate.horizonshield.dev/mcp"),
                  tool_filter=["preflight_agent", "is_verified", "verify_verdict"])
root_agent = LlmAgent(name="delegator", model="gemini-2.5-flash", instruction="Run preflight_agent before delegating.", tools=[gate])
```

**CrewAI**

```python
from crewai import Agent

delegator = Agent(role="delegator", goal="Hand work only to agents you have checked", backstory="...",
                  mcps=["https://gate.horizonshield.dev/mcp#preflight_agent"])
```

**Claude Agent SDK**

```python
from claude_agent_sdk import ClaudeAgentOptions, query

opts = ClaudeAgentOptions(mcp_servers={"hs-verify-gate": {"type": "http", "url": "https://gate.horizonshield.dev/mcp"}},
                          allowed_tools=["mcp__hs-verify-gate__preflight_agent", "mcp__hs-verify-gate__verify_verdict"])
async for m in query(prompt="Preflight https://agent.example before I delegate to it.", options=opts):
    print(m)
```

**Claude Code**

    claude mcp add --transport http hs-verify-gate https://gate.horizonshield.dev/mcp

## 2. Record the calls (any framework whose A2A calls go through the official Python SDK)

```python
from nenrin_verify.a2a_recorder import Recorder
client = ClientFactory(config).create(card, interceptors=[Recorder(witness_name="acme-billing", key="witness.pem")])
```

Records land in `./nenrin-records/`, signed, one per agent endpoint; filing them at the public ledger is a separate,
explicit step (`nenrin-a2a-record submit <file>`). See the package README for what a record does and does not say.

## 3. Decide with your own rule

```python
from nenrin_verify import policy
d = policy.evaluate(policy.fetch_resume("https://agent.example/a2a"),
                    {"min_independent_witnesses": 2, "within_days": 30, "max_fail": 0, "exclude_domains": ["mycompany.example"]})
if not d["allow"]:
    raise RuntimeError(d["reasons"])
```

The decision carries `rule_sha256`, `resume_sha256` (recomputed, not trusted) and every record it counted or
skipped with the reason. An agent nobody has recorded is denied by such a rule because it is unknown, not because
anything bad was found; the decision says so.
