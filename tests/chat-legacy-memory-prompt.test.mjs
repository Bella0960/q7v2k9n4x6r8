import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');
const raw = JSON.stringify([
  { text: 'UNOWNED' },
  { text: 'A_ONLY', sourceRoleId: 'role-a' },
  { content: 'B_ONLY', sourceRoleId: 'role-b' },
  { text: 'GROUP_SHARED', sourceRoleId: 'group-1' },
  null
]);
const block = html.slice(html.indexOf('let userMemoryText'), html.indexOf('// 长期记忆：权重分层'));
const promptSlot = html.match(/'【已经记录的用户信息】',\s*userMemoryText,/)[0];
const outbound = html.match(/\{ role: 'system', content: systemPrompt \}/g).at(-1);
assert.ok(html.includes('PhoneStream.chat({'));
for (const loadPolicy of [true, false]) {
  for (const [group, id, expected] of [
    [false, 'role-a', 'A_ONLY'], [false, 'role-b', 'B_ONLY'],
    [true, 'role-a', 'A_ONLY'], [true, 'role-b', 'B_ONLY'], [true, null, null]
  ]) {
    test(`legacy memory prompt: ${group ? 'group' : 'private'} ${id}, ${loadPolicy ? 'policy' : 'fallback'}`, () => {
      const env = {
        window: {}, isGroupChat: group,
        groupReplyPick: group && id ? { id } : null,
        aliasRoleId: group ? 'group-1' : id, currentRoleId: 'fallback',
        capText: (text, limit) => text.slice(0, limit),
        CTX_CAP: { userMemory: 2000 },
        localStorage: {
          getItem: key => { assert.equal(key, 'user_memory'); return raw; },
          setItem: () => assert.fail('memory read must not modify storage')
        }
      };
      if (loadPolicy) runInNewContext(policy, env);
      const message = runInNewContext(block + '\nconst systemPrompt = [' + promptSlot + '].join("\\n");\n(' + outbound + ')', env);
      assert.equal(message.role, 'system');
      for (const value of ['A_ONLY', 'B_ONLY', 'UNOWNED', 'GROUP_SHARED']) {
        assert.equal(message.content.includes(value), (value === expected || (value === 'UNOWNED' && !!id)), JSON.stringify({group, id, loadPolicy, value}));
      }
    });
  }
}
