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
      if (response.status === 401) state.account = null;
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
      status: 'active'
    };
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
    var capabilities = await discover();
    state.account = null;
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

  async function logout() {
    requireAuth();
    var payload = await request('/v1/auth/logout', { method: 'POST' });
    state.account = null;
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

  async function listFriends() {
    requireFriends();
    var payload = await request('/v1/friends');
    return Array.isArray(payload.friends) ? payload.friends : [];
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
    version: 1,
    discover: discover,
    restore: restore,
    register: register,
    login: login,
    logout: logout,
    listFriends: listFriends,
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
