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
  var CONTEXT_SNAPSHOT_PENDING_PREFIX = 'cloud_context_snapshot_pending_v1:';
  var contextSharingEnabledCache = null;
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

  function canShowLocalNotification() {
    return Boolean(global.isSecureContext !== false &&
      'serviceWorker' in navigator && 'Notification' in global);
  }

  function notificationPermissionMessage(permission) {
    var host = global.location && global.location.hostname || '当前网站';
    var isOpera = /(?:OPR|OPT)\/|Opera/i.test(String(navigator.userAgent || ''));
    var browser = isOpera ? 'Opera' : '浏览器';
    if (permission === 'denied') {
      return host + ' 的网站通知已被' + browser + '拒绝。请打开地址栏旁的网站权限设置，将「通知」改为允许；仅开启手机里的' + browser + '应用通知还不够。';
    }
    return host + ' 尚未获得网站通知授权。点击推送开关并在弹窗选择「允许」；如果没有弹窗，请检查' + browser + '的本站通知权限。手机应用通知开关与网站授权是两回事。';
  }

  async function requestNotificationPermissionFromGesture() {
    if (!canShowLocalNotification()) throw new Error(pushSupportMessage());
    var permission = Notification.permission;
    if (permission === 'default' && typeof Notification.requestPermission === 'function') {
      var requested = await Notification.requestPermission();
      // Opera/Android may update the returned permission before the property refreshes.
      permission = requested === 'granted' ? 'granted' :
        Notification.permission === 'granted' ? 'granted' :
          requested || Notification.permission;
    }
    if (permission !== 'granted') throw new Error(notificationPermissionMessage(permission));
    return permission;
  }

  function pushSupportMessage() {
    var agent = String(navigator.userAgent || '');
    var isiOS = /iPad|iPhone|iPod/i.test(agent) ||
      (/Macintosh/i.test(agent) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
    if (isiOS) {
      var standalone = Boolean(navigator.standalone);
      try {
        standalone = standalone || Boolean(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches);
      } catch (error) {}
      if (!standalone) return 'iPhone/iPad 请用 Safari 打开并添加到主屏幕，再从桌面图标启动后开启通知';
      return '此 iOS 环境不支持 Web Push，请确认系统版本及主屏幕应用权限';
    }
    if (/Android/i.test(agent)) return '当前安卓浏览器不支持 Web Push，请用最新版 Chrome 或 Edge 打开小手机';
    return '当前浏览器不支持 Web Push，请使用支持系统通知的浏览器';
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

  async function registerDeviceForCurrentAccount(enrollmentToken) {
    var device = ensureDevice();
    try {
      await registerDevice(device, enrollmentToken);
      return device;
    } catch (error) {
      // Admin suspension revokes the old device credential. After the user logs
      // back into the restored account, only this explicit server response
      // permits a new device identity to be issued. Session/authorization and
      // network failures keep the existing local credential untouched.
      if (enrollmentToken || error.code !== 'DEVICE_REVOKED') throw error;
      clearDevice();
      device = ensureDevice();
      await registerDevice(device);
      return device;
    }
  }

  // The permission prompt must start in the direct click gesture. Doing a
  // network request first loses transient user activation on some browsers.
  async function requestPushPermissionFromGesture() {
    if (!isSupported()) throw new Error(pushSupportMessage());
    return requestNotificationPermissionFromGesture();
  }

  async function enablePush(userInitiated, enrollmentToken) {
    if (!isSupported()) throw new Error(pushSupportMessage());
    var permission = userInitiated
      ? await requestPushPermissionFromGesture() : Notification.permission;
    if (permission !== 'granted') {
      throw new Error(notificationPermissionMessage(permission));
    }
    var device = await registerDeviceForCurrentAccount(enrollmentToken);
    var publicKey = await fetchPublicKey();
    var registration = await getRegistration();
    if (!registration.pushManager || typeof registration.pushManager.subscribe !== 'function') {
      throw new Error(pushSupportMessage());
    }
    var existing = await registration.pushManager.getSubscription();
    var subscription = existing;
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(publicKey)
        });
      } catch (error) {
        if (/NotAllowedError|SecurityError/.test(String(error && error.name))) {
          throw new Error(notificationPermissionMessage(Notification.permission));
        }
        if (/NotSupportedError|AbortError|InvalidStateError/.test(String(error && error.name))) {
          throw new Error('当前浏览器无法建立 Web Push 订阅。若网站通知已允许，可能是浏览器推送服务不可用；Android 上可用 Chrome 或 Edge 对照测试。');
        }
        throw error;
      }
    }

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
    // Ask while this function is still in the click event. A failed prompt
    // must not erase a successfully registered device; report both outcomes.
    var permissionError = null;
    if (isSupported()) {
      try {
        await requestPushPermissionFromGesture();
      } catch (error) {
        permissionError = error;
      }
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
      if (permissionError) throw permissionError;
      await enablePush(false);
      return { deviceRegistered: true, pushSupported: true, pushEnabled: true };
    } catch (error) {
      // 配对已成功；推送权限/订阅失败不撤销设备身份。
      error.deviceRegistered = true;
      throw error;
    }
  }

  async function sendTestPush(deliveryMode) {
    var device = readDevice();
    if (!device) throw new Error('设备尚未连接');
    return requestJson('/api/push/test', {
      method: 'POST',
      device: device,
      body: {
        dedupeKey: 'test:' + (deliveryMode === 'no_payload' ? 'empty:' : 'encrypted:') + device.deviceId + ':' + Date.now(),
        deliveryMode: deliveryMode === 'no_payload' ? 'no_payload' : 'encrypted'
      }
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

  function getContextSharing() {
    return requestDeviceMetadata('/api/autonomy/context-sharing', 'GET').then(function (payload) {
      contextSharingEnabledCache = Boolean(payload && payload.enabled);
      return { enabled: contextSharingEnabledCache };
    });
  }

  function setContextSharing(enabled) {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('enabled 必须是布尔值'));
    return requestDeviceMetadata('/api/autonomy/context-sharing', 'PUT', { enabled: enabled }).then(function (payload) {
      contextSharingEnabledCache = Boolean(payload && payload.enabled);
      // Re-consent always starts from the next verified local save; never
      // replay a context snapshot queued under an earlier consent session.
      clearLocalContextMetadata(CONTEXT_FINGERPRINT_PREFIX);
      clearLocalContextMetadata(CONTEXT_SNAPSHOT_PENDING_PREFIX);
      return payload;
    });
  }

  function clearLocalContextMetadata(prefix) {
    try {
      var keys = [];
      for (var index = 0; index < localStorage.length; index += 1) {
        var key = localStorage.key(index);
        if (key && key.indexOf(prefix) === 0) keys.push(key);
      }
      keys.forEach(function (key) { localStorage.removeItem(key); });
    } catch (error) {}
    if (prefix === CONTEXT_SNAPSHOT_PENDING_PREFIX || prefix === CONTEXT_FINGERPRINT_PREFIX) {
      var cache = prefix === CONTEXT_FINGERPRINT_PREFIX
        ? localContextFingerprints : localContextPendingEvents;
      Object.keys(cache).forEach(function (key) {
        if (key.indexOf(prefix) === 0) delete cache[key];
      });
    }
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
    var groupsSaved = 0;
    var ackDeferred = 0;
    var persistErrors = 0;
    var deferred = 0;
    var pagesProcessed = 0;

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
      var offset = 0;
      var blockedByIncompleteGroup = false;
      while (offset < messages.length) {
        var first = messages[offset];
        var groupId = String(first && first.groupId || '');
        var expectedCount = groupId ? Number(first.groupCount) : 1;
        if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > 4) {
          deferred += 1;
          blockedByIncompleteGroup = true;
          break;
        }

        var group = [];
        var next = offset;
        var groupKey = groupId || ('single:' + String(first && first.serverMessageId || ''));
        while (next < messages.length) {
          var candidate = messages[next];
          var candidateKey = String(candidate && candidate.groupId || '') ||
            ('single:' + String(candidate && candidate.serverMessageId || ''));
          if (candidateKey !== groupKey) break;
          group.push(candidate);
          next += 1;
        }
        if (group.length !== expectedCount) {
          // The server over-fetches up to three extra rows so a 1..4 bubble
          // group is never cut by a page boundary. Do not cursor past a short group.
          deferred += 1;
          blockedByIncompleteGroup = true;
          break;
        }
        var validGroup = group.every(function (item, index) {
          return item && item.serverMessageId &&
            (!groupId || (
              String(item.groupId || '') === groupId &&
              Number(item.groupCount) === expectedCount &&
              Number(item.groupIndex) === index + 1
            ));
        });
        if (!validGroup) {
          deferred += 1;
          blockedByIncompleteGroup = true;
          break;
        }

        for (var receivedIndex = 0; receivedIndex < group.length; receivedIndex += 1) {
          try {
            await markCharacterOutboundReceived(characterId, group[receivedIndex].serverMessageId);
            receivedMarked += 1;
          } catch (receiveError) {
            receivedDeferred += 1;
          }
        }

        var payloads = group.map(function (item) { return item.payload; });
        var persisted = false;
        try {
          persisted = group.length === 1
            ? await persistMessage(payloads[0], group[0])
            : await persistMessage(payloads, group);
        } catch (persistError) {
          persistErrors += 1;
          deferred += 1;
          // A failed local save must not strand later unrelated messages.
          // The server retains the unacked group for a later cursor reset.
          offset = next;
          continue;
        }
        if (persisted !== true) {
          deferred += 1;
          offset = next;
          continue;
        }
        persistedCount += group.length;

        var groupAckOk = true;
        for (var ackIndex = 0; ackIndex < group.length; ackIndex += 1) {
          try {
            await acknowledgeCharacterOutboundMessage(characterId, group[ackIndex].serverMessageId);
            saved += 1;
          } catch (ackError) {
            ackDeferred += 1;
            groupAckOk = false;
          }
        }
        if (!groupAckOk) {
          // Keep the cursor before this group. The inbox query returns every
          // row of a partially acknowledged group so all ACKs can be retried.
          blockedByIncompleteGroup = true;
          break;
        }

        groupsSaved += 1;
        var last = group[group.length - 1];
        var groupCursor = {
          createdAt: Number(last.cursorCreatedAt != null ? last.cursorCreatedAt : last.createdAt),
          id: String(last.cursorId || '')
        };
        if (Number.isSafeInteger(groupCursor.createdAt) && groupCursor.createdAt >= 0 &&
            isValidOutboundCursorId(groupCursor.id)) {
          cursor = groupCursor;
          writeOutboundCursor(cursorKey, cursor);
        }
        offset = next;
      }

      pagesProcessed += 1;
      if (blockedByIncompleteGroup) break;
      if (offset !== messages.length) break;
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
      groupsSaved: groupsSaved,
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
    var snapshotPendingKey = contextMetadataKey(CONTEXT_SNAPSHOT_PENDING_PREFIX, value);
    var eventId = readContextMetadata(pendingKey, localContextPendingEvents);
    if (!eventId) return Promise.resolve(null);

    activeContextEventIds[key] = eventId;
    var pendingSnapshot = readContextMetadata(snapshotPendingKey, localContextPendingEvents);
    var snapshotPayload = null;
    if (pendingSnapshot) {
      try { snapshotPayload = JSON.parse(pendingSnapshot); } catch (error) { snapshotPayload = null; }
      if (!snapshotPayload || snapshotPayload.eventId !== eventId) snapshotPayload = null;
    }

    var submit = snapshotPayload
      ? getContextSharing().then(function (sharing) {
          if (sharing.enabled) {
            return requestDeviceMetadata(
              '/api/characters/' + characterPath(value) + '/context-snapshot',
              'POST',
              snapshotPayload
            );
          }
          writeContextMetadata(snapshotPendingKey, null, localContextPendingEvents);
          return requestDeviceMetadata(
            '/api/characters/' + characterPath(value) + '/context-version',
            'POST',
            { eventId: eventId }
          );
        })
      : requestDeviceMetadata(
          '/api/characters/' + characterPath(value) + '/context-version',
          'POST',
          { eventId: eventId }
        );

    var promise = submit.then(function (payload) {
      if (readContextMetadata(pendingKey, localContextPendingEvents) === eventId) {
        writeContextMetadata(pendingKey, null, localContextPendingEvents);
      }
      if (readContextMetadata(snapshotPendingKey, localContextPendingEvents)) {
        writeContextMetadata(snapshotPendingKey, null, localContextPendingEvents);
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

  function noteCharacterContextChanged(characterId, history, snapshot) {
    var value = String(characterId || '');
    if (!value) return Promise.reject(new Error('角色 ID 无效'));
    var fingerprint = fingerprintCharacterHistory(history);
    if (fingerprint == null) return Promise.resolve({ changed: false });
    var initialContact = Boolean(snapshot && snapshot.initialContact === true);

    var fingerprintKey = contextMetadataKey(CONTEXT_FINGERPRINT_PREFIX, value);
    var pendingKey = contextMetadataKey(CONTEXT_PENDING_PREFIX, value);
    var snapshotPendingKey = contextMetadataKey(CONTEXT_SNAPSHOT_PENDING_PREFIX, value);

    function queueContentFreeVersion() {
      var previous = readContextMetadata(fingerprintKey, localContextFingerprints);
      if (previous === fingerprint) {
        return flushCharacterContextVersion(value).then(function (payload) {
          return { changed: false, synced: Boolean(payload), payload: payload };
        });
      }
      writeContextMetadata(fingerprintKey, fingerprint, localContextFingerprints);
      writeContextMetadata(pendingKey, randomBase64Url(18), localContextPendingEvents);
      writeContextMetadata(snapshotPendingKey, null, localContextPendingEvents);
      return flushCharacterContextVersion(value).then(function (payload) {
        return { changed: true, synced: Boolean(payload), payload: payload };
      });
    }

    if (!snapshot || typeof snapshot !== 'object') return queueContentFreeVersion();

    // Never send the snapshot body until the authenticated server confirms
    // that this account's separate context-sharing switch is enabled.
    return getContextSharing().then(function (sharing) {
      if (!sharing.enabled) return queueContentFreeVersion();
      var previous = readContextMetadata(fingerprintKey, localContextFingerprints);
      if (previous === fingerprint && !initialContact) {
        return flushCharacterContextVersion(value).then(function (payload) {
          return { changed: false, shared: true, synced: Boolean(payload), payload: payload };
        });
      }
      var eventId = randomBase64Url(18);
      var body = {
        eventId: eventId,
        characterName: String(snapshot.characterName || ''),
        personaText: String(snapshot.personaText || ''),
        recentMessages: Array.isArray(snapshot.recentMessages) ? snapshot.recentMessages.slice(-12) : [],
        lastUserMessageAt: Number(snapshot.lastUserMessageAt)
      };
      if (initialContact) body.initialContact = true;
      writeContextMetadata(fingerprintKey, fingerprint, localContextFingerprints);
      writeContextMetadata(pendingKey, eventId, localContextPendingEvents);
      writeContextMetadata(snapshotPendingKey, JSON.stringify(body), localContextPendingEvents);
      return flushCharacterContextVersion(value).then(function (payload) {
        return { changed: true, shared: true, synced: Boolean(payload), payload: payload };
      });
    }).catch(function (error) {
      // A failed preference read never falls back to uploading content.
      if (snapshot) {
        return queueContentFreeVersion().then(function (result) {
          result.contextSharingCheckFailed = true;
          return result;
        });
      }
      throw error;
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
      currentBrowserHasSubscription: null,
      currentBrowserMatched: null,
      serverReachable: false,
      vapidConfigured: false,
      message: ''
    };
    if (!status.supported) {
      status.message = pushSupportMessage();
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
        var activeSubscriptions = (payload.subscriptions || []).filter(function (item) {
          return !item.disabledAt;
        });
        status.subscriptionCount = activeSubscriptions.length;
        // Other browser profiles and stale registrations can contribute to the
        // server's count. Only a matching local endpoint represents THIS browser.
        try {
          var browserReg = await navigator.serviceWorker.getRegistration(apiPath('/'));
          var localSub = browserReg && browserReg.pushManager
            ? await browserReg.pushManager.getSubscription() : null;
          status.currentBrowserHasSubscription = Boolean(localSub);
          status.currentBrowserMatched = Boolean(localSub && activeSubscriptions.some(function (item) {
            return item.endpoint === localSub.endpoint;
          }));
        } catch (error) {
          status.currentBrowserHasSubscription = null;
          status.currentBrowserMatched = null;
        }
      } catch (error) {
        status.message = error.code === 'DEVICE_REVOKED'
          ? '设备授权已撤销，请重新配对'
          : error.code === 'DEVICE_UNKNOWN' || error.code === 'DEVICE_PAIRING_REQUIRED'
            ? '此设备尚未配对，请使用有效配对码连接'
            : '订阅状态读取失败：' + (error.message || '未知错误');
      }
    }
    if (!status.message) {
      if (status.permission === 'denied') status.message = '网站通知被浏览器拒绝，请检查本站权限';
      else if (status.permission === 'default') status.message = '网站通知尚未授权 · 点击推送开关';
      else if (!status.vapidConfigured) status.message = '云端尚未配置 VAPID 密钥';
      else if (!device) status.message = '设备尚未连接，开启推送后自动注册';
      else if (status.subscriptionCount > 0 && status.currentBrowserMatched === false) {
        status.message = status.currentBrowserHasSubscription
          ? '云端存有 ' + status.subscriptionCount + ' 条订阅，但当前浏览器的订阅未同步'
          : '云端存有 ' + status.subscriptionCount + ' 条订阅，但当前浏览器没有本地订阅';
      }
      else if (status.currentBrowserMatched === true) {
        status.message = '已登记 · 当前浏览器订阅匹配（云端共 ' + status.subscriptionCount + ' 条；不代表通知已显示）';
      }
      else if (status.subscriptionCount > 0) status.message = '云端存有 ' + status.subscriptionCount + ' 条订阅，当前浏览器状态待确认';
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
    // A local PushSubscription alone is not a completed cloud connection.
    setToggle(status.permission === 'granted' && status.currentBrowserMatched === true);
    var contextSharingToggle = document.getElementById('cloudContextSharingToggle');
    if (contextSharingToggle) {
      contextSharingToggle.disabled = true;
      contextSharingToggle.checked = false;
      if (readDevice()) {
        try {
          var contextSharing = await getContextSharing();
          contextSharingToggle.checked = Boolean(contextSharing.enabled);
          contextSharingToggle.disabled = false;
        } catch (error) {
          // Sharing remains disabled when its server state cannot be verified.
        }
      }
    }
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
    var emptyPushRow = document.getElementById('cloudEmptyPushRow');
    var localTestRow = document.getElementById('cloudLocalTestRow');
    var readinessRow = document.getElementById('cloudReadinessCheck');
    var readinessResult = document.getElementById('cloudReadinessResult');
    var contextSharingToggle = document.getElementById('cloudContextSharingToggle');
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
        !autonomyToggle && !contextSharingToggle && !roleSelect && !roleAutonomySave && !roleScheduleSave) return;

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

    if (contextSharingToggle) {
      contextSharingToggle.addEventListener('change', async function () {
        var desired = contextSharingToggle.checked;
        contextSharingToggle.disabled = true;
        setStatusText(desired ? '正在开启上下文共享…' : '正在关闭并删除云端上下文…');
        try {
          await setContextSharing(desired);
          setStatusText(desired
            ? '上下文共享已开启；从下一次成功保存聊天记录开始同步有限文字'
            : '上下文共享已关闭，云端角色快照已删除');
        } catch (error) {
          contextSharingToggle.checked = !desired;
          setStatusText('保存上下文共享设置失败：' + (error.message || '未知错误'));
        } finally {
          contextSharingToggle.disabled = false;
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
          var roleSaved = document.getElementById('cloudRoleSaveStatus');
          if (roleSaved) roleSaved.textContent = '角色授权已保存（不代表推送已发出）';
        } catch (error) {
          var roleError = document.getElementById('cloudRoleSaveStatus');
          if (roleError) roleError.textContent = '保存角色授权失败：' + (error.message || '未知错误');
        } finally {
          roleAutonomySave.disabled = false;
        }
      });
    }

    var initialTest = document.getElementById('cloudRoleInitialTest');
    var initialTestStatus = document.getElementById('cloudRoleInitialTestStatus');
    if (initialTest && initialTestStatus) {
      initialTest.addEventListener('click', async function () {
        var roleId = roleSelect && roleSelect.value;
        var role = localCharacters().find(function (item) {
          return item && String(item.id) === roleId;
        });
        if (!role) {
          initialTestStatus.textContent = '请先选择新建的测试角色。';
          return;
        }
        initialTest.disabled = true;
        initialTestStatus.textContent = '正在向云端确认角色任务…';
        try {
          var sharing = await getContextSharing();
          if (!sharing.enabled) throw new Error('请先开启允许云端使用角色上下文');
          var schedule = await getCharacterSchedule(roleId);
          if (!schedule || !schedule.timeZone || !schedule.schedule ||
              !Array.isArray(schedule.schedule.active) || !schedule.schedule.active.length) {
            throw new Error('请先保存这个角色的时区和允许主动联系的时段');
          }
          var result = await requestDeviceMetadata(
            '/api/characters/' + characterPath(roleId) + '/context-snapshot',
            'POST',
            {
              eventId: randomBase64Url(18),
              characterName: Array.from(String(role.name || role.nickname || '测试角色')).slice(0, 80).join(''),
              personaText: '用简短、自然的话打招呼。',
              recentMessages: [],
              lastUserMessageAt: 0,
              initialContact: true
            }
          );
          if (result.queued) {
            initialTestStatus.textContent = '已排队，可以锁屏。预计 ' +
              new Date(result.scheduledAt).toLocaleTimeString() + ' 后开始生成。';
            return;
          }
          var reasons = {
            autonomy_not_enabled: '请开启云端自主活动，并保存此角色的授权',
            activity_schedule_not_configured: '预览站的调度配置不完整',
            initial_contact_already_used: '该角色的首次联系任务已执行过，请检查聊天',
            conversation_already_exists: '该角色已有云端聊天上下文，请选择新建测试角色'
          };
          initialTestStatus.textContent = '未排队：' + (reasons[result.queueReason] || result.queueReason || '请检查云端上下文授权');
        } catch (error) {
          initialTestStatus.textContent = '排队失败：' + (error.message || '未知错误');
        } finally {
          initialTest.disabled = false;
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
          var reason = error.message || '操作失败';
          setStatusText(reason);
          var pushResult = document.getElementById('cloudPushResult');
          if (pushResult) pushResult.textContent = reason;
        }
        await refreshSettings();
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
            '服务端模型凭据：' + (ready.serverModelConfigured ? '已配置' : '未配置'),
            '角色上下文共享：' + (ready.contextSharingEnabled ? '已开启' : '默认关闭'),
            '云端定时调度：' + (ready.cloudSchedulerRuntimeVerified ? '最近 15 分钟内有运行记录' : '最近 15 分钟内没有运行记录'),
            '最近一次云端调度：' + (ready.cloudSchedulerLastRunAt ? new Date(ready.cloudSchedulerLastRunAt).toLocaleString() + '（' + String(ready.cloudSchedulerLastRunStatus || '未知') + '）' : '暂无记录'),
            '真实模型生成验收：' + (ready.cloudModelGenerationVerified ? '最近 30 天内有成功出站记录' : '最近 30 天内没有成功生成记录'),
            '最近一次真实模型出站：' + (ready.cloudModelLastGeneratedAt ? new Date(ready.cloudModelLastGeneratedAt).toLocaleString() : '暂无记录'),
            '当前设备 Web Push 服务端回执：' + (ready.cloudPushAcceptanceVerified ? '最近 30 天内有 HTTP 成功接受记录' : '最近 30 天内没有 HTTP 成功接受记录'),
            '当前设备最近 Push 接受：' + (ready.cloudPushLastAcceptedAt ? new Date(ready.cloudPushLastAcceptedAt).toLocaleString() : '暂无记录'),
            '当前设备最近 24 小时推送异常：' + (Array.isArray(ready.recentPushReasons) && ready.recentPushReasons.length
              ? ready.recentPushReasons.map(function (item) {
                  var labels = {
                    push_delivery_failed: '推送服务请求失败（按策略重试或终止）',
                    subscription_gone: '推送订阅已被服务端判定失效',
                    subscription_unavailable_before_send: '发送前订阅已撤销或失效',
                    delivery_lease_lost: '投递租约已过期或被其他执行者接管'
                  };
                  return (labels[item.reasonCode] || item.reasonCode) + ' × ' + Number(item.count || 0);
                }).join('、')
              : '暂无记录'),
            '说明：服务端接受不等于系统已显示通知；Android 锁屏横幅仍需真机验收。',
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
            '主动联系/推送未完成项：' + (Array.isArray(ready.autonomyExecutionBlockers) && ready.autonomyExecutionBlockers.concat(Array.isArray(ready.pushDeliveryBlockers) ? ready.pushDeliveryBlockers : []).length
              ? ready.autonomyExecutionBlockers.concat(Array.isArray(ready.pushDeliveryBlockers) ? ready.pushDeliveryBlockers : []).map(function (reason) {
                  var labels = {
                    web_push_keys_not_configured: '未配置 Web Push 密钥',
                    current_device_push_subscription_missing: '当前设备没有有效推送订阅',
                    activity_executor_config_missing: '云端活动执行参数缺失',
                    server_model_credentials_missing: '未配置服务端模型凭据',
                    global_autonomy_not_enabled: '账号级主动联系总开关未开启',
                    context_sharing_not_enabled: '尚未同意云端上下文共享',
                    context_version_unavailable: '尚无可信聊天上下文版本',
                    cloud_model_scheduler_runtime_not_verified: '最近 15 分钟没有云端调度运行记录',
                    cloud_model_generation_not_verified: '最近 30 天没有成功的模型出站入库记录',
                    cloud_push_provider_acceptance_not_verified: '当前设备最近 30 天没有 Web Push 服务端成功接受回执'
                  };
                  return labels[reason] || reason;
                }).join('；')
              : '暂无'),
            '云端主动生成：' + (ready.autonomousMessageGenerationReady ? '已通过近期运行验收' : '未就绪'),
            '当前设备推送：' + (ready.pushDeliveryReady ? '已通过近期服务端接受验收' : '未就绪'),
            '主动联系＋推送闭环：' + (ready.autonomousContactAndPushReady ? '已就绪' : '未完成'),
            '',
            ready.note || '此检查只读取配置与匿名队列汇总，不会发送通知。'
          ];
          if (readinessResult) readinessResult.textContent = lines.join('\n');
          setStatusText(ready.autonomousContactAndPushReady
            ? '主动联系与当前设备推送均已通过近期验收'
            : ready.autonomousMessageGenerationReady && ready.pushDeliveryReady
              ? '云端主动生成与当前设备推送已通过独立验收'
              : ready.autonomousMessageGenerationReady && ready.testPushReady
                ? '云端主动生成已就绪；推送通道可测试，但近期接受回执尚未通过'
                : ready.autonomousMessageGenerationReady
                  ? '云端主动生成已就绪；当前设备推送仍有配置或验收项目未完成'
                  : ready.testPushReady
                    ? '当前设备推送可进行测试；云端主动生成仍有配置或运行验收项目未完成'
                    : '云端仍有配置未完成');
        } catch (error) {
          if (readinessResult) readinessResult.textContent = '检查失败：' + (error.message || '未知错误');
          setStatusText('读取云端准备情况失败');
        } finally {
          readinessRow.removeAttribute('aria-disabled');
        }
      });
    }

    if (localTestRow) {
      localTestRow.addEventListener('click', async function () {
        var resultEl = document.getElementById('cloudLocalResult');
        function report(message) {
          if (resultEl) resultEl.textContent = message;
        }
        localTestRow.disabled = true;
        report('正在检查当前浏览器的系统通知能力…');
        try {
          // The local test must work without any device pairing or server API.
          await requestNotificationPermissionFromGesture();
          var registration = await getRegistration();
          if (!registration || !registration.active || typeof registration.showNotification !== 'function') {
            throw new Error('当前浏览器的 Service Worker 没有正常激活');
          }
          var tag = 'maomao-local-' + Date.now();
          await registration.showNotification('MAOMAO · 本机通知自检', {
            body: '这条通知由当前浏览器生成，不依赖云端服务器。',
            tag: tag,
            silent: false
          });
          var listed = [];
          if (typeof registration.getNotifications === 'function') {
            listed = await registration.getNotifications({ tag: tag });
          }
          report(listed.length > 0
            ? '浏览器已登记本机系统通知。请查看手机通知栏；如果没有显示，问题在浏览器或安卓系统通知展示。'
            : '本机显示请求已提交，但未能确认系统登记通知；请检查浏览器通知渠道。');
        } catch (error) {
          report('本机通知自检失败：' + (error?.name || 'Error') + '，' +
            (error?.message || '未知错误'));
        } finally {
          localTestRow.disabled = false;
        }
      });
    }

    if (emptyPushRow) {
      emptyPushRow.addEventListener('click', async function () {
        var status = document.getElementById('cloudEmptyPushResult');
        function report(message) { if (status) status.textContent = message; }
        emptyPushRow.disabled = true;
        report('正在发送无加密内容的远程唤醒测试…');
        try {
          var result = await sendTestPush('no_payload');
          var summary = result.summary || {};
          if (Number(summary.sent) > 0) {
            report('FCM 已接受空载远程推送。请查看通知栏是否出现“远程空载通知”；这仍不是手机已收到的证明。');
          } else {
            var detail = (result.results || []).find(function (item) {
              return item.status === 'failed' || item.status === 'retry_scheduled' || item.status === 'gone';
            }) || {};
            var phases = {
              vapid: 'VAPID 签名异常',
              encrypt: '载荷加密异常（空载模式不应发生）',
              transport: 'Worker 连接推送服务失败',
              provider_http: '推送服务 HTTP ' + (detail.httpStatus || '?'),
              unknown: '发送阶段未能确认'
            };
            report('空载远程测试未确认发送：' + (Number(summary.failed) > 0
              ? (phases[detail.failurePhase] || '服务器投递失败') +
                (detail.failureDiagnostic ? '（' + detail.failureDiagnostic + '）' : '')
              : '请求被去重、限流或延迟') + '。');
          }
        } catch (error) {
          report('空载远程测试失败：' + (error?.message || '未知错误'));
        } finally { emptyPushRow.disabled = false; }
      });
    }

    if (testRow) {
      testRow.addEventListener('click', async function () {
        var pushResult = document.getElementById('cloudPushResult');
        function report(message) {
          if (pushResult) pushResult.textContent = message;
          setStatusText(message);
        }
        testRow.disabled = true;
        report('正在请求发送一条系统测试通知…');
        try {
          var result = await sendTestPush();
          var summary = result.summary || {};
          if (Number(summary.sent) > 0) {
            report('推送服务已接受测试通知。请检查系统通知栏；收到通知才算手机验收通过。');
          } else if (Number(summary.failed) > 0) {
            var item = (result.results || []).find(function (entry) {
              return entry.status === 'failed' || entry.status === 'retry_scheduled' || entry.status === 'gone';
            }) || {};
            var reasons = {
              vapid: '服务器 VAPID 签名错误',
              encrypt: '服务器消息加密错误',
              transport: '服务器连接推送服务失败',
              provider_http: '推送服务拒绝了请求（HTTP ' + (item.httpStatus || '?') + '）',
              unknown: '服务端发送失败，需查看云端诊断'
            };
            var reason = reasons[item.failurePhase] || reasons.unknown;
            var classification = item.failureKind ? '，异常类型 ' + item.failureKind : '';
            var diagnostic = item.failureDiagnostic
              ? '，诊断码 ' + item.failureDiagnostic : '';
            report('测试通知未送达：' + reason + classification + diagnostic + '。不需要重置账号或重复开启权限。');
          } else if (summary.skipped) {
            report('本次通知被去重或延迟，尚未确认送达。');
          } else {
            report('服务器未确认任何通知送达，请检查设备订阅与推送日志。');
          }
        } catch (error) {
          report('测试通知未发出：' + (error.message || '未知错误'));
        } finally {
          testRow.disabled = false;
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
            : '设备已配对，但' + pushSupportMessage());
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
      setStatusText(pushSupportMessage());
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
    getContextSharing: getContextSharing,
    setContextSharing: setContextSharing,
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
    _internal: { ensureDevice: ensureDevice, readDevice: readDevice, clearDevice: clearDevice, registerDeviceForCurrentAccount: registerDeviceForCurrentAccount, getPresenceRenewInterval: getPresenceRenewInterval, requestNotificationPermissionFromGesture: requestNotificationPermissionFromGesture, notificationPermissionMessage: notificationPermissionMessage, fingerprintCharacterHistory: fingerprintCharacterHistory }
  };
})(typeof window !== 'undefined' ? window : self);
