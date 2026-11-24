/* MAOMAO cloud outbox -> existing ChatHistoryAtomic contract.
 * Fail closed: no local-save ACK until the exact server message is persisted,
 * read back, and still belongs to the authenticated account/role.
 * No paid model calls, remote URLs or chat-history full-array replacement.
 */
(function (global) {
  'use strict';
  var ACCOUNT = /^MAO-[A-Z0-9]{12,24}$/;
  var SERVER_ID = /^[A-Za-z0-9_-]{16,128}$/;

  function create(options) {
    var opts = options || {};
    var accountId = String(opts.accountId || '');
    var roleId = String(opts.roleId || '');
    var cloud = opts.cloud;
    if (!ACCOUNT.test(accountId) || !roleId || roleId.length > 96 ||
        !cloud || typeof cloud.receiveCharacterOutboundMessages !== 'function' ||
        typeof opts.verifySession !== 'function') return null;

    var running = false, stopped = false, timer = null, bound = false, lastWarning = 0;

    function accountReady() {
      var meta = global.document && global.document.querySelector('meta[name="mao-account-id"]');
      var current = String(meta && (meta.content || meta.getAttribute('content')) || '');
      var scope = global.__MAO_ACCOUNT_SCOPE__;
      return Boolean(current === accountId && scope && scope.ready === true &&
        scope.accountId === accountId);
    }

    function active() {
      return !stopped && accountReady() &&
        global.document.visibilityState !== 'hidden' &&
        global.navigator && global.navigator.onLine !== false;
    }

    function inspectPersisted(messageId, expectedText) {
      var raw;
      try { raw = global.localStorage.getItem('chat_history_' + roleId); }
      catch (error) { return false; }
      if (raw == null) return false;
      var list;
      try { list = JSON.parse(raw); }
      catch (error) { return false; }
      if (!Array.isArray(list)) return false;
      var found = list.filter(function (m) {
        return m && (m.mid === 'cloud_' + messageId ||
          String(m.serverMessageId || '') === messageId);
      });
      return found.length === 1 && found[0].mid === 'cloud_' + messageId &&
        found[0].serverMessageId === messageId &&
        found[0].role === 'assistant' && found[0].text === expectedText &&
        found[0].source === 'cloud_autonomous';
    }

    async function verifySession() {
      if (!active()) return false;
      try { return (await opts.verifySession(accountId)) === true && active(); }
      catch (error) { return false; }
    }

    async function persist(payload, envelope) {
      if (!active() || !global.ChatHistoryAtomic ||
          typeof global.ChatHistoryAtomic.appendManyIf !== 'function' ||
          !envelope || typeof envelope !== 'object' ||
          String(envelope.characterId || '') !== roleId ||
          !SERVER_ID.test(String(envelope.serverMessageId || '')) ||
          !payload || typeof payload !== 'object' || Array.isArray(payload) ||
          String(payload.type || 'text') !== 'text' ||
          typeof payload.text !== 'string') return false;
      var text = payload.text.trim();
      if (!text || text.length > 10000) return false;
      if (!await verifySession()) return false;

      var id = String(envelope.serverMessageId);
      var timestamp = Number(envelope.createdAt);
      var message = {
        role: 'assistant',
        text: text,
        time: Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : Date.now(),
        mid: 'cloud_' + id,
        serverMessageId: id,
        source: 'cloud_autonomous'
      };
      var result;
      try {
        // ChatHistoryAtomic takes the same per-account/per-role Web Lock used
        // by existing local writers and performs byte-for-byte readback.
        // Never nest it inside a second Web Lock (locks are not reentrant).
        result = await global.ChatHistoryAtomic.appendManyIf(roleId, [message], function (latest) {
          return accountReady() && Array.isArray(latest);
        });
      } catch (error) { return false; }
      if (!result || result.ok !== true || !active() ||
          !inspectPersisted(id, text)) return false;
      if (result.value && result.value.appended === 1 && typeof opts.onSaved === 'function') {
        try { opts.onSaved(message); } catch (error) {}
      }
      return true;
    }

    async function sync() {
      if (running || !active()) return null;
      var readDevice = cloud._internal && cloud._internal.readDevice;
      if (typeof readDevice !== 'function' || !readDevice() ||
          !await verifySession()) return null;
      running = true;
      try {
        return await cloud.receiveCharacterOutboundMessages(roleId, persist, 10);
      } catch (error) {
        var now = Date.now();
        if (now - lastWarning > 60000) {
          lastWarning = now;
          console.warn('[cloud-inbox] 云消息仍保留在服务器，稍后继续补拉');
        }
        return null;
      } finally {
        running = false;
      }
    }

    function onActivity() { if (active()) sync(); }

    function start() {
      if (stopped) return null;
      if (!bound) {
        global.document.addEventListener('visibilitychange', onActivity);
        global.addEventListener('pageshow', onActivity);
        global.addEventListener('online', onActivity);
        bound = true;
      }
      if (timer == null) timer = global.setInterval(sync, 15000);
      sync();
      return api;
    }

    function stop() {
      stopped = true;
      if (timer != null) global.clearInterval(timer);
      timer = null;
      if (bound) {
        global.document.removeEventListener('visibilitychange', onActivity);
        global.removeEventListener('pageshow', onActivity);
        global.removeEventListener('online', onActivity);
        bound = false;
      }
    }

    var api = { start: start, stop: stop, sync: sync, persist: persist, accountReady: accountReady };
    return api;
  }

  global.MaomaoCloudAtomicInbox = { create: create };
})(window);
