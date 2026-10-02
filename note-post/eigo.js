// 週に一回の連載『大賀が教える 現場から英語』(2026-10-02 TOshi「建設現場から英語を教えよう、1週間に1回」)。
//   中身はここと eigo/。ブラウザと LINE は post_to_note.js の eigoMain。
//
// 掟:
//   ・回は eigo/episodes/eigo-NNN.txt の書き置きだけを出す。英語の言い方は書く前に確かめてある物だけ。
//     その朝に機械で書かせることはしない(言葉の正しさを、出す前に人が確かめられないため)。在庫が切れたら出さずに知らせる。
//   ・「大賀の現場」(体験談)は、大賀さん本人が書いた eigo/anecdotes/eigo-NNN.txt があるときだけ載せる。作らない。
//   ・ダッシュの類と、機械の名前は出さない(story.js の門をそのまま使う)。
const fs = require('fs');
const path = require('path');
const STORY = require('./story');

const EIGO_DIR = path.join(__dirname, 'eigo');
const SERIES = '大賀が教える 現場から英語';
const LP_URL = STORY.LP_URL;
const COMMON_TAGS = ['英語', '英会話', '英語学習', '現場英語', '建設英語', '和製英語', '英単語', 'ワーホリ', 'ワーキングホリデー',
  '海外就職', '建設業', '大工', '職人', '住まい', 'HORIZONSHIELD'];

function pad3(n) { return String(n).padStart(3, '0'); }

/* 書き置きの一回を読む。頭に「題: / 一語: / 誤: / 正: / タグ:」、--- のあとが本文。 */
function parseEpisode(text, key) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const cut = t.indexOf('\n---\n');
  if (cut < 0) throw new Error(key + ': 頭と本文の区切り(---)が無い');
  const head = {};
  for (const line of t.slice(0, cut).split('\n')) {
    const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (m) head[m[1].trim()] = m[2].trim();
  }
  const no = Number(String(key).replace(/\D/g, ''));
  return {
    key, no,
    title: head['題'] || '',
    word: head['一語'] || '',
    wrong: head['誤'] || '',
    right: head['正'] || '',
    tags: (head['タグ'] || '').split(/[,、]/).map((s) => s.trim()).filter(Boolean),
    body: t.slice(cut + 5).trim(),
  };
}

function loadEpisodes(dir) {
  const d = path.join(dir || EIGO_DIR, 'episodes');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /^eigo-\d{3}\.txt$/.test(f)).sort()
    .map((f) => parseEpisode(fs.readFileSync(path.join(d, f), 'utf-8'), f.replace(/\.txt$/, '')));
}

function loadState(dir) {
  const p = path.join(dir || EIGO_DIR, 'state.json');
  if (!fs.existsSync(p)) return { posted: [] };
  try { const s = JSON.parse(fs.readFileSync(p, 'utf-8')); s.posted = s.posted || []; return s; }
  catch (_e) { return { posted: [] }; }
}

function nextEpisode(eps, state) {
  const done = new Set((state.posted || []).map((p) => p.key));
  return eps.find((e) => !done.has(e.key)) || null;
}

/* 同じ週に二度出さない(最後に出してから 6 日たっていなければ出さない)。 */
function postedThisWeek(state, now) {
  const last = (state.posted || []).slice(-1)[0];
  if (!last || !last.at) return false;
  return (now.getTime() - Date.parse(last.at)) < 6 * 86400000;
}

function anecdote(ep, dir) {
  const p = path.join(dir || EIGO_DIR, 'anecdotes', ep.key + '.txt');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8').trim();
}

function label(ep) { return '第' + ep.no + '回'; }
function fullTitle(ep) { return '『' + SERIES + '』' + label(ep) + '「' + ep.title + '」'; }

/* 本文の門。出してはいけない物が一つでもあれば出さない。 */
function gateBody(ep, body) {
  const reasons = [];
  const all = String(body || '') + '\n' + ep.title;
  if (!ep.title) reasons.push('題が無い');
  if (!ep.word) reasons.push('一語が無い');
  if (!ep.right) reasons.push('正しい英語が無い');
  if (STORY.DASH_TEST.test(all)) reasons.push('ダッシュの類がある');
  if (STORY.MACHINE_RE.test(all)) reasons.push('機械の名前がある');
  if (/[*#_]/.test(all)) reasons.push('記号(* # _)がある');
  for (const h of ['■ 今週の一語', '■ 現場で使う一文', '■ 見積書ではこう書く', '■ 今週のまとめ']) {
    if (all.indexOf(h) < 0) reasons.push('「' + h + '」の段が無い');
  }
  const n = String(body || '').replace(/\s/g, '').length;
  if (n < 600 || n > 3200) reasons.push('長さが範囲の外(' + n + '字、600から3200)');
  return { ok: reasons.length === 0, reasons };
}

/* note に出す全文。体験談があれば「今週のまとめ」の前に入れる。最後に次回の予告と案内。 */
function composePost(ep, body, story, next) {
  let main = body;
  if (story) {
    const at = main.indexOf('■ 今週のまとめ');
    const block = '■ 大賀の現場\n\n' + story + '\n\n';
    main = at >= 0 ? (main.slice(0, at) + block + main.slice(at)) : (main + '\n\n' + block.trim());
  }
  const parts = [main];
  if (next) parts.push('次回 ' + label(next) + '「' + next.title + '」\n来週の日曜の朝に公開します。');
  parts.push('現場の言葉で、英語では何と言うのか知りたいものがあれば、コメントで教えてください。次の回の題にします。');
  parts.push('建設の現場で30年。いまは HORIZON SHIELD という、住む人の側に立って工事の見積もりを確かめる仕組みを作っています。業者から紹介料も掲載料も受け取りません。\n' + LP_URL);
  return parts.join('\n\n');
}

function hashtagsFor(ep) {
  const seen = new Set();
  return [].concat(ep.tags || [], COMMON_TAGS).map((t) => String(t).replace(/^#/, '').trim())
    .filter((t) => t && !seen.has(t) && seen.add(t)).slice(0, 20);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* 見出し画像(1280x670)。白地に黒、差し色は赤一色。日本の言葉、通じない英語(打ち消し線)、本当の英語。 */
function eyecatchHtml(ep) {
  const W = 1280, H = 670;
  const word = String(ep.word || '');
  const wfs = word.length <= 4 ? 150 : word.length <= 6 ? 120 : 96;
  const right = String(ep.right || '');
  const rfs = right.length <= 12 ? 92 : right.length <= 20 ? 72 : 56;
  const wrong = ep.wrong ? '<div class="wrong">' + esc(ep.wrong) + '</div>' : '';
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>'
    + 'html,body{margin:0;padding:0}body{width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff;color:#111;position:relative;'
    + 'font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans",sans-serif}'
    + '.rule{position:absolute;left:64px;right:64px;height:1px;background:#111}'
    + '.series{position:absolute;left:64px;top:44px;font-size:24px;font-weight:700;letter-spacing:.08em}'
    + '.no{position:absolute;right:64px;top:40px;font-size:30px;font-weight:900;color:#d4001a}'
    + '.word{position:absolute;left:64px;top:118px;font-size:' + wfs + 'px;font-weight:900;line-height:1.1;letter-spacing:.02em}'
    + '.wrong{position:absolute;left:68px;top:330px;font-size:54px;color:#888;text-decoration:line-through;text-decoration-thickness:4px;font-family:"Noto Sans",Arial,sans-serif}'
    + '.right{position:absolute;left:64px;top:' + (ep.wrong ? 410 : 340) + 'px;font-size:' + rfs + 'px;font-weight:800;color:#d4001a;font-family:"Noto Sans",Arial,sans-serif;letter-spacing:.01em}'
    + '.title{position:absolute;left:64px;right:64px;top:590px;font-size:26px;font-weight:700}'
    + '.brand{position:absolute;right:64px;top:596px;font-size:16px;letter-spacing:.2em;color:#555}'
    + '</style></head><body>'
    + '<div class="series">' + esc(SERIES) + '</div><div class="no">' + esc(label(ep)) + '</div>'
    + '<div class="rule" style="top:96px"></div>'
    + '<div class="word">' + esc(word) + '</div>' + wrong
    + '<div class="right">' + esc(right) + '</div>'
    + '<div class="rule" style="top:570px"></div>'
    + '<div class="title">「' + esc(ep.title) + '」</div><div class="brand">建設30年 大賀俊勝</div>'
    + '</body></html>';
}

function xText(ep, url) {
  return ep.word + 'は英語で何と言うか。' + '\n\n' + SERIES + ' ' + label(ep) + '「' + ep.title + '」\n' + url + '\n\n#現場英語 #和製英語';
}

function ownerNotice(ep, url, left, hadStory) {
  return '✅ note 現場から英語を公開\n' + label(ep) + '「' + ep.title + '」\n' + url
    + '\n書き置きの残り: ' + left + ' 回'
    + (hadStory ? '' : '\n体験談は無しで出した(足すなら note-post/eigo/anecdotes/' + ep.key + '.txt)')
    + '\n\nX に貼る文:\n' + xText(ep, url);
}

function savePosted(ep, post, url, now, dir) {
  const d = dir || EIGO_DIR;
  const st = loadState(d);
  st.posted.push({ key: ep.key, no: ep.no, title: ep.title, url, at: now.toISOString() });
  fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify(st, null, 1) + '\n');
  fs.mkdirSync(path.join(d, 'posted'), { recursive: true });
  fs.writeFileSync(path.join(d, 'posted', ep.key + '.txt'), post + '\n');
  return st;
}

module.exports = {
  EIGO_DIR, SERIES, COMMON_TAGS, parseEpisode, loadEpisodes, loadState, nextEpisode, postedThisWeek, anecdote,
  label, fullTitle, gateBody, composePost, hashtagsFor, eyecatchHtml, xText, ownerNotice, savePosted, pad3,
};
