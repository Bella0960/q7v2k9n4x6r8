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
      cache: 'no-store'
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
    return enablePush(true, code);
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

  function requestDeviceMetadata(path, method, body) {
    var device = readDevice();
    if (!device) return Promise.reject(new Error('设备尚未连接'));
    return requestJson(path, {
      method: method || 'GET',
      device: device,
      body: body
    });
  }

  function characterPath(characterId) {
    var value = String(characterId || '');
    if (!value || value.length > 96) throw new Error('角色 ID 无效');
    return encodeURIComponent(value);
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

  function updatePresenceHeartbeat(foregroundActive) {
    if (typeof foregroundActive !== 'boolean') {
      return Promise.reject(new Error('foregroundActive 必须是布尔值'));
    }
    return requestDeviceMetadata('/api/presence/heartbeat', 'POST', {
      foregroundActive: foregroundActive
    });
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

  /**
   * Starts a character-scoped foreground lease while this chat page is visible.
   * All timing comes from the authenticated server config; no client defaults.
   * A hidden tab only marks its device heartbeat inactive. Its role lease is
   * allowed to expire naturally so another visible tab on the same device is
   * not accidentally unlocked.
   */
  async function startCharacterPresence(characterId) {
    var encodedId = characterPath(characterId);
    if (typeof document === 'undefined') throw new Error('当前页面不支持前台状态同步');
    if (!readDevice()) throw new Error('设备尚未连接云端');

    var config = await requestDeviceMetadata('/api/presence/config');
    var ttl = Number(config.heartbeatTtlMs);
    var leaseDuration = Number(config.leaseDurationMs);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 ||
        !Number.isSafeInteger(leaseDuration) || leaseDuration <= 0) {
      throw new Error('云端没有提供有效的心跳 TTL / 租约时长配置');
    }
    var renewInterval = Math.max(1, Math.floor(Math.min(ttl, leaseDuration) / 3));

    var stopped = false;
    var running = false;
    var intervalId = null;
    var leasePath = '/api/characters/' + encodedId + '/lease';

    async function syncVisibleSession() {
      if (stopped || running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        await updatePresenceHeartbeat(true);
        try {
          await requestDeviceMetadata(leasePath, 'POST', { action: 'renew' });
        } catch (renewError) {
          if (renewError.code !== 'LEASE_NOT_OWNED') throw renewError;
          try {
            await requestDeviceMetadata(leasePath, 'POST', { action: 'acquire' });
          } catch (acquireError) {
            if (acquireError.code !== 'CHARACTER_LEASE_HELD') throw acquireError;
          }
        }
      } finally {
        running = false;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        updatePresenceHeartbeat(false).catch(function () {});
      } else {
        syncVisibleSession().catch(function (error) {
          console.warn('[cloud] 角色前台租约续期失败', error);
        });
      }
    }

    function onPageHide() {
      updatePresenceHeartbeat(false).catch(function () {});
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    global.addEventListener('pagehide', onPageHide);

    try {
      await syncVisibleSession();
      intervalId = global.setInterval(
        function () {
          syncVisibleSession().catch(function (error) {
            console.warn('[cloud] 角色前台租约续期失败', error);
          });
        },
        renewInterval
      );
    } catch (error) {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      global.removeEventListener('pagehide', onPageHide);
      throw error;
    }

    return {
      stop: function () {
        if (stopped) return;
        stopped = true;
        if (intervalId != null) global.clearInterval(intervalId);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        global.removeEventListener('pagehide', onPageHide);
        updatePresenceHeartbeat(false).catch(function () {});
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
    setStatusText(status.message || '未连接');
    return status;
  }

  async function mountSettings() {
    var toggle = document.getElementById('cloudPushToggle');
    var testRow = document.getElementById('cloudTestRow');
    var revokeRow = document.getElementById('cloudRevokeRow');
    var pairCreateRow = document.getElementById('cloudPairCreateRow');
    var pairCodeInput = document.getElementById('cloudPairCodeInput');
    var pairConnectButton = document.getElementById('cloudPairConnectButton');
    var pairCodePanel = document.getElementById('cloudPairCodePanel');
    var pairCodeOutput = document.getElementById('cloudPairCodeOutput');
    var pairCodeCopyButton = document.getElementById('cloudPairCodeCopyButton');
    if (!toggle && !testRow && !revokeRow && !pairCreateRow && !pairConnectButton) return;

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
          await connectDeviceWithPairingCode(code);
          if (pairCodeInput) pairCodeInput.value = '';
          setStatusText('设备已配对，推送订阅已连接');
          await refreshSettings();
        } catch (error) {
          setStatusText('设备配对失败：' + (error.message || '未知错误'));
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
    getGlobalAutonomy: getGlobalAutonomy,
    setGlobalAutonomy: setGlobalAutonomy,
    getCharacterAutonomy: getCharacterAutonomy,
    setCharacterAutonomy: setCharacterAutonomy,
    getCharacterSchedule: getCharacterSchedule,
    setCharacterSchedule: setCharacterSchedule,
    updatePresenceHeartbeat: updatePresenceHeartbeat,
    updateCharacterLease: updateCharacterLease,
    startCharacterPresence: startCharacterPresence,
    disconnect: disconnect,
    getStatus: getStatus,
    refreshSettings: refreshSettings,
    mountSettings: mountSettings,
    _internal: { ensureDevice: ensureDevice, readDevice: readDevice, clearDevice: clearDevice }
  };
})(typeof window !== 'undefined' ? window : self);
