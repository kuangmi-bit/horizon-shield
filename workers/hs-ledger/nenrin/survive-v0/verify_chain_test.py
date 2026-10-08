#!/usr/bin/env python3
"""Offline tests for verify_chain.py. Builds small synthetic ledgers in a temporary directory, breaks one thing in
each, and checks that the finding names it. No network. When node is on PATH, one more case builds the export with
the ledger's own JavaScript (workers/hs-ledger/src/chain_v1.mjs) and checks that this verifier accepts it."""
import hashlib, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import verify_chain as V  # noqa: E402
from survive import CHAIN_ROOT, canon, chain_body, entry_sha, marker_sha  # noqa: E402

CHAIN_JS = os.path.normpath(os.path.join(HERE, "..", "..", "src", "chain_v1.mjs"))
PASS, FAIL = [], []


def sha(b):
    return hashlib.sha256(b).hexdigest()


def build(root, count=5, stamp_at=None, stamp_wrong=False):
    """A ledger copy with entries 1..count. If stamp_at is set, entry stamp_at is a checkpoint carrying the head of
    entries 1..stamp_at-1 inside its raw bytes, as the real nenrin-head-checkpoint-v1 entries do."""
    ld = os.path.join(root, "ledger")
    os.makedirs(ld)
    entries, prev = [], CHAIN_ROOT
    for n in range(1, count + 1):
        if stamp_at == n:
            h = prev if not stamp_wrong else "f" * 64
            raw = json.dumps({"schema": "nenrin-head-checkpoint-v1", "ledger_head": {"chain": "jidec-chain-v1", "n": n - 1,
                              "entry_sha256": h, "marker_sha256": marker_sha(n - 1, h)}}, sort_keys=True).encode("utf-8")
        else:
            raw = ("claim %d 外壁塗装" % n).encode("utf-8")
        e = {"n": n, "claim_sha256": sha(raw), "schema": "v0-plain", "created_at": "2026-10-0%dT00:00:00Z" % n,
             "record_canonical": raw.decode("utf-8"), "ots_status": "confirmed"}
        if n == 2:
            del e["schema"]          # an entry without a schema, as the earliest real entries are
        with open(os.path.join(ld, "%d.json" % n), "w", encoding="utf-8") as f:
            json.dump(e, f, ensure_ascii=False)
        with open(os.path.join(ld, "%d.raw" % n), "wb") as f:
            f.write(raw)
        prev = entry_sha(e, prev)
        entries.append(e)
    return entries


def export_lines(entries):
    """What GET /ledger/export.jsonl serves for these entries: one chain row each, then the bound head marker."""
    lines, prev = [], CHAIN_ROOT
    for e in entries:
        row = chain_body(e, prev)
        row["entry_sha256"] = entry_sha(e, prev)
        lines.append(row)
        prev = row["entry_sha256"]
    n = len(entries)
    lines.append({"schema": "jidec-head-v1", "n": n, "head": prev, "root": CHAIN_ROOT, "chain": "jidec-chain-v1",
                  "prev_entry_sha256": prev, "entry_sha256": marker_sha(n, prev)})
    return lines


def write_jsonl(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        for ln in lines:
            f.write(json.dumps(ln) + "\n")


def head_of(lines):
    return dict(lines[-1])


def case(name, fn):
    root = tempfile.mkdtemp(prefix="vc-")
    try:
        fn(root)
        PASS.append(name)
        print("  ok    " + name)
    except AssertionError as e:
        FAIL.append(name)
        print("  FAIL  %s: %s" % (name, e))
    finally:
        shutil.rmtree(root, ignore_errors=True)


def whats(rep):
    return sorted(set(f["what"] for f in rep["findings"]))


def setup(root, **kw):
    entries = build(os.path.join(root, "copy"), **kw)
    lines = export_lines(entries)
    ex, hd = os.path.join(root, "export.jsonl"), os.path.join(root, "head.json")
    write_jsonl(ex, lines)
    with open(hd, "w") as f:
        json.dump(head_of(lines), f)
    return entries, lines, os.path.join(root, "copy"), ex, hd


def t_valid(root):
    _, _, d, ex, hd = setup(root, stamp_at=4)
    rep = V.run(d, ex, hd)
    assert rep["ok"], whats(rep)
    assert rep["copy"]["stamped_heads_matched"] == 1, rep["copy"]
    assert rep["head"]["matches"] is True


def t_tampered_raw(root):
    _, _, d, ex, hd = setup(root)
    with open(os.path.join(d, "ledger", "3.raw"), "ab") as f:
        f.write(b" edited")
    rep = V.run(d, ex, hd)
    assert "raw_digest_mismatch" in whats(rep), whats(rep)


def t_tampered_entry_consistent(root):
    # the copy is edited consistently (new raw bytes and a matching claim_sha256), so it agrees with itself;
    # only the held head and the export, taken from the live ledger, can show it
    _, _, d, ex, hd = setup(root)
    raw = b"a different claim"
    p = os.path.join(d, "ledger", "3.json")
    e = json.load(open(p, encoding="utf-8"))
    e["claim_sha256"] = sha(raw)
    json.dump(e, open(p, "w", encoding="utf-8"))
    open(os.path.join(d, "ledger", "3.raw"), "wb").write(raw)
    rep = V.run(d, ex, hd)
    w = whats(rep)
    assert "raw_digest_mismatch" not in w, w
    assert "live_head_differs_from_copy" in w and "export_differs_from_copy" in w, w
    rep2 = V.run(d)          # without a held head, the copy alone cannot tell: say so by passing
    assert rep2["ok"], whats(rep2)


def t_missing_seq(root):
    _, _, d, ex, hd = setup(root)
    os.remove(os.path.join(d, "ledger", "3.json"))
    rep = V.run(d, ex, hd)
    w = whats(rep)
    assert "seq_gap" in w and "chain_broken" in w, w


def t_seq_mismatch(root):
    _, _, d, _, _ = setup(root)
    p = os.path.join(d, "ledger", "2.json")
    e = json.load(open(p, encoding="utf-8"))
    e["n"] = 7
    json.dump(e, open(p, "w", encoding="utf-8"))
    assert "seq_mismatch" in whats(V.run(d)), whats(V.run(d))


def t_broken_prev_link(root):
    _, lines, d, ex, hd = setup(root)
    lines[2]["prev_entry_sha256"] = "a" * 64
    write_jsonl(ex, lines)
    w = whats(V.run(d, ex, hd))
    assert "export_prev_link_broken" in w, w


def t_rehash_mismatch(root):
    _, lines, d, ex, hd = setup(root)
    lines[1]["entry_sha256"] = "b" * 64
    write_jsonl(ex, lines)
    w = whats(V.run(d, ex, hd))
    assert "export_entry_rehash_mismatch" in w, w


def t_export_gap(root):
    _, lines, d, ex, hd = setup(root)
    del lines[1]
    write_jsonl(ex, lines)
    w = whats(V.run(d, ex, hd))
    assert "export_seq_gap" in w, w


def t_marker_tampered(root):
    _, lines, d, ex, hd = setup(root)
    lines[-1]["entry_sha256"] = "c" * 64
    write_jsonl(ex, lines)
    w = whats(V.run(d, ex, hd))
    assert "export_marker_rehash_mismatch" in w, w


def t_truncated_export(root):
    entries, _, d, ex, hd = setup(root)
    short = export_lines(entries[:3])
    write_jsonl(ex, short)
    with open(hd, "w") as f:
        json.dump(head_of(short), f)
    w = whats(V.run(d, ex, hd))
    assert "export_shorter_than_copy" in w and "live_head_behind_copy" in w, w


def t_live_ahead(root):
    # the live ledger gained an entry after the copy was taken: fine when the export covers it, unverified otherwise
    root_live = os.path.join(root, "live")
    entries = build(root_live, count=6)
    d = os.path.join(root, "copy")
    os.makedirs(os.path.join(d, "ledger"))
    for n in range(1, 6):
        for ext in ("json", "raw"):
            shutil.copy(os.path.join(root_live, "ledger", "%d.%s" % (n, ext)), os.path.join(d, "ledger"))
    lines = export_lines(entries)
    ex, hd = os.path.join(root, "export.jsonl"), os.path.join(root, "head.json")
    write_jsonl(ex, lines)
    json.dump(head_of(lines), open(hd, "w"))
    rep = V.run(d, ex, hd)
    assert rep["ok"], whats(rep)
    assert rep["export"]["ahead_of_copy_by"] == 1
    assert "live_head_ahead_unverified" in whats(V.run(d, None, hd))


def t_stamped_head_wrong(root):
    _, _, d, _, _ = setup(root, stamp_at=4, stamp_wrong=True)
    w = whats(V.run(d))
    assert "stamped_head_entry_sha256_mismatch" in w, w


def t_head_error(root):
    _, _, d, ex, hd = setup(root)
    json.dump({"schema": "jidec-head-v1", "error": "chain_broken", "broken_at": 3}, open(hd, "w"))
    assert "live_head_reports_error" in whats(V.run(d, ex, hd))


def t_js_export(root):
    if not shutil.which("node") or not os.path.exists(CHAIN_JS):
        print("        (node or chain_v1.mjs not available; the JavaScript cross check was not run)")
        return
    entries, _, d, _, _ = setup(root)
    src = os.path.join(root, "entries.json")
    json.dump(entries, open(src, "w", encoding="utf-8"), ensure_ascii=False)
    js = ("import {walkChain, exportRow, boundHeadRecord} from %s;\n"
          "import {readFileSync} from 'node:fs';\n"
          "const es = JSON.parse(readFileSync(%s, 'utf8'));\n"
          "const lines = [];\n"
          "const w = await walkChain(async (n) => es[n - 1] || null, es.length, async (e, p, h) => { lines.push(JSON.stringify(exportRow(e, p, h))); });\n"
          "lines.push(JSON.stringify(await boundHeadRecord(w.n, w.head)));\n"
          "process.stdout.write(lines.join('\\n') + '\\n');\n") % (json.dumps("file://" + CHAIN_JS), json.dumps(src))
    jp = os.path.join(root, "mk.mjs")
    open(jp, "w").write(js)
    out = subprocess.run(["node", jp], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr[:400]
    ex = os.path.join(root, "export_js.jsonl")
    open(ex, "w", encoding="utf-8").write(out.stdout)
    hd = os.path.join(root, "head_js.json")
    open(hd, "w").write(out.stdout.strip().split("\n")[-1])
    rep = V.run(d, ex, hd)
    assert rep["ok"], whats(rep)


def main():
    print("verify_chain tests (offline)")
    for name, fn in [("valid ledger with one stamped checkpoint", t_valid),
                     ("tampered raw bytes", t_tampered_raw),
                     ("tampered entry rewritten consistently, caught by the held head and the export", t_tampered_entry_consistent),
                     ("missing sequence number", t_missing_seq),
                     ("entry file whose n disagrees with its name", t_seq_mismatch),
                     ("broken prev link in the export", t_broken_prev_link),
                     ("export row whose entry_sha256 does not re-hash", t_rehash_mismatch),
                     ("export with a missing row", t_export_gap),
                     ("export head marker edited", t_marker_tampered),
                     ("export and head shorter than the copy (truncation)", t_truncated_export),
                     ("live ledger one entry ahead of the copy", t_live_ahead),
                     ("stamped checkpoint head that disagrees with the copy", t_stamped_head_wrong),
                     ("live head reporting a broken chain", t_head_error),
                     ("export built by the ledger's own chain_v1.mjs", t_js_export)]:
        case(name, fn)
    print("%d passed, %d failed" % (len(PASS), len(FAIL)))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
