(() => {
  'use strict';

  const panels = ['welcomePanel', 'registerPanel', 'loginPanel', 'invitePanel', 'authorizedPanel', 'blockedPanel'];
  const byId = id => document.getElementById(id);
  let currentAccount = null;
  let viewRevision = 0;
  let authBusy = false;
  let delegatedIdentity = false;
  let delegatedSignInReady = true;

  function setAuthBusy(value) {
    authBusy = value;
    document.querySelectorAll('[data-show], .form button[type="submit"]').forEach(button => {
      button.disabled = value;
    });
  }

  function showPanel(id) {
    viewRevision += 1;
    for (const panelId of panels) {
      const panel = byId(panelId);
      if (panel) panel.hidden = panelId !== id;
    }
    // Appearance only. All authentication and invitation logic continues below.
    const viewMap = {
      welcomePanel: ['welcome', 'welcome.html', 'PRIVATE SPACE', '给日常留一处属于自己的空间。', 'a place of your own · vol. 01'],
      registerPanel: ['signup', 'create.html', 'NEW BEGINNING', '为自己的小小空间，写下第一行。', ''],
      loginPanel: ['login', 'login.html', 'WELCOME BACK', '属于你的故事，继续从这里开始。', ''],
      invitePanel: ['invite', 'invitation.html', 'PRIVATE INVITATION', '每个小空间，都有一把自己的钥匙。', ''],
      authorizedPanel: ['authorized', 'welcome.html', 'YOUR SPACE', '你的空间已经准备好了。', ''],
      blockedPanel: ['blocked', 'account.html', 'ACCOUNT NOTICE', '当前账号暂时无法进入。', '']
    };
    const visual = viewMap[id] || viewMap.welcomePanel;
    const shell = byId('ivoryApp');
    if (shell) shell.dataset.view = visual[0];
    // A single header back control for every step; never overlay form inputs.
    const back = byId('ivoryNavBack');
    if (back) {
      back.hidden = id === 'welcomePanel' || id === 'authorizedPanel';
      back.dataset.show = (id === 'invitePanel' || id === 'blockedPanel') ? 'loginPanel' : 'welcomePanel';
    }
    if (byId('ivoryWindowTitle')) byId('ivoryWindowTitle').textContent = visual[1] + ' — private space';
    if (byId('ivoryKicker')) byId('ivoryKicker').textContent = visual[2];
    if (byId('ivoryHeading')) {
      byId('ivoryHeading').innerHTML = ({
        welcomePanel: '欢迎来到 <span class="latin">MAO</span>',
        registerPanel: '开启新的篇章',
        loginPanel: '欢迎回来',
        invitePanel: '只属于你的邀请',
        authorizedPanel: '欢迎进入 <span class="latin">MAO</span>',
        blockedPanel: '账号状态通知'
      })[id] || '欢迎来到 <span class="latin">MAO</span>';
    }
    if (byId('ivorySubtitle')) byId('ivorySubtitle').textContent = visual[3];
    if (byId('ivoryMeta')) {
      byId('ivoryMeta').textContent = visual[4];
      byId('ivoryMeta').hidden = !visual[4];
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal
      });
      let payload;
      try { payload = await response.json(); } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('服务返回异常，请稍后再试；若刚提交注册，请先尝试登录。');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('服务返回异常，请稍后再试。');
      }
      if (!response.ok || payload.ok === false) {
        const code = payload.error?.code || 'REQUEST_FAILED';
        const error = new Error(payload.error?.message || '请求未成功，请稍后再试');
        error.code = code;
        error.status = response.status;
        throw error;
      }
      if (payload.ok !== true) throw new Error('服务返回异常，请稍后再试。');
      if (['/api/accounts/register', '/api/accounts/login', '/api/accounts/me', '/api/accounts/invites/redeem'].includes(path) &&
          (!/^MAO-[A-Z0-9]{12,24}$/.test(String(payload.account?.id || '')) ||
           !['pending_invite', 'active', 'disabled', 'revoked'].includes(payload.account?.status))) {
        throw new Error('账号结果未能确认，请重新登录后继续。');
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('请求超时，结果尚未确认。若刚提交注册，请先尝试登录，避免重复创建。');
      }
      if (error instanceof TypeError) throw new Error('网络连接失败，请检查网络后重试。');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function presentAccount(account, options = {}) {
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
      if (delegatedIdentity) {
        showPanel('loginPanel');
        setError('loginError', '当前测试版沿用统一账号，不需要邀请码；请使用已获授权的原账号登录。');
        return;
      }
      byId('pendingAccountId').textContent = account.id || '—';
      showPanel('invitePanel');
      return;
    }
    if (account.status === 'active') {
      // Both normal users and the creator enter the same phone desktop.
      // The server-injected account role controls the creator-only tile.
      byId('authorizedAccountId').textContent = account.id || '—';
      showPanel('authorizedPanel');
      // First successful invite redemption deserves a real confirmation screen.
      // Returning active sessions and ordinary logins still enter the desktop directly.
      if (options.fromInvite !== true) window.location.assign('/index.html');
      return;
    }
    showPanel('welcomePanel');
  }

  function showAuthError(error, fieldId) {
    if (error.code === 'ACCOUNT_DISABLED') {
      showPanel('blockedPanel');
      return;
    }
    if (error.status === 401 && fieldId === 'inviteError') {
      currentAccount = null;
      showPanel('loginPanel');
      setError('loginError', '登录已过期，请重新登录后继续验证邀请码。');
      return;
    }
    setError(fieldId, error.message || '请求失败，请稍后再试');
  }

  document.querySelectorAll('[data-show]').forEach(button => {
    button.addEventListener('click', () => {
      setError('registerError');
      setError('loginError');
      setError('inviteError');
      if (delegatedIdentity && (button.dataset.show === 'registerPanel' || button.dataset.show === 'invitePanel')) {
        showPanel('loginPanel');
        return;
      }
      showPanel(button.dataset.show);
      if (delegatedIdentity && !delegatedSignInReady) {
        setError('loginError', '统一身份验证尚未接通，暂时不要输入管理员密码，也不需要邀请码或重新注册。');
      }
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

  document.querySelectorAll('[data-password-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = byId(button.dataset.target || '');
      if (!input) return;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', visible ? 'true' : 'false');
      button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
      button.title = visible ? '隐藏密码' : '显示密码';
    });
  });

  const creatorContactDialog = byId('creatorContactDialog');
  byId('creatorContactButton').addEventListener('click', () => {
    if (typeof creatorContactDialog.showModal === 'function') creatorContactDialog.showModal();
    else creatorContactDialog.setAttribute('open', '');
  });
  byId('closeCreatorContact').addEventListener('click', () => creatorContactDialog.close());
  byId('confirmCreatorContact').addEventListener('click', () => creatorContactDialog.close());

  byId('registerForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (authBusy) return;
    setError('registerError');
    const form = new FormData(event.currentTarget);
    const body = {
      username: String(form.get('username') || '').trim(),
      password: String(form.get('password') || ''),
      confirmPassword: String(form.get('confirmPassword') || ''),
      qqEmail: String(form.get('qqEmail') || '').trim()
    };
    if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(body.username)) {
      setError('registerError', '用户名需要为 2–24 位字母、数字、下划线或连字符。');
      return;
    }
    if (body.password.length < 10 || body.password.length > 128) {
      setError('registerError', '密码长度需要为 10–128 位。');
      return;
    }
    if (body.password !== body.confirmPassword) {
      setError('registerError', '两次输入的密码不一致。');
      return;
    }
    if (body.qqEmail && (body.qqEmail.length > 254 || !/^[^\s@]+@(?:qq\.com|vip\.qq\.com|foxmail\.com)$/i.test(body.qqEmail))) {
      setError('registerError', '请输入有效的 QQ 邮箱地址，或留空。');
      return;
    }
    viewRevision += 1;
    setAuthBusy(true);
    const submittedForm = event.currentTarget;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const created = await api('/api/accounts/register', 'POST', body);
      const accountId = created.account.id;
      submittedForm.reset();
      const loginIdentifier = byId('loginForm').querySelector('[name="identifier"]');
      if (loginIdentifier) loginIdentifier.value = body.username;

      let signedIn;
      try {
        signedIn = await api('/api/accounts/login', 'POST', {
          identifier: body.username,
          password: body.password
        });
      } catch {
        // Registration has already committed. Do not send the user back to
        // the registration form, where retrying would create a duplicate.
        setError(
          'loginError',
          '账号已创建，MAO 永久 ID：' + accountId +
            '。自动登录暂未完成，请使用刚设置的用户名和密码重新登录。'
        );
        showPanel('loginPanel');
        return;
      }

      const account = signedIn.account || { id: accountId, status: 'pending_invite' };
      byId('pendingAccountId').textContent = account.id || accountId;
      presentAccount({ ...account, status: account.status || 'pending_invite' });
    } catch (error) {
      showAuthError(error, 'registerError');
    } finally {
      setAuthBusy(false);
      button.disabled = false;
    }
  });

  byId('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (authBusy) return;
    setError('loginError');
    const form = new FormData(event.currentTarget);
    if (!String(form.get('identifier') || '').trim() || !String(form.get('password') || '')) {
      setError('loginError', '请输入账号和密码。');
      return;
    }
    viewRevision += 1;
    setAuthBusy(true);
    const submittedForm = event.currentTarget;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/accounts/login', 'POST', {
        identifier: String(form.get('identifier') || '').trim(),
        password: String(form.get('password') || '')
      });
      submittedForm.querySelector('[name="password"]').value = '';
      presentAccount(result.account);
    } catch (error) {
      showAuthError(error, 'loginError');
    } finally {
      setAuthBusy(false);
      button.disabled = false;
    }
  });

  byId('inviteForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (authBusy) return;
    setError('inviteError');
    const form = new FormData(event.currentTarget);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(String(form.get('inviteCode') || '').trim())) {
      setError('inviteError', '请粘贴管理员发放的完整邀请码。');
      return;
    }
    viewRevision += 1;
    setAuthBusy(true);
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/accounts/invites/redeem', 'POST', {
        inviteCode: String(form.get('inviteCode') || '').trim()
      });
      presentAccount(result.account, { fromInvite: true });
    } catch (error) {
      showAuthError(error, 'inviteError');
    } finally {
      setAuthBusy(false);
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
      setError('inviteError', '复制未成功，请长按上方永久 ID 复制。');
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
      delegatedIdentity = status.identityMode === 'delegated';
      link.hidden = delegatedIdentity || status.bootstrapAllowed === false || Boolean(status.initialized);
      if (delegatedIdentity) {
        document.querySelectorAll('[data-show="registerPanel"]').forEach(button => { button.hidden = true; });
        const subtitle = byId('loginPanel')?.querySelector('.lead');
        if (subtitle) subtitle.textContent = status.qaIdentityCore === true
          ? 'QA 测试版：使用原管理员用户名或永久 ID，以及为 QA 单独设置的密码。不要输入正式版密码。'
          : '用你原来的 MAO 账号登录。管理员 001 不需要邀请码，也不需要重复注册。';
        delegatedSignInReady = status.signInReady === true;
        const unavailable = !delegatedSignInReady;
        const loginForm = byId('loginForm');
        if (loginForm) {
          loginForm.querySelectorAll('input, button[type="submit"]').forEach(node => {
            node.disabled = unavailable;
          });
        }
        if (unavailable) {
          setError('loginError', status.qaIdentityCore === true
            ? 'QA 独立身份服务尚未就绪。请先完成 QA 专用初始化，不要填写正式版密码或重复注册。'
            : '统一身份验证尚未接通。本测试版不会要求你重新注册，请暂时不要输入管理员密码。');
        }
      }
    } catch {
      link.hidden = true;
    }
  }

  (async function restoreSession() {
    const revision = viewRevision;
    const params = new URLSearchParams(window.location.search);
    await checkCreatorBootstrapEntry();
    if (params.get('disabled') === '1') {
      showPanel('blockedPanel');
      return;
    }
    try {
      const result = await api('/api/accounts/me');
      if (revision !== viewRevision) return;
      presentAccount(result.account);
    } catch (error) {
      if (revision !== viewRevision) return;
      if (error.code === 'ACCOUNT_DISABLED') showPanel('blockedPanel');
      else showPanel(delegatedIdentity || params.get('admin') === '1' ? 'loginPanel' : 'welcomePanel');
    }
  })();
})();

