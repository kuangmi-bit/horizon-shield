#!/usr/bin/env node
// tools/listing_tools_sync.mjs: checks that the files in this repository that list the tools of the
// HORIZON SHIELD MCP server (hs-mcp, https://mcp.horizonshield.dev/mcp) agree with the server itself.
//
// What it checks:
//   1. Complete listings (files that claim to list every hs-mcp tool) name every canonical tool.
//      JSON manifests with a "tools" array must hold exactly the canonical names, no more and no fewer,
//      and the two ledger writers must carry readOnlyHint false and openWorldHint true when annotated.
//   2. Retired tool names appear only on a line that labels them as the former name
//      ("formerly", "former name", "renamed", "alias" or 旧名). This applies to every file it reads.
//   3. Mirrored manifests are byte-identical to their source.
//
// Zero dependencies. Usage, from anywhere inside the repository:
//   node tools/listing_tools_sync.mjs             check the repository, exit 1 on drift
//   node tools/listing_tools_sync.mjs --selftest  run the checks against built-in fixtures, exit 1 on failure
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

// The single source of the tool list. Taken from the live server's tools/list on 2026-10-09
// (serverInfo horizon-shield 1.1.0, same answer at https://mcp.horizonshield.dev/mcp and
// https://hs-mcp.oga-surf-project.workers.dev/mcp), in the order the server returns them.
// When the server's tools change, change this list first, then the listing files.
const CANONICAL = [
  "get_jccdb_dataset_info",
  "list_cost_categories",
  "search_cost_category",
  "get_estimate_reading_guide",
  "get_fair_price_sources",
  "get_price_range",
  "audit_estimate",
  "preview_reverse_estimate",
  "check_red_flags",
  "verify_fair_price",
  "create_ap2_fairness_attestation",
  "get_anonymous_estimate_review_link",
  "get_agent_card",
  "verify_integrity_claim",
  "find_verified_contractor",
];

// Retired name to current name. suggest_ehn was renamed on 2026-10-08; the server still answers to it as an alias.
const RETIRED = { suggest_ehn: "get_anonymous_estimate_review_link" };
const FORMER_LABEL = /\b(formerly|former name|renamed|alias)\b|旧名/i;

// Tools that append a record to the public ledger (live annotations: readOnlyHint false, openWorldHint true).
const WRITERS = ["verify_fair_price", "create_ap2_fairness_attestation"];

// Files that claim to list every hs-mcp tool. A missing file or a missing section is reported as drift,
// so the check cannot go quiet when a listing is moved or its heading is renamed.
const COMPLETE = [
  { file: "lhm.plugin.json", kind: "json-tools" },
  { file: "CODEX.md", kind: "md-section", heading: /^## Tools exposed\s*$/ },
  { file: "README.md", kind: "md-section", heading: /^## Tools\s*$/ },
  { file: "workers/hs-mcp/README.md", kind: "md-section", heading: /^### Fair price, verification and contractors\b/ },
  { file: "llms.txt", kind: "line", marker: "[HORIZON SHIELD MCP server](https://mcp.horizonshield.dev/mcp)" },
];

// Files that mention some hs-mcp tools without claiming to list them all: checked for retired names only.
// Skipped when absent (for example in a sparse checkout).
const MENTIONS = [
  "GEMINI.md",
  "llms-full.txt",
  "gemini-extension.json",
  "server.json",
  "workers/hs-mcp/server.json",
  "glama.json",
  "system/index.html",
  "about-founder.html",
];
// Directories whose .md and .json files are checked for retired names (recursively). Skipped when absent.
const MENTION_DIRS = ["plugin"];

// [copy, source]: the copy must be byte-identical to the source.
// server-webmcp.json at the root is served on the website and named in llms.txt; the registry publishes
// workers/hs-webmcp/server.json. Both carry the registry name io.github.ogasurfproject-jpg/horizon-shield-webmcp.
const MIRRORS = [["server-webmcp.json", "workers/hs-webmcp/server.json"]];

const nameRe = (n) => new RegExp("(?<![A-Za-z0-9_])" + n + "(?![A-Za-z0-9_])");

// Retired names used as if current. Returns issue strings.
function retiredIssues(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const [old, now] of Object.entries(RETIRED)) {
    const re = nameRe(old);
    lines.forEach((l, i) => {
      if (re.test(l) && !FORMER_LABEL.test(l)) {
        out.push("line " + (i + 1) + ": retired name " + old + " used as current (now " + now + "; label it as the former name or replace it)");
      }
    });
  }
  return out;
}

function missingNames(text) {
  return CANONICAL.filter((n) => !nameRe(n).test(text));
}

// The body under a markdown heading, up to the next heading of any level.
function mdSection(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start + 1, end).join("\n");
}

function jsonToolsIssues(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return ["not valid JSON: " + e.message]; }
  if (!Array.isArray(d.tools)) return ["no tools array"];
  const out = [];
  const names = d.tools.map((t) => t && t.name);
  const seen = new Set();
  for (const n of names) { if (seen.has(n)) out.push("duplicate tool " + n); seen.add(n); }
  for (const n of CANONICAL) if (!seen.has(n)) out.push("missing tool " + n);
  for (const n of seen) if (!CANONICAL.includes(n)) out.push("tool not on the server: " + n + (RETIRED[n] ? " (retired, now " + RETIRED[n] + ")" : ""));
  for (const t of d.tools) {
    if (!t || !WRITERS.includes(t.name) || !t.annotations) continue;
    if (t.annotations.readOnlyHint !== false) out.push(t.name + ": readOnlyHint should be false (it appends to the public ledger)");
    if (t.annotations.openWorldHint !== true) out.push(t.name + ": openWorldHint should be true (it appends to the public ledger)");
  }
  return out;
}

function completeIssues(spec, text) {
  if (spec.kind === "json-tools") return jsonToolsIssues(text);
  let body;
  if (spec.kind === "md-section") {
    body = mdSection(text, spec.heading);
    if (body === null) return ["heading " + spec.heading + " not found; the listing moved, update COMPLETE in this script"];
  } else if (spec.kind === "line") {
    body = text.split(/\r?\n/).find((l) => l.includes(spec.marker));
    if (body === undefined) return ["line with " + spec.marker + " not found; the listing moved, update COMPLETE in this script"];
  } else {
    return ["unknown kind " + spec.kind];
  }
  return missingNames(body).map((n) => "missing tool " + n);
}

// JSON files at the repository root or under MENTION_DIRS that carry a tools array naming hs-mcp tools are
// treated as complete listings even when nobody added them to COMPLETE.
function looksLikeHsMcpManifest(text) {
  try {
    const d = JSON.parse(text);
    if (!Array.isArray(d.tools)) return false;
    const names = d.tools.map((t) => (t && typeof t === "object" ? t.name : t));
    return names.filter((n) => CANONICAL.includes(n) || RETIRED[n]).length >= 3;
  } catch { return false; }
}

function walk(dir, exts) {
  const out = [];
  const abs = path.join(REPO, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".claude-plugin" && e.name !== ".mcp.json") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

function read(rel) {
  const abs = path.join(REPO, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return readFileSync(abs, "utf8");
}

function check() {
  const rows = [];
  const done = new Set();
  for (const spec of COMPLETE) {
    const text = read(spec.file);
    done.add(spec.file);
    if (text === null) { rows.push({ file: spec.file, role: "complete", issues: ["file missing; the listing moved, update COMPLETE in this script"] }); continue; }
    rows.push({ file: spec.file, role: "complete", issues: [...completeIssues(spec, text), ...retiredIssues(text)] });
  }
  const discovered = [
    ...readdirSync(REPO).filter((f) => f.endsWith(".json")),
    ...MENTION_DIRS.flatMap((d) => walk(d, [".json"])),
  ];
  for (const f of discovered) {
    if (done.has(f)) continue;
    const text = read(f);
    if (text !== null && looksLikeHsMcpManifest(text)) {
      done.add(f);
      rows.push({ file: f, role: "complete (found)", issues: [...jsonToolsIssues(text), ...retiredIssues(text)] });
    }
  }
  const mentions = [...MENTIONS, ...MENTION_DIRS.flatMap((d) => walk(d, [".md", ".json"]))];
  for (const f of mentions) {
    if (done.has(f)) continue;
    done.add(f);
    const text = read(f);
    if (text === null) { rows.push({ file: f, role: "mentions", skipped: true, issues: [] }); continue; }
    rows.push({ file: f, role: "mentions", issues: retiredIssues(text) });
  }
  for (const [copy, src] of MIRRORS) {
    const a = read(copy), b = read(src);
    const issues = [];
    if (a === null) issues.push("copy missing");
    if (b === null) issues.push("source " + src + " missing");
    if (a !== null && b !== null && a !== b) issues.push("differs from " + src + "; copy " + src + " over it");
    rows.push({ file: copy, role: "mirror of " + src, issues });
  }
  return rows;
}

function report(rows) {
  for (const r of rows) {
    const tag = r.skipped ? "[SKIP] " : r.issues.length ? "[DRIFT]" : "[OK]   ";
    console.log(tag + " " + r.file.padEnd(44) + " " + r.role + (r.skipped ? " (not present here)" : ""));
    for (const i of r.issues) console.log("        " + i);
  }
  const checked = rows.filter((r) => !r.skipped);
  const bad = checked.filter((r) => r.issues.length).length;
  console.log("");
  console.log("=== listing tools sync: " + (checked.length - bad) + "/" + checked.length + " in sync, " + bad + " drift; " +
    CANONICAL.length + " canonical hs-mcp tools ===");
  return bad;
}

function selftest() {
  const all = CANONICAL.map((n) => "`" + n + "`").join(", ");
  const without = (n) => CANONICAL.filter((x) => x !== n).join(", ");
  const tool = (name, annotations) => ({ name, ...(annotations ? { annotations } : {}) });
  const writerOk = { readOnlyHint: false, openWorldHint: true };
  const manifest = (names, ann = {}) => JSON.stringify({ tools: names.map((n) => tool(n, ann[n])) }, null, 2);
  const okAnn = Object.fromEntries(WRITERS.map((w) => [w, writerOk]));
  const cases = [
    ["md section, all tools", completeIssues(COMPLETE[1], "## Tools exposed\n\n" + all + "\n\n## Links\n"), 0],
    ["md section, one missing", completeIssues(COMPLETE[1], "## Tools exposed\n\n" + without("find_verified_contractor") + "\n"), 1],
    ["md section, list after the next heading does not count", completeIssues(COMPLETE[1], "## Tools exposed\n\n## Links\n" + all), CANONICAL.length],
    ["md heading absent", completeIssues(COMPLETE[1], "# Nothing here\n" + all), 1],
    ["line marker, all tools", completeIssues(COMPLETE[4], "- " + COMPLETE[4].marker + ": " + all), 0],
    ["retired name unlabelled", retiredIssues("| `suggest_ehn` | Suggest an EHN entry |"), 1],
    ["retired name labelled", retiredIssues("`get_anonymous_estimate_review_link` (formerly `suggest_ehn`, which still answers)"), 0],
    ["retired name inside a longer word", retiredIssues("suggest_ehn_v2 and my_suggest_ehn"), 0],
    ["json, exact set", jsonToolsIssues(manifest(CANONICAL, okAnn)), 0],
    ["json, retired name in place of current", jsonToolsIssues(manifest(CANONICAL.map((n) => (n === "get_anonymous_estimate_review_link" ? "suggest_ehn" : n)), okAnn)), 2],
    ["json, extra tool", jsonToolsIssues(manifest([...CANONICAL, "made_up_tool"], okAnn)), 1],
    ["json, duplicate tool", jsonToolsIssues(manifest([...CANONICAL, "audit_estimate"], okAnn)), 1],
    ["json, writer marked read only", jsonToolsIssues(manifest(CANONICAL, { ...okAnn, verify_fair_price: { readOnlyHint: true, openWorldHint: false } })), 2],
    ["json, not valid", jsonToolsIssues("{"), 1],
    ["manifest discovery", looksLikeHsMcpManifest(manifest(CANONICAL)) ? 0 : 1, 0],
    ["manifest discovery ignores other servers", looksLikeHsMcpManifest(manifest(["a", "b", "c"])) ? 1 : 0, 0],
  ];
  let fail = 0;
  for (const [label, got, want] of cases) {
    const n = Array.isArray(got) ? got.length : got;
    const ok = n === want;
    if (!ok) fail++;
    console.log((ok ? "PASS " : "FAIL ") + label + ": " + n + " issue(s), expected " + want);
  }
  console.log("");
  console.log("selftest: " + (cases.length - fail) + "/" + cases.length + " => " + (fail ? "FAIL" : "PASS"));
  return fail;
}

if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
process.exit(report(check()) ? 1 : 0);
