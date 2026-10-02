"""Add a pinned external candidate as its own column in MANIFEST.json `observed`, without regenerating any vector.

The candidate is installed from source at an exact commit in its own virtualenv, and this script runs inside that
virtualenv. It refuses to run if the installed source is not at the pinned commit. Each of the 37 served cards goes,
unmodified, to the candidate's verifier; the verdicts are written to observed.results (s0, s1), observed.s2.results and
observed.s3.results under the column name, the version line to observed.versions, and for each s3 case which reading
the candidate's canonical bytes equal (matched by sha256 against the forms already recorded) to s3_sdk_forms and s4_sdk_forms.

  /path/to/candidate-venv/bin/python observe_pinned.py aeoess-2491248          write
  /path/to/candidate-venv/bin/python observe_pinned.py aeoess-2491248 --check  recompute and compare, write nothing

No vector file changes, so every sha256 in MANIFEST.vectors stays valid.
"""
import copy, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "vectors", "a2a-card-sign-v01")

PINNED = {
    "aeoess-2491248": {
        "column": "aeoess/a2a-python@2491248",
        "commit": "2491248cf4435bb3125fd02f7bee077a2ca82fb7",
        "version": "aeoess/a2a-python branch candidate/served-scope-1278 at 2491248cf443 (2026-10-02), "
                   "create_served_card_signature_verifier on the served JSON; a candidate for a2aproject/A2A#2122, "
                   "not a release and not a PR",
        "source": "https://github.com/aeoess/a2a-python/tree/2491248cf4435bb3125fd02f7bee077a2ca82fb7",
    },
    "aeoess-5f9e52c": {
        "column": "aeoess/a2a-python@5f9e52c",
        "commit": "5f9e52c1005693104e9f41be9a2097f5b34e105c",
        "version": "aeoess/a2a-python branch candidate/served-scope-1278 at 5f9e52c (2026-10-02), create_served_card_signature_verifier on the served JSON, "
                   "refusing a field given under both its JSON name and its protobuf name; a candidate for a2aproject/A2A#2122, not a release and not a PR",
        "source": "https://github.com/aeoess/a2a-python/tree/5f9e52c1005693104e9f41be9a2097f5b34e105c",
    },
}


def run(pin):
    from jwt import PyJWK
    from a2a.utils import signing
    src = os.path.dirname(os.path.dirname(os.path.dirname(signing.__file__)))
    head = subprocess.run(["git", "-C", src, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", src, "status", "--porcelain", "--", "src"], capture_output=True, text=True).stdout.strip()
    if head != pin["commit"] or dirty:
        raise SystemExit("installed a2a source is %s%s, pinned %s" % (head, " (modified)" if dirty else "", pin["commit"]))
    jwks = json.load(open(os.path.join(CORPUS, "testkey_jwks.json")))

    def kp(kid, jku):
        for k in jwks["keys"]:
            if k["kid"] == kid:
                return PyJWK(k)
        raise ValueError("kid not in JWKS")

    verify = signing.create_served_card_signature_verifier(kp, ["ES256"])
    man = json.load(open(os.path.join(CORPUS, "MANIFEST.json")))
    verdicts, forms = {}, {}
    for v in man["vectors"]:
        d = json.load(open(os.path.join(CORPUS, v["path"])))
        card = d["served_card"]
        given = copy.deepcopy(card)
        try:
            verify(given)
            verdicts[d["id"]] = True
        except Exception:
            verdicts[d["id"]] = False
        if given != card:
            raise SystemExit("verifier changed its input on " + d["id"])
        table = {"unknown-fields": "s3_sdk_forms", "dual-name": "s4_sdk_forms"}.get(d.get("axis"))
        if table and table in man and d["case"] in man[table]["cases"] and (table, d["case"]) not in forms:
            try:
                b = signing.canonicalize_served_agent_card(copy.deepcopy(card)).encode()
                sha = hashlib.sha256(b).hexdigest()
                known = {e["sha256"]: e["equals"] for e in man[table]["cases"][d["case"]].values() if e.get("equals") not in ("neither", "refused") and "sha256" in e}
                forms[(table, d["case"])] = {"equals": known.get(sha, "neither"), "sha256": sha, "len": len(b)}
            except Exception as e:
                forms[(table, d["case"])] = {"equals": "refused", "error": type(e).__name__}
    return man, verdicts, forms


def apply(man, pin, verdicts, forms):
    col = pin["column"]
    obs = man["observed"]
    obs["versions"][col] = pin["version"]
    obs.setdefault("pinned", {})[col] = {"commit": pin["commit"], "source": pin["source"], "date": "2026-10-02",
                                        "added_by": "observe_pinned.py"}
    for vid, ok in verdicts.items():
        g = vid.split("-")[0]
        table = obs["results"] if g in ("S0", "S1") else obs[g.lower()]["results"]
        table[vid][col] = ok
    for (table, case), f in forms.items():
        man[table]["cases"][case][col] = f
    return man


def main():
    key = sys.argv[1]
    pin = PINNED[key]
    man, verdicts, forms = run(pin)
    path = os.path.join(CORPUS, "MANIFEST.json")
    want = json.dumps(apply(json.loads(json.dumps(man)), pin, verdicts, forms), indent=2, ensure_ascii=False) + "\n"
    out_dir = os.path.join(HERE, "verdicts_20261002")
    vpath = os.path.join(out_dir, key + ".json")
    vbody = json.dumps({"name": pin["column"], "commit": pin["commit"], "verdicts": verdicts}) + "\n"
    if "--check" in sys.argv:
        bad = [p for p, body in ((path, want), (vpath, vbody)) if not os.path.exists(p) or open(p).read() != body]
        print("check: " + ("FAIL " + ", ".join(bad) if bad else "MANIFEST and verdicts match the pinned run"))
        sys.exit(1 if bad else 0)
    # 既に列があれば、同じ固定で走らせ直して上書きする(新しい群が足された時のため)
    open(path, "w").write(want)
    os.makedirs(out_dir, exist_ok=True)
    open(vpath, "w").write(vbody)
    print("%s: %d accepted of %d" % (pin["column"], sum(verdicts.values()), len(verdicts)))
    print("forms: " + json.dumps({t + ":" + c: f["equals"] for (t, c), f in forms.items()}))


if __name__ == "__main__":
    main()
