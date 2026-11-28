import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');

test('legacy user memories stay role-scoped in private prompts', () => {
  assert.match(html, /const activeMemoryRoleId = String\(aliasRoleId \|\| currentRoleId \|\| ''\)/);
  assert.match(html, /ChatContextPolicy\.filterUserMemoriesForRole\(um, activeMemoryRoleId\)/);
  assert.match(html, /m\.sourceRoleId != null && activeMemoryRoleId/,
    'the fallback must reject unowned legacy records instead of leaking them across roles');
  assert.match(policy, /sourceRoleId/);
});

test('group prompts never import the legacy global user_memory cache', () => {
  assert.match(html, /const um = !isGroupChat \? JSON\.parse\(localStorage\.getItem\('user_memory'\) \|\| '\[\]'\) : \[\]/);
  assert.match(html, /本群仅使用已确认的公开共同回忆/);
});

test('the scoped legacy memory text remains part of the final system prompt', () => {
  assert.match(html, /userMemoryText = capText\(userMemoryText, CTX_CAP\.userMemory\)/);
  assert.match(html, /【已经记录的用户信息】[\s\S]{0,120}userMemoryText/);
  assert.match(html, /\{ role: 'system', content: systemPrompt \}/);
});
