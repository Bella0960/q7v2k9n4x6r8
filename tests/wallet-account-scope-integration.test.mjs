import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = process.cwd();
const accountScopeSource = fs.readFileSync(root + '/shared/js/mao-account-scope.js', 'utf8');
const walletLedgerSource = fs.readFileSync(root + '/shared/js/phone/wallet-ledger.js', 'utf8');

// Simulate separate signed-in pages that genuinely share one browser's native storage.
// Load the shipped account-scope script *before* the shipped wallet module, as the
// authenticated Worker injects them. The test never invents per-account wallet keys.
function nativeStorage(seed = {}) {
  const rows = new Map(Object.entries(seed));
  return {
    get length() { return rows.size; },
    key(index) { return Array.from(rows.keys())[index] ?? null; },
    getItem(key) { return rows.has(String(key)) ? rows.get(String(key)) : null; },
    setItem(key, value) { rows.set(String(key), String(value)); },
    removeItem(key) { rows.delete(String(key)); },
    clear() { rows.clear(); },
    snapshot() { return new Map(rows); }
  };
}

function loadAccountPage(nativeLocal, accountId, role = 'user') {
  const document = {
    querySelector(selector) {
      if (selector.includes('mao-account-id')) return { content: accountId };
      if (selector.includes('mao-account-role')) return { content: role };
      return null;
    },
    open() {}, write() {}, close() {},
    hidden: false
  };
  const window = {
    location: {
      origin: 'https://mao.test',
      href: 'https://mao.test/wallet/wallet.html',
      replace() {}
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({ account: { id: accountId, role, status: 'active' } })
    }),
    Headers,
    URL,
    localStorage: nativeLocal,
    sessionStorage: nativeStorage(),
    indexedDB: { open() {}, deleteDatabase() {}, databases: async () => [] },
    caches: {
      async open() { return { match: async () => null }; },
      async keys() { return []; },
      async delete() { return true; },
      async has() { return false; }
    },
    navigator: {
      locks: { request: (_name, _options, callback) => Promise.resolve().then(callback) }
    },
    addEventListener() {},
    stop() {}
  };
  vm.runInNewContext(accountScopeSource, { window, document, console, Headers, URL }, { timeout: 1000 });
  assert.equal(window.__MAO_ACCOUNT_SCOPE__?.ready, true, 'account scope must run before wallet');
  vm.runInNewContext(walletLedgerSource, { window, console }, { timeout: 1000 });
  assert.ok(window.MaoMaoWalletLedger, 'wallet must reuse the existing shared ledger');
  return { window, ledger: window.MaoMaoWalletLedger };
}

async function walletSpend(page, paymentId, amount) {
  const wallet = page.ledger.readWalletForMutation('workData');
  assert.ok(wallet);
  assert.ok(wallet.balance >= amount);
  wallet.balance = Math.round((wallet.balance - amount) * 100) / 100;
  wallet.history.unshift({
    type: 'expense', category: 'shop', paymentId, amount, time: 100
  });
  return page.ledger.runExclusive(() => page.ledger.commitWalletSnapshot(wallet));
}

test('MAO wallet uses the injected account namespace: A, B and creator cannot share balances', async () => {
  const creatorOriginal = JSON.stringify({
    balance: 340, history: [{ paymentId: 'creator-old', amount: 60 }]
  });
  const nativeLocal = nativeStorage({
    workData: creatorOriginal,
    finance_records: JSON.stringify([{ paymentId: 'creator-finance', amount: 60 }])
  });
  const a = loadAccountPage(nativeLocal, 'MAO-AAAAAAAAAAAA');
  const b = loadAccountPage(nativeLocal, 'MAO-BBBBBBBBBBBB');
  const creator = loadAccountPage(nativeLocal, 'MAO-CCCCCCCCCCCC', 'super_admin');

  assert.equal(creator.ledger.readWalletForMutation('workData').balance, 340);
  assert.equal(a.ledger.readWalletForMutation('workData').balance, 1000);
  assert.equal(b.ledger.readWalletForMutation('workData').balance, 1000);
  assert.equal(a.window.localStorage.getItem('workData'), null);
  assert.equal(b.window.localStorage.getItem('workData'), null);

  assert.equal((await walletSpend(a, 'a-shop-1', 25)).ok, true);
  assert.equal((await walletSpend(b, 'b-shop-1', 80)).ok, true);
  assert.equal((await walletSpend(creator, 'creator-shop-1', 40)).ok, true);

  assert.equal(a.ledger.readWalletForMutation('workData').balance, 975);
  assert.equal(b.ledger.readWalletForMutation('workData').balance, 920);
  assert.equal(creator.ledger.readWalletForMutation('workData').balance, 300);
  assert.deepEqual(
    Array.from(a.ledger.readWalletForMutation('workData').history, row => row.paymentId),
    ['a-shop-1']
  );
  assert.deepEqual(
    Array.from(b.ledger.readWalletForMutation('workData').history, row => row.paymentId),
    ['b-shop-1']
  );
  assert.deepEqual(
    Array.from(creator.ledger.readWalletForMutation('workData').history, row => row.paymentId),
    ['creator-shop-1', 'creator-old']
  );

  const physical = nativeLocal.snapshot();
  assert.ok(physical.has('__mao_account_v1__MAO-AAAAAAAAAAAA__workData'));
  assert.ok(physical.has('__mao_account_v1__MAO-BBBBBBBBBBBB__workData'));
  assert.equal(JSON.parse(physical.get('workData')).balance, 300,
    'creator legacy key remains the creator wallet');
  assert.equal(JSON.parse(physical.get('finance_records'))[0].paymentId, 'creator-finance',
    'normal user wallet changes must not overwrite creator finance history');

  const reopenedA = loadAccountPage(nativeLocal, 'MAO-AAAAAAAAAAAA');
  assert.equal(reopenedA.ledger.readWalletForMutation('workData').balance, 975,
    'same account and browser restart recovers its own balance');
  assert.equal(reopenedA.window.localStorage.length, 1,
    'other accounts and creator keys must be hidden in localStorage enumeration');
});

test('MAO wallet scopes pending receipts, finance lines and damaged data to one account', async () => {
  const nativeLocal = nativeStorage();
  const a = loadAccountPage(nativeLocal, 'MAO-AAAAAAAAAAAA');
  const b = loadAccountPage(nativeLocal, 'MAO-BBBBBBBBBBBB');
  const creator = loadAccountPage(nativeLocal, 'MAO-CCCCCCCCCCCC', 'super_admin');

  // Identical channel and signature must not cause a receipt to escape to
  // another account. Every ledger call uses the account-scoped storage proxy.
  const receiptA = await a.ledger.runExclusive(() => a.ledger.getOrCreatePendingCheckout('shop', 'same-cart', 'normal'));
  assert.ok(receiptA);
  assert.equal(b.ledger.getPendingCheckout('shop'), undefined);
  assert.equal(creator.ledger.getPendingCheckout('shop'), undefined);
  const receiptB = await b.ledger.runExclusive(() => b.ledger.getOrCreatePendingCheckout('shop', 'same-cart', 'normal'));
  assert.ok(receiptB);
  assert.equal(a.ledger.getPendingCheckout('shop').id, receiptA);
  assert.equal(b.ledger.getPendingCheckout('shop').id, receiptB);

  const lines = [{
    amount: 12, type: 'expense', category: '购物', note: '测试物品',
    time: '11月12日', paymentLineIndex: 0
  }];
  assert.equal((await a.ledger.runExclusive(() =>
    a.ledger.recordFinanceLines('a-purchase', lines, 'finance_records'))).ok, true);
  assert.equal(b.window.localStorage.getItem('finance_records'), null);
  assert.equal(creator.window.localStorage.getItem('finance_records'), null);
  assert.equal(JSON.parse(a.window.localStorage.getItem('finance_records'))[0].paymentId, 'a-purchase');

  const aCorrupt = a.window.localStorage.getItem('workData');
  b.window.localStorage.setItem('workData', '{broken-wallet');
  assert.equal(b.ledger.readWalletForMutation('workData'), null);
  assert.equal((await walletSpend(a, 'a-shop-2', 20)).ok, true);
  assert.equal(a.ledger.readWalletForMutation('workData').balance, 980);
  assert.equal(b.window.localStorage.getItem('workData'), '{broken-wallet');
  assert.equal(creator.ledger.readWalletForMutation('workData').balance, 1000);
  assert.equal(aCorrupt, null, 'account A legitimately began with no wallet');
});

test('MAO two-tab wallet snapshots reject stale updates within one account only', async () => {
  const nativeLocal = nativeStorage();
  const a1 = loadAccountPage(nativeLocal, 'MAO-AAAAAAAAAAAA');
  const a2 = loadAccountPage(nativeLocal, 'MAO-AAAAAAAAAAAA');
  const b = loadAccountPage(nativeLocal, 'MAO-BBBBBBBBBBBB');

  const before = a1.ledger.readWalletForMutation('workData');
  assert.equal(walletSpend(a2, 'a2-first', 10).ok, true);
  before.balance = 970;
  before.history.push({ paymentId: 'a1-stale', amount: 30 });
  assert.equal(a1.ledger.commitWalletSnapshot(before).reason, 'stale-wallet');
  assert.equal(a1.ledger.readWalletForMutation('workData').balance, 990);

  assert.equal(walletSpend(b, 'b-independent', 15).ok, true);
  assert.equal(b.ledger.readWalletForMutation('workData').balance, 985);
  assert.equal(a1.ledger.readWalletForMutation('workData').balance, 990);
});
