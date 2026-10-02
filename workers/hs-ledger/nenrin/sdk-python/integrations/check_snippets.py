"""Builds every object FRAMEWORKS.md shows, for each framework that is installed, without a model, a key or a network
call, so the snippets cannot drift from the framework APIs unnoticed. Frameworks that are not installed are reported
as skipped, not passed.

    pip install langchain-mcp-adapters langgraph openai-agents google-adk claude-agent-sdk crewai "crewai-tools[mcp]"
    python integrations/check_snippets.py
"""
import importlib.metadata as md
import sys

GATE = "https://gate.horizonshield.dev/mcp"
results = []


def check(name, dist, fn):
    try:
        ver = md.version(dist)
    except md.PackageNotFoundError:
        results.append((name, "skipped (not installed)"))
        return
    try:
        fn()
        results.append((name, "ok with %s %s" % (dist, ver)))
    except Exception as e:
        results.append((name, "FAIL with %s %s: %r" % (dist, ver, e)))


def langgraph():
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from langgraph.prebuilt import create_react_agent  # noqa: F401
    MultiServerMCPClient({"hs-verify-gate": {"url": GATE, "transport": "streamable_http"}})


def openai_agents():
    from agents import Agent
    from agents.mcp import MCPServerStreamableHttp
    gate = MCPServerStreamableHttp(params={"url": GATE}, name="hs-verify-gate")
    Agent(name="delegator", instructions="x", mcp_servers=[gate])


def adk():
    from google.adk.agents import LlmAgent
    from google.adk.tools.mcp_tool import McpToolset, StreamableHTTPConnectionParams
    gate = McpToolset(connection_params=StreamableHTTPConnectionParams(url=GATE),
                      tool_filter=["preflight_agent", "is_verified", "verify_verdict"])
    LlmAgent(name="delegator", model="gemini-2.5-flash", instruction="x", tools=[gate])


def claude_agent_sdk():
    from claude_agent_sdk import ClaudeAgentOptions
    ClaudeAgentOptions(mcp_servers={"hs-verify-gate": {"type": "http", "url": GATE}},
                       allowed_tools=["mcp__hs-verify-gate__preflight_agent", "mcp__hs-verify-gate__verify_verdict"])


def crewai():
    import os
    os.environ.setdefault("OPENAI_API_KEY", "not-used-no-call-is-made")
    from crewai import Agent
    assert "mcps" in Agent.model_fields
    Agent(role="delegator", goal="x", backstory="x", mcps=[GATE + "#preflight_agent"], llm="gpt-4o-mini")


check("LangGraph (langchain-mcp-adapters)", "langchain-mcp-adapters", langgraph)
check("OpenAI Agents SDK", "openai-agents", openai_agents)
check("Google ADK", "google-adk", adk)
check("Claude Agent SDK", "claude-agent-sdk", claude_agent_sdk)
check("CrewAI", "crewai", crewai)
for n, r in results:
    print("%-36s %s" % (n, r))
sys.exit(1 if any(r.startswith("FAIL") for _, r in results) else 0)
