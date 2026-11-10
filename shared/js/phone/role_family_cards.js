/* RoleFamilyCards — simulated role-issued family cards for MAOMAO.
 * These are virtual in-app benefits only; no real payment provider is contacted.
 */
(function (global) {
  'use strict';

  var KEY = 'maomao_role_family_cards_v1';

  function isValidCardsList(value) {
    if (!Array.isArray(value)) return false;
    var ids = Object.create(null);
    for (var i = 0; i < value.length; i++) {
      var item = value[i];
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          item.id == null || !String(item.id).trim()) return false;

      var id = String(item.id);
      if (ids[id]) return false;
      ids[id] = true;

      if (Object.prototype.hasOwnProperty.call(item, 'history')) {
        if (!Array.isArray(item.history)) return false;
        for (var h = 0; h < item.history.length; h++) {
          var row = item.history[h];
          if (!row || typeof row !== 'object' || Array.isArray(row) ||
              !isFinite(Number(row.amount)) || Number(row.amount) < 0) return false;
        }
      }
      if (Object.prototype.hasOwnProperty.call(item, 'paymentReceipts')) {
        if (!Array.isArray(item.paymentReceipts)) return false;
        for (var p = 0; p < item.paymentReceipts.length; p++) {
          var receipt = item.paymentReceipts[p];
          if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
              !String(receipt.paymentId || '').trim() ||
              !isFinite(Number(receipt.amount)) || Number(receipt.amount) < 0) return false;
        }
      }
      if (item.monthlyLimit != null &&
          (!isFinite(Number(item.monthlyLimit)) || Number(item.monthlyLimit) <= 0)) return false;
      if (item.singleLimit != null &&
          (!isFinite(Number(item.singleLimit)) || Number(item.singleLimit) <= 0)) return false;
      if (item.status != null &&
          ['pending', 'active', 'paused', 'revoked', 'rejected'].indexOf(item.status) === -1) return false;
    }
    return true;
  }

  function readAllState() {
    var raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (error) {
      return { ok: false, reason: 'storage', value: null };
    }
    if (raw == null) return { ok: true, reason: '', value: [] };

    var value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return { ok: false, reason: 'invalid', value: null };
    }
    if (!isValidCardsList(value)) return { ok: false, reason: 'invalid', value: null };
    return { ok: true, reason: '', value: value };
  }

  function readAll() {
    var state = readAllState();
    return state.ok ? state.value : [];
  }

  function writeAll(cards) {
    if (!Array.isArray(cards)) return false;
    // Refuse to overwrite an unreadable existing store. An empty-looking result
    // must never be mistaken for permission to replace the user's saved cards.
    var before = readAllState();
    if (!before.ok) return false;
    if (!isValidCardsList(cards)) return false;
    try {
      var serialized = JSON.stringify(cards);
      localStorage.setItem(KEY, serialized);
      // Some storage adapters can report success while retaining an older value.
      // Treat the mutation as committed only when the exact payload reads back.
      if (localStorage.getItem(KEY) !== serialized) return false;
      var after = readAllState();
      return after.ok && JSON.stringify(after.value) === serialized;
    } catch (e) { return false; }
  }

  function monthKey(timestamp) {
    var date = new Date(timestamp || Date.now());
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function usedThisMonth(card, now) {
    now = now || Date.now();
    var currentMonth = monthKey(now);
    if (Array.isArray(card && card.history)) {
      return Math.round(card.history.reduce(function (sum, item) {
        if (!item) return sum;
        var time = Number(item.time) || 0;
        if (time && monthKey(time) === currentMonth) {
          return sum + Math.max(0, Number(item.amount) || 0);
        }
        return sum;
      }, 0) * 100) / 100;
    }
    return card && card.monthKey === currentMonth
      ? Math.max(0, Number(card.used) || 0) : 0;
  }

  function find(cardId) {
    var id = String(cardId || '');
    return readAll().find(function (card) { return String(card.id) === id; }) || null;
  }

  function findForRole(roleId) {
    var id = String(roleId || '');
    return readAll().filter(function (card) {
      return String(card.roleId || '') === id;
    });
  }

  function canUse(card, amount) {
    amount = Number(amount);
    if (!card || card.status !== 'active' || !isFinite(amount) || amount <= 0) return false;
    var monthly = Number(card.monthlyLimit);
    var single = Number(card.singleLimit);
    if (!isFinite(monthly) || monthly <= 0 || !isFinite(single) || single <= 0) return false;
    if (amount > single + 0.000001) return false;
    return usedThisMonth(card) + amount <= monthly + 0.000001;
  }

  function createInvite(input) {
    input = input || {};
    var monthlyLimit = Math.round((Number(input.monthlyLimit) || 0) * 100) / 100;
    var singleLimit = Math.round((Number(input.singleLimit) || 0) * 100) / 100;
    if (!input.roleId || monthlyLimit <= 0 || singleLimit <= 0) return null;

    var state = readAllState();
    if (!state.ok) return null;
    var cards = state.value;
    var stamp = Date.now();
    var id = 'rfc_' + stamp.toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    var card = {
      id: id,
      roleId: String(input.roleId),
      roleName: String(input.roleName || '角色').slice(0, 40),
      kind: input.kind === 'intimate' ? 'intimate' : 'family',
      monthlyLimit: monthlyLimit,
      singleLimit: Math.min(singleLimit, monthlyLimit),
      note: String(input.note || '').slice(0, 160),
      status: 'pending',
      createdAt: stamp,
      acceptedAt: 0,
      history: []
    };
    cards.unshift(card);
    if (cards.length > 40) {
      while (cards.length > 40) {
        var removeIndex = -1;
        for (var ri = cards.length - 1; ri >= 0; ri--) {
          if (['rejected', 'revoked'].indexOf(cards[ri].status) !== -1) { removeIndex = ri; break; }
        }
        if (removeIndex < 0) removeIndex = cards.length - 1;
        cards.splice(removeIndex, 1);
      }
    }
    if (!writeAll(cards)) return null;
    return card;
  }

  function update(cardId, action) {
    var state = readAllState();
    if (!state.ok) return { ok: false, reason: state.reason || 'storage', card: null };
    var cards = state.value;
    var card = cards.find(function (item) { return String(item.id) === String(cardId); });
    if (!card) return { ok: false, reason: 'missing', card: null };

    if (action === 'accept' && card.status === 'pending') {
      card.status = 'active';
      card.acceptedAt = Date.now();
    } else if (action === 'reject' && card.status === 'pending') {
      card.status = 'rejected';
      card.rejectedAt = Date.now();
    } else if (action === 'pause' && card.status === 'active') {
      card.status = 'paused';
      card.pausedAt = Date.now();
    } else if (action === 'resume' && card.status === 'paused') {
      card.status = 'active';
      card.resumedAt = Date.now();
    } else {
      return { ok: false, reason: 'invalid-state', card: card };
    }

    return writeAll(cards)
      ? { ok: true, reason: '', card: card }
      : { ok: false, reason: 'storage', card: card };
  }

  function applyRoleChange(roleId, change) {
    change = change || {};
    var state = readAllState();
    if (!state.ok) return { ok: false, reason: state.reason || 'storage', card: null };
    var cards = state.value;
    var matches = cards.filter(function (card) {
      return String(card.roleId || '') === String(roleId || '') &&
        (card.status === 'active' || card.status === 'pending' || card.status === 'paused');
    });
    matches.sort(function (a, b) { return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0); });
    var card = matches[0];
    if (!card) return { ok: false, reason: 'missing', card: null };

    if (change.action === 'revoke') {
      card.status = 'revoked';
      card.revokedAt = Date.now();
    } else if (change.action === 'adjust') {
      var monthly = Number(change.monthlyLimit);
      var single = Number(change.singleLimit);
      if (!isFinite(monthly) || monthly <= 0 || !isFinite(single) || single <= 0) {
        return { ok: false, reason: 'invalid-limit', card: card };
      }
      card.monthlyLimit = Math.round(monthly * 100) / 100;
      card.singleLimit = Math.round(Math.min(single, monthly) * 100) / 100;
      if (change.note) card.note = String(change.note).slice(0, 160);
      card.adjustedAt = Date.now();
    } else {
      return { ok: false, reason: 'invalid-action', card: card };
    }

    return writeAll(cards)
      ? { ok: true, reason: '', card: card }
      : { ok: false, reason: 'storage', card: card };
  }

  function consume(cardId, amount, note, appId, transactionId) {
    var state = readAllState();
    if (!state.ok) return { ok: false, reason: state.reason || 'storage', card: null };
    var cards = state.value;
    var card = cards.find(function (item) { return String(item.id) === String(cardId); });
    if (!card) return { ok: false, reason: 'missing', card: null };

    var paymentId = String(transactionId || '').trim().slice(0, 120);
    var roundedAmount = Math.round(Number(amount) * 100) / 100;
    if (paymentId) {
      var receipts = Array.isArray(card.paymentReceipts) ? card.paymentReceipts : [];
      var previous = receipts.find(function (item) { return item && item.paymentId === paymentId; });
      if (!previous && Array.isArray(card.history)) {
        previous = card.history.find(function (item) { return item && item.paymentId === paymentId; });
      }
      if (previous) {
        var sameAmount = Math.abs(Number(previous.amount) - roundedAmount) < 0.000001;
        var sameApp = String(previous.appId || appId || 'shop') === String(appId || 'shop');
        return sameAmount && sameApp
          ? { ok: true, reason: '', card: card, record: previous, replayed: true }
          : { ok: false, reason: 'transaction-conflict', card: card };
      }
    }

    if (!canUse(card, amount)) return { ok: false, reason: 'limit', card: card };
    if (!Array.isArray(card.history)) card.history = [];
    var row = {
      amount: roundedAmount,
      note: String(note || '').slice(0, 180),
      appId: String(appId || 'shop'),
      time: Date.now()
    };
    if (paymentId) {
      row.paymentId = paymentId;
      if (!Array.isArray(card.paymentReceipts)) card.paymentReceipts = [];
      card.paymentReceipts.push({
        paymentId: paymentId,
        amount: roundedAmount,
        appId: row.appId,
        time: row.time
      });
      while (card.paymentReceipts.length > 500) card.paymentReceipts.shift();
    }
    card.history.push(row);
    while (card.history.length > 80) card.history.shift();
    card.lastUsedAt = row.time;
    return writeAll(cards) ? { ok: true, reason: '', card: card, record: row, replayed: false }
      : { ok: false, reason: 'storage', card: card };
  }

  global.RoleFamilyCards = {
    key: KEY,
    readAll: readAll,
    readState: readAllState,
    writeAll: writeAll,
    monthKey: monthKey,
    usedThisMonth: usedThisMonth,
    find: find,
    findForRole: findForRole,
    canUse: canUse,
    createInvite: createInvite,
    update: update,
    applyRoleChange: applyRoleChange,
    consume: consume
  };
})(window);
