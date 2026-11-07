(function (root) {
  'use strict';

  var client = root.PhoneRealUserAccountClient;
  var stage = document.getElementById('contactStage');
  if (!client || !stage || document.getElementById('realUserAccountPanel')) return;

  var panel = document.createElement('details');
  panel.id = 'realUserAccountPanel';
  panel.className = 'ru-account-panel';
  panel.innerHTML =
    '<summary>' +
      '<span class="ru-summary-title">真人账号与好友</span>' +
      '<span class="ru-summary-status" id="ruSummaryStatus">检查服务器</span>' +
    '</summary>' +
    '<div class="ru-account-body">' +
      '<p class="ru-status" id="ruStatus" role="status" aria-live="polite">正在检查真人账号服务…</p>' +
      '<div id="ruAuthArea" hidden>' +
        '<div class="ru-auth-tabs">' +
          '<button type="button" data-ru-mode="login" class="active">登录</button>' +
          '<button type="button" data-ru-mode="register">注册</button>' +
        '</div>' +
        '<form id="ruAuthForm" class="ru-auth-form">' +
          '<label id="ruDisplayNameWrap" hidden>昵称<input id="ruDisplayName" name="displayName" maxlength="48" autocomplete="nickname" placeholder="用于好友识别"></label>' +
          '<label>账号<input id="ruHandle" name="handle" maxlength="24" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="3–24 位英文、数字或下划线" required></label>' +
          '<label>密码<input id="ruPassword" name="password" type="password" maxlength="256" autocomplete="current-password" placeholder="至少 12 个 UTF-8 字节" required></label>' +
          '<button class="ru-primary" id="ruAuthSubmit" type="submit">登录</button>' +
        '</form>' +
        '<p class="ru-footnote">密码只在本次请求中发送，不会保存到本机。账号恢复功能尚未开通，请妥善保管登录信息。</p>' +
      '</div>' +
      '<div id="ruSessionArea" hidden>' +
        '<div class="ru-account-row">' +
          '<div class="ru-account-identity">' +
            '<div class="ru-avatar-wrap ru-avatar-wrap-large"><img id="ruOwnAvatar" class="ru-avatar-image" alt="账号头像" hidden><span id="ruOwnAvatarFallback" class="ru-avatar-fallback">M</span></div>' +
            '<div><div class="ru-account-name" id="ruAccountName"></div><div class="ru-account-handle" id="ruAccountHandle"></div><button type="button" class="ru-plain-button" id="ruEditName">修改昵称</button></div>' +
          '</div>' +
          '<button type="button" class="ru-plain-button" id="ruLogout">退出</button>' +
        '</div>' +
        '<div id="ruAvatarControls" class="ru-avatar-controls" hidden>' +
          '<input id="ruAvatarFile" type="file" accept="image/jpeg,image/png,image/webp" hidden>' +
          '<button type="button" class="ru-plain-button" id="ruChooseAvatar">更换头像</button>' +
          '<button type="button" class="ru-plain-button" id="ruRemoveAvatar" hidden>移除头像</button>' +
          '<span class="ru-avatar-hint">JPG、PNG 或 WebP，最大 5 MB</span>' +
        '</div>' +
        '<form id="ruProfileForm" class="ru-profile-form" hidden>' +
          '<label>新的昵称<input id="ruProfileDisplayName" maxlength="48" autocomplete="nickname" required></label>' +
          '<div class="ru-profile-actions"><button class="ru-primary" id="ruProfileSave" type="submit">保存昵称</button><button class="ru-plain-button" id="ruProfileCancel" type="button">取消</button></div>' +
        '</form>' +
        '<div id="ruFriendsArea" hidden>' +
          '<section class="ru-section">' +
            '<div class="ru-section-head"><span>添加真人好友</span><button type="button" class="ru-plain-button" id="ruGenerateCode">生成加好友码</button></div>' +
            '<div id="ruCodeArea" class="ru-code-area" hidden>' +
              '<div class="ru-qr-frame"><div id="ruQrCode" class="ru-qr-code" role="img" aria-label="真人好友邀请二维码"></div></div>' +
              '<div class="ru-code-value" id="ruFriendCode"></div>' +
              '<div class="ru-code-expiry" id="ruCodeExpiry"></div>' +
              '<div class="ru-code-actions"><button type="button" id="ruCopyCode">复制好友码</button><button type="button" id="ruCopyPayload">复制 HTTPS 分享链接</button><button type="button" id="ruShareCode">分享</button><button type="button" id="ruRevokeCode">立即作废</button></div>' +
              '<p class="ru-footnote">二维码由本机生成，不会上传邀请码。分享链接只在本应用域名内有效；收到邀请后仍需手动确认发送申请。</p>' +
            '</div>' +
            '<form id="ruAddFriendForm" class="ru-add-form">' +
              '<label>好友码或分享链接<input id="ruFriendCodeInput" maxlength="500" autocomplete="off" spellcheck="false" placeholder="粘贴 64 位好友码、mao:// 或 HTTPS 邀请链接" required></label>' +
              '<label>验证备注（可选）<input id="ruFriendNote" maxlength="160" placeholder="简单介绍一下自己"></label>' +
              '<button class="ru-scan-trigger" type="button" id="ruStartScan">使用相机扫码</button>' +
              '<button class="ru-primary" type="submit">发送好友申请</button>' +
            '</form>' +
          '</section>' +
          '<section class="ru-section">' +
            '<div class="ru-section-head"><span>好友申请</span><button type="button" class="ru-plain-button" id="ruRefreshFriends">刷新</button></div>' +
            '<div class="ru-subhead">收到的申请</div><div id="ruIncoming" class="ru-list"></div>' +
            '<div class="ru-subhead">发出的申请</div><div id="ruOutgoing" class="ru-list"></div>' +
          '</section>' +
          '<section class="ru-section">' +
            '<div class="ru-section-head"><span>已添加的真人好友</span><span class="ru-count" id="ruFriendCount">0</span></div>' +
            '<div id="ruFriends" class="ru-list"></div>' +
            '<p class="ru-footnote">这里显示服务器确认的好友关系。真人聊天消息传输仍未启用，暂时不会跳转到 AI 聊天页面。</p>' +
          '</section>' +
          '<section class="ru-section">' +
            '<div class="ru-section-head"><span>已屏蔽的用户</span></div>' +
            '<div id="ruBlocked" class="ru-list"></div>' +
            '<p class="ru-footnote">解除屏蔽不会自动恢复好友关系；双方需要重新发送并接受好友申请。</p>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';

  var style = document.createElement('style');
  style.id = 'realUserAccountPanelStyles';
  style.textContent = [
    '.ru-account-panel{margin:8px 10px 10px;background:#fff;border:1px solid #ededed;border-radius:8px;color:#171717;overflow:hidden;}',
    '.ru-account-panel>summary{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 13px;cursor:pointer;font-size:13px;font-weight:500;}',
    '.ru-account-panel>summary::-webkit-details-marker{display:none;}',
    '.ru-summary-status{font-size:10px;font-weight:400;color:#888;white-space:nowrap;}',
    '.ru-account-body{padding:0 13px 13px;border-top:1px solid #f1f1f1;}',
    '.ru-status{padding:10px 0;color:#666;font-size:11px;line-height:1.55;}',
    '.ru-status[data-kind="error"]{color:#8b3333;}',
    '.ru-auth-tabs{display:flex;gap:8px;padding:2px 0 10px;}',
    '.ru-auth-tabs button,.ru-plain-button{border:0;background:transparent;color:#777;font:inherit;font-size:11px;padding:6px 8px;cursor:pointer;}',
    '.ru-auth-tabs button.active{color:#111;border-bottom:1px solid #111;}',
    '.ru-auth-form,.ru-add-form{display:grid;gap:9px;}',
    '.ru-auth-form label,.ru-add-form label{display:grid;gap:5px;color:#888;font-size:10px;}',
    '.ru-auth-form input,.ru-add-form input{width:100%;min-width:0;border:1px solid #e7e7e7;border-radius:5px;padding:10px 9px;background:#fafafa;color:#171717;font:inherit;font-size:12px;outline:none;}',
    '.ru-auth-form input:focus,.ru-add-form input:focus{border-color:#888;background:#fff;}',
    '.ru-primary{width:100%;border:1px solid #171717;border-radius:5px;background:#171717;color:#fff;padding:10px 12px;font:inherit;font-size:12px;cursor:pointer;}',
    '.ru-scan-trigger{width:100%;border:1px solid #e2e2e2;border-radius:5px;background:#fff;color:#555;padding:9px 12px;font:inherit;font-size:11px;cursor:pointer;}',
    '.ru-scan-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.72);}',
    '.ru-scan-overlay[hidden]{display:none!important;}',
    '.ru-scan-sheet{width:min(100%,420px);padding:14px;background:#fff;border-radius:10px;color:#171717;}',
    '.ru-scan-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:13px;font-weight:500;}',
    '.ru-scan-head button{border:0;background:transparent;color:#777;padding:6px 8px;font:inherit;font-size:11px;}',
    '.ru-scan-video{display:block;width:100%;max-height:58vh;aspect-ratio:4/3;object-fit:cover;background:#111;border-radius:6px;}',
    '.ru-scan-status{margin-top:10px;color:#777;font-size:11px;line-height:1.6;text-align:center;}',
    '.ru-primary:disabled{opacity:.45;cursor:default;}',
    '.ru-footnote{margin-top:8px;color:#999;font-size:10px;line-height:1.55;}',
    '.ru-account-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f0f0f0;}',
    '.ru-account-identity{display:flex;align-items:center;gap:10px;min-width:0;}',
    '.ru-account-name{font-size:13px;font-weight:500;color:#171717;}',
    '.ru-account-handle{margin-top:3px;color:#999;font-size:10px;}',
    '.ru-avatar-wrap{position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;border:1px solid #e8e8e8;border-radius:50%;background:#f4f4f5;color:#555;}',
    '.ru-avatar-wrap-large{width:48px;height:48px;}',
    '.ru-contact-avatar{width:34px;height:34px;}',
    '.ru-avatar-image{display:block;width:100%;height:100%;object-fit:cover;}',
    '.ru-avatar-image[hidden]{display:none!important;}',
    '.ru-avatar-fallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:13px;font-weight:500;}',
    '.ru-avatar-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0;}',
    '.ru-avatar-controls[hidden]{display:none!important;}',
    '.ru-avatar-hint{color:#999;font-size:9px;}',
    '.ru-list-main-with-avatar{display:flex;align-items:center;gap:9px;}',
    '.ru-profile-form{display:grid;gap:8px;padding:10px 0;border-bottom:1px solid #f0f0f0;}',
    '.ru-profile-form[hidden]{display:none!important;}',
    '.ru-profile-form label{display:grid;gap:5px;color:#888;font-size:10px;}',
    '.ru-profile-form input{width:100%;min-width:0;border:1px solid #e7e7e7;border-radius:5px;padding:9px;background:#fafafa;color:#171717;font:inherit;font-size:12px;}',
    '.ru-profile-actions{display:flex;gap:8px;align-items:center;}',
    '.ru-profile-actions .ru-primary{flex:1;}',
    '.ru-section{padding:12px 0;border-bottom:1px solid #f0f0f0;}',
    '.ru-section:last-child{border-bottom:0;padding-bottom:2px;}',
    '.ru-section-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;color:#222;font-size:12px;font-weight:500;}',
    '.ru-subhead{margin:10px 0 5px;color:#999;font-size:10px;}',
    '.ru-code-area{margin:6px 0 12px;padding:10px;background:#f7f7f8;border-radius:5px;}',
    '.ru-qr-frame{display:flex;justify-content:center;align-items:center;margin:0 auto 10px;padding:12px;width:min(100%,230px);background:#fff;border:1px solid #ececec;border-radius:5px;}',
    '.ru-qr-code{width:100%;max-width:196px;min-height:0;display:flex;justify-content:center;align-items:center;}',
    '.ru-qr-code svg{display:block;width:100%;height:auto;shape-rendering:crispEdges;}',
    '.ru-qr-fallback{padding:24px 8px;text-align:center;color:#999;font-size:10px;line-height:1.6;}',
    '.ru-code-value{font:600 12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.4px;overflow-wrap:anywhere;color:#222;user-select:text;}',
    '.ru-code-expiry{margin-top:4px;color:#999;font-size:10px;}',
    '.ru-code-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '.ru-code-actions button{border:1px solid #e2e2e2;background:#fff;border-radius:4px;padding:7px 8px;color:#555;font:inherit;font-size:10px;}',
    '.ru-list{display:grid;gap:0;}',
    '.ru-list-empty{padding:9px 0;color:#aaa;font-size:10px;}',
    '.ru-list-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 0;border-top:1px solid #f4f4f4;}',
    '.ru-list-main{min-width:0;flex:1;}',
    '.ru-list-name{color:#333;font-size:11px;overflow-wrap:anywhere;}',
    '.ru-list-meta{margin-top:3px;color:#999;font-size:9px;overflow-wrap:anywhere;}',
    '.ru-list-actions{display:flex;gap:5px;flex-shrink:0;}',
    '.ru-list-actions button{border:1px solid #e6e6e6;background:#fff;border-radius:4px;padding:6px 7px;color:#666;font:inherit;font-size:9px;}',
    '.ru-count{color:#999;font-size:10px;font-weight:400;}',
    '@media(max-width:480px){.ru-account-panel{margin-left:8px;margin-right:8px;}}'
  ].join('');
  document.head.appendChild(style);

  var quickEntries = stage.querySelector('.quick-entry-list');
  if (quickEntries && quickEntries.nextSibling) stage.insertBefore(panel, quickEntries.nextSibling);
  else stage.insertBefore(panel, stage.firstChild);

  var authMode = 'login';
  var currentCode = null;
  var inviteLinks = root.PhoneRealUserInviteLinks;
  var pendingInviteCode = inviteLinks ? inviteLinks.captureCurrentInvite(root.location, root.history, document.title) : '';
  var codeExpiryTimer = null;
  var cameraScanner = null;

  function el(id) { return document.getElementById(id); }
  function setStatus(message, kind) {
    el('ruStatus').textContent = message || '';
    el('ruStatus').setAttribute('data-kind', kind || 'normal');
    el('ruSummaryStatus').textContent = kind === 'error' ? '服务异常' : (message || '就绪').slice(0, 16);
  }
  function explainError(error) {
    var code = error && error.code ? error.code : '';
    var messages = {
      network_unavailable: '暂时无法连接服务器，请检查网络后重试。',
      account_auth_unavailable: '服务器尚未开通真人账号服务。',
      friend_service_unavailable: '账号服务可用，但好友服务还没有启用。',
      authentication_required: '登录状态已失效，请重新登录。',
      invalid_registration: '注册信息不符合要求：账号为 3–24 位英文、数字或下划线，昵称 1–48 个字符，密码至少 12 个 UTF-8 字节。',
      handle_unavailable: '这个账号标识已被使用，请换一个。',
      invalid_credentials: '账号或密码不正确。',
      rate_limited: '操作太频繁，请稍后再试。',
      friend_code_invalid_or_expired: '好友码无效或已过期，请让对方重新生成。',
      cannot_add_self: '不能添加自己的账号。',
      already_friends: '你们已经是好友了。',
      incoming_request_exists: '对方已经向你发出申请，请在收到的申请中处理。',
      friend_request_not_allowed: '当前无法发送申请，可能存在屏蔽或关系限制。',
      invalid_friend_code: '请粘贴有效的 64 位好友码或分享链接。',
      origin_not_allowed: '请求来源未通过安全校验。',
      authentication_temporarily_unavailable: '账号服务暂时不可用。',
      invalid_display_name: '昵称不能为空，最多 48 个字符。',
      profile_update_unavailable: '昵称暂时无法保存，请稍后重试。',
      profile_avatar_unavailable: '服务器尚未开通头像存储服务。',
      invalid_avatar_file: '请选择 JPG、PNG 或 WebP 图片，大小不超过 5 MB。',
      unsupported_avatar_type: '暂不支持这种图片格式。',
      avatar_too_large: '图片太大，请选择 5 MB 以内的图片。',
      invalid_avatar_image: '图片文件无法识别，请换一张 JPG、PNG 或 WebP 图片。',
      avatar_upload_unavailable: '头像暂时无法上传，请稍后重试。',
      avatar_delete_unavailable: '头像暂时无法移除，请稍后重试。',
      avatar_read_unavailable: '头像暂时无法读取。',
      friend_requests_temporarily_unavailable: '好友申请暂时无法读取。',
      friends_temporarily_unavailable: '好友列表暂时无法读取。',
      blocked_accounts_temporarily_unavailable: '暂时无法读取已屏蔽的用户。',
      friend_code_temporarily_unavailable: '暂时无法生成好友码。',
      request_not_pending: '这条申请已经处理过，请刷新列表。'
    };
    return messages[code] || (code ? '操作未完成：' + code : '操作未完成，请稍后重试。');
  }
  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.ruOriginalText = button.textContent;
      button.disabled = true;
      button.textContent = label || '处理中…';
    } else {
      button.disabled = false;
      if (button.dataset.ruOriginalText) button.textContent = button.dataset.ruOriginalText;
      delete button.dataset.ruOriginalText;
    }
  }
  function showAuthArea(show) { el('ruAuthArea').hidden = !show; }
  function showSessionArea(show) { el('ruSessionArea').hidden = !show; }
  function renderAvatar(target, fallback, assetId, displayName) {
    var initial = Array.from(String(displayName || 'MAOMAO'))[0] || 'M';
    fallback.textContent = initial;
    var url = client.avatarUrl ? client.avatarUrl(assetId) : '';
    if (!url) {
      target.hidden = true;
      target.removeAttribute('src');
      fallback.hidden = false;
      return;
    }
    target.loading = 'lazy';
    target.decoding = 'async';
    target.referrerPolicy = 'no-referrer';
    target.onerror = function () {
      target.hidden = true;
      target.removeAttribute('src');
      fallback.hidden = false;
    };
    target.src = url;
    target.hidden = false;
    fallback.hidden = true;
  }
  function renderAccount(account) {
    el('ruAccountName').textContent = account.displayName;
    el('ruAccountHandle').textContent = '@' + account.handle;
    el('ruProfileDisplayName').value = account.displayName;
    renderAvatar(el('ruOwnAvatar'), el('ruOwnAvatarFallback'), account.avatarAssetId, account.displayName);
    var capabilities = client.getState().capabilities || {};
    var avatarEnabled = !!(capabilities.profileAvatar && capabilities.profileAvatar.enabled === true);
    el('ruAvatarControls').hidden = !avatarEnabled;
    el('ruRemoveAvatar').hidden = !account.avatarAssetId;
  }
  function setAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    panel.querySelectorAll('[data-ru-mode]').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-ru-mode') === authMode);
    });
    el('ruDisplayNameWrap').hidden = authMode !== 'register';
    el('ruPassword').setAttribute('autocomplete', authMode === 'register' ? 'new-password' : 'current-password');
    el('ruAuthSubmit').textContent = authMode === 'register' ? '创建账号' : '登录';
  }

  function emptyList(container, message) {
    container.textContent = '';
    var node = document.createElement('div');
    node.className = 'ru-list-empty';
    node.textContent = message;
    container.appendChild(node);
  }
  function addText(parent, className, value) {
    var node = document.createElement('div');
    node.className = className;
    node.textContent = String(value == null ? '' : value);
    parent.appendChild(node);
    return node;
  }
  function addAction(parent, label, action, id) {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('data-ru-action', action);
    button.setAttribute('data-ru-id', id);
    parent.appendChild(button);
  }

  function createAvatarWrap(assetId, displayName, large) {
    var wrap = document.createElement('div');
    wrap.className = 'ru-avatar-wrap ' + (large ? 'ru-avatar-wrap-large' : 'ru-contact-avatar');
    var image = document.createElement('img');
    image.className = 'ru-avatar-image';
    image.alt = '';
    image.hidden = true;
    var fallback = document.createElement('span');
    fallback.className = 'ru-avatar-fallback';
    wrap.appendChild(image);
    wrap.appendChild(fallback);
    renderAvatar(image, fallback, assetId, displayName);
    return wrap;
  }

  function renderRequests(container, requests, direction) {
    container.textContent = '';
    if (!requests.length) {
      emptyList(container, '暂无申请');
      return;
    }
    requests.forEach(function (item) {
      var row = document.createElement('div');
      row.className = 'ru-list-row';
      var peer = item.peer || {};
      var main = document.createElement('div');
      main.className = 'ru-list-main ru-list-main-with-avatar';
      main.appendChild(createAvatarWrap(peer.avatarAssetId, peer.displayName, false));
      var textWrap = document.createElement('div');
      textWrap.className = 'ru-list-text';
      addText(textWrap, 'ru-list-name', peer.displayName || 'MAOMAO 用户');
      addText(textWrap, 'ru-list-meta',
        (peer.handle ? '@' + peer.handle : '') +
        (item.note ? ' · ' + item.note : ''));
      main.appendChild(textWrap);
      var actions = document.createElement('div');
      actions.className = 'ru-list-actions';
      if (direction === 'incoming') {
        addAction(actions, '通过', 'accept-request', item.id);
        addAction(actions, '拒绝', 'decline-request', item.id);
      } else {
        addAction(actions, '撤回', 'cancel-request', item.id);
      }
      row.appendChild(main);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function renderFriends(friends) {
    el('ruFriendCount').textContent = String(friends.length);
    var container = el('ruFriends');
    container.textContent = '';
    if (!friends.length) {
      emptyList(container, '还没有服务器确认的真人好友');
      return;
    }
    friends.forEach(function (friend) {
      var row = document.createElement('div');
      row.className = 'ru-list-row';
      var main = document.createElement('div');
      main.className = 'ru-list-main ru-list-main-with-avatar';
      main.appendChild(createAvatarWrap(friend.avatarAssetId, friend.displayName, false));
      var textWrap = document.createElement('div');
      textWrap.className = 'ru-list-text';
      addText(textWrap, 'ru-list-name', friend.displayName || 'MAOMAO 用户');
      addText(textWrap, 'ru-list-meta', friend.handle ? '@' + friend.handle : friend.id);
      main.appendChild(textWrap);
      var actions = document.createElement('div');
      actions.className = 'ru-list-actions';
      addAction(actions, '移除', 'remove-friend', friend.id);
      addAction(actions, '屏蔽', 'block-friend', friend.id);
      row.appendChild(main);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  function renderBlocked(blocked) {
    var container = el('ruBlocked');
    container.textContent = '';
    if (!blocked.length) {
      emptyList(container, '暂无屏蔽用户');
      return;
    }
    blocked.forEach(function (account) {
      var row = document.createElement('div');
      row.className = 'ru-list-row';
      var main = document.createElement('div');
      main.className = 'ru-list-main ru-list-main-with-avatar';
      // A block revokes avatar-read permission; show the local initial without a doomed request.
      main.appendChild(createAvatarWrap(null, account.displayName, false));
      var textWrap = document.createElement('div');
      textWrap.className = 'ru-list-text';
      addText(textWrap, 'ru-list-name', account.displayName || 'MAOMAO 用户');
      addText(textWrap, 'ru-list-meta', account.handle ? '@' + account.handle : account.id);
      main.appendChild(textWrap);
      var actions = document.createElement('div');
      actions.className = 'ru-list-actions';
      addAction(actions, '解除屏蔽', 'unblock-user', account.id);
      row.appendChild(main);
      row.appendChild(actions);
      container.appendChild(row);
    });
  }

  async function refreshServerData() {
    var results = await Promise.all([
      client.listFriends(),
      client.listRequests('incoming'),
      client.listRequests('outgoing'),
      client.listBlocked()
    ]);
    renderFriends(results[0]);
    renderRequests(el('ruIncoming'), results[1], 'incoming');
    renderRequests(el('ruOutgoing'), results[2], 'outgoing');
    renderBlocked(results[3]);
    return results;
  }

  function renderCode(payload) {
    clearCodeExpiryTimer();
    var code = String(payload && payload.code || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('invalid_friend_code_response');
    var expiresAt = Number(payload.expiresAt);
    if (!Number.isFinite(expiresAt)) expiresAt = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresAt)) expiresAt = Date.now() + 15 * 60 * 1000;
    currentCode = { code: code, expiresAt: expiresAt };
    el('ruCodeArea').hidden = false;
    el('ruFriendCode').textContent = code;
    var qrContainer = el('ruQrCode');
    qrContainer.textContent = '';
    qrContainer.className = 'ru-qr-code';
    try {
      var shareUrl = buildCurrentShareUrl();
      if (!shareUrl) throw new Error('share_url_unavailable');
      currentCode.shareUrl = shareUrl;
      if (typeof root.qrcode !== 'function') throw new Error('qr_generator_unavailable');
      var qrPayload = inviteLinks.getQrPayload(payload, shareUrl, root.location);
      currentCode.qrPayload = qrPayload;
      var qr = root.qrcode(0, 'M');
      qr.addData(qrPayload, 'Byte');
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch (error) {
      qrContainer.className = 'ru-qr-code ru-qr-fallback';
      qrContainer.textContent = '二维码暂时无法生成，请复制分享链接发送。';
      currentCode.shareUrl = '';
    }
    updateCodeExpiry();
    codeExpiryTimer = root.setInterval(updateCodeExpiry, 1000);
  }

  function extractCode(value) { return inviteLinks ? inviteLinks.extractFriendCode(value, root.location) : ''; }

  function applyPendingInvite() {
    if (!pendingInviteCode || !el('ruFriendCodeInput')) return false;
    if (!el('ruFriendCodeInput').value) el('ruFriendCodeInput').value = pendingInviteCode;
    return true;
  }
  function buildCurrentShareUrl() {
    if (!currentCode || !inviteLinks) return '';
    return inviteLinks.createShareUrl(root.location, currentCode.code);
  }
  function clearCodeExpiryTimer() {
    if (codeExpiryTimer) root.clearInterval(codeExpiryTimer);
    codeExpiryTimer = null;
  }
  function updateCodeExpiry() {
    if (!currentCode) return;
    var remaining = currentCode.expiresAt - Date.now();
    var expired = remaining <= 0;
    ['ruCopyCode', 'ruCopyPayload', 'ruShareCode'].forEach(function (id) { el(id).disabled = expired; });
    if (expired) {
      el('ruCodeExpiry').textContent = '邀请已过期，请重新生成。';
      el('ruQrCode').textContent = '二维码已过期';
      el('ruQrCode').className = 'ru-qr-code ru-qr-fallback';
      clearCodeExpiryTimer();
      return;
    }
    var seconds = Math.ceil(remaining / 1000);
    el('ruCodeExpiry').textContent = '剩余有效时间 ' + String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  }

  async function boot() {
    showAuthArea(false);
    showSessionArea(false);
    setStatus('正在检查真人账号服务…');
    try {
      var result = await client.restore();
      if (!result.accountAuthEnabled) {
        setStatus('当前服务器尚未开通真人账号服务，账号注册、登录和好友关系暂不可用。AI 角色与现有本地数据不受影响。');
        el('ruSummaryStatus').textContent = '服务未开通';
        return;
      }
      if (!result.account) {
        setStatus(pendingInviteCode ? '已识别一条好友邀请。请先登录或创建账号，之后可确认发送申请。' : '服务器账号服务已就绪，请登录或创建账号。');
        showAuthArea(true);
        setAuthMode('login');
        el('ruSummaryStatus').textContent = '未登录';
        return;
      }
      showSessionArea(true);
      renderAccount(result.account);
      if (!result.friendsEnabled) {
        setStatus('账号已登录，但好友服务尚未启用。');
        return;
      }
      el('ruFriendsArea').hidden = false;
      await refreshServerData();
      applyPendingInvite();
      setStatus(pendingInviteCode ? '已识别好友邀请，请核对后手动发送申请。' : '已连接账号服务。好友列表以服务器关系为准；普通真人消息传输仍未启用。');
    } catch (error) {
      setStatus(explainError(error), 'error');
      if (error && error.code === 'account_auth_unavailable') {
        el('ruSummaryStatus').textContent = '服务未开通';
      }
    }
  }

  panel.querySelectorAll('[data-ru-mode]').forEach(function (button) {
    button.addEventListener('click', function () { setAuthMode(button.getAttribute('data-ru-mode')); });
  });

  el('ruAuthForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = el('ruAuthSubmit');
    setBusy(button, true, authMode === 'register' ? '创建中…' : '登录中…');
    setStatus(authMode === 'register' ? '正在创建账号…' : '正在登录…');
    try {
      var password = el('ruPassword').value;
      var account = authMode === 'register'
        ? await client.register({
            displayName: el('ruDisplayName').value,
            handle: el('ruHandle').value,
            password: password
          })
        : await client.login({
            handle: el('ruHandle').value,
            password: password
          });
      el('ruPassword').value = '';
      showAuthArea(false);
      showSessionArea(true);
      renderAccount(account);
      var state = client.getState();
      if (state.capabilities && state.capabilities.friends && state.capabilities.friends.enabled) {
        el('ruFriendsArea').hidden = false;
        await refreshServerData();
        applyPendingInvite();
        setStatus(pendingInviteCode ? '已识别好友邀请，请核对后手动发送申请。' : '账号已登录，好友关系已从服务器读取。');
      } else {
        setStatus('账号已登录，但好友服务尚未启用。');
      }
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  el('ruChooseAvatar').addEventListener('click', function () {
    if (!el('ruAvatarControls').hidden) el('ruAvatarFile').click();
  });

  el('ruAvatarFile').addEventListener('change', async function () {
    var file = el('ruAvatarFile').files && el('ruAvatarFile').files[0];
    if (!file) return;
    var button = el('ruChooseAvatar');
    setBusy(button, true, '上传中…');
    try {
      var result = await client.uploadAvatar(file);
      renderAccount(result.account);
      setStatus('真人账号头像已更新，好友刷新后会看到新头像。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      el('ruAvatarFile').value = '';
      setBusy(button, false);
    }
  });

  el('ruRemoveAvatar').addEventListener('click', async function () {
    if (!root.confirm('移除当前真人账号头像？')) return;
    var button = el('ruRemoveAvatar');
    setBusy(button, true, '移除中…');
    try {
      var account = await client.removeAvatar();
      renderAccount(account);
      setStatus('真人账号头像已移除。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  el('ruEditName').addEventListener('click', function () {
    var account = client.getState().account;
    if (!account) return;
    el('ruProfileDisplayName').value = account.displayName;
    el('ruProfileForm').hidden = false;
    el('ruProfileDisplayName').focus();
  });

  el('ruProfileCancel').addEventListener('click', function () {
    var account = client.getState().account;
    if (account) renderAccount(account);
    el('ruProfileForm').hidden = true;
  });

  el('ruProfileForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = el('ruProfileSave');
    setBusy(button, true, '保存中…');
    try {
      var account = await client.updateProfile(el('ruProfileDisplayName').value);
      renderAccount(account);
      el('ruProfileForm').hidden = true;
      setStatus('昵称已更新。好友下次刷新时会看到新昵称。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  el('ruLogout').addEventListener('click', async function () {
    var button = el('ruLogout');
    if (!root.confirm('退出当前真人账号？')) return;
    setBusy(button, true, '退出中…');
    try {
      await client.logout();
      clearCodeExpiryTimer();
      currentCode = null;
      el('ruCodeArea').hidden = true;
      showSessionArea(false);
      setAuthMode('login');
      showAuthArea(true);
      setStatus('已退出当前账号。');
      el('ruSummaryStatus').textContent = '未登录';
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  el('ruGenerateCode').addEventListener('click', async function () {
    var button = el('ruGenerateCode');
    setBusy(button, true, '生成中…');
    try {
      var payload = await client.rotateFriendCode();
      renderCode(payload);
      setStatus('加好友码已生成，15 分钟后过期。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  async function copyValue(value) {
    if (!value) throw new Error('empty_value');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      return;
    }
    var input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', 'readonly');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (error) {}
    input.remove();
    if (!copied) throw new Error('copy_unavailable');
  }

  el('ruCopyCode').addEventListener('click', async function () {
    try { await copyValue(currentCode && currentCode.code); setStatus('好友码已复制。'); }
    catch (error) { setStatus('复制失败，请长按好友码手动复制。', 'error'); }
  });
  el('ruCopyPayload').addEventListener('click', async function () {
    try { await copyValue(buildCurrentShareUrl()); setStatus('HTTPS 分享链接已复制。'); }
    catch (error) { setStatus('复制失败，请重新生成好友码。', 'error'); }
  });

  el('ruShareCode').addEventListener('click', async function () {
    var shareUrl = buildCurrentShareUrl();
    if (!shareUrl) { setStatus('当前邀请链接不可用，请重新生成好友码。', 'error'); return; }
    if (root.navigator && typeof root.navigator.share === 'function') {
      try {
        await root.navigator.share({ title: 'MAOMAO 真人好友邀请', text: '通过 MAOMAO 添加我为好友', url: shareUrl });
        setStatus('邀请链接已交给系统分享。');
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') { setStatus('已取消分享。'); return; }
      }
    }
    try { await copyValue(shareUrl); setStatus('此设备暂不支持系统分享，已复制邀请链接。'); }
    catch (error) { setStatus('分享不可用，请长按链接或手动复制。', 'error'); }
  });
  el('ruRevokeCode').addEventListener('click', async function () {
    if (!root.confirm('立即作废当前未过期的加好友码？')) return;
    try {
      await client.revokeFriendCode();
      clearCodeExpiryTimer();
      currentCode = null;
      el('ruCodeArea').hidden = true;
      el('ruQrCode').textContent = '';
      setStatus('加好友码已作废。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    }
  });

  var scanOverlay = document.createElement('div');
  scanOverlay.id = 'ruScanOverlay';
  scanOverlay.className = 'ru-scan-overlay';
  scanOverlay.hidden = true;
  scanOverlay.setAttribute('role', 'dialog');
  scanOverlay.setAttribute('aria-modal', 'true');
  scanOverlay.setAttribute('aria-label', '扫码添加真人好友');
  scanOverlay.innerHTML = '<div class="ru-scan-sheet"><div class="ru-scan-head"><span>扫码添加真人好友</span><button type="button" id="ruCloseScan">关闭</button></div><video id="ruScanVideo" class="ru-scan-video" autoplay muted playsinline></video><p id="ruScanStatus" class="ru-scan-status" role="status" aria-live="polite">摄像头只会在你点击扫码后开启。</p></div>';
  document.body.appendChild(scanOverlay);

  if (root.PhoneRealUserCameraScanner) {
    cameraScanner = root.PhoneRealUserCameraScanner.create({
      window: root,
      document: document,
      video: el('ruScanVideo'),
      overlay: el('ruScanOverlay'),
      closeButton: el('ruCloseScan'),
      mediaDevices: root.navigator && root.navigator.mediaDevices,
      fallbackScriptUrl: '../../shared/js/phone/jsQR.js?v=20261107v3',
      onStatus: function (message) { el('ruScanStatus').textContent = message; },
      onError: function (error) {
        var message = error && error.name === 'NotAllowedError'
          ? '摄像头权限未允许。请在浏览器设置中允许访问，或粘贴好友码/分享链接。'
          : error && error.name === 'NotFoundError'
            ? '没有检测到可用摄像头，请粘贴好友码/分享链接。'
            : '摄像头暂时无法启动，请粘贴好友码/分享链接。';
        el('ruScanStatus').textContent = message;
        setStatus(message, 'error');
      },
      onInvalid: function () {
        el('ruScanStatus').textContent = '这不是有效的 MAOMAO 好友邀请二维码，请对准正确的二维码。';
      },
      onScan: function (rawValue) {
        var code = extractCode(rawValue);
        if (!code) return false;
        pendingInviteCode = code;
        el('ruFriendCodeInput').value = code;
        setStatus('二维码已识别，请核对邀请码后手动发送好友申请。');
        return true;
      }
    });
  }

  el('ruStartScan').addEventListener('click', function () {
    if (!cameraScanner) {
      setStatus('扫码组件不可用，请粘贴好友码或分享链接。', 'error');
      return;
    }
    el('ruScanOverlay').hidden = false;
    el('ruScanStatus').textContent = '正在准备扫码…';
    cameraScanner.start();
  });

  el('ruAddFriendForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var code = extractCode(el('ruFriendCodeInput').value);
    if (!code) { setStatus(explainError({ code: 'invalid_friend_code' }), 'error'); return; }
    var button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, '发送中…');
    try {
      await client.sendFriendRequest(code, el('ruFriendNote').value);
      el('ruFriendCodeInput').value = '';
      el('ruFriendNote').value = '';
      pendingInviteCode = '';
      await refreshServerData();
      setStatus('好友申请已提交。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  el('ruRefreshFriends').addEventListener('click', async function () {
    var button = el('ruRefreshFriends');
    setBusy(button, true, '刷新中…');
    try {
      await refreshServerData();
      setStatus('好友列表和申请已刷新。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  panel.addEventListener('click', async function (event) {
    var button = event.target.closest('[data-ru-action]');
    if (!button) return;
    var action = button.getAttribute('data-ru-action');
    var id = button.getAttribute('data-ru-id');
    var confirmText = action === 'remove-friend' ? '移除这位真人好友？'
      : action === 'block-friend' ? '屏蔽这位用户？屏蔽后好友关系会被移除。' : '';
    if (confirmText && !root.confirm(confirmText)) return;

    setBusy(button, true);
    try {
      if (action === 'accept-request') await client.transitionRequest(id, 'accept');
      else if (action === 'decline-request') await client.transitionRequest(id, 'decline');
      else if (action === 'cancel-request') await client.transitionRequest(id, 'cancel');
      else if (action === 'remove-friend') await client.removeFriend(id);
      else if (action === 'block-friend') await client.setBlocked(id, true);
      else if (action === 'unblock-user') await client.setBlocked(id, false);
      await refreshServerData();
      setStatus(action === 'unblock-user' ? '已解除屏蔽。双方不会自动恢复好友关系。' : '好友关系已更新。');
    } catch (error) {
      setStatus(explainError(error), 'error');
    } finally {
      setBusy(button, false);
    }
  });

  root.addEventListener('pagehide', function () {
    clearCodeExpiryTimer();
    if (cameraScanner) cameraScanner.destroy();
  });
  boot();
})(window);
