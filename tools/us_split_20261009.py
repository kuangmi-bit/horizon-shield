#!/usr/bin/env python3
"""Split the U.S. site off shield.the-horizons-innovation.com onto its own domain (2026-10-09).

TOshi: the Japanese and U.S. sites must not overlap. The U.S. site moves to https://horizonshield.dev/
(served by the worker workers/hs-us-site from workers/hs-us-site/public/, which GitHub Pages never
publishes because the Pages build removes workers/). The old /us/ pages on shield become forwarding
stubs (noindex, canonical to the new URL, immediate redirect that keeps the query and hash).

  python3 tools/us_split_20261009.py            # dry run: prints what it would write
  python3 tools/us_split_20261009.py --apply    # writes workers/hs-us-site/public/ and the stubs
  python3 tools/us_split_20261009.py --check    # verifies the new tree (links, leftovers)
"""
import argparse, html, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD_HOST = "shield.the-horizons-innovation.com"
NEW = "https://horizonshield.dev"
JP = f"https://{OLD_HOST}/"
DEST = os.path.join(ROOT, "workers", "hs-us-site", "public")
SRC = [("us", ""), ("assets/us", "assets")]
TEXT = (".html", ".css", ".json", ".js", ".txt", ".xml", ".svg", ".webmanifest")
SKIP = re.compile(r"\.(bak|orig)$|\.\d{8}[a-z]*\.bak$|\.bak\.|/\.DS_Store$")
STUB_MARK = "<!-- us-split-20261009: forwarding stub -->"


def rewrite(s):
    s = s.replace(f"https://{OLD_HOST}/us/", f"{NEW}/")
    s = s.replace(f"https://{OLD_HOST}/assets/us/", f"{NEW}/assets/")
    s = s.replace(f"https://{OLD_HOST}/llms.txt", f"{NEW}/llms.txt")
    s = s.replace(f"{OLD_HOST}%2Fus%2F", "horizonshield.dev%2F")
    s = s.replace(f"{OLD_HOST}/us", "horizonshield.dev")
    # The Japanese site is a different site now: no hreflang pairing with it.
    s = re.sub(r'\s*<link rel="alternate" hreflang="(ja|x-default)" href="https://shield\.the-horizons-innovation\.com/">', "", s)
    s = re.sub(r'<link rel="alternate" hreflang="x-default" href="(https://horizonshield\.dev/[^"]*)">', r'<link rel="alternate" hreflang="x-default" href="\1">', s)
    s = s.replace('<a href="/">日本語</a>', f'<a href="{JP}" lang="ja" hreflang="ja">日本語 (Japan site)</a>')
    s = s.replace(f'<a href="/">{OLD_HOST}</a>', f'<a href="/">horizonshield.dev</a>')
    # Root-relative paths: /us/... -> /..., /assets/us/... -> /assets/...
    s = s.replace("/assets/us/", "/assets/")
    s = re.sub(r'(["\'(\s,=])/us/', r"\1/", s)
    s = re.sub(r'(["\'])/us(["\'#?])', r"\1/\2", s)
    return s


def plan():
    out = []
    for src, dst in SRC:
        base = os.path.join(ROOT, src)
        for dp, dn, fn in os.walk(base):
            for f in fn:
                p = os.path.join(dp, f)
                rel = os.path.relpath(p, base)
                if SKIP.search(p):
                    continue
                out.append((p, os.path.join(DEST, dst, rel) if dst else os.path.join(DEST, rel), src, rel))
    return out


def stub(old_path, new_url, title, desc):
    t = html.escape(title or "HORIZON SHIELD US")
    d = html.escape(desc or "This page has moved to horizonshield.dev.")
    u = html.escape(new_url)
    return f"""<!doctype html>
{STUB_MARK}
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="{u}">
<meta property="og:type" content="website">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{u}">
<meta http-equiv="refresh" content="0; url={u}">
<script>try{{location.replace({new_url!r}+location.search+location.hash)}}catch(e){{}}</script>
<style>body{{margin:0;background:#fff;color:#0a0a0a;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}}main{{max-width:640px;margin:15vh auto;padding:0 16px}}a{{color:#4f3cf0}}</style>
</head>
<body><main><p>HORIZON SHIELD for the United States has moved.</p><p><a href="{u}">{u}</a></p></main></body>
</html>
"""


def meta(s, name):
    m = re.search(r'<title>([^<]*)</title>' if name == "title" else r'<meta name="description" content="([^"]*)"', s)
    return html.unescape(m.group(1)) if m else ""


def apply(dry):
    items = plan()
    n_text = n_bin = n_stub = 0
    for p, d, src, rel in items:
        if not dry:
            os.makedirs(os.path.dirname(d), exist_ok=True)
        if p.endswith(TEXT):
            s = open(p, encoding="utf-8").read()
            if STUB_MARK in s:
                continue  # already a stub (second run): the new tree keeps the copy from the first run
            if not dry:
                open(d, "w", encoding="utf-8").write(rewrite(s))
            n_text += 1
        else:
            if not dry:
                shutil.copy2(p, d)
            n_bin += 1
    # Stubs for every old HTML page under us/
    for dp, dn, fn in os.walk(os.path.join(ROOT, "us")):
        for f in fn:
            if f != "index.html":
                continue
            p = os.path.join(dp, f)
            s = open(p, encoding="utf-8").read()
            if STUB_MARK in s:
                continue
            rel = os.path.relpath(dp, os.path.join(ROOT, "us"))
            new_url = f"{NEW}/" if rel == "." else f"{NEW}/{rel}/"
            if not dry:
                open(p, "w", encoding="utf-8").write(stub(p, new_url, meta(s, "title"), meta(s, "description")))
            n_stub += 1
    print(f"{'dry run' if dry else 'applied'}: text {n_text}, binary {n_bin}, stubs {n_stub}, into {os.path.relpath(DEST, ROOT)}")


def check():
    bad = []
    files = set()
    for dp, dn, fn in os.walk(DEST):
        for f in fn:
            files.add("/" + os.path.relpath(os.path.join(dp, f), DEST).replace(os.sep, "/"))
    def exists(path):
        path = path.split("#")[0].split("?")[0]
        if not path or path == "/":
            return "/index.html" in files
        if path in files:
            return True
        if path.endswith("/") and (path + "index.html") in files:
            return True
        return (path.rstrip("/") + "/index.html") in files
    dash = 0
    for f in sorted(files):
        if not f.endswith(TEXT):
            continue
        s = open(DEST + f, encoding="utf-8").read()
        if "/us/" in s.replace("/us/chain", ""):
            for m in re.finditer(r".{0,40}/us/.{0,40}", s):
                if "jccdb" in m.group(0) or "census.gov" in m.group(0) or "bls.gov" in m.group(0):
                    continue
                bad.append(f"{f}: leftover /us/: {m.group(0)!r}")
                break
        if "/assets/us/" in s:
            bad.append(f"{f}: leftover /assets/us/")
        if OLD_HOST in s:
            for m in re.finditer(r".{0,30}" + re.escape(OLD_HOST) + r".{0,30}", s):
                if m.group(0).count(JP) and ("日本語" in m.group(0) or "lang=\"ja\"" in m.group(0)):
                    continue
                bad.append(f"{f}: mentions {OLD_HOST}: {m.group(0)!r}")
                break
        dash += sum(s.count(c) for c in "—–―")
        if f.endswith((".html", ".css")):
            for m in re.finditer(r'(?:href|src|action)="(/[^"]*)"', s):
                if not exists(m.group(1)):
                    bad.append(f"{f}: broken {m.group(1)}")
            for m in re.finditer(r'(?:srcset|imagesrcset)="([^"]*)"', s):
                for part in m.group(1).split(","):
                    u = part.strip().split(" ")[0]
                    if u.startswith("/") and not exists(u):
                        bad.append(f"{f}: broken srcset {u}")
            for m in re.finditer(r"url\((/[^)]+)\)", s):
                if not exists(m.group(1)):
                    bad.append(f"{f}: broken css url {m.group(1)}")
    print(f"files {len(files)}, dashes {dash}, problems {len(bad)}")
    for b in bad[:60]:
        print("  " + b)
    return not bad and dash == 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        sys.exit(0 if check() else 1)
    apply(dry=not a.apply)
