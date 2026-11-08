(() => {
  'use strict';
  const form = document.getElementById('bootstrapForm');
  const errorNode = document.getElementById('bootstrapError');
  const completeNode = document.getElementById('bootstrapComplete');

  async function request(path, method = 'GET', body = null) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error?.message || '请求失败，请稍后再试');
      error.code = payload.error?.code || 'REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showInitialized() {
    form.hidden = true;
    completeNode.hidden = false;
    errorNode.textContent = '';
  }

  async function checkStatus() {
    try {
      const status = await request('/api/admin/bootstrap/status');
      if (status.initialized) showInitialized();
    } catch (error) {
      errorNode.textContent = error.message || '暂时无法读取初始化状态。';
    }
  }

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
      window.location.replace('../index.html');
    } catch (error) {
      if (error.code === 'ADMIN_ALREADY_INITIALIZED') {
        showInitialized();
        return;
      }
      errorNode.textContent = error.message || '初始化失败，请检查密钥并重试。';
    } finally {
      button.disabled = false;
    }
  });

  checkStatus();
})();
