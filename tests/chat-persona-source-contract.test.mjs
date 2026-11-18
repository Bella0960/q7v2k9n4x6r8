import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext, Script } from 'node:vm';

const read = name => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
const roleSource = read('../shared/js/phone/chat-role-context.js');
const loreSource = read('../shared/js/phone/chat-context-policy.js');
const page = read('../chat/chat/chat-detail.html');
const settings = read('../worldbook/settings/rp-protocol.html');
const sandbox = { window: {} };
runInNewContext(roleSource, sandbox);
runInNewContext(loreSource, sandbox);
const role = sandbox.window.MAOMAOChatRoleContext;
const lore = sandbox.window.ChatContextPolicy;

test('all direct/group requests require saved persona + RP protocol + activated lore in final system message', () => {
  const good = {
    role: { id: 'char_1', name: '任意人物' },
    persona: '生长在深圳，喜欢街巷摄影',
    protocol: '用户自己写的全局协议 {{char}}',
    expandedProtocol: '用户自己写的全局协议 任意人物',
    worldbook: '【深圳故事 · 街道】固定路线',
    worldbookPolicyReady: true,
    systemPrompt: '【角色档案】生长在深圳，喜欢街巷摄影\n用户自己写的全局协议 任意人物\n【深圳故事 · 街道】固定路线'
  };
  assert.equal(role.validatePersonaRequest(good).ok, true);
  for (const field of ['role', 'persona', 'protocol', 'worldbookPolicyReady']) {
    const bad = { ...good, [field]: field === 'worldbookPolicyReady' ? false : '' };
    assert.equal(role.validatePersonaRequest(bad).ok, false, field + ' must not silently fall back');
  }
  assert.equal(role.validatePersonaRequest({ ...good, systemPrompt: '生长在深圳，喜欢街巷摄影\n用户自己写的全局协议 任意人物' }).ok, false);
  assert.equal(role.validatePersonaRequest({ ...good, systemPrompt: '生长在深圳，喜欢街巷摄影\n【深圳故事 · 街道】固定路线' }).ok, false);
  assert.equal(role.validatePersonaRequest({ ...good, worldbook: '', systemPrompt: '生长在深圳，喜欢街巷摄影\n用户自己写的全局协议 任意人物' }).ok, true, 'no keyword match is valid');
});

test('local worldbooks never leak into another direct role or group; global lore remains available', () => {
  const books = [
    { id: 'global', title: '公共背景', scope: 'global', content: '所有人都知道的街道' },
    { id: 'a-local', title: '角色 A 私有', scope: 'local', content: '秘密 A' },
    { id: 'b-local', title: '角色 B 私有', scope: 'local', content: '秘密 B' }
  ];
  const direct = role.selectWorldbooksForRole(books, { id: 'a', worldBookIds: ['a-local'] }, []);
  assert.deepEqual(Array.from(direct, b => b.id), ['global', 'a-local']);
  const group = role.selectWorldbooksForGroup(books, ['b-local']);
  assert.deepEqual(Array.from(group, b => b.id), ['global', 'b-local']);
  assert.deepEqual(Array.from(role.selectWorldbooksForGroup(books, []), b => b.id), ['global']);
});

test('worldbook entries keep existing keyword/disabled activation semantics', () => {
  const books = [{
    id: 'global', title: '深圳', scope: 'global', entries: [
      { name: '出行', injectMode: 'keyword', keywords: ['罗湖'], content: '深圳罗湖的街道' },
      { name: '隐藏', injectMode: 'always', enabled: false, content: '不能进入模型' }
    ]
  }];
  const withoutTrigger = lore.buildWorldbookInjectionText(books, { currentText: '今天做什么？' });
  const withTrigger = lore.buildWorldbookInjectionText(books, { currentText: '今天去罗湖', maxEntries: 50 });
  assert.equal(withoutTrigger, '');
  assert.match(withTrigger, /深圳罗湖的街道/);
  assert.doesNotMatch(withTrigger, /不能进入模型/);
});

test('settings and both chat modes use one global user-authored protocol; fail closed before API', () => {
  assert.match(settings, /chat_rp_protocol_/);
  assert.match(page, /localStorage\.getItem\(globalRpKey\)/);
  assert.match(page, /\[aliasRoleId, currentCharacter && currentCharacter\.id, currentRoleId\]\.forEach/);
  assert.doesNotMatch(page, /\[aliasRoleId, currentCharacter && currentCharacter\.id, roleId\]\.forEach/);
  assert.match(page, /const savedSpeaker = isGroupChat[\s\S]*?getRoleById\(groupReplyPick\.id\)/);
  assert.match(page, /validatePersonaRequest\(\{/);
  assert.match(page, /expandedProtocol: applyProtocolVars\(rpProtocol\)/);
  assert.match(page, /worldbook: worldbookText/);
  assert.match(page, /if \(!personaAudit\.ok\) \{/);
  assert.match(page, /chat-role-context\.js\?v=20261118v4/);
  assert.match(page, /invalid worldbook collection/);
  assert.match(page, /invalid worldbook mounts/);
  assert.match(page, /worldbook mount read failed/);
  const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const main = scripts.find(s => s.includes('async function sendMsg(opts)'));
  assert.ok(main);
  assert.doesNotThrow(() => new Script(main));
});
