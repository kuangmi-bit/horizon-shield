// reverse_logic.js: 逆見積もりの結果画面の「決まった計算」の部分。画面(index.html)と試験(reverse_logic.test.mjs)が同じ物を使う。
//
// 2026-10-07 に分けた理由。竹(適正)の幅を AI の文章から拾っていたので、同じ工事でも相場ページと数字が合わないことがあった。
// ここでは、相場ページが引いているのと同じ公開の正本 /data/souba-db.json の行をそのまま使う。地域の係数も掛けない。
// 行が一つに決まらない工事(複数の工事、行の無い坪数や仕様)は null を返し、画面は KIRA の積み上げを「目安」として出す。
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HSReverse = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- 1. 返答から内部の指示文を落とす -------------------------------------------------------------
  // 「プロセス1〜5を実行します。」のように、指示の手順をそのまま口に出した行を画面に出さない。
  // PLAN の中の行(工事内容、松竹梅、アドバイス、出典)には、ここで落とす語は出てこない。
  var DIRECTIVE_LINE = /(プロセス|ステップ)\s*[0-9０-９]|【強制指示】|[\[［]指示[：:]|KIRA_SYSTEM|システムプロンプト|絶対遵守|最重要警告|会話履歴(の|を|から)[^。\n]{0,24}(読み返|抽出|リストアップ)|既出情報|再質問(しない|しません|は禁止)|以下のプロセス/;
  function sanitizeReply(text) {
    if (!text) return "";
    var out = [];
    String(text).split("\n").forEach(function (line) {
      if (DIRECTIVE_LINE.test(line)) {
        // 一行に指示文と本文が同居している時は、指示文の文だけを落とす。
        var kept = line.split(/(?<=[。！？!?])/).filter(function (s) { return !DIRECTIVE_LINE.test(s); }).join("");
        if (kept.trim()) out.push(kept);
        return;
      }
      out.push(line);
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  function hasDirective(text) { return DIRECTIVE_LINE.test(String(text || "")); }

  // ---- 2. 会話から souba-db の行を一つ決める ---------------------------------------------------------
  var OTHER_WORK = ["キッチン", "台所", "浴室", "風呂", "ユニットバス", "フルリノベ", "リノベ", "全面", "フローリング", "畳", "窓", "サッシ", "断熱",
    "洗面", "耐震", "外構", "エアコン", "シロアリ", "白蟻", "防水", "雨漏り", "玄関ドア", "増築", "解体"];
  function rowById(db, id) {
    var cats = (db && db.categories) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
    return null;
  }
  function toHalf(s) { return String(s || "").replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function matchSoubaRow(db, userText) {
    var t = toHalf(userText);
    var has = function (w) { return t.indexOf(w) >= 0; };
    var fam = [];
    if (has("外壁")) fam.push("gaiheki");
    if (has("給湯器") || has("エコキュート") || has("エコジョーズ")) fam.push("kyutoki");
    if (has("トイレ") || has("便器")) fam.push("toilet");
    if (fam.length !== 1) return null;
    var others = OTHER_WORK.filter(has);
    var id = null;
    if (fam[0] === "gaiheki") {
      if (others.length) return null;
      if (/ラジカル|フッ素|ふっ素|無機|光触媒/.test(t)) return null;
      var m = t.match(/(\d{2,3})\s*坪/);
      if (!m) return null;
      var tsubo = Number(m[1]);
      if (has("屋根")) id = tsubo === 30 ? "gaiheki_yane_set_30tsubo" : null;
      else id = ({ 20: "gaiheki_20tsubo", 30: "gaiheki_30tsubo", 40: "gaiheki_40tsubo" })[tsubo] || null;
    } else if (fam[0] === "kyutoki") {
      if (others.length || has("屋根") || has("床暖")) return null;
      var g = t.match(/(16|20|24)\s*号/);
      if (has("エコキュート")) id = g ? null : "ecocute_370";
      else if (has("エコジョーズ")) id = g && g[1] !== "16" ? "kyutoki_ecojozu_" + g[1] : null;
      else id = g ? "kyutoki_" + g[1] : null;
    } else {
      if (others.length || has("屋根")) return null;
      if (/[2-9]\s*(台|箇所|か所|ヶ所|個)|2階にも|二つ|両方/.test(t)) return null;
      if (has("和式")) id = "toilet_washiki_to_youshiki";
      else if (has("タンクレス")) id = "toilet_replace_tankless";
      else if (has("内装") || has("クロス") || has("床")) id = "toilet_full_renov";
      else id = "toilet_replace_basic";
    }
    return id ? rowById(db, id) : null;
  }

  // ---- 3. 万円の表記 ---------------------------------------------------------------------------------
  function man(yen) { return Math.round(yen / 1000) / 10; }               // 1150000 -> 115、 220000 -> 22
  function rangeText(lo, hi) { return lo + "万〜" + hi + "万円"; }

  // ---- 4. 見積もりを取る前の人に出す「確かめる項目」。金額は付けない ----------------------------------
  var CHECK_MAP = {
    "外壁": ["塗料のメーカー名・製品名・グレードが書いてあるか", "足場が面積と単価で書いてあるか（「一式」だけになっていないか）", "塗る面積（㎡）と塗る回数が書いてあるか"],
    "屋根": ["工法と使う材料の名前が書いてあるか", "高圧洗浄・下地補修が別の行で数量つきになっているか", "足場が外壁と二重に入っていないか"],
    "給湯器": ["メーカー名と型番、号数が書いてあるか", "本体の価格と工事費が分けて書いてあるか", "撤去・処分の費用が別の行になっているか"],
    "トイレ": ["便器のメーカー名と品番が書いてあるか", "本体の価格と工事費が分けて書いてあるか", "頼んでいない内装工事が一緒に入っていないか"],
    "キッチン": ["キッチン本体のメーカー名・シリーズ名・定価と値引きが書いてあるか", "解体・撤去が数量つきの行になっているか", "給排水・電気・ガスの工事が別の行になっているか"],
    "浴室": ["ユニットバスのメーカー名・シリーズ名・サイズが書いてあるか", "解体・撤去が数量つきの行になっているか", "給排水・電気の工事が別の行になっているか"],
    "水回り": ["設備ごとにメーカー名と品番が書いてあるか", "給排水の工事が「一式」だけになっていないか", "設備ごとに小計が出ているか"],
    "断熱": ["断熱材の種類と厚みが書いてあるか", "施工する面積が書いてあるか", "窓は枚数とサイズごとに書いてあるか"],
    "エアコン": ["本体の型番と標準工事の範囲が書いてあるか", "追加工事が項目ごとに書いてあるか", "配管カバーなどが頼んだ分だけになっているか"],
    "フローリング": ["床材のメーカー名と品番が書いてあるか", "張る面積が書いてあるか", "下地の補修が必要な理由と範囲が書いてあるか"],
    "内装": ["クロスや床材の品番と面積が書いてあるか", "下地の処理が別の行になっているか", "廃材の処分が別の行になっているか"],
    "default": ["工事ごとに数量と単価が書いてあるか（「一式」だけになっていないか）", "諸経費が何の費用か説明されているか", "足場・養生が面積と単価で書いてあるか"]
  };
  function checkItems(kojiText) {
    var t = String(kojiText || "");
    var keys = Object.keys(CHECK_MAP);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== "default" && t.indexOf(keys[i]) >= 0) return CHECK_MAP[keys[i]];
    return CHECK_MAP["default"];
  }

  // ---- 5. 出典の行。版と日付は固定の文字にしない ------------------------------------------------------
  function ymd(d) {
    var j = new Date(d.getTime() + 9 * 3600 * 1000);                          // 日本時間
    return j.getUTCFullYear() + "-" + String(j.getUTCMonth() + 1).padStart(2, "0") + "-" + String(j.getUTCDate()).padStart(2, "0");
  }
  function provenance(meta, now, row) {
    var v = meta && meta.version ? String(meta.version) : null;
    var parts = [v ? "HORIZON SHIELD souba-db " + v + (meta.updated_at ? "（" + meta.updated_at + " 更新）" : "") : "HORIZON SHIELD souba-db（版を読めませんでした）"];
    if (row) parts.push("行: " + row.id + "（" + row.work + "）");
    parts.push("算出日: " + ymd(now || new Date()));
    return parts.join(" / ");
  }

  // ---- 6. 画面に出す物を一か所で決める ----------------------------------------------------------------
  // plan: KIRA の PLAN から読んだ { koji, take:[lo,hi] }(万円)。row: matchSoubaRow の結果か null。
  // 返す物に、松・梅の金額、最悪額、差額、削減額は入れない。松と梅は有料のまま。差額の類は松が無いと計算で合わせられないので出さない。
  function buildView(o) {
    var row = o.row || null, plan = o.plan || {};
    var take, source;
    if (row) { take = [man(row.min), man(row.max)]; source = "souba-db"; }
    else if (plan.take && plan.take[1] > 0) { take = [plan.take[0], plan.take[1]]; source = "kira"; }
    else { take = null; source = "none"; }
    return {
      koji: plan.koji || (row ? row.work : ""),
      take: take,
      takeText: take ? rangeText(take[0], take[1]) : null,
      takeSource: source,
      takeNote: source === "souba-db" ? "souba-db の「" + row.work + "」の行そのままです。同じ数字が相場ページにも載っています。"
        : source === "kira" ? "会話の条件から KIRA が積み上げた目安です。souba-db に一行で対応する工事ではないため、相場ページの数字とは別の計算です。" : "",
      dangerText: row && row.danger ? man(row.danger) + "万円" : null,
      // 見積書がまだ無い人には「検出」も「リスクスコア」も出さない。見積もりを取った後に確かめる項目だけを出す。
      showRiskScore: false,
      showDetected: false,
      checklist: checkItems((plan.koji || "") + " " + (row ? row.cat : "")),
      provenance: provenance(o.meta, o.now, row)
    };
  }

  // ---- 6b. 有料レポートの松・梅を、画面の竹と同じ物差しに揃える ---------------------------------------------
  // 2026-10-08 に足した理由。竹を souba-db の行に差し替えた後も、松・梅は KIRA の積み上げのままだった。KIRA が外壁塗装 30 坪で
  // 竹 26〜42 万と出すと、松 34〜60 万が画面の竹 70〜115 万より安くなり、¥5,500 のレポートで「松が竹より安い」になる。
  // 直し方: KIRA が出した松・竹・梅の比はそのまま使い、KIRA の竹の真ん中が souba-db の竹の真ん中に重なるように、松・梅を同じ倍率で動かす。
  // 動かした後も「梅 ≤ 竹 ≤ 松」が崩れる時と、KIRA の数字が読めない時だけ、竹の両端から決まった比で作る(basis: "ratio")。
  // 竹が KIRA の積み上げ(行が無い)の時は、松・梅も同じ KIRA の物差しなので触らない(basis: "kira")。
  function okRange(r) { return Array.isArray(r) && r.length === 2 && r[0] > 0 && r[1] > 0 && r[0] <= r[1]; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function alignPaidPlans(view, kiraTake, kiraMatsu, kiraUme) {
    var take = view && view.take;
    if (!view || view.takeSource !== "souba-db" || !okRange(take)) {
      return { matsu: kiraMatsu || [0, 0], ume: kiraUme || [0, 0], basis: "kira", factor: 1 };
    }
    if (okRange(kiraTake) && okRange(kiraMatsu) && okRange(kiraUme)) {
      var k = ((take[0] + take[1]) / 2) / ((kiraTake[0] + kiraTake[1]) / 2);
      var m = [r1(kiraMatsu[0] * k), r1(kiraMatsu[1] * k)], u = [r1(kiraUme[0] * k), r1(kiraUme[1] * k)];
      if (u[0] <= take[0] && u[1] <= take[1] && m[0] >= take[0] && m[1] >= take[1]) {
        return { matsu: m, ume: u, basis: "scaled", factor: Math.round(k * 1000) / 1000 };
      }
    }
    return { matsu: [take[1], r1(take[1] * 1.35)], ume: [r1(take[0] * 0.75), take[0]], basis: "ratio", factor: null };
  }

  // ---- 7. ?work= で渡された工事名 ---------------------------------------------------------------------
  function workFromQuery(search) {
    var m = /[?&]work=([^&#]*)/.exec(String(search || ""));
    if (!m) return "";
    var w;
    try { w = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (_e) { return ""; }
    w = w.replace(/[<>"'`&\\\u0000-\u001f]/g, "").trim();
    return w.length > 24 ? "" : w;
  }

  // ---- 8. 「無料診断は 1 回限り」の印と、出した結果の控え ---------------------------------------------
  // 印は、結果(竹の幅を含む結果画面)を出した後にだけ付ける。最初の 1 通では付けない。
  // 開き直した時: 控えがあれば、出した結果をもう一度見せる。控えが無ければ(結果がまだ出ていない、または
  // 2026-10-07 より前の版が最初の 1 通で付けた印だけが残っている)、印を消して会話を最初からやり直せるようにする。
  var USED_KEY = "hs_reverse_used", RESULT_KEY = "hs_reverse_result";
  function shouldMarkUsed(view) { return !!(view && view.take && view.takeText); }
  function str(x, n) { return typeof x === "string" ? x.slice(0, n) : ""; }
  function makeSnapshot(o) {
    var v = o.view || {};
    return { v: 1, at: (o.now || new Date()).toISOString(), koji: str(v.koji, 120),
      view: { koji: str(v.koji, 120), take: v.take ? [Number(v.take[0]), Number(v.take[1])] : null, takeText: v.takeText ? str(v.takeText, 40) : null,
        takeSource: str(v.takeSource, 12), takeNote: str(v.takeNote, 300), dangerText: v.dangerText ? str(v.dangerText, 20) : null,
        checklist: (v.checklist || []).slice(0, 6).map(function (c) { return str(c, 120); }), provenance: str(v.provenance, 300) },
      advice: str(o.advice, 600), hash: /^[a-f0-9]{8,64}$/i.test(o.hash || "") ? o.hash : "",
      last: o.last || null };
  }
  function readSnapshot(raw) {
    var s;
    try { s = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_e) { return null; }
    if (!s || s.v !== 1 || !s.view || typeof s.view !== "object") return null;
    var v = s.view;
    if (!Array.isArray(v.take) || v.take.length !== 2 || !(v.take[1] > 0) || typeof v.takeText !== "string" || !v.takeText) return null;
    if (!Array.isArray(v.checklist) || !v.checklist.every(function (c) { return typeof c === "string"; })) return null;
    if (typeof v.provenance !== "string") return null;
    return s;
  }
  // 開いた時に何をするか。返り値: { state: "restore", snapshot } か { state: "fresh", clearUsed: 真偽 }。
  function loadState(usedFlag, rawSnapshot) {
    var snap = readSnapshot(rawSnapshot);
    if (snap) return { state: "restore", snapshot: snap };
    return { state: "fresh", clearUsed: !!usedFlag || !!rawSnapshot };
  }
  // ワーカーに送る物。会話の中身と状況だけ。指示文(system)は送らない。
  var PLAN_BUTTON_TEXT = "今の情報で概算を出してください";
  function chatPayload(history, mode, work, from) {
    return { messages: history.map(function (m) { return { role: m.role, content: m.content }; }), mode: mode === "estimate" ? "estimate" : "reverse", work: work || "",
      from: from === "box" || from === "work" ? from : "direct" };
  }

  // ---- 9. 入口(どこから来たか)。ワーカーが会話の 1 通目で数えるために送る。個人を特定する物は送らない ----------
  // box: 相場ページ(/souba/ の下)の箱(data-cta=reverse-v1)から来た。work: ?work= 付きで他から来た(AI の案内など)。direct: ?work= 無し。
  // 送るのはこの 3 つの語のどれかだけ。来た元の URL そのものは送らない。
  function entryFrom(search, referrer, origin) {
    if (!workFromQuery(search)) return "direct";
    var ref = String(referrer || ""), o = String(origin || "");
    return o && ref.indexOf(o + "/souba/") === 0 ? "box" : "work";
  }
  // ¥5,500 のボタンを押した時に送る物。出来事の名前だけ。
  function buyClickBody() { return JSON.stringify({ event: "buy_click" }); }

  return { USED_KEY: USED_KEY, RESULT_KEY: RESULT_KEY, shouldMarkUsed: shouldMarkUsed, makeSnapshot: makeSnapshot, readSnapshot: readSnapshot, loadState: loadState,
    PLAN_BUTTON_TEXT: PLAN_BUTTON_TEXT, chatPayload: chatPayload, sanitizeReply: sanitizeReply, hasDirective: hasDirective, matchSoubaRow: matchSoubaRow, man: man, rangeText: rangeText,
    checkItems: checkItems, provenance: provenance, buildView: buildView, alignPaidPlans: alignPaidPlans, workFromQuery: workFromQuery, ymd: ymd, entryFrom: entryFrom, buyClickBody: buyClickBody };
});
