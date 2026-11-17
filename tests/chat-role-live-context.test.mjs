import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const script = read('shared/js/phone/chat-role-context.js');
const detail = read('chat/chat/chat-detail.html');
const sandbox = { window: {} };
runInNewContext(script, sandbox);
const policy = sandbox.window.MAOMAOChatRoleContext;

test('每轮读取同一角色ID的最新人设，不替换成其他角色或修改旧数据', () => {
  const old = { id: 'role_r1', persona: '安静寡言', lifeLine: '经营一间书店' };
  const fresh = { id: 'role_r1', persona: '清冷但细心', tone: '慢条斯理', lifeLine: '店里正在修缮', lifeEvents: [{ title: '周六修书架', status: 'planned' }] };
  const original = JSON.stringify(old);
  assert.equal(policy.resolveRole('role_r1', old, id => id === 'role_r1' ? fresh : null), fresh);
  assert.equal(policy.resolveRole('role_r1', old, () => ({ id: 'role_other', persona: '其他人' })), old);
  assert.equal(policy.resolveRole('role_r1', old, () => { throw new Error('storage unavailable'); }), old);
  assert.equal(JSON.stringify(old), original);
});

test('普通邂逅角色的错误 AI 自述只在模型上下文排除，旧聊天记录完整保留', () => {
  const role = { encounterOrigin: { version: 1, species: '人类', trait: '温柔克制' } };
  const history = [
    { mid: 'm1', role: 'user', text: '你叫什么名字？' },
    { mid: 'm2', role: 'assistant', text: '我叫阮映雪。' },
    { mid: 'm3', role: 'assistant', text: '作为一个人工智能，我的家就在云端。' },
    { mid: 'm4', role: 'assistant', text: '刚才把官方设定吐出来了。' },
    { mid: 'm5', role: 'user', text: '你是 AI 吗？' }
  ];
  const snapshot = JSON.stringify(history);
  const result = policy.getModelHistory(history, role);
  assert.deepEqual(Array.from(result, item => item.mid), ['m1', 'm2', 'm5']);
  assert.equal(JSON.stringify(history), snapshot);
  assert.equal(policy.getModelHistory(history, { name: '旧角色' }), history);
});

test('明确设定为仿生人时不把合法身份当作错误；普通 AI 话题也不误删', () => {
  const history = [
    { role: 'assistant', text: '作为一个人工智能，我研究记忆。' },
    { role: 'assistant', text: '我今天看了一篇人工智能的报道。' }
  ];
  const synthetic = { encounterOrigin: { version: 1, species: '仿生人' } };
  const ordinary = { encounterOrigin: { version: 1, species: '人类' } };
  assert.equal(policy.getModelHistory(history, synthetic), history);
  assert.equal(policy.getModelHistory(history, ordinary).length, 1);
  assert.equal(policy.getModelHistory(history, ordinary)[0], history[1]);
});

test('角色的最新人设、说话习惯、生活线、记忆与邂逅来源进入同一轮请求', () => {
  assert.match(detail, /const roleForTurn = !isGroupChat/);
  assert.match(detail, /resolveRole\(currentCharacter\.id, currentCharacter, getRoleById\)/);
  assert.match(detail, /rawCurrentPersona = \(roleForTurn\.persona \|\| roleForTurn\.prompt/);
  assert.match(detail, /var relationshipRole = isGroupChat[\s\S]*?: roleForTurn/);
  assert.match(detail, /buildCharacterSocialPrompt\(relationshipRole\)/);
  assert.match(detail, /role\.lifeLine/);
  assert.match(detail, /role\.lifeEvents/);
  assert.match(detail, /roleForTurn\.memory/);
  assert.match(detail, /buildEncounterIdentityContext\(roleForTurn\)/);
  assert.match(detail, /MAOMAOChatRoleContext\.getModelHistory\(historyList, roleForTurn\)/);
  assert.match(detail, /selectRecentHistory\(roleModelHistory, memoryLimit\)/);
  assert.match(detail, /buildHistoricalRecallText\(recallableHistory, recallQuery, recallOptions\)/);
  assert.match(detail, /roleModelHistory !== historyList \? null : cachedVoiceProfile/);
});

test('全局世界书保持可用，只有当前角色和会话绑定的局部世界书参与单聊', () => {
  const books = [
    { id: 'global_1', scope: 'global', title: '通用世界' },
    { id: 'local_a', scope: 'local', title: '角色A秘密' },
    { id: 'local_b', scope: 'local', title: '角色B经历' },
    { id: 'legacy_1', title: '旧版未分类世界书' }
  ];
  const original = JSON.stringify(books);
  const a = { id: 'role_a', worldBookIds: ['local_a'] };
  assert.deepEqual(
    Array.from(policy.selectWorldbooksForRole(books, a, []), b => b.id),
    ['global_1', 'local_a', 'legacy_1']);
  assert.deepEqual(
    Array.from(policy.selectWorldbooksForRole(books, a, ['local_b']), b => b.id),
    ['global_1', 'local_a', 'local_b', 'legacy_1']);
  assert.deepEqual(
    Array.from(policy.selectWorldbooksForRole(books, { id: 'role_c' }, []), b => b.id),
    ['global_1', 'legacy_1']);
  assert.equal(JSON.stringify(books), original, '过滤不得改写原始世界书');
  assert.match(detail, /MAOMAOChatRoleContext\.selectWorldbooksForRole\(/);
  assert.match(detail, /wbList, roleForTurn, roleMountedIds/);
});

test('旧邂逅档案的编辑器说明不进入模型；保留全部真实人物设定原文', () => {
  const role = { id: 'enc_1', encounterOrigin: { version: 1, species: '人类' } };
  const saved = [
    '【基础资料】阮映雪｜女｜24岁｜人类',
    '【世界背景】现代都市；身份：书店店主',
    '【命运线索】曾离开故乡多年',
    '【创作说明】以上为简要原创设定。正式聊天前可在角色档案补全经历、习惯、动机与表达方式。'
  ].join('\n');
  const cleaned = policy.stripEncounterEditorNote(saved, role);
  assert.match(cleaned, /阮映雪/);
  assert.match(cleaned, /书店店主/);
  assert.match(cleaned, /曾离开故乡多年/);
  assert.doesNotMatch(cleaned, /【创作说明】/);
  assert.match(saved, /【创作说明】/, '历史档案不能被修改');
  assert.equal(policy.stripEncounterEditorNote(saved, { id: 'old' }), saved, '普通旧角色原样保留');
  assert.match(detail, /stripEncounterEditorNote\(rawCurrentPersona, roleForTurn\)/);
});

test('邂逅新角色默认档案不再把后台编辑说明当成人物背景', () => {
  const engine = read('encounter/encounter-engine.js');
  assert.doesNotMatch(engine, /'【创作说明】以上为简要原创设定。正式聊天前/);
  assert.match(engine, /【生活线索】/);
  assert.match(engine, /card\.job/);
  assert.match(engine, /card\.object/);
});
