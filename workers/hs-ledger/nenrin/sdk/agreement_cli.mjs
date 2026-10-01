#!/usr/bin/env node
// agreement_cli.mjs : nenrin-agreement-verify, the command line of the JavaScript agreement verifier.
//
//   nenrin-agreement-verify record.json [--keys keys.json] [--recorder-domain d] [--now ISO] [--anchored-block N] [--quiet]
//
// The same command as the Python package's nenrin-agreement-verify (agreement_verify.py main), with the same flags,
// the same exit codes (0 accepted, 1 refused, 2 incomplete) and the same report, printed the way Python's
// json.dumps(report, ensure_ascii=False, indent=2) prints it. The rules are agreement_verify.mjs, the second
// implementation of a2a-agreement-v1 / v1.1, which returns the Python verifier's report byte for byte on all 5,286
// frozen cases (agreement-v0/agreement_verify_test.mjs). agreement.test.mjs checks this command's output against
// the Python command's output, file by file.
//
// One known difference: when the file is not readable JSON at all, the refusal's "why" is this reader's message,
// not the text of Python's json module. Everything else in that report is the same.
//
// Not here: --example and --example-v1 (the unsigned templates live in agreement_verify.py; use
// `pip install nenrin-verify` and `nenrin-agreement-verify --example`).
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verify, sha256Hex, pyStr, VERIFIER_VERSION, REPORT_SCHEMA } from "./agreement_verify.mjs";
import { canonicalUtf8, parseStrict } from "./agreement_canonical.mjs";

// Python's json.dumps(v, ensure_ascii=False, indent=2): insertion order, ", " never used (indent mode puts each
// item on its own line), scalars exactly as json.dumps writes them, which is what canonicalUtf8 writes for a scalar.
export function pyDumpsIndent2(v, ind = 0) {
  const pad = (n) => " ".repeat(n);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return "[\n" + v.map((x) => pad(ind + 2) + pyDumpsIndent2(x, ind + 2)).join(",\n") + "\n" + pad(ind) + "]";
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 0) return "{}";
    return "{\n" + keys.map((k) => pad(ind + 2) + canonicalUtf8(k) + ": " + pyDumpsIndent2(v[k], ind + 2)).join(",\n")
      + "\n" + pad(ind) + "}";
  }
  return canonicalUtf8(v);
}

function usage(msg) {
  process.stderr.write("usage: nenrin-agreement-verify record.json [--keys keys.json] [--recorder-domain DOMAIN] "
    + "[--now ISO8601] [--anchored-block N] [--quiet]\n");
  if (msg) process.stderr.write("nenrin-agreement-verify: error: " + msg + "\n");
  return 2;
}

function loadKeysFile(path) {
  const raw = parseStrict(readFileSync(path, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("--keys must be a JSON object mapping key_url to a public key");
  }
  const keys = {};
  const succ = {};
  for (const [url, val] of Object.entries(raw)) {
    if (typeof val === "string") keys[url] = val;
    else if (val && typeof val === "object" && typeof val.public_key_ed25519_b64 === "string") keys[url] = val.public_key_ed25519_b64;
    else throw new Error("--keys entry for " + url + " must be a b64 string or {public_key_ed25519_b64}");
    if (val && typeof val === "object" && !Array.isArray(val) && "succession" in val) succ[url] = val.succession;
  }
  return { keys, successions: Object.keys(succ).length ? succ : null };
}

export async function main(argv) {
  const a = { record: null, keys: null, recorderDomain: null, now: null, anchoredBlock: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error("argument " + x + ": expected one argument"); return argv[++i]; };
    if (x === "--keys") a.keys = val();
    else if (x === "--recorder-domain") a.recorderDomain = val();
    else if (x === "--now") a.now = val();
    else if (x === "--anchored-block") {
      const s = val();
      if (!/^[+-]?\d+$/.test(s.trim())) throw new Error("argument --anchored-block: invalid int value: '" + s + "'");
      a.anchoredBlock = parseInt(s, 10);
    } else if (x === "--quiet") a.quiet = true;
    else if (x === "--example" || x === "--example-v1") {
      process.stderr.write("the unsigned templates are in the Python package: pip install nenrin-verify && nenrin-agreement-verify " + x + "\n");
      return 2;
    } else if (x === "-h" || x === "--help") { usage(); return 0; }
    else if (x.startsWith("-")) return usage("unrecognized arguments: " + x);
    else if (a.record === null) a.record = x;
    else return usage("unrecognized arguments: " + x);
  }
  if (!a.record) return usage("a record file is required (or --example)");

  const text = readFileSync(a.record, "utf8");
  let rec;
  try {
    rec = parseStrict(text);
  } catch (e) {
    const msg = String(e && e.message || e);
    const tooDeep = (e && e.code === "too_deep") || e instanceof RangeError;
    const refusal = tooDeep
      ? { code: "too_deep", why: "the JSON is nested past what a reader can parse", in_draft: false }
      : (e && e.code === "duplicate_json_key")
        // Python's parse_strict says "duplicate key in JSON object: <key>"; the JS reader adds the character offset.
        ? { code: "duplicate_json_key", why: msg.replace(/ \(\d+ 文字目\)$/, ""), in_draft: false }
        // Not the same text as Python's: Python quotes its json module's message, which this reader does not
        // reproduce. The code, the verdict, the exit code and input_sha256 are the same.
        : { code: "bad_json", why: msg, in_draft: false };
    console.log(pyDumpsIndent2({ schema: REPORT_SCHEMA, verifier_version: VERIFIER_VERSION, verdict: "refused",
      signatures_checked: false, key_urls_checked: false, refusals: [refusal], findings: [],
      input_sha256: await sha256Hex(text) }));
    return 1;
  }
  if (rec === null) {
    // The Python command uses None as "the reader gave up" and so reports a file that says `null` as too_deep.
    // Reproduced here so both commands print the same report for the same file; a record that is null is
    // refused either way.
    console.log(pyDumpsIndent2({ schema: REPORT_SCHEMA, verifier_version: VERIFIER_VERSION, verdict: "refused",
      signatures_checked: false, key_urls_checked: false,
      refusals: [{ code: "too_deep", why: "the JSON is nested past what a reader can parse", in_draft: false }],
      findings: [], input_sha256: await sha256Hex(text) }));
    return 1;
  }
  const loaded = a.keys ? loadKeysFile(a.keys) : { keys: null, successions: null };
  const rep = await verify(rec, { keys: loaded.keys, recorderDomain: a.recorderDomain, now: a.now, inputText: text,
    successions: loaded.successions, anchoredBlock: a.anchoredBlock });
  if (a.quiet) {
    console.log(rep.verdict + "  refusals=" + rep.refusals.length + " findings=" + rep.findings.length
      + " signatures_checked=" + pyStr(rep.signatures_checked) + " key_urls_checked=" + pyStr(rep.key_urls_checked)
      + "  " + (rep.canonical_sha256 || "").slice(0, 16));
  } else {
    console.log(pyDumpsIndent2(rep));
  }
  return { accepted: 0, refused: 1, incomplete: 2 }[rep.verdict];
}

let isMain = false;
try { isMain = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { isMain = false; }
if (isMain) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write("nenrin-agreement-verify: " + String(e && e.message || e) + "\n");
    process.exitCode = 2;
  });
}
