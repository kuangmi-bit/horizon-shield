#!/usr/bin/env python3
"""Add the Microsoft Clarity tag to the public content pages, right after the Cloudflare Web Analytics beacon.

Why: Clarity shows where visitors come from, including AI answer engines (chatgpt.com, copilot, perplexity, gemini),
so the citations we measure can be followed to actual visits on every engine, not only Bing.
Scope: only pages listed in sitemap.xml, sitemap-archive.xml and sitemap-yakumo.xml that already carry the Cloudflare
beacon. Pages with a form, an input, a textarea or a file upload are skipped, so nothing a visitor types is ever on a
recorded page. Set masking to Strict in the Clarity project settings as a second guard.
The tag is an explicit <script src> from www.clarity.ms (allowed by name in tools/pagecheck/validate.py), plus the
one-line queue stub Clarity documents. The 35 pages of the pre-registered experiment
experiments/title-intent-rct-v0 are never touched (the pre-registration forbids other edits to them). Idempotent: a page that has the marker is left alone.

  python3 tools/analytics/add_clarity.py --project <id>            dry run: counts and the skipped pages
  python3 tools/analytics/add_clarity.py --project <id> --apply    write
"""
import io, os, re, sys, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://shield.the-horizons-innovation.com"
ANCHOR = "<!-- End Cloudflare Web Analytics -->"
MARK = "<!-- Microsoft Clarity -->"
KNOWN_FAILING = {"/yakumo/store/", "/yakumo/apply/"}
INPUT_RE = re.compile(r"<form\b|<input\b|<textarea\b|type=[\"']file", re.I)


def tag(project):
    return (MARK + "<script>window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};</script>"
            "<script async src=\"https://www.clarity.ms/tag/%s\"></script><!-- End Microsoft Clarity -->" % project)


def local(p):
    f = urllib.parse.unquote(p).lstrip("/")
    return os.path.join(ROOT, "index.html" if f == "" else (f + "index.html" if f.endswith("/") else f))


def pages():
    out = []
    for name in ("sitemap.xml", "sitemap-archive.xml", "sitemap-yakumo.xml"):
        fp = os.path.join(ROOT, name)
        if os.path.exists(fp):
            out += re.findall(r"<loc>" + re.escape(SITE) + r"(.*?)</loc>", io.open(fp, encoding="utf-8").read())
    return sorted(set(out))


def main():
    a = sys.argv[1:]
    if "--project" not in a:
        sys.exit(__doc__)
    project = a[a.index("--project") + 1]
    if not re.fullmatch(r"[a-z0-9]{6,20}", project):
        sys.exit("project id looks wrong: %r" % project)
    apply = "--apply" in a
    rct = set()
    for exp in ("title-intent-rct-v0",):
        fp = os.path.join(ROOT, "experiments", exp, "pages.json")
        if os.path.exists(fp):
            import json
            rct |= {r["page"] for r in json.load(io.open(fp, encoding="utf-8"))["pages"]}
    add, have, no_beacon, skipped, missing = [], [], [], [], []
    for p in pages():
        if p in KNOWN_FAILING:
            skipped.append(p + "  (already fails pagecheck for other reasons; touching it would block the push)"); continue
        if p in rct:
            skipped.append(p + "  (pre-registered experiment page, not touched)"); continue
        f = local(p)
        if not os.path.exists(f):
            missing.append(p); continue
        h = io.open(f, encoding="utf-8").read()
        if MARK in h:
            have.append(p); continue
        if h.count(ANCHOR) != 1:
            no_beacon.append(p); continue
        if INPUT_RE.search(h):
            skipped.append(p); continue
        add.append(p)
        if apply:
            io.open(f, "w", encoding="utf-8").write(h.replace(ANCHOR, ANCHOR + tag(project), 1))
    print("%s: add %d, already %d, skipped (form, input or experiment page) %d, no single beacon %d, file missing %d" % (
        "applied" if apply else "dry run", len(add), len(have), len(skipped), len(no_beacon), len(missing)))
    for p in skipped:
        print("  skip %s" % p)
    for p in no_beacon[:20]:
        print("  no beacon    %s" % p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
