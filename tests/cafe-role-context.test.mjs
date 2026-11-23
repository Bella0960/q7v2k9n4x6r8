import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-003 · 咖啡馆角色上下文（fail-closed）契约
 *
 * 分三类验证：
 *   A. 段落过滤：世界书与「其他 App 已有数据」整段丢弃，其余按预算保留。
 *   B. 真实共享模块 + 假存储的跨角色隔离：用未改动的 shared/js/phone/phone_context.js
 *      验证角色 A 的上下文里不出现角色 B 的记忆/聊天/世界书/财务，且 A 自己的世界书也不进入
 *      （共享模块目前不做按角色绑定筛选，应用侧必须 fail-closed）。
 *   C. 预算：超长段落整段丢弃，不从中间截断，也不把「来源有该段」当成「已注入」。
 *
 * 这是源码级行为测试，不是浏览器 E2E；不验证模型实际回复质量。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const cafe = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');
const contextModule = readFileSync(resolve(root, 'shared/js/phone/phone_context.js'), 'utf8');

function slice(from, to) {
  const start = cafe.indexOf(from);
  assert.ok(start >= 0, 'marker not found: ' + from);
  const end = cafe.indexOf(to, start);
  assert.ok(end > start, 'marker not found: ' + to);
  return cafe.slice(start, end);
}

const cafeHelpers = slice('var CAFE_CONTEXT_BUDGET', '\nfunction inferPartnerStyle(');

function fakeStorage() {
  const characters = [{ id: 'A', name: '阿岚' }, { id: 'B', name: '白露' }];
  return {
    getCharacters: () => characters,
    getWorldbooks: () => [
      { title: 'A专属设定', entries: [{ name: '秘密', content: 'A_ROLE_ONLY_WORLDBOOK', injectMode: 'always' }] },
      { title: 'B专属设定', entries: [{ name: '秘密', content: 'B_ROLE_ONLY_WORLDBOOK', injectMode: 'always' }] },
    ],
    getMemories: (id) => [{ content: id === 'A' ? 'A_ROLE_ONLY_MEMORY' : 'B_ROLE_ONLY_MEMORY' }],
    getChatHistory: (id) => [{ role: 'user', content: id === 'A' ? 'A_ROLE_ONLY_CHAT' : 'B_ROLE_ONLY_CHAT' }],
    getMoments: () => [
      { authorId: 'A', content: 'A_ROLE_ONLY_MOMENT' },
      { authorId: 'B', content: 'B_ROLE_ONLY_MOMENT' },
    ],
    getFinanceRecords: () => [{ title: 'B_ROLE_ONLY_FINANCE', amount: -9 }],
  };
}

/* 用未改动的真实共享模块构建上下文 */
function realContext(id, appId, storage) {
  const window = { PhoneStorage: storage };
  const sandbox = { window, String, Date, Math, Object, JSON, isFinite, parseInt, Number };
  vm.createContext(sandbox);
  vm.runInContext(contextModule, sandbox);
  return window.PhoneContext.buildPhoneRoleContext(id, appId);
}

function makeSandbox({ role, storage = fakeStorage(), noContext, throwing, raw } = {}) {
  const window = {
    PhoneStorage: storage,
    PhoneContext: noContext
      ? undefined
      : {
          buildPhoneRoleContext: (id, appId) => {
            if (throwing) throw new Error('boom');
            return raw === undefined ? realContext(id, appId, storage) : raw;
          },
        },
  };
  const sandbox = {
    window,
    role: role === undefined ? { id: 'A', name: '阿岚', personality: '安静' } : role,
    nameOf: (r) => (r && r.name) || '搭档',
    String,
  };
  vm.createContext(sandbox);
  vm.runInContext(cafeHelpers, sandbox);
  return sandbox;
}

test('A. 世界书与其他 App 快照整段丢弃，其余段落保留', () => {
  const sandbox = makeSandbox();
  const raw = [
    '【角色人设】', '姓名：阿岚',
    '', '【世界书 · 生活背景】', '【A专属设定 · 秘密】', 'A_ROLE_ONLY_WORLDBOOK',
    '', '【世界书的自然使用原则】', '不要逐条背诵。',
    '', '【长期记忆】', 'MEM_MARK',
    '', '【其他 App 已有数据】', '【钱包/财务】最近 1 条：', '• B_ROLE_ONLY_FINANCE -9元',
    '', '【当前设备时间】', '2026-11-23',
  ].join('\n');
  const built = sandbox.cafeContextBuild(raw);

  assert.ok(built.text.includes('姓名：阿岚'));
  assert.ok(built.text.includes('MEM_MARK'));
  assert.ok(built.text.includes('2026-11-23'));
  for (const forbidden of ['A_ROLE_ONLY_WORLDBOOK', '不要逐条背诵', 'B_ROLE_ONLY_FINANCE']) {
    assert.equal(built.text.includes(forbidden), false, 'unsafe section leaked: ' + forbidden);
  }
  assert.equal(built.text.includes('世界书'), false, 'worldbook section header must not survive');
  assert.ok(built.dropped.length >= 3, 'dropped sections must be reported, not silently ignored');
});

test('B. 真实共享模块下角色 A 的上下文不含 B 的任何数据，也不含世界书', () => {
  const sandbox = makeSandbox({ role: { id: 'A', name: '阿岚' } });
  const text = sandbox.roleContextBlock();

  assert.ok(text.includes('A_ROLE_ONLY_MEMORY'), 'own memory missing');
  assert.ok(text.includes('A_ROLE_ONLY_CHAT'), 'own chat missing');
  for (const leaked of ['B_ROLE_ONLY_MEMORY', 'B_ROLE_ONLY_CHAT', 'B_ROLE_ONLY_FINANCE', 'B_ROLE_ONLY_MOMENT', '白露']) {
    assert.equal(text.includes(leaked), false, 'cross-role leak: ' + leaked);
  }
  for (const worldbook of ['A_ROLE_ONLY_WORLDBOOK', 'B_ROLE_ONLY_WORLDBOOK', 'A专属设定', 'B专属设定']) {
    assert.equal(text.includes(worldbook), false, 'worldbook must fail closed until role binding is enforced: ' + worldbook);
  }
});

test('B. 角色 B 只拿到自己的记忆，不出现 A 的内容', () => {
  const sandbox = makeSandbox({ role: { id: 'B', name: '白露' } });
  const text = sandbox.roleContextBlock();
  assert.ok(text.includes('B_ROLE_ONLY_MEMORY'));
  assert.equal(text.includes('A_ROLE_ONLY_MEMORY'), false);
  assert.equal(text.includes('A_ROLE_ONLY_CHAT'), false);
});

test('C. 超长段落整段丢弃，不从中间截断', () => {
  const sandbox = makeSandbox();
  const raw = [
    '【角色人设】', '姓名：阿岚',
    '', '【长期记忆】', 'MEM_MARK',
    '', '【近期聊天】', 'CHAT_HEAD' + '聊'.repeat(9000),
  ].join('\n');
  const built = sandbox.cafeContextBuild(raw);

  assert.ok(built.text.includes('MEM_MARK'), 'memory must survive a huge chat section');
  assert.equal(built.text.includes('CHAT_HEAD'), false, 'oversized section must be dropped whole');
  assert.ok(built.text.length <= 8000, 'budget exceeded: ' + built.text.length);
  assert.ok(built.dropped.includes('近期聊天'), 'dropped oversized section must be reported');
});

test('C. 预算内的人设段不会被丢掉', () => {
  const sandbox = makeSandbox();
  const built = sandbox.cafeContextBuild('【角色人设】\n姓名：阿岚');
  assert.equal(built.text, '【角色人设】\n姓名：阿岚');
});

test('D. 未知角色不调用共享上下文，回退角色卡', () => {
  const sandbox = makeSandbox({ role: { id: 'cafe-buddy', name: '店长搭档' } });
  assert.equal(sandbox.roleContextBlock(), '');
  const persona = sandbox.partnerPersonaText();
  assert.ok(persona.includes('角色名称：') && persona.includes('店长搭档'));
});

test('D. 占位错误、模块缺失、抛错都安全回退', () => {
  assert.equal(makeSandbox({ raw: '（未找到角色 ID=A，无法构建上下文）' }).roleContextBlock(), '');
  assert.equal(makeSandbox({ noContext: true }).roleContextBlock(), '');
  assert.equal(makeSandbox({ throwing: true }).roleContextBlock(), '', 'a throwing builder must not break the advisor');
});

test('E. 页面按依赖顺序加载共享上下文，两处提示词都走 fail-closed 版本', () => {
  const storageAt = cafe.indexOf('phone/phone_storage.js');
  const apiAt = cafe.indexOf('phone/phone_api.js');
  const contextAt = cafe.indexOf('phone/phone_context.js');
  assert.ok(storageAt > 0 && apiAt > storageAt && contextAt > apiAt, 'phone_context.js must load after phone_storage.js');

  const uses = cafe.match(/partnerPersonaText\(\)/g) || [];
  assert.ok(uses.length >= 3, 'both advisor prompts must use partnerPersonaText()');

  assert.equal(cafe.includes('.slice(0,8000)'), false, 'blind head truncation must be replaced by section-aware budgeting');
});
