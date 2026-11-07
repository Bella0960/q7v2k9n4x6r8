import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const policySource = read('../shared/js/phone/contact-capabilities.js');
const detail = read('../chat/chat/chat-detail.html');
const extras = read('../chat/chat/js/chat-extras.js');
const callOverlay = read('../chat/call/call-overlay.js');
const wallet = read('../wallet/wallet.html');

function getPolicy() {
  const window = {};
  vm.runInNewContext(policySource, { window, Object, String });
  return window.PhoneContactCapabilities;
}

const realUser = { type: 'real_user', id: 'user-1' };

test('real-user conversations allow only ordinary chat and common media messages', () => {
  const policy = getPolicy();
  for (const capability of ['text_message', 'image_message', 'file_message', 'voice_message', 'sticker_message']) {
    assert.equal(policy.can(realUser, capability), true, capability);
  }
  for (const messageType of ['text', 'image', 'file', 'voice', 'sticker']) {
    assert.equal(policy.canMessageType(realUser, messageType), true, messageType);
  }
});

test('real-user conversations deny red packets, transfers, collection, wallet and transaction records', () => {
  const policy = getPolicy();
  for (const capability of [
    'redpacket', 'transfer', 'payment', 'collect', 'receive_payment',
    'wallet', 'transaction_history', 'trade_record', 'top_up',
    'withdraw', 'gift', 'gift_order', 'family_card', 'intimate_pay',
    'unknown_future_feature'
  ]) {
    assert.equal(policy.can(realUser, capability), false, capability);
  }
  for (const messageType of ['redpacket', 'transfer', 'role_family_card', 'gift', 'wallet', 'transaction_record']) {
    assert.equal(policy.canMessageType(realUser, messageType), false, messageType);
  }
});

test('unlisted real-user features fail closed instead of inheriting AI features', () => {
  const policy = getPolicy();
  for (const feature of ['redpacket', 'transfer', 'gift', 'card', 'date', 'location', 'video', 'group-call', 'voice']) {
    assert.equal(policy.canFeature(realUser, feature), false, feature);
  }
  assert.equal(policy.canFeature(realUser, 'img'), true);
  assert.equal(policy.canFeature(realUser, 'voice-msg'), true);
  assert.equal(policy.canFeature(realUser, 'sticker'), true);
});

test('real-user voice calling is planned but disabled until real-time communication exists', () => {
  const policy = getPolicy();
  const state = policy.getFeatureState(realUser, 'voice');
  assert.equal(state.enabled, false);
  assert.equal(state.planned, true);
  assert.match(state.reason, /实时通信服务/);
  assert.equal(policy.getFeatureState(realUser, 'video').enabled, false);
});

test('AI-role and existing group conversations keep their current feature behavior', () => {
  const policy = getPolicy();
  for (const contact of [{ type: 'ai_role', id: 'role-1' }, { type: 'chat_group', id: 'group-1' }]) {
    assert.equal(policy.canFeature(contact, 'redpacket'), true);
    assert.equal(policy.canFeature(contact, 'voice'), true);
    assert.equal(policy.canMessageType(contact, 'transfer'), true);
  }
});

test('the real-user policy clearly separates allowed, planned and blocked capabilities', () => {
  const policy = getPolicy();
  const result = policy.getPolicy(realUser);
  assert.equal(result.mode, 'chat_only');
  assert.ok(result.allowed.includes('text_message'));
  assert.ok(result.planned.includes('voice_call'));
  assert.ok(result.blocked.includes('redpacket'));
  assert.ok(result.blocked.includes('transfer'));
  assert.ok(result.blocked.includes('transaction_history'));
});

test('chat plus-menu and direct handlers enforce the real-user feature allowlist', () => {
  assert.match(extras, /function applyRealUserFeaturePolicy\(\)/);
  assert.match(extras, /function handleFeature\(feat\)[\s\S]*?realUserFeatureAllowed\(feat\)/);
  assert.match(extras, /function openPayDrawer\(mode\)[\s\S]*?isRealUserConversation\(\)/);
  assert.match(extras, /function submitPayMessage\(\)[\s\S]*?isRealUserConversation\(\)/);
  assert.match(extras, /function featCall\(mode\)[\s\S]*?realUserFeatureAllowed\('voice'\)/);
});

test('chat rendering and payment-card handlers do not expose transaction details to real users', () => {
  assert.match(detail, /contact-capabilities\.js\?v=20261107v1/);
  assert.match(detail, /window\.PhoneIsRealUserConversation/);
  assert.match(detail, /真人聊天仅支持普通聊天内容/);
  assert.match(detail, /真人聊天不支持红包、转账或交易记录/);
  assert.match(detail, /function extractPayMarkers\(raw\)[\s\S]*?PhoneIsRealUserConversation[\s\S]*?items: \[\]/);
  assert.match(detail, /function insertPayCards\(historyList, items\)[\s\S]*?PhoneIsRealUserConversation/);
  assert.match(detail, /function handlePayCardClick\(event\)[\s\S]*?PhoneIsRealUserConversation/);
  assert.match(detail, /function plainTextOf\(msg\)[\s\S]*?真人聊天不支持的扩展内容/);
});

test('the separate wallet app remains independent from real-user chat restrictions', () => {
  assert.match(wallet, /交易明细/);
  assert.doesNotMatch(wallet, /contact-capabilities\.js/);
});


test('the direct call-overlay start path rejects real-user contacts before opening a simulated call', () => {
  assert.match(callOverlay, /function start\(mode, character\)[\s\S]*?contactRef\.type[\s\S]*?capabilities\.canFeature[\s\S]*?return false/);
});
