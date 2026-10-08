#!/usr/bin/env python3
"""verify_chain.py: check a copy of the JIDEC ledger end to end, offline, with the Python standard library only.

The copy is the one committed daily to kept/ beside this file (a mirror-v0 layout: ledger/<n>.json, ledger/<n>.raw,
ledger/<n>.ots). It lives at GitHub and is archived by Software Heritage. It is a second copy, still published by
the same operator; it is not an independent ledger. This script lets a reader check it without
ledger.horizonshield.dev.

    python3 verify_chain.py --dir kept
    python3 verify_chain.py --dir kept --export kept/export.jsonl --head kept/head.json

What is checked:
  1. sequence: ledger/<n>.json exists for every n from 1 to the highest, and each file's own n equals its name
  2. digests: sha256 of every ledger/<n>.raw equals the claim_sha256 in ledger/<n>.json
  3. chain: jidec-chain-v1 is recomputed over 1..N from the copy (recipe imported from survive.py, which is the
     same recipe as workers/hs-ledger/src/chain_v1.mjs and is tested against it in survive_test.py)
  4. stamped heads: every ledger_head a checkpoint or batch carries inside its own bytes must match the recomputation
  5. export (optional, the ledger's GET /ledger/export.jsonl): every row is re-hashed, every prev_entry_sha256 must
     equal the previous row's entry_sha256 (64 zeros for row 1), sequence numbers must run 1, 2, 3 without a gap,
     rows the copy also holds must agree with it field by field, and the closing head marker must hash correctly
  6. head (optional, the ledger's GET /ledger/head): n, head and the marker entry_sha256 must agree with the
     recomputation (or with the export when the live ledger is ahead of the copy)

What it does not check: the Bitcoin anchors (run survive.py drill for that, it needs the opentimestamps library and
two block explorers), that any claim is true, or that the ledger appended everything it received.

Exit status 0 when there are no findings, 1 otherwise. --json prints the report as JSON.
"""
import argparse, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from survive import CHAIN_ROOT, canon, chain_body, check_chain, entry_sha, load_entries, marker_sha  # noqa: E402

SCHEMA = "nenrin-chain-check-v0"
HEAD_SCHEMA = "jidec-head-v1"
BROKEN_SCHEMA = "jidec-chain-broken-v1"


def sha256hex(b):
    return hashlib.sha256(b).hexdigest()


def _is_hex64(s):
    return isinstance(s, str) and len(s) == 64 and all(c in "0123456789abcdef" for c in s)


def check_copy(d):
    """Sequence, digests, chain and stamped heads over the copy alone. Returns (part, findings, entries, hashes)."""
    findings = []
    ld = os.path.join(d, "ledger")
    if not os.path.isdir(ld):
        return {"entries": 0}, [{"what": "no_ledger_dir", "path": ld}], {}, {}
    try:
        entries = load_entries(d)
    except Exception as e:  # noqa: BLE001
        return {"entries": 0}, [{"what": "entry_json_unparseable", "detail": str(e)}], {}, {}
    top = max(entries) if entries else 0
    missing = [n for n in range(1, top + 1) if n not in entries]
    for n in missing:
        findings.append({"what": "seq_gap", "n": n})
    for n in sorted(entries):
        if entries[n].get("n") != n:
            findings.append({"what": "seq_mismatch", "file_n": n, "entry_n": entries[n].get("n")})
        if not _is_hex64(entries[n].get("claim_sha256")):
            findings.append({"what": "claim_sha256_malformed", "n": n})
    for n in sorted(entries):
        p = os.path.join(ld, "%d.raw" % n)
        if not os.path.exists(p):
            findings.append({"what": "raw_missing", "n": n})
            continue
        with open(p, "rb") as f:
            got = sha256hex(f.read())
        if got != entries[n].get("claim_sha256"):
            findings.append({"what": "raw_digest_mismatch", "n": n, "claim_sha256": entries[n].get("claim_sha256"), "got": got})
    ch = check_chain(d, entries)
    if ch["broken_at"]:
        findings.append({"what": "chain_broken", "at": ch["broken_at"]})
    for r in ch["stamped_heads"]:
        if r["result"] in ("entry_sha256_mismatch", "marker_mismatch"):
            findings.append({"what": "stamped_head_" + r["result"], "carried_by": r["carried_by"], "head_n": r["head_n"]})
    # per entry hashes, for comparison with the export and the head
    hashes, prev = {}, CHAIN_ROOT
    for n in range(1, ch["rebuilt_through"] + 1):
        prev = entry_sha(entries[n], prev)
        hashes[n] = prev
    part = {"entries": len(entries), "highest": top, "rebuilt_through": ch["rebuilt_through"], "head": ch["head"],
            "head_marker_sha256": marker_sha(ch["rebuilt_through"], ch["head"]) if ch["head"] else None,
            "stamped_heads": len(ch["stamped_heads"]), "stamped_heads_matched": ch["stamped_heads_matched"]}
    return part, findings, entries, hashes


def check_export(path, entries, hashes):
    """Re-hash every export row, check prev links and sequence, compare with the copy. Returns (part, findings, tip)."""
    findings, rows, marker, broken = [], [], None, None
    with open(path, "rb") as f:
        lines = [ln for ln in f.read().decode("utf-8").split("\n") if ln.strip()]
    for i, ln in enumerate(lines):
        try:
            obj = json.loads(ln)
        except Exception:  # noqa: BLE001
            findings.append({"what": "export_line_unparseable", "line": i + 1})
            continue
        if obj.get("schema") == HEAD_SCHEMA and "head" in obj:
            marker = obj
        elif obj.get("schema") == BROKEN_SCHEMA:
            broken = obj
        else:
            rows.append(obj)
    prev, tip_n, tip = CHAIN_ROOT, 0, CHAIN_ROOT
    by_n = {}
    for i, r in enumerate(rows):
        want_n = i + 1
        if r.get("n") != want_n:
            findings.append({"what": "export_seq_gap", "expected_n": want_n, "got_n": r.get("n")})
            break
        if r.get("prev_entry_sha256") != prev:
            findings.append({"what": "export_prev_link_broken", "n": want_n, "prev_entry_sha256": r.get("prev_entry_sha256"), "expected": prev})
        recomputed = sha256hex(canon(chain_body(r, prev)).encode("ascii"))
        if r.get("entry_sha256") != recomputed:
            findings.append({"what": "export_entry_rehash_mismatch", "n": want_n, "stated": r.get("entry_sha256"), "recomputed": recomputed})
        if want_n in entries:
            e = entries[want_n]
            for k in ("claim_sha256", "schema", "created_at"):
                # chain_body omits a schema or created_at that is not a string, so absent and non string compare equal
                cv = e.get(k) if isinstance(e.get(k), str) else None
                rv = r.get(k) if isinstance(r.get(k), str) else None
                if cv != rv:
                    findings.append({"what": "export_differs_from_copy", "n": want_n, "field": k})
            if want_n in hashes and r.get("entry_sha256") != hashes[want_n]:
                findings.append({"what": "export_hash_differs_from_copy", "n": want_n})
        prev = recomputed
        tip_n, tip = want_n, recomputed
        by_n[want_n] = recomputed
    if broken is not None:
        findings.append({"what": "export_reports_chain_broken", "broken_at": broken.get("broken_at")})
    if marker is None and broken is None:
        findings.append({"what": "export_has_no_head_marker"})
    if marker is not None:
        if marker.get("n") != tip_n or marker.get("head") != tip or marker.get("prev_entry_sha256") != tip:
            findings.append({"what": "export_marker_disagrees", "marker_n": marker.get("n"), "tip_n": tip_n})
        if marker.get("entry_sha256") != marker_sha(tip_n, tip):
            findings.append({"what": "export_marker_rehash_mismatch", "n": tip_n})
    copy_top = max(entries) if entries else 0
    if tip_n < copy_top:
        findings.append({"what": "export_shorter_than_copy", "export_n": tip_n, "copy_n": copy_top})
    part = {"rows": len(rows), "tip_n": tip_n, "tip": tip if tip_n else None, "ahead_of_copy_by": max(0, tip_n - copy_top)}
    return part, findings, (tip_n, tip, by_n)


def check_head(path, copy_n, copy_head, export_tip):
    findings = []
    with open(path, "rb") as f:
        h = json.loads(f.read().decode("utf-8"))
    if h.get("error"):
        return {"n": None}, [{"what": "live_head_reports_error", "error": h.get("error"), "broken_at": h.get("broken_at")}]
    n, head = h.get("n"), h.get("head")
    if not isinstance(n, int) or not _is_hex64(head):
        return {"n": None}, [{"what": "head_malformed"}]
    if h.get("entry_sha256") != marker_sha(n, head):
        findings.append({"what": "head_marker_rehash_mismatch", "n": n})
    if n < copy_n:
        findings.append({"what": "live_head_behind_copy", "head_n": n, "copy_n": copy_n})
    elif n == copy_n:
        if head != copy_head:
            findings.append({"what": "live_head_differs_from_copy", "n": n, "live": head, "copy": copy_head})
    elif export_tip is not None and n <= export_tip[0]:
        # the head is read before the export, so an export that grew in between still covers the head's n
        if head != export_tip[2].get(n):
            findings.append({"what": "live_head_differs_from_export", "n": n})
    else:
        findings.append({"what": "live_head_ahead_unverified", "head_n": n, "copy_n": copy_n,
                         "why": "the live head is ahead of the copy and no export of that length was given, so it cannot be recomputed"})
    return {"n": n, "head": head, "matches": not findings}, findings


def run(d, export=None, head=None):
    part, findings, entries, hashes = check_copy(d)
    if not entries:
        return {"schema": SCHEMA, "dir": d, "copy": part, "findings": findings or [{"what": "empty_copy"}], "ok": False}
    rep = {"schema": SCHEMA, "dir": d, "copy": part}
    tip = None
    if export:
        ep, ef, tip = check_export(export, entries, hashes)
        rep["export"] = ep
        findings += ef
    if head:
        hp, hf = check_head(head, part["rebuilt_through"], part["head"], tip)
        rep["head"] = hp
        findings += hf
    rep["findings"] = findings
    rep["ok"] = not findings
    rep["does_not_establish"] = ["that the Bitcoin anchors are valid (run survive.py drill)", "that any claim in the ledger is true",
                                 "that the ledger appended every submission it received",
                                 "that this copy is independent of the operator: it is published by the same operator"]
    return rep


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check a copy of the JIDEC ledger end to end, offline, standard library only")
    ap.add_argument("--dir", required=True, help="a mirror-v0 layout copy, for example kept/")
    ap.add_argument("--export", help="the ledger's /ledger/export.jsonl, saved to a file")
    ap.add_argument("--head", help="the ledger's /ledger/head, saved to a file")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    a = ap.parse_args(argv)
    rep = run(a.dir, a.export, a.head)
    if a.json:
        print(json.dumps(rep, indent=2, sort_keys=True))
    else:
        c = rep["copy"]
        print("copy %s: %s entries, chain rebuilt through %s, head %s" % (rep["dir"], c.get("entries"), c.get("rebuilt_through"), c.get("head")))
        print("stamped heads matched %s of %s" % (c.get("stamped_heads_matched"), c.get("stamped_heads")))
        if "export" in rep:
            e = rep["export"]
            print("export: %s rows, tip %s, ahead of copy by %s" % (e["rows"], e["tip_n"], e["ahead_of_copy_by"]))
        if "head" in rep:
            print("head: n %s, %s" % (rep["head"].get("n"), "matches" if rep["head"].get("matches") else "see findings"))
        print("findings: %d" % len(rep["findings"]))
        for f in rep["findings"]:
            print("  " + json.dumps(f, sort_keys=True))
    return 0 if rep["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
