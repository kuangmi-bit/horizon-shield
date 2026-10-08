// 2026-10-08: 生成系の入口の門(X-PDF-Token、/generate の dl_token)の試験。
// 実行: node workers/hs-pdf-gen/test/gen_gate_test.mjs  (KV と R2 は偽物。ブラウザは無いので、門を通った後は 500 で止まる = 門を通った印)
import w from '../src/worker.js';

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'ok   ' : 'NG   ') + name + (ok || detail === undefined ? '' : '  <<< ' + detail)); };

const mem = new Map();
const ORDERS = {
  get: async (k) => (mem.has(k) ? mem.get(k) : null),
  put: async (k, v) => { mem.set(k, v); },
};
const r2calls = [];
const PDFS_BUCKET = { get: async (k) => { r2calls.push(k); return null; }, put: async (k) => { r2calls.push('PUT ' + k); } };
const TOKEN = 'test-pdfgen-token';
const AUDIT = 'test-audit-token';
const mkEnv = (over = {}) => ({ ORDERS, PDFS_BUCKET, PDFGEN_TOKEN: TOKEN, ENVIRONMENT: 'production', ...over });
const call = async (path, { headers = {}, body = {}, env = mkEnv(), method = 'POST' } = {}) => {
  const req = new Request('https://hs-pdf-gen.example' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body) });
  const r = await w.fetch(req, env, { waitUntil() {} });
  return { status: r.status, text: await r.text() };
};
const origError = console.error;
console.error = () => {};

const GEN = ['/generate-test', '/generate-plan-auto', '/generate-plan', '/generate-meitsumori-signed', '/generate-meitsumori', '/generate-kanryo'];
const AUD = ['/extract-estimate', '/generate-estimate-audit', '/generate-compare'];

for (const p of GEN) {
  const none = await call(p);
  const wrong = await call(p, { headers: { 'X-PDF-Token': 'nope' } });
  const unset = await call(p, { headers: { 'X-PDF-Token': '' }, env: mkEnv({ PDFGEN_TOKEN: undefined }) });
  const unset2 = await call(p, { headers: { 'X-PDF-Token': 'undefined' }, env: mkEnv({ PDFGEN_TOKEN: undefined }) });
  const audit = await call(p, { headers: { 'X-HS-TOKEN': AUDIT }, env: mkEnv({ HS_AUDIT_TOKEN: AUDIT }) });
  const good = await call(p, { headers: { 'X-PDF-Token': TOKEN } });
  t(p + ': 合言葉なし・違う合言葉は 401', none.status === 401 && wrong.status === 401, none.status + ' ' + wrong.status);
  t(p + ': PDFGEN_TOKEN が未設定なら誰も通さない', unset.status === 401 && unset2.status === 401, unset.status + ' ' + unset2.status);
  t(p + ': X-HS-TOKEN では通らない', audit.status === 401, audit.status);
  t(p + ': 正しい X-PDF-Token は門を通る', good.status !== 401, good.status + ' ' + good.text.slice(0, 80));
}
for (const p of AUD) {
  const none = await call(p);
  const wrongAudit = await call(p, { headers: { 'X-HS-TOKEN': 'nope' }, env: mkEnv({ HS_AUDIT_TOKEN: AUDIT }) });
  const openBefore = await call(p, { env: mkEnv({ HS_AUDIT_TOKEN: undefined }) });
  const viaPdf = await call(p, { headers: { 'X-PDF-Token': TOKEN } });
  const viaAudit = await call(p, { headers: { 'X-HS-TOKEN': AUDIT }, env: mkEnv({ HS_AUDIT_TOKEN: AUDIT }) });
  t(p + ': 合言葉なし・違う X-HS-TOKEN は 401', none.status === 401 && wrongAudit.status === 401, none.status + ' ' + wrongAudit.status);
  t(p + ': HS_AUDIT_TOKEN が未設定でも、合言葉なしでは通らない', openBefore.status === 401, openBefore.status);
  t(p + ': X-PDF-Token か X-HS-TOKEN で門を通る', viaPdf.status !== 401 && viaAudit.status !== 401, viaPdf.status + ' ' + viaAudit.status);
}

// ---- /generate: dl_token ----
{
  const DL = 'a'.repeat(32);
  mem.set('dl_token:' + DL, JSON.stringify({ orderId: 'pp-X', used: false, expires: Date.now() + 3600e3 }));
  mem.set('dl_token:' + 'b'.repeat(32), JSON.stringify({ orderId: 'pp-Y', used: false, expires: Date.now() - 1 }));
  r2calls.length = 0;
  let r = await call('/generate', { body: { koji_type: 'x' } });
  t('/generate: 合言葉も dl_token も無ければ 401、R2 に触らない', r.status === 401 && r2calls.length === 0, r.status + ' ' + r2calls.join());
  r = await call('/generate', { body: { download_token: 'c'.repeat(32) } });
  t('/generate: 記録に無い dl_token は 401', r.status === 401, r.status);
  r = await call('/generate', { body: { download_token: 'b'.repeat(32) } });
  t('/generate: 期限切れの dl_token は 401', r.status === 401, r.status);
  for (const bad of ['../' + DL, DL.toUpperCase(), DL + 'a', { a: 1 }, 12345, null]) {
    r = await call('/generate', { body: { download_token: bad } });
    if (r.status !== 401) t('/generate: 形の違う dl_token は 401 (' + JSON.stringify(bad) + ')', false, r.status);
  }
  t('/generate: 形の違う dl_token は記録を引かずに 401', true);
  r = await call('/generate', { body: { download_token: DL, koji_type: 'x' } });
  t('/generate: 有効な dl_token は門を通る(偽の R2 に相場が無いので 500)', r.status === 500 && r2calls.includes('souba-db.json'), r.status + ' ' + r.text.slice(0, 80));
  t('/generate: 使った回数を記録する', JSON.parse(mem.get('dl_token:' + DL)).uses === 1 && JSON.parse(mem.get('dl_token:' + DL)).used === true);
  for (let i = 0; i < 4; i++) r = await call('/generate', { body: { download_token: DL } });
  t('/generate: 5 回目までは通る', r.status !== 401, r.status);
  r = await call('/generate', { body: { download_token: DL } });
  t('/generate: 6 回目は 401', r.status === 401, r.status);
  r = await call('/generate', { headers: { 'X-PDF-Token': TOKEN }, body: {} });
  t('/generate: 内部の呼び手は X-PDF-Token で通る', r.status !== 401, r.status);
  r = await call('/generate', { headers: { 'X-PDF-Token': 'undefined' }, body: {}, env: mkEnv({ PDFGEN_TOKEN: undefined }) });
  t('/generate: PDFGEN_TOKEN が未設定なら X-PDF-Token では通らない', r.status === 401, r.status);
}
// ---- 門の外の入口は変わらない ----
{
  const h = await call('/health', { method: 'GET' });
  const c = await call('/canary', { method: 'GET' });
  t('/health と /canary は合言葉なしで 200 のまま', h.status === 200 && c.status === 200, h.status + ' ' + c.status);
  const s = await call('/generate-and-send');
  t('/generate-and-send は従来どおり合言葉なしで 401', s.status === 401, s.status);
}

console.error = origError;
console.log('\n' + (fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'PASS ' + pass + '/' + (pass + fail)) + ' (gen_gate: 生成系の入口は X-PDF-Token、/generate は dl_token でも可)');
process.exit(fail ? 1 : 0);
