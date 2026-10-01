"""Score a verifier against a2a-card-sign-v01: for each candidate reading, how many vectors it gets right and how many
signatures it accepts that the reading says to reject (false accepts).

  python3 score.py vectors/a2a-card-sign-v01 verdicts.json [more.json ...]

verdicts.json is {"name": "...", "verdicts": {"S0-001": true, "S1-002": false, ...}} where true means the verifier
accepted the served card. No dependencies, no code shared with the generator.

Readings: rule-1-served-scope and rule-1-descriptor-scope are the two scopes of section 8.4.1 rule 1. On s0 and s1
(every REQUIRED field present) both equal rule-1-as-written, so a vector there that lists rule-1-as-written counts
for both. prune-empty and served-as-is are as in the corpus README.

A verifier that accepts under more than one reading at once (a transition policy) is scored the same way. It cannot
be conformant to any single reading on this corpus, because every reading-dependent pair has one vector each reading
must reject. That is the point of scoring it: a transition policy has to be declared, it cannot be inferred from
conformance.
"""
import json, os, sys

READINGS = ["rule-1-served-scope", "rule-1-descriptor-scope", "prune-empty", "served-as-is"]


def expected(doc, reading):
    acc = set(doc["accept_under"])
    if "rule-1-as-written" in acc:
        acc |= {"rule-1-served-scope", "rule-1-descriptor-scope"}
    return reading in acc


def load(corpus):
    man = json.load(open(os.path.join(corpus, "MANIFEST.json")))
    return [json.load(open(os.path.join(corpus, v["path"]))) for v in man["vectors"]]


def score(docs, verdicts):
    out = {}
    for r in READINGS:
        right = fa = fr = n = 0
        for d in docs:
            if d["id"] not in verdicts:
                continue
            n += 1
            want, got = expected(d, r), bool(verdicts[d["id"]])
            right += want == got
            fa += got and not want
            fr += want and not got
        out[r] = {"right": right, "of": n, "false_accepts": fa, "false_rejects": fr}
    return out


def main():
    corpus, files = sys.argv[1], sys.argv[2:]
    docs = load(corpus)
    print("%-34s" % "verifier" + "".join("%-26s" % r for r in READINGS))
    for f in files:
        j = json.load(open(f))
        s = score(docs, j["verdicts"])
        print("%-34s" % j["name"][:33] + "".join("%-26s" % ("%d/%d fa=%d" % (s[r]["right"], s[r]["of"], s[r]["false_accepts"])) for r in READINGS))


if __name__ == "__main__":
    main()
