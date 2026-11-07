/* MAOMAO order after-sales request journal.
 * This only records a cancellation / after-sales request against the original
 * simulated expense rows. It never changes balances, card quotas, or order delivery
 * status, and it never claims that a refund has been paid.
 */
(function (global) {
  'use strict';

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function makeRequestId() {
    var random = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    return 'mm-as-' + String(random).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  }

  function readArray(key) {
    try {
      var raw = global.localStorage.getItem(key);
      if (raw == null || raw === '') return { ok: false, reason: 'missing' };
      var value = JSON.parse(raw);
      return Array.isArray(value) ? { ok: true, value: value } : { ok: false, reason: 'invalid' };
    } catch (error) {
      return { ok: false, reason: 'invalid' };
    }
  }

  function saveArray(key, rows) {
    try {
      var serialized = JSON.stringify(rows);
      global.localStorage.setItem(key, serialized);
      return global.localStorage.getItem(key) === serialized;
    } catch (error) {
      return false;
    }
  }

  function findUniqueOrder(rows, paymentId) {
    var matches = rows.filter(function (row) {
      return row && String(row.paymentId || '') === paymentId;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function validatePaymentLines(rows, order, paymentId, amount, requestId) {
    var lines = rows.filter(function (row) {
      return row && String(row.paymentId || '') === paymentId;
    });
    if (!lines.length) return { ok: false, reason: 'payment-lines-missing' };

    var total = 0;
    var lineIndexes = Object.create(null);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineAmount = Number(line.amount);
      if (line.type !== 'expense' || !isFinite(lineAmount) || lineAmount < 0) {
        return { ok: false, reason: 'payment-lines-invalid' };
      }
      total += lineAmount;
      if (line.paymentLineIndex != null) {
        var index = String(line.paymentLineIndex);
        if (lineIndexes[index]) return { ok: false, reason: 'payment-lines-duplicate' };
        lineIndexes[index] = true;
      }
      if (line.afterSalesRequestId && String(line.afterSalesRequestId) !== requestId) {
        return { ok: false, reason: 'another-request-linked' };
      }
    }
    if (Math.abs(roundMoney(total) - amount) > 0.009) {
      return { ok: false, reason: 'payment-amount-mismatch' };
    }
    return { ok: true, lines: lines };
  }

  function submitLocked(input) {
    input = input || {};
    var channel = String(input.channel || '');
    var paymentId = String(input.paymentId || '').trim();
    var ordersKey = String(input.ordersKey || '');
    var financeKey = String(input.financeKey || '');
    var requestedType = String(input.type || '');
    var reason = String(input.reason || '').trim().slice(0, 160);
    var amount = roundMoney(input.amount);
    var paymentMethod = String(input.paymentMethod || '');

    if (['shop', 'takeout'].indexOf(channel) === -1 ||
        !paymentId || paymentId.length > 120 ||
        !ordersKey || !financeKey ||
        ['cancel', 'after_sales'].indexOf(requestedType) === -1 ||
        !reason || !isFinite(amount) || amount <= 0 || !paymentMethod) {
      return { ok: false, reason: 'invalid-input' };
    }

    var orderRead = readArray(ordersKey);
    if (!orderRead.ok) return { ok: false, reason: 'orders-' + orderRead.reason };
    var order = findUniqueOrder(orderRead.value, paymentId);
    if (!order) return { ok: false, reason: 'order-missing-or-duplicate' };
    if (Math.abs(roundMoney(order.total) - amount) > 0.009 ||
        String(order.payMethod || '') !== paymentMethod) {
      return { ok: false, reason: 'order-payment-conflict' };
    }

    var financeRead = readArray(financeKey);
    if (!financeRead.ok) return { ok: false, reason: 'finance-' + financeRead.reason };

    var request = order.afterSales;
    var preflight = validatePaymentLines(
      financeRead.value,
      order,
      paymentId,
      amount,
      request && request.requestId ? String(request.requestId) : ''
    );
    if (!preflight.ok) return { ok: false, reason: preflight.reason };

    var requestId;
    var requestedAt;
    if (request) {
      if (typeof request !== 'object' || Array.isArray(request) ||
          !request.requestId || request.paymentId !== paymentId ||
          request.channel !== channel ||
          Math.abs(roundMoney(request.amount) - amount) > 0.009 ||
          String(request.paymentMethod || '') !== paymentMethod ||
          request.type !== requestedType || request.reason !== reason) {
        return { ok: false, reason: 'request-conflict' };
      }
      if (request.status === 'pending_review' && request.journalStatus === 'linked') {
        var completedLines = validatePaymentLines(financeRead.value, order, paymentId, amount, request.requestId);
        if (!completedLines.ok || completedLines.lines.some(function (line) {
          return line.afterSalesRequestId !== request.requestId ||
            line.afterSalesStatus !== 'pending_review';
        })) return { ok: false, reason: 'linked-record-mismatch' };
        return { ok: true, request: request, replayed: true };
      }
      if (request.status !== 'recording' || request.journalStatus !== 'recording') {
        return { ok: false, reason: 'request-already-exists' };
      }
      requestId = String(request.requestId);
      requestedAt = Number(request.requestedAt);
      if (!requestId || !isFinite(requestedAt) || requestedAt <= 0) {
        return { ok: false, reason: 'request-invalid' };
      }
    } else {
      requestId = makeRequestId();
      requestedAt = Date.now();
      order.afterSales = {
        requestId: requestId,
        paymentId: paymentId,
        channel: channel,
        amount: amount,
        paymentMethod: paymentMethod,
        type: requestedType,
        reason: reason,
        status: 'recording',
        journalStatus: 'recording',
        requestedAt: requestedAt
      };
      if (!saveArray(ordersKey, orderRead.value)) {
        return { ok: false, reason: 'orders-write', requestId: requestId };
      }
    }

    var lineCheck = validatePaymentLines(financeRead.value, order, paymentId, amount, requestId);
    if (!lineCheck.ok) return { ok: false, reason: lineCheck.reason, requestId: requestId };

    var changedFinance = false;
    lineCheck.lines.forEach(function (line) {
      if (line.afterSalesRequestId === requestId &&
          line.afterSalesStatus === 'pending_review' &&
          line.afterSalesType === requestedType) return;
      line.afterSalesRequestId = requestId;
      line.afterSalesStatus = 'pending_review';
      line.afterSalesType = requestedType;
      line.afterSalesRequestedAt = requestedAt;
      changedFinance = true;
    });
    if (changedFinance && !saveArray(financeKey, financeRead.value)) {
      return { ok: false, reason: 'finance-write', requestId: requestId };
    }

    var verifyFinance = readArray(financeKey);
    if (!verifyFinance.ok) return { ok: false, reason: 'finance-readback', requestId: requestId };
    var verifiedLines = validatePaymentLines(verifyFinance.value, order, paymentId, amount, requestId);
    if (!verifiedLines.ok || verifiedLines.lines.some(function (line) {
      return line.afterSalesRequestId !== requestId ||
        line.afterSalesStatus !== 'pending_review' ||
        line.afterSalesType !== requestedType;
    })) {
      return { ok: false, reason: 'finance-readback', requestId: requestId };
    }

    var latestOrders = readArray(ordersKey);
    if (!latestOrders.ok) return { ok: false, reason: 'orders-readback', requestId: requestId };
    var latestOrder = findUniqueOrder(latestOrders.value, paymentId);
    if (!latestOrder || !latestOrder.afterSales ||
        latestOrder.afterSales.requestId !== requestId ||
        latestOrder.afterSales.status !== 'recording') {
      return { ok: false, reason: 'orders-request-conflict', requestId: requestId };
    }
    latestOrder.afterSales.status = 'pending_review';
    latestOrder.afterSales.journalStatus = 'linked';
    latestOrder.afterSales.linkedAt = Date.now();
    if (!saveArray(ordersKey, latestOrders.value)) {
      return { ok: false, reason: 'orders-finalize', requestId: requestId };
    }

    var verifyOrders = readArray(ordersKey);
    if (!verifyOrders.ok) return { ok: false, reason: 'orders-final-readback', requestId: requestId };
    var finalOrder = findUniqueOrder(verifyOrders.value, paymentId);
    if (!finalOrder || !finalOrder.afterSales ||
        finalOrder.afterSales.requestId !== requestId ||
        finalOrder.afterSales.status !== 'pending_review' ||
        finalOrder.afterSales.journalStatus !== 'linked') {
      return { ok: false, reason: 'orders-final-readback', requestId: requestId };
    }
    return { ok: true, request: finalOrder.afterSales, replayed: false };
  }

  function canSubmit(input) {
    input = input || {};
    var channel = String(input.channel || '');
    var paymentId = String(input.paymentId || '').trim();
    var ordersKey = String(input.ordersKey || '');
    var financeKey = String(input.financeKey || '');
    var amount = roundMoney(input.amount);
    var paymentMethod = String(input.paymentMethod || '');
    if (['shop', 'takeout'].indexOf(channel) === -1 ||
        !paymentId || !ordersKey || !financeKey ||
        !isFinite(amount) || amount <= 0 || !paymentMethod) {
      return { ok: false, reason: 'invalid-input' };
    }
    var orderRows = readArray(ordersKey);
    if (!orderRows.ok) return { ok: false, reason: 'orders-' + orderRows.reason };
    var order = findUniqueOrder(orderRows.value, paymentId);
    if (!order) return { ok: false, reason: 'order-missing-or-duplicate' };
    if (Math.abs(roundMoney(order.total) - amount) > 0.009 ||
        String(order.payMethod || '') !== paymentMethod) {
      return { ok: false, reason: 'order-payment-conflict' };
    }
    var financeRows = readArray(financeKey);
    if (!financeRows.ok) return { ok: false, reason: 'finance-' + financeRows.reason };
    var requestId = order.afterSales && order.afterSales.requestId
      ? String(order.afterSales.requestId) : '';
    var verified = validatePaymentLines(financeRows.value, order, paymentId, amount, requestId);
    if (!verified.ok) return verified;
    return { ok: true, order: order, lineCount: verified.lines.length };
  }

  function submit(input) {
    var ledger = global.MaoMaoWalletLedger;
    if (!ledger || typeof ledger.runExclusive !== 'function') {
      return Promise.resolve({ ok: false, reason: 'module' });
    }
    return ledger.runExclusive(function () {
      return submitLocked(input);
    }, {
      onFallback: function () {
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[order-after-sales] Web Locks unavailable; fallback is page-local only');
        }
      }
    }).catch(function (error) {
      if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[order-after-sales] request failed', error);
      }
      return { ok: false, reason: 'storage' };
    });
  }

  global.MaoMaoOrderAfterSales = Object.freeze({
    canSubmit: canSubmit,
    submit: submit
  });
})(window);
