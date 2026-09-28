// sdk_walk: an agent built with the official @a2a-js/sdk, plus two lines of a2a-conduct, walked over HTTP by the
// unchanged reference client (a2a_conduct_walk.py, pip install a2a-conduct-walk).
//
// The agent uses the SDK's own DefaultRequestHandler, jsonRpcHandler (with legacyCompat, so one URL speaks A2A 1.0
// and 0.3) and agentCardHandler. The only conduct code in the executor is activateOn(requestContext) and
// attachToMessage(...). The SDK itself writes the A2A-Extensions / X-A2A-Extensions echo. The reference client walks
// it on both wires, message and task, at a measured endpoint and at an A2A URL that is not measured: 8 walks, every
// applicable assertion must hold (7 of 7, metadata_echoed and endpoint_bound true). Then the negative control: the
// same agent without activateOn must fail extension_echoed, so the walk is not green by construction.
// Needs: npm install (devDependencies), python3, ../a2a-conduct-walk. No network beyond 127.0.0.1.
import express from "express";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Role, TaskState } from "@a2a-js/sdk";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { jsonRpcHandler, agentCardHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { extension, activateOn, attachToMessage } from "../a2a_conduct.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PYDIR = path.resolve(HERE, "../../a2a-conduct-walk");
const ORIGIN = "https://agent.sdkwalk.invalid";
const EXT = extension({ paid_by: "buyer", referral_fee: false, listing_fee: false, success_fee_pct: 0 }, [ORIGIN + "/mcp"]);
const MODE = { task: false, conduct: true };

const card = {
  name: "SDK agent with a2a-conduct", description: "official @a2a-js/sdk server, conduct-v1.4 by two helper calls",
  supportedInterfaces: [
    { url: ORIGIN + "/a2a", protocolBinding: "JSONRPC", tenant: "", protocolVersion: "1.0" },
    { url: ORIGIN + "/a2a", protocolBinding: "JSONRPC", tenant: "", protocolVersion: "0.3" },
  ],
  provider: undefined, version: "1",
  capabilities: { streaming: false, pushNotifications: false, extensions: [EXT] },
  securitySchemes: {}, securityRequirements: [], defaultInputModes: ["text/plain"], defaultOutputModes: ["application/json"],
  skills: [], signatures: [],
};

function executorAt(served) {
  return {
    async execute(rc, bus) {
      const on = MODE.conduct ? activateOn(rc) : null;                    // conduct line 1
      const msg = { messageId: "reply-" + rc.request.message.messageId, contextId: rc.contextId, taskId: "", role: Role.ROLE_AGENT,
        parts: [{ content: { $case: "text", value: "ok" }, metadata: undefined }], metadata: undefined, extensions: [], referenceTaskIds: [] };
      if (MODE.task) {
        const task = { id: rc.taskId, contextId: rc.contextId, status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined }, artifacts: [], history: [], metadata: undefined };
        if (on) attachToMessage(task, EXT, served);                          // conduct line 2 (task)
        bus.publish({ kind: "task", data: task });
      } else {
        if (on) attachToMessage(msg, EXT, served);                           // conduct line 2 (message)
        bus.publish({ kind: "message", data: msg });
      }
      bus.finished();
    },
    async cancelTask() {},
  };
}

const app = express();
app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: new DefaultRequestHandler(card, new InMemoryTaskStore(), executorAt(ORIGIN + "/a2a")), legacyCompat: { enabled: true } }));
for (const p of ["/mcp", "/a2a"]) {
  const rh = new DefaultRequestHandler(card, new InMemoryTaskStore(), executorAt(ORIGIN + p));
  app.use(p, jsonRpcHandler({ requestHandler: rh, userBuilder: UserBuilder.noAuthentication, legacyCompat: { enabled: true } }));
}
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const BASE = "http://127.0.0.1:" + server.address().port;

// The walk runs in python3 as a child; the agent is served by this process, so run the child asynchronously.
import { spawn } from "node:child_process";
function walkAll(combos) {
  const driver = `
import json, sys, urllib.request, urllib.error
sys.path.insert(0, ${JSON.stringify(PYDIR)})
import a2a_conduct_walk as W
ORIGIN, BASE = ${JSON.stringify(ORIGIN)}, ${JSON.stringify(BASE)}
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def fetch(method, url, headers=None, body=None):
    req = urllib.request.Request(BASE + url[len(ORIGIN):], data=body, method=method, headers=headers or {})
    try:
        with LOCAL.open(req, timeout=10) as r:
            return r.status, dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items()), e.read()
out = []
for path, wire in json.loads(sys.argv[1]):
    rec = W.walk(ORIGIN, ORIGIN + path, "a2a", "sdk-walk", "localhost", fetch=fetch, walked_at="2026-09-28T00:00:00Z", wire=wire)
    out.append({"path": path, "wire": wire, "verdict": rec["verdict"], "res": {a["claim"].split(":")[0]: a["result"] for a in rec["assertions"]}})
print(json.dumps(out))
`;
  return new Promise((resolve, reject) => {
    const c = spawn("python3", ["-c", driver, JSON.stringify(combos)], { env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    c.on("close", (code) => code === 0 ? resolve(JSON.parse(so)) : reject(new Error("walk failed:\n" + se)));
  });
}

let fails = 0;
const chk = (name, ok, extra) => { console.log((ok ? "  green  " : "  RED    ") + name + (ok ? "" : "  << " + extra)); if (!ok) fails++; };
const combos = [["/mcp", "1.0"], ["/mcp", "0.3"], ["/a2a", "1.0"], ["/a2a", "0.3"]];
try {
  for (const task of [false, true]) {
    MODE.task = task; MODE.conduct = true;
    for (const w of await walkAll(combos)) {
      const v = w.verdict, r = w.res;
      chk(`official SDK agent, ${task ? "task" : "message"} at ${w.path}, wire ${w.wire}: ${v.n_pass}/${v.n_total}, metadata_echoed and endpoint_bound true`,
        v.ok && v.n_total === 7 && r.metadata_echoed === true && r.endpoint_bound === true && r.extension_echoed === true, JSON.stringify(r));
    }
  }
  // negative control: same SDK agent, conduct lines off. The walk must see no echo and no metadata.
  MODE.task = false; MODE.conduct = false;
  for (const w of await walkAll([["/a2a", "1.0"], ["/a2a", "0.3"]])) {
    chk(`control: without activateOn the SDK does not echo (${w.wire}), the walk says so`, w.res.extension_echoed === false && w.verdict.ok === false, JSON.stringify(w.res));
  }
  // recorded behaviour, not a failure: the SDK keeps only requested URIs that the card declares, so a caller that
  // activates by the w3id permanent identifier gets no echo from an SDK agent whose card declares the canonical URI.
  // The gate's own server echoes both spellings; with the SDK, the canonical URI is the one that works. README says so.
  MODE.conduct = true;
  const probe = async (uri) => {
    const r = await fetch(BASE + "/a2a", { method: "POST", headers: { "content-type": "application/json", "a2a-version": "1.0", "a2a-extensions": uri },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "SendMessage", params: { message: { messageId: "p9", role: "ROLE_USER", parts: [{ text: "hi" }] } } }) });
    return r.headers.get("a2a-extensions");
  };
  chk("SDK echoes the canonical URI it declares", (await probe(EXT.uri)) === EXT.uri);
  const w3 = await probe("https://w3id.org/horizonshield/conduct/v1");
  chk("recorded: SDK drops the w3id spelling when the card declares the canonical URI (no echo), as README states", w3 === null, String(w3));
} finally {
  server.close();
}
console.log("\n=== " + (fails ? "FAIL " + fails : "all green") + " (official @a2a-js/sdk 1.2.1 agent + a2a-conduct, walked by the reference client) ===");
process.exit(fails ? 1 : 0);
