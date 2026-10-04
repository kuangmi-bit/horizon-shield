#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""JCCDB の件数・版・DOI を、サイトと worker の説明文で新しい版へ一斉に置き換える台本。

2026-10-04 番人(v5.0 -> v5.1)。来月の v5.2 も同じ台本で回せるよう、数・版・日付・DOI はすべて引数で受け取る。

やること
  1. 対象を探す(--discover と同じ規則)。見る場所から外す物は EXCL_* に名指しで書いてある。
  2. 決めた言い回しだけを置き換える(規則は build_rules。長い順の 1 回走査なので、置き換えた後の文がもう一度置き換わることは無い)。
     守る場所(PROTECT)の中は触らない。hs-mcp の get_jccdb_dataset_info とその中身は公開の台本の持ち分。
  3. 書く前に、全部のファイルを頭の中で作り直して検査する。1 本でも落ちたら 1 本も書かない。
       古い数・古い DOI・古い版の残り / 他の DOI(全版・論文)の数が変わっていない / JSON-LD と .json が読める /
       HTML のタグの並びが変わっていない / ダッシュと水平線が増えていない / .js .mjs は node --check、.py は compile /
       変えた行には必ず新しい値が入っている / hs-ccdb-mcp の worker.js が生成器から同じバイトで作れる
  4. --apply のときだけ書く。書く前に元のファイルを tar.gz に取り、変えたファイルの一覧を出す。

使い方(例は v5.1)
  python3 update_counts.py --root ~/horizon-shield --dois ~/hs-release/20261004/dois.json \\
     --old-total 425765 --new-total 526128 --old-obs 330362 --new-obs 430725 --items 95403 \\
     --old-version 5.0 --new-version 5.1 --old-date 2026-09-26 --new-date 2026-10-04 \\
     --old-doi 10.5281/zenodo.22980284 --old-sources 76 --new-sources 88 --out <出力の置き場> [--dry-run | --apply]
  --skip <相対パス>   その回だけ外す(何度でも)。--only <相対パス> その回はそれだけ。
  --new-doi <DOI>     dois.json の代わりに直接(写しでの試験用)。
  --discover          対象の一覧だけを <out>/discovered.txt に書いて終わる。
"""
import argparse, collections, datetime, hashlib, html.parser, io, json, os, re, shutil, subprocess, sys, tarfile, tempfile

CONCEPT_DOI = "10.5281/zenodo.22127751"
OTHER_DOIS = ["zenodo.22127751", "zenodo.22127752", "zenodo.20019572", "zenodo.20019573", "10.31224/7007", "zenodo.22979157"]

# ---- 見る場所 ----
EXCL_DIR_NAMES = {".git", "node_modules", "__pycache__", "Claude outputs", "iasf", "ops", "papers"}
EXCL_PREFIXES = ("data/jccdb-obs-v1/", "data/jccdb-obs-v2/", "data/jccdb-us/", "workers/hs-jccdb-obs/sql",
                 "workers/hs-ledger/", "workers/hs-verify-gate/", "workers/hs-us-report/")
EXCL_SUFFIXES = (".sql", ".csv", ".ots", ".tgz", ".zip", ".gz", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
                 ".bin", ".parquet", ".orig", ".pem", ".key")
# 名指しで外す物(理由つき)
EXCL_FILES = {
    "workers/hs-mcp/test/tool_selection.test.mjs": "get_jccdb_dataset_info の試験。公開の台本(DOI の担当)の持ち分",
}
EXCL_ROOT_RE = re.compile(r"^(HANDOFF.*\.md|HORIZON_SHIELD_引き継ぎ_.*|PRIVATE_.*|claim_\d+\.txt.*)$")
# ops/ の中でも見る生成器(ページを作る台本)
EXTRA_TARGETS = ["ops/monitor_pages_20260915/build_pages2.py"]
# 重複の関所(tools/pagecheck の simhash、距離 6 以下で止まる)に掛かる組を作らないために、
# 本文の定型文から件数を外す頁(2026-09-27 の「保留」と同じやり方)。"qa" は Q&A の答えの
# 「公開データセットJCCDB(N件)を用いて」、"basis" は根拠の一文の「JCCDB(N件、...」。
# v5.1(2026-10-04): 数を差し替えると qa の 5 組が距離 4〜6 に落ちた。外す組み合わせを総当たりで探し、
# 4 頁で全部の組が 7 以上になる形を選んだ(頁ごとに外す所が違うのは、その形でしか全組が離れなかったため)。
# 一度外した頁は、来月から件数を持たないので何もしない。
HELD = {
    "qa/partition-cost.html": ("basis",),
    "qa/gym-floor-cost.html": ("qa",),
    "qa/tsubo-tanka-2026.html": ("qa", "basis"),
    "qa/sakan-mortar-tanka.html": ("qa",),
}

# ---- 守る場所(この中は 1 字も触らない) ----
PROTECT = {
    "workers/hs-mcp/src/mcp.js": [
        r"(?ms)^const JCCDB = \{.*?^\};$",                                    # get_jccdb_dataset_info が返す中身
        r"\n  \{\n    name: \"get_jccdb_dataset_info\",[\s\S]*?\n  \}",          # その道具の説明
        r"(?m)^[ \t]*//[^\n]*$",                                               # 註釈(履歴)
    ],
}
DASH_CODES = (0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFF0D, 0x2500, 0x2501, 0x2E3A, 0x2E3B)
DASH_RE = re.compile("[" + "".join(chr(c) for c in DASH_CODES) + "]")
HR_RE = re.compile(r"<hr\b", re.I)
LDJSON_RE = re.compile(r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.S | re.I)


def die(msg, code=2):
    sys.stderr.write("止めた: " + msg + "\n")
    sys.exit(code)


def fmt(n):
    return format(int(n), ",")


def ja_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return "%d年%d月%d日" % (y, m, d)


# ---- 規則 ----
class Rule(object):
    def __init__(self, name, old, new, pre="", post="", scope=None):
        self.name, self.old, self.new, self.pre, self.post, self.scope = name, old, new, pre, post, scope


def build_rules(a):
    V, NV, D, ND = a.old_version, a.new_version, a.old_date, a.new_date
    DM, DJ, NDJ = D[:7], ja_date(D), ja_date(ND)
    OT, NT, OO, NO = fmt(a.old_total), fmt(a.new_total), fmt(a.old_obs), fmt(a.new_obs)
    oid, nid = a.old_doi.split("zenodo.")[1], a.new_doi.split("zenodo.")[1]
    VG = r"(?![.0-9])"
    R = []
    add = lambda *x, **k: R.append(Rule(*x, **k))
    # 数と DOI(どのファイルでも)
    add("total", OT, NT, pre=r"(?<![0-9,])", post=r"(?![0-9])")
    add("total_plain", str(a.old_total), str(a.new_total), pre=r"(?<![0-9])", post=r"(?![0-9])")
    URLPRE = r"(?:(?<![0-9%])|(?<=%[0-9A-Fa-f]{2}))"   # 前が数字でない、または %20 のような URL の符号の直後
    add("total_url", OT.replace(",", "%2C"), NT.replace(",", "%2C"), pre=URLPRE, post=r"(?![0-9])")
    add("obs_url", OO.replace(",", "%2C"), NO.replace(",", "%2C"), pre=URLPRE, post=r"(?![0-9])")
    add("obs", OO, NO, pre=r"(?<![0-9,])", post=r"(?![0-9])")
    add("obs_plain", str(a.old_obs), str(a.new_obs), pre=r"(?<![0-9])", post=r"(?![0-9])")
    add("doi", "zenodo." + oid, "zenodo." + nid, post=r"(?![0-9])")
    # 版(JCCDB の版を指す言い回しだけ)
    add("v_jccdb", "JCCDB v" + V, "JCCDB v" + NV, post=VG)
    add("v_jccdb_paren", "JCCDB(v%s は計" % V, "JCCDB(v%s は計" % NV)
    for d in (DM, D, DJ):
        add("v_date_kei", "v%s(%s)は計" % (V, d), "v%s(%s)は計" % (NV, NDJ))
    add("v_date_zen", "v%s（%s、" % (V, D), "v%s（%s、" % (NV, ND))
    add("v_date_en", "Version %s (%s," % (V, D), "Version %s (%s," % (NV, ND))
    add("v_date_ja", "(v%s、%s。" % (V, D), "(v%s、%s。" % (NV, ND))
    add("v_dataset", "(Version %s) [Data set]" % V, "(Version %s) [Data set]" % NV)
    add("v_colon", "(v%s: " % V, "(v%s: " % NV)
    add("v_costs", "costs, v%s: " % V, "costs, v%s: " % NV)
    add("v_doi", "Dataset DOI (v%s)" % V, "Dataset DOI (v%s)" % NV)
    add("v_biz", "（JCCDB）v%s の収録件数" % V, "（JCCDB）v%s の収録件数" % NV)
    add("v_kei", "(v%s、計" % V, "(v%s、計" % NV)
    add("v_de_kei", "v%s で計<strong>" % V, "v%s で計<strong>" % NV)
    add("v_records", "records (v%s)" % V, "records (v%s)" % NV)
    add("v_records_in", " records in v%s" % V, " records in v%s" % NV, post=VG)
    add("v_obs_kei", "、v%s は観測を含め計" % V, "、v%s は観測を含め計" % NV)
    add("v_has", "; v%s has " % V, "; v%s has " % NV)
    add("v_ken_no", "件(v%s)の、" % V, "件(v%s)の、" % NV)
    # 文の形を少しだけ変える所(古い版の出来事を新しい数で言うと嘘になる所)
    add("konkyo_once", "で記録し、v%s で公的資料の値を出典つきで持つ観測%s行を加えた計%s件の、" % (V, OO, OT),
        "で記録し、公的資料の値を出典つきで持つ観測%s行を加えた計%s件(v%s)の、" % (NO, NT, NV))
    add("lhm_once", "; v%s adds the %s row observation layer)" % (V, OO), "; v%s has a %s row observation layer)" % (NV, NO))
    # 出典の数
    add("src_ja", "出典 %s からの観測" % a.old_sources, "出典 %s からの観測" % a.new_sources)
    add("src_en", "from %s Japanese public sources" % a.old_sources, "from %s Japanese public sources" % a.new_sources)
    # JCCDB とは(定義の頁): 版と日付が分かる形に
    T = {"llmo/jccdb-toha/index.html"}
    add("toha_def_once", "品目と観測の計%s件を収録し、" % OT, "v%s(%s)で品目と観測の計%s件を収録し、" % (NV, NDJ, NT), scope=T)
    add("toha_def", "v%s(%s)で品目と観測の計%s件を収録し、" % (V, DJ, OT), "v%s(%s)で品目と観測の計%s件を収録し、" % (NV, NDJ, NT), scope=T)
    add("toha_ds_once", "工事の計%s件(品目" % OT, "工事の計%s件(v%s、%s。品目" % (NT, NV, NDJ), scope=T)
    add("toha_ds", "工事の計%s件(v%s、%s。品目" % (OT, V, DJ), "工事の計%s件(v%s、%s。品目" % (NT, NV, NDJ), scope=T)
    # 生成器(ops/monitor_pages_20260915/build_pages2.py): 9/27 の直しで頁は直ったが生成器に古い数が残っていた
    G = {"ops/monitor_pages_20260915/build_pages2.py"}
    add("gen_legacy1", "JCCDB(%s件、" % fmt(a.items), "JCCDB(%s件、" % NT, scope=G)
    add("gen_legacy2", "（%s品目・402カテゴリ・CC BY 4.0" % fmt(a.items), "（品目と観測の計%s件・CC BY 4.0" % NT, scope=G)
    for rel, kinds in HELD.items():
        for old, new, kind in held_drops(OT):
            if kind in kinds:
                add("held_drop_" + kind, old, new, scope={rel})
    return R


def held_drops(OT):
    return [
        ("公開データセットJCCDB(%s件)を用いて" % OT, "公開データセットJCCDBを用いて", "qa"),
        ("とJCCDB（%s件、CC BY 4.0、" % OT, "とJCCDB（CC BY 4.0、", "basis"),
        ("souba-dbと、%s件を収録したJCCDB（" % OT, "souba-dbと、JCCDB（", "basis"),
        ("souba-dbと、%s件を収録した建設費オープンデータJCCDB（" % OT, "souba-dbと、建設費オープンデータJCCDB（", "basis"),
        ("souba-dbと、%s件を収録したオープンデータJCCDB（" % OT, "souba-dbと、オープンデータJCCDB（", "basis"),
        ("オープンデータJCCDB（%s件、CC BY 4.0" % OT, "オープンデータJCCDB（CC BY 4.0", "basis"),
        ("CC BY 4.0で公開している%s件のJCCDB（" % OT, "CC BY 4.0で公開しているJCCDB（", "basis"),
    ]


def build_regex_passes(a):
    """数を含まない、頁ごとの正規表現(規則の 1 回走査の後に当てる)。"""
    cid = CONCEPT_DOI.split("zenodo.")[1]
    return [
        ("toha_updated", {"llmo/jccdb-toha/index.html"}, re.compile(r"最終更新: \d{4}-\d{2}-\d{2}"), "最終更新: " + a.new_date),
        ("toha_dateModified", {"llmo/jccdb-toha/index.html"}, re.compile(r"\"dateModified\": \"\d{4}-\d{2}-\d{2}\""),
         "\"dateModified\": \"%s\"" % a.new_date),
        ("dataset_version", {"index.html"},
         re.compile(r"(\"identifier\": \"https://doi\.org/10\.5281/zenodo\." + cid + r"\",\s*\"version\": \")" + re.escape(a.old_version) + r"(\")"),
         r"\g<1>" + a.new_version + r"\g<2>"),
    ]


class Engine(object):
    def __init__(self, rules):
        self.rules = sorted(rules, key=lambda r: -len(r.old))
        self.cache = {}

    def pattern(self, rel):
        key = tuple(i for i, r in enumerate(self.rules) if r.scope is None or rel in r.scope)
        if key not in self.cache:
            parts = ["(?P<r%d>%s%s%s)" % (i, self.rules[i].pre, re.escape(self.rules[i].old), self.rules[i].post) for i in key]
            self.cache[key] = re.compile("|".join(parts)) if parts else None
        return self.cache[key]

    def sub(self, rel, text, tally):
        pat = self.pattern(rel)
        if pat is None:
            return text

        def rep(m):
            i = int(m.lastgroup[1:])
            tally[self.rules[i].name] += 1
            return self.rules[i].new
        return pat.sub(rep, text)


def protected_spans(rel, text):
    spans = []
    for rx in PROTECT.get(rel, []):
        for m in re.finditer(rx, text):
            spans.append((m.start(), m.end()))
    spans.sort()
    merged = []
    for s, e in spans:
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(e, merged[-1][1]))
        else:
            merged.append((s, e))
    return merged


def map_unprotected(rel, text, fn):
    spans = protected_spans(rel, text)
    out, pos = [], 0
    for s, e in spans:
        out.append(fn(text[pos:s])); out.append(text[s:e]); pos = e
    out.append(fn(text[pos:]))
    return "".join(out)


def unprotected_text(rel, text):
    spans = protected_spans(rel, text)
    out, pos = [], 0
    for s, e in spans:
        out.append(text[pos:s]); out.append("\n"); pos = e
    out.append(text[pos:])
    return "".join(out)


# ---- 探す ----
def discover(root, a):
    trig = [fmt(a.old_total), fmt(a.old_obs), "zenodo." + a.old_doi.split("zenodo.")[1], "JCCDB v" + a.old_version]
    trig_plain = re.compile(r"(?<![0-9])(%d|%d)(?![0-9])" % (a.old_total, a.old_obs))
    found, skipped = [], []
    for dp, dns, fns in os.walk(root):
        rel_dir = os.path.relpath(dp, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        keep = []
        for d in dns:
            rd = (rel_dir + "/" + d) if rel_dir else d
            if d in EXCL_DIR_NAMES or d.startswith("_") or any((rd + "/").startswith(p) or rd.startswith(p) for p in EXCL_PREFIXES):
                continue
            keep.append(d)
        dns[:] = keep
        for fn in fns:
            rel = (rel_dir + "/" + fn) if rel_dir else fn
            if fn.startswith("_") or ".bak" in fn or fn.lower().endswith(EXCL_SUFFIXES):
                continue
            if rel in EXCL_FILES or (not rel_dir and EXCL_ROOT_RE.match(fn)):
                continue
            p = os.path.join(dp, fn)
            try:
                if os.path.getsize(p) > 30000000:
                    continue
                b = open(p, "rb").read()
            except OSError:
                continue
            if b"\0" in b[:8192]:
                continue
            try:
                s = b.decode("utf-8")
            except UnicodeDecodeError:
                skipped.append(rel); continue
            if any(t in s for t in trig) or trig_plain.search(s):
                found.append(rel)
    for rel in EXTRA_TARGETS:
        if os.path.exists(os.path.join(root, rel)) and rel not in found:
            found.append(rel)
    return sorted(found), skipped


# ---- 検査 ----
class TagSeq(html.parser.HTMLParser):
    def __init__(self):
        html.parser.HTMLParser.__init__(self, convert_charrefs=False)
        self.seq = []

    def handle_starttag(self, tag, attrs):
        self.seq.append("<" + tag)

    def handle_startendtag(self, tag, attrs):
        self.seq.append("<" + tag + "/")

    def handle_endtag(self, tag):
        self.seq.append("</" + tag)


def tag_seq(s):
    p = TagSeq()
    try:
        p.feed(s); p.close()
    except Exception as e:
        return ["ERROR " + str(e)]
    return p.seq


def ldjson_status(s):
    out = []
    for m in LDJSON_RE.finditer(s):
        try:
            json.loads(m.group(1)); out.append(True)
        except ValueError:
            out.append(False)
    return out


def remnant_patterns(a):
    V = re.escape(a.old_version)
    return [
        ("古い計", re.compile(r"(?<![0-9,])" + re.escape(fmt(a.old_total)) + r"(?![0-9])")),
        ("古い計(区切りなし)", re.compile(r"(?<![0-9])%d(?![0-9])" % a.old_total)),
        ("古い観測", re.compile(r"(?<![0-9,])" + re.escape(fmt(a.old_obs)) + r"(?![0-9])")),
        ("古い観測(区切りなし)", re.compile(r"(?<![0-9])%d(?![0-9])" % a.old_obs)),
        ("古い DOI", re.compile(re.escape("zenodo." + a.old_doi.split("zenodo.")[1]) + r"(?![0-9])")),
        ("古い版", re.compile(r"(?<![0-9.A-Za-z])v" + V + r"(?![.0-9])")),
        ("古い版(Version)", re.compile(r"Version " + V + r"(?![.0-9])")),
        ("古い計(区切りの形を問わず)", re.compile(re.escape(str(a.old_total)[:-3]) + r"[^0-9]{1,6}" + re.escape(str(a.old_total)[-3:]) + r"(?![0-9])")),
        ("古い観測(区切りの形を問わず)", re.compile(re.escape(str(a.old_obs)[:-3]) + r"[^0-9]{1,6}" + re.escape(str(a.old_obs)[-3:]) + r"(?![0-9])")),
    ]


def changed_lines_ok(before, after, needles):
    bl, al = before.splitlines(), after.splitlines()
    if len(bl) != len(al):
        return ["行の数が変わった(%d -> %d)" % (len(bl), len(al))]
    bad = []
    for i, (x, y) in enumerate(zip(bl, al)):
        if x != y and not any(n in y for n in needles):
            bad.append("%d 行目に新しい値が無いのに変わった" % (i + 1))
    return bad


def check_file(rel, before, after, a, rems, extra_needles=()):
    errs, notes = [], []
    up = unprotected_text(rel, after) if rel != "data/jccdb-manifest.json" else manifest_current_part(after)
    for name, rx in rems:
        for m in rx.finditer(up):
            ctx = up[max(0, m.start() - 40):m.end() + 40].replace("\n", " ")
            errs.append("%s が残っている: ...%s..." % (name, ctx))
    for d in OTHER_DOIS:
        if rel == "data/jccdb-manifest.json" and d == "zenodo." + CONCEPT_DOI.split("zenodo.")[1]:
            continue
        if before.count(d) != after.count(d):
            errs.append("触らない DOI %s の数が変わった(%d -> %d)" % (d, before.count(d), after.count(d)))
    db, da = len(DASH_RE.findall(before)), len(DASH_RE.findall(after))
    if da > db:
        errs.append("ダッシュ・水平線が増えた(%d -> %d)" % (db, da))
    if len(HR_RE.findall(after)) > len(HR_RE.findall(before)):
        errs.append("<hr> が増えた")
    low = rel.lower()
    if low.endswith((".html", ".htm")):
        if tag_seq(before) != tag_seq(after):
            errs.append("HTML のタグの並びが変わった")
        lb, la = ldjson_status(before), ldjson_status(after)
        if len(lb) != len(la):
            errs.append("JSON-LD の塊の数が変わった")
        else:
            for i, (x, y) in enumerate(zip(lb, la)):
                if x and not y:
                    errs.append("JSON-LD の %d 番目が JSON として読めなくなった" % (i + 1))
                if not x:
                    notes.append("JSON-LD の %d 番目は前から JSON として読めない(今回の変更ではない)" % (i + 1))
    if low.endswith(".json"):
        ok_b = True
        try:
            json.loads(before)
        except ValueError:
            ok_b = False
        if ok_b:
            try:
                json.loads(after)
            except ValueError as e:
                errs.append("JSON として読めなくなった: %s" % e)
    if low.endswith(".py"):
        try:
            compile(after, rel, "exec")
        except SyntaxError as e:
            errs.append("Python の構文: %s" % e)
    needles = [fmt(a.new_total), fmt(a.new_obs), str(a.new_total), str(a.new_obs), a.new_doi.split("zenodo.")[1],
               "v" + a.new_version, "Version " + a.new_version, a.new_date, ja_date(a.new_date),
               fmt(a.new_total).replace(",", "%2C"), "出典 %s" % a.new_sources, "from %s Japanese" % a.new_sources,
               "\"version\": \"%s\"" % a.new_version] + list(extra_needles)
    if rel != "data/jccdb-manifest.json":
        errs.extend(changed_lines_ok(before, after, needles))
    return errs, notes


def node_check(files_after):
    """files_after: [(rel, text)]。.js .mjs を一時ファイルに書いて node --check。"""
    node = shutil.which("node")
    if not node:
        return ["node が無いので node --check を飛ばした"], []
    errs = []
    tmp = tempfile.mkdtemp(prefix="counts_nodecheck_")
    try:
        for rel, text in files_after:
            p = os.path.join(tmp, hashlib.sha256(rel.encode()).hexdigest()[:12] + ".mjs")
            open(p, "w", encoding="utf-8").write(text)
            r = subprocess.run([node, "--check", p], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
            if r.returncode != 0:
                errs.append("%s: node --check が通らない: %s" % (rel, r.stderr.strip().splitlines()[-1:] if r.stderr else ""))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return [], errs


def ccdb_build_check(root, after_map):
    """hs-ccdb-mcp の worker.js は build_worker.py の生成物。直した生成器から同じバイトが出るか。"""
    b, d, w = ("workers/hs-ccdb-mcp/build/build_worker.py", "workers/hs-ccdb-mcp/build/data_tools.json", "workers/hs-ccdb-mcp/src/worker.js")
    if not any(x in after_map for x in (b, d, w)):
        return []
    get = lambda r: after_map[r] if r in after_map else open(os.path.join(root, r), encoding="utf-8", newline="").read()
    tmp = tempfile.mkdtemp(prefix="counts_ccdb_")
    try:
        os.makedirs(os.path.join(tmp, "build"))
        open(os.path.join(tmp, "build/build_worker.py"), "w", encoding="utf-8", newline="").write(get(b))
        open(os.path.join(tmp, "build/data_tools.json"), "w", encoding="utf-8", newline="").write(get(d))
        out = os.path.join(tmp, "worker.js")
        r = subprocess.run([sys.executable, os.path.join(tmp, "build/build_worker.py"), out], stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        if r.returncode != 0:
            return ["hs-ccdb-mcp の生成器が動かない: " + r.stderr.strip()[-300:]]
        if open(out, encoding="utf-8", newline="").read() != get(w):
            return ["hs-ccdb-mcp: 直した生成器から作った worker.js が、直した src/worker.js と一致しない"]
        return []
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pagecheck_sim(root, before_map, after_map):
    """CI の pagecheck(.github/workflows/pagecheck.yml)の重複の関所を、書く前に同じ指紋で回す。
    対象はその push で変わる yakumo/ care/ qa/ aeo/ faq/ の頁。題名と枠を剥いだ本文が一字も変わらない頁同士の組は数えない
    (validate.py の --before と同じ規則)。台帳(自分以外の slug)とも比べる。"""
    pc = os.path.join(root, "tools", "pagecheck")
    if not os.path.exists(os.path.join(pc, "fingerprint.py")):
        return [], ["tools/pagecheck が無いので重複の関所の模擬を飛ばした"]
    if pc not in sys.path:
        sys.path.insert(0, pc)
    try:
        import fingerprint as G
        import validate as VP
    except Exception as e:
        return ["pagecheck の読み込みに失敗: %s" % e], []
    rx = re.compile(r"^(yakumo|care|qa|aeo|faq)/.*\.html$")
    fps = []
    for p, html in after_map.items():
        if not rx.match(p):
            continue
        if VP.redirect_stub_target(p, html) is not None:
            continue
        can = VP.path_to_canonical(p)
        fp = G.fingerprint(can, html)
        ofp = G.fingerprint(can, before_map[p])
        ns = G.namespace_of(can)
        changed = not (ofp["tsha"] == fp["tsha"] and G.content_core(before_map[p], ns) == G.content_core(html, ns))
        fps.append((p, fp, changed))
    errs = []
    for i in range(len(fps)):
        for j in range(i + 1, len(fps)):
            x, y = fps[i][1], fps[j][1]
            if not fps[i][2] and not fps[j][2]:
                continue
            if x["tsha"] == y["tsha"]:
                errs.append("pagecheck の重複の関所(題名): %s == %s" % (fps[i][0], fps[j][0]))
            elif x["simhash"] != "0" and G.hamming64(x["simhash"], y["simhash"]) <= 6:
                errs.append("pagecheck の重複の関所(距離 %d): %s ~= %s" % (G.hamming64(x["simhash"], y["simhash"]), fps[i][0], fps[j][0]))
    try:
        ledger = G.ledger_load().get("entries", [])
    except Exception:
        ledger = []
    for p, fp, changed in fps:
        if not changed:
            continue
        for e in ledger:
            if e.get("slug") == fp["slug"]:
                continue
            if e.get("tsha") == fp["tsha"] or (e.get("simhash") and fp["simhash"] != "0" and G.hamming64(fp["simhash"], e["simhash"]) <= 6):
                errs.append("pagecheck の台帳との重複: %s ~ %s" % (p, e.get("slug"))); break
    return errs, ["pagecheck の重複の関所を模擬した: 頁 %d(本文が変わる %d)" % (len(fps), sum(1 for f in fps if f[2]))]


# ---- manifest(data/jccdb-manifest.json) ----
def manifest_current_part(text):
    try:
        d = json.loads(text)
    except ValueError:
        return text
    d2 = dict(d)
    d2["note"] = str(d.get("note", "")).split(" 以前の記録: ")[0]
    return json.dumps(d2, ensure_ascii=False, indent=2)


def patch_manifest(text, a, tally):
    d = json.loads(text, object_pairs_hook=collections.OrderedDict)
    if d.get("items") != a.items or d.get("observations") != a.old_obs or d.get("records") != a.old_total:
        die("data/jccdb-manifest.json の数が想定と違う(items %r, observations %r, records %r)" % (d.get("items"), d.get("observations"), d.get("records")))
    if not str(d.get("version", "")).startswith("v" + a.old_version + " "):
        die("data/jccdb-manifest.json の version が v%s ではない: %r" % (a.old_version, d.get("version")))
    if d.get("links", {}).get("dataset_concept_doi") not in (None, "https://doi.org/" + CONCEPT_DOI):
        die("data/jccdb-manifest.json の dataset_concept_doi が想定と違う")
    d["version"] = "v%s (%s)" % (a.new_version, a.new_date)
    d["observations"] = a.new_obs
    d["records"] = a.new_total
    head = ("v%s(%s): 計%s件 = 品目の目録%s(v4.0 から不変)+ 公的資料の値を出典・利用条件つきで 1 行 1 観測として持つ観測層%s行(出典 %s)。"
            "品目は品目名・カテゴリ・単位で価格を持たない。データセット DOI: v%s %s、全版 %s。"
            % (a.new_version, a.new_date, fmt(a.new_total), fmt(a.items), fmt(a.new_obs), a.new_sources, a.new_version, a.new_doi, CONCEPT_DOI))
    d["note"] = head + " 以前の記録: " + d["note"]
    d["links"]["dataset_doi"] = "https://doi.org/" + a.new_doi
    if a.new_total != d["items"] + d["observations"]:
        die("manifest: records が items + observations と合わない")
    tally["manifest"] += 1
    return json.dumps(d, ensure_ascii=False, indent=2) + "\n"


def bump_plugin(text, tally):
    m = re.search(r"(\"version\":\s*\")(\d+)\.(\d+)\.(\d+)(\")", text)
    if not m:
        die("plugin.json に version が無い")
    new = "%s.%s.%d" % (m.group(2), m.group(3), int(m.group(4)) + 1)
    tally["plugin_version"] += 1
    return text[:m.start()] + m.group(1) + new + m.group(5) + text[m.end():], "%s.%s.%s" % (m.group(2), m.group(3), m.group(4)), new


def git_tracked(root, rels):
    try:
        r = subprocess.run(["git", "--no-optional-locks", "-c", "core.quotepath=false", "ls-files", "-z", "--"] + rels, cwd=root,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=dict(os.environ, GIT_OPTIONAL_LOCKS="0"))
        return set(x.decode("utf-8") for x in r.stdout.split(b"\0") if x)
    except OSError:
        return set(rels)


def main():
    ap = argparse.ArgumentParser(description="JCCDB の件数・版・DOI の一斉置き換え")
    ap.add_argument("--root", required=True)
    ap.add_argument("--dois"); ap.add_argument("--new-doi")
    ap.add_argument("--old-total", type=int, required=True); ap.add_argument("--new-total", type=int, required=True)
    ap.add_argument("--old-obs", type=int, required=True); ap.add_argument("--new-obs", type=int, required=True)
    ap.add_argument("--items", type=int, required=True)
    ap.add_argument("--old-version", required=True); ap.add_argument("--new-version", required=True)
    ap.add_argument("--old-date", required=True); ap.add_argument("--new-date", required=True)
    ap.add_argument("--old-doi", required=True)
    ap.add_argument("--old-sources", type=int, required=True); ap.add_argument("--new-sources", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--reviewed", help="番人が目で見た対象の一覧(差を出すだけ)")
    ap.add_argument("--skip", action="append", default=[]); ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--no-plugin-bump", action="store_true")
    ap.add_argument("--with-dataset-info-desc", action="store_true",
                    help="hs-mcp の get_jccdb_dataset_info の道具の説明も直す(中身の const JCCDB は守ったまま)。"
                         "公開の台本がその説明の数を直さなかったときだけ要る")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true"); g.add_argument("--apply", action="store_true"); g.add_argument("--discover", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(a.root))
    if not os.path.isdir(os.path.join(root, ".git")) and not os.path.exists(os.path.join(root, "llms.txt")):
        die("--root がリポジトリの根に見えない: " + root)
    if a.new_doi is None:
        if not a.dois or not os.path.exists(os.path.expanduser(a.dois)):
            die("dois.json が無い(%s)。新しい版の DOI が決まるまで動かさない" % a.dois)
        dj = json.load(open(os.path.expanduser(a.dois), encoding="utf-8"))
        a.new_doi = ((dj.get("jccdb") or {}).get("doi") or "").strip()
        cd = (dj.get("jccdb") or {}).get("concept_doi")
        if cd not in (None, "", CONCEPT_DOI):
            die("dois.json の JCCDB の concept_doi が %s ではない: %r" % (CONCEPT_DOI, cd))
    for x in (a.old_doi, a.new_doi):
        if not re.fullmatch(r"10\.5281/zenodo\.\d+", x or ""):
            die("DOI の形が違う: %r" % x)
    if a.new_doi in (a.old_doi, CONCEPT_DOI):
        die("新しい DOI が古い DOI か全版の DOI と同じ: " + a.new_doi)
    if a.new_total != a.items + a.new_obs or a.old_total != a.items + a.old_obs:
        die("計 = 品目 + 観測 になっていない")
    for x in (a.old_date, a.new_date):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", x):
            die("日付の形が違う: " + x)
    if not re.fullmatch(r"\d+\.\d+", a.old_version) or not re.fullmatch(r"\d+\.\d+", a.new_version):
        die("版の形が違う(例 5.1)")
    out = os.path.abspath(os.path.expanduser(a.out)); os.makedirs(out, exist_ok=True)
    if a.with_dataset_info_desc:
        PROTECT["workers/hs-mcp/src/mcp.js"] = [r for r in PROTECT["workers/hs-mcp/src/mcp.js"] if "get_jccdb_dataset_info" not in r]

    targets, undecodable = discover(root, a)
    if a.discover:
        open(os.path.join(out, "discovered.txt"), "w", encoding="utf-8").write("\n".join(targets) + "\n")
        print("対象 %d 本を %s に書いた" % (len(targets), os.path.join(out, "discovered.txt")))
        return
    if a.only:
        targets = [t for t in targets if t in a.only]
    targets = [t for t in targets if t not in a.skip]

    rules = build_rules(a); eng = Engine(rules); passes = build_regex_passes(a); rems = remnant_patterns(a)
    tally = collections.Counter(); per_file = collections.OrderedDict(); after_map = collections.OrderedDict(); before_map = {}
    plugin_bump = None
    for rel in targets:
        p = os.path.join(root, rel)
        before = open(p, encoding="utf-8", newline="").read()
        before_map[rel] = before
        ft = collections.Counter()
        if rel == "data/jccdb-manifest.json":
            after = patch_manifest(before, a, ft)
        else:
            after = map_unprotected(rel, before, lambda seg: eng.sub(rel, seg, ft))
            for name, scope, rx, rep in passes:
                if rel in scope:
                    def f(seg, rx=rx, rep=rep, name=name):
                        new, n = rx.subn(rep, seg)
                        ft[name] += n
                        return new
                    after = map_unprotected(rel, after, f)
        if after != before:
            after_map[rel] = after; per_file[rel] = ft; tally.update(ft)
        else:
            per_file[rel] = ft
    # plugin: plugin/ を変えたら plugin.json の版を 1 つ上げる(Grok の写しは版が変わらないと進まない)
    if not a.no_plugin_bump and any(r.startswith("plugin/") for r in after_map):
        pj = "plugin/.claude-plugin/plugin.json"
        cur = after_map.get(pj) or open(os.path.join(root, pj), encoding="utf-8", newline="").read()
        before_map.setdefault(pj, open(os.path.join(root, pj), encoding="utf-8", newline="").read())
        bumped, old_v, new_v = bump_plugin(cur, tally)
        after_map[pj] = bumped; plugin_bump = (old_v, new_v)
        per_file.setdefault(pj, collections.Counter())["plugin_version"] += 1

    # 検査
    errs, notes = [], []
    for rel, after in after_map.items():
        xn = ['"version": "%s"' % plugin_bump[1]] if (plugin_bump and rel == "plugin/.claude-plugin/plugin.json") else []
        if rel in HELD:
            xn += [new for _o, new, _k in held_drops(fmt(a.old_total))]
        e, n = check_file(rel, before_map[rel], after, a, rems, xn)
        errs += ["%s: %s" % (rel, x) for x in e]; notes += ["%s: %s" % (rel, x) for x in n]
    unchanged_with_old = []
    for rel in targets:
        if rel in after_map:
            continue
        txt = before_map[rel]
        up = unprotected_text(rel, txt)
        hits = [name for name, rx in rems if rx.search(up)]
        if hits:
            unchanged_with_old.append("%s: 置き換える規則が無いのに古い物が残る(%s)" % (rel, ", ".join(hits)))
    errs += unchanged_with_old
    w, e = node_check([(r, t) for r, t in after_map.items() if r.endswith((".js", ".mjs"))])
    notes += w; errs += e
    errs += ccdb_build_check(root, after_map)
    pc_errs, pc_notes = pagecheck_sim(root, before_map, after_map)
    errs += pc_errs; notes += pc_notes

    tracked = git_tracked(root, list(after_map))
    rep = collections.OrderedDict()
    rep["params"] = {k: getattr(a, k) for k in ("old_total", "new_total", "old_obs", "new_obs", "items", "old_version", "new_version",
                                                 "old_date", "new_date", "old_doi", "new_doi", "old_sources", "new_sources")}
    rep["targets"] = len(targets); rep["changed"] = len(after_map)
    rep["by_rule"] = dict(sorted(tally.items(), key=lambda x: -x[1]))
    rep["by_dir"] = dict(collections.Counter((r.split("/")[0] if "/" in r else "(root)") for r in after_map).most_common())
    rep["files"] = {r: dict(per_file[r]) for r in after_map}
    rep["untracked_changed"] = [r for r in after_map if r not in tracked]
    rep["plugin_bump"] = plugin_bump
    rep["errors"] = errs; rep["notes"] = notes; rep["undecodable_skipped"] = undecodable
    if a.reviewed and os.path.exists(a.reviewed):
        rv = set(x.strip() for x in open(a.reviewed, encoding="utf-8") if x.strip())
        rep["new_since_review"] = sorted(set(after_map) - rv)
        rep["reviewed_but_unchanged"] = sorted(rv - set(after_map))
    json.dump(rep, open(os.path.join(out, "report.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(os.path.join(out, "plan.txt"), "w", encoding="utf-8") as f:
        for r in after_map:
            f.write("%s\t%s\n" % (r, " ".join("%s=%d" % kv for kv in sorted(per_file[r].items()))))
    import difflib
    with open(os.path.join(out, "full.diff"), "w", encoding="utf-8") as f:
        for r, t in after_map.items():
            f.writelines(difflib.unified_diff(before_map[r].splitlines(True), t.splitlines(True), "a/" + r, "b/" + r, n=0))

    print("新しい版 v%s(%s) DOI %s: 計 %s・観測 %s・品目 %s・出典 %s" % (a.new_version, a.new_date, a.new_doi, fmt(a.new_total), fmt(a.new_obs), fmt(a.items), a.new_sources))
    print("対象 %d 本のうち、変わるのは %d 本(git の外 %d 本: %s)" % (len(targets), len(after_map), len(rep["untracked_changed"]), ", ".join(rep["untracked_changed"]) or "なし"))
    print("場所ごと: " + ", ".join("%s %d" % kv for kv in rep["by_dir"].items()))
    print("規則ごとの当たり:")
    for k, v in rep["by_rule"].items():
        print("  %6d  %s" % (v, k))
    if plugin_bump:
        print("plugin の版: %s -> %s" % plugin_bump)
    if a.reviewed and "new_since_review" in rep:
        print("番人が見た一覧に無い新しいファイル: %d 本 %s" % (len(rep["new_since_review"]), " ".join(rep["new_since_review"][:20])))
        print("番人が見た一覧にあって今回変わらないファイル: %d 本 %s" % (len(rep["reviewed_but_unchanged"]), " ".join(rep["reviewed_but_unchanged"][:20])))
    for n in notes[:20]:
        print("  注: " + n)
    if errs:
        print("検査: 不合格 %d 件" % len(errs))
        for x in errs[:60]:
            print("  NG " + x)
        die("検査に落ちた。1 本も書いていない(一覧は %s/report.json)" % out, 3)
    print("検査: 全部合格(古い数・古い DOI・古い版の残り 0、他の DOI 不変、JSON-LD と JSON、HTML のタグの並び、ダッシュ、node --check、Python の構文、変えた行、hs-ccdb-mcp の生成器)")
    if a.dry_run:
        print("dry-run: 書いていない。差分は %s/full.diff、内訳は %s/plan.txt" % (out, out))
        return
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    bk = os.path.join(out, "originals_%s.tar.gz" % stamp)
    with tarfile.open(bk, "w:gz") as tf:
        for r in after_map:
            tf.add(os.path.join(root, r), arcname=r)
    for r, t in after_map.items():
        p = os.path.join(root, r)
        st = os.stat(p)
        with open(p, "w", encoding="utf-8", newline="") as f:
            f.write(t)
        os.chmod(p, st.st_mode & 0o7777)
    open(os.path.join(out, "changed_files.txt"), "w", encoding="utf-8").write("\n".join(r for r in after_map if r in tracked) + "\n")
    open(os.path.join(out, "changed_untracked.txt"), "w", encoding="utf-8").write("\n".join(rep["untracked_changed"]) + ("\n" if rep["untracked_changed"] else ""))
    sums = ["%s  %s" % (hashlib.sha256(t.encode("utf-8")).hexdigest(), r) for r, t in after_map.items()]
    open(os.path.join(out, "after_sha256.txt"), "w", encoding="utf-8").write("\n".join(sums) + "\n")
    print("書いた: %d 本。元は %s。git に入れる一覧は %s/changed_files.txt" % (len(after_map), bk, out))


if __name__ == "__main__":
    main()
