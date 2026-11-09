(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let accounts = [];
  let invites = [];
  let accountNextCursor = '';
  let inviteNextCursor = '';
  let accountHasMore = false;
  let inviteHasMore = false;
  let accountTotalCount = 0;
  let inviteTotalCount = 0;
  let accountSummary = null;
  let inviteSummary = null;
  let accountSearchTimer = 0;
  let inviteSearchTimer = 0;
  let accountDirectoryKey = '';
  let inviteDirectoryKey = '';
  let accountFilter = 'all';
  let inviteFilter = 'all';
  let selectedAccountId = '';
  let auditNextCursor = '';
  let auditHasMore = false;
  let auditTotalCount = 0;
  let auditLoadedCount = 0;
  let auditRequestSequence = 0;
  let accountSearchRefreshPending = false;
  let inviteSearchRefreshPending = false;
  let pendingAction = '';
  let generatedCode = '';
  let busy = false;
  let initializing = false;
  const busyButtonState = new WeakMap();

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

  function showError(message, retry) {
    let node = $('adminError');
    if (!node) {
      node = el('div', 'page-error', '');
      node.id = 'adminError';
      document.querySelector('.admin-intro').after(node);
    }
    node.replaceChildren(el('span', '', message || '操作失败，请稍后再试。'));
    if (typeof retry === 'function') {
      const retryButton = el('button', 'error-retry', '重新检查');
      retryButton.type = 'button';
      retryButton.addEventListener('click', async () => {
        if (retryButton.disabled) return;
        retryButton.disabled = true;
        try {
          await retry();
        } finally {
          if (retryButton.isConnected) retryButton.disabled = false;
        }
      });
      node.appendChild(retryButton);
    }
    if (busy) setButtonsDisabled(true);
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

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('button').forEach(button => {
      if (disabled) {
        if (!busyButtonState.has(button)) busyButtonState.set(button, button.disabled);
        button.disabled = true;
      } else if (busyButtonState.has(button)) {
        button.disabled = busyButtonState.get(button);
        busyButtonState.delete(button);
      }
    });
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    setButtonsDisabled(true);
    hideError();
    try {
      await action();
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') {
        window.location.replace('/account/index.html?disabled=1');
        return;
      }
      if (error.status === 401 || error.status === 403 || error.code === 'ADMIN_ONLY') {
        window.location.replace('../index.html');
        return;
      }
      showError(error.message || '操作失败，请稍后重试。');
    } finally {
      busy = false;
      setButtonsDisabled(false);
      const reloadAccounts = accountSearchRefreshPending;
      const reloadInvites = inviteSearchRefreshPending;
      accountSearchRefreshPending = false;
      inviteSearchRefreshPending = false;
      if (reloadAccounts || reloadInvites) {
        window.setTimeout(() => run(async () => {
          await Promise.all([
            reloadAccounts ? loadAccountPage(true) : Promise.resolve(),
            reloadInvites ? loadInvitePage(true) : Promise.resolve()
          ]);
        }), 0);
      }
    }
  }

  function updateStats() {
    const totals = accountSummary || {
      total: accounts.length,
      pending: 0,
      active: 0,
      restricted: 0
    };
    $('statTotal').textContent = String(totals.total);
    $('statPending').textContent = String(totals.pending);
    $('statActive').textContent = String(totals.active);
    $('statDisabled').textContent = String(totals.restricted);
  }

  function updateAccountFilterCounts() {
    const counts = accountSummary || {
      total: accounts.length, pending: 0, active: 0, restricted: 0
    };
    $('filterCountAll').textContent = String(counts.total);
    $('filterCountPending').textContent = String(counts.pending);
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
    $('accountResultCount').textContent = '已加载 ' + accounts.length + ' / ' + accountTotalCount +
      ' 个账号，本页显示 ' + filtered.length + ' 个';
    $('accountLimitNotice').hidden = !accountHasMore;
    $('accountLimitNotice').textContent = '还有更多账号记录，继续向下加载即可查看；搜索和状态筛选会覆盖全部账号。';
    $('loadMoreAccounts').hidden = !accountHasMore;

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
    if (busy) setButtonsDisabled(true);
  }

  function inviteState(invite, timestamp = Date.now()) {
    if (invite.revoked_at) return 'revoked';
    const usedCount = Number(invite.used_count || 0);
    const maxUses = Number(invite.max_uses || 1);
    if (Number.isFinite(usedCount) && Number.isFinite(maxUses) &&
        maxUses > 0 && usedCount >= maxUses) return 'used';
    const expiresAt = Number(invite.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= timestamp) return 'expired';
    return 'pending';
  }

  function updateInviteFilterCounts() {
    const counts = inviteSummary || {
      total: invites.length, pending: 0, used: 0, expired: 0, revoked: 0
    };
    $('inviteCountAll').textContent = String(counts.total);
    $('inviteCountPending').textContent = String(counts.pending);
    $('inviteCountUsed').textContent = String(counts.used);
    $('inviteCountExpired').textContent = String(counts.expired);
    $('inviteCountRevoked').textContent = String(counts.revoked);
  }

  function renderInvites() {
    const list = $('invitesList');
    list.replaceChildren();
    const query = String($('inviteSearch').value || '').trim().toLocaleLowerCase();
    const searched = invites.filter(invite =>
      [invite.id, invite.target_account_id, invite.target_email, invite.target_username]
        .some(value => String(value || '').toLocaleLowerCase().includes(query))
    );
    const filtered = searched.filter(invite => inviteFilter === 'all' || inviteState(invite) === inviteFilter);
    $('inviteResultCount').textContent = '已加载 ' + invites.length + ' / ' + inviteTotalCount +
      ' 条邀请码，本页显示 ' + filtered.length + ' 条';
    $('inviteLimitNotice').hidden = !inviteHasMore;
    $('inviteLimitNotice').textContent = '还有更早的邀请码记录，继续向下加载即可查看；搜索和状态筛选会覆盖全部记录。';
    $('loadMoreInvites').hidden = !inviteHasMore;

    if (!filtered.length) {
      list.appendChild(el(
        'p',
        'empty-note',
        invites.length ? '没有找到符合条件的邀请码。' : '还没有生成邀请码。请在待授权账号的详情中生成。'
      ));
      return;
    }

    filtered.forEach(invite => {
      const state = inviteState(invite);
      const stateLabels = {
        revoked: '已撤销',
        expired: '已过期',
        used: '已使用',
        pending: '待使用'
      };
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
      const stateClass = state === 'pending' ? 'status-pending' : (state === 'used' ? 'status-active' : 'status-revoked');
      const meta = el('div', 'row-status ' + stateClass, stateLabels[state]);
      row.append(icon, main, meta);
      if (invite.target_account_id) {
        const detailButton = el('button', 'open-detail', '查看账号');
        detailButton.type = 'button';
        detailButton.addEventListener('click', () => openAccountFromInvite(invite.target_account_id));
        row.appendChild(detailButton);
      }
      if (state === 'pending') {
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
    if (busy) setButtonsDisabled(true);
  }

  function directoryPath(path, search, status, cursor) {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (search) params.set('search', search);
    if (status && status !== 'all') params.set('status', status);
    if (cursor) params.set('cursor', cursor);
    return path + '?' + params.toString();
  }

  async function loadAccountPage(reset = false) {
    const search = $('accountSearch').value.trim();
    const key = JSON.stringify([search, accountFilter]);
    const restart = reset || key !== accountDirectoryKey;
    const cursor = restart ? '' : accountNextCursor;
    const result = await api(directoryPath(
      '/api/admin/accounts',
      search,
      accountFilter,
      cursor
    ));
    const next = Array.isArray(result.accounts) ? result.accounts : [];
    accountDirectoryKey = key;
    accounts = restart ? next : accounts.concat(next);
    accountNextCursor = result.page?.nextCursor || '';
    accountHasMore = Boolean(result.page?.hasMore);
    accountTotalCount = Number(result.page?.totalCount || 0);
    accountSummary = result.summary || accountSummary;
    updateStats();
    updateAccountFilterCounts();
    renderAccounts();
  }

  async function loadInvitePage(reset = false) {
    const search = $('inviteSearch').value.trim();
    const key = JSON.stringify([search, inviteFilter]);
    const restart = reset || key !== inviteDirectoryKey;
    const cursor = restart ? '' : inviteNextCursor;
    const result = await api(directoryPath(
      '/api/admin/invites',
      search,
      inviteFilter,
      cursor
    ));
    const next = Array.isArray(result.invites) ? result.invites : [];
    inviteDirectoryKey = key;
    invites = restart ? next : invites.concat(next);
    inviteNextCursor = result.page?.nextCursor || '';
    inviteHasMore = Boolean(result.page?.hasMore);
    inviteTotalCount = Number(result.page?.totalCount || 0);
    inviteSummary = result.summary || inviteSummary;
    updateInviteFilterCounts();
    renderInvites();
  }

  async function refreshAll() {
    await Promise.all([loadAccountPage(true), loadInvitePage(true)]);
    if (selectedAccountId && !$('accountDetail').hidden) {
      const account = accounts.find(item => item.id === selectedAccountId);
      if (account) await renderAccountDetail(account);
      else closeDetail();
    }
    if (busy) setButtonsDisabled(true);
  }

  async function openAccount(accountId) {
    selectedAccountId = accountId;
    $('accountDetail').hidden = false;
    $('detailUsername').textContent = '正在读取…';
    $('detailId').textContent = accountId;
    $('copyDetailId').textContent = '复制 ID';
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
          $('inviteCodeSheet').scrollIntoView({ behavior: 'smooth', block: 'center' });
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

    if (busy) setButtonsDisabled(true);
    await loadAudit(account.id);
  }

  async function loadAudit(accountId, reset = true) {
    const requestSequence = ++auditRequestSequence;
    const list = $('auditList');
    if (reset) {
      auditNextCursor = '';
      auditHasMore = false;
      auditTotalCount = 0;
      auditLoadedCount = 0;
      list.replaceChildren(el('p', 'empty-note', '正在读取管理记录…'));
      $('auditResultCount').textContent = '正在读取…';
      $('loadMoreAudit').hidden = true;
    }
    const cursor = reset ? '' : auditNextCursor;
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (cursor) params.set('cursor', cursor);
    try {
      const result = await api(
        '/api/admin/accounts/' + encodeURIComponent(accountId) + '/audit?' + params.toString()
      );
      if (selectedAccountId !== accountId || requestSequence !== auditRequestSequence) return;
      const records = Array.isArray(result.records) ? result.records : [];
      if (reset) list.replaceChildren();
      if (!records.length && reset) {
        list.appendChild(el('p', 'empty-note', '暂无管理操作记录。'));
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
      auditLoadedCount = (reset ? 0 : auditLoadedCount) + records.length;
      auditTotalCount = Number(result.page?.totalCount || 0);
      auditHasMore = Boolean(result.page?.hasMore);
      auditNextCursor = result.page?.nextCursor || '';
      $('auditResultCount').textContent = '已加载 ' + auditLoadedCount + ' / ' + auditTotalCount + ' 条管理记录';
      $('loadMoreAudit').hidden = !auditHasMore;
    } catch (error) {
      if (selectedAccountId !== accountId || requestSequence !== auditRequestSequence) return;
      if (error.code === 'ACCOUNT_DISABLED') {
        window.location.replace('/account/index.html?disabled=1');
        return;
      }
      if (error.status === 401 || error.status === 403 || error.code === 'ADMIN_ONLY') {
        window.location.replace('../index.html');
        return;
      }
      const message = el('p', 'empty-note', error.message || '管理记录暂时无法读取。');
      const retryButton = el('button', 'audit-retry', '重试读取');
      retryButton.type = 'button';
      retryButton.addEventListener('click', () => loadAudit(accountId, reset));
      if (reset) list.replaceChildren(message, retryButton);
      else list.append(message, retryButton);
    }
  }

  function closeDetail() {
    selectedAccountId = '';
    auditRequestSequence += 1;
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

  $('copyDetailId').addEventListener('click', async () => {
    const value = String($('detailId').textContent || '').trim();
    if (!value || value === '—') return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      $('copyDetailId').textContent = '已复制';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('detailId'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      $('copyDetailId').textContent = '已选中 ID';
    }
  });

  $('closeDetail').addEventListener('click', closeDetail);
  $('refreshUsers').addEventListener('click', () => run(refreshAll));
  $('refreshInvites').addEventListener('click', () => run(refreshAll));
  $('loadMoreAccounts').addEventListener('click', () => run(() => loadAccountPage(false)));
  $('loadMoreInvites').addEventListener('click', () => run(() => loadInvitePage(false)));
  $('loadMoreAudit').addEventListener('click', () => {
    if (selectedAccountId) run(() => loadAudit(selectedAccountId, false));
  });
  $('accountSearch').addEventListener('input', () => {
    window.clearTimeout(accountSearchTimer);
    accountSearchTimer = window.setTimeout(() => {
      if (busy) {
        accountSearchRefreshPending = true;
        return;
      }
      run(() => loadAccountPage(true));
    }, 250);
  });
  $('inviteSearch').addEventListener('input', () => {
    window.clearTimeout(inviteSearchTimer);
    inviteSearchTimer = window.setTimeout(() => {
      if (busy) {
        inviteSearchRefreshPending = true;
        return;
      }
      run(() => loadInvitePage(true));
    }, 250);
  });
  document.querySelectorAll('[data-account-filter]').forEach(button => {
    button.addEventListener('click', () => {
      accountFilter = button.dataset.accountFilter || 'all';
      document.querySelectorAll('[data-account-filter]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      run(() => loadAccountPage(true));
    });
  });
  document.querySelectorAll('[data-invite-filter]').forEach(button => {
    button.addEventListener('click', () => {
      inviteFilter = button.dataset.inviteFilter || 'all';
      document.querySelectorAll('[data-invite-filter]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      run(() => loadInvitePage(true));
    });
  });

  function activateTab(name) {
    const selected = name === 'invites' ? 'invites' : 'users';
    document.querySelectorAll('[data-tab]').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === selected);
    });
    $('usersView').hidden = selected !== 'users';
    $('invitesView').hidden = selected !== 'invites';
    closeDetail();
  }

  function openAccountFromInvite(accountId) {
    activateTab('users');
    accountFilter = 'all';
    // Search by permanent ID on the server so older accounts outside the
    // currently loaded pages can still be opened from their invitation record.
    $('accountSearch').value = accountId;
    document.querySelectorAll('[data-account-filter]').forEach(item => {
      const active = item.dataset.accountFilter === 'all';
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    run(async () => {
      await loadAccountPage(true);
      openAccount(accountId);
    });
  }

  document.querySelectorAll('[data-tab]').forEach(button => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
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
    if (initializing) return;
    initializing = true;
    try {
      const me = await api('/api/accounts/me');
      if (!me.account || me.account.role !== 'super_admin' || me.account.status !== 'active') {
        window.location.replace('../index.html');
        return;
      }
      await refreshAll();
      hideError();
    } catch (error) {
      if (error.code === 'ACCOUNT_DISABLED') {
        window.location.replace('/account/index.html?disabled=1');
        return;
      }
      if (error.status === 401 || error.status === 403 || error.code === 'ADMIN_ONLY') {
        window.location.replace('../index.html');
        return;
      }
      $('accountsList').replaceChildren(el('p', 'empty-note', '账号数据暂未加载，请重新检查。'));
      $('invitesList').replaceChildren(el('p', 'empty-note', '邀请码数据暂未加载，请重新检查。'));
      showError(
        error.message || '暂时无法连接服务器，管理员身份尚未重新验证。管理数据尚未加载，请重试。',
        () => init()
      );
    } finally {
      initializing = false;
    }
  }

  init();
})();
