import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const homeCss = readFileSync(new URL('../shared/css/chat-light-surfaces.css', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');

test('group messages resolve the actual member portrait; never substitute group cover', () => {
  assert.match(detail, /function groupSpeakerForMessage\(message\)/);
  assert.match(detail, /function groupSpeakerAvatarForMessage\(message, speaker\)/);
  assert.match(detail, /return ''; \/\/ No verified speaker: neutral fallback, not group cover/);
  assert.match(detail, /groupSender = groupSpeakerForMessage\(msg\)/);
  assert.match(detail, /fillAvatar\(avatar, groupSpeakerAvatarForMessage\(msg, groupSender\), USER_SVG\)/);
  assert.match(detail, /fillAvatar\(extraAv, groupSpeakerAvatarForMessage\(msg\), USER_SVG\)/);
  assert.doesNotMatch(detail, /\(groupRole && \(groupRole\.avatar \|\| groupRole\.avatarUrl\)\) \|\| currentCharacter\.avatar/);
});

test('synthetic group welcome remains visible but never primes AI group history', () => {
  assert.match(detail, /role: 'received', type: 'group_welcome'/);
  const sandbox = { window: {} };
  runInNewContext(policySource, sandbox, { filename: 'chat-context-policy.js' });
  const convert = sandbox.window.ChatContextPolicy.mapHistoryToApiMessages;
  const history = [
    { role: 'received', text: '欢迎来到「测试群聊」群聊，一起聊聊吧。' },
    { role: 'sent', text: '你们在忙吗？' },
    { role: 'assistant', memberId: 'role-a', name: '角色甲', text: '我刚下课。' }
  ];
  const msgs = convert(history, String, {
    isGroupChat: true,
    groupMembers: [{id:'role-a', name:'角色甲'}]
  });
  assert.equal(msgs.some(m => m.content.includes('欢迎来到')), false);
  assert.equal(msgs.some(m => m.content.includes('你们在忙吗')), true);
  assert.equal(msgs.some(m => m.content.includes('角色甲')), true);
  assert.equal(convert([{role:'received',type:'group_welcome',text:'自定义欢迎'}],String,{isGroupChat:true}).length,0);
});

test('group persona instruction rejects generic greeting without replacing saved persona', () => {
  assert.match(detail, /【群聊口吻纠偏】/);
  assert.match(detail, /随时在线待命/);
  assert.match(detail, /用户保存的协议、世界书和本轮角色档案始终优先/);
  assert.match(detail, /sourceContract\.validatePersonaRequest/);
});

test('white chat home is compact and mode label is English without arrows', () => {
  assert.match(homeCss, /\.main-stage \{ padding:12px 0 96px; min-height:0; \}/);
  assert.match(homeCss, /\.cover-spacer \{ height:6px; flex-basis:6px; \}/);
  assert.match(detail, /chatStatusSub\.textContent = initialChatMode === 'narration' \? 'NARRATION' : 'ONLINE'/);
  assert.match(detail, /chatModeTrigger\.textContent = 'ONLINE'/);
  assert.match(detail, /chatModeTrigger\.textContent = 'NARRATION'/);
  assert.doesNotMatch(detail, /ONLINE · ACTIVE|NARRATION · ACTIVE|chat-mode-chevron/);
  assert.match(detail, /function openChatModeSheet\(\)/);
});
