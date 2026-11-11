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
    const timer = setTimeout(() => controller.abort(), 15000);
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
        throw new Error('请求超时，操作结果尚未确认。请先重新检查初始化状态，不要反复注册。');
      }
      if (error instanceof TypeError) {
        throw new Error('网络连接失败，请检查手机网络后重新检查。');
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
    try {
      const status = await request('/api/admin/bootstrap/status');
      if (status.initialized) {
        showInitialized();
        return;
      }
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
      errorNode.textContent = error.message || '初始化失败，请检查密钥并重试。';
    } finally {
      button.disabled = false;
    }
  });

  checkStatus();
})();
