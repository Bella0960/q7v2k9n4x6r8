(function (root) {
  'use strict';

  var API_BASE = '/api/real-user-chat';
  var state = {
    capabilities: null,
    account: null,
    lastCheckedAt: 0
  };

  function makeError(code, status, payload, cause) {
    var error = new Error(code || 'request_failed');
    error.code = code || 'request_failed';
    error.status = Number(status) || 0;
    error.payload = payload || null;
    if (cause) error.cause = cause;
    return error;
  }

  async function request(path, options) {
    options = options && typeof options === 'object' ? options : {};
    if (typeof root.fetch !== 'function') throw makeError('fetch_unavailable', 0);

    var headers = new Headers({ Accept: 'application/json' });
    if (options.headers && typeof options.headers === 'object') {
      Object.keys(options.headers).forEach(function (key) {
        headers.set(key, options.headers[key]);
      });
    }

    var requestOptions = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      mode: 'same-origin',
      redirect: 'error',
      headers: headers
    };
    if (Object.prototype.hasOwnProperty.call(options, 'body')) {
      headers.set('Content-Type', 'application/json');
      requestOptions.body = JSON.stringify(options.body);
    }

    var response;
    try {
      response = await root.fetch(API_BASE + path, requestOptions);
    } catch (error) {
      throw makeError('network_unavailable', 0, null, error);
    }

    var payload = null;
    var contentType = response.headers && response.headers.get
      ? String(response.headers.get('Content-Type') || '').toLowerCase() : '';
    if (contentType.indexOf('application/json') !== -1) {
      try { payload = await response.json(); } catch (error) {}
    }

    if (!response.ok || (payload && payload.ok === false)) {
      var code = payload && payload.error ? String(payload.error) : 'http_' + response.status;
      if (response.status === 401) {
        state.account = null;
        setActiveDirectoryAccount(null);
      }
      throw makeError(code, response.status, payload);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw makeError('invalid_server_response', response.status);
    }
    return payload;
  }

  function normalizeAccount(value) {
    if (!value || typeof value !== 'object') return null;
    var id = String(value.id == null ? '' : value.id).trim();
    var handle = String(value.handle == null ? '' : value.handle).trim();
    var displayName = String(value.displayName == null ? '' : value.displayName).trim();
    if (!id || !handle || !displayName || value.status !== 'active') return null;
    return {
      id: id,
      handle: handle,
      displayName: displayName,
      status: 'active',
      avatarAssetId: /^av_[a-f0-9]{32}$/.test(String(value.avatarAssetId || ''))
        ? String(value.avatarAssetId) : null
    };
  }

  function setActiveDirectoryAccount(account) {
    var directory = root.PhoneContactDirectory;
    if (!directory || typeof directory.setActiveAccountId !== 'function') return;
    directory.setActiveAccountId(
      account && account.id && featureEnabled('friends') ? account.id : ''
    );
  }

  function featureEnabled(name) {
    var feature = state.capabilities && state.capabilities[name];
    return !!(feature && feature.enabled === true);
  }

  function requireAuth() {
    if (!featureEnabled('accountAuth')) throw makeError('account_auth_unavailable', 503);
  }

  function requireFriends() {
    requireAuth();
    if (!featureEnabled('friends')) throw makeError('friend_service_unavailable', 503);
    if (!state.account) throw makeError('authentication_required', 401);
  }

  function requireProfileAvatar() {
    requireAuth();
    if (!featureEnabled('profileAvatar')) throw makeError('profile_avatar_unavailable', 503);
    if (!state.account) throw makeError('authentication_required', 401);
  }

  async function requestAvatar(path, method, file) {
    if (typeof root.fetch !== 'function') throw makeError('fetch_unavailable', 0);
    var response;
    try {
      response = await root.fetch(API_BASE + path, {
        method: method,
        credentials: 'same-origin',
        cache: 'no-store',
        mode: 'same-origin',
        redirect: 'error',
        headers: new Headers({ Accept: 'application/json', 'Content-Type': file.type }),
        body: file
      });
    } catch (error) {
      throw makeError('network_unavailable', 0, null, error);
    }
    var payload = null;
    if (response.headers && response.headers.get &&
        String(response.headers.get('Content-Type') || '').toLowerCase().includes('application/json')) {
      try { payload = await response.json(); } catch (error) {}
    }
    if (!response.ok || (payload && payload.ok === false)) {
      var code = payload && payload.error ? String(payload.error) : 'http_' + response.status;
      if (response.status === 401) {
        state.account = null;
        setActiveDirectoryAccount(null);
      }
      throw makeError(code, response.status, payload);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw makeError('invalid_server_response', response.status);
    }
    return payload;
  }

  async function discover() {
    var payload = await request('/capabilities');
    if (payload.service !== 'maomao-real-user-chat' || payload.ok !== true) {
      throw makeError('invalid_capabilities_response', 200, payload);
    }
    state.capabilities = payload;
    state.lastCheckedAt = Date.now();
    return payload;
  }

  async function restore() {
    state.account = null;
    setActiveDirectoryAccount(null);
    var capabilities = await discover();
    if (!featureEnabled('accountAuth')) {
      return {
        capabilities: capabilities,
        account: null,
        accountAuthEnabled: false,
        friendsEnabled: featureEnabled('friends')
      };
    }

    try {
      var payload = await request('/v1/auth/me');
      state.account = normalizeAccount(payload.account);
      if (!state.account) throw makeError('invalid_account_response', 200, payload);
      setActiveDirectoryAccount(state.account);
    } catch (error) {
      if (error && error.status === 401) {
        state.account = null;
      } else {
        throw error;
      }
    }
    return {
      capabilities: capabilities,
      account: state.account,
      accountAuthEnabled: true,
      friendsEnabled: featureEnabled('friends')
    };
  }

  async function authenticate(action, values) {
    requireAuth();
    var payload = await request('/v1/auth/' + action, {
      method: 'POST',
      body: values
    });
    state.account = normalizeAccount(payload.account);
    if (!state.account) throw makeError('invalid_account_response', 200, payload);
    setActiveDirectoryAccount(state.account);
    return state.account;
  }

  async function register(values) {
    values = values && typeof values === 'object' ? values : {};
    return authenticate('register', {
      handle: String(values.handle == null ? '' : values.handle).trim().toLowerCase(),
      displayName: String(values.displayName == null ? '' : values.displayName).trim(),
      password: String(values.password == null ? '' : values.password)
    });
  }

  async function login(values) {
    values = values && typeof values === 'object' ? values : {};
    return authenticate('login', {
      handle: String(values.handle == null ? '' : values.handle).trim().toLowerCase(),
      password: String(values.password == null ? '' : values.password)
    });
  }

  // Refresh the signed-in profile from the HttpOnly-cookie session endpoint.
  // The browser never treats an old in-memory profile as authoritative.
  async function refreshAccount() {
    requireAuth();
    if (!state.account) throw makeError('authentication_required', 401);
    var payload = await request('/v1/auth/me');
    var updated = normalizeAccount(payload.account);
    if (!updated) throw makeError('invalid_account_response', 200, payload);
    state.account = updated;
    setActiveDirectoryAccount(updated);
    return updated;
  }

  async function updateProfile(displayName) {
    requireAuth();
    if (!state.account) throw makeError('authentication_required', 401);
    var cleanName = String(displayName == null ? '' : displayName).trim();
    if (!cleanName || Array.from(cleanName).length > 48) {
      throw makeError('invalid_display_name', 400);
    }
    var previousAccountId = state.account.id;
    var payload = await request('/v1/auth/me', {
      method: 'PATCH',
      body: { displayName: cleanName }
    });
    var updated = normalizeAccount(payload.account);
    if (!updated || updated.id !== previousAccountId) {
      throw makeError('invalid_account_response', 200, payload);
    }
    state.account = updated;
    setActiveDirectoryAccount(updated);
    return updated;
  }

  async function uploadAvatar(file) {
    requireProfileAvatar();
    if (!file || typeof file.size !== 'number' || file.size < 24 || file.size > 5 * 1024 * 1024 ||
        ['image/jpeg', 'image/png', 'image/webp'].indexOf(String(file.type || '').toLowerCase()) === -1) {
      throw makeError('invalid_avatar_file', 400);
    }
    var accountId = state.account.id;
    var payload = await requestAvatar('/v1/profile/avatar', 'POST', file);
    var updated = normalizeAccount(payload.account);
    if (!updated || updated.id !== accountId || !updated.avatarAssetId) {
      throw makeError('invalid_account_response', 200, payload);
    }
    state.account = updated;
    setActiveDirectoryAccount(updated);
    return { account: updated, avatar: payload.avatar || null };
  }

  async function removeAvatar() {
    requireProfileAvatar();
    var accountId = state.account.id;
    var payload = await request('/v1/profile/avatar', { method: 'DELETE' });
    var updated = normalizeAccount(payload.account);
    if (!updated || updated.id !== accountId || updated.avatarAssetId) {
      throw makeError('invalid_account_response', 200, payload);
    }
    state.account = updated;
    setActiveDirectoryAccount(updated);
    return updated;
  }

  function avatarUrl(assetId) {
    var id = String(assetId == null ? '' : assetId);
    if (!/^av_[a-f0-9]{32}$/.test(id)) return '';
    return API_BASE + '/v1/profile/avatars/' + encodeURIComponent(id);
  }

  async function logout() {
    requireAuth();
    var payload = await request('/v1/auth/logout', { method: 'POST' });
    state.account = null;
    setActiveDirectoryAccount(null);
    return payload;
  }

  function requestId() {
    var value = '';
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') {
        value = root.crypto.randomUUID();
      } else if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        value = Array.prototype.map.call(bytes, function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
      }
    } catch (error) {}
    if (!value) value = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 18);
    return 'rq_' + value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 88);
  }

  async function listFriendRoster() {
    requireFriends();
    var friends = [];
    var relationships = [];
    var snapshotAt = null;
    var cursor = '';
    var pages = 0;
    var seenIds = Object.create(null);
    while (true) {
      pages += 1;
      if (pages > 500) throw makeError('friend_roster_too_large', 413);
      var query = '?limit=100';
      if (snapshotAt !== null) query += '&snapshotAt=' + encodeURIComponent(String(snapshotAt));
      if (cursor) query += '&after=' + encodeURIComponent(cursor);
      var payload = await request('/v1/friends' + query);
      if (!Array.isArray(payload.friends) || !Array.isArray(payload.relationships) ||
          typeof payload.hasMore !== 'boolean' || !Number.isSafeInteger(Number(payload.snapshotAt))) {
        throw makeError('invalid_friend_roster_response', 200, payload);
      }
      var pageSnapshotAt = Number(payload.snapshotAt);
      if (snapshotAt === null) snapshotAt = pageSnapshotAt;
      else if (snapshotAt !== pageSnapshotAt) throw makeError('friend_snapshot_changed', 409, payload);

      payload.relationships.forEach(function (relationship) {
        var id = String(relationship && relationship.id || '');
        if (!id || seenIds[id]) throw makeError('invalid_friend_roster_response', 200, payload);
        seenIds[id] = true;
        relationships.push(relationship);
      });
      friends = friends.concat(payload.friends);
      if (!payload.hasMore) {
        if (payload.nextCursor != null && payload.nextCursor !== '') {
          throw makeError('invalid_friend_roster_response', 200, payload);
        }
        break;
      }
      var nextCursor = String(payload.nextCursor || '');
      var lastRelationship = payload.relationships[payload.relationships.length - 1];
      if (!nextCursor || nextCursor === cursor || !lastRelationship || String(lastRelationship.id) !== nextCursor) {
        throw makeError('invalid_friend_roster_cursor', 200, payload);
      }
      cursor = nextCursor;
    }
    return {
      ownerAccountId: state.account.id,
      friends: friends,
      relationships: relationships,
      snapshotAt: snapshotAt,
      complete: true
    };
  }

  async function listFriends() {
    var roster = await listFriendRoster();
    return roster.friends;
  }

  async function listRequests(direction) {
    requireFriends();
    if (direction !== 'incoming' && direction !== 'outgoing') {
      throw makeError('invalid_direction', 400);
    }
    var payload = await request('/v1/friends/requests?direction=' + direction);
    return Array.isArray(payload.requests) ? payload.requests : [];
  }

  async function listBlocked() {
    requireFriends();
    var payload = await request('/v1/friends/blocks');
    return Array.isArray(payload.blocked) ? payload.blocked : [];
  }

  async function rotateFriendCode() {
    requireFriends();
    return request('/v1/friends/codes/rotate', { method: 'POST' });
  }

  async function revokeFriendCode() {
    requireFriends();
    return request('/v1/friends/codes/me', { method: 'DELETE' });
  }

  async function sendFriendRequest(code, note, stableRequestId) {
    requireFriends();
    var normalizedCode = String(code == null ? '' : code).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedCode)) throw makeError('invalid_friend_code', 400);
    var cleanNote = String(note == null ? '' : note).trim().slice(0, 160);
    var id = String(stableRequestId || requestId());
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(id)) throw makeError('invalid_request_id', 400);
    return request('/v1/friends/requests', {
      method: 'POST',
      body: { requestId: id, code: normalizedCode, note: cleanNote || undefined }
    });
  }

  async function transitionRequest(id, action) {
    requireFriends();
    if (['accept', 'decline', 'cancel'].indexOf(action) === -1) {
      throw makeError('invalid_request_action', 400);
    }
    var requestKey = String(id == null ? '' : id).trim();
    if (!/^[A-Za-z0-9_-]{8,96}$/.test(requestKey)) throw makeError('invalid_request_id', 400);
    return request('/v1/friends/requests/' + encodeURIComponent(requestKey) + '/' + action, {
      method: 'POST'
    });
  }

  async function removeFriend(id) {
    requireFriends();
    var accountId = String(id == null ? '' : id).trim();
    if (!accountId || accountId === state.account.id) throw makeError('invalid_friend_id', 400);
    return request('/v1/friends/' + encodeURIComponent(accountId), { method: 'DELETE' });
  }

  async function setBlocked(id, blocked) {
    requireFriends();
    var accountId = String(id == null ? '' : id).trim();
    if (!accountId || accountId === state.account.id) throw makeError('invalid_friend_id', 400);
    return request('/v1/friends/' + encodeURIComponent(accountId) + '/block', {
      method: blocked === false ? 'DELETE' : 'POST'
    });
  }

  root.PhoneRealUserAccountClient = {
    version: 2,
    discover: discover,
    restore: restore,
    refreshAccount: refreshAccount,
    register: register,
    login: login,
    updateProfile: updateProfile,
    uploadAvatar: uploadAvatar,
    removeAvatar: removeAvatar,
    avatarUrl: avatarUrl,
    logout: logout,
    listFriends: listFriends,
    listFriendRoster: listFriendRoster,
    listRequests: listRequests,
    listBlocked: listBlocked,
    rotateFriendCode: rotateFriendCode,
    revokeFriendCode: revokeFriendCode,
    sendFriendRequest: sendFriendRequest,
    transitionRequest: transitionRequest,
    removeFriend: removeFriend,
    setBlocked: setBlocked,
    getState: function () {
      return {
        capabilities: state.capabilities,
        account: state.account,
        lastCheckedAt: state.lastCheckedAt
      };
    }
  };
})(window);
