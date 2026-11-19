import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(path, 'utf8');
const rolePolicy = read('shared/js/phone/chat-role-context.js');
const presence = read('shared/js/phone/chat-presence-policy.js');
const detail = read('chat/chat/chat-detail.html');
const sw = read('sw.js');
const sandbox = { window: {} };
runInNewContext(presence, sandbox);
runInNewContext(rolePolicy, sandbox);
const policy = sandbox.window.MAOMAOChatRoleContext;

const human = { id: 'role-one', name: '虚构人物', persona: '【身份】普通人，经营一家旧书店' };
const digital = { id: 'role-two', name: '虚构数字生命', persona: '【身份】人工智能助手，在数字世界工作' };

test('direct human role rejects screenshot-style assistant self-identification without editing role data', () => {
  const original = JSON.stringify(human);
  const reply = '我是一个人工智能，也是你的专属聊天搭子和百宝箱。';
  const result = policy.validateDirectOnlineReply({ role: human, text: reply });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'identity-drift');
  assert.equal(JSON.stringify(human), original);
  assert.equal(policy.isBrokenAssistantIdentity({ role: 'assistant', text: reply }), true);
});

test('direct human role rejects other model and cloud-runtime identity claims', () => {
  for (const text of [
    '我是一名AI助手，可以给你介绍我的功能。',
    '作为一个人工智能，我无法在现实里陪你玩。',
    '我是聊天机器人，可以帮你答疑。',
    '我住在服务器上，随时等待你的指令。'
  ]) {
    assert.equal(policy.validateDirectOnlineReply({ role: human, text }).code, 'identity-drift');
  }
});

test('author-authored digital identities and normal AI discussions stay valid', () => {
  const digitalReply = '我是一个人工智能，也是你的专属聊天搭子。';
  assert.equal(policy.validateDirectOnlineReply({ role: digital, text: digitalReply }).ok, true);
  for (const text of ['你问的是人工智能新闻吗？', '我今天在书店看见一本讲 AI 的书。', '我在呢，刚下班。']) {
    assert.equal(policy.validateDirectOnlineReply({ role: human, text }).ok, true, text);
  }
});

test('missing speaker or empty direct reply fails closed, never rewrites history', () => {
  assert.equal(policy.validateDirectOnlineReply({ role: null, text: '你好' }).code, 'speaker');
  assert.equal(policy.validateDirectOnlineReply({ role: human, text: '  ' }).code, 'empty');
  const history = [{ mid: 'x', role: 'assistant', text: '我是一名AI助手。' }];
  const snapshot = JSON.stringify(history);
  policy.getModelHistory(history, human);
  assert.equal(JSON.stringify(history), snapshot);
});

test('direct stream paint and final output both gate role identity before any visible persistence', () => {
  const stream = detail.indexOf('var directPartialQuality = window.MAOMAOChatRoleContext.validateDirectOnlineReply');
  const render = detail.indexOf('appendMessageToDOM(tmpStreamMsg', stream);
  assert.ok(stream > 0 && render > stream, 'partial direct reply must be checked before DOM append');
  assert.match(detail.slice(stream, render), /if \(!directPartialQuality\.ok\) \{[\s\S]*?streamBubble\.textContent = ''/);
  const final = detail.indexOf('const directQuality = directPolicy');
  const marker = detail.indexOf('processGroupInteractionMarkers(fullText', final);
  const persist = detail.indexOf('if (fullText) {', final);
  assert.ok(final > 0 && persist > final && marker > final,
    'final direct reply must be checked before parsing machine markers and saving chat');
  assert.match(detail.slice(final, persist), /if \(!directQuality\.ok\) \{[\s\S]*?inflightSnapshot = null;[\s\S]*?renderAllMessages\(\);[\s\S]*?return;/);
  assert.doesNotMatch(detail.slice(final, persist), /PhoneStream\.chat\(/,
    'a refused reply must not silently trigger another paid model call');
});

test('existing group guard stays independent, all offline modes keep their own flow', () => {
  assert.match(detail, /qualityPolicy\.validateGroupOnlineReply\(/);
  assert.match(detail, /if \(!isGroupChat && presenceMode === 'online'/);
  assert.match(detail, /if \(!isGroupChat && presenceMode === 'online' && String\(fullText \|\| ''\)\.trim\(\)\)/);
  assert.match(detail, /chat-role-context\.js\?v=20261119directreply1/);
  assert.match(sw, /chat-role-context\.js\?v=20261119directreply1/);
  assert.match(sw, /phone-app-pwa-v261/);
});
