// 『大賀が教える 現場から英語』の中身(eigo.js と eigo/episodes)を確かめる。ネットワークにも note にも出ない。
// 走らせ方: node note-post/test_eigo.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./eigo');
const STORY = require('./story');

let ran = 0, bad = 0;
const ok = (c, label) => { ran++; if (!c) { bad++; console.log('  NG ', label); } };

console.log('1) 書き置きの回が全部、門を通ること');
const eps = E.loadEpisodes();
ok(eps.length >= 6, '書き置きが 6 回以上ある (実測 ' + eps.length + ')');
for (const ep of eps) {
  const g = E.gateBody(ep, ep.body);
  ok(g.ok, ep.key + ' が門を通る: ' + g.reasons.join(' / '));
  ok(ep.no === Number(ep.key.slice(5)), ep.key + ' の番号');
  const post = E.composePost(ep, ep.body, '', null);
  ok(!STORY.DASH_TEST.test(post + E.fullTitle(ep)), ep.key + ' の全文にダッシュが無い');
  ok(!STORY.MACHINE_RE.test(post + E.fullTitle(ep)), ep.key + ' の全文に機械の名前が無い');
  const tags = E.hashtagsFor(ep);
  ok(tags.length >= 10 && tags.length <= 20 && new Set(tags).size === tags.length, ep.key + ' のタグは 10 から 20 個で重ならない (' + tags.length + ')');
  ok(tags.every((t) => !/\s/.test(t)), ep.key + ' のタグに空白が無い(note のタグは空白で切れる)');
}
ok(new Set(eps.map((e) => e.title)).size === eps.length, '題が重ならない');

console.log('2) 門が止めるべき物を止めること');
const base = eps[0];
const dash = String.fromCharCode(0x2014);
ok(!E.gateBody(base, base.body + '\n' + dash).ok, 'ダッシュの入った本文は止める');
ok(!E.gateBody(base, base.body + '\nChatGPT').ok, '機械の名前の入った本文は止める');
ok(!E.gateBody(base, base.body.replace('■ 見積書ではこう書く', '')).ok, '見積書の段が無い本文は止める');
ok(!E.gateBody(base, base.body + '\n# 見出し').ok, '記号 # の入った本文は止める');

console.log('3) 体験談は、あるときだけ載せる(作らない)');
const plain = E.composePost(base, base.body, '', eps[1]);
ok(plain.indexOf('■ 大賀の現場') < 0, '体験談が無ければ、その段を出さない');
const withStory = E.composePost(base, base.body, '本人が書いた体験。', eps[1]);
ok(withStory.indexOf('■ 大賀の現場\n\n本人が書いた体験。') >= 0, '体験談があれば載せる');
ok(withStory.indexOf('■ 大賀の現場') < withStory.indexOf('■ 今週のまとめ'), '体験談はまとめの前');
ok(plain.indexOf('次回 第2回「' + eps[1].title + '」') >= 0, '次回の予告');
ok(plain.indexOf(STORY.LP_URL) >= 0, '案内の URL');
ok(plain.indexOf('紹介料も掲載料も受け取りません') >= 0, '紹介料・掲載料を受け取らない一文');

console.log('4) 週に一回だけ、順番どおりに出すこと');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigo-'));
const now = new Date('2026-10-04T00:00:00Z');
ok(E.nextEpisode(eps, { posted: [] }).key === 'eigo-001', '最初は第1回');
ok(!E.postedThisWeek({ posted: [] }, now), '何も出していなければ出せる');
const st = E.savePosted(eps[0], 'x', 'https://note.com/horizon_shield/n/test', now, tmp);
ok(st.posted.length === 1 && fs.existsSync(path.join(tmp, 'posted', 'eigo-001.txt')), '出した記録が残る');
ok(E.nextEpisode(eps, E.loadState(tmp)).key === 'eigo-002', '次は第2回');
ok(E.postedThisWeek(E.loadState(tmp), new Date('2026-10-08T00:00:00Z')), '4 日後は出さない');
ok(!E.postedThisWeek(E.loadState(tmp), new Date('2026-10-11T00:00:00Z')), '7 日後は出せる');
const allDone = { posted: eps.map((e) => ({ key: e.key })) };
ok(E.nextEpisode(eps, allDone) === null, '在庫が尽きたら出さない(作らない)');

console.log('5) 見出し画像の組み');
for (const ep of eps.slice(0, 3)) {
  const h = E.eyecatchHtml(ep);
  ok(h.indexOf(ep.word) >= 0 && h.indexOf(ep.right) >= 0, ep.key + ' の見出し画像に一語と英語が入る');
  ok(!STORY.DASH_TEST.test(h), ep.key + ' の見出し画像にダッシュが無い');
}
ok(E.eyecatchHtml(eps[4]).indexOf('class="wrong"') < 0, '通じない英語が無い回は、打ち消し線の行を出さない');

const EXPECT_MIN = 62;
console.log('\n実行 ' + ran + ' 件 / 失敗 ' + bad + ' 件');
if (ran < EXPECT_MIN) { console.log('検査の数が足りない(最低 ' + EXPECT_MIN + ' 件)'); process.exit(2); }
if (bad) { console.log('現場から英語の検査に失敗がある'); process.exit(1); }
console.log('現場から英語の検査 すべて通過');
