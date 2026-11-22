import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const html = readFileSync(fileURLToPath(new URL('../chat/chat/chat-detail.html', import.meta.url)), 'utf8');
const start = html.indexOf('        function refreshChatTitle() {');
const end = html.indexOf('\n        refreshChatTitle();', start);
const refreshSource = start >= 0 && end > start ? html.slice(start, end) : '';

function renderTitle({ group, alias = '', roleAlias = '', isGroup = true } = {}) {
  const title = { textContent: '' };
  const storage = { getItem(key) { return key === 'chat_group_alias_g1' ? alias : ''; } };
  const callback = new Function(
    'loadAlias', 'localStorage', 'isGroupChat', 'aliasRoleId',
    'contactName', 'currentRoleId', 'loadGroupById', 'currentGroup', 'chatTitle',
    refreshSource + '\nreturn refreshChatTitle;'
  )(
    () => ({ roleAlias }), storage, isGroup, 'g1', '测试群聊', 'g1',
    () => group, group, title
  );
  callback();
  return title.textContent;
}

test('group header counts the current user plus the distinct AI members', () => {
  const group = { members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  assert.equal(renderTitle({ group }), '测试群聊（4）');
  group.members.pop();
  assert.equal(renderTitle({ group }), '测试群聊（3）');
});

test('group aliases are retained and existing user records are not counted twice', () => {
  const group = { members: [{ id: '__user' }, { id: 'a' }, { id: 'b' }] };
  assert.equal(renderTitle({ group, alias: '我的群' }), '我的群（3）');
});

test('direct chat titles stay unchanged', () => {
  assert.equal(renderTitle({ isGroup: false, group: null, roleAlias: '我的备注' }), '我的备注');
});

test('group header hides the member/online subtitle only in group chats', () => {
  assert.match(html, /if \(isGroupChat && chatStatusSub\) \{[\s\S]*?chatStatusSub\.textContent = ''/);
  assert.match(html, /chatStatusSub\.style\.setProperty\('display', 'none', 'important'\)/);
  assert.match(html, /if \(!isGroupChat && chatStatusSub\)/);
  assert.doesNotMatch(html, /chatStatusSub\.textContent = \(names\.length \? names\.join/);
  assert.match(html, /if \(event\.key === 'phone_groups'/);
});

test('chat main script still parses with the compact title', () => {
  assert.ok(refreshSource);
  const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(() => new Script(main));
});
