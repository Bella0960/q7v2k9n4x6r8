(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let accounts = [];
  let invites = [];
  let selectedAccountId = '';
  let pendingAction = '';
  let generatedCode = '';
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
      const error = new Error(payload.error?.message || '请求未成功，请稍后再试');
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

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function showError(message) {
    let node = $('adminError');
    if (!node) {
      node = el('div', 'page-error', '');
      node.id = 'adminError';
      document.querySelector('.admin-intro').after(node);
    }
    node.textContent = message || '操作失败，请稍后再试。';
  }

  function hideError() {
    const node = $('adminError');
    if (node) node.remove();
  }

  function statusText(status) {
    return ({
      pending_invite: '待授权',
      active: '正常使用',
      disabled: '已被禁用',
      revoked: '已被禁用'
    })[status] || '未知状态';
  }

  function statusClass(status) {
    return ({
      pending_invite: 'status-pending',
      active: 'status-active',
      disabled: 'status-disabled',
      revoked: 'status-revoked'
    })[status] || '';
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    hideError();
    try {
      await action();
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') {
        window.location.replace('/account/index.html?disabled=1');
        return;
      }
      if (error.status === 401 || error.code === 'ADMIN_ONLY') {
        window.location.replace('../index.html');
        return;
      }
      showError(error.message || '操作失败，请稍后重试。');
    } finally {
      busy = false;
      document.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }

  function updateStats() {
    const totals = {
      total: accounts.length,
      pending: accounts.filter(item => item.status === 'pending_invite').length,
      active: accounts.filter(item => item.status === 'active').length,
      disabled: accounts.filter(item => item.status === 'disabled' || item.status === 'revoked').length
    };
    $('statTotal').textContent = String(totals.total);
    $('statPending').textContent = String(totals.pending);
    $('statActive').textContent = String(totals.active);
    $('statDisabled').textContent = String(totals.disabled);
  }

  function renderAccounts() {
    const list = $('accountsList');
    list.replaceChildren();
    const query = String($('accountSearch').value || '').trim().toLocaleLowerCase();
    const filtered = accounts.filter(account =>
      String(account.id || '').toLocaleLowerCase().includes(query) ||
      String(account.username || '').toLocaleLowerCase().includes(query)
    );

    if (!filtered.length) {
      list.appendChild(el('p', 'empty-note', query ? '没有找到匹配的账号。' : '暂无普通用户账号。'));
      return;
    }

    filtered.forEach(account => {
      const row = el('div', 'account-row', '');
      const avatar = el('div', 'row-avatar', 'M');
      const main = el('div', 'row-main', '');
      main.append(
        el('div', 'row-title', account.username || '未命名用户'),
        el('div', 'row-sub', account.id + ' · 创建于 ' + formatTime(account.created_at))
      );
      const status = el('div', 'row-status ' + statusClass(account.status), statusText(account.status));
      const button = el('button', 'open-detail', '详情');
      button.type = 'button';
      button.addEventListener('click', () => openAccount(account.id));
      row.append(avatar, main, status, button);
      list.appendChild(row);
    });
  }

  function renderInvites() {
    const list = $('invitesList');
    list.replaceChildren();
    if (!invites.length) {
      list.appendChild(el('p', 'empty-note', '还没有生成邀请码。请在待授权账号的详情中生成。'));
      return;
    }
    invites.forEach(invite => {
      const revoked = Boolean(invite.revoked_at);
      const expired = Number(invite.expires_at) <= Date.now();
      const used = Number(invite.used_count || 0) >= Number(invite.max_uses || 1);
      const state = revoked ? '已撤销' : (expired ? '已过期' : (used ? '已使用' : '待使用'));
      const row = el('div', 'invite-row', '');
      const icon = el('div', 'row-avatar', '⌁');
      const main = el('div', 'row-main', '');
      const target = invite.target_account_id || invite.target_email || '未指定';
      main.append(
        el('div', 'row-title', target),
        el('div', 'row-sub', (invite.target_username ? invite.target_username + ' · ' : '') +
          '生成于 ' + formatTime(invite.created_at) + ' · 到期 ' + formatTime(invite.expires_at)),
        el('div', 'row-sub', '使用次数 ' + Number(invite.used_count || 0) + '/' + Number(invite.max_uses || 1))
      );
      const meta = el('div', 'row-status ' + (revoked || expired ? 'status-revoked' : (used ? 'status-active' : 'status-pending')), state);
      row.append(icon, main, meta);
      if (!revoked && !expired && !used) {
        const button = el('button', 'open-detail', '撤销');
        button.type = 'button';
        button.addEventListener('click', () => run(async () => {
          if (!window.confirm('确定撤销这个尚未使用的邀请码？')) return;
          await api('/api/admin/invites/' + encodeURIComponent(invite.id) + '/revoke', 'POST', {});
          await refreshAll();
        }));
        row.appendChild(button);
      }
      list.appendChild(row);
    });
  }

  async function refreshAll() {
    const [accountResult, inviteResult] = await Promise.all([
      api('/api/admin/accounts'),
      api('/api/admin/invites')
    ]);
    accounts = Array.isArray(accountResult.accounts) ? accountResult.accounts : [];
    invites = Array.isArray(inviteResult.invites) ? inviteResult.invites : [];
    updateStats();
    renderAccounts();
    renderInvites();
    if (selectedAccountId && !$('accountDetail').hidden) {
      const account = accounts.find(item => item.id === selectedAccountId);
      if (account) await renderAccountDetail(account);
      else closeDetail();
    }
  }

  async function openAccount(accountId) {
    selectedAccountId = accountId;
    $('accountDetail').hidden = false;
    $('detailUsername').textContent = '正在读取…';
    $('detailActions').replaceChildren();
    $('auditList').replaceChildren(el('p', 'empty-note', '正在读取管理记录…'));
    const account = accounts.find(item => item.id === accountId);
    if (account) await renderAccountDetail(account);
    $('accountDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function createActionButton(label, className, action, requiresReason = false) {
    const button = el('button', 'action-button ' + (className || ''), label);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (requiresReason) {
        pendingAction = action;
        $('actionReason').value = '';
        $('reasonField').hidden = false;
        $('actionReason').focus();
      } else {
        run(async () => {
          if (!window.confirm('确定执行“' + label + '”吗？')) return;
          await api('/api/admin/accounts/' + encodeURIComponent(selectedAccountId) + '/action', 'POST', { action, reason: '' });
          await refreshAll();
        });
      }
    });
    $('detailActions').appendChild(button);
  }

  async function renderAccountDetail(account) {
    $('detailUsername').textContent = account.username || '账号详情';
    $('detailId').textContent = account.id;
    $('detailMeta').replaceChildren(
      el('span', '', '状态：' + statusText(account.status)),
      el('span', '', '创建：' + formatTime(account.created_at)),
      el('span', '', '授权：' + formatTime(account.authorized_at))
    );
    const actions = $('detailActions');
    actions.replaceChildren();
    $('reasonField').hidden = true;
    pendingAction = '';

    if (account.status === 'pending_invite') {
      createActionButton('生成专属邀请码', 'primary', 'invite', false);
      $('detailActions').lastElementChild.addEventListener('click', () => run(async () => {
        const result = await api('/api/admin/invites', 'POST', { targetAccountId: account.id });
        generatedCode = result.invite.code;
        $('generatedCode').textContent = generatedCode;
        $('inviteCodeSheet').hidden = false;
        await refreshAll();
      }));
    } else if (account.status === 'active') {
      createActionButton('停用账号', 'danger', 'disable', true);
    } else if (account.status === 'disabled') {
      createActionButton('恢复授权', 'primary', 'restore', true);
      createActionButton('永久撤销', 'danger', 'revoke', true);
    } else if (account.status === 'revoked') {
      actions.appendChild(el('p', 'empty-note', '该账号已永久撤销，不能恢复。'));
    }

    await loadAudit(account.id);
  }

  async function loadAudit(accountId) {
    const list = $('auditList');
    list.replaceChildren(el('p', 'empty-note', '正在读取管理记录…'));
    try {
      const result = await api('/api/admin/accounts/' + encodeURIComponent(accountId) + '/audit');
      list.replaceChildren();
      const records = Array.isArray(result.records) ? result.records : [];
      if (!records.length) {
        list.appendChild(el('p', 'empty-note', '暂无管理操作记录。'));
        return;
      }
      records.forEach(record => {
        const item = el('div', 'audit-entry', '');
        const actionLabel = ({
          disable: '停用账号',
          restore: '恢复授权',
          revoke: '永久撤销'
        })[record.action] || record.action;
        item.append(
          el('div', 'audit-title', actionLabel),
          el('div', 'audit-sub', formatTime(record.createdAt) + ' · 管理员 ' + record.actorAccountId),
          el('div', 'audit-reason', record.reason ? '备注：' + record.reason : '未填写备注')
        );
        list.appendChild(item);
      });
    } catch (error) {
      list.replaceChildren(el('p', 'empty-note', error.message || '管理记录暂时无法读取。'));
    }
  }

  function closeDetail() {
    selectedAccountId = '';
    $('accountDetail').hidden = true;
    $('reasonField').hidden = true;
  }

  $('confirmAction').addEventListener('click', () => {
    if (!pendingAction || !selectedAccountId) return;
    const action = pendingAction;
    const reason = String($('actionReason').value || '').trim();
    const confirmText = action === 'revoke' ? '永久撤销后不能恢复。确定继续吗？' :
      (action === 'disable' ? '停用后该账号的所有登录设备都会失效。确定继续吗？' : '确定恢复这个账号的使用资格吗？');
    run(async () => {
      if (!window.confirm(confirmText)) return;
      await api('/api/admin/accounts/' + encodeURIComponent(selectedAccountId) + '/action', 'POST', { action, reason });
      $('reasonField').hidden = true;
      pendingAction = '';
      await refreshAll();
    });
  });

  $('cancelAction').addEventListener('click', () => {
    pendingAction = '';
    $('reasonField').hidden = true;
  });

  $('closeDetail').addEventListener('click', closeDetail);
  $('refreshUsers').addEventListener('click', () => run(refreshAll));
  $('refreshInvites').addEventListener('click', () => run(refreshAll));
  $('accountSearch').addEventListener('input', renderAccounts);

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
      $('usersView').hidden = button.dataset.tab !== 'users';
      $('invitesView').hidden = button.dataset.tab !== 'invites';
      closeDetail();
    });
  });

  $('closeCodeSheet').addEventListener('click', () => {
    generatedCode = '';
    $('generatedCode').textContent = '';
    $('inviteCodeSheet').hidden = true;
  });
  $('copyInviteCode').addEventListener('click', async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      $('copyInviteCode').textContent = '已复制';
    } catch {
      $('copyInviteCode').textContent = '请手动复制上方邀请码';
    }
  });

  async function init() {
    try {
      const me = await api('/api/accounts/me');
      if (me.account?.role !== 'super_admin' || me.account?.status !== 'active') {
        return window.location.replace('../index.html');
      }
      await refreshAll();
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') {
        window.location.replace('/account/index.html?disabled=1');
        return;
      }
      window.location.replace('../index.html');
    }
  }

  init();
})();
