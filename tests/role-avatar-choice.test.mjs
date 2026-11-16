import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'shared/js/phone/role-avatar-choice.js'), 'utf8');
const detail = fs.readFileSync(path.join(root, 'chat/chat/chat-detail.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function createChoice(seed = {}) {
  const values = new Map(Object.entries(seed));
  const window = { localStorage: {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  }};
  vm.runInNewContext(source, { window }, { filename: 'role-avatar-choice.js' });
  return { api: window.RoleAvatarChoice, values };
}
function makeLibrary(overrides = {}) {
  return {
    list: () => [
      { id: 'a', assetId: 'asset-a', active: true, label: '正在使用' },
      { id: 'b', assetId: 'asset-b', active: false, label: '雨夜' },
      { id: 'c', assetId: 'asset-c', active: false, label: '散步' }
    ],
    getChatPairUserSelection: () => null,
    ...overrides
  };
}

test('existing portrait labels enable optional autonomous selection without image payloads', () => {
  const { api } = createChoice();
  const plan = api.prepare('role-A', makeLibrary(), '今天聊点轻松的', { now: 100000000 });
  assert.equal(plan.candidates.length, 2);
  assert.ok(plan.prompt.includes('雨夜'));
  assert.ok(!plan.prompt.includes('asset-b'));
  assert.ok(!plan.prompt.includes('data:image'));
  assert.equal(plan.candidates.some(entry => entry.active), false);
  const reply = api.parseReply('我今天想换个新头像。[[MAOMAO_ROLE_AVATAR:2]]', plan, true);
  assert.equal(reply.avatarId, 'c');
  assert.equal(reply.text, '我今天想换个新头像。');
});

test('invalid, interrupted and non-authorized markers never change a portrait', () => {
  const { api } = createChoice();
  const plan = api.prepare('role-A', makeLibrary(), '普通聊天');
  assert.equal(api.parseReply('[[MAOMAO_ROLE_AVATAR:9]]', plan, true).avatarId, '');
  assert.equal(api.parseReply('[[MAOMAO_ROLE_AVATAR:1]]', plan, false).avatarId, '');
  assert.equal(api.parseReply('[[MAOMAO_ROLE_AVATAR:1]]', null, true).avatarId, '');
  assert.equal(api.strip('半截 [[MAOMAO_ROLE_AVATAR:1'), '半截');
  assert.equal(api.strip('正文 [[MAOMAO_ROLE_AVATAR:abc]]'), '正文');
});

test('negated user instructions block autonomous switching', () => {
  const { api } = createChoice();
  for (const text of ['不要换头像', '别动我的头像', '不许换头像']) {
    assert.equal(api.prepare('role-A', makeLibrary(), text).prompt, '', text);
  }
});

test('cooldown is role-scoped, but an explicit request can still select', () => {
  const { api } = createChoice();
  assert.equal(api.recordApplied('role-A', 100000000), true);
  assert.equal(api.prepare('role-A', makeLibrary(), '普通聊天', { now: 100000001 }).prompt, '');
  assert.ok(api.prepare('role-B', makeLibrary(), '普通聊天', { now: 100000001 }).prompt);
  assert.ok(api.prepare('role-A', makeLibrary(), '你自己挑个头像', { now: 100000001 }).prompt);
});

test('already-applied matching pairs cannot be overwritten spontaneously', () => {
  const { api } = createChoice();
  const library = makeLibrary({ getChatPairUserSelection: () => ({ pairId: 'pair-1' }) });
  assert.equal(api.prepare('role-A', library, '普通聊天').prompt, '');
  assert.ok(api.prepare('role-A', library, '你自己挑个头像').prompt);
});

test('no selection is offered for single-image libraries or disabled roles', () => {
  const { api } = createChoice();
  const library = makeLibrary({ list: () => [{ id: 'a', assetId: 'asset-a', active: true }] });
  assert.equal(api.prepare('role-A', library, '换头像').prompt, '');
  assert.equal(api.prepare('role-A', makeLibrary(), '换头像', { enabled: false }).prompt, '');
});

test('chat saves the assistant response before applying a role-scoped selection', () => {
  assert.ok(detail.includes('role-avatar-choice.js?v=20261113v1'));
  assert.ok(detail.includes('RoleAvatarChoice.prepare('));
  assert.ok(detail.includes('RoleAvatarChoice.parseReply('));
  assert.ok(detail.includes('if (replySaved && replyMessages.some(function (msg)'));
  assert.ok(detail.includes('RoleAvatarLibrary.applyToCharacter('));
  assert.ok(detail.includes('RoleAvatarChoice.recordApplied(avatarRoleId)'));
  assert.ok(detail.includes('snapshotText = window.RoleAvatarChoice.strip(snapshotText)'));
  assert.ok(detail.includes('tmpText = window.RoleAvatarChoice.strip(tmpText)'));
  assert.ok(shell.includes("'./shared/js/phone/role-avatar-choice.js?v=20261113v1'"));
});


test('character profile keeps an explicit role-scoped opt-out across open chat tabs', () => {
  const manager = fs.readFileSync(path.join(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
  const characterPage = fs.readFileSync(path.join(root, 'worldbook/characters/characters.html'), 'utf8');
  assert.ok(manager.includes('data-profile-action="avatar-autonomy"'));
  assert.ok(manager.includes("target.avatarAutonomyEnabled = !enabled"));
  assert.ok(manager.includes('if (saved) {'));
  assert.ok(manager.includes('renderRoleProfile();'));
  assert.ok(characterPage.includes('.avatar-library-autonomy-toggle'));
  assert.ok(detail.includes('var liveAvatarChoiceRole = getRoleById(aliasRoleId || currentCharacter.id)'));
  assert.ok(detail.includes('currentAvatarChoiceRole && currentAvatarChoiceRole.avatarAutonomyEnabled !== false'));
  assert.ok(detail.includes('var liveRole = getRoleById(avatarRoleId)'));
  assert.ok(detail.includes('!!liveRole && liveRole.avatarAutonomyEnabled !== false'));
});


test('avatar-control marker is honored only at the end of a completed assistant reply', () => {
  const { api } = createChoice();
  const plan = api.prepare('role-A', makeLibrary(), '普通聊天', { now: 100000000 });
  assert.equal(api.parseReply('一段示例：[[MAOMAO_ROLE_AVATAR:1]] 我先说别的', plan, true).avatarId, '');
  assert.equal(api.parseReply('示例 [[MAOMAO_ROLE_AVATAR:1]]' + '\n' + '正常文本结尾', plan, true).avatarId, '');
  assert.equal(api.parseReply('完整的回复 [[maomao_role_avatar:2]] ', plan, true).avatarId, 'c');
  assert.equal(api.strip('对话内容 [[maomao_role_avatar:1'), '对话内容');
});

test('a machine-only marker cannot be treated as a delivered chat reply or trigger avatar mutation', () => {
  assert.ok(detail.includes('// A machine-only avatar marker is not a delivered AI reply.'));
  assert.ok(!detail.includes('                        parsedRoleAvatarChoice.avatarId ||\n'));
  assert.ok(detail.includes('if (replySaved && replyMessages.some(function (msg)'));
  assert.ok(detail.includes("return !!String(msg.text || '').trim()"));
});

test('asynchronous autonomous switch must not repaint a different chat header', () => {
  assert.match(detail, /if \(autonomousApplied && autonomousApplied\.ok\) \{[\s\S]*?String\(aliasRoleId \|\| currentCharacter\.id\) === String\(avatarRoleId\)/);
  assert.match(detail, /isCurrent: function \(\) \{[\s\S]*?var liveRole = getRoleById\(avatarRoleId\)/);
});


test('clear do-not-change commands prevent avatar selection even during normal auto window', () => {
  const { api } = createChoice();
  for (const text of [
    '不换头像', '今天不想换头像', '这回不改头像', '先别换头像',
    '不要换头像', 'do not change avatar', "don't change avatar"
  ]) {
    assert.equal(api.prepare('role-A', makeLibrary(), text, { now: 100000000 }).prompt, '', text);
  }
});

test('direct role-avatar commands override cooldown without forcing a replacement', () => {
  const { api } = createChoice();
  const lib = makeLibrary();
  api.recordApplied('role-A', 100000000);
  for (const text of [
    '换头像', '换个头像', '帮我换个头像', '请换头像',
    '你自己挑个头像', '把你的头像换成别的'
  ]) {
    const plan = api.prepare('role-A', lib, text, { now: 100000001 });
    assert.ok(plan.prompt, text);
    assert.equal(plan.explicit, true, text);
    assert.equal(plan.candidates.length, 2);
  }
  assert.equal(api.prepare('role-A', lib, '今天聊聊天', { now: 100000001 }).prompt, '');
  assert.equal(api.prepare('role-B', lib, '今天聊聊天', { now: 100000001 }).candidates.length, 2);
});

test('explicit choice cannot bypass a role disabling avatar autonomy', () => {
  const { api } = createChoice();
  assert.equal(api.prepare('role-A', makeLibrary(), '换个头像', { enabled: false }).prompt, '');
});


test('one saved AI turn never replaces the role avatar twice', () => {
  assert.match(detail, /var avatarChangedFromNewCandidate = false/);
  assert.match(detail, /if \(changeRequested && !avatarChangedFromNewCandidate &&/);
  assert.match(detail, /if \(avatarApplied && avatarApplied\.ok\) \{\s*avatarChangedFromNewCandidate = true;/);
  assert.match(detail, /replySaved && replyMessages\.some\(function \(msg\)/);
  assert.match(detail, /!avatarChangedFromNewCandidate &&\s*!isGroupChat && parsedRoleAvatarChoice\.avatarId/);
  assert.match(detail, /for \(var avatarCandidateIndex/); // Every additional candidate remains collectable.
});

test('newly generated avatar never paints into a different role after asynchronous reads', () => {
  assert.match(detail,
    /if \(avatarApplied && avatarApplied\.ok\) \{[\s\S]*?if \(String\(aliasRoleId \|\| currentCharacter\.id\) === String\(avatarRoleId\)\) \{[\s\S]*?chatHeaderAvatar\.replaceChildren\(updatedAvatarImage\)/);
  assert.match(detail, /isCurrent: function \(\) \{[\s\S]*?String\(aliasRoleId \|\| currentCharacter\.id\) === String\(avatarRoleId\)/);
});

test('out-of-order tabs cannot shorten cooldown after a newer successful avatar change', () => {
  const { api, values } = createChoice();
  assert.equal(api.recordApplied('role-A', 100000300), true);
  assert.equal(api.recordApplied('role-A', 100000100), true);
  assert.equal(values.get('maomao_role_avatar_auto_last_v1_role-A'), '100000300');
  assert.equal(api.prepare('role-A', makeLibrary(), '普通聊天', { now: 100000301 }).prompt, '');
  assert.ok(api.prepare('role-B', makeLibrary(), '普通聊天', { now: 100000301 }).prompt);
  assert.ok(api.prepare('role-A', makeLibrary(), '你自己换头像', { now: 100000301 }).prompt);
});

test('cooldown persistence failures cannot be misreported as a successful record', () => {
  const { api } = createChoice();
  assert.equal(api.recordApplied('', 100000100), false);
  assert.equal(api.recordApplied('role-A', Infinity), false);
  const window = {
    localStorage: {
      getItem() { return null; },
      setItem() { throw new Error('quota-exceeded'); }
    }
  };
  vm.runInNewContext(source, { window });
  assert.equal(window.RoleAvatarChoice.recordApplied('role-A', 100000100), false);
});


function manualPortraitHarness() {
  const manager = fs.readFileSync(path.join(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
  const start = manager.indexOf('async function selectRoleAvatarFromLibrary(avatarId) {');
  const end = manager.indexOf('\nfunction toggleRoleAvatarPairDraft(avatarId) {', start);
  assert.ok(start >= 0 && end > start, 'character profile must have the manual avatar handler');
  const handler = manager.slice(start, end);
  const status = [];
  const renders = [];
  let resolveApply;
  const library = {
    find(roleId, avatarId) {
      return roleId === 'role-A' && avatarId === 'portrait-b' ? { id: avatarId } : null;
    },
    applyToCharacter(roleId, avatarId, options) {
      return new Promise(resolve => {
        resolveApply = (result) => resolve(result);
      });
    }
  };
  const factory = new Function(
    'window', 'setAvatarLibraryStatus', 'renderRoleProfile',
    "let currentProfileRoleId = 'role-A';\n" + handler +
    "\nreturn { select: selectRoleAvatarFromLibrary, switchRole(id) { currentProfileRoleId = id; } };"
  );
  const ctl = factory({ RoleAvatarLibrary: library },
    (message, kind) => status.push({ message, kind }),
    () => renders.push(true));
  return { ...ctl, status, renders, library, get resolveApply() { return resolveApply; }, handler };
}

test('manual profile avatar switching reuses the library atomic save interface', () => {
  const fixture = manualPortraitHarness();
  assert.match(fixture.handler, /library\.applyToCharacter\(roleId, item\.id, \{/);
  assert.match(fixture.handler, /isCurrent: function \(\)/);
  assert.match(fixture.handler, /if \(String\(currentProfileRoleId \|\| ''\) !== roleId\) return/);
  assert.ok(!fixture.handler.includes('saveRoles('));
  assert.ok(!fixture.handler.includes('library.setActive('));
});

test('a role switch during image IO prevents a stale profile being rendered', async () => {
  const fixture = manualPortraitHarness();
  const pending = fixture.select('portrait-b');
  fixture.switchRole('role-B');
  fixture.resolveApply({ ok: true, value: { avatar: 'data:image/png;base64,irrelevant' } });
  await pending;
  assert.equal(fixture.renders.length, 0);
  assert.equal(fixture.status.filter(entry => entry.kind === 'success').length, 0);
});

test('manual avatar switch displays success only after library save succeeds', async () => {
  const success = manualPortraitHarness();
  const saved = success.select('portrait-b');
  success.resolveApply({ ok: true, value: { avatarAssetId: 'asset-new' } });
  await saved;
  assert.equal(success.renders.length, 1);
  assert.equal(success.status.filter(entry => entry.kind === 'success').length, 1);

  const failed = manualPortraitHarness();
  const pending = failed.select('portrait-b');
  failed.resolveApply({ ok: false, error: { code: 'STALE_SELECTION' } });
  await pending;
  assert.equal(failed.renders.length, 0);
  assert.equal(failed.status.filter(entry => entry.kind === 'error').length, 1);
  assert.match(failed.status.at(-1).message, /原头像未被覆盖/);
});


test('deleted roles clear only their own avatar cooldown record', () => {
  const { api, values } = createChoice();
  assert.equal(api.recordApplied('role-A', 100000101), true);
  assert.equal(api.recordApplied('role-B', 100000102), true);
  assert.equal(api.clearRole('role-A'), true);
  assert.equal(values.has('maomao_role_avatar_auto_last_v1_role-A'), false);
  assert.equal(values.get('maomao_role_avatar_auto_last_v1_role-B'), '100000102');
  assert.equal(api.clearRole(''), false);
});

test('deleted-role cooldown cleanup failures are visible and do not claim success', () => {
  const window = {
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() { throw new Error('storage blocked'); }
    }
  };
  vm.runInNewContext(source, { window });
  assert.equal(window.RoleAvatarChoice.clearRole('role-A'), false);
});

test('character deletion cleans cooldown only after save, with the existing retry queue', () => {
  const manager = fs.readFileSync(path.join(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
  const characterPage = fs.readFileSync(path.join(root, 'worldbook/characters/characters.html'), 'utf8');
  const start = manager.indexOf('async function handleDeleteRole(id) {');
  const end = manager.indexOf('// ====== 草稿', start);
  const deletion = manager.slice(start, end);
  assert.ok(deletion.indexOf('if (!saveRoles(updatedRoles))') >= 0);
  assert.ok(deletion.indexOf('choice.clearRole(String(id))') > deletion.indexOf('if (!saveRoles(updatedRoles))'));
  assert.match(deletion, /!cooldownCleared && !enqueueRoleAvatarCleanup\(id\)/);
  assert.match(manager, /const cooldownCleared = !!choice && typeof choice\.clearRole === 'function' &&\s*choice\.clearRole\(item\.roleId\)/);
  assert.match(manager, /!result \|\| !result\.ok \|\| !cooldownCleared/);
  assert.ok(characterPage.includes('../../shared/js/phone/role-avatar-choice.js?v=20261113v1'));
  assert.ok(characterPage.indexOf('role-avatar-choice.js?v=20261113v1') < characterPage.indexOf('characters-manager.js?v=20261113v2'));
});


function makeChatPairSyncHarness() {
  const start = detail.indexOf("        let _chatPairAvatarUrl = '';");
  const end = detail.indexOf('        // ================= 消息稳定标识：', start);
  assert.ok(start >= 0 && end > start, 'chat pair avatar lifecycle must exist');
  const fragment = detail.slice(start, end);
  const listeners = { window: {}, document: {} };
  const painting = [];
  const avatars = [{}, {}];
  const state = {
    selected: { pairId: 'pair-a', avatarId: 'avatar-b', assetId: 'asset-b' },
    currentDataUrl: 'data:image/png;base64,PHOTO_B',
    localProfile: JSON.stringify({ avatar: 'global-avatar' }),
    reads: 0
  };
  const win = {
    RoleAvatarLibrary: {
      getChatPairUserSelection() { return state.selected; },
      toDataUrl() {
        state.reads++;
        return Promise.resolve({ ok: true, value: state.currentDataUrl });
      }
    },
    addEventListener(name, callback) { (listeners.window[name] ||= []).push(callback); }
  };
  const doc = {
    hidden: false,
    addEventListener(name, callback) { (listeners.document[name] ||= []).push(callback); },
    querySelectorAll(selector) {
      assert.equal(selector, '.msg-row.sent .msg-avatar');
      return avatars;
    }
  };
  const context = {
    window: win, document: doc, isGroupChat: false,
    currentCharacter: { id: 'role-A' }, aliasRoleId: 'role-A',
    USER_SVG: '<svg></svg>',
    localStorage: { getItem: () => state.localProfile },
    fillAvatar(node, avatar) { painting.push(avatar); node.avatar = avatar; }
  };
  vm.runInNewContext(fragment +
    '\nwindow.__chatPairSync = {refresh: refreshChatPairUserAvatar, current: () => _chatPairAvatarUrl};',
    context, { filename: 'chat-pair-sync.js' });
  const fire = (source, name, event) => {
    for (const handler of listeners[source][name] || []) handler(event);
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return { state, doc, win, avatars, painting, listeners, fire, settle, api: win.__chatPairSync };
}

test('other tabs changing this pair update only its sent-message avatars', async () => {
  const f = makeChatPairSyncHarness();
  await f.api.refresh();
  assert.equal(f.api.current(), 'data:image/png;base64,PHOTO_B');
  assert.equal(f.avatars[0].avatar, 'data:image/png;base64,PHOTO_B');
  const paintCount = f.painting.length;

  // A change to a different role must not disturb the open chat.
  f.fire('window', 'storage', { key: 'maomao_chat_pair_user_avatar_v1_role-B' });
  await f.settle();
  assert.equal(f.painting.length, paintCount);
  f.fire('window', 'storage', { key: 'myProfile' });
  await f.settle();
  assert.equal(f.painting.length, paintCount);

  // Unlink in the other tab. The old B-side avatar disappears; global
  // profile photo is used, but never overwritten by role avatar logic.
  f.state.selected = null;
  f.fire('window', 'storage', { key: 'maomao_chat_pair_user_avatar_v1_role-A' });
  await f.settle();
  assert.equal(f.api.current(), '');
  assert.equal(f.avatars[0].avatar, 'global-avatar');
  assert.equal(f.state.localProfile, JSON.stringify({ avatar: 'global-avatar' }));

  // Relink and reapply in another tab: existing conversation updates.
  f.state.selected = { pairId: 'pair-a', avatarId: 'avatar-a', assetId: 'asset-a' };
  f.state.currentDataUrl = 'data:image/png;base64,PHOTO_A';
  f.fire('window', 'storage', { key: 'maomao_role_avatar_library_v1_role-A' });
  await f.settle();
  assert.equal(f.api.current(), 'data:image/png;base64,PHOTO_A');
  assert.equal(f.avatars[1].avatar, 'data:image/png;base64,PHOTO_A');
});

test('returning from BFCache/background refreshes the current pair without repainting unchanged conversations', async () => {
  const f = makeChatPairSyncHarness();
  await f.api.refresh();
  const paintCount = f.painting.length;
  f.fire('window', 'pageshow', {});
  await f.settle();
  assert.equal(f.painting.length, paintCount);
  f.doc.hidden = true;
  f.fire('document', 'visibilitychange', {});
  await f.settle();
  assert.equal(f.painting.length, paintCount);
  f.doc.hidden = false;
  f.state.selected = null;
  f.fire('document', 'visibilitychange', {});
  await f.settle();
  assert.equal(f.api.current(), '');
  assert.equal(f.avatars[0].avatar, 'global-avatar');
});

test('pair storage event after deleting this library clears an old B-side portrait', async () => {
  const f = makeChatPairSyncHarness();
  await f.api.refresh();
  f.state.selected = null;
  f.fire('window', 'storage', { key: null });
  await f.settle();
  assert.equal(f.api.current(), '');
  assert.equal(f.avatars[0].avatar, 'global-avatar');
});


function makePairApplyRoleSwitchHarness() {
  const manager = fs.readFileSync(path.join(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
  const begin = manager.indexOf('async function applyRoleAvatarPairToChat(pairId) {');
  const end = manager.indexOf('\nasync function swapRoleAvatarPair(pairId) {', begin);
  assert.ok(begin >= 0 && end > begin);
  const fragment = manager.slice(begin, end);
  let finish;
  const shown = [];
  const rendered = [];
  const window = { RoleAvatarLibrary: {
    applyPairToChat(roleId, pairId, options) {
      assert.equal(roleId, 'role-A');
      assert.equal(pairId, 'pair-1');
      assert.equal(typeof options.isCurrent, 'function');
      return new Promise(resolve => { finish = resolve; });
    }
  }};
  const factory = new Function('window', 'setAvatarLibraryStatus', 'renderRoleProfile',
    "let currentProfileRoleId = 'role-A';\n" + fragment +
    "\nreturn { apply: applyRoleAvatarPairToChat, switchRole: id => { currentProfileRoleId = id; } };");
  const controls = factory(window, (message, kind) => shown.push({ message, kind }),
    () => rendered.push(true));
  return { ...controls, shown, rendered, get finish() { return finish; } };
}

test('pair apply completion must not repaint a new role after asynchronous media save', async () => {
  const f = makePairApplyRoleSwitchHarness();
  const pending = f.apply('pair-1');
  f.switchRole('role-B');
  f.finish({ ok: true });
  await pending;
  assert.equal(f.rendered.length, 0);
  assert.equal(f.shown.filter(x => x.kind === 'success').length, 0);
});

test('pair apply reports success only when still on the same role', async () => {
  const f = makePairApplyRoleSwitchHarness();
  const pending = f.apply('pair-1');
  f.finish({ ok: true });
  await pending;
  assert.equal(f.rendered.length, 1);
  assert.equal(f.shown.filter(x => x.kind === 'success').length, 1);
});

test('pair editing and portrait removal discard stale status after leaving profile', () => {
  const manager = fs.readFileSync(path.join(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
  for (const [begin, end] of [
    ['async function createRoleAvatarPairFromDraft()', 'async function renameRoleAvatarPair('],
    ['async function renameRoleAvatarPair(', 'async function applyRoleAvatarPairToChat('],
    ['async function swapRoleAvatarPair(', 'async function unlinkRoleAvatarPair('],
    ['async function unlinkRoleAvatarPair(', 'async function removeRoleAvatarFromLibrary(']
  ]) {
    const start = manager.indexOf(begin);
    const stop = manager.indexOf(end, start);
    assert.ok(start >= 0 && stop > start, begin);
    const body = manager.slice(start, stop);
    assert.match(body,
      /await renderAvatarLibrary\(roleId\);\s*if \(String\(currentProfileRoleId \|\| ''\) !== roleId\) return;/,
      begin);
  }
  const removeStart = manager.indexOf('async function removeRoleAvatarFromLibrary(');
  const removeEnd = manager.indexOf('\nfunction escapeHtml(', removeStart);
  const removal = manager.slice(removeStart, removeEnd);
  assert.match(removal, /await library\.remove\(roleId, avatarId\);\s*if \(String\(currentProfileRoleId \|\| ''\) !== roleId\) return;/);
  assert.match(removal, /await renderAvatarLibrary\(roleId\);\s*if \(String\(currentProfileRoleId \|\| ''\) !== roleId\) return;/);
});
