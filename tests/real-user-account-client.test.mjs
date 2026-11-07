import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SOURCE = fs.readFileSync(
  path.join(ROOT, 'shared/js/phone/real-user-account-client.js'),
  'utf8'
);
const PANEL_SOURCE = fs.readFileSync(
  path.join(ROOT, 'chat/contacts/real-user-account-panel.js'),
  'utf8'
);

const disabledCapabilities = {
  ok: true,
  service: 'maomao-real-user-chat',
  protocolVersion: 1,
  enabled: false,
  accountAuth: { enabled: false, status: 'disabled' },
  friends: { enabled: false, status: 'disabled' },
  profileAvatar: { enabled: false, status: 'disabled' },
  delivery: { enabled: false }
};

const enabledCapabilities = {
  ...disabledCapabilities,
  accountAuth: { enabled: true, status: 'enabled' },
  friends: { enabled: true, status: 'enabled' }
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    json: async () => structuredClone(body)
  };
}

function runtime(handler) {
  const calls = [];
  const window = {
    crypto: {
      randomUUID: () => '12345678-1234-4234-8234-123456789abc'
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return handler(url, options);
    }
  };
  const sandbox = {
    window,
    Headers,
    Uint8Array,
    Date,
    Math,
    Array,
    Object,
    String,
    Number,
    Error,
    Promise,
    JSON,
    RegExp
  };
  vm.runInNewContext(CLIENT_SOURCE, sandbox, { filename: 'real-user-account-client.js' });
  return { client: window.PhoneRealUserAccountClient, calls, window };
}

test('disabled account auth fails closed and never attempts /me', async () => {
  const app = runtime(async () => jsonResponse(disabledCapabilities));
  const result = await app.client.restore();

  assert.equal(result.accountAuthEnabled, false);
  assert.equal(result.account, null);
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].url, /\/capabilities$/);
  assert.equal(app.calls[0].options.cache, 'no-store');
  assert.equal(app.calls[0].options.credentials, 'same-origin');
});

test('session restoration resolves the account from the HttpOnly cookie endpoint', async () => {
  const app = runtime(async (url) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/me')) {
      return jsonResponse({
        ok: true,
        account: { id: 'account-1', handle: 'member_1', displayName: 'Member', status: 'active' }
      });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  const result = await app.client.restore();
  assert.equal(result.account.id, 'account-1');
  assert.equal(result.account.handle, 'member_1');
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].options.credentials, 'same-origin');
});

test('expired sessions are treated as signed out without masking other errors', async () => {
  const app = runtime(async (url) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    return jsonResponse({ ok: false, error: 'authentication_required' }, 401);
  });

  const result = await app.client.restore();
  assert.equal(result.accountAuthEnabled, true);
  assert.equal(result.account, null);
});

test('login posts credentials without writing a browser persistence store', async () => {
  const app = runtime(async (url, options) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/login')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      assert.equal(JSON.parse(options.body).handle, 'member_1');
      assert.equal(JSON.parse(options.body).password, 'a sufficiently long password');
      return jsonResponse({
        ok: true,
        account: { id: 'account-2', handle: 'member_1', displayName: 'Member', status: 'active' }
      });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.discover();
  const account = await app.client.login({ handle: ' Member_1 ', password: 'a sufficiently long password' });
  assert.equal(account.id, 'account-2');
  assert.equal('localStorage' in app.window, false);
  assert.equal(app.client.getState().account.displayName, 'Member');
});

test('friend endpoints stay disabled until the server advertises the friend service', async () => {
  const capabilities = {
    ...enabledCapabilities,
    friends: { enabled: false, status: 'disabled' }
  };
  const app = runtime(async () => jsonResponse(capabilities));
  await app.client.discover();

  await assert.rejects(
    app.client.listFriends(),
    (error) => error.code === 'friend_service_unavailable'
  );
  assert.equal(app.calls.length, 1);
});

test('friend code, request list and friend list use only the authenticated API', async () => {
  const app = runtime(async (url) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/auth')) return jsonResponse({ ok: true });
    if (url.endsWith('/v1/friends')) {
      return jsonResponse({ ok: true, friends: [{ id: 'friend-1', handle: 'friend_1', displayName: 'Friend' }] });
    }
    if (url.includes('/v1/friends/requests?direction=incoming')) {
      return jsonResponse({ ok: true, requests: [{ id: 'request_123456', peer: { id: 'peer-1' } }] });
    }
    if (url.endsWith('/v1/friends/blocks')) {
      return jsonResponse({ ok: true, blocked: [{ id: 'blocked-1', displayName: 'Blocked' }] });
    }
    if (url.endsWith('/v1/friends/codes/rotate')) {
      return jsonResponse({ ok: true, code: 'a'.repeat(64), qrPayload: 'mao://friend/add?code=' + 'a'.repeat(64) }, 201);
    }
    if (url.endsWith('/v1/auth/me')) {
      return jsonResponse({ ok: true, account: { id: 'self-1', handle: 'self_1', displayName: 'Self', status: 'active' } });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.restore();
  const friends = await app.client.listFriends();
  const incoming = await app.client.listRequests('incoming');
  const blocked = await app.client.listBlocked();
  const code = await app.client.rotateFriendCode();

  assert.equal(friends[0].id, 'friend-1');
  assert.equal(incoming[0].id, 'request_123456');
  assert.equal(blocked[0].id, 'blocked-1');
  assert.equal(code.code.length, 64);
  assert.ok(app.calls.every((call) => call.options.credentials === 'same-origin'));
  assert.ok(app.calls.every((call) => call.options.cache === 'no-store'));
});

test('friend request uses a stable request id and a strictly validated friend code', async () => {
  let requestBody;
  const app = runtime(async (url, options) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/me')) {
      return jsonResponse({ ok: true, account: { id: 'self-1', handle: 'self_1', displayName: 'Self', status: 'active' } });
    }
    if (url.endsWith('/v1/friends/requests')) {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ ok: true, request: { id: requestBody.requestId, status: 'pending' } }, 201);
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.restore();
  const result = await app.client.sendFriendRequest('A'.repeat(64), 'hello');
  assert.match(requestBody.requestId, /^[A-Za-z0-9_-]{8,96}$/);
  assert.equal(requestBody.code, 'a'.repeat(64));
  assert.equal(requestBody.note, 'hello');
  assert.equal(result.request.status, 'pending');

  await assert.rejects(
    app.client.sendFriendRequest('not-a-code', ''),
    (error) => error.code === 'invalid_friend_code'
  );
});

test('request transitions accept only server-supported actions', async () => {
  const app = runtime(async (url) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/me')) {
      return jsonResponse({ ok: true, account: { id: 'self-1', handle: 'self_1', displayName: 'Self', status: 'active' } });
    }
    if (url.endsWith('/accept')) return jsonResponse({ ok: true, request: { status: 'accepted' } });
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.restore();
  const accepted = await app.client.transitionRequest('request_123456', 'accept');
  assert.equal(accepted.request.status, 'accepted');

  await assert.rejects(
    app.client.transitionRequest('request_123456', 'pay'),
    (error) => error.code === 'invalid_request_action'
  );
});


test('Contacts UI exposes only the signed-in account blocked list and an explicit unblock action', () => {
  assert.match(PANEL_SOURCE, /client\.listBlocked\(\)/);
  assert.match(PANEL_SOURCE, /function renderBlocked\(blocked\)/);
  assert.match(PANEL_SOURCE, /addAction\(actions, '解除屏蔽', 'unblock-user', account\.id\)/);
  assert.match(PANEL_SOURCE, /client\.setBlocked\(id, false\)/);
  assert.match(PANEL_SOURCE, /双方不会自动恢复好友关系/);
});


test('profile update uses the server session and refreshes the in-memory account without accepting an account ID', async () => {
  let patch;
  const app = runtime(async (url, options) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/me') && options.method === 'GET') {
      return jsonResponse({
        ok: true,
        account: { id: 'self-profile-1', handle: 'self_1', displayName: 'Before', status: 'active' }
      });
    }
    if (url.endsWith('/v1/auth/me') && options.method === 'PATCH') {
      patch = { url, options };
      return jsonResponse({
        ok: true,
        account: { id: 'self-profile-1', handle: 'self_1', displayName: 'New Nick', status: 'active' }
      });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.restore();
  const account = await app.client.updateProfile('  New Nick  ');

  assert.equal(patch.options.method, 'PATCH');
  assert.deepEqual(JSON.parse(patch.options.body), { displayName: 'New Nick' });
  assert.equal(account.id, 'self-profile-1');
  assert.equal(account.displayName, 'New Nick');
  assert.equal(app.client.getState().account.displayName, 'New Nick');
  assert.equal(patch.options.credentials, 'same-origin');
  assert.equal(patch.options.cache, 'no-store');

  await assert.rejects(
    app.client.updateProfile('   '),
    (error) => error.code === 'invalid_display_name'
  );
});


test('Contacts account panel exposes an explicit edit-and-save nickname flow', () => {
  assert.match(PANEL_SOURCE, /id="ruProfileForm"/);
  assert.match(PANEL_SOURCE, /id="ruEditName"/);
  assert.match(PANEL_SOURCE, /client\.updateProfile\(/);
  assert.match(PANEL_SOURCE, /昵称已更新/);
});


test('profile avatar upload and removal use the session-owned API and never browser persistence', async () => {
  const avatarId = 'av_' + 'a'.repeat(32);
  const avatarCapabilities = {
    ...enabledCapabilities,
    profileAvatar: { enabled: true, status: 'enabled' }
  };
  const png = new Blob([new Uint8Array(33)], { type: 'image/png' });
  const calls = [];
  const app = runtime(async (url, options) => {
    if (url.endsWith('/capabilities')) return jsonResponse(avatarCapabilities);
    if (url.endsWith('/v1/auth/me')) {
      return jsonResponse({
        ok: true,
        account: { id: 'avatar-owner-1', handle: 'owner_1', displayName: 'Owner', status: 'active', avatarAssetId: null }
      });
    }
    if (url.endsWith('/v1/profile/avatar') && options.method === 'POST') {
      calls.push({ url, options });
      assert.equal(options.body, png);
      assert.equal(options.headers.get('Content-Type'), 'image/png');
      return jsonResponse({
        ok: true,
        account: { id: 'avatar-owner-1', handle: 'owner_1', displayName: 'Owner', status: 'active', avatarAssetId: avatarId },
        avatar: { assetId: avatarId, mimeType: 'image/png', byteSize: 33, width: 1, height: 1 }
      }, 201);
    }
    if (url.endsWith('/v1/profile/avatar') && options.method === 'DELETE') {
      calls.push({ url, options });
      return jsonResponse({
        ok: true,
        removed: true,
        account: { id: 'avatar-owner-1', handle: 'owner_1', displayName: 'Owner', status: 'active', avatarAssetId: null }
      });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.restore();
  const uploaded = await app.client.uploadAvatar(png);
  assert.equal(uploaded.account.avatarAssetId, avatarId);
  assert.equal(app.client.getState().account.avatarAssetId, avatarId);
  assert.equal(app.client.avatarUrl(avatarId), '/api/real-user-chat/v1/profile/avatars/' + avatarId);
  assert.equal(app.client.avatarUrl('../not-an-avatar'), '');
  const removed = await app.client.removeAvatar();
  assert.equal(removed.avatarAssetId, null);
  assert.equal(app.client.getState().account.avatarAssetId, null);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.credentials === 'same-origin'));
  assert.ok(calls.every((call) => call.options.cache === 'no-store'));
  assert.equal('localStorage' in app.window, false);
});

test('profile avatar methods fail closed when the server does not advertise avatar storage', async () => {
  const app = runtime(async () => jsonResponse(enabledCapabilities));
  await app.client.restore();
  const png = new Blob([new Uint8Array(33)], { type: 'image/png' });
  await assert.rejects(app.client.uploadAvatar(png),
    (error) => error.code === 'profile_avatar_unavailable');
  await assert.rejects(app.client.removeAvatar(),
    (error) => error.code === 'profile_avatar_unavailable');
});

test('Contacts panel keeps real-user avatar management separate from AI role assets', () => {
  assert.match(PANEL_SOURCE, /id="ruAvatarControls"/);
  assert.match(PANEL_SOURCE, /client\.uploadAvatar\(file\)/);
  assert.match(PANEL_SOURCE, /client\.removeAvatar\(\)/);
  assert.match(PANEL_SOURCE, /friend\.avatarAssetId/);
  assert.match(PANEL_SOURCE, /真人账号头像已更新/);
});


test('friend requests and accepted friends load private avatars; blocked rows avoid denied reads', () => {
  assert.match(PANEL_SOURCE, /function createAvatarWrap\(assetId, displayName, large\)/);
  assert.match(PANEL_SOURCE, /createAvatarWrap\(peer\.avatarAssetId, peer\.displayName, false\)/);
  assert.match(PANEL_SOURCE, /createAvatarWrap\(friend\.avatarAssetId, friend\.displayName, false\)/);
  assert.match(PANEL_SOURCE, /function renderBlocked\(blocked\)[\s\S]*?createAvatarWrap\(null, account\.displayName, false\)/);
  assert.doesNotMatch(PANEL_SOURCE, /function renderBlocked\(blocked\)[\s\S]*?createAvatarWrap\(account\.avatarAssetId/);
  assert.match(PANEL_SOURCE, /target\.loading = 'lazy'/);
  assert.match(PANEL_SOURCE, /target\.decoding = 'async'/);
  assert.match(PANEL_SOURCE, /target\.referrerPolicy = 'no-referrer'/);
  assert.match(PANEL_SOURCE, /client\.avatarUrl\(assetId\)/);
});

test('refreshAccount replaces stale in-memory profile fields with the current cookie-session profile', async () => {
  let currentProfile = {
    id: 'profile-refresh-1',
    handle: 'profile_1',
    displayName: 'Before Refresh',
    status: 'active',
    avatarAssetId: null
  };
  const app = runtime(async (url, options) => {
    if (url.endsWith('/capabilities')) return jsonResponse(enabledCapabilities);
    if (url.endsWith('/v1/auth/login')) {
      return jsonResponse({ ok: true, account: currentProfile });
    }
    if (url.endsWith('/v1/auth/me') && options.method === 'GET') {
      return jsonResponse({ ok: true, account: currentProfile });
    }
    return jsonResponse({ ok: false, error: 'not_found' }, 404);
  });

  await app.client.discover();
  const signedIn = await app.client.login({ handle: 'profile_1', password: 'a sufficiently long password' });
  assert.equal(signedIn.displayName, 'Before Refresh');

  currentProfile = {
    ...currentProfile,
    displayName: 'Updated From Another Device',
    avatarAssetId: 'av_' + 'b'.repeat(32)
  };
  const refreshed = await app.client.refreshAccount();

  assert.equal(refreshed.id, 'profile-refresh-1');
  assert.equal(refreshed.displayName, 'Updated From Another Device');
  assert.equal(refreshed.avatarAssetId, 'av_' + 'b'.repeat(32));
  assert.equal(app.client.getState().account.displayName, 'Updated From Another Device');
  const refreshCall = app.calls.find((call) =>
    call.url.endsWith('/v1/auth/me') && call.options.method === 'GET'
  );
  assert.ok(refreshCall);
  assert.equal(refreshCall.options.credentials, 'same-origin');
  assert.equal(refreshCall.options.cache, 'no-store');
});

test('Contacts refresh and page-resume handlers refresh both the signed-in account and friend data', () => {
  assert.match(PANEL_SOURCE, /client\.refreshAccount\(\)/);
  assert.match(PANEL_SOURCE, /function refreshProfileAndFriends\(\)/);
  assert.match(PANEL_SOURCE, /root\.addEventListener\('pageshow', refreshOnResume\)/);
  assert.match(PANEL_SOURCE, /root\.addEventListener\('focus', refreshOnResume\)/);
  assert.match(PANEL_SOURCE, /document\.addEventListener\('visibilitychange'/);
  assert.match(PANEL_SOURCE, /账号资料、好友头像和申请已同步/);
});
