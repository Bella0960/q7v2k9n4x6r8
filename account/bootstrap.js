(() => {
  'use strict';
  const form = document.getElementById('bootstrapForm');
  const errorNode = document.getElementById('bootstrapError');
  const completeNode = document.getElementById('bootstrapComplete');
  const statusNode = document.getElementById('bootstrapStatus');
  const retryButton = document.getElementById('retryBootstrapCheck');
  const setupHelp = document.getElementById('bootstrapSetupHelp');
  let statusCheckInProgress = false;

  async function request(path, method = 'GET', body = null) {
    const controller = new AbortController();
    // The first password derivation may run on a cold Durable Object.
    // Give one-time founder creation more time, without automatically repeating it.
    const timeoutMs = method === 'POST' ? 60000 : 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(payload?.error?.message || '服务器返回异常，请检查连接后重试');
        error.code = payload?.error?.code || 'REQUEST_FAILED';
        error.status = response.status;
        throw error;
      }
      // A successful HTTP status alone must never unlock administrator UI.
      if (path === '/api/admin/bootstrap/status' && typeof payload.initialized !== 'boolean') {
        throw new Error('服务器初始化状态无效，请刷新后重试');
      }
      if (path === '/api/admin/bootstrap' &&
          (payload.account?.role !== 'super_admin' || payload.account?.founderNumber !== '001')) {
        throw new Error('服务器尚未确认管理员身份，请不要重复提交，先检查登录状态');
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('请求超时，操作结果尚未确认。');
        timeoutError.code = 'REQUEST_TIMEOUT';
        throw timeoutError;
      }
      if (error?.name === 'TypeError') {
        const networkError = new Error('网络连接中断，暂时无法确认提交结果。');
        networkError.code = 'NETWORK_ERROR';
        throw networkError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function showInitialized() {
    form.hidden = true;
    statusNode.hidden = true;
    retryButton.hidden = true;
    if (setupHelp) setupHelp.hidden = true;
    completeNode.hidden = false;
    errorNode.textContent = '';
  }

  async function checkStatus() {
    if (statusCheckInProgress) return;
    statusCheckInProgress = true;
    form.hidden = true;
    completeNode.hidden = true;
    statusNode.hidden = false;
    statusNode.textContent = '正在确认服务器初始化状态…';
    retryButton.hidden = true;
    if (setupHelp) setupHelp.hidden = true;
    retryButton.disabled = true;

    try {
      const status = await request('/api/admin/bootstrap/status');
      if (status.initialized) {
        showInitialized();
        return;
      }
      if (status.configured === false) {
        // Never present a form that the server cannot accept yet.
        statusNode.textContent = '账号测试环境尚未配置安全密钥，请按下方说明设置后重新检查。';
        retryButton.hidden = false;
        if (setupHelp) setupHelp.hidden = false;
        return;
      }
      statusNode.hidden = true;
      form.hidden = false;
      errorNode.textContent = '';
    } catch (error) {
      statusNode.hidden = false;
      statusNode.textContent = '暂时无法确认初始化状态。请检查网络或预览服务后重试。' +
        (error.message ? '（' + error.message + '）' : '');
      retryButton.hidden = false;
      errorNode.textContent = '';
    } finally {
      statusCheckInProgress = false;
      retryButton.disabled = false;
    }
  }

  // Local-only setup helper. No generated key is uploaded or persisted by
  // this UI; users explicitly paste both values into their own Cloudflare Preview.
  const generateButton = document.getElementById('bootstrapMakeSecrets');
  const generatedTools = document.getElementById('bootstrapSecretTools');
  const pepperValue = document.getElementById('bootstrapPepperValue');
  const founderValue = document.getElementById('bootstrapFounderValue');
  const copyStatus = document.getElementById('bootstrapCopyStatus');
  if (generateButton && generatedTools && pepperValue && founderValue) {
    generateButton.addEventListener('click', () => {
      if (!globalThis.crypto || typeof crypto.getRandomValues !== 'function') {
        if (copyStatus) copyStatus.textContent = '当前浏览器不支持安全随机数生成，请使用更新版本的 HTTPS 浏览器。';
        return;
      }
      const hexSecret = () => {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      };
      pepperValue.value = hexSecret();
      founderValue.value = hexSecret();
      // The user will need this same value after configuring Cloudflare.
      const formSecret = form.querySelector('[name="bootstrapSecret"]');
      if (formSecret) formSecret.value = founderValue.value;
      generatedTools.hidden = false;
      if (copyStatus) copyStatus.textContent = '两组不同密钥已生成。请复制到 Cloudflare Preview；关闭本页后无法恢复。';
    });
    for (const button of document.querySelectorAll('[data-bootstrap-copy]')) {
      button.addEventListener('click', async () => {
        const value = button.dataset.bootstrapCopy === 'pepper' ? pepperValue.value : founderValue.value;
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          if (copyStatus) copyStatus.textContent = '已复制。请粘贴到对应的 Cloudflare Preview Secret，不要发送给其他人。';
        } catch {
          if (copyStatus) copyStatus.textContent = '浏览器未允许复制，请长按对应输入框复制，或在安全浏览器重试。';
        }
      });
    }
  }

  retryButton.addEventListener('click', checkStatus);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorNode.textContent = '';
    const values = new FormData(form);
    const body = {
      bootstrapSecret: String(values.get('bootstrapSecret') || ''),
      username: String(values.get('username') || '').trim(),
      password: String(values.get('password') || ''),
      confirmPassword: String(values.get('confirmPassword') || ''),
      qqEmail: String(values.get('qqEmail') || '').trim()
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    let attemptedCreate = false;
    try {
      const status = await request('/api/admin/bootstrap/status');
      if (status.initialized) {
        showInitialized();
        return;
      }
      // First verify that authenticated-preview networking permits a same-origin
      // POST. This probe never transmits passwords or initialization secrets.
      const probe = await request('/api/admin/bootstrap/preflight', 'POST', {});
      if (probe.initialized) {
        showInitialized();
        return;
      }
      if (probe.configured === false) {
        errorNode.textContent = '服务器安全配置尚未就绪，尚未提交管理员资料。';
        return;
      }
      attemptedCreate = true;
      await request('/api/admin/bootstrap', 'POST', body);
      // The bootstrap endpoint establishes the new super-admin's HttpOnly session.
      form.reset();
      window.location.replace('/admin/admin-center.html');
    } catch (error) {
      if (error.code === 'ADMIN_ALREADY_INITIALIZED') {
        showInitialized();
        return;
      }
      if (error.code === 'ADMIN_BOOTSTRAP_NOT_CONFIGURED') {
        errorNode.textContent = '服务器初始化尚未配置完成。请先在 Cloudflare Worker Secrets 中设置 MAO_SUPER_ADMIN_BOOTSTRAP_SECRET（至少 32 位），并确认 DEVICE_SECRET_PEPPER（至少 32 位）已配置。配置完成后重新加载本页再试。';
        return;
      }
      if (error.code === 'INVALID_BOOTSTRAP_SECRET') {
        errorNode.textContent = '初始化密钥与服务器配置不一致，请核对后重试。不要将密钥发送给任何人。';
        return;
      }
      if (!attemptedCreate) {
        errorNode.textContent = '连接检查没有通过，管理员资料尚未提交。请检查网络或稍后重试。' +
          (error.code ? '（' + error.code + '）' : '');
        return;
      }
      if (error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' ||
          (typeof error.status === 'number' && error.status >= 500)) {
        // A failed response is not proof that the one-time write failed.
        // Read server state only; NEVER automatically repeat the POST.
        errorNode.textContent = '提交结果尚未确认，正在检查管理员是否已经创建…';
        try {
          const status = await request('/api/admin/bootstrap/status');
          if (status.initialized) {
            showInitialized();
            return;
          }
          errorNode.textContent = '刚才的提交没有获得成功回执，目前也未查到管理员。请检查连接后再操作，不要连续点击创建。' +
            (error.code ? '（' + error.code + '）' : '');
        } catch {
          errorNode.textContent = '提交时网络中断，且暂时无法确认结果。请不要重复提交，稍后刷新页面检查初始化状态。';
        }
        return;
      }
      errorNode.textContent = error.message || '初始化失败，请检查密钥并重试。';
    } finally {
      button.disabled = false;
    }
  });

  checkStatus();
})();
