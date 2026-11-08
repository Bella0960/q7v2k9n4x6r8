(() => {
  'use strict';

  const panels = ['welcomePanel', 'registerPanel', 'loginPanel', 'invitePanel', 'authorizedPanel', 'blockedPanel'];
  const byId = id => document.getElementById(id);
  let currentAccount = null;

  function showPanel(id) {
    for (const panelId of panels) {
      const panel = byId(panelId);
      if (panel) panel.hidden = panelId !== id;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setError(id, message = '') {
    const node = byId(id);
    if (node) node.textContent = message;
  }

  async function api(path, method = 'GET', body = null) {
    const headers = body ? { 'content-type': 'application/json' } : {};
    // The account-entry page is intentionally public and has no injected scope
    // script. Once login has identified the pending account, bind invite
    // redemption explicitly so it receives the same server-side context check
    // as requests made from authenticated app pages.
    if (path === '/api/accounts/invites/redeem' && currentAccount?.id) {
      headers['x-mao-account-context'] = currentAccount.id;
    }
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* malformed response is handled below */ }
    if (!response.ok || payload.ok === false) {
      const code = payload.error?.code || 'REQUEST_FAILED';
      const error = new Error(payload.error?.message || '请求未成功，请稍后再试');
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function presentAccount(account) {
    currentAccount = account || null;
    if (!account) {
      showPanel('welcomePanel');
      return;
    }
    if (account.status === 'disabled' || account.status === 'revoked') {
      showPanel('blockedPanel');
      return;
    }
    if (account.status === 'pending_invite') {
      byId('pendingAccountId').textContent = account.id || '—';
      showPanel('invitePanel');
      return;
    }
    if (account.status === 'active') {
      byId('authorizedAccountId').textContent = account.id || '—';
      showPanel('authorizedPanel');
      return;
    }
    showPanel('welcomePanel');
  }

  function showAuthError(error, fieldId) {
    if (error.code === 'ACCOUNT_DISABLED') {
      showPanel('blockedPanel');
      return;
    }
    setError(fieldId, error.message || '请求失败，请稍后再试');
  }

  document.querySelectorAll('[data-show]').forEach(button => {
    button.addEventListener('click', () => {
      setError('registerError');
      setError('loginError');
      setError('inviteError');
      showPanel(button.dataset.show);
    });
  });

  document.querySelectorAll('[data-legal]').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = byId('legalDialog');
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
  });
  byId('closeLegal').addEventListener('click', () => byId('legalDialog').close());
  byId('confirmLegal').addEventListener('click', () => byId('legalDialog').close());

  byId('registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    setError('registerError');
    const form = new FormData(event.currentTarget);
    const body = {
      username: String(form.get('username') || '').trim(),
      password: String(form.get('password') || ''),
      confirmPassword: String(form.get('confirmPassword') || ''),
      qqEmail: String(form.get('qqEmail') || '').trim()
    };
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const created = await api('/api/accounts/register', 'POST', body);
      const accountId = created.account.id;
      const signedIn = await api('/api/accounts/login', 'POST', {
        identifier: body.username,
        password: body.password
      });
      const account = signedIn.account || { id: accountId, status: 'pending_invite' };
      byId('pendingAccountId').textContent = account.id || accountId;
      presentAccount({ ...account, status: account.status || 'pending_invite' });
    } catch (error) {
      showAuthError(error, 'registerError');
    } finally {
      button.disabled = false;
    }
  });

  byId('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    setError('loginError');
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/accounts/login', 'POST', {
        identifier: String(form.get('identifier') || '').trim(),
        password: String(form.get('password') || '')
      });
      presentAccount(result.account);
    } catch (error) {
      showAuthError(error, 'loginError');
    } finally {
      button.disabled = false;
    }
  });

  byId('inviteForm').addEventListener('submit', async event => {
    event.preventDefault();
    setError('inviteError');
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/accounts/invites/redeem', 'POST', {
        inviteCode: String(form.get('inviteCode') || '').trim()
      });
      presentAccount(result.account);
    } catch (error) {
      showAuthError(error, 'inviteError');
    } finally {
      button.disabled = false;
    }
  });

  byId('copyAccountId').addEventListener('click', async () => {
    const value = byId('pendingAccountId').textContent;
    if (!value || value === '—') return;
    try {
      await navigator.clipboard.writeText(value);
      byId('copyAccountId').textContent = '已复制';
    } catch {
      byId('copyAccountId').textContent = value;
    }
  });

  byId('enterMao').addEventListener('click', () => {
    if (currentAccount?.status === 'active') window.location.assign('/index.html');
  });

  async function checkCreatorBootstrapEntry() {
    const link = byId('creatorBootstrapLink');
    if (!link) return;
    try {
      const status = await api('/api/admin/bootstrap/status');
      link.hidden = Boolean(status.initialized);
    } catch {
      link.hidden = true;
    }
  }

  (async function restoreSession() {
    const params = new URLSearchParams(window.location.search);
    checkCreatorBootstrapEntry();
    if (params.get('disabled') === '1') {
      showPanel('blockedPanel');
      return;
    }
    try {
      const result = await api('/api/accounts/me');
      presentAccount(result.account);
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') showPanel('blockedPanel');
      else showPanel('welcomePanel');
    }
  })();
})();
