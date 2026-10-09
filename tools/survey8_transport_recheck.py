# -*- coding: utf-8 -*-
"""
survey8: re-fetch a seeded, stratified sample of the run2 rows that failed in transport, to bound how many of the
5,178 measured rows that did not speak MCP were our instrument and not the server.

Why (2026-10-10, modelcontextprotocol/registry discussion #1547, zzzz0902zzzz-rgb): 5,785 of 10,963 measured rows spoke
MCP. A DNS, TLS or connect failure and a real non-MCP server must not share a bucket. run2 already records the error in
each row's reason, so the bucket can be split without new requests (classes below). This probe re-measures a sample of
the transport classes with the same instrument as run2 (survey1_walk.measure_guarded: robots re-read, the control
address, retries, the error class written at write time) and estimates how many would flip.

Three steps, in this order, so the sample cannot be chosen after seeing results:
  1. plan       draw the sample from the seed and write it (rows, classes, seed, sha256). Post the plan's sha256 first.
  2. run        measure exactly the planned rows, nothing else. Reads only, no tool calls.
  3. recompute  print both lines from one row set: the stratified estimate over 10,963 measured rows and over 12,429.

  python3 tools/survey8_transport_recheck.py plan verify-directory/survey/data/survey1_walk_2026-08-23_run2.jsonl \
      --seed survey8-2026-10-10 --n 300 --out verify-directory/survey/data/survey8_plan.json
  python3 tools/survey8_transport_recheck.py run  verify-directory/survey/data/survey8_plan.json \
      --out verify-directory/survey/data/survey8_transport_recheck.jsonl
  python3 tools/survey8_transport_recheck.py recompute verify-directory/survey/data/survey1_walk_2026-08-23_run2.jsonl \
      verify-directory/survey/data/survey8_transport_recheck.jsonl
"""
import argparse, hashlib, io, json, os, random, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SPEAKS = ("speaks_mcp_and_lists_tools", "speaks_mcp_no_tool_list")
SKIPPED = ("robots_disallowed", "robots_unreachable")
CLASSES = ("dns", "tls", "timeout", "reset_refused_other", "gateway_5xx", "rate_limited_429")


def transport_class(row):
    """The transport class of a run2 row, or None when the row is not a transport failure."""
    o, why = row.get("outcome"), row.get("reason") or ""
    if o == "not_reached":
        if "gaierror" in why:
            return "dns"
        if "SSL" in why or "Cert" in why:
            return "tls"
        if "timed out" in why or "timeout" in why:
            return "timeout"
        return "reset_refused_other"
    if o == "gateway_error":
        return "gateway_5xx"
    if o == "initialize_rejected" and row.get("http_status") == 429:
        return "rate_limited_429"
    return None


def load_rows(path):
    rows = []
    for line in io.open(path, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def population(rows):
    """{class: [endpoint, ...]} over the run2 rows, each list sorted so the draw depends only on the seed."""
    pop = {c: [] for c in CLASSES}
    for r in rows:
        c = transport_class(r)
        if c:
            pop[c].append(r["endpoint"])
    return {c: sorted(v) for c, v in pop.items()}


def allocate(sizes, n):
    """Proportional allocation with largest remainders; each non-empty class gets at least one row."""
    total = sum(sizes.values())
    if total == 0 or n <= 0:
        return {c: 0 for c in sizes}
    quota = {c: n * s / total for c, s in sizes.items()}
    alloc = {c: min(sizes[c], max(1 if sizes[c] else 0, int(quota[c]))) for c in sizes}
    rest = n - sum(alloc.values())
    for c in sorted(sizes, key=lambda c: (-(quota[c] - int(quota[c])), c)):
        if rest <= 0:
            break
        if alloc[c] < sizes[c]:
            alloc[c] += 1
            rest -= 1
    while sum(alloc.values()) > n:                       # the minimum of one can overshoot on tiny classes
        c = max((c for c in alloc if alloc[c] > 1), key=lambda c: alloc[c] - quota[c])
        alloc[c] -= 1
    return alloc


def draw(pop, n, seed):
    sizes = {c: len(v) for c, v in pop.items()}
    alloc = allocate(sizes, n)
    sample = []
    for c in CLASSES:
        rng = random.Random(hashlib.sha256(("%s|%s" % (seed, c)).encode("utf-8")).digest())
        picked = rng.sample(pop[c], alloc[c]) if alloc[c] else []
        sample += [{"endpoint": e, "class": c} for e in sorted(picked)]
    return sizes, alloc, sample


def plan_bytes(plan):
    return json.dumps(plan, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def cmd_plan(a):
    rows = load_rows(a.run2)
    pop = population(rows)
    sizes, alloc, sample = draw(pop, a.n, a.seed)
    plan = {"schema": "survey8-plan-v1", "run2": os.path.basename(a.run2),
            "run2_sha256": hashlib.sha256(open(a.run2, "rb").read()).hexdigest(),
            "seed": a.seed, "n": a.n, "population": sizes, "allocation": alloc, "sample": sample}
    b = plan_bytes(plan)
    open(a.out, "wb").write(b)
    print("population by class: " + json.dumps(sizes))
    print("allocation:          " + json.dumps(alloc))
    print("plan written to %s, sha256 %s (post this before running)" % (a.out, hashlib.sha256(b).hexdigest()))


def run_class(rec):
    """The class written at write time for a fresh measurement."""
    if rec.get("outcome") in SPEAKS:
        return "speaks_mcp"
    c = transport_class(rec)
    if c:
        return c
    return rec.get("outcome") or "unknown"


def cmd_run(a):
    import survey1_walk as W
    plan = json.loads(open(a.plan, encoding="utf-8").read())
    psha = hashlib.sha256(plan_bytes(plan)).hexdigest()
    ok, via = W.control_ok()
    if not ok:
        sys.exit("the control address is not reachable from here: our side is down. Nothing measured.")
    vantage = a.vantage or "unstated"
    done = set()
    if os.path.exists(a.out):
        for line in io.open(a.out, encoding="utf-8"):
            try:
                done.add(json.loads(line)["endpoint"])
            except Exception:
                pass
    todo = [s for s in plan["sample"] if s["endpoint"] not in done]
    print("plan %s: %d rows, %d already measured, %d to measure; control %s; vantage %s" % (psha[:16], len(plan["sample"]), len(done), len(todo), via, vantage))
    with io.open(a.out, "a", encoding="utf-8") as fh:
        for i, s in enumerate(todo, 1):
            try:
                rec = W.measure_guarded(s["endpoint"], verbose=False)
            except Exception as e:
                rec = {"endpoint": s["endpoint"], "state": "held", "outcome": "probe_error", "reason": "our probe raised: %s" % W.describe_exc(e)}
            out = {"endpoint": s["endpoint"], "run2_class": s["class"], "plan_sha256": psha, "vantage": vantage,
                   "measured_at": rec.get("measured_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "outcome": rec.get("outcome"), "reason": rec.get("reason"), "http_status": rec.get("http_status"),
                   "speaks_mcp": bool(rec.get("speaks_mcp")), "class_now": run_class(rec)}
            fh.write(json.dumps(W.stamp(out), ensure_ascii=False) + "\n")
            fh.flush()
            if i % 25 == 0 or i == len(todo):
                print("  %d / %d" % (i, len(todo)))
            if W._abort.is_set():
                sys.exit("ABORTED: the instrument did not recover. Rows written so far are valid; resume with the same command.")
            time.sleep(a.sleep)


def estimate(run2_rows, recheck_rows):
    """Stratified estimate: each class's flipped fraction applied to that class's population."""
    pop = population(run2_rows)
    sizes = {c: len(v) for c, v in pop.items()}
    speaks = sum(1 for r in run2_rows if r.get("outcome") in SPEAKS)
    measured = sum(1 for r in run2_rows if r.get("outcome") not in SKIPPED)
    total = len(run2_rows)
    per = {}
    for c in CLASSES:
        rs = [r for r in recheck_rows if r.get("run2_class") == c and r.get("outcome") not in SKIPPED + ("instrument_down", "probe_error")]
        flipped = sum(1 for r in rs if r.get("speaks_mcp"))
        per[c] = {"population": sizes[c], "rechecked": len(rs), "flipped": flipped,
                  "fraction": (flipped / len(rs)) if rs else None}
    added = sum(v["population"] * v["fraction"] for v in per.values() if v["fraction"] is not None)
    return {"speaks_run2": speaks, "measured": measured, "total": total, "per_class": per, "estimated_flips": added,
            "rate_measured": (speaks + added) / measured, "rate_total": (speaks + added) / total,
            "floor_measured": speaks / measured, "floor_total": speaks / total}


def cmd_recompute(a):
    e = estimate(load_rows(a.run2), load_rows(a.recheck))
    for c, v in e["per_class"].items():
        print("  %-20s population %5d  rechecked %3d  flipped %3d  fraction %s" % (c, v["population"], v["rechecked"], v["flipped"], "n/a" if v["fraction"] is None else "%.3f" % v["fraction"]))
    print("floor:     %d / %d = %.1f%%   (%.1f%% of %d)" % (e["speaks_run2"], e["measured"], 100 * e["floor_measured"], 100 * e["floor_total"], e["total"]))
    print("estimate:  (%d + %.0f) / %d = %.1f%%   (%.1f%% of %d)" % (e["speaks_run2"], e["estimated_flips"], e["measured"], 100 * e["rate_measured"], 100 * e["rate_total"], e["total"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("plan"); p.add_argument("run2"); p.add_argument("--seed", required=True); p.add_argument("--n", type=int, default=300); p.add_argument("--out", required=True)
    r = sp.add_parser("run"); r.add_argument("plan"); r.add_argument("--out", required=True); r.add_argument("--sleep", type=float, default=0.6); r.add_argument("--vantage", default="")
    c = sp.add_parser("recompute"); c.add_argument("run2"); c.add_argument("recheck")
    a = ap.parse_args()
    {"plan": cmd_plan, "run": cmd_run, "recompute": cmd_recompute}[a.cmd](a)


if __name__ == "__main__":
    main()
