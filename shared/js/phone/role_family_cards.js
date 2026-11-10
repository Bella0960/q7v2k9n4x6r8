/* RoleFamilyCards — simulated role-issued family cards for MAOMAO.
 * These are virtual in-app benefits only; no real payment provider is contacted.
 */
(function (global) {
  'use strict';

  var KEY = 'maomao_role_family_cards_v1';

  function readAll() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value.filter(function (item) {
        return item && typeof item === 'object' && item.id;
      }) : [];
    } catch (e) { return []; }
  }

  function writeAll(cards) {
    try {
      var serialized = JSON.stringify(Array.isArray(cards) ? cards : []);
      localStorage.setItem(KEY, serialized);
      // Some storage adapters can report success while retaining an older value.
      // Treat the mutation as committed only when the exact payload reads back.
      return localStorage.getItem(KEY) === serialized;
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

    var cards = readAll();
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
    var cards = readAll();
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
    var cards = readAll();
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
    var cards = readAll();
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
