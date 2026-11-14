import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const walletSource = source('shared/js/phone/wallet-ledger.js');
const cardSource = source('shared/js/phone/role_family_cards.js');
const afterSalesSource = source('shared/js/phone/order-after-sales.js');

function fixture(withLocks = true) {
  const entries = new Map();
  let writes = 0;
  const localStorage = {
    getItem: key => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => { writes++; entries.set(key, String(value)); },
    removeItem: key => { writes++; entries.delete(key); }
  };
  let queue = Promise.resolve();
  const locks = {
    request: (name, options, task) => {
      assert.equal(name, 'maomao-wallet-ledger-v1');
      assert.equal(options.mode, 'exclusive');
      const next = queue.then(task);
      queue = next.catch(() => {});
      return next;
    }
  };
  const window = { localStorage, navigator: withLocks ? { locks } : {} };
  runInNewContext(walletSource, { window, localStorage });
  runInNewContext(cardSource, { window, localStorage });
  runInNewContext(afterSalesSource, { window, localStorage });
  return { window, localStorage, entries, get writes() { return writes; } };
}

test('missing browser Web Locks cannot mutate balance, receipts or family cards', async () => {
  const f = fixture(false);
  const ledger = f.window.MaoMaoWalletLedger;
  const cards = f.window.RoleFamilyCards;
  const wd = ledger.readWalletForMutation('workData');
  wd.balance -= 100;
  assert.equal(ledger.commitWalletSnapshot(wd).reason, 'mutation-lock-required');
  assert.equal(ledger.restoreWalletSnapshot('invalid', null), false);
  assert.equal(ledger.getOrCreatePendingCheckout('shop', 'cart-v1', 'normal'), null);
  assert.equal(cards.createInvite({ roleId: 'role-1', monthlyLimit: 100, singleLimit: 20 }), null);
  let executed = 0;
  await assert.rejects(ledger.runExclusive(() => { executed++; }), { code: 'cross-tab-lock-unavailable' });
  assert.equal(executed, 0);
  assert.equal(f.writes, 0);
});

test('locked wallet commits, refunds and pending receipts are consistent', async () => {
  const f = fixture(true);
  const ledger = f.window.MaoMaoWalletLedger;
  const id = await ledger.runExclusive(() => ledger.getOrCreatePendingCheckout('shop', 'cart-v1', 'normal'));
  assert.ok(id);
  assert.equal(ledger.isPendingCheckout(id), true);
  const wd = ledger.readWalletForMutation('workData');
  wd.balance = 900;
  wd.history.push({ paymentId: id, type: 'expense', amount: 100 });
  const result = await ledger.runExclusive(() => ledger.commitWalletSnapshot(wd));
  assert.equal(result.ok, true);
  assert.equal(ledger.readWalletForMutation('workData').balance, 900);
  assert.equal(await ledger.runExclusive(() => ledger.completePendingCheckout(id)), true);
  assert.equal(await ledger.runExclusive(() => ledger.completePendingCheckout(id)), true);
  assert.equal(ledger.isPendingCheckout(id), false);
  assert.equal(await ledger.runExclusive(() => ledger.restoreWalletSnapshot(result.raw, null)), true);
  assert.equal(f.localStorage.getItem('workData'), null);
  assert.equal(ledger.hasActiveMutationLock(), false);
});

test('family-card consumption uses the same lock and is idempotent', async () => {
  const f = fixture(true);
  const ledger = f.window.MaoMaoWalletLedger;
  const cards = f.window.RoleFamilyCards;
  const invite = await ledger.runExclusive(() =>
    cards.createInvite({ roleId: 'role-1', monthlyLimit: 100, singleLimit: 50 }));
  assert.ok(invite);
  assert.equal((await ledger.runExclusive(() => cards.update(invite.id, 'accept'))).ok, true);
  const spent = await ledger.runExclusive(() => cards.consume(invite.id, 12, '购物', 'shop', 'checkout-1'));
  const replay = await ledger.runExclusive(() => cards.consume(invite.id, 12, '购物', 'shop', 'checkout-1'));
  assert.equal(spent.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(cards.find(invite.id).history.length, 1);
  assert.equal(cards.usedThisMonth(cards.find(invite.id)), 12);
  assert.equal(cards.update(invite.id, 'pause').ok, false);
});

test('after-sales request is never duplicated and blocked when unsafe', async () => {
  const f = fixture(true);
  f.localStorage.setItem('shop_orders', JSON.stringify([{ paymentId: 'pay-1', total: 12, payMethod: 'normal' }]));
  f.localStorage.setItem('finance_records', JSON.stringify([{ paymentId: 'pay-1', paymentLineIndex: 0, type: 'expense', amount: 12 }]));
  const input = {
    channel: 'shop', ordersKey: 'shop_orders', financeKey: 'finance_records',
    paymentId: 'pay-1', amount: 12, paymentMethod: 'normal',
    type: 'cancel', reason: '测试申请'
  };
  const one = await f.window.MaoMaoOrderAfterSales.submit(input);
  const two = await f.window.MaoMaoOrderAfterSales.submit(input);
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  assert.equal(two.replayed, true);
  assert.equal(one.request.requestId, two.request.requestId);
  assert.equal(JSON.parse(f.localStorage.getItem('finance_records')).length, 1);
  const unsafe = fixture(false);
  assert.equal((await unsafe.window.MaoMaoOrderAfterSales.submit(input)).reason, 'cross-tab-lock-unavailable');
  assert.equal(unsafe.writes, 0);
});

test('main-based wallet scripts are versioned for PWA refresh', () => {
  const sw = source('sw.js');
  assert.match(sw, /phone-app-pwa-v206/);
  assert.match(sw, /wallet-ledger\.js\?v=20261114v12/);
  assert.match(sw, /role_family_cards\.js\?v=20261114v4/);
});
