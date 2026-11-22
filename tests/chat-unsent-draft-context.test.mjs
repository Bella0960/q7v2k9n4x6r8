import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shared = { window: {} };
runInNewContext(read('shared/js/phone/chat-send-policy.js'), shared);
runInNewContext(read('shared/js/phone/chat-context-policy.js'), shared);
const send = shared.window.ChatSendPolicy;
const context = shared.window.ChatContextPolicy;
const chatPage = read('chat/chat/chat-detail.html');

test('ordinary send still uses exactly the typed message', () => {
  const result = send.normalizeOptions(undefined, '  你好，今天怎么样？  ');
  assert.equal(result.text, '你好，今天怎么样？');
  assert.equal(result.contextOnly, false);
  assert.equal(result.isRegen, false);
});

test('retry never promotes unsent input into an AI text or memory-recall query', () => {
  const saved = [
    { role: 'user', text: '已经发送的问题', mid: 'old-user', sendFailed: true },
    { role: 'assistant', text: '旧回复', mid: 'old-ai' }
  ];
  const before = JSON.stringify(saved);
  const result = send.normalizeOptions({
    contextOnly: true, retryTarget: { mid: 'old-user' }
  }, '未发送的输入草稿');
  assert.equal(result.text, '');
  const recall = context.buildHistoricalRecallRequest(saved, result.text, saved.length);
  assert.equal(recall.query, '已经发送的问题');
  assert.equal(JSON.stringify(saved), before, 'draft selection must not modify history');
});

test('regeneration without explicit text ignores unsent drafts', () => {
  const result = send.normalizeOptions({ isRegenerate: true }, '还没有发送的秘密');
  assert.equal(result.text, '');
  assert.equal(result.isRegen, true);
});

test('intentional explicit text remains authoritative, including context-only calls', () => {
  for (const opts of [{ contextOnly: true, text: '  内部指令  ' },
                     { isRegenerate: true, text: '  明确传入  ' }]) {
    const expected = opts.text.trim();
    assert.equal(send.normalizeOptions(opts, '不应该读取的草稿').text, expected);
  }
  assert.equal(send.normalizeOptions({ silent: true, text: '旁白' }, '草稿').text, '旁白');
});

test('legacy fallback uses the same draft-isolation rule when shared policy is unavailable', () => {
  const start = chatPage.indexOf('Compatibility fallback: preserve the original sendMsg option normalization');
  const end = chatPage.indexOf('const customText = sendState.customText', start);
  assert.ok(start >= 0 && end > start, 'chat-detail must retain its legacy send fallback');
  const legacy = chatPage.slice(start, end);
  assert.match(legacy, /opts\.contextOnly\s*\|\|\s*opts\.isRegenerate/);
  assert.match(legacy, /text:\s*customText\s*\|\|/);
  assert.match(chatPage, /const text = isManualContinue \? '' : sendState\.text/);
});
