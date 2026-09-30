'use strict';
/**
 * 見出し画像の絵(アニメの漫画風)を描く部品。
 *   1) その話の場面を一文にする(筋書きに scene があればそれ、無ければ筋から短く書かせる)
 *   2) 人物の見た目・舞台・画風・禁止事項を足して、絵の指示を組む
 *   3) 画像モデルに描かせる。OpenAI(OPENAI_API_KEY)が先。無い・駄目なら Gemini(GEMINI_API_KEY)。
 *      人物の見本 story/art/cast.png があれば一緒に渡し、顔ぶれをそろえる
 *   4) 見本がまだ無ければ、最初の一回だけ見本(主な四人の立ち姿)を描いて保存する
 * 失敗しても投稿は止めない。絵が無ければ、文字だけの見出し画像に戻る。
 * 絵に文字は描かせない(日本語の字は崩れるため)。題と話数は、あとで HTML で上に載せる。
 */
const fs = require('fs');
const path = require('path');

const ART_DIR = path.join(__dirname, 'story', 'art');
const CAST_SHEET = path.join(ART_DIR, 'cast.png');

const OPENAI_API = 'https://api.openai.com/v1';
const OPENAI_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2'];
const OPENAI_SIZES = ['1536x864', '1536x1024'];   // 16:9 を先に。断られたら横長の標準寸法

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODELS = ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'];

/* 応答から画像の base64 を探す。OpenAI(data[].b64_json)、Gemini の Interactions API(output_image.data)、
   従来の generateContent(candidates[].content.parts[].inlineData.data)を受ける。
   渡した見本の絵(input など)は、返ってきた絵と取り違えないよう見ない。 */
function findImage(obj) {
  if (obj && Array.isArray(obj.data) && obj.data[0] && typeof obj.data[0].b64_json === 'string') {
    return { data: obj.data[0].b64_json, mime: 'image/' + (obj.output_format || 'png') };
  }
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return null;
    seen.add(o);
    const mime = o.mime_type || o.mimeType || '';
    if (typeof o.data === 'string' && o.data.length > 200 && (/^image\//.test(mime) || !mime)) return { data: o.data, mime: mime || 'image/png' };
    for (const k of ['output_image', 'outputImage', 'inlineData', 'inline_data']) {
      if (o[k]) { const r = walk(o[k]); if (r) return r; }
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'input' || k === 'contents' || k === 'request' || k === 'images') continue;
      if (v && typeof v === 'object') { const r = walk(v); if (r) return r; }
    }
    return null;
  };
  if (obj && obj.output_image) { const r = walk(obj.output_image); if (r) return r; }
  if (obj && Array.isArray(obj.outputs)) {
    for (const x of obj.outputs) { if (x && (x.type === 'image' || x.mime_type || x.mimeType)) { const r = walk(x); if (r) return r; } }
  }
  return walk(obj);
}

function castLines(outline, names) {
  const cast = (outline.art && outline.art.cast) || {};
  return (names || []).filter((n) => cast[n]).map((n) => cast[n]);
}

function artPrompt(outline, ep, scene) {
  const a = outline.art || {};
  const useCast = ep.cast_in_art !== false;
  const people = useCast ? castLines(outline, ep.must) : [];
  const parts = [a.style || 'Original anime-style illustration, Japanese manga cover look, 16:9.'];
  parts.push('Scene: ' + scene);
  if (people.length) parts.push('Characters (use the same faces, hair and clothes as the attached reference sheet if one is attached; draw a new scene, not the sheet itself): ' + people.join('; ') + '.');
  if (useCast) parts.push('Setting: ' + (a.setting || 'a seaside town in Japan'));
  parts.push(a.rules || 'No text anywhere in the image.');
  return parts.join('\n');
}

function castSheetPrompt(outline) {
  const a = outline.art || {};
  const names = a.cast_sheet || ['ムニョス', '美波', '航一', 'ハル'];
  return [a.style || 'Original anime-style illustration.',
    'Character reference sheet for an original series: the following characters stand side by side, full body, front view, evenly lit, on a plain light background.',
    castLines(outline, names).join('; ') + '.',
    'Absolutely no text, labels, names, numbers, logos or watermarks. Original characters only.'].join('\n');
}

/* 場面の一文を、筋から短く書かせる(英語、四十語ほど、文字は描かせない)。失敗したら決まり文句。 */
async function sceneFromBeats(ep, opts) {
  const o = opts || {};
  const fallback = 'The big bearded Spanish carpenter holds an old wooden ruler and looks toward the sea from a sloping street in a small Japanese seaside town, morning light.';
  if (ep.scene) return ep.scene;
  if (!o.anthropicKey) return fallback;
  const fetchImpl = o.fetchImpl || fetch;
  const who = (ep.must || []).join('、');
  const prompt = '次の連載小説の一話から、見出し画像にする一場面を選び、英語の一文(40語ほど)で描写してください。'
    + '出てくる人物は次の名前の人だけ: ' + who + '。人物は名前ではなく見た目で書く(例: the big bearded Spanish carpenter, the granddaughter, the elderly woman)。'
    + '看板や紙の文字、吹き出し、実在の会社や人物は入れない。一文だけを出力する。\n\n題: ' + ep.title + '\n筋: ' + (ep.beats || '');
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': o.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: o.sceneModel || 'claude-sonnet-4-6', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) return fallback;
    const j = await r.json();
    const t = ((j && j.content) || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    return t && t.length > 20 && t.length < 600 ? t : fallback;
  } catch (_e) { return fallback; }
}

const errText = (j) => String((j && j.error && (j.error.message || j.error)) || '').slice(0, 140);

/* OpenAI で一枚描く。見本があれば /images/edits(images に data URL)、無ければ /images/generations。
   寸法で断られたら、横長の標準寸法でもう一度。 */
async function drawOpenAI(prompt, refs, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const models = o.openaiModels || (process.env.NOTE_ART_OPENAI_MODEL ? [process.env.NOTE_ART_OPENAI_MODEL].concat(OPENAI_MODELS) : OPENAI_MODELS);
  const imgs = (refs || []).filter(Boolean);
  const tried = [];
  for (const model of models) {
    for (const size of OPENAI_SIZES) {
      const body = { model, prompt, n: 1, size, quality: o.quality || 'medium', output_format: 'png' };
      let url = OPENAI_API + '/images/generations';
      if (imgs.length) {
        url = OPENAI_API + '/images/edits';
        body.images = imgs.map((b) => ({ image_url: 'data:image/png;base64,' + b.toString('base64') }));
      }
      try {
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + o.openaiKey },
          body: JSON.stringify(body),
        });
        let j = null; try { j = await r.json(); } catch (_e) { j = null; }
        if (r.ok) {
          const im = findImage(j);
          if (im) return { ok: true, buf: Buffer.from(im.data, 'base64'), mime: im.mime, model, via: 'openai' + (imgs.length ? '-edits' : '') };
          tried.push(model + ' openai: 画像が返らない');
          break;
        }
        const msg = errText(j);
        tried.push(model + ' openai ' + size + ': ' + r.status + ' ' + msg);
        if (!(r.status === 400 && /size/i.test(msg))) break;   // 寸法で断られたときだけ、次の寸法を試す
      } catch (e) { tried.push(model + ' openai: ' + String(e.message || e).slice(0, 80)); break; }
    }
  }
  return { ok: false, tried };
}

/* Gemini で一枚描く(控え)。Interactions API、駄目なら従来の generateContent。 */
async function drawGemini(prompt, refs, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const models = o.geminiModels || GEMINI_MODELS;
  const tried = [];
  const imgs = (refs || []).filter(Boolean);
  for (const model of models) {
    try {
      const input = [{ type: 'text', text: prompt }].concat(imgs.map((b) => ({ type: 'image', mime_type: 'image/png', data: b.toString('base64') })));
      const r = await fetchImpl(GEMINI_API + '/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.geminiKey },
        body: JSON.stringify({ model, input, response_format: { type: 'image', aspect_ratio: '16:9' } }),
      });
      let j = null; try { j = await r.json(); } catch (_e) { j = null; }
      if (r.ok) {
        const im = findImage(j);
        if (im) return { ok: true, buf: Buffer.from(im.data, 'base64'), mime: im.mime, model, via: 'gemini-interactions' };
        tried.push(model + ' gemini: 画像が返らない');
      } else tried.push(model + ' gemini: ' + r.status + ' ' + errText(j));
    } catch (e) { tried.push(model + ' gemini: ' + String(e.message || e).slice(0, 80)); }
    try {
      const parts = [{ text: prompt }].concat(imgs.map((b) => ({ inline_data: { mime_type: 'image/png', data: b.toString('base64') } })));
      const r = await fetchImpl(GEMINI_API + '/models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.geminiKey },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } } }),
      });
      let j = null; try { j = await r.json(); } catch (_e) { j = null; }
      if (r.ok) {
        const im = findImage(j);
        if (im) return { ok: true, buf: Buffer.from(im.data, 'base64'), mime: im.mime, model, via: 'gemini-generateContent' };
        tried.push(model + ' gemini(旧): 画像が返らない');
      } else tried.push(model + ' gemini(旧): ' + r.status + ' ' + errText(j));
    } catch (e) { tried.push(model + ' gemini(旧): ' + String(e.message || e).slice(0, 80)); }
  }
  return { ok: false, tried };
}

/* 描ける先を順に試す。OpenAI、次に Gemini。 */
async function drawAny(prompt, refs, o) {
  const tried = [];
  if (o.openaiKey) {
    const r = await drawOpenAI(prompt, refs, o);
    if (r.ok) return r;
    tried.push(...r.tried);
  }
  if (o.geminiKey) {
    const r = await drawGemini(prompt, refs, o);
    if (r.ok) return r;
    tried.push(...r.tried);
  }
  return { ok: false, tried };
}

/* その話の絵を用意する。人物の見本が無ければ先に作って保存する(次の回から顔ぶれがそろう)。 */
async function makeArt(outline, ep, opts) {
  const o = opts || {};
  if (!o.openaiKey && !o.geminiKey) return { ok: false, why: 'OPENAI_API_KEY も GEMINI_API_KEY も無いので、文字だけの見出し画像にする' };
  const notes = [];
  let sheet = null;
  const sheetPath = o.castSheetPath || CAST_SHEET;
  if (fs.existsSync(sheetPath)) sheet = fs.readFileSync(sheetPath);
  else if (ep.cast_in_art !== false) {
    const s = await drawAny(castSheetPrompt(outline), [], o);
    if (s.ok) {
      fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
      fs.writeFileSync(sheetPath, s.buf);
      sheet = s.buf;
      notes.push('人物の見本を作った(' + s.model + ')');
    } else notes.push('人物の見本を作れなかった: ' + s.tried.join(' | ').slice(0, 300));
  }
  const scene = await sceneFromBeats(ep, { anthropicKey: o.anthropicKey, fetchImpl: o.fetchImpl, sceneModel: o.sceneModel });
  const prompt = artPrompt(outline, ep, scene);
  const r = await drawAny(prompt, (ep.cast_in_art !== false && sheet) ? [sheet] : [], o);
  if (!r.ok) return { ok: false, why: '絵を描けなかった: ' + r.tried.join(' | ').slice(0, 400), notes, scene };
  return { ok: true, buf: r.buf, mime: r.mime, model: r.model, via: r.via, notes, scene, prompt };
}

module.exports = { ART_DIR, CAST_SHEET, OPENAI_MODELS, GEMINI_MODELS, findImage, artPrompt, castSheetPrompt, sceneFromBeats, drawOpenAI, drawGemini, drawAny, makeArt };
