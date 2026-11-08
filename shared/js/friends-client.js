/* MAOMAO 真人好友客户端。
 * 真人账号与 AI 角色、云端设备凭据分开保存；二维码只暴露公开 userId。
 */
(function (global) {
  'use strict';

  var scriptEl = document.currentScript;
  var basePath = scriptEl ? new URL('../../', scriptEl.src).pathname : '/';
  basePath = basePath.replace(/\/+$/, '');
  var ACCOUNT_KEY = 'maomao_friend_account_v1';

  function apiPath(path) { return basePath + path; }

  function randomBase64Url(byteLength) {
    var bytes = new Uint8Array(byteLength);
    global.crypto.getRandomValues(bytes);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function readAccount() {
    try {
      var value = JSON.parse(global.localStorage.getItem(ACCOUNT_KEY) || 'null');
      if (!value || typeof value.userId !== 'string' || typeof value.secret !== 'string') return null;
      return value;
    } catch (error) { return null; }
  }

  function writeAccount(account) {
    try {
      global.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
      return true;
    } catch (error) {
      throw new Error('本机无法保存真人账号凭据，请检查浏览器存储空间');
    }
  }

  function requestJson(path, options) {
    var opts = options || {};
    var account = opts.account === false ? null : readAccount();
    var headers = { 'Content-Type': 'application/json' };
    if (account) headers['X-Maomao-Account'] = account.userId + '.' + account.secret;
    return global.fetch(apiPath(path), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, error: { message: '云端返回了无法解析的内容' } };
      }).then(function (payload) {
        if (!response.ok || payload.ok === false) {
          var error = new Error((payload.error && payload.error.message) || ('HTTP ' + response.status));
          error.code = (payload.error && payload.error.code) || ('HTTP_' + response.status);
          error.status = response.status;
          throw error;
        }
        return payload;
      });
    });
  }

  function normalizeName(value) {
    return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 24);
  }

  function getOrCreateLocalAccount() {
    var account = readAccount();
    if (!account) {
      account = {
        userId: 'u_' + randomBase64Url(16),
        secret: randomBase64Url(32),
        createdAt: Date.now()
      };
      // Persist the local credential before any network call. A retry must
      // reuse this same identity even when the Worker is temporarily offline.
      writeAccount(account);
    }
    return account;
  }

  function getLocalAccountId() {
    return getOrCreateLocalAccount().userId;
  }

  async function ensureAccount(displayName) {
    var account = getOrCreateLocalAccount();
    var name = normalizeName(displayName) || 'MAOMAO 用户';
    var payload = await requestJson('/api/accounts/register', {
      account: false,
      method: 'POST',
      body: { userId: account.userId, secret: account.secret, displayName: name }
    });
    return payload.account;
  }

  function getMe() { return requestJson('/api/accounts/me'); }

  function updateProfile(displayName) {
    var name = normalizeName(displayName);
    if (!name) return Promise.reject(new Error('昵称不能为空'));
    return requestJson('/api/accounts/me', { method: 'PUT', body: { displayName: name } });
  }

  function getProfile(userId) {
    return requestJson('/api/friend-profiles/' + encodeURIComponent(String(userId || '').trim()), { account: false })
      .then(function (payload) { return payload.profile; });
  }

  function getFriends() {
    return requestJson('/api/friends').then(function (payload) { return payload.friends || []; });
  }

  function getRequests() {
    return requestJson('/api/friend-requests').then(function (payload) { return payload.requests || []; });
  }

  function sendRequest(targetUserId, message) {
    return requestJson('/api/friend-requests', {
      method: 'POST',
      body: { targetUserId: String(targetUserId || '').trim(), message: String(message || '').slice(0, 120) }
    });
  }

  function acceptRequest(requestId) {
    return requestJson('/api/friend-requests/' + encodeURIComponent(requestId) + '/accept', { method: 'POST', body: {} });
  }

  function rejectRequest(requestId) {
    return requestJson('/api/friend-requests/' + encodeURIComponent(requestId) + '/reject', { method: 'POST', body: {} });
  }

  function removeFriend(userId) {
    return requestJson('/api/friends/' + encodeURIComponent(userId), { method: 'DELETE' });
  }

  function createMessageId() {
    return randomBase64Url(18);
  }

  function getMessages(friendId, cursor, direction) {
    var path = '/api/friends/' + encodeURIComponent(String(friendId || '').trim()) + '/messages';
    if (cursor) {
      var key = direction === 'before' ? 'before' : 'after';
      path += '?' + key + '=' + encodeURIComponent(String(cursor));
    }
    return requestJson(path);
  }

  function sendMessage(friendId, body, clientMessageId) {
    var id = String(clientMessageId || createMessageId()).trim();
    return requestJson(
      '/api/friends/' + encodeURIComponent(String(friendId || '').trim()) + '/messages',
      {
        method: 'POST',
        body: { clientMessageId: id, body: String(body == null ? '' : body) }
      }
    );
  }

  function markRead(friendId, messageId) {
    return requestJson(
      '/api/friends/' + encodeURIComponent(String(friendId || '').trim()) + '/read',
      {
        method: 'POST',
        body: { messageId: String(messageId || '').trim() }
      }
    );
  }

  function hideMessage(friendId, messageId) {
    return requestJson(
      '/api/friends/' + encodeURIComponent(String(friendId || '').trim()) +
        '/messages/' + encodeURIComponent(String(messageId || '').trim()),
      { method: 'DELETE' }
    );
  }

  function clearMessages(friendId) {
    return requestJson(
      '/api/friends/' + encodeURIComponent(String(friendId || '').trim()) + '/messages',
      { method: 'DELETE' }
    );
  }

  global.MaomaoFriends = {
    ensureAccount: ensureAccount,
    getLocalAccountId: getLocalAccountId,
    getMe: getMe,
    updateProfile: updateProfile,
    getProfile: getProfile,
    getFriends: getFriends,
    getRequests: getRequests,
    sendRequest: sendRequest,
    acceptRequest: acceptRequest,
    rejectRequest: rejectRequest,
    removeFriend: removeFriend,
    createMessageId: createMessageId,
    getMessages: getMessages,
    sendMessage: sendMessage,
    markRead: markRead,
    hideMessage: hideMessage,
    clearMessages: clearMessages,
    _readAccount: readAccount
  };
})(typeof window !== 'undefined' ? window : self);
