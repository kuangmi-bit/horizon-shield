"""MUSUBI (a2a-contract-v0): the repository's contract verifier, installed with the package, byte for byte.

MUSUBI is written in Python; the files in workers/hs-ledger/nenrin/musubi-v0 are the reference and there is no other
implementation to agree with. The package carries those files unchanged (src/nenrin_verify/_repo/musubi-v0, beside a
byte-identical copy of agreement-v0, the layout each module expects) so that nothing has to be cloned to recompute a
contract, a settlement or a spine. VENDORED.json pins every file to the sha256 of its source.

    musubi-verify --list                              the modules
    musubi-verify spine_verify --selftest             any module, with its own arguments, exactly as python3 <module>.py
    musubi-verify contract_v0 --verify contract.json
    musubi-verify --selftest                          every module's own self-test, lower layers first
    musubi-verify --selftest --no-reuse               the same, with every nested self-test run again
    musubi-verify --run0002                           recompute the first settled contract execution (run0002) offline

In Python:

    from nenrin_verify import musubi
    contract_v0 = musubi.load("contract_v0")         # the repository module itself
    report = contract_v0.verify_contract(record)

load() puts the two vendored directories at the front of sys.path, because that is how the modules find each other
(each imports its siblings by bare name, as in the repository). Modules not shipped: gen_anchor_compose_fixture.py
(needs opentimestamps, regenerates a fixture) and header_view_fetch.py (fetches headers over the network).
"""
import hashlib
import importlib
import json
import os
import re
import time
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_repo")
MUSUBI_DIR = os.path.join(ROOT, "musubi-v0")
AGREEMENT_DIR = os.path.join(ROOT, "agreement-v0")

RUN0002 = {
    "anchored": "b13a38692a9b170199d26618f52afe773c0c7d6a90eb73def2736a9abd9b0221",
    "settlement": "11c27fcfe18895cef09f9683136984a50ffdf2bea10f0d9a44566653f052243f",
}


def modules():
    return sorted(f[:-3] for f in os.listdir(MUSUBI_DIR) if f.endswith(".py"))


def path_of(name):
    if name not in modules():
        raise ValueError("no MUSUBI module named %r; try one of: %s" % (name, ", ".join(modules())))
    return os.path.join(MUSUBI_DIR, name + ".py")


def load(name):
    """Import one MUSUBI module from the vendored copy (the repository file, byte for byte)."""
    path_of(name)
    for d in (AGREEMENT_DIR, MUSUBI_DIR):
        if d not in sys.path:
            sys.path.insert(0, d)
    return importlib.import_module(name)


def run(name, args, **kw):
    """python3 <module>.py <args>, run from the vendored copy in a child process, as the README says to run it."""
    return subprocess.run([sys.executable, path_of(name)] + list(args), **kw)


# Most settle self-tests end by running the self-test of the layer below (v1.10 runs v1.9, which runs v1.8 and
# convergence_v0, and so on), so running every module one after another repeats the lower layers many times
# (pipavlo82, Issue #29, 2026-10-05: too slow to finish on Windows). selftest_all runs the modules lower layers first,
# keeps the exact result (exit code, stdout, stderr) of each one that passed, and a later nested call to the very same
# command, `python <that module> --selftest` from the vendored directory, gets that result back instead of a second
# run. Nothing in the repository's files is changed (three of them are fingerprinted by correction_v0). A failed
# module is never reused, any other command runs for real, and a module run on its own (`musubi-verify <module>
# --selftest`) still runs every layer under it.
_BOOT = r"""
import json, os, runpy, subprocess, sys
CACHE, HOME = os.environ.get("MUSUBI_SELFTEST_CACHE"), os.path.realpath(os.environ.get("MUSUBI_SELFTEST_HOME", ""))
_real = subprocess.run
def _run(cmd, *a, **k):
    try:
        if CACHE and isinstance(cmd, (list, tuple)) and len(cmd) == 3 and cmd[0] == sys.executable and cmd[2] == "--selftest":
            p = os.path.realpath(str(cmd[1]))
            f = os.path.join(CACHE, os.path.basename(p)[:-3] + ".json")
            if p.endswith(".py") and os.path.dirname(p) == HOME and os.path.exists(f):
                r = json.load(open(f, encoding="utf-8"))
                out, err = r["stdout"], r["stderr"]
                captured = k.get("capture_output") or k.get("stdout") is subprocess.PIPE
                if not captured:
                    sys.stdout.write(out); sys.stdout.flush(); out = err = None
                elif not (k.get("text") or k.get("universal_newlines") or k.get("encoding")):
                    out, err = out.encode("utf-8"), err.encode("utf-8")
                with open(os.path.join(CACHE, "reused.log"), "a", encoding="utf-8") as log:
                    log.write(os.path.basename(p) + "\n")
                return subprocess.CompletedProcess(list(cmd), r["returncode"], out, err)
    except Exception:
        pass
    return _real(cmd, *a, **k)
subprocess.run = _run
path = sys.argv[1]
sys.argv = [path] + sys.argv[2:]
sys.path.insert(0, os.path.dirname(path))
runpy.run_path(path, run_name="__main__")
"""


def _layer_order(names):
    """Modules with the ones they run as a nested self-test first (found as "<name>.py" in the source)."""
    deps = {}
    for n in names:
        src = open(path_of(n), encoding="utf-8").read()
        deps[n] = {m for m in names if m != n and re.search(r'["\']' + re.escape(m) + r'\.py["\']', src)}
    done, order = set(), []
    def visit(n, stack=()):
        if n in done or n in stack:
            return
        for m in sorted(deps[n]):
            visit(m, stack + (n,))
        done.add(n); order.append(n)
    for n in sorted(names):
        visit(n)
    return order


def selftest_all(out=sys.stdout, reuse=True):
    import tempfile
    ok = 0
    names = _layer_order(modules())
    t0 = time.time()
    with tempfile.TemporaryDirectory() as cache:
        env = dict(os.environ, MUSUBI_SELFTEST_CACHE=cache if reuse else "", MUSUBI_SELFTEST_HOME=MUSUBI_DIR)
        for name in names:
            p = subprocess.run([sys.executable, "-c", _BOOT, path_of(name), "--selftest"], capture_output=True, text=True, env=env)
            last = (p.stdout.strip().splitlines() or [""])[-1]
            good = p.returncode == 0 and ("PASSED" in last or "ALL PASS" in last)
            ok += good
            if good and reuse:
                with open(os.path.join(cache, name + ".json"), "w", encoding="utf-8") as f:
                    json.dump({"returncode": p.returncode, "stdout": p.stdout, "stderr": p.stderr}, f)
            out.write("%s  %-22s %s\n" % ("ok  " if good else "FAIL", name, last[:110]))
        log = os.path.join(cache, "reused.log")
        reused = len(open(log, encoding="utf-8").read().split()) if os.path.exists(log) else 0
    out.write("%d/%d MUSUBI modules pass their own self-test (%.0f s; %s)\n" % (
        ok, len(names), time.time() - t0,
        "%d nested self-tests answered with a result that passed earlier in this run" % reused if reuse else "every nested self-test run again"))
    return ok == len(names)


def recompute_run0002():
    """run0002/README.md, offline: compose the anchor and settle; both files must hash to the published values."""
    rd = os.path.join(MUSUBI_DIR, "run0002")
    with tempfile.TemporaryDirectory() as tmp:
        anch, sett = os.path.join(tmp, "anchored.json"), os.path.join(tmp, "settlement.json")
        a = run("anchor_compose", ["--record", "exec_19c44a79.json", "--batch", "entry63.raw", "--ots", "entry63.ots",
                                   "--contract", "../second_contract_AB.json", "--view", "view.json", "--out", anch],
                cwd=rd, capture_output=True, text=True)
        if a.returncode != 0:
            return {"ok": False, "why": "anchor_compose failed: " + (a.stderr or a.stdout)[-300:]}
        s = run("settle_v1_6", ["--settle", "../second_contract_AB.json", "--event", anch, "--view", "view.json",
                                "--nenrin", "walk_8bf29f1a.json", "--out", sett], cwd=rd, capture_output=True, text=True)
        if s.returncode != 0:
            return {"ok": False, "why": "settle_v1_6 failed: " + (s.stderr or s.stdout)[-300:]}
        got = {"anchored": hashlib.sha256(open(anch, "rb").read()).hexdigest(),
               "settlement": hashlib.sha256(open(sett, "rb").read()).hexdigest()}
    return {"ok": got == RUN0002, "got": got, "want": dict(RUN0002)}


USAGE = ("usage: musubi-verify <module> [arguments]   (as python3 <module>.py [arguments] in musubi-v0)\n"
         "       musubi-verify --list | --selftest [--no-reuse] | --run0002")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0 if argv else 2
    if argv[0] == "--list":
        print("\n".join(modules()))
        return 0
    if argv[0] == "--selftest":
        return 0 if selftest_all(reuse="--no-reuse" not in argv[1:]) else 1
    if argv[0] == "--run0002":
        r = recompute_run0002()
        if r["ok"]:
            print("run0002 recomputes: anchored %s, settlement %s (as published in run0002/README.md)" % (r["got"]["anchored"], r["got"]["settlement"]))
            return 0
        print("run0002 does not recompute: %s" % (r.get("why") or r), file=sys.stderr)
        return 1
    try:
        return run(argv[0], argv[1:]).returncode
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
