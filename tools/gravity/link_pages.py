#!/usr/bin/env python3
"""GRAVITY-v0, part 3: point each page and llms.txt at its evidence object (idempotent).

Adds <link rel="alternate" type="application/json" href="/evidence/<qid>.json"> before </head> of each page in
tools/gravity/claims.json, and a block between <!-- gravity-evidence-v0 --> markers in llms.txt listing every object.
Run after build_evidence.py. Prints what changed. Standard library only.
"""
import io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"


def main():
    idx = json.load(io.open(os.path.join(ROOT, "evidence", "index.json"), encoding="utf-8"))
    changed = []
    for o in idx["objects"]:
        path = os.path.join(ROOT, o["page"].replace(SITE + "/", "").strip("/"), "index.html")
        s = io.open(path, encoding="utf-8").read()
        tag = '<link rel="alternate" type="application/json" href="/evidence/%s.json" title="Evidence object: %s">' % (o["qid"], o["question"])
        if tag in s:
            continue
        s2 = re.sub(r'\n?<link rel="alternate" type="application/json" href="/evidence/[a-z0-9]+\.json"[^>]*>', "", s)
        if "</head>" not in s2:
            sys.exit("no </head> in %s" % path)
        s2 = s2.replace("</head>", tag + "\n</head>", 1)
        io.open(path, "w", encoding="utf-8").write(s2)
        changed.append(os.path.relpath(path, ROOT))
    lp = os.path.join(ROOT, "llms.txt")
    L = io.open(lp, encoding="utf-8").read()
    lines = ["<!-- gravity-evidence-v0 -->", "## Evidence objects (one canonical claim per question)",
             "Each object answers one buyer question with numbers from souba-db (version %s, SHA-256 %s), a comparison across variants, steps the reader can take to check it, the dataset hash and the JIDEC entry that anchors it. Index: %s/evidence/index.json"
             % (idx["dataset_version"], idx["dataset_sha256"], SITE)]
    for o in idx["objects"]:
        lines.append("- [%s](%s): %s (page %s)" % (o["question"], o["url"], o["claim_id"], o["page"]))
    lines.append("<!-- /gravity-evidence-v0 -->")
    block = "\n".join(lines)
    if "<!-- gravity-evidence-v0 -->" in L:
        L2 = re.sub(r"<!-- gravity-evidence-v0 -->.*?<!-- /gravity-evidence-v0 -->", block, L, flags=re.S)
    else:
        anchor = "## 相場・価格根拠 (GEO)"
        L2 = L.replace(anchor, block + "\n\n" + anchor, 1) if anchor in L else L.rstrip("\n") + "\n\n" + block + "\n"
    if L2 != L:
        io.open(lp, "w", encoding="utf-8").write(L2)
        changed.append("llms.txt")
    print("changed: %s" % (", ".join(changed) or "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
