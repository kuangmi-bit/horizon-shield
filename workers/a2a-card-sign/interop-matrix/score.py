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

Group s3 (vectors carrying "axis": "unknown-fields") asks a different question, what a signature covers when the card
carries fields outside the schema, and is scored in a second table against its own readings: unknown-retain,
unknown-exclude, unknown-reject. The first table counts only s0 to s2, so its numbers are the ones published before s3
existed. Verdict files without s3 ids print no second table.

Group s4 (vectors carrying "axis": "dual-name") is labelled against a proposed sentence, not against the specification:
dual-name-tolerate is the specification text at 173695755607, dual-name-refuse is the sentence proposed on
a2aproject/A2A#2122. It prints in a third table. Accepting a dual-name vector shows divergence from the proposal, not a
failure against the current text, so that column prints div= (divergences) instead of fa=.
"""
import json, os, sys

READINGS = ["rule-1-served-scope", "rule-1-descriptor-scope", "prune-empty", "served-as-is"]
S3_READINGS = ["unknown-retain", "unknown-exclude", "unknown-reject"]
S4_READINGS = ["dual-name-tolerate", "dual-name-refuse"]


def expected(doc, reading):
    acc = set(doc["accept_under"])
    if "rule-1-as-written" in acc:
        acc |= {"rule-1-served-scope", "rule-1-descriptor-scope"}
    return reading in acc


def load(corpus):
    man = json.load(open(os.path.join(corpus, "MANIFEST.json")))
    return [json.load(open(os.path.join(corpus, v["path"]))) for v in man["vectors"]]


def score(docs, verdicts, readings=READINGS):
    out = {}
    for r in readings:
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
    alldocs = load(corpus)
    tables = [(READINGS, [d for d in alldocs if "axis" not in d]),
              (S3_READINGS, [d for d in alldocs if d.get("axis") == "unknown-fields"]),
              (S4_READINGS, [d for d in alldocs if d.get("axis") == "dual-name"])]
    verdicts = [json.load(open(f)) for f in files]
    for n, (readings, docs) in enumerate(tables):
        rows = [(j["name"], score(docs, j["verdicts"], readings)) for j in verdicts]
        rows = [(name, s) for name, s in rows if s[readings[0]]["of"]]
        if not rows:
            continue
        if n:
            print()
        print("%-34s" % "verifier" + "".join("%-26s" % r for r in readings))
        for name, s in rows:
            # 提案に対する読み(dual-name-refuse)では、受理は誤りでなく提案との食い違い(div)として数える
            lab = lambda r: "div" if r == "dual-name-refuse" else "fa"
            print("%-34s" % name[:33] + "".join("%-26s" % ("%d/%d %s=%d" % (s[r]["right"], s[r]["of"], lab(r), s[r]["false_accepts"])) for r in readings))


if __name__ == "__main__":
    main()
