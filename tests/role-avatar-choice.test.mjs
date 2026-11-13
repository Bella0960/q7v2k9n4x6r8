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
    setItem(key, value) { values.set(key, String(value)); }
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
  assert.ok(detail.includes('if (replySaved && !isGroupChat && parsedRoleAvatarChoice.avatarId'));
  assert.ok(detail.includes('RoleAvatarLibrary.applyToCharacter('));
  assert.ok(detail.includes('RoleAvatarChoice.recordApplied(avatarRoleId)'));
  assert.ok(detail.includes('snapshotText = window.RoleAvatarChoice.strip(snapshotText)'));
  assert.ok(detail.includes('tmpText = window.RoleAvatarChoice.strip(tmpText)'));
  assert.ok(shell.includes("'./shared/js/phone/role-avatar-choice.js?v=20261113v1'"));
});
