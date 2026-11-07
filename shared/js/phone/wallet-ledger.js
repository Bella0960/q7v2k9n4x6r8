/* MAOMAO wallet ledger coordination.
 * All in-app balance mutations share one origin-wide exclusive lock where Web Locks
 * are available. Older browsers get page-local serialization and an explicit fallback
 * signal; that fallback does not claim cross-tab safety.
 */
(function (global) {
  'use strict';

  var LOCK_NAME = 'maomao-wallet-ledger-v1';
  var fallbackQueue = Promise.resolve();
  var fallbackNoticeShown = false;

  function runExclusive(task, options) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('wallet ledger task must be a function'));
    }
    options = options || {};

    var locks = global.navigator && global.navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(LOCK_NAME, { mode: 'exclusive' }, function () {
        return task();
      });
    }

    if (!fallbackNoticeShown) {
      fallbackNoticeShown = true;
      if (typeof options.onFallback === 'function') {
        try { options.onFallback(); } catch (e) {}
      }
    }

    var run = fallbackQueue.then(task, task);
    fallbackQueue = run.then(function () {}, function () {});
    return run;
  }

  var PENDING_CHECKOUT_KEY = 'maomao_wallet_pending_checkouts_v1';

  function readPendingCheckouts() {
    try {
      var value = JSON.parse(global.localStorage.getItem(PENDING_CHECKOUT_KEY) || '[]');
      return Array.isArray(value) ? value.filter(function (item) {
        return item && typeof item.id === 'string' && item.id &&
          item.status === 'pending';
      }) : null;
    } catch (error) {
      return null;
    }
  }

  function writePendingCheckouts(rows) {
    try {
      var serialized = JSON.stringify(rows);
      global.localStorage.setItem(PENDING_CHECKOUT_KEY, serialized);
      return global.localStorage.getItem(PENDING_CHECKOUT_KEY) === serialized;
    } catch (error) {
      return false;
    }
  }

  function getOrCreatePendingCheckout(channel, signature) {
    channel = String(channel || '').trim().slice(0, 32);
    signature = String(signature || '');
    if (!channel || !signature || signature.length > 8000) return null;

    var rows = readPendingCheckouts();
    if (!rows) return null;
    var existing = rows.find(function (item) {
      return item.channel === channel && item.signature === signature;
    });
    if (existing) return existing.id;

    var randomPart = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    var id = 'mmchk_' + String(randomPart).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
    if (rows.some(function (item) { return item.id === id; })) return null;

    rows.push({
      id: id,
      channel: channel,
      signature: signature,
      status: 'pending',
      createdAt: Date.now()
    });
    return writePendingCheckouts(rows) ? id : null;
  }

  function completePendingCheckout(transactionId) {
    transactionId = String(transactionId || '');
    if (!transactionId) return false;
    var rows = readPendingCheckouts();
    if (!rows) return false;
    var next = rows.filter(function (item) { return item.id !== transactionId; });
    if (next.length === rows.length) return true;
    if (!writePendingCheckouts(next)) return false;
    var verified = readPendingCheckouts();
    return !!verified && !verified.some(function (item) { return item.id === transactionId; });
  }

  global.MaoMaoWalletLedger = Object.freeze({
    lockName: LOCK_NAME,
    runExclusive: runExclusive,
    getOrCreatePendingCheckout: getOrCreatePendingCheckout,
    completePendingCheckout: completePendingCheckout,
    supportsCrossTabLock: function () {
      return !!(global.navigator && global.navigator.locks &&
        typeof global.navigator.locks.request === 'function');
    }
  });
})(window);
