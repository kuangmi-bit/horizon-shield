# -*- coding: utf-8 -*-
"""公開しているデータの索引を作る。ファイル名・大きさ・sha256・何であるか。

なぜ要るか (2026-08-24):
  生データは前から公開している。だが、
  「どのファイルが何で、どれが捨てた走行で、どれが当て直しか」は
  報告書の本文を読まないと分からなかった。

  データセットとして引用されるには、
  ファイルの一覧そのものが、機械が読める形で無ければならない。
  そして1つずつに sha256 が要る。落としたものが、こちらが出したものと
  同じであることを、相手が確かめられなければ、公開したことにならない。

  捨てた走行も索引に載せる。載せないと、
  「都合の悪いファイルは索引から外した」と後から見分けがつかなくなる。

  python3 tools/survey/build_dataset_index.py --check
  python3 tools/survey/build_dataset_index.py --write
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
D = os.path.join(ROOT, "verify-directory", "survey", "data")
OUT = os.path.join(D, "index.json")
BASE = "https://shield.the-horizons-innovation.com/verify-directory/survey/data/"

# ファイルごとの説明。索引は自動で作るが、「これは何か」は人が書く。
# 書かれていないファイルが出てきたら、それは索引に unknown として載る。
# 黙って落とさない。
WHAT = {
    "survey0_v4_2026-08-19.json": {
        "what": "The registry count. How many servers were registered, how many active, "
                "how many declared an https endpoint. Nothing was contacted.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey0_v4_2026-09-01.json": {
        "what": "The registry count taken again on 2026-09-01 by the monthly workflow. Same method as 2026-08-19; "
                "the diff between the two is the movement of the population. Nothing was contacted.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey0_v4_endpoints_active_2026-09-01.txt": {
        "what": "The https endpoints the registry declared as active on 2026-09-01, one per line. "
                "Not walked; the published walk is 2026-08-23.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey0_v4_progress_2026-09-01.jsonl": {
        "what": "Page by page progress of the 2026-09-01 count, so a partial count can be told from a full one.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey0_v4_2026-10-01.json": {
        "what": "The monthly registry count of 2026-10-01. INCOMPLETE: page 23 timed out, so it covers the first "
                "2,200 latest-version entries only (complete: false, stop_reason in the file). It is not a count of "
                "the registry and no number from it was published. Nothing was contacted.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
        "do_not_use": True,
    },
    "survey0_v4_endpoints_active_2026-10-01.txt": {
        "what": "The 2,036 https endpoints declared active in the incomplete 2026-10-01 count, one per line. "
                "A partial list for the reason given on survey0_v4_2026-10-01.json. Not walked.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
        "do_not_use": True,
    },
    "survey0_v4_progress_2026-10-01.jsonl": {
        "what": "Page by page progress of the 2026-10-01 count. It ends at page 22, which is how the count is known "
                "to be partial.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey4_auth_probe_2026-10-01.jsonl": {
        "what": "The 3,076 addresses the 2026-08-23 walk filed as authorization_required, contacted again on "
                "2026-10-01 with the same initialize at the registered path and at a path that cannot exist on the "
                "same host (/__nx_<random>). One row per address with both statuses, WWW-Authenticate, edge headers, "
                "body hashes and a category derived only from those fields. Read only, no credentials. "
                "Recompute: python3 tools/survey4_auth_probe.py --recompute <this file>.",
        "made_by": "tools/survey4_auth_probe.py",
        "role": "correction",
    },
    "survey5_prm_probe_2026-10-02.jsonl": {
        "what": "The 2,063 addresses that probe 4 found walled on the registered path only, contacted again on "
                "2026-10-02 with one GET of their RFC 9728 protected resource metadata: the URL their challenge named, "
                "or the default /.well-known/oauth-protected-resource location when it named none. One row per address "
                "with status, whether the body is a JSON object, its resource (credential-looking query values "
                "redacted) and the number of authorization servers, and a category derived only from those fields. "
                "Read only, no credentials. Recompute: python3 tools/survey5_prm_probe.py --recompute <this file>.",
        "made_by": "tools/survey5_prm_probe.py",
        "role": "correction",
    },
    "survey6_wellknown_pair_2026-10-03.jsonl": {
        "what": "The 467 addresses of probe 5 whose challenge named no metadata URL, contacted again on 2026-10-03 with "
                "two GETs each: the RFC 9728 default location for the registered path, and the same well-known URL under "
                "a path that cannot exist (_nx plus 16 random hex, stored in the row), same headers. One row per address "
                "with both statuses, whether each body is a JSON object, its resource (credential-looking query values "
                "redacted) and authorization server count, and a pair category derived only from those fields "
                "(live_rs_keep, auth_proxy_wall_every_path, no_doc_unclassified, or an unclassified reason). It corrects "
                "probe 5, which read a non-200 at the default location alone as auth_proxy_by_rule. Read only, no "
                "credentials. Recompute: python3 tools/survey6_wellknown_pair.py --recompute <this file>.",
        "made_by": "tools/survey6_wellknown_pair.py",
        "role": "correction",
    },
    "build_lookup_index.py": {
        "what": "A script, not data. Builds lookup_index.json and lookup_details.json for a per address lookup page "
                "(/verify-directory/lookup/) that is not published yet (2026-09-03). Every row it writes restates a line "
                "already in this directory with its record_sha256; it measures nothing. Its outputs are not committed.",
        "made_by": "hand",
        "role": "tool",
    },
    "survey0_v4_endpoints_active_2026-08-19.txt": {
        "what": "The 12,429 https endpoints the registry declared as active, one per line. "
                "This is the list the walk went through.",
        "made_by": "tools/survey/count_registry.py",
        "role": "population",
    },
    "survey1_walk_2026-08-23_run1_discarded.jsonl": {
        "what": "The first full walk. DISCARDED IN FULL. From 2026-08-23T06:35Z onward every "
                "address came back unreachable; 11,307 rows after that cutover reached 0. "
                "The world did not go down. Our instrument did. No number from this file was published.",
        "made_by": "tools/survey1_walk.py",
        "role": "discarded",
        "do_not_use": True,
    },
    "survey1_walk_2026-08-23_run1_instrument_failure.json": {
        "what": "Why the first walk was discarded, with the minute it broke.",
        "role": "discarded",
    },
    "survey1_walk_2026-08-23_run2.jsonl": {
        "what": "The walk every published number comes from. One JSON object per address. "
                "Each address contacted exactly once, read only. No tool was called on any server.",
        "made_by": "tools/survey1_walk.py",
        "role": "primary",
    },
    "survey1_walk_2026-08-23_run2.jsonl.health.json": {
        "what": "The control probe and dead-man readings taken while the second walk ran.",
        "role": "primary",
    },
    "survey1_report_2026-08-23.json": {
        "what": "Every number that appears on the report page, generated from the walk. "
                "No figure on the page is typed by hand; CI fails the build if a number appears "
                "on the page that is not in this file.",
        "made_by": "tools/survey1_report.py",
        "role": "report",
    },
    "survey2_recheck_2026-08-24.jsonl": {
        "what": "All 918 unresolved rows contacted again under the current 2026-07-28 revision. "
                "33 answered. This is where we found our own version announcement was wrong.",
        "made_by": "tools/survey2_recheck.py",
        "role": "correction",
    },
    "survey3_ladder_2026-08-24.jsonl": {
        "what": "The 882 rows that still did not answer, tried against four protocol versions in turn. "
                "62 more answered at 2025-11-25. None needed anything older.",
        "made_by": "tools/survey3_version_ladder.py",
        "role": "correction",
    },
    "known_limitations.json": {
        "what": "What this measurement cannot tell you, kept beside the data rather than in prose. "
                "Includes the corrections, with the superseded claim retained.",
        "role": "limits",
    },
    "index.json": {
        "what": "This file.",
        "role": "index",
    },
}


# Files named by the UTC date of their run.
WHAT_PREFIX = {
    "survey7_robots_recheck_": {
        "what": "The 1,466 rows of the 2026-08-23 walk skipped as robots_disallowed, checked again: robots.txt fetched "
                "once per origin (1,395 origins) with the walk's User-Agent, redirects recorded up to 5 hops. One row per "
                "skipped endpoint with the final status, redirect hops, content type, body sha256, the user-agent groups "
                "either reading applies, the verdict of the walk's own parser on today's file and the RFC 9309 verdict "
                "(longest match, Allow, consecutive user-agent lines, * and $; 4xx allows, 5xx or no answer disallows). "
                "Category per row is derived only from stored fields. Read only. Recompute: python3 "
                "tools/survey7_robots_recheck.py --recompute <this file>.",
        "made_by": "tools/survey7_robots_recheck.py",
        "role": "correction",
    },
    "survey8_plan_": {
        "what": "The sample for survey8, fixed before any request: the 1,106 rows of the 2026-08-23 walk that failed in "
                "transport (not_reached by DNS, TLS, timeout or reset; gateway 5xx; initialize answered 429), split into six "
                "classes from each row's stored reason, and 300 of them drawn per class from the seed written in the file "
                "(proportional allocation, largest remainders). Its sha256 was posted on modelcontextprotocol/registry "
                "discussion #1547 before the run. Recompute: python3 tools/survey8_transport_recheck.py plan <run2> --seed "
                "<seed> --n 300 --out <file> gives the same bytes.",
        "made_by": "tools/survey8_transport_recheck.py",
        "role": "plan",
    },
    "survey8_transport_recheck_": {
        "what": "The 300 planned rows measured again with the walk's own instrument (robots re-read, control address, "
                "retries), the class written at write time, the vantage stated. Read only, no tool calls. Recompute: python3 "
                "tools/survey8_transport_recheck.py recompute <run2> <this file>.",
        "made_by": "tools/survey8_transport_recheck.py",
        "role": "correction",
    },
}


def sha256(path):
    h = hashlib.sha256()
    with io.open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_ignored(names):
    """The names git ignores in D (.gitignore). They are local build output, never published, so they have no URL to
    list. Without this, --write on a machine that has built them (lookup_*.json) writes an index that a clean checkout,
    such as CI, does not match (2026-10-10, survey-report run 38005752144). Files git does not ignore are all listed,
    described or not."""
    if not names:
        return set()
    try:
        r = subprocess.run(["git", "-C", D, "check-ignore", "--"] + list(names), capture_output=True, text=True)
    except OSError:
        return set()
    if r.returncode not in (0, 1):
        return set()
    return {os.path.basename(l.strip()) for l in r.stdout.splitlines() if l.strip()}


def build():
    files = []
    names = sorted(n for n in os.listdir(D) if os.path.isfile(os.path.join(D, n)) and n != "index.json")
    ignored = git_ignored(names)
    for name in names:
        p = os.path.join(D, name)
        if name in ignored:
            continue
        meta = WHAT.get(name) or next((v for k, v in WHAT_PREFIX.items() if name.startswith(k)), None)
        row = {
            "file": name,
            "url": BASE + name,
            "bytes": os.path.getsize(p),
            "sha256": sha256(p),
        }
        if name.endswith(".jsonl"):
            with io.open(p, encoding="utf-8") as f:
                row["lines"] = sum(1 for l in f if l.strip())
        if meta:
            row.update({k: v for k, v in meta.items()})
        else:
            # 説明の無いファイルを黙って落とさない。索引に「説明が無い」と載せる。
            row["what"] = None
            row["role"] = "undescribed"
            row["note"] = "This file has no description in tools/survey/build_dataset_index.py. "\
                          "It is listed anyway. A dataset index that quietly omits files is not an index."
        files.append(row)

    return {
        "dataset": "HORIZON SHIELD verify-directory - MCP registry survey",
        "license": "CC BY 4.0",
        "measured": {
            "population_counted_on": "2026-08-19",
            "walk_on": "2026-08-23",
            "corrected_on": "2026-08-24",
        },
        "what_this_is":
            "One registry's declared https endpoints, contacted once each, read only. "
            "It is not a scan of the MCP ecosystem.",
        "read_first": BASE.replace("/data/", "/1/"),
        "lookup_one_address":
            "https://hs-mcp-observatory.oga-surf-project.workers.dev/lookup?address=<your endpoint>",
        "mcp_endpoint": "https://hs-mcp-observatory.oga-surf-project.workers.dev/mcp",
        "how_to_reproduce": [
            "python3 tools/survey/count_registry.py   # the population, contacts nothing",
            "python3 tools/survey1_walk.py            # the walk, one contact per address",
            "python3 tools/survey1_report.py          # every published number, from the walk",
            "python3 tools/survey/survey_diff.py --walk <old.jsonl> <new.jsonl>",
        ],
        "rules_we_hold_ourselves_to": [
            "held and pending are never added together.",
            "State the measurement, not a character judgement.",
            "Ship the recipe and the hash with every claim.",
            "A claim about somebody else that cannot be reproduced by the person it is about "
            "should not be published.",
        ],
        "files": files,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    if not os.path.isdir(D):
        sys.stderr.write("データの場所がありません: %s\n" % D)
        return 3

    d = build()
    want = json.dumps(d, ensure_ascii=False, indent=2) + "\n"

    undescribed = [f["file"] for f in d["files"] if f.get("role") == "undescribed"]
    print("ファイル: %d 件" % len(d["files"]))
    for f in d["files"]:
        print("  %-52s %9d B  %s" % (f["file"][:52], f["bytes"], (f.get("role") or "?")))
    if undescribed:
        print("\n説明の無いファイル: %s" % "、".join(undescribed))
        print("  索引には載せています。tools/survey/build_dataset_index.py の WHAT に足してください。")

    have = io.open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if have == want:
        print("\nずれはありません。")
        return 0
    if not a.write:
        print("\nずれています。作り直すには --write を付けてください。")
        return 1
    io.open(OUT, "w", encoding="utf-8").write(want)
    print("\n書きました: %s" % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
