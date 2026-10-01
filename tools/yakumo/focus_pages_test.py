# 望みが二つ以上ある店の頁を、実物の plan_pages で確かめる(2026-10-02)。ネットワークにも出ないし、何も書かない。
#
# なぜ要るか:
#   峰尾さま(No.002)の望みは、施主からの受注(homeowners)と従業員の募集(recruit)の二つ。
#   生成器は focus_primary しか読まず、採用の頁は一度も作られていなかった。
#   主軸の頁はこれまでどおり。二つ目以降は、その目的に答えが一つ入ってから出す(中身の無い頁は増やさない)。
#
# 走らせ方: python3 tools/yakumo/focus_pages_test.py
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate as G  # noqa: E402

ran = 0
bad = 0


def ok(cond, label):
    global ran, bad
    ran += 1
    if not cond:
        bad += 1
        print("  NG ", label)


BASE_PROFILE = {
    "company": "ミネオトーヨー住器株式会社", "member_no": "No.002", "industry": "construction",
    "area": "平塚市", "areas_served": ["平塚市", "茅ヶ崎市", "藤沢市"],
    "works": ["窓の交換", "玄関の交換", "ガラス修理", "網戸張替え"],
    "strengths": "LIXILのフランチャイズに加盟し、熟練の職人も多数在籍。窓工事・玄関工事はメーカーの取付説明書に従い、正確な建て付けで取付けます。",
    "trust": "1956年創業で今年は70周年を迎える事が出来ました。",
    "faqs": [{"q": "網入りガラスは防犯になりますか", "a": "網入りガラスは防火用で、防犯の効果はありません。"}],
    "extra": {"q_home_cases": {"text": "内窓を9箇所に取り付け、冬の結露が減ったとお声をいただきました。", "attributed": "sole"}},
}


def focus_urls(profile, ap):
    return [c for (t, c, h) in G.plan_pages(profile, ap) if t == "focus"]


def page_of(profile, ap, part):
    for (t, c, h) in G.plan_pages(profile, ap):
        if t == "focus" and part in c:
            return c, h
    return None, None


MULTI = {"focus_primary": "homeowners", "focus_all": ["homeowners", "recruit"], "industry": "construction"}

print("1) 採用に答えが無いうちは、採用の頁を作らない(主軸の1枚だけ)")
u = focus_urls(BASE_PROFILE, MULTI)
ok(len(u) == 1 and "/yakumo/jirei/no002/" in u[0], "主軸の施工事例の1枚だけ (実測 %s)" % u)

print("2) 採用に答えが一つ入れば、採用の頁も作る")
p2 = dict(BASE_PROFILE)
p2["extra"] = dict(BASE_PROFILE["extra"])
p2["extra"]["q_recruit_roles"] = {"text": "窓と玄関の施工スタッフを1名。経験は問いません。", "attributed": "sole"}
u2 = focus_urls(p2, MULTI)
ok(any("/yakumo/jirei/no002/" in x for x in u2), "施工事例の頁は残る")
ok(any("/yakumo/recruit/no002/" in x for x in u2), "採用の頁ができる (実測 %s)" % u2)
c, h = page_of(p2, MULTI, "/recruit/")
ok(h is not None and "施工スタッフを1名" in h, "採用の頁に答えが載る")
ok(h is not None and "求人・採用情報" in h, "採用の頁の見出し")

print("3) 二つの頁が、重複の門で互いに弾かれない")
pages = [(t, c, hh) for (t, c, hh) in G.plan_pages(p2, MULTI) if t == "focus"]
fps = [G.fingerprint(c, hh, member=G.member_slug(p2)) for (t, c, hh) in pages]
why, _hit = G.duplicate_of(fps[1], [fps[0]]) if len(fps) == 2 else ("missing", None)
ok(not why, "採用の頁は施工事例の頁の重複と見なされない (理由 %s)" % why)

print("4) これまでの店は変わらない")
legacy = {"focus_primary": "homeowners", "industry": "construction"}
ok(focus_urls(p2, legacy) == [x for x in u2 if "/jirei/" in x], "focus_all の無い記録は、主軸の1枚だけ")
ok(focus_urls(BASE_PROFILE, {"industry": "construction"}) == [], "望みが無ければ目的の頁は作らない")
rec_only = {"focus_primary": "recruit", "industry": "construction"}
ok(len(focus_urls(BASE_PROFILE, rec_only)) == 1, "主軸なら答えが無くても1枚(ヒアリング中と明示)")
c, h = page_of(BASE_PROFILE, rec_only, "/recruit/")
ok(h is not None and "ヒアリングに回答中" in h, "主軸の空の頁は、ヒアリング中と書く")

print("5) 壊れた望みは混ぜても事故らない")
dirty = {"focus_primary": "homeowners", "focus_all": ["bogus", "homeowners", "recruit", "recruit"], "industry": "construction"}
ok(focus_urls(p2, dirty) == u2, "無効な名前と重複は落とす")
amb = dict(BASE_PROFILE)
amb["extra"] = dict(BASE_PROFILE["extra"])
amb["extra"]["q_recruit_roles"] = {"text": "", "attributed": "sole"}
ok(len(focus_urls(amb, MULTI)) == 1, "空の答えは答えと数えない")

EXPECT_MIN = 12
print("\n実行 %d 件 / 失敗 %d 件" % (ran, bad))
if ran < EXPECT_MIN:
    print("検査の数が足りない(最低 %d 件)" % EXPECT_MIN)
    sys.exit(2)
if bad:
    print("目的別の頁の検査に失敗がある")
    sys.exit(1)
print("目的別の頁の検査 すべて通過")
