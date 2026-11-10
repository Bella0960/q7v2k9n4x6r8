import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const notifierSource = readFileSync(new URL('../shared/js/chat-notifier.js', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('../shared/js/phone/chat-message-policy.js', import.meta.url), 'utf8');
const presencePolicySource = readFileSync(new URL('../shared/js/phone/chat-presence-policy.js', import.meta.url), 'utf8');

const policyWindow = {};
runInNewContext(policySource, { window: policyWindow, globalThis: {} });
const presencePolicyWindow = {};
runInNewContext(presencePolicySource, { window: presencePolicyWindow, globalThis: {} });
const presencePolicy = presencePolicyWindow.ChatPresencePolicy;

function extractFunction(source, signature, closing) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error('missing function: ' + signature);
  const end = source.indexOf(closing, start);
  if (end < 0) throw new Error('missing function close: ' + signature);
  return source.slice(start, end + closing.length);
}

const proactiveBuilderSource = extractFunction(
  notifierSource,
  'function buildProactiveReplyMessages(content, contact, options)',
  '\n    }'
);
const builderContext = {
  global: { ChatMessagePolicy: policyWindow.ChatMessagePolicy }
};
runInNewContext(
  proactiveBuilderSource + '\nglobalThis.__build = buildProactiveReplyMessages;',
  builderContext
);
const buildProactiveReplyMessages = builderContext.__build;

test('old roles keep legacy proactive splitting while each bubble gets a stable independent message ID', () => {
  const messages = buildProactiveReplyMessages(
    '刚刚看到一家新开的书店。\n\n感觉你可能会喜欢那里的选书。',
    { id: 'role_legacy', name: '林深' },
    { time: 1000, turnId: 'proactive-legacy-1000', source: 'local_proactive' }
  );

  assert.equal(messages.length, 2);
  const values = Array.from(messages, (message) => ({
    role: message.role,
    text: message.text,
    time: message.time,
    turnId: message.turnId,
    bubbleIndex: message.bubbleIndex,
    bubbleCount: message.bubbleCount,
    proactiveContact: message.proactiveContact,
    source: message.source
  }));
  assert.deepEqual(values, [
    {
      role: 'assistant',
      text: '刚刚看到一家新开的书店。',
      time: 1000,
      turnId: 'proactive-legacy-1000',
      bubbleIndex: 0,
      bubbleCount: 2,
      proactiveContact: true,
      source: 'local_proactive'
    },
    {
      role: 'assistant',
      text: '感觉你可能会喜欢那里的选书。',
      time: 1001,
      turnId: 'proactive-legacy-1000',
      bubbleIndex: 1,
      bubbleCount: 2,
      proactiveContact: true,
      source: 'local_proactive'
    }
  ]);
  assert.equal(new Set(Array.from(messages, (message) => message.mid)).size, 2);
});

test('explicit single mode combines proactive output; explicit multi mode keeps each generated bubble', () => {
  const raw = '第一条自然消息。\n\n第二条自然消息。';
  const single = buildProactiveReplyMessages(
    raw,
    { id: 'role_single', replyBubbleMode: 'single' },
    { time: 2000, turnId: 'single-turn' }
  );
  const multi = buildProactiveReplyMessages(
    raw,
    { id: 'role_multi', replyBubbleMode: 'multi' },
    { time: 2000, turnId: 'multi-turn' }
  );

  assert.equal(single.length, 1);
  assert.equal(single[0].text, '第一条自然消息。\n第二条自然消息。');
  assert.equal(multi.length, 2);
  assert.deepEqual(Array.from(multi, (message) => message.text), [
    '第一条自然消息。',
    '第二条自然消息。'
  ]);
});

test('cloud proactive server receipt attaches only to the final bubble in the turn', () => {
  const messages = buildProactiveReplyMessages(
    '先跟你说个小发现。\n\n还有一件相关的小事。',
    { id: 'role_cloud', replyBubbleMode: 'auto' },
    {
      time: 3000,
      turnId: 'cloud-turn-1',
      source: 'cloud_autonomous',
      serverMessageId: 'server-message-id-000001'
    }
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[0].serverMessageId, undefined);
  assert.equal(messages[1].serverMessageId, 'server-message-id-000001');
  assert.equal(messages[0].turnId, messages[1].turnId);
  assert.equal(messages[0].source, 'cloud_autonomous');
  assert.equal(messages[1].source, 'cloud_autonomous');
  assert.equal(new Set(Array.from(messages, (message) => message.mid)).size, 2);
});

test('first proactive contact can begin a new role conversation without prior user messages', () => {
  const now = new Date(2026, 10, 11, 12, 0, 0).getTime();
  const options = {
    enabled: true, pageVisible: true, hasHistory: false, firstContactSent: false,
    enabledAt: now - 2 * 60 * 1000, initialDelayMs: 2 * 60 * 1000,
    now, localHour: 12, globalCooldownMs: 24 * 60 * 60 * 1000,
    roleCooldownMs: 24 * 60 * 60 * 1000
  };
  const eligible = presencePolicy.evaluateInitialProactiveContact(options);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reason, 'eligible');
  assert.equal(eligible.enabledAt, options.enabledAt);
  assert.equal(eligible.idleMs, 2 * 60 * 1000);
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, enabled: false }).reason, 'disabled');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, blocked: true }).reason, 'blocked');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, pageVisible: false }).reason, 'page-hidden');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, hasHistory: true }).reason, 'history-exists');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, firstContactSent: true }).reason, 'already-sent');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, enabledAt: now - 1000 }).reason, 'initial-delay');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, localHour: 23 }).reason, 'quiet-hours');
  assert.equal(presencePolicy.evaluateInitialProactiveContact({ ...options, globalLastAttemptAt: now - 1000 }).reason, 'global-cooldown');
});

test('first-contact prompt uses only supplied persona and forbids invented shared history', () => {
  const prompt = presencePolicy.buildProactiveContactPrompt(
    { name: '小林', persona: '安静，喜欢阅读。', relationship: '朋友' },
    [],
    { localTime: '2026-11-11 12:00', initialContact: true }
  );
  assert.ok(prompt.includes('第一次主动开场'));
  assert.ok(prompt.includes('当前没有任何聊天记录'));
  assert.ok(prompt.includes('不要假装以前聊过'));
  assert.ok(prompt.includes('只根据明确提供的角色设定和关系称呼'));
  assert.ok(prompt.includes('安静，喜欢阅读。'));
  assert.ok(!prompt.includes('【角色过往语言参考】'));
});

test('first-contact runtime revalidates empty history and uses opaque cloud context metadata', () => {
  assert.match(notifierSource, /function hasConversationActivity\(history\)/);
  assert.match(notifierSource, /function proactiveHistoryUnchanged\(candidate, history\)/);
  assert.match(notifierSource, /if \(candidate\.isInitialContact\) \{/);
  assert.match(notifierSource, /cloud\.noteCharacterContextChanged\(roleId, candidate\.history\)/);
  assert.match(notifierSource, /chat_proactive_first_contact_sent_/);
  assert.match(notifierSource, /PROACTIVE_INITIAL_DELAY_MS/);
});

