#!/usr/bin/env python3
"""TSUNAGI (繋): every night, run every registered implementation against the corpora and publish where they agree.

    python3 tools/tsunagi/run_board.py --out ops/tsunagi            (from the repository root; clones into a temp dir)
    python3 tools/tsunagi/run_board.py --out /tmp/b --ext-dir DIR    (reuse clones already in DIR, no network)

Each row of implementations.json is code in its author's own repository. The board clones it at the default branch
head, runs the command in the row against this repository's corpus, and records the commit it ran, the exit code,
the counts and, where the implementation prints them, one result per vector. Rows marked ours are one column among
the others. A disagreement is written down as a disagreement; nothing here turns it into a pass.

What a green cell establishes: that this code, at this commit, reproduced this corpus's expectations on this run.
What it does not: that the corpus is right, that the code is correct elsewhere, or anything about who wrote it.

Writes board.json (the whole result, canonical JSON, with its own sha256) and BOARD.md (the table people read).
The cloning and running part needs no token and no secret; the workflow runs it with a read-only token.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TIMEOUT = 900


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sh(cmd, cwd=None, env=None, timeout=TIMEOUT):
    e = dict(os.environ)
    e.update(env or {})
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr, round(time.time() - t0, 1)
    except subprocess.TimeoutExpired as x:
        return 124, x.stdout or "", "timeout after %ss" % timeout, round(time.time() - t0, 1)
    except FileNotFoundError as x:
        return 127, "", str(x), 0.0


def clone(repo, dest):
    if os.path.isdir(os.path.join(dest, ".git")):
        return True, ""
    code, out, err, _ = sh(["git", "clone", "-q", "--depth", "1", repo, dest], timeout=600)
    return code == 0, err.strip()[-300:]


def head(dest):
    code, out, _, _ = sh(["git", "-C", dest, "rev-parse", "HEAD"])
    return out.strip() if code == 0 else None


# ---- parsing what each implementation prints ------------------------------------------------------------------
def parse_count_line(out):
    m = re.findall(r"(\d+)/(\d+) verdict signatures reproduced", out)
    return (int(m[-1][0]), int(m[-1][1]), None) if m else (None, None, None)


def parse_all_pass(out, total):
    return (total, total, None) if "ALL PASS" in out else (0, total, None)


def parse_approval_lines(out):
    per = {}
    for line in out.splitlines():
        m = re.match(r"^(ok|NG)\s+(\S+)\s+(\S+)\s*(\S*)\s*$", line)
        if m:
            per[m.group(2)] = {"ok": m.group(1) == "ok", "result": m.group(3), "reason": m.group(4) or None}
    m = re.findall(r"(\d+)/(\d+) agree", out)
    n, t = (int(m[-1][0]), int(m[-1][1])) if m else (sum(v["ok"] for v in per.values()), len(per))
    return n, t, per or None


def parse_json_results(out):
    try:
        d = json.loads(out[out.index("{"):])
    except (ValueError, json.JSONDecodeError):
        return None, None, None
    res = d.get("results") or []
    per = {r["id"]: {"ok": bool(r.get("matches")), "canonical_sha256": r.get("canonical_sha256")} for r in res if "id" in r}
    return sum(v["ok"] for v in per.values()), len(per), per


def parse_pytest(out):
    p = re.findall(r"(\d+) passed", out)
    f = re.findall(r"(\d+) failed", out)
    n = int(p[-1]) if p else 0
    return n, n + (int(f[-1]) if f else 0), None


def parse(kind, code, out, total):
    if kind == "count_line":
        n, t, per = parse_count_line(out)
    elif kind == "all_pass":
        n, t, per = parse_all_pass(out, total)
    elif kind == "approval_lines":
        n, t, per = parse_approval_lines(out)
    elif kind == "json_results":
        n, t, per = parse_json_results(out)
    elif kind == "pytest":
        n, t, per = parse_pytest(out)
    else:
        raise ValueError("unknown parse kind %r" % kind)
    passed = code == 0 and n is not None and n == t == total
    return {"reproduced": n, "of": t, "expected_total": total, "passed": passed, "per_vector": per}


def expand(s, impl_dir, board_dir, vectors):
    if not isinstance(s, str):
        return s
    if s.startswith("@vectors:"):
        return vectors.get(s[len("@vectors:"):], s)
    return (s.replace("@hs", ROOT).replace("@impl", impl_dir or "/nonexistent").replace("@board", board_dir))


def run_board(spec, ext_dir):
    rows, vectors, heads = [], {}, {}
    for impl in spec["implementations"]:
        impl_dir = None
        info = {"id": impl["id"], "ours": impl["ours"], "author": impl["author"], "repo": impl.get("repo"),
                "language": impl.get("language"), "license": impl.get("license"), "commit": None, "clone_error": None}
        if impl.get("repo"):
            impl_dir = os.path.join(ext_dir, impl["id"])
            ok, err = clone(impl["repo"], impl_dir)
            if not ok:
                info["clone_error"] = err or "clone failed"
            else:
                info["commit"] = head(impl_dir)
        else:
            info["commit"] = head(ROOT)
        heads[impl["id"]] = info
        for run in impl["runs"]:
            if run.get("vectors") and impl_dir:
                vectors[run["corpus"]] = expand(run["vectors"], impl_dir, HERE, vectors)
            row = {"implementation": impl["id"], "ours": impl["ours"], "corpus": run["corpus"], "commit": info["commit"]}
            if info["clone_error"]:
                row.update({"status": "not_run", "reason": "the repository could not be cloned: " + info["clone_error"]})
                rows.append(row); continue
            cwd = expand(run["cwd"], impl_dir, HERE, vectors)
            env = {k: expand(v, impl_dir, HERE, vectors) for k, v in (run.get("env") or {}).items()}
            if run.get("setup"):
                code, out, err, secs = sh([expand(x, impl_dir, HERE, vectors) for x in run["setup"]], cwd=cwd, env=env)
                if code != 0:
                    row.update({"status": "not_run", "reason": "setup failed (exit %d): %s" % (code, (err or out).strip()[-300:])})
                    rows.append(row); continue
            cmd = [expand(x, impl_dir, HERE, vectors) for x in run["cmd"]]
            code, out, err, secs = sh(cmd, cwd=cwd, env=env)
            res = parse(run["parse"], code, out, run["total"])
            row.update({"status": "ran", "exit": code, "seconds": secs, "stdout_sha256": hashlib.sha256(out.encode()).hexdigest(), **res})
            if code != 0 and not out.strip():
                row["stderr_tail"] = err.strip()[-300:]
            rows.append(row)
    pairs = []
    by = {(r["implementation"], r["corpus"]): r for r in rows}
    for p in spec.get("pairs", []):
        a, b = by.get((p["a"], p["corpus"])), by.get((p["b"], p["corpus"]))
        out = {"corpus": p["corpus"], "a": p["a"], "b": p["b"], "what": p["what"]}
        if not a or not b or a.get("status") != "ran" or b.get("status") != "ran":
            out.update({"agree": None, "reason": "one side did not run"})
        elif a.get("per_vector") and b.get("per_vector"):
            ids = sorted(set(a["per_vector"]) | set(b["per_vector"]))
            same = [i for i in ids if i in a["per_vector"] and i in b["per_vector"]
                    and (a["per_vector"][i].get("result"), a["per_vector"][i].get("reason")) == (b["per_vector"][i].get("result"), b["per_vector"][i].get("reason"))]
            out.update({"agree": len(same) == len(ids), "same": len(same), "of": len(ids),
                        "differ": [i for i in ids if i not in same]})
        else:
            out.update({"agree": bool(a["passed"] and b["passed"]), "same": None, "of": None,
                        "basis": "both reproduce every expectation of the corpus"})
        pairs.append(out)
    return rows, pairs, heads


def to_md(board):
    L = ["# TSUNAGI board", "",
         "Every night each registered implementation, cloned from its author's own repository, runs against the corpora "
         "in this repository. A cell is one run of one implementation at one commit. Rows marked ours are this "
         "project's own code, one column among the others. Generated by `tools/tsunagi/run_board.py`; the whole "
         "result is `board.json` (sha256 `%s`)." % board["board_sha256"], "",
         "Run at %s. %d of %d runs reproduced every expectation; %d by authors outside this project." % (
             board["measured_at"], board["summary"]["passed"], board["summary"]["runs"], board["summary"]["outside_passed"]), "",
         "| implementation | author | corpus | result | commit |", "|---|---|---|---|---|"]
    heads = board["implementations"]
    for r in board["runs"]:
        h = heads[r["implementation"]]
        who = h["author"] + (" (this project)" if r["ours"] else "")
        if r["status"] != "ran":
            res = "not run: " + r["reason"]
        else:
            res = "%s %s/%s" % ("pass" if r["passed"] else "FAIL", r.get("reproduced"), r.get("expected_total"))
        link = r["implementation"] if not h["repo"] else "[%s](%s)" % (r["implementation"], h["repo"][:-4] if h["repo"].endswith(".git") else h["repo"])
        L.append("| %s | %s | %s | %s | `%s` |" % (link, who, r["corpus"], res, (r.get("commit") or "")[:8]))
    L += ["", "## Two implementations, one corpus", "", "| corpus | a | b | agree |", "|---|---|---|---|"]
    for p in board["pairs"]:
        if p["agree"] is None:
            ag = "not compared: " + p["reason"]
        elif p.get("of"):
            ag = "%s, %d/%d vectors%s" % ("yes" if p["agree"] else "NO", p["same"], p["of"], "" if p["agree"] else " (differ: " + ", ".join(p["differ"]) + ")")
        else:
            ag = ("yes" if p["agree"] else "NO") + ", " + p["basis"]
        L.append("| %s | %s | %s | %s |" % (p["corpus"], p["a"], p["b"], ag))
    L += ["", "Add your implementation with one pull request: a row in `tools/tsunagi/implementations.json` naming your "
          "public repository, the command, and the corpus. It appears on the next night's board, at your own commit, "
          "in your own repository. A green cell is a reproduction on that run, not an endorsement.", ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ext-dir")
    ap.add_argument("--only", help="comma separated implementation ids")
    a = ap.parse_args()
    spec = json.load(open(os.path.join(HERE, "implementations.json"), encoding="utf-8"))
    if a.only:
        keep = set(a.only.split(","))
        spec["implementations"] = [i for i in spec["implementations"] if i["id"] in keep]
    ext = a.ext_dir or tempfile.mkdtemp(prefix="tsunagi-")
    os.makedirs(ext, exist_ok=True)
    rows, pairs, heads = run_board(spec, ext)
    board = {"schema": "hs-tsunagi-board-v0", "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
             "repository_commit": head(ROOT), "implementations": heads, "runs": rows, "pairs": pairs,
             "summary": {"runs": len(rows), "passed": sum(1 for r in rows if r.get("passed")),
                         "outside_passed": sum(1 for r in rows if r.get("passed") and not r["ours"]),
                         "outside_authors_passing": sorted({heads[r["implementation"]]["author"] for r in rows if r.get("passed") and not r["ours"]}),
                         "not_run": sum(1 for r in rows if r.get("status") != "ran")}}
    board["board_sha256"] = hashlib.sha256(canonical({k: v for k, v in board.items() if k != "board_sha256"}).encode()).hexdigest()
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "board.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(board, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    with open(os.path.join(a.out, "BOARD.md"), "w", encoding="utf-8") as f:
        f.write(to_md(board))
    s = board["summary"]
    print("TSUNAGI: %d/%d runs reproduced every expectation (%d outside this project, authors: %s); %d not run; board %s"
          % (s["passed"], s["runs"], s["outside_passed"], ", ".join(s["outside_authors_passing"]) or "none", s["not_run"], board["board_sha256"][:16]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
