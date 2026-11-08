(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let currentAccount = null;
  let currentSessionId = '';
  let busy = false;

  async function api(path, method = 'GET', body = null) {
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

  function formatTime(value) {
    const stamp = Number(value);
    if (!Number.isFinite(stamp) || stamp <= 0) return '时间未知';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(stamp));
    } catch {
      return new Date(stamp).toLocaleString();
    }
  }

  function textElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value == null ? '' : value);
    return node;
  }

  function showError(message) {
    let node = $('pageError');
    if (!node) {
      node = textElement('p', 'page-error', '');
      node.id = 'pageError';
      document.querySelector('.manage-shell').prepend(node);
    }
    node.textContent = message;
  }

  function showDisabled() {
    window.location.replace('/account/index.html?disabled=1');
  }

  function addItem(container, kind, title, detail, actionText, onAction, current = false) {
    const row = textElement('div', kind === 'device' ? 'device-item' : 'session-item', '');
    const icon = textElement('div', 'item-icon', kind === 'device' ? '▣' : '◷');
    icon.setAttribute('aria-hidden', 'true');
    const main = textElement('div', 'item-main', '');
    main.appendChild(textElement('div', 'item-title', title));
    main.appendChild(textElement('div', 'item-sub', detail));
    row.append(icon, main);
    if (current) {
      row.appendChild(textElement('span', 'current-label', '当前会话'));
    } else if (actionText && typeof onAction === 'function') {
      const button = textElement('button', 'item-action danger', actionText);
      button.type = 'button';
      button.addEventListener('click', onAction);
      row.appendChild(button);
    }
    container.appendChild(row);
  }

  function renderDevices(devices) {
    const list = $('devicesList');
    list.replaceChildren();
    const active = devices.filter(item => !item.revokedAt);
    if (!active.length) {
      list.appendChild(textElement('p', 'empty-note', '暂无已授权设备。登录后可在这里管理设备。'));
    }
    devices.forEach(device => {
      const label = device.label || device.platform || 'MAO 设备';
      const detail = (device.platform || '设备') + ' · 最近活动 ' + formatTime(device.lastSeenAt);
      if (device.revokedAt) {
        const row = textElement('div', 'device-item', '');
        row.append(textElement('div', 'item-icon', '▣'));
        const main = textElement('div', 'item-main', '');
        main.append(textElement('div', 'item-title', label), textElement('div', 'item-sub', detail));
        main.appendChild(textElement('div', 'item-state', '已撤销'));
        row.appendChild(main);
        list.appendChild(row);
        return;
      }
      addItem(list, 'device', label, detail, '移除此设备', async () => {
        if (!window.confirm('移除此设备后，它将无法再访问 MAO，需要重新登录和绑定。确定继续？')) return;
        await runAction(async () => {
          await api('/api/accounts/devices/' + encodeURIComponent(device.id) + '/revoke', 'POST', {});
          await refreshSecurity();
        });
      });
    });
  }

  function renderSessions(sessions) {
    const list = $('sessionsList');
    list.replaceChildren();
    if (!sessions.length) {
      list.appendChild(textElement('p', 'empty-note', '暂无登录会话记录。'));
      return;
    }
    sessions.forEach(session => {
      const detail = '最近使用 ' + formatTime(session.lastUsedAt) + ' · 到期 ' + formatTime(session.expiresAt);
      if (session.revokedAt) {
        const row = textElement('div', 'session-item', '');
        row.append(textElement('div', 'item-icon', '◷'));
        const main = textElement('div', 'item-main', '');
        main.append(textElement('div', 'item-title', '已退出的登录会话'), textElement('div', 'item-sub', detail));
        row.appendChild(main);
        list.appendChild(row);
        return;
      }
      addItem(list, 'session', '登录会话', detail, '退出此会话', async () => {
        if (!window.confirm('确定退出这个登录会话？')) return;
        await runAction(async () => {
          const result = await api('/api/accounts/sessions/' + encodeURIComponent(session.id) + '/revoke', 'POST', {});
          if (result.current) {
            window.location.replace('/account/index.html');
            return;
          }
          await refreshSecurity();
        });
      }, session.current);
    });
  }

  async function refreshSecurity() {
    const result = await api('/api/accounts/security');
    currentSessionId = result.currentSessionId || '';
    renderDevices(Array.isArray(result.devices) ? result.devices : []);
    renderSessions(Array.isArray(result.sessions) ? result.sessions : []);
  }

  async function runAction(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await action();
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') return showDisabled();
      showError(error.message || '操作失败，请稍后重试');
    } finally {
      busy = false;
      document.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }

  async function init() {
    try {
      const [me, security] = await Promise.all([
        api('/api/accounts/me'),
        api('/api/accounts/security')
      ]);
      currentAccount = me.account;
      currentSessionId = security.currentSessionId || '';
      if (!currentAccount || currentAccount.status !== 'active') {
        if (currentAccount?.status === 'disabled' || currentAccount?.status === 'revoked') return showDisabled();
        return window.location.replace('/account/index.html');
      }
      $('accountId').textContent = currentAccount.id;
      $('profileId').textContent = currentAccount.id;
      $('accountUsername').textContent = currentAccount.username;
      $('profileUsername').textContent = currentAccount.username;
      $('profileEmail').textContent = currentAccount.qqEmail
        ? currentAccount.qqEmail + (currentAccount.qqEmailVerified ? ' · 已验证' : ' · 未验证')
        : '未绑定';
      $('accountStatus').textContent = '已授权';
      renderDevices(security.devices || []);
      renderSessions(security.sessions || []);
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') return showDisabled();
      if (error.status === 401) return window.location.replace('/account/index.html');
      showError(error.message || '暂时无法读取账号信息，请检查网络后重试。');
    }
  }

  $('copyId').addEventListener('click', async () => {
    if (!currentAccount?.id) return;
    try {
      await navigator.clipboard.writeText(currentAccount.id);
      $('copyId').textContent = '已复制';
    } catch {
      $('copyId').textContent = currentAccount.id;
    }
  });

  $('passwordForm').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      currentPassword: String(form.get('currentPassword') || ''),
      newPassword: String(form.get('newPassword') || ''),
      confirmPassword: String(form.get('confirmPassword') || '')
    };
    $('passwordMessage').textContent = '';
    $('passwordMessage').className = 'inline-message';
    runAction(async () => {
      const result = await api('/api/accounts/password/change', 'POST', body);
      event.currentTarget.reset();
      $('passwordMessage').textContent = result.changed ? '密码已更新，其他登录会话已退出。' : '密码没有修改。';
      await refreshSecurity();
    }).catch(error => {
      $('passwordMessage').textContent = error.message || '密码修改失败。';
      $('passwordMessage').className = 'inline-message error';
    });
  });

  $('logoutButton').addEventListener('click', () => {
    runAction(async () => {
      await api('/api/accounts/logout', 'POST', {});
      window.location.replace('/account/index.html');
    });
  });

  init();
})();
