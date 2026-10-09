# -*- coding: utf-8 -*-
"""Offline test for survey8: classes match the published split, the draw is fixed by the seed, the allocation sums to n,
and the stratified estimate is computed from one row set. Run: python3 tools/survey8_transport_recheck_test.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import survey8_transport_recheck as S  # noqa: E402

RUN2 = os.path.join(HERE, "..", "verify-directory", "survey", "data", "survey1_walk_2026-08-23_run2.jsonl")
ok = 0


def check(name, got, want):
    global ok
    if got != want:
        sys.exit("FAIL %s: got %r want %r" % (name, got, want))
    ok += 1
    print("ok   " + name)


rows = S.load_rows(RUN2)
pop = S.population(rows)
sizes = {c: len(v) for c, v in pop.items()}
check("classes match the split posted on #1547 (discussioncomment-18844048)", sizes,
      {"dns": 635, "tls": 174, "timeout": 113, "reset_refused_other": 21, "gateway_5xx": 151, "rate_limited_429": 12})
check("the transport population is 1,106 rows", sum(sizes.values()), 1106)
s1, a1, d1 = S.draw(pop, 300, "survey8-2026-10-10")
s2, a2, d2 = S.draw(pop, 300, "survey8-2026-10-10")
check("same seed, same sample", d1, d2)
check("allocation sums to 300", sum(a1.values()), 300)
check("every class is sampled", all(v >= 1 for v in a1.values()), True)
_, _, d3 = S.draw(pop, 300, "another seed")
check("another seed draws another sample", d1 != d3, True)
check("no endpoint twice", len({x["endpoint"] for x in d1}), 300)
e0 = S.estimate(rows, [])
check("no recheck rows: the estimate is the floor 5,785 / 10,963", (e0["speaks_run2"], e0["measured"], e0["total"], round(e0["rate_measured"], 4)), (5785, 10963, 12429, 0.5277))
fake = [{"endpoint": x["endpoint"], "run2_class": x["class"], "outcome": "speaks_mcp_and_lists_tools" if x["class"] == "gateway_5xx" else "not_reached", "speaks_mcp": x["class"] == "gateway_5xx"} for x in d1]
e1 = S.estimate(rows, fake)
check("every sampled gateway row flipping adds the whole gateway class (151)", round(e1["estimated_flips"]), 151)
fake[0]["outcome"] = "instrument_down"
e2 = S.estimate(rows, fake)
check("instrument_down rows are not counted as rechecked", e2["per_class"][d1[0]["class"]]["rechecked"], a1[d1[0]["class"]] - 1)
print("\nall passed (%d)" % ok)
