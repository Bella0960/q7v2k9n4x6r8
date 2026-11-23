/* MAOMAO cloud outbox -> one-role chat history bridge.
 * No model calls and no uploaded chat text. A server ACK is permitted only
 * after a matching row has been saved and read back on this exact account.
 * Legacy writers do not share our lock: this is not global history atomicity.
 */
(function (global) {
  'use strict';

  var MESSAGE_ID = /^[A-Za-z0-9_-]{16,128}$/;
  var ACCOUNT_ID = /^MAO-[A-Z0-9]{12,24}$/;

  function create(options) {
    var opts = options || {};
    var roleId = String(opts.roleId || '');
    var accountId = String(opts.accountId || '');
    var cloud = opts.cloud;
    if (!roleId || roleId.length > 96 || !ACCOUNT_ID.test(accountId) ||
        !cloud || typeof cloud.receiveCharacterOutboundMessages !== 'function' ||
        typeof opts.readHistory !== 'function' ||
        typeof opts.saveHistory !== 'function') return null;

    var stopped = false;
    var running = false;
    var timer = null;
    var lastErrorAt = 0;
    var eventsBound = false;

    function accountReady() {
      var meta = global.document &&
        global.document.querySelector('meta[name="mao-account-id"]');
      var actualId = String(meta && (meta.content || meta.getAttribute('content')) || '');
      var scope = global.__MAO_ACCOUNT_SCOPE__;
      // An account meta tag alone is not storage isolation. Never use unscoped
      // localStorage for cloud writes if the injected account script is missing.
      return actualId === accountId && scope && scope.ready === true &&
        scope.accountId === accountId;
    }

    function active() {
      return !stopped && accountReady() && global.document.visibilityState !== 'hidden' &&
        global.navigator && global.navigator.onLine !== false;
    }

    function inspect(history, serverMessageId, text) {
      if (!Array.isArray(history)) return 'conflict';
      var matching = history.filter(function (item) {
        return item && (String(item.serverMessageId || '') === serverMessageId ||
          String(item.mid || '') === 'cloud_' + serverMessageId);
      });
      if (!matching.length) return 'missing';
      if (matching.length !== 1) return 'conflict';
      var item = matching[0];
      var itemText = typeof item.text === 'string' ? item.text
        : (typeof item.content === 'string' ? item.content : null);
      return item.role === 'assistant' && itemText === text &&
        String(item.serverMessageId || '') === serverMessageId &&
        String(item.mid || '') === 'cloud_' + serverMessageId
        ? 'match' : 'conflict';
    }

    function validEnvelope(payload, envelope) {
      if (!active() || !envelope || typeof envelope !== 'object' ||
          !MESSAGE_ID.test(String(envelope.serverMessageId || '')) ||
          String(envelope.characterId || '') !== roleId ||
          !payload || typeof payload !== 'object' || Array.isArray(payload) ||
          String(payload.type || 'text') !== 'text' ||
          typeof payload.text !== 'string') return null;
      var text = payload.text.trim();
      return text && text.length <= 10000 ? {
        id: String(envelope.serverMessageId), text: text,
        time: Number.isSafeInteger(Number(envelope.createdAt)) &&
          Number(envelope.createdAt) > 0 ? Number(envelope.createdAt) : Date.now()
      } : null;
    }

    async function verifySession() {
      if (!active()) return false;
      if (typeof opts.verifySession === 'function') {
        try { return (await opts.verifySession(accountId)) === true && active(); }
        catch (error) { return false; }
      }
      return false;
    }

    async function persist(payload, envelope) {
      var parsed = validEnvelope(payload, envelope);
      if (!parsed || !global.navigator.locks ||
          typeof global.navigator.locks.request !== 'function') return false;
      // Fetching outbox with a device key validates the session once, but a
      // different browser tab can switch accounts during the await. Verify
      // the active HttpOnly session again before touching local chat history.
      if (!await verifySession()) return false;

      var changedMessage = null;
      var lockName = 'maomao:chat-history:' + encodeURIComponent(accountId) +
        ':' + encodeURIComponent(roleId);
      var saved = false;
      try {
        saved = await global.navigator.locks.request(lockName, { mode: 'exclusive' },
          async function () {
            if (!active()) return false;
            var latest = opts.readHistory();
            if (!Array.isArray(latest)) return false;
            var found = inspect(latest, parsed.id, parsed.text);
            if (found === 'match') return true;
            if (found !== 'missing') return false;

            var message = {
              role: 'assistant',
              text: parsed.text,
              time: parsed.time,
              mid: 'cloud_' + parsed.id,
              serverMessageId: parsed.id,
              source: 'cloud_autonomous'
            };
            var next = latest.concat([message]);
            // Use the existing verified chat save path; do not bypass its
            // quota/damage guards, data migration, or account-aware storage.
            var persisted = await opts.saveHistory(next);
            if (persisted !== true) return false;
            var readBack = opts.readHistory();
            if (!Array.isArray(readBack) || readBack.length !== next.length ||
                inspect(readBack, parsed.id, parsed.text) !== 'match') return false;
            // Check that earlier records were not silently truncated or
            // rewritten by a racing legacy full-history writer.
            for (var i = 0; i < latest.length; i += 1) {
              if (JSON.stringify(latest[i]) !== JSON.stringify(readBack[i])) return false;
            }
            if (!active()) return false;
            changedMessage = message;
            return true;
          });
      } catch (error) {
        return false;
      }
      if (saved === true && changedMessage && typeof opts.onSaved === 'function') {
        try { opts.onSaved(changedMessage); } catch (error) {
          // A render failure must not erase a message already verified on disk.
        }
      }
      return saved === true;
    }

    async function sync() {
      if (running || !active()) return null;
      var readDevice = cloud._internal && cloud._internal.readDevice;
      if (typeof readDevice !== 'function' || !readDevice()) return null;
      if (!global.navigator.locks ||
          typeof global.navigator.locks.request !== 'function') return null;
      if (!await verifySession()) return null;
      running = true;
      try {
        return await cloud.receiveCharacterOutboundMessages(roleId, persist, 10);
      } catch (error) {
        // Keep the entire server outbox pending. Do not leak chat text or
        // device credentials into diagnostics. Retry on the next foreground tick.
        var now = Date.now();
        if (now - lastErrorAt > 60000) {
          lastErrorAt = now;
          console.warn('[cloud-inbox] 同步暂不可用，服务器消息保留待重试');
        }
        return null;
      } finally {
        running = false;
      }
    }

    function onVisibility() {
      if (active()) sync();
    }

    function onPageShow() {
      if (active()) sync();
    }

    function onOnline() {
      if (active()) sync();
    }

    function start() {
      if (stopped) return null;
      if (!eventsBound) {
        global.document.addEventListener('visibilitychange', onVisibility);
        global.addEventListener('pageshow', onPageShow);
        global.addEventListener('online', onOnline);
        eventsBound = true;
      }
      if (timer === null) timer = global.setInterval(sync, 15000);
      sync();
      return api;
    }

    function stop() {
      stopped = true;
      if (timer !== null) global.clearInterval(timer);
      timer = null;
      if (eventsBound) {
        global.document.removeEventListener('visibilitychange', onVisibility);
        global.removeEventListener('pageshow', onPageShow);
        global.removeEventListener('online', onOnline);
        eventsBound = false;
      }
    }

    var api = {
      persist: persist,
      sync: sync,
      start: start,
      stop: stop,
      isAccountReady: accountReady
    };
    return api;
  }

  global.MaomaoCloudInbox = { create: create };
})(window);
