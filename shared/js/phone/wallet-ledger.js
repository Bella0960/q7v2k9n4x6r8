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

  function readStoredCheckouts() {
    try {
      var raw = global.localStorage.getItem(PENDING_CHECKOUT_KEY);
      if (raw == null) return [];
      var value = JSON.parse(raw);
      if (!Array.isArray(value)) return null;

      var ids = Object.create(null);
      var pendingChannels = Object.create(null);
      for (var i = 0; i < value.length; i++) {
        var item = value[i];
        if (!item || typeof item !== 'object' ||
            typeof item.id !== 'string' || !item.id ||
            typeof item.channel !== 'string' || !item.channel ||
            typeof item.signature !== 'string' || !item.signature ||
            (item.status !== 'pending' && item.status !== 'completed') ||
            ids[item.id]) return null;
        ids[item.id] = true;
        if (item.status === 'pending') {
          if (pendingChannels[item.channel]) return null;
          pendingChannels[item.channel] = true;
        }
      }
      return value;
    } catch (error) {
      return null;
    }
  }

  function readPendingCheckouts() {
    var rows = readStoredCheckouts();
    return rows ? rows.filter(function (item) { return item.status === 'pending'; }) : null;
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

  function getOrCreatePendingCheckout(channel, signature, paymentMethod) {
    channel = String(channel || '').trim().slice(0, 32);
    signature = String(signature || '');
    paymentMethod = String(paymentMethod || 'normal').slice(0, 64);
    if (!channel || !signature || signature.length > 8000) return null;

    var rows = readPendingCheckouts();
    if (!rows) return null;
    var existing = rows.find(function (item) { return item.channel === channel; });
    if (existing) {
      // Only one unresolved checkout per channel is allowed. This also prevents a
      // changed cart from bypassing an earlier partial commit and being charged again.
      return existing.signature === signature &&
        String(existing.paymentMethod || 'normal') === paymentMethod ? existing.id : null;
    }

    var randomPart = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    var id = 'mmchk_' + String(randomPart).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
    if (rows.some(function (item) { return item.id === id; })) return null;

    rows.push({
      id: id,
      channel: channel,
      signature: signature,
      paymentMethod: paymentMethod,
      status: 'pending',
      createdAt: Date.now()
    });
    return writePendingCheckouts(rows) ? id : null;
  }

  function cancelPendingCheckout(transactionId) {
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

  function getPendingCheckout(channel) {
    channel = String(channel || '').trim().slice(0, 32);
    if (!channel) return null;
    var rows = readPendingCheckouts();
    if (!rows) return null;
    var item = rows.find(function (row) { return row.channel === channel; });
    if (!item) return undefined;
    return {
      id: item.id,
      channel: item.channel,
      signature: item.signature,
      paymentMethod: item.paymentMethod || 'normal',
      createdAt: item.createdAt
    };
  }

  function isPendingCheckout(transactionId) {
    transactionId = String(transactionId || '');
    if (!transactionId) return false;
    var rows = readPendingCheckouts();
    if (!rows) return null;
    return rows.some(function (item) { return item.id === transactionId; });
  }

  function completePendingCheckout(transactionId) {
    transactionId = String(transactionId || '');
    if (!transactionId) return false;
    var rows = readStoredCheckouts();
    if (!rows) return false;
    var target = rows.find(function (item) { return item.id === transactionId; });
    if (!target) return true;
    if (target.status === 'completed') return true;
    target.status = 'completed';
    target.completedAt = Date.now();
    var serialized = JSON.stringify(rows);
    try {
      global.localStorage.setItem(PENDING_CHECKOUT_KEY, serialized);
      if (global.localStorage.getItem(PENDING_CHECKOUT_KEY) !== serialized) return false;
      var verified = readStoredCheckouts();
      var saved = verified && verified.find(function (item) { return item.id === transactionId; });
      return !!saved && saved.status === 'completed';
    } catch (error) {
      return false;
    }
  }

  // Read the wallet snapshot used by a balance mutation. Missing storage keeps the
  // app's first-use balance; malformed existing data fails closed and is never
  // silently replaced with a fabricated balance.
  function readWalletForMutation(storageKey, rawOverride) {
    storageKey = String(storageKey || 'workData');
    var raw;
    try {
      if (arguments.length > 1) {
        raw = rawOverride;
      } else {
        if (!global.localStorage || typeof global.localStorage.getItem !== 'function') return null;
        raw = global.localStorage.getItem(storageKey);
      }
    } catch (error) {
      return null;
    }

    if (raw == null) return { balance: 1000, history: [] };

    var wallet;
    try {
      wallet = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet) ||
        typeof wallet.balance !== 'number' || !isFinite(wallet.balance) ||
        wallet.balance < 0) {
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(wallet, 'history')) wallet.history = [];
    else if (!Array.isArray(wallet.history)) return null;
    return wallet;
  }

  function readClosePayState(storageKey, rawOverride) {
    storageKey = String(storageKey || 'close_pay');
    var raw;
    try {
      if (arguments.length > 1) raw = rawOverride;
      else {
        if (!global.localStorage || typeof global.localStorage.getItem !== 'function') {
          return { ok: false, reason: 'storage', value: null };
        }
        raw = global.localStorage.getItem(storageKey);
      }
    } catch (error) {
      return { ok: false, reason: 'storage', value: null };
    }

    var defaults = {
      enabled: false,
      roleId: '',
      roleName: '',
      limit: 500,
      used: 0,
      history: []
    };
    if (raw == null) return { ok: true, reason: '', value: defaults };

    var data;
    try { data = JSON.parse(raw); }
    catch (error) { return { ok: false, reason: 'invalid', value: null }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'invalid', value: null };
    }

    if (Object.prototype.hasOwnProperty.call(data, 'enabled') && typeof data.enabled !== 'boolean') {
      return { ok: false, reason: 'invalid', value: null };
    }
    for (var key of ['roleId', 'roleName', 'roleAvatar']) {
      if (Object.prototype.hasOwnProperty.call(data, key) && typeof data[key] !== 'string') {
        return { ok: false, reason: 'invalid', value: null };
      }
    }

    var limit = Object.prototype.hasOwnProperty.call(data, 'limit') ? Number(data.limit) : 500;
    var used = Object.prototype.hasOwnProperty.call(data, 'used') ? Number(data.used) : 0;
    if (!isFinite(limit) || limit < 0 || !isFinite(used) || used < 0) {
      return { ok: false, reason: 'invalid', value: null };
    }

    var history = Object.prototype.hasOwnProperty.call(data, 'history') ? data.history : [];
    if (!Array.isArray(history)) return { ok: false, reason: 'invalid', value: null };
    var paymentIds = Object.create(null);
    for (var i = 0; i < history.length; i++) {
      var row = history[i];
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          !isFinite(Number(row.amount)) || Number(row.amount) <= 0 ||
          !isFinite(Number(row.time)) || Number(row.time) <= 0 ||
          (row.note != null && typeof row.note !== 'string') ||
          (row.paymentId != null && typeof row.paymentId !== 'string')) {
        return { ok: false, reason: 'invalid', value: null };
      }
      if (row.paymentId) {
        if (paymentIds[row.paymentId]) return { ok: false, reason: 'invalid', value: null };
        paymentIds[row.paymentId] = true;
      }
    }

    var value = Object.assign({}, data, {
      enabled: Object.prototype.hasOwnProperty.call(data, 'enabled') ? data.enabled : false,
      roleId: Object.prototype.hasOwnProperty.call(data, 'roleId') ? data.roleId : '',
      roleName: Object.prototype.hasOwnProperty.call(data, 'roleName') ? data.roleName : '',
      limit: limit,
      used: used,
      history: history
    });
    return { ok: true, reason: '', value: value };
  }

  function readClosePayForMutation(storageKey, rawOverride) {
    var state = arguments.length > 1
      ? readClosePayState(storageKey, rawOverride)
      : readClosePayState(storageKey);
    return state.ok ? state.value : null;
  }

  global.MaoMaoWalletLedger = Object.freeze({
    lockName: LOCK_NAME,
    runExclusive: runExclusive,
    readWalletForMutation: readWalletForMutation,
    readClosePayState: readClosePayState,
    readClosePayForMutation: readClosePayForMutation,
    getOrCreatePendingCheckout: getOrCreatePendingCheckout,
    cancelPendingCheckout: cancelPendingCheckout,
    isPendingCheckout: isPendingCheckout,
    getPendingCheckout: getPendingCheckout,
    completePendingCheckout: completePendingCheckout,
    supportsCrossTabLock: function () {
      return !!(global.navigator && global.navigator.locks &&
        typeof global.navigator.locks.request === 'function');
    }
  });
})(window);
