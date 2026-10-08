// 2026-10-08: /webhook/paypal の照合(受取人、通貨、金額 5500 JPY、txn_id の重複、custom の orderId を置き場に使わない)の試験。
// 実行: node workers/hs-pdf-gen/test/ipn_test.mjs  (PayPal・LINE・KV・R2 は偽物。ブラウザは無いので、照合を通った通知は PDF の手前の 500 で止まる = 通った印)
import w from '../src/worker.js';

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : fail++; console.log((ok ? 'ok   ' : 'NG   ') + name + (ok || detail === undefined ? '' : '  <<< ' + detail)); };

let mem, r2calls, lineSent, verified;
const reset = () => { mem = new Map(); r2calls = []; lineSent = []; verified = 'VERIFIED'; };
const ORDERS = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { mem.set(k, v); } };
const PDFS_BUCKET = { get: async (k) => { r2calls.push('GET ' + k); return null; }, put: async (k) => { r2calls.push('PUT ' + k); } };
globalThis.fetch = async (u, o) => {
  const url = String(u);
  if (url.includes('ipnpb.paypal.com')) return new Response(verified);
  if (url.includes('api.line.me')) { lineSent.push(JSON.parse(o.body).messages[0].text); return new Response('{}'); }
  return new Response('{}');
};
const MERCHANT = 'ABCDEFGHJKLMN';
const mkEnv = (over = {}) => ({ ORDERS, PDFS_BUCKET, PAYPAL_MERCHANT_ID: MERCHANT, LINE_USER_ID: 'U1', LINE_CHANNEL_TOKEN: 'x', ENVIRONMENT: 'production', ...over });
const ipn = (over = {}) => new URLSearchParams({ payment_status: 'Completed', receiver_id: MERCHANT, receiver_email: 'shop@example.com', mc_currency: 'JPY', mc_gross: '5500', txn_id: 'TXN0001', payer_email: 'payer@example.com', first_name: 'Taro', ...over }).toString();
const post = async (body, env = mkEnv()) => {
  const r = await w.fetch(new Request('https://hs-pdf-gen.example/webhook/paypal', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }), env, { waitUntil() {} });
  let j = null; const text = await r.text(); try { j = JSON.parse(text); } catch (_e) {}
  return { status: r.status, j, text };
};
const orderKeys = () => [...mem.keys()].filter((k) => k.startsWith('order:'));
const origError = console.error, origLog = console.log;
console.error = () => {};
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };

// ---- PayPal が VERIFIED と言わない通知 ----
reset(); verified = 'INVALID';
{
  const r = await quiet(() => post(ipn()));
  t('VERIFIED でない通知は 400、何も書かない', r.status === 400 && mem.size === 0 && r2calls.length === 0, r.status);
}
// ---- 受取人 ----
reset();
{
  let r = await post(ipn({ receiver_id: 'SOMEONEELSE99', receiver_email: 'attacker@example.com', business: 'attacker@example.com' }));
  t('他人宛ての支払いの通知は skipped、注文も PDF も作らない', r.status === 200 && r.j.skipped === 'receiver mismatch' && orderKeys().length === 0 && r2calls.length === 0, r.text);
  t('合わなかった通知は ipn-skip に理由だけ残す', mem.has('ipn-skip:TXN0001') && JSON.parse(mem.get('ipn-skip:TXN0001')).reason === 'receiver mismatch');
  t('受取人が違うだけの通知では LINE を鳴らさない', lineSent.length === 0, lineSent);
  reset();
  r = await post(ipn(), mkEnv({ PAYPAL_MERCHANT_ID: undefined }));
  t('PAYPAL_MERCHANT_ID もメールも未設定なら誰も通さない', r.j.skipped === 'receiver mismatch' && orderKeys().length === 0, r.text);
  reset();
  r = await post(ipn({ receiver_id: '', receiver_email: 'Shop@Example.com' }), mkEnv({ PAYPAL_MERCHANT_ID: undefined, PAYPAL_RECEIVER_EMAIL: 'shop@example.com' }));
  t('メールで照らす設定でも通る(大文字小文字は問わない)', r.status === 500 && orderKeys().join() === 'order:paypal-TXN0001', r.status + ' ' + r.text.slice(0, 80));
}
// ---- 通貨と金額 ----
for (const [name, over, why] of [
  ['通貨が JPY でない', { mc_currency: 'USD' }, 'currency mismatch'],
  ['金額が 55000', { mc_gross: '55000' }, 'amount mismatch 55000 vs 5500'],
  ['金額が 1', { mc_gross: '1' }, 'amount mismatch 1 vs 5500'],
  ['金額が数でない', { mc_gross: 'abc' }, 'amount mismatch NaN vs 5500'],
]) {
  reset();
  const r = await post(ipn(over));
  t(name + ' → skipped、注文も PDF も作らない', r.status === 200 && r.j.skipped === why && orderKeys().length === 0 && r2calls.length === 0, r.text);
  t(name + ' → TOshi に LINE で知らせる', lineSent.length === 1 && lineSent[0].includes('TXN0001'), lineSent);
}
reset();
{
  const r = await post(ipn({ mc_gross: '5500.00' }));
  t('5500.00 は 5500 として通る', r.status === 500 && orderKeys().join() === 'order:paypal-TXN0001', r.text.slice(0, 80));
}
// ---- txn_id ----
reset();
{
  let r = await post(ipn({ txn_id: '' }));
  t('txn_id が無い通知は skipped', r.j.skipped === 'no txn id' && orderKeys().length === 0, r.text);
  reset();
  mem.set('txn:TXN0001', 'paypal-TXN0001');
  r = await post(ipn());
  t('処理済みの txn_id は duplicate、何も作らない', r.status === 200 && r.j.duplicate === true && orderKeys().length === 0 && r2calls.length === 0 && lineSent.length === 0, r.text);
  reset();
  r = await post(ipn());
  t('PDF が作れなかった通知は 500(PayPal が再送する)、重複の印はまだ書かない', r.status === 500 && !mem.has('txn:TXN0001'), r.status);
  r = await post(ipn());
  t('再送された通知はもう一度処理される', r.status === 500 && r2calls.filter((c) => c === 'GET souba-db.json').length === 2, r2calls);
  reset();
  r = await post(ipn({ txn_id: '../../pdfs/x TXN-9' }));
  t('txn_id は英数字だけにして使う', orderKeys().join() === 'order:paypal-pdfsxTXN9', orderKeys());
}
// ---- custom の orderId を置き場に使わない ----
reset();
{
  mem.set('order:pp-VICTIM', JSON.stringify({ orderId: 'pp-VICTIM', status: 'paid', pdfUrl: '' }));
  const custom = encodeURIComponent(JSON.stringify({ orderId: 'pp-VICTIM', koji_type: 'gaiheki_30tsubo', teiji_kingaku: 900000, region: '<img src=x>', customer_name: { a: 1 }, amount: 1, service_type: 'x'.repeat(500) }));
  const r = await post(ipn({ custom }));
  const rec = JSON.parse(mem.get('order:paypal-TXN0001') || 'null');
  t('custom に他の注文の名前を書いても、注文は txn_id の名前で作る', r.status === 500 && rec && rec.orderId === 'paypal-TXN0001' && rec.txnId === 'TXN0001', r.text.slice(0, 80));
  t('他の注文の記録には触らない', mem.get('order:pp-VICTIM') === JSON.stringify({ orderId: 'pp-VICTIM', status: 'paid', pdfUrl: '' }));
  t('R2 にも他の注文の名前で触らない', !r2calls.some((c) => c.includes('VICTIM')) && !r2calls.some((c) => c.startsWith('PUT ')), r2calls);
  t('金額は PayPal の mc_gross、custom の amount は使わない', rec.amount === '5500', rec.amount);
  t('custom の欄は文字列だけ、長さを絞る', rec.customerName === 'Taro' && rec.serviceType.length === 40 && rec.region.length <= 20, JSON.stringify(rec).slice(0, 200));
  for (const bad of ['5', '[1,2]', 'null', '"x"', '%7Bbroken']) {
    reset();
    const r2 = await post(ipn({ custom: bad }));
    if (!(r2.status === 500 && orderKeys().join() === 'order:paypal-TXN0001')) t('custom が object でなくても落ちない (' + bad + ')', false, r2.status + ' ' + r2.text.slice(0, 80));
  }
  t('custom が object でなくても落ちない', true);
}
// ---- Completed でない通知は従来どおり ----
reset();
{
  const r = await post(ipn({ payment_status: 'Pending' }));
  t('Completed でない通知は従来どおり skipped', r.status === 200 && r.j.skipped === 'Pending' && mem.size === 0, r.text);
}

console.error = origError;
console.log('\n' + (fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'PASS ' + pass + '/' + (pass + fail)) + ' (ipn: 受取人、通貨、金額 5500 JPY、txn_id の重複、置き場は txn_id から)');
process.exit(fail ? 1 : 0);
