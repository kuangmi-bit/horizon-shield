# 2026-10-02 加盟店さまのトークにはヒアリングだけを届ける、二つ目の望みの頁と設問を届ける

## 発端(TOshi 経由、ミネオトーヨー住器 峰尾さま No.002)

- 公式LINE @172piime に、補助金などの配信を送らないでほしい。ヒアリングならヒアリングだけにしてほしい。文章が埋もれる。
- 回答済みのヒアリングシートを、また送ってくる。
- 峰尾さまの望みは、施主からの受注を増やすことと、従業員の募集の二つ。そのための GEO/AEO/LLMO/WebMCP の素材が作られているか。

## 1 本目 3db560fb(push 済み、deploy-hs-hearing 36933812355 success)

- line-broadcast/broadcast.js: 毎朝 8 時の全友だち配信(補助金の話)を既定で止めた。LINE_BROADCAST=1 のときだけ送る。
- note-post/post_to_note.js: 連載の告知の全友だち配信を既定で止めた。NOTE_BROADCAST=1 のときだけ送る。
  broadcast は友だち全員に届き、特定の友だちを外す指定が無いため。施主さんにだけ届けるなら、別の送り方で作り直す。
- hs-hearing autopilot.js sendQuestions: hearing の completed が立っている店には、用紙の URL と用紙の案内を付けない。
  No.001(堤さま)も No.002 も該当。まだ答えていない店には、これまでどおり付ける。hearing_form_test の 12。

## 2 本目(この文書と同じ commit)

- tools/yakumo/generate.py: 目的の頁を focus_all の目的ごとに 1 枚作る。主軸はこれまでどおり答えが無くても 1 枚(ヒアリング中と明示)。
  二つ目以降は、その目的の設問に答えが一つ入ってから作る。tools/yakumo/focus_pages_test.py(12 件、直す前の生成器では 4 件落ちる)。
- hs-hearing hearing.js triggerGeneration: dispatch に focus_all を載せる。これまで主軸しか渡していなかった。
- hs-hearing autopilot.js nextQuestions: 答えが一つも無い目的の設問を、基本の欄(重み 10 以上)のすぐ後に出す(重み 9.5 と見なす)。
  直す前は、採用の設問が 17 問の後ろに並び、一度も届いていなかった。focus_multi_test の 8(直す前のコードでは 3 件落ちる)。全店に効く。

## データの直し(_work/hearing_check_002_20261002.py、git に入らない)

- 峰尾さまの 10/1 の答え「メンテナンス・補修等にはいち早く対応させていただきます。の一言で乗り切ります。」を q_cn_takai_iwareta に当てる(空のときだけ)。
- 望みを homeowners と recruit の二つにする(/admin/classify、focus_via manual)。

## データの直しの結果(2026-10-02 07:3x JST、TOshi が実行)

- 10/1 の答えは q_cn_zairyo_ugoki(材料の値動き)に recent_wave で入っていた。直前に送った 1 問への返事と推定された誤り。
  q_cn_zairyo_ugoki から消し、q_cn_takai_iwareta に legacy_confirmed(at 2026-10-01T03:17)で入れた。
- 望みは homeowners と recruit(manual)。完成度 81 のまま。
- 実測で分かったこと: 施主側の目的の設問(q_home_*)にも答えが一つも無い。/yakumo/jirei/no002/ は「ヒアリングに回答中」の仮の文のまま公開されている。

## 次に起きること

- 返事待ちの q_ai_found は 10/1 21:17Z に送った。48 時間が明ける 10/4 朝の巡回で次を送る。
- 2 本目が入っていれば、順番は q_home_cases(施工事例)、その答えの後に q_recruit_roles(採用の職種と人数)。
  両方の目的の頁が空なので両方とも前に出て、同じ重みの中で主軸の施主側が先になる。
- 答えが届くたびに取り込みから生成が走り、施工事例の頁の仮の文が答えに置き換わり、採用の答えが入れば /yakumo/recruit/no002/ ができる。
