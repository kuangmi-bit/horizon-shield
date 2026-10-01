"""Run the Python agreement CLI and the JavaScript one on the same files and compare stdout and exit code, byte for byte.

    python3 agreement_cli_parity.py <sdk dir> <agreement-v0 dir> [--sample N] [--write-expected out.json]

Inputs: the two agreement records committed in agreement-v0 (with and without --quiet, with and without --now), two broken
files (bad JSON, a duplicate key), and N frozen cases from agreement_vectors_v1.json (every N-th, deterministic) with
their keys, recorder domain and now passed as flags. --write-expected stores, per input, the sha256 of the
Python command's stdout and its exit code (and, for frozen cases, the exact input bytes and flags), so the JavaScript
side can be checked later without Python (agreement.test.mjs reads it).
"""
import base64, hashlib, json, os, subprocess, sys, tempfile, zlib


def why_dropped(out):
    d = json.loads(out)
    for r in d.get("refusals", []):
        r.pop("why", None)
    return d


def run(cmd):
    p = subprocess.run(cmd, capture_output=True)
    return p.returncode, p.stdout


def main():
    sdk, agr = sys.argv[1], sys.argv[2]
    sample = int(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else 200
    offset = int(sys.argv[sys.argv.index("--offset") + 1]) if "--offset" in sys.argv else 0
    out_path = sys.argv[sys.argv.index("--write-expected") + 1] if "--write-expected" in sys.argv else None
    py = [sys.executable, os.path.join(agr, "agreement_verify.py")]
    js = ["node", os.path.join(sdk, "agreement_cli.mjs")]
    tmp = tempfile.mkdtemp()
    jobs = []
    for f in ("first_agreement_record.json", "second_record_A.json"):   # the agreement records committed in agreement-v0
        p = os.path.join(agr, f)
        jobs.append((f, [p]))
        jobs.append((f + " --quiet", [p, "--quiet"]))
        jobs.append((f + " --now", [p, "--now", "2030-01-01T00:00:00Z"]))
    bad = os.path.join(tmp, "bad.json"); open(bad, "w").write('{"schema": "a2a-agreement-v1.1", ')
    dup = os.path.join(tmp, "dup.json"); open(dup, "w").write('{"a": 1, "a": 2}')
    arr = os.path.join(tmp, "array.json"); open(arr, "w").write('[1, 2, 3]')
    jobs += [("bad_json", [bad]), ("duplicate_key", [dup]), ("top_level_array", [arr])]
    env = json.load(open(os.path.join(agr, "agreement_vectors_v1.json")))
    cases = json.loads(zlib.decompress(base64.b64decode(env["payload"])).decode("utf-8"))["cases"]
    step = max(1, len(cases) // sample)
    for i in range(offset, len(cases), step):
        c = cases[i]["input"]
        text = c["input_text"] if isinstance(c.get("input_text"), str) else json.dumps(c.get("record"), ensure_ascii=False)
        try:
            data = text.encode("utf-8")
        except UnicodeEncodeError:
            continue   # a lone surrogate cannot be a UTF-8 file; the library test covers these cases
        rp = os.path.join(tmp, "case%05d.json" % i)
        open(rp, "wb").write(data)
        args = [rp]
        if c.get("keys"):
            kp = os.path.join(tmp, "case%05d.keys.json" % i)
            json.dump(c["keys"], open(kp, "w"))
            args += ["--keys", kp]
        if c.get("recorder_domain"):
            args += ["--recorder-domain", c["recorder_domain"]]
        if c.get("now"):
            args += ["--now", c["now"]]
        jobs.append((("case %d" if isinstance(c.get("input_text"), str) else "case %d (from record)") % i, args))
    same, diff, expected = 0, [], {}
    for name, args in jobs:
        pc, po = run(py + args)
        jc, jo = run(js + args)
        if (pc, po) == (jc, jo):
            same += 1
        elif name == "bad_json" and pc == jc and why_dropped(po) == why_dropped(jo):
            same += 1   # the one documented difference: the text of the parse error
        else:
            diff.append((name, pc, jc, po[:300], jo[:300]))
        if name.startswith("case"):
            # agreement.test.mjs re-creates the input from these exact bytes, so the expectation needs no Python
            i = int(name.split()[1])
            c = cases[i]["input"]
            expected[name] = {"text": open(args[0], "rb").read().decode("utf-8"), "keys": c.get("keys") or None,
                              "flags": [a for a in args[1:] if not a.endswith(".keys.json")],
                              "exit": pc, "stdout_sha256": hashlib.sha256(po).hexdigest()}
            expected[name]["flags"] = [f for f in expected[name]["flags"] if f != "--keys"]
        else:
            expected[name] = {"args": [os.path.basename(a) if os.path.exists(a) else a for a in args],
                              "exit": pc, "stdout_sha256": hashlib.sha256(po).hexdigest()}
    print("same %d / %d" % (same, len(jobs)))
    for d in diff[:5]:
        print("DIFF", d[0], "exit py", d[1], "js", d[2]); print("  py:", d[3]); print("  js:", d[4])
    if out_path:
        json.dump({"note": "sha256 of the Python CLI's stdout per input; agreement.test.mjs checks the JS CLI against it",
                   "count": len(expected), "cases": expected}, open(out_path, "w"), indent=1, sort_keys=True)
    sys.exit(0 if not diff else 1)


if __name__ == "__main__":
    main()
