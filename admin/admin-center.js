(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let accounts = [];
  let invites = [];
  let accountFilter = 'all';
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
      disabled: '临时停用',
      revoked: '永久撤销'
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

  function updateAccountFilterCounts() {
    const counts = {
      all: accounts.length,
      pending_invite: accounts.filter(account => account.status === 'pending_invite').length,
      active: accounts.filter(account => account.status === 'active').length,
      restricted: accounts.filter(account => account.status === 'disabled' || account.status === 'revoked').length
    };
    $('filterCountAll').textContent = String(counts.all);
    $('filterCountPending').textContent = String(counts.pending_invite);
    $('filterCountActive').textContent = String(counts.active);
    $('filterCountRestricted').textContent = String(counts.restricted);
  }

  function renderAccounts() {
    const list = $('accountsList');
    list.replaceChildren();
    const query = String($('accountSearch').value || '').trim().toLocaleLowerCase();
    const searched = accounts.filter(account =>
      [account.id, account.username, account.qq_email]
        .some(value => String(value || '').toLocaleLowerCase().includes(query))
    );
    const filtered = searched.filter(account => {
      if (accountFilter === 'restricted') return account.status === 'disabled' || account.status === 'revoked';
      return accountFilter === 'all' || account.status === accountFilter;
    });
    $('accountResultCount').textContent = query || accountFilter !== 'all'
      ? '当前显示 ' + filtered.length + ' / ' + accounts.length + ' 个账号'
      : '共 ' + accounts.length + ' 个普通账号';

    if (!filtered.length) {
      list.appendChild(el(
        'p',
        'empty-note',
        accounts.length ? '没有找到符合条件的账号。' : '暂无普通用户账号。'
      ));
      return;
    }

    filtered.forEach(account => {
      const row = el('div', 'account-row', '');
      const avatar = el('div', 'row-avatar', 'M');
      const main = el('div', 'row-main', '');
      const subline = account.id + ' · 创建于 ' + formatTime(account.created_at);
      main.append(
        el('div', 'row-title', account.username || '未命名用户'),
        el('div', 'row-sub', subline)
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
    updateAccountFilterCounts();
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

  function findActiveInviteForAccount(accountId) {
    const timestamp = Date.now();
    return invites.find(invite =>
      invite.target_account_id === accountId &&
      !invite.revoked_at &&
      Number(invite.expires_at) > timestamp &&
      Number(invite.used_count || 0) < Number(invite.max_uses || 1)
    ) || null;
  }

  async function renderAccountDetail(account) {
    $('detailUsername').textContent = account.username || '账号详情';
    $('detailId').textContent = account.id;
    const meta = [
      el('span', '', '状态：' + statusText(account.status)),
      el('span', '', '创建：' + formatTime(account.created_at)),
      el('span', '', '授权：' + formatTime(account.authorized_at))
    ];
    if (account.qq_email) {
      meta.push(el(
        'span',
        '',
        'QQ 邮箱：' + account.qq_email +
          (account.qq_email_verified_at ? '（已验证）' : '（未验证）')
      ));
    }
    $('detailMeta').replaceChildren(...meta);

    const inviteStatus = $('accountInviteStatus');
    inviteStatus.hidden = true;
    inviteStatus.replaceChildren();

    const actions = $('detailActions');
    actions.replaceChildren();
    $('reasonField').hidden = true;
    pendingAction = '';

    if (account.status === 'pending_invite') {
      const activeInvite = findActiveInviteForAccount(account.id);
      if (activeInvite) {
        inviteStatus.hidden = false;
        inviteStatus.append(
          el('strong', 'invite-status-title', '已有有效的专属邀请码'),
          el('span', 'invite-status-meta',
            '到期时间：' + formatTime(activeInvite.expires_at) +
            ' · 使用次数：' + Number(activeInvite.used_count || 0) + '/' + Number(activeInvite.max_uses || 1)),
          el('span', 'invite-status-note',
            '原始邀请码只在生成时展示一次。若用户遗失，需要先撤销当前邀请码，再生成新的。')
        );
        const revokeButton = el('button', 'invite-revoke-button', '撤销当前邀请码');
        revokeButton.type = 'button';
        revokeButton.addEventListener('click', () => run(async () => {
          if (!window.confirm('撤销后，当前邀请码将立即失效。确定继续吗？')) return;
          await api('/api/admin/invites/' + encodeURIComponent(activeInvite.id) + '/revoke', 'POST', {});
          await refreshAll();
        }));
        inviteStatus.appendChild(revokeButton);
      } else {
        const inviteButton = el('button', 'action-button primary', '生成专属邀请码');
        inviteButton.type = 'button';
        inviteButton.addEventListener('click', () => run(async () => {
          if (!window.confirm('将为 ' + account.id + ' 生成一个一次性专属邀请码。继续吗？')) return;
          const result = await api('/api/admin/invites', 'POST', { targetAccountId: account.id });
          generatedCode = result.invite.code;
          $('generatedCode').textContent = generatedCode;
          $('copyInviteCode').textContent = '复制邀请码';
          $('inviteCodeSheet').hidden = false;
          await refreshAll();
        }));
        actions.appendChild(inviteButton);
      }
      createActionButton('停用账号', 'danger', 'disable', true);
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
  document.querySelectorAll('[data-account-filter]').forEach(button => {
    button.addEventListener('click', () => {
      accountFilter = button.dataset.accountFilter || 'all';
      document.querySelectorAll('[data-account-filter]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderAccounts();
    });
  });

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
