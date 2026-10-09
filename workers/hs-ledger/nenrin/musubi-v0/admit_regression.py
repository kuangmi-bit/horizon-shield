#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Regression for the admission work: nothing that settled before settles differently now.

Three real cases and one corpus, each compared with bytes recorded on 2026-10-10 from the repository at 49c8b050,
before the clause evaluator was moved out of settle_v1_10.py:

  run0002          walk 2 under the second contract (contract_sha256 14474983...): within_grant, final, no deviation
  the outside parties' contract (contract_sha256 d7118f28...), kept in their own repository; their published
                   settlement.json is the reference, and it is fetched from the URLs in tools/adoption/registry.json
  the corpus       admit_fixtures.py, 18 deterministic scenarios

For each: settle v1.10 gives the recorded bytes, and settle v1.11 gives the same bytes (none of these contracts
requires admission).

  python3 admit_regression.py            needs the network for the outside parties' files
  python3 admit_regression.py --offline  skips that case and says so
"""
import hashlib, json, os, sys, tempfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import admit_fixtures as F
import settle_v1_10 as v110
import settle_v1_11 as v111
from contract_v0 import canonical, parse_strict, contract_sha256

RUN0002_SHA256 = "d600a7c482323426d213f3899e94b77b1eb88928f9a3f259a9f4fc0b6bf96683"
PEER_SETTLEMENT_SHA256 = "a21190c7f30ed2436b96efe05d7434f9319b41d5cf42e50ed8c730d6b4067fe7"
CORPUS_SHA16 = "ccd9d4161e8e5980"
REGISTRY = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "tools", "adoption", "registry.json"))
sha = lambda s: hashlib.sha256(s.encode("utf-8") if isinstance(s, str) else s).hexdigest()


def main():
    bad = 0
    def line(ok, text):
        nonlocal bad
        bad += not ok
        print(("ok   " if ok else "NG   ") + text)

    rd = lambda p: parse_strict(open(p, encoding="utf-8").read())
    rr = os.path.join(HERE, "run0002")
    C2 = rd(os.path.join(HERE, "second_contract_AB.json"))
    args = (C2, [rd(os.path.join(rr, "exec_19c44a79.anchored.json"))], rd(os.path.join(rr, "view.json")))
    nr = [rd(os.path.join(rr, "walk_8bf29f1a.json"))]
    s10, s11 = v110.settle_v1_10(*args, nenrin_records=nr), v111.settle_v1_11(*args, nenrin_records=nr)
    line(contract_sha256(C2).startswith("14474983"), "second contract: contract_sha256 %s" % contract_sha256(C2))
    line((s10["verdict"], s10["status"], s10["deviations"]) == ("within_grant", "final", []), "run0002: within_grant, final, no deviation")
    line(sha(canonical(s10)) == RUN0002_SHA256, "run0002: settle v1.10 bytes are the bytes recorded before the change (%s)" % sha(canonical(s10))[:16])
    line(canonical(s11) == canonical(s10), "run0002: settle v1.11 gives the same bytes")

    if "--offline" in sys.argv:
        print("skip the outside parties' contract d7118f28 (--offline): its files live in their repository and were not fetched")
    else:
        row = next(r for r in json.load(open(REGISTRY, encoding="utf-8"))["published_contracts"] if r.get("contract_sha256", "").startswith("d7118f28"))
        get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "curl/8"}), timeout=30).read()
        cb, eb, vb, sb = get(row["contract_url"]), get(row["settle_inputs"]["event_url"]), get(row["settle_inputs"]["view_url"]), get(row["settlement_url"])
        c, e, v = (parse_strict(x.decode("utf-8")) for x in (cb, eb, vb))
        line(contract_sha256(c) == row["contract_sha256"], "outside parties' contract: contract_sha256 %s" % contract_sha256(c))
        line(sha(sb) == PEER_SETTLEMENT_SHA256, "their published settlement.json is the file recorded (%s)" % sha(sb)[:16])
        p10, p11 = v110.settle_v1_10(c, [e], v), v111.settle_v1_11(c, [e], v)
        line(canonical(p10).encode("utf-8") == sb, "settle v1.10 recomputes their settlement.json byte for byte")
        line(canonical(p11) == canonical(p10), "settle v1.11 gives the same bytes")
        line((p10["verdict"], p10["status"], p10["deviations"]) == ("within_grant", "final", []), "within_grant, final, no deviation")

    w = F.World()
    a, b = F.settle_all(w), F.settle_all(w, settle=v111.settle_v1_11)
    agg = sha("".join(a[k] for k in sorted(a)))[:16]
    line(len(a) == 18 and agg == CORPUS_SHA16, "corpus: 18 scenarios, settle v1.10 bytes are the bytes recorded before the change (%s)" % agg)
    line(a == b, "corpus: settle v1.11 gives the same bytes for all 18")

    if bad:
        print("\nFAILED: %d" % bad); return 1
    print("\nALL PASS (admit_regression: run0002 under the second contract 14474983, %sthe 18 scenario corpus; settle v1.10 unchanged, settle v1.11 identical)"
          % ("" if "--offline" in sys.argv else "the outside parties' contract d7118f28, "))
    return 0


if __name__ == "__main__":
    sys.exit(main())
