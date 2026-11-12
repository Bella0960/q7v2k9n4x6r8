/**
 * MAOMAO wallet browser-engine preflight. No login/password or real transactions.
 * Desktop Playwright Chromium and WebKit with mobile touch settings are NOT
 * physical Android / iOS Safari / PWA acceptance tests.
 * Run: npm run test:wallet:mobile-engines
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = { a: 'MAO-AAAAAAAAAAAA', b: 'MAO-BBBBBBBBBBBB', owner: 'MAO-CCCCCCCCCCCC' };
const resources = {
  '/shared/js/mao-account-scope.js': 'shared/js/mao-account-scope.js',
  '/shared/js/phone/wallet-ledger.js': 'shared/js/phone/wallet-ledger.js'
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/__wallet_preflight__.html') {
      const id = url.searchParams.get('id') || '';
      const role = url.searchParams.get('role') || 'user';
      if (!/^MAO-[A-Z]{12}$/.test(id) || !['user', 'super_admin'].includes(role)) {
        res.writeHead(400).end('Invalid fixture'); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html><head><meta charset="utf-8">' +
        '<meta name="mao-account-id" content="' + id + '">' +
        '<meta name="mao-account-role" content="' + role + '">' +
        '<script src="/shared/js/mao-account-scope.js"></script>' +
        '<script src="/shared/js/phone/wallet-ledger.js"></script>' +
        '</head><body>MAOMAO wallet preflight</body></html>'); return;
    }
    if (resources[url.pathname]) {
      const bytes = await readFile(resolve(root, resources[url.pathname]));
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(bytes); return;
    }
    res.writeHead(404).end('Missing fixture');
  } catch {
    res.writeHead(500).end('Fixture error');
  }
});

async function openPage(context, origin, id, role = 'user') {
  const page = await context.newPage();
  // A per-page mock auth response; real account authorization is tested separately.
  await page.route('**/api/accounts/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: { id, role, status: 'active' } })
  }));
  const url = new URL('/__wallet_preflight__.html', origin);
  url.searchParams.set('id', id); url.searchParams.set('role', role);
  assert.equal((await page.goto(url.href, { waitUntil: 'load' }))?.status(), 200);
  await page.waitForFunction(() => window.__MAO_ACCOUNT_SCOPE__?.ready &&
    typeof window.MaoMaoWalletLedger?.commitWalletSnapshot === 'function',
    null, { timeout: 10000 });
  return page;
}

async function wallet(page) {
  return page.evaluate(() => {
    const w = window.MaoMaoWalletLedger.readWalletForMutation('workData');
    return w && { balance: w.balance, ids: w.history.map(x => x.paymentId) };
  });
}
async function spend(page, id, amount) {
  return page.evaluate(({ id, amount }) => {
    const ledger = window.MaoMaoWalletLedger, w = ledger.readWalletForMutation('workData');
    if (!w || w.balance < amount) return { ok: false };
    w.balance = Math.round((w.balance - amount) * 100) / 100;
    w.history.unshift({ type: 'expense', paymentId: id, amount, time: Date.now() });
    return ledger.commitWalletSnapshot(w);
  }, { id, amount });
}

async function run(browserType, device, label, origin) {
  const browser = await browserType.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...(devices[device] || {}), viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, serviceWorkers: 'block'
    });
    try {
      const owner = await openPage(context, origin, ids.owner, 'super_admin');
      await owner.evaluate(() => localStorage.setItem('workData', JSON.stringify({
        balance: 340, history: [{ paymentId: 'old-owner' }]
      })));
      const a = await openPage(context, origin, ids.a);
      const b = await openPage(context, origin, ids.b);
      assert.deepEqual(await wallet(a), { balance: 1000, ids: [] });
      assert.deepEqual(await wallet(b), { balance: 1000, ids: [] });
      assert.deepEqual(await wallet(owner), { balance: 340, ids: ['old-owner'] });
      assert.equal((await spend(a, 'a-shop', 25)).ok, true);
      assert.equal((await spend(b, 'b-shop', 80)).ok, true);
      assert.equal((await spend(owner, 'owner-shop', 40)).ok, true);
      assert.deepEqual(await wallet(a), { balance: 975, ids: ['a-shop'] });
      assert.deepEqual(await wallet(b), { balance: 920, ids: ['b-shop'] });
      assert.deepEqual(await wallet(owner), { balance: 300, ids: ['owner-shop', 'old-owner'] });

      const receipt = await a.evaluate(() => window.MaoMaoWalletLedger
        .getOrCreatePendingCheckout('shop', 'cart-a', 'normal'));
      assert.ok(receipt);
      assert.equal(await b.evaluate(() => window.MaoMaoWalletLedger.getPendingCheckout('shop')), undefined);
      const finance = await a.evaluate(() => window.MaoMaoWalletLedger.recordFinanceLines(
        'a-payment', [{ paymentLineIndex: 0, type: 'expense', category: '购物', amount: 25 }],
        'finance_records'));
      assert.equal(finance.ok, true);
      assert.equal(await b.evaluate(() => localStorage.getItem('finance_records')), null);

      const a2 = await openPage(context, origin, ids.a);
      await a.evaluate(() => { window.__oldWallet = window.MaoMaoWalletLedger.readWalletForMutation('workData'); });
      assert.equal((await spend(a2, 'a2-shop', 15)).ok, true);
      assert.equal(await a.evaluate(() => {
        const stale = window.__oldWallet;
        stale.balance -= 30;
        stale.history.push({ paymentId: 'stale' });
        return window.MaoMaoWalletLedger.commitWalletSnapshot(stale).reason;
      }), 'stale-wallet');
      assert.deepEqual(await wallet(a), { balance: 960, ids: ['a2-shop', 'a-shop'] });
      assert.equal((await wallet(b)).balance, 920);
      const local = (await context.storageState()).origins
        .find(x => x.origin === origin)?.localStorage || [];
      const keys = local.map(x => x.name);
      for (const key of [
        'workData',
        '__mao_account_v1__' + ids.a + '__workData',
        '__mao_account_v1__' + ids.b + '__workData'
      ]) assert.ok(keys.includes(key), 'missing account wallet key: ' + key);
      const locks = await a.evaluate(() => window.MaoMaoWalletLedger.supportsCrossTabLock());
      console.log('PASS [' + label + '] two accounts, owner, receipts, stale snapshots');
      console.log('ENGINE_CAPABILITIES=' + JSON.stringify({
        engine: label, devicePreset: device, webLocksAvailable: locks,
        limitation: 'mobile-like desktop browser engine; not physical phone'
      }));
    } finally { await context.close(); }
  } finally { await browser.close(); }
}

await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const origin = 'http://127.0.0.1:' + server.address().port;
let failed = false;
try {
  for (const [engine, device, label] of [
    [chromium, 'Pixel 7', 'Android-style Chromium'],
    [webkit, 'iPhone 13', 'iPhone-style WebKit']
  ]) {
    try { await run(engine, device, label, origin); }
    catch (error) {
      failed = true;
      console.error('FAIL / NOT RUN [' + label + '] ' + (error?.stack || error));
    }
  }
} finally {
  await new Promise(resolveServer => server.close(resolveServer));
}
if (failed) {
  console.error('The cross-engine preflight did not complete both engines.');
  process.exitCode = 1;
} else {
  console.log('BROWSER_ENGINE_PREFLIGHT_PASS=2/2; PHYSICAL_ANDROID_IOS_TESTS=NOT_RUN');
}
