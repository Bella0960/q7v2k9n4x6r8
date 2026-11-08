/* MAOMAO 云端连接客户端（Milestone 1）
 *
 * 职责：
 *  - 生成并保存“设备凭据”（只存在本机 localStorage，用于云端设备授权）
 *  - 注册 Service Worker 并申请通知权限
 *  - 订阅 / 退订 Web Push，调用受授权的 test-push 接口
 *  - 为设置页提供连接状态展示
 *
 * 安全边界：这里不包含、也不请求任何 AI API Key 或 VAPID 私钥。
 * 云端只下发公开的 VAPID public key。
 */
(function (global) {
  'use strict';

  var scriptEl = document.currentScript;
  var basePath = scriptEl ? new URL('../../', scriptEl.src).pathname : '/';
  basePath = basePath.replace(/\/+$/, '');
  var DEVICE_STORAGE_KEY = 'cloud_device_v1';
  var CONTEXT_FINGERPRINT_PREFIX = 'cloud_context_fingerprint_v1:';
  var CONTEXT_PENDING_PREFIX = 'cloud_context_pending_v1:';
  var contextSyncPromises = Object.create(null);
  var activeContextEventIds = Object.create(null);
  var localContextFingerprints = Object.create(null);
  var localContextPendingEvents = Object.create(null);
  var outboundCursorsInMemory = Object.create(null);

  function apiPath(path) {
    return basePath + path;
  }

  function readDevice() {
    try {
      var raw = localStorage.getItem(DEVICE_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.deviceId !== 'string' || typeof parsed.secret !== 'string') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeDevice(device) {
    try {
      localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device));
    } catch (error) {
      // 存储不可用时仍然返回内存对象，但调用方会看到未持久化的状态。
      console.warn('[cloud] 设备凭据无法写入本地存储', error);
    }
  }

  function clearDevice() {
    try {
      localStorage.removeItem(DEVICE_STORAGE_KEY);
    } catch (error) {
      // ignore
    }
  }

  function randomBase64Url(byteLength) {
    var bytes = new Uint8Array(byteLength);
    global.crypto.getRandomValues(bytes);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function ensureDevice() {
    var existing = readDevice();
    if (existing) return existing;
    var device = {
      deviceId: randomBase64Url(16),
      secret: randomBase64Url(32),
      label: '这台设备',
      createdAt: Date.now()
    };
    writeDevice(device);
    return device;
  }

  function base64UrlToUint8Array(value) {
    var normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    var padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bufferToBase64Url(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function deviceAuth(device) {
    return device.deviceId + '.' + device.secret;
  }

  function requestJson(path, options) {
    var opts = options || {};
    return fetch(apiPath(path), {
      method: opts.method || 'GET',
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        opts.device ? { 'X-Device-Auth': deviceAuth(opts.device) } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      signal: opts.signal
    }).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, error: { code: 'NON_JSON', message: '云端返回了无法解析的内容' } };
      }).then(function (payload) {
        if (!response.ok || payload.ok === false) {
          var error = new Error((payload.error && payload.error.message) || ('HTTP ' + response.status));
          error.code = (payload.error && payload.error.code) || 'HTTP_' + response.status;
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function isSupported() {
    return Boolean(
      global.isSecureContext !== false &&
      'serviceWorker' in navigator &&
      'PushManager' in global &&
      'Notification' in global
    );
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('当前环境不支持 Service Worker'));
    return navigator.serviceWorker.register(apiPath('/sw.js'), { updateViaCache: 'none' });
  }

  async function getRegistration() {
    await registerServiceWorker();
    return navigator.serviceWorker.ready;
  }

  async function fetchPublicKey() {
    var payload = await requestJson('/api/push/config');
    return payload.publicKey;
  }

  async function registerDevice(device, enrollmentToken) {
    var body = {
      deviceId: device.deviceId,
      secret: device.secret,
      label: device.label,
      platform: navigator.userAgent.slice(0, 64)
    };
    if (enrollmentToken) body.enrollmentToken = String(enrollmentToken).trim();
    // 不再因 DEVICE_UNKNOWN / DEVICE_CONFLICT 自动销毁本机凭据。
    // 这通常表示设备需要重新配对，静默生成新 ID 会丢失原设备身份。
    return requestJson('/api/devices/register', {
      method: 'POST',
      body: body
    });
  }

  async function enablePush(userInitiated, enrollmentToken) {
    if (!isSupported()) throw new Error('当前浏览器不支持 Web Push');
    var device = ensureDevice();
    await registerDevice(device, enrollmentToken);

    if (userInitiated && 'Notification' in global && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission !== 'granted') {
      throw new Error('通知权限未开启，请在系统或浏览器设置中允许通知');
    }

    var publicKey = await fetchPublicKey();
    var registration = await getRegistration();
    var existing = await registration.pushManager.getSubscription();
    var subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey)
    });

    await requestJson('/api/push/subscriptions', {
      method: 'POST',
      device: device,
      body: {
        subscription: {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime || null,
          keys: {
            p256dh: bufferToBase64Url(subscription.getKey('p256dh')),
            auth: bufferToBase64Url(subscription.getKey('auth'))
          }
        }
      }
    });

    return { endpoint: subscription.endpoint };
  }

  async function disablePush() {
    var registration = await getRegistration();
    var subscription = await registration.pushManager.getSubscription();
    var endpoint = subscription ? subscription.endpoint : '';
    if (subscription) await subscription.unsubscribe();

    var device = readDevice();
    if (device) {
      await requestJson('/api/push/unsubscribe', {
        method: 'POST',
        device: device,
        body: endpoint ? { endpoint: endpoint } : {}
      }).catch(function () {
        // 服务端不可达时仍然完成本机退订，避免界面卡在“已连接”。
      });
    }
    return { endpoint: endpoint };
  }

  function createDevicePairingToken() {
    return requestDeviceMetadata('/api/devices/pairing-token', 'POST', {});
  }

  async function connectDeviceWithPairingCode(pairingCode) {
    var code = String(pairingCode || '').trim();
    if (code.length < 32 || code.length > 512) {
      throw new Error('请输入有效的一次性配对码');
    }
    var device = ensureDevice();
    try {
      await registerDevice(device, code);
    } catch (error) {
      // 仅在用户主动输入一次性配对码时，允许从已撤销/冲突的旧 ID
      // 创建新设备身份；普通 enablePush / re-register 不会静默清除凭据。
      if (['DEVICE_REVOKED', 'DEVICE_CONFLICT', 'DEVICE_UNKNOWN'].indexOf(error.code) === -1) {
        throw error;
      }
      clearDevice();
      device = ensureDevice();
      await registerDevice(device, code);
    }
    if (!isSupported()) {
      return { deviceRegistered: true, pushSupported: false, pushEnabled: false };
    }
    try {
      await enablePush(true);
      return { deviceRegistered: true, pushSupported: true, pushEnabled: true };
    } catch (error) {
      // 配对已成功；推送权限/订阅失败不撤销设备身份。
      error.deviceRegistered = true;
      throw error;
    }
  }

  async function sendTestPush() {
    var device = readDevice();
    if (!device) throw new Error('设备尚未连接');
    return requestJson('/api/push/test', {
      method: 'POST',
      device: device,
      body: { dedupeKey: 'test:' + device.deviceId + ':' + Date.now() }
    });
  }

  function requestDeviceMetadata(path, method, body, signal) {
    var device = readDevice();
    if (!device) return Promise.reject(new Error('设备尚未连接'));
    return requestJson(path, {
      method: method || 'GET',
      device: device,
      body: body,
      signal: signal
    });
  }

  function characterPath(characterId) {
    var value = String(characterId || '');
    if (!value || value.length > 96) throw new Error('角色 ID 无效');
    return encodeURIComponent(value);
  }

  function getAutonomyReadiness() {
    return requestDeviceMetadata('/api/autonomy/readiness');
  }

  function getGlobalAutonomy() {
    return requestDeviceMetadata('/api/autonomy/global');
  }

  function setGlobalAutonomy(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('enabled 必须是布尔值'));
    return requestDeviceMetadata('/api/autonomy/global', 'PUT', { enabled: enabled });
  }

  function getCharacterAutonomy(characterId) {
    return requestDeviceMetadata('/api/autonomy/characters/' + characterPath(characterId));
  }

  function setCharacterAutonomy(characterId, enabled) {
    if (enabled !== null && typeof enabled !== 'boolean') {
      return Promise.reject(new Error('enabled 必须为 true、false 或 null'));
    }
    return requestDeviceMetadata(
      '/api/autonomy/characters/' + characterPath(characterId),
      'PUT',
      { enabled: enabled }
    );
  }

  function getCharacterSchedule(characterId) {
    return requestDeviceMetadata('/api/characters/' + characterPath(characterId) + '/schedule');
  }

  function setCharacterSchedule(characterId, timeZone, schedule) {
    if (!timeZone || !schedule || typeof schedule !== 'object') {
      return Promise.reject(new Error('必须明确提供时区和角色作息'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/schedule',
      'PUT',
      { timeZone: timeZone, schedule: schedule }
    );
  }

  function contextMetadataKey(prefix, characterId) {
    return prefix + encodeURIComponent(String(characterId || ''));
  }

  function readContextMetadata(key, memory) {
    try {
      var value = localStorage.getItem(key);
      if (typeof value === 'string' && value) return value;
    } catch (error) {
      // Fall back to this page's in-memory copy when storage is unavailable.
    }
    return memory[key] || null;
  }

  function writeContextMetadata(key, value, memory) {
    if (value == null || value === '') delete memory[key];
    else memory[key] = String(value);
    try {
      if (value == null || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (error) {
      // The in-memory pending event is still sent during this page lifetime.
    }
  }

  // A local-only fingerprint detects whether the saved history changed.
  // The fingerprint itself is never sent to the Worker; only a random event ID is.
  function fingerprintCharacterHistory(history) {
    if (!Array.isArray(history)) return null;
    var hashA = 2166136261;
    var hashB = 2246822519;
    var fieldCount = 0;
    var maxDepth = 32;

    function absorb(value) {
      var text = value == null ? '' : String(value);
      fieldCount += 1;
      for (var i = 0; i < text.length; i += 1) {
        var code = text.charCodeAt(i);
        hashA = Math.imul(hashA ^ code, 16777619);
        hashB = Math.imul(hashB ^ code, 3266489917);
      }
      hashA = Math.imul(hashA ^ 31, 16777619);
      hashB = Math.imul(hashB ^ 47, 3266489917);
    }

    // Large inline data URLs can contain many megabytes. Sample fixed-size
    // windows across the payload so a save does not synchronously hash every
    // embedded image byte, while still noticing changes throughout the file.
    function absorbInlineDataUrl(value) {
      var match = /^data:[^,]*;base64,/i.exec(value);
      if (!match) {
        absorb(value);
        return;
      }
      absorb('[inline-data-url]');
      absorb(match[0]);
      var payloadStart = match[0].length;
      var payloadLength = value.length - payloadStart;
      absorb(payloadLength);
      var sampleSize = 64;
      var sampleCount = 32;
      if (payloadLength <= sampleSize) {
        absorb(value.slice(payloadStart));
        return;
      }
      for (var sample = 0; sample < sampleCount; sample += 1) {
        var offset = Math.floor(
          sample * (payloadLength - sampleSize) / (sampleCount - 1)
        );
        absorb(value.slice(payloadStart + offset, payloadStart + offset + sampleSize));
      }
    }

    function visit(value, depth, stack) {
      if (value === null) {
        absorb('null');
        return;
      }
      var kind = typeof value;
      if (kind === 'string') {
        if (/^data:[^,]*;base64,/i.test(value)) absorbInlineDataUrl(value);
        else {
          absorb('string');
          absorb(value);
        }
        return;
      }
      if (kind === 'number') {
        absorb('number');
        absorb(Number.isNaN(value) ? 'NaN' : String(value));
        return;
      }
      if (kind === 'boolean' || kind === 'undefined') {
        absorb(kind);
        absorb(String(value));
        return;
      }
      if (kind !== 'object') {
        absorb(kind);
        absorb(String(value));
        return;
      }
      if (depth >= maxDepth) {
        absorb('[max-depth]');
        return;
      }

      var cycleIndex = stack.indexOf(value);
      if (cycleIndex !== -1) {
        absorb('[cycle]');
        absorb(cycleIndex);
        return;
      }

      stack.push(value);
      if (Array.isArray(value)) {
        absorb('array');
        absorb(value.length);
        for (var index = 0; index < value.length; index += 1) {
          visit(value[index], depth + 1, stack);
        }
      } else {
        absorb('object');
        var keys = Object.keys(value).sort();
        absorb(keys.length);
        for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          var key = keys[keyIndex];
          absorb(key);
          visit(value[key], depth + 1, stack);
        }
      }
      stack.pop();
    }

    // Walk every serializable message field, including nested payloads used by
    // polls, transfers, reactions, replies, calls, locations and attachments.
    // Property order is normalized so an equivalent object does not create a
    // spurious version bump.
    visit(history, 0, []);
    return String(history.length) + ':' +
      (hashA >>> 0).toString(16) + ':' +
      (hashB >>> 0).toString(16) + ':' + String(fieldCount);
  }

  function getCharacterContextVersion(characterId) {
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/context-version'
    );
  }

  function enqueueAutonomyActivity(characterId, contextVersion) {
    var version = Number(contextVersion);
    if (!Number.isSafeInteger(version) || version < 1) {
      return Promise.reject(new Error('角色上下文版本无效'));
    }
    return requestDeviceMetadata(
      '/api/autonomy/characters/' + characterPath(characterId) + '/activities',
      'POST',
      { contextVersion: version }
    );
  }

  function claimAutonomyActivity(characterId) {
    return requestDeviceMetadata(
      '/api/autonomy/characters/' + characterPath(characterId) + '/activities/claim',
      'POST',
      {}
    ).then(function (payload) {
      return payload.activity || null;
    });
  }

  function completeAutonomyActivity(activity, text) {
    if (!activity || !/^[A-Za-z0-9_-]{16,64}$/.test(String(activity.id || ''))) {
      return Promise.reject(new Error('自主活动 ID 无效'));
    }
    var attemptCount = Number(activity.attemptCount);
    var message = String(text || '').trim();
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || message.length < 2) {
      return Promise.reject(new Error('自主活动结果无效'));
    }
    return requestDeviceMetadata(
      '/api/autonomy/activities/' + encodeURIComponent(activity.id) + '/complete',
      'POST',
      { attemptCount: attemptCount, text: message }
    );
  }

  function skipAutonomyActivity(activity, reasonCode) {
    if (!activity || !/^[A-Za-z0-9_-]{16,64}$/.test(String(activity.id || ''))) {
      return Promise.reject(new Error('自主活动 ID 无效'));
    }
    var attemptCount = Number(activity.attemptCount);
    var allowed = ['no_worthy_message', 'context_changed', 'feature_disabled', 'invalid_generation'];
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || allowed.indexOf(reasonCode) === -1) {
      return Promise.reject(new Error('自主活动跳过原因无效'));
    }
    return requestDeviceMetadata(
      '/api/autonomy/activities/' + encodeURIComponent(activity.id) + '/skip',
      'POST',
      { attemptCount: attemptCount, reasonCode: reasonCode }
    );
  }

  function failAutonomyActivity(activity, reasonCode) {
    if (!activity || !/^[A-Za-z0-9_-]{16,64}$/.test(String(activity.id || ''))) {
      return Promise.reject(new Error('自主活动 ID 无效'));
    }
    var attemptCount = Number(activity.attemptCount);
    var allowed = ['model_unavailable', 'generation_failed', 'generation_empty', 'local_context_unavailable'];
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || allowed.indexOf(reasonCode) === -1) {
      return Promise.reject(new Error('自主活动失败原因无效'));
    }
    return requestDeviceMetadata(
      '/api/autonomy/activities/' + encodeURIComponent(activity.id) + '/fail',
      'POST',
      { attemptCount: attemptCount, reasonCode: reasonCode }
    );
  }

  function isValidOutboundCursorId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256;
  }

  function getCharacterOutboundPage(characterId, limit, cursor) {
    var safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
    var query = '?limit=' + safeLimit;
    if (cursor && Number.isSafeInteger(Number(cursor.createdAt)) &&
        Number(cursor.createdAt) >= 0 &&
        isValidOutboundCursorId(cursor.id)) {
      query += '&afterCreatedAt=' + encodeURIComponent(String(cursor.createdAt));
      query += '&afterId=' + encodeURIComponent(String(cursor.id));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/outbound' + query
    ).then(function (payload) {
      var next = payload.nextCursor;
      if (!next || !Number.isSafeInteger(Number(next.createdAt)) ||
          Number(next.createdAt) < 0 ||
          !isValidOutboundCursorId(next.id)) {
        next = null;
      } else {
        next = { createdAt: Number(next.createdAt), id: String(next.id) };
      }
      return {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        nextCursor: next
      };
    });
  }

  function getCharacterOutboundMessages(characterId, limit) {
    return getCharacterOutboundPage(characterId, limit, null).then(function (page) {
      return page.messages;
    });
  }

  function outboundCursorStorageKey(characterId) {
    var device = readDevice();
    var deviceId = device && device.deviceId ? String(device.deviceId) : 'unpaired';
    return 'cloud_outbound_cursor_v1:' + encodeURIComponent(String(characterId || '')) +
      ':' + encodeURIComponent(deviceId);
  }

  function normalizeOutboundCursor(value) {
    if (!value || !Number.isSafeInteger(Number(value.createdAt)) ||
        Number(value.createdAt) < 0 ||
        !isValidOutboundCursorId(value.id)) return null;
    return { createdAt: Number(value.createdAt), id: value.id };
  }

  function readOutboundCursor(key) {
    var memoryEntry = outboundCursorsInMemory[key];
    if (memoryEntry && memoryEntry.dirty) {
      var pendingMemory = normalizeOutboundCursor(memoryEntry.cursor);
      return pendingMemory ? { createdAt: pendingMemory.createdAt, id: pendingMemory.id } : null;
    }
    try {
      var stored = normalizeOutboundCursor(JSON.parse(localStorage.getItem(key) || 'null'));
      outboundCursorsInMemory[key] = { cursor: stored, dirty: false };
      return stored ? { createdAt: stored.createdAt, id: stored.id } : null;
    } catch (error) {
      // Fall back to the last known cursor when local storage is unavailable.
    }
    var memory = memoryEntry && normalizeOutboundCursor(memoryEntry.cursor);
    return memory ? { createdAt: memory.createdAt, id: memory.id } : null;
  }

  function writeOutboundCursor(key, cursor) {
    var normalized = cursor ? normalizeOutboundCursor(cursor) : null;
    outboundCursorsInMemory[key] = { cursor: normalized, dirty: true };
    try {
      if (normalized) localStorage.setItem(key, JSON.stringify(normalized));
      else localStorage.removeItem(key);
      outboundCursorsInMemory[key].dirty = false;
    } catch (error) {
      // Keep the newer cursor in memory even when an older persisted cursor
      // still exists. On-device persistence is best-effort; failed rows remain
      // server-pending until their local-save ACK succeeds.
    }
  }

  function getCharacterOutboundLifecycle(characterId, serverMessageId) {
    var messageId = String(serverMessageId || '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(messageId)) {
      return Promise.reject(new Error('云端消息 ID 无效'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/outbound/' +
        encodeURIComponent(messageId) + '/status'
    ).then(function (payload) {
      return payload.lifecycle || null;
    });
  }

  function markCharacterOutboundReceived(characterId, serverMessageId) {
    var messageId = String(serverMessageId || '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(messageId)) {
      return Promise.reject(new Error('云端消息 ID 无效'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/outbound/' +
        encodeURIComponent(messageId) + '/received',
      'POST'
    );
  }

  function markCharacterOutboundRead(characterId, serverMessageId) {
    var messageId = String(serverMessageId || '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(messageId)) {
      return Promise.reject(new Error('云端消息 ID 无效'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/outbound/' +
        encodeURIComponent(messageId) + '/read',
      'POST'
    );
  }

  function acknowledgeCharacterOutboundMessage(characterId, serverMessageId) {
    var messageId = String(serverMessageId || '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(messageId)) {
      return Promise.reject(new Error('云端消息 ID 无效'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/outbound/' +
        encodeURIComponent(messageId) + '/ack',
      'POST'
    );
  }

  /**
   * The caller must return true only after the message is durably saved and
   * read back from local chat history. Failed saves are deliberately not acked.
   */
  async function receiveCharacterOutboundMessages(characterId, persistMessage, limit) {
    if (typeof persistMessage !== 'function') {
      throw new TypeError('必须提供消息持久化回调');
    }
    var safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
    var cursorKey = outboundCursorStorageKey(characterId);
    var cursor = readOutboundCursor(cursorKey);
    var maxPages = Math.max(1, Math.ceil(30 / safeLimit));
    var receivedCount = 0;
    var receivedMarked = 0;
    var receivedDeferred = 0;
    var persistedCount = 0;
    var saved = 0;
    var ackDeferred = 0;
    var persistErrors = 0;
    var deferred = 0;
    var pagesProcessed = 0;

    // A stable keyset cursor lets us move past a repeatedly failing envelope.
    // The cursor is per role + device and survives page reloads. It never ACKs
    // or deletes failed messages; reaching the end clears it so old failures
    // are revisited on the next polling cycle.
    while (pagesProcessed < maxPages) {
      var page = await getCharacterOutboundPage(characterId, safeLimit, cursor);
      var messages = page.messages;
      if (!messages.length) {
        if (cursor && pagesProcessed === 0) {
          cursor = null;
          writeOutboundCursor(cursorKey, null);
          continue;
        }
        if (cursor) writeOutboundCursor(cursorKey, null);
        break;
      }

      receivedCount += messages.length;
      for (var index = 0; index < messages.length; index += 1) {
        var message = messages[index];
        // Device-received and local-save receipts remain independent.
        try {
          await markCharacterOutboundReceived(characterId, message.serverMessageId);
          receivedMarked += 1;
        } catch (receiveError) {
          receivedDeferred += 1;
        }

        var persisted = false;
        try {
          persisted = await persistMessage(message.payload, message);
        } catch (persistError) {
          // Keep the cloud row pending, but continue through this page and later pages.
          persistErrors += 1;
          deferred += 1;
          continue;
        }
        if (persisted !== true) {
          deferred += 1;
          continue;
        }
        persistedCount += 1;

        try {
          await acknowledgeCharacterOutboundMessage(characterId, message.serverMessageId);
          saved += 1;
        } catch (ackError) {
          // A later scan sees the same serverMessageId and retries ACK without reinserting.
          ackDeferred += 1;
        }
      }

      pagesProcessed += 1;
      cursor = page.nextCursor;
      writeOutboundCursor(cursorKey, cursor);
      if (!cursor) break;
    }

    return {
      received: receivedCount,
      pagesProcessed: pagesProcessed,
      receivedMarked: receivedMarked,
      receivedDeferred: receivedDeferred,
      persisted: persistedCount,
      saved: saved,
      ackDeferred: ackDeferred,
      persistErrors: persistErrors,
      deferred: deferred
    };
  }

  function flushCharacterContextVersion(characterId) {
    var value = String(characterId || '');
    if (!value) return Promise.reject(new Error('角色 ID 无效'));
    var key = value;
    if (contextSyncPromises[key]) return contextSyncPromises[key];

    var pendingKey = contextMetadataKey(CONTEXT_PENDING_PREFIX, value);
    var eventId = readContextMetadata(pendingKey, localContextPendingEvents);
    if (!eventId) return Promise.resolve(null);

    activeContextEventIds[key] = eventId;
    var promise = requestDeviceMetadata(
      '/api/characters/' + characterPath(value) + '/context-version',
      'POST',
      { eventId: eventId }
    ).then(function (payload) {
      if (readContextMetadata(pendingKey, localContextPendingEvents) === eventId) {
        writeContextMetadata(pendingKey, null, localContextPendingEvents);
      }
      return payload;
    }).finally(function () {
      if (activeContextEventIds[key] === eventId) delete activeContextEventIds[key];
      if (contextSyncPromises[key] === promise) delete contextSyncPromises[key];
      var nextEventId = readContextMetadata(pendingKey, localContextPendingEvents);
      if (nextEventId && nextEventId !== eventId) {
        flushCharacterContextVersion(value).catch(function () {});
      }
    });
    contextSyncPromises[key] = promise;
    return promise;
  }

  function noteCharacterContextChanged(characterId, history) {
    var value = String(characterId || '');
    if (!value) return Promise.reject(new Error('角色 ID 无效'));
    var fingerprint = fingerprintCharacterHistory(history);
    if (fingerprint == null) return Promise.resolve({ changed: false });

    var fingerprintKey = contextMetadataKey(CONTEXT_FINGERPRINT_PREFIX, value);
    var pendingKey = contextMetadataKey(CONTEXT_PENDING_PREFIX, value);
    var previous = readContextMetadata(fingerprintKey, localContextFingerprints);
    if (previous === fingerprint) {
      return flushCharacterContextVersion(value).then(function (payload) {
        return { changed: false, synced: Boolean(payload), payload: payload };
      });
    }

    // Every distinct saved-history fingerprint gets a fresh event ID. This
    // matters across tabs: a token already in flight in another page must not
    // be reused for a later history change. Offline edits replace the pending
    // token, so the latest saved state is represented by one eventual bump.
    var pendingEventId = randomBase64Url(18);

    writeContextMetadata(fingerprintKey, fingerprint, localContextFingerprints);
    writeContextMetadata(pendingKey, pendingEventId, localContextPendingEvents);

    return flushCharacterContextVersion(value).then(function (payload) {
      return { changed: true, synced: Boolean(payload), payload: payload };
    });
  }

  function updatePresenceHeartbeat(foregroundActive, signal) {
    if (typeof foregroundActive !== 'boolean') {
      return Promise.reject(new Error('foregroundActive 必须是布尔值'));
    }
    return requestDeviceMetadata('/api/presence/heartbeat', 'POST', {
      foregroundActive: foregroundActive
    }, signal);
  }

  function updateCharacterLease(characterId, action) {
    if (['acquire', 'renew', 'release'].indexOf(action) === -1) {
      return Promise.reject(new Error('lease action 无效'));
    }
    return requestDeviceMetadata(
      '/api/characters/' + characterPath(characterId) + '/lease',
      'POST',
      { action: action }
    );
  }

  // Browser timers use a signed 32-bit delay. Larger values can be clamped
  // by the browser to a near-immediate timer, causing a heartbeat storm.
  var MAX_BROWSER_TIMER_DELAY_MS = 2147483647;

  function getPresenceRenewInterval(heartbeatTtlMs, leaseDurationMs) {
    var ttl = Number(heartbeatTtlMs);
    var lease = Number(leaseDurationMs);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 ||
        !Number.isSafeInteger(lease) || lease <= 0) {
      return null;
    }
    var target = Math.max(1, Math.floor(Math.min(ttl, lease) / 3));
    return Math.min(MAX_BROWSER_TIMER_DELAY_MS, target);
  }

  /**
   * Starts a character-scoped foreground lease while this chat page is visible.
   * All timing comes from the authenticated server config; no client defaults.
   * Hidden tabs do not write an inactive device heartbeat or release a role
   * lease: another visible tab may still be using this device. When every
   * visible tab stops renewing, server-side TTL and lease expiry take over.
   */
  async function startCharacterPresence(characterId) {
    var encodedId = characterPath(characterId);
    if (typeof document === 'undefined') throw new Error('当前页面不支持前台状态同步');
    if (!readDevice()) throw new Error('设备尚未连接云端');

    var config = await requestDeviceMetadata('/api/presence/config');
    var renewInterval = getPresenceRenewInterval(
      config.heartbeatTtlMs,
      config.leaseDurationMs
    );
    if (renewInterval == null) {
      throw new Error('云端没有提供有效的心跳 TTL / 租约时长配置');
    }

    var stopped = false;
    var running = false;
    var syncGeneration = 0;
    var intervalId = null;
    var activeRequestController = null;
    var leasePath = '/api/characters/' + encodedId + '/lease';

    async function syncVisibleSession() {
      if (stopped || running || document.visibilityState === 'hidden') return;
      running = true;
      var requestGeneration = syncGeneration;
      var controller = typeof global.AbortController === 'function'
        ? new global.AbortController()
        : null;
      activeRequestController = controller;
      var signal = controller ? controller.signal : undefined;
      function isCurrentVisibleSession() {
        return !stopped &&
          requestGeneration === syncGeneration &&
          document.visibilityState !== 'hidden';
      }
      try {
        await updatePresenceHeartbeat(true, signal);
        // Visibility can change while the heartbeat request is in flight.
        // Do not let a now-hidden/stopped page renew or acquire a role lease.
        if (!isCurrentVisibleSession()) return;
        try {
          await requestDeviceMetadata(leasePath, 'POST', { action: 'renew' }, signal);
        } catch (renewError) {
          if (renewError.code !== 'LEASE_NOT_OWNED') throw renewError;
          // The renewal response may also arrive after the page was hidden.
          if (!isCurrentVisibleSession()) return;
          try {
            await requestDeviceMetadata(leasePath, 'POST', { action: 'acquire' }, signal);
          } catch (acquireError) {
            if (acquireError.code !== 'CHARACTER_LEASE_HELD') throw acquireError;
          }
        }
      } finally {
        if (activeRequestController === controller) activeRequestController = null;
        // An older, non-abortable request may finish after a newer visible
        // session has already started. It must not clear that session's lock.
        if (requestGeneration === syncGeneration) running = false;
      }
    }

    function onVisibilityChange() {
      // Presence is device-scoped, while a phone can have multiple visible
      // chat tabs. A hidden tab must not write "inactive" over another tab's
      // fresh heartbeat. The server-side TTL marks the device offline after
      // every visible tab stops renewing.
      if (document.visibilityState === 'hidden') {
        // Invalidate this session even in browsers without AbortController.
        // A later visible event can start a new sync without waiting for an
        // older non-abortable fetch to settle.
        syncGeneration += 1;
        running = false;
        if (activeRequestController) activeRequestController.abort();
        return;
      }
      flushCharacterContextVersion(characterId).catch(function (error) {
        if (!stopped && document.visibilityState !== 'hidden') {
          console.warn('[cloud] 角色上下文版本同步失败，将保留待同步事件', error);
        }
      });
      syncVisibleSession().catch(function (error) {
        if (!stopped && document.visibilityState !== 'hidden' && error?.name !== 'AbortError') {
          console.warn('[cloud] 角色前台租约续期失败', error);
        }
      });
    }

    var contextPendingKey = contextMetadataKey(
      CONTEXT_PENDING_PREFIX,
      String(characterId || '')
    );

    function onContextStorageChange(event) {
      // The browser dispatches storage events to other tabs, not the tab that
      // performed setItem. A visible sibling chat tab can therefore help flush
      // a pending event immediately instead of waiting for its next heartbeat.
      if (stopped || !event || event.key !== contextPendingKey || !event.newValue) return;
      flushCharacterContextVersion(characterId).catch(function (error) {
        if (!stopped) {
          console.warn('[cloud] 跨标签页上下文版本同步失败，将保留待同步事件', error);
        }
      });
    }

    function onNetworkOnline() {
      if (stopped) return;
      // Connectivity recovery is an additional retry trigger; the pending
      // event ID remains the durable source of truth in localStorage.
      flushCharacterContextVersion(characterId).catch(function (error) {
        if (!stopped) {
          console.warn('[cloud] 网络恢复后上下文版本同步失败，将继续重试', error);
        }
      });
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('storage', onContextStorageChange);
      global.addEventListener('online', onNetworkOnline);
    }

    // Start the retry loop before the first network round-trip. A transient
    // failure on initial heartbeat/lease acquisition must not permanently
    // disable presence for this chat page.
    try {
      intervalId = global.setInterval(
        function () {
          flushCharacterContextVersion(characterId).catch(function (error) {
            if (!stopped && document.visibilityState !== 'hidden') {
              console.warn('[cloud] 角色上下文版本同步失败，将保留待同步事件', error);
            }
          });
          syncVisibleSession().catch(function (error) {
            if (!stopped && document.visibilityState !== 'hidden' && error?.name !== 'AbortError') {
              console.warn('[cloud] 角色前台租约续期失败', error);
            }
          });
        },
        renewInterval
      );
    } catch (error) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (typeof global.removeEventListener === 'function') {
        global.removeEventListener('storage', onContextStorageChange);
        global.removeEventListener('online', onNetworkOnline);
      }
      throw error;
    }

    // Flush any content-free revision event left pending from an earlier
    // offline session. This never includes a message body or a local fingerprint.
    flushCharacterContextVersion(characterId).catch(function (error) {
      console.warn('[cloud] 角色上下文版本暂未同步，后续会重试', error);
    });

    // Do not make chat initialization wait for the first network round-trip.
    // The manager is usable immediately; failures are handled by the same retry
    // path as subsequent heartbeat renewals.
    syncVisibleSession().catch(function (error) {
      if (!stopped && document.visibilityState !== 'hidden' && error?.name !== 'AbortError') {
        console.warn('[cloud] 首次角色前台同步失败，将自动重试', error);
      }
    });

    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        syncGeneration += 1;
        running = false;
        if (intervalId != null) global.clearInterval(intervalId);
        if (activeRequestController) activeRequestController.abort();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (typeof global.removeEventListener === 'function') {
          global.removeEventListener('storage', onContextStorageChange);
          global.removeEventListener('online', onNetworkOnline);
        }
      }
    };
  }

  async function disconnect() {
    var device = readDevice();
    try {
      if (device) {
        await requestJson('/api/devices/revoke', { method: 'POST', device: device });
      }
    } catch (error) {
      // 撤销失败也要清掉本机凭据，避免残留一个无效连接。
    }
    try {
      var registration = await getRegistration();
      var subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch (error) {
      // ignore
    }
    clearDevice();
    return { disconnected: true };
  }

  async function getStatus() {
    var status = {
      supported: isSupported(),
      permission: 'Notification' in global ? Notification.permission : 'unsupported',
      deviceRegistered: Boolean(readDevice()),
      subscriptionCount: 0,
      serverReachable: false,
      vapidConfigured: false,
      message: ''
    };
    if (!status.supported) {
      status.message = '当前浏览器不支持 Web Push';
      return status;
    }
    try {
      var health = await requestJson('/api/health');
      status.serverReachable = true;
      status.vapidConfigured = Boolean(health.vapidConfigured);
    } catch (error) {
      status.message = error.code === 'NOT_FOUND' || error.status === 404 || error.code === 'NON_JSON'
        ? '云端接口尚未部署'
        : '云端连接失败：' + (error.message || '未知错误');
      return status;
    }
    var device = readDevice();
    if (device) {
      try {
        var payload = await requestJson('/api/push/subscriptions', { device: device });
        status.subscriptionCount = (payload.subscriptions || []).filter(function (item) {
          return !item.disabledAt;
        }).length;
      } catch (error) {
        status.message = error.code === 'DEVICE_REVOKED'
          ? '设备授权已撤销，请重新配对'
          : error.code === 'DEVICE_UNKNOWN' || error.code === 'DEVICE_PAIRING_REQUIRED'
            ? '此设备尚未配对，请使用有效配对码连接'
            : '订阅状态读取失败：' + (error.message || '未知错误');
      }
    }
    if (!status.message) {
      if (!status.vapidConfigured) status.message = '云端尚未配置 VAPID 密钥';
      else if (!device) status.message = '设备尚未连接，开启推送后自动注册';
      else if (status.permission === 'denied') status.message = '通知权限被拒绝，请在系统设置中允许';
      else if (status.subscriptionCount > 0) status.message = '已连接 · ' + status.subscriptionCount + ' 个有效订阅';
      else status.message = '已连接，但当前设备尚未订阅推送';
    }
    return status;
  }

  /* ---------------- 设置页绑定 ---------------- */

  function setStatusText(text) {
    var el = document.getElementById('cloudStatusText');
    if (el) el.textContent = text;
  }

  function setToggle(checked) {
    var el = document.getElementById('cloudPushToggle');
    if (el) el.checked = Boolean(checked);
  }

  async function refreshSettings() {
    var status = await getStatus();
    var registration = null;
    try {
      if ('serviceWorker' in navigator) registration = await navigator.serviceWorker.getRegistration();
    } catch (error) {
      registration = null;
    }
    var subscribed = false;
    if (registration && registration.pushManager) {
      subscribed = Boolean(await registration.pushManager.getSubscription());
    }
    setToggle(subscribed);
    var autonomyToggle = document.getElementById('cloudAutonomyToggle');
    if (autonomyToggle) {
      autonomyToggle.disabled = true;
      autonomyToggle.checked = false;
      if (readDevice()) {
        try {
          var autonomy = await getGlobalAutonomy();
          autonomyToggle.checked = Boolean(autonomy.enabled);
          autonomyToggle.disabled = false;
        } catch (error) {
          // 未完成配对或云端尚未开放时保持关闭且不可操作。
        }
      }
    }
    setStatusText(status.message || '未连接');
    return status;
  }

  async function mountSettings() {
    var toggle = document.getElementById('cloudPushToggle');
    var testRow = document.getElementById('cloudTestRow');
    var readinessRow = document.getElementById('cloudReadinessCheck');
    var readinessResult = document.getElementById('cloudReadinessResult');
    var revokeRow = document.getElementById('cloudRevokeRow');
    var pairCreateRow = document.getElementById('cloudPairCreateRow');
    var pairCodeInput = document.getElementById('cloudPairCodeInput');
    var pairConnectButton = document.getElementById('cloudPairConnectButton');
    var pairCodePanel = document.getElementById('cloudPairCodePanel');
    var pairCodeOutput = document.getElementById('cloudPairCodeOutput');
    var pairCodeCopyButton = document.getElementById('cloudPairCodeCopyButton');
    var roleSelect = document.getElementById('cloudRoleSelect');
    var roleAutonomyMode = document.getElementById('cloudCharacterAutonomyMode');
    var roleAutonomySave = document.getElementById('cloudRoleAutonomySave');
    var roleTimezone = document.getElementById('cloudRoleTimezone');
    var roleActiveStart = document.getElementById('cloudRoleActiveStart');
    var roleActiveEnd = document.getElementById('cloudRoleActiveEnd');
    var roleBusyStart = document.getElementById('cloudRoleBusyStart');
    var roleBusyEnd = document.getElementById('cloudRoleBusyEnd');
    var roleAsleepStart = document.getElementById('cloudRoleAsleepStart');
    var roleAsleepEnd = document.getElementById('cloudRoleAsleepEnd');
    var roleAway = document.getElementById('cloudRoleAway');
    var roleScheduleSave = document.getElementById('cloudRoleScheduleSave');
    if (!toggle && !testRow && !readinessRow && !revokeRow && !pairCreateRow && !pairConnectButton &&
        !autonomyToggle && !roleSelect && !roleAutonomySave && !roleScheduleSave) return;

    function localCharacters() {
      try {
        if (global.PhoneStorage && typeof global.PhoneStorage.getCharacters === 'function') {
          var stored = global.PhoneStorage.getCharacters();
          if (Array.isArray(stored)) return stored;
        }
        var raw = localStorage.getItem('ai_custom_characters');
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn('[cloud] 无法读取本机角色列表', error);
        return [];
      }
    }

    function setRoleControlsDisabled(disabled) {
      [roleAutonomyMode, roleAutonomySave, roleTimezone, roleActiveStart, roleActiveEnd,
        roleBusyStart, roleBusyEnd, roleAsleepStart, roleAsleepEnd, roleAway, roleScheduleSave]
        .forEach(function (element) {
          if (element) element.disabled = !!disabled;
        });
    }

    function minuteToClock(value, allowEndOfDay) {
      var minute = Number(value);
      if (!Number.isInteger(minute) || minute < 0 || minute > (allowEndOfDay ? 1440 : 1439)) return '';
      if (minute === 1440 && allowEndOfDay) return '24:00';
      return String(Math.floor(minute / 60)).padStart(2, '0') + ':' +
        String(minute % 60).padStart(2, '0');
    }

    function firstWindow(windows) {
      return Array.isArray(windows) && windows.length ? windows[0] : null;
    }

    function fillWindow(startInput, endInput, windows) {
      var windowValue = firstWindow(windows);
      if (startInput) startInput.value = windowValue ? minuteToClock(windowValue.startMinute, false) : '';
      if (endInput) endInput.value = windowValue ? minuteToClock(windowValue.endMinute, true) : '';
    }

    function fillRoleSchedule(schedule) {
      var value = schedule || {};
      if (roleActiveStart) roleActiveStart.value = '';
      if (roleActiveEnd) roleActiveEnd.value = '';
      if (roleBusyStart) roleBusyStart.value = '';
      if (roleBusyEnd) roleBusyEnd.value = '';
      if (roleAsleepStart) roleAsleepStart.value = '';
      if (roleAsleepEnd) roleAsleepEnd.value = '';
      if (roleAway) roleAway.checked = value.away === true;
      fillWindow(roleActiveStart, roleActiveEnd, value.active);
      fillWindow(roleBusyStart, roleBusyEnd, value.busy);
      fillWindow(roleAsleepStart, roleAsleepEnd, value.asleep);
    }

    async function loadSelectedRoleSettings() {
      var roleId = roleSelect && roleSelect.value;
      setRoleControlsDisabled(!roleId || !readDevice());
      if (!roleId || !readDevice()) return;
      try {
        var results = await Promise.all([
          getCharacterAutonomy(roleId),
          getCharacterSchedule(roleId)
        ]);
        if (roleSelect.value !== roleId) return;
        var autonomy = results[0] || {};
        var scheduleResult = results[1] || {};
        if (roleAutonomyMode) {
          roleAutonomyMode.value = autonomy.inherited ? 'inherit' :
            autonomy.enabled ? 'on' : 'off';
        }
        if (roleTimezone) roleTimezone.value = scheduleResult.timeZone || '';
        fillRoleSchedule(scheduleResult.configured ? scheduleResult.schedule : {});
        setRoleControlsDisabled(false);
      } catch (error) {
        setRoleControlsDisabled(true);
        setStatusText('读取角色云端设置失败：' + (error.message || '未知错误'));
      }
    }

    function populateLocalCharacters() {
      if (!roleSelect) return;
      var selected = roleSelect.value;
      var roles = localCharacters().filter(function (role) {
        return role && role.id != null && String(role.id).trim() !== '';
      });
      roleSelect.innerHTML = '';
      roles.forEach(function (role) {
        var option = document.createElement('option');
        option.value = String(role.id);
        option.textContent = String(role.name || role.nickname || '未命名角色');
        roleSelect.appendChild(option);
      });
      if (!roles.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '本机暂无角色';
        roleSelect.appendChild(empty);
      } else if (roles.some(function (role) { return String(role.id) === selected; })) {
        roleSelect.value = selected;
      }
      loadSelectedRoleSettings();
    }

    var autonomyToggle = document.getElementById('cloudAutonomyToggle');
    if (autonomyToggle) {
      autonomyToggle.addEventListener('change', async function () {
        var desired = autonomyToggle.checked;
        autonomyToggle.disabled = true;
        setStatusText('正在保存云端自主活动授权…');
        try {
          await setGlobalAutonomy(desired);
          setStatusText(desired ? '云端自主活动授权已开启；等待角色作息与生成链路完成' : '云端自主活动授权已关闭');
        } catch (error) {
          autonomyToggle.checked = !desired;
          setStatusText('保存授权失败：' + (error.message || '未知错误'));
        } finally {
          autonomyToggle.disabled = false;
        }
      });
    }

    if (roleSelect) {
      roleSelect.addEventListener('change', loadSelectedRoleSettings);
      populateLocalCharacters();
    }

    if (roleAutonomySave) {
      roleAutonomySave.addEventListener('click', async function () {
        var roleId = roleSelect && roleSelect.value;
        if (!roleId) return;
        var value = roleAutonomyMode ? roleAutonomyMode.value : 'inherit';
        var enabled = value === 'inherit' ? null : value === 'on';
        roleAutonomySave.disabled = true;
        try {
          await setCharacterAutonomy(roleId, enabled);
          setStatusText('角色授权已保存');
        } catch (error) {
          setStatusText('保存角色授权失败：' + (error.message || '未知错误'));
        } finally {
          roleAutonomySave.disabled = false;
        }
      });
    }

    function readOptionalWindow(startInput, endInput, label) {
      var start = startInput && startInput.value.trim();
      var end = endInput && endInput.value.trim();
      if (!start && !end) return [];
      if (!start || !end) throw new Error(label + '需要同时填写开始和结束时间');
      return [{ start: start, end: end }];
    }

    if (roleScheduleSave) {
      roleScheduleSave.addEventListener('click', async function () {
        var roleId = roleSelect && roleSelect.value;
        if (!roleId) return;
        var timeZone = roleTimezone && roleTimezone.value.trim();
        var activeStart = roleActiveStart && roleActiveStart.value.trim();
        var activeEnd = roleActiveEnd && roleActiveEnd.value.trim();
        if (!timeZone) {
          setStatusText('请填写角色使用的 IANA 时区');
          return;
        }
        if (!activeStart || !activeEnd) {
          setStatusText('请填写允许主动联系的开始和结束时间');
          return;
        }
        var schedule;
        try {
          schedule = {
            active: [{ start: activeStart, end: activeEnd }],
            busy: readOptionalWindow(roleBusyStart, roleBusyEnd, '忙碌时段'),
            asleep: readOptionalWindow(roleAsleepStart, roleAsleepEnd, '休息时段'),
            away: Boolean(roleAway && roleAway.checked)
          };
        } catch (error) {
          setStatusText(error.message);
          return;
        }
        roleScheduleSave.disabled = true;
        try {
          await setCharacterSchedule(roleId, timeZone, schedule);
          setStatusText('角色时区与作息已保存；生效时间由该时区决定');
        } catch (error) {
          setStatusText('保存角色作息失败：' + (error.message || '未知错误'));
        } finally {
          roleScheduleSave.disabled = false;
        }
      });
    }

    if (toggle) {
      toggle.addEventListener('change', async function () {
        var desired = toggle.checked;
        setStatusText(desired ? '正在连接…' : '正在断开…');
        try {
          if (desired) {
            await enablePush(true);
            setStatusText('已连接');
          } else {
            await disablePush();
            setStatusText('已断开');
          }
        } catch (error) {
          toggle.checked = !desired;
          setStatusText(error.message || '操作失败');
        }
        refreshSettings();
      });
    }

    if (readinessRow) {
      readinessRow.addEventListener('click', async function () {
        readinessRow.setAttribute('aria-disabled', 'true');
        if (readinessResult) {
          readinessResult.style.display = 'block';
          readinessResult.textContent = '正在检查当前 Worker 配置…';
        }
        try {
          var ready = await getAutonomyReadiness();
          var yesNo = function (value) { return value ? '已配置' : '未配置'; };
          var lines = [
            '设备授权：' + yesNo(ready.deviceAuthorized),
            '设备密钥 Pepper：' + yesNo(ready.deviceAuthConfigured),
            '首次认领码：' + yesNo(ready.bootstrapConfigured),
            '一次性配对码：' + yesNo(ready.pairingConfigured),
            'VAPID 推送密钥：' + yesNo(ready.webPushKeysConfigured),
            '当前有效推送订阅：' + Number(ready.activePushSubscriptions || 0),
            '测试推送通道：' + (ready.testPushReady ? '具备配置条件' : '尚未就绪'),
            '前台心跳与租约：' + yesNo(ready.presenceConfigured),
            '有效前台心跳设备：' + (ready.presenceSummary
              ? Number(ready.presenceSummary.foregroundDevices || 0) + ' / 授权设备 ' + Number(ready.presenceSummary.authorizedDevices || 0)
              : '未知（前台配置未完成）'),
            '角色前台租约：' + (ready.presenceSummary
              ? '有效 ' + Number(ready.presenceSummary.validCharacterLeases || 0) +
                ' / 缓冲期 ' + Number(ready.presenceSummary.graceCharacterLeases || 0)
              : '未知（前台配置未完成）'),
            '全局自主活动授权：' + (ready.globalAutonomyEnabled ? '已开启' : '未开启'),
            '任务队列：共 ' + Number(ready.activityQueue && ready.activityQueue.total || 0) +
              '（待处理 ' + Number(ready.activityQueue && ready.activityQueue.waiting || 0) +
              ' / 重试 ' + Number(ready.activityQueue && ready.activityQueue.retry || 0) +
              ' / 运行中 ' + Number(ready.activityQueue && ready.activityQueue.running || 0) +
              ' / 已完成 ' + Number(ready.activityQueue && ready.activityQueue.completed || 0) +
              ' / 失败 ' + Number(ready.activityQueue && ready.activityQueue.failed || 0) +
              ' / 已作废 ' + Number(ready.activityQueue && ready.activityQueue.superseded || 0) +
              ' / 其他 ' + Number(ready.activityQueue && ready.activityQueue.other || 0) + '）',
            '云端执行器：' + (ready.activityExecutorAvailable ? '已接入' : '尚未接入，任务不会被实际执行'),
            '最近 24 小时调度阻塞原因：' + (Array.isArray(ready.recentSchedulerReasons) && ready.recentSchedulerReasons.length
              ? ready.recentSchedulerReasons.map(function (item) {
                  var labels = {
                    executor_unavailable: '执行器未接入',
                    context_version_unavailable: '缺少可信上下文版本',
                    autonomy_denied: '自主活动授权未通过',
                    character_not_active: '角色当前不在主动时段',
                    foreground_lease_held: '角色正在前台聊天',
                    foreground_lease_grace: '前台租约缓冲期内',
                    stale_context: '任务上下文已过期',
                    gate_data_missing: '缺少调度配置',
                    gate_provider_error: '调度数据读取失败',
                    gate_policy_unavailable: '作息策略不可用',
                    gate_policy_invalid: '调度规则校验失败',
                    gate_data_source_missing: '调度数据源不可用',
                    claim_lost: '任务认领发生竞争',
                    task_lease_held: '任务租约仍有效',
                    retry_exhausted: '任务已达到重试上限',
                    invalid_task: '任务数据无效',
                    invalid_config: '调度参数无效',
                    missing_config: '调度参数未配置',
                    not_due: '任务尚未到执行时间',
                    source_device_revoked: '来源设备授权已撤销，旧任务已作废'
                  };
                  return (labels[item.reasonCode] || '其他原因') + ' × ' + Number(item.count || 0);
                }).join('、')
              : '暂无记录'),
            '角色聊天版本计数：' + (ready.contextVersionReady ? '已有记录' : '尚未记录'),
            '已跟踪角色数：' + Number(ready.contextVersionTrackedRoles || 0),
            'AI 主动消息生成：' + (ready.autonomousMessageGenerationReady ? '已就绪' : '未就绪'),
            '',
            ready.note || '此检查只读取配置与匿名队列汇总，不会发送通知。'
          ];
          if (readinessResult) readinessResult.textContent = lines.join('\n');
          setStatusText(ready.testPushReady ? '云端推送配置已具备测试条件' : '云端仍有配置未完成');
        } catch (error) {
          if (readinessResult) readinessResult.textContent = '检查失败：' + (error.message || '未知错误');
          setStatusText('读取云端准备情况失败');
        } finally {
          readinessRow.removeAttribute('aria-disabled');
        }
      });
    }

    if (testRow) {
      testRow.addEventListener('click', async function () {
        setStatusText('正在发送测试推送…');
        try {
          var result = await sendTestPush();
          var summary = result.summary || {};
          if (!summary.sent && summary.skipped) {
            setStatusText('这条测试通知刚刚已经发送过（已去重）');
          } else {
            setStatusText('测试推送已发送：成功 ' + (summary.sent || 0) + '，失败 ' + (summary.failed || 0));
          }
        } catch (error) {
          setStatusText('测试推送失败：' + (error.message || '未知错误'));
        }
      });
    }

    if (pairCreateRow) {
      pairCreateRow.addEventListener('click', async function () {
        setStatusText('正在生成一次性配对码…');
        try {
          var issued = await createDevicePairingToken();
          if (pairCodeOutput) pairCodeOutput.value = issued.pairingToken;
          if (pairCodePanel) pairCodePanel.style.display = 'block';
          var minutes = Math.max(1, Math.ceil(Number(issued.ttlMs || 0) / 60000));
          setStatusText('配对码已生成：有效期约 ' + minutes + ' 分钟，且只能使用一次');
        } catch (error) {
          setStatusText('生成配对码失败：' + (error.message || '未知错误'));
        }
      });
    }

    if (pairCodeCopyButton) {
      pairCodeCopyButton.addEventListener('click', async function () {
        var value = pairCodeOutput && pairCodeOutput.value;
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          setStatusText('配对码已复制，请在新设备上使用');
        } catch (error) {
          if (pairCodeOutput) {
            pairCodeOutput.focus();
            pairCodeOutput.select();
          }
          setStatusText('请长按上方配对码复制');
        }
      });
    }

    if (pairConnectButton) {
      pairConnectButton.addEventListener('click', async function () {
        var code = pairCodeInput && pairCodeInput.value.trim();
        if (!code) {
          setStatusText('请先输入一次性配对码');
          return;
        }
        pairConnectButton.disabled = true;
        setStatusText('正在配对并连接推送…');
        try {
          var connection = await connectDeviceWithPairingCode(code);
          if (pairCodeInput) pairCodeInput.value = '';
          setStatusText(connection.pushEnabled
            ? '设备已配对，推送订阅已连接'
            : '设备已配对；当前浏览器不支持 Web Push');
          await refreshSettings();
          populateLocalCharacters();
        } catch (error) {
          setStatusText(error.deviceRegistered
            ? '设备已配对，但推送订阅未完成：' + (error.message || '未知错误')
            : '设备配对失败：' + (error.message || '未知错误'));
          if (error.deviceRegistered) {
            await refreshSettings();
            populateLocalCharacters();
          }
        } finally {
          pairConnectButton.disabled = false;
        }
      });
    }

    if (revokeRow) {
      revokeRow.addEventListener('click', async function () {
        setStatusText('正在断开云连接…');
        try {
          await disconnect();
          setToggle(false);
          setStatusText('已断开，本机凭据已清除');
        } catch (error) {
          setStatusText('断开失败：' + (error.message || '未知错误'));
        }
      });
    }

    var supported = isSupported();
    if (!supported) {
      setToggle(false);
      setStatusText('当前浏览器不支持 Web Push');
      // Web Push 不可用不应阻止设备配对状态与自主活动元数据读取。
      refreshSettings();
      return;
    }
    refreshSettings();
  }

  global.MaomaoCloud = {
    enablePush: function () { return enablePush(true); },
    disablePush: disablePush,
    sendTestPush: sendTestPush,
    createDevicePairingToken: createDevicePairingToken,
    connectDeviceWithPairingCode: connectDeviceWithPairingCode,
    getAutonomyReadiness: getAutonomyReadiness,
    getGlobalAutonomy: getGlobalAutonomy,
    setGlobalAutonomy: setGlobalAutonomy,
    getCharacterAutonomy: getCharacterAutonomy,
    setCharacterAutonomy: setCharacterAutonomy,
    getCharacterSchedule: getCharacterSchedule,
    setCharacterSchedule: setCharacterSchedule,
    getCharacterContextVersion: getCharacterContextVersion,
    enqueueAutonomyActivity: enqueueAutonomyActivity,
    claimAutonomyActivity: claimAutonomyActivity,
    completeAutonomyActivity: completeAutonomyActivity,
    failAutonomyActivity: failAutonomyActivity,
    skipAutonomyActivity: skipAutonomyActivity,
    getCharacterOutboundMessages: getCharacterOutboundMessages,
    getCharacterOutboundPage: getCharacterOutboundPage,
    getCharacterOutboundLifecycle: getCharacterOutboundLifecycle,
    markCharacterOutboundReceived: markCharacterOutboundReceived,
    markCharacterOutboundRead: markCharacterOutboundRead,
    acknowledgeCharacterOutboundMessage: acknowledgeCharacterOutboundMessage,
    receiveCharacterOutboundMessages: receiveCharacterOutboundMessages,
    noteCharacterContextChanged: noteCharacterContextChanged,
    flushCharacterContextVersion: flushCharacterContextVersion,
    updatePresenceHeartbeat: updatePresenceHeartbeat,
    updateCharacterLease: updateCharacterLease,
    startCharacterPresence: startCharacterPresence,
    disconnect: disconnect,
    getStatus: getStatus,
    refreshSettings: refreshSettings,
    mountSettings: mountSettings,
    _internal: { ensureDevice: ensureDevice, readDevice: readDevice, clearDevice: clearDevice, getPresenceRenewInterval: getPresenceRenewInterval, fingerprintCharacterHistory: fingerprintCharacterHistory }
  };
})(typeof window !== 'undefined' ? window : self);
