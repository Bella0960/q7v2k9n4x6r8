import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/chat-message-policy.js', import.meta.url), 'utf8');
const window = {};
runInNewContext(source, { window, globalThis: window });
const policy = window.ChatMessagePolicy;

test('multiple translation markers in one bubble are preserved in order', () => {
  const result = policy.parseReplyContent('Hello[中译:你好] world[中译:世界]', 'auto');
  assert.deepEqual(Array.from(result.bubbles), ['Hello world']);
  assert.deepEqual(Array.from(result.translations), ['你好\n世界']);
});

test('translation markers remain aligned across bubbles', () => {
  const result = policy.parseReplyContent('A[中译:甲][中译:乙]\n\nB[中译:丙]', 'auto');
  assert.deepEqual(Array.from(result.bubbles), ['A', 'B']);
  assert.deepEqual(Array.from(result.translations), ['甲\n乙', '丙']);
});
