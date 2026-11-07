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

  global.MaoMaoWalletLedger = Object.freeze({
    lockName: LOCK_NAME,
    runExclusive: runExclusive,
    supportsCrossTabLock: function () {
      return !!(global.navigator && global.navigator.locks &&
        typeof global.navigator.locks.request === 'function');
    }
  });
})(window);
