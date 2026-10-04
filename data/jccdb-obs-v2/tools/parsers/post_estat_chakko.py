# -*- coding: utf-8 -*-
"""
建築着工統計の parser(parse_estat_chakko_pref.py)のあとに、2026-09-26 番人の判断
(tools/apply_decisions_20260926.py の stat_zero: 統計の件数・金額の 0 は「0 という値」)を、選んだ月のファイルに当てる。

apply_decisions_20260926.stat_zero は当てるファイルを cost_sqft_mlit_chakko_2025.csv / cost_sqft_mlit_chakko_2026_01_07.csv /
spending_mlit_reform_fy2025.csv に決め打ちしている。ここでは関数の中身を変えず、ファイルの場所だけを差し替えて呼ぶ。
  --month を省くと建築着工の 2 ファイル(2025 と 2026_01_07)だけ(住宅リフォームのファイルには触らない)。
  --month YYYY-MM を渡すと cost_sqft_mlit_chakko_YYYY_MM.csv だけ。

使い方: python3 post_estat_chakko.py [--month 2026-08]   (OBS2 はこのファイルの場所から決まる)
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OBS2 = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(OBS2, "tools"))
import apply_decisions_20260926 as A  # noqa: E402

MONTH = sys.argv[sys.argv.index("--month") + 1] if "--month" in sys.argv else None
NAMES = ("cost_sqft_mlit_chakko_2025.csv", "cost_sqft_mlit_chakko_2026_01_07.csv", "spending_mlit_reform_fy2025.csv")
if MONTH:
    MAP = {"cost_sqft_mlit_chakko_2026_01_07.csv": "cost_sqft_mlit_chakko_%s.csv" % MONTH.replace("-", "_")}
else:
    MAP = {"cost_sqft_mlit_chakko_2025.csv": "cost_sqft_mlit_chakko_2025.csv",
           "cost_sqft_mlit_chakko_2026_01_07.csv": "cost_sqft_mlit_chakko_2026_01_07.csv"}


def main():
    assert os.path.abspath(A.ROOT) == OBS2, (A.ROOT, OBS2)
    for v in MAP.values():
        assert os.path.exists(A.J("observations", "jp", v)), v
    orig = A.J

    def J(*p):
        if len(p) == 3 and p[:2] == ("observations", "jp") and p[2] in NAMES:
            # 選んだファイルだけに差し替える。ほかは無い場所にして stat_zero に飛ばさせる
            return orig("observations", "jp", MAP.get(p[2], "__not_selected__" + p[2]))
        return orig(*p)

    A.J = J
    try:
        A.stat_zero()
    finally:
        A.J = orig


if __name__ == "__main__":
    main()
