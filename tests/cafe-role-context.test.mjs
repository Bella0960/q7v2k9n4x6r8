import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-003 · 咖啡馆角色上下文接入契约
 * 从 cafe/cafe.html 截取 roleContextBlock / partnerPersonaText / roleTraits 的真实实现，
 * 在隔离上下文执行，验证：
 *   - 只用正式角色 ID 调用 PhoneContext.buildPhoneRoleContext(id, 'cafe')
 *   - 未知角色、异常、占位返回一律回退到角色卡字段，不污染提示词
 *   - 上下文长度有上限
 * 这是源码级行为测试，不是浏览器 E2E，也不验证模型实际回复质量。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

function between(from, to) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, 'marker not found: ' + from);
  const end = source.indexOf(to, start);
  assert.ok(end > start, 'marker not found: ' + to);
  return source.slice(start, end);
}

const helpers =
  between('function roleContextBlock(', 'function partnerPersonaText(') +
  between('function partnerPersonaText(', '\nfunction inferPartnerStyle(');

function makeSandbox(options = {}) {
  const calls = [];
  const characters = options.characters || [{ id: 'role-1', name: '林夏' }];
  const sandbox = {
    role: options.role === undefined ? { id: 'role-1', name: '林夏', personality: '安静', prompt: '你是林夏' } : options.role,
    nameOf: (r) => (r && r.name) || '搭档',
    window: {
      PhoneStorage: {
        getCharacters: () => characters,
      },
      PhoneContext: options.noContext
        ? undefined
        : {
            buildPhoneRoleContext: (id, appId) => {
              calls.push([id, appId]);
              if (options.throws) throw new Error('boom');
              return options.contextText === undefined ? '【世界书 · 生活背景】\n她怕苦，习惯双份奶。' : options.contextText;
            },
          },
    },
    String,
  };
  sandbox.window.PhoneStorage = sandbox.window.PhoneStorage;
  vm.createContext(sandbox);
  vm.runInContext(helpers, sandbox);
  return { sandbox, calls };
}

test('用正式角色 ID 请求统一上下文，并注入到人设文本', () => {
  const { sandbox, calls } = makeSandbox();
  const block = sandbox.roleContextBlock();

  assert.deepEqual(calls, [['role-1', 'cafe']], 'must request context with the official role id and the cafe app id');
  assert.ok(block.includes('双份奶'), 'worldbook content missing from the context block');

  const persona = sandbox.partnerPersonaText();
  assert.ok(persona.startsWith('以下是该角色的正式档案'), 'persona must explain how to use the context');
  assert.ok(persona.includes('双份奶'), 'persona lost the character context');
});

test('未知角色不会调用统一上下文，回退角色卡字段', () => {
  const { sandbox, calls } = makeSandbox({ role: { id: 'cafe-buddy', name: '店长搭档' } });
  assert.equal(sandbox.roleContextBlock(), '');
  assert.equal(calls.length, 0, 'context must not be requested for a role missing from the character list');

  const persona = sandbox.partnerPersonaText();
  assert.ok(persona.includes('角色名称：'), 'fallback persona must come from the character card');
  assert.ok(persona.includes('店长搭档'));
});

test('PhoneContext 返回占位错误时不进入提示词', () => {
  const { sandbox } = makeSandbox({ contextText: '（未找到角色 ID=role-1，无法构建上下文）' });
  assert.equal(sandbox.roleContextBlock(), '');
  assert.ok(sandbox.partnerPersonaText().includes('角色名称：'));
});

test('上下文缺失或抛错时安全回退', () => {
  const noContext = makeSandbox({ noContext: true });
  assert.equal(noContext.sandbox.roleContextBlock(), '');

  const throwing = makeSandbox({ throws: true });
  assert.equal(throwing.sandbox.roleContextBlock(), '', 'a throwing context builder must not break the advisor');
});

test('超长上下文被截断到上限', () => {
  const { sandbox } = makeSandbox({ contextText: 'x'.repeat(9000) });
  assert.equal(sandbox.roleContextBlock().length, 8000);
});

test('页面按依赖顺序加载统一上下文模块，且两处建议都使用它', () => {
  const storageAt = source.indexOf('phone/phone_storage.js');
  const apiAt = source.indexOf('phone/phone_api.js');
  const contextAt = source.indexOf('phone/phone_context.js');
  assert.ok(storageAt > 0 && apiAt > storageAt && contextAt > apiAt, 'phone_context.js must load after phone_storage.js');

  const uses = source.match(/partnerPersonaText\(\)/g) || [];
  assert.ok(uses.length >= 3, 'both advisor prompts must use partnerPersonaText() (definition + two call sites)');
  assert.ok(!/角色资料：'\+roleTraits\(\)/.test(source), 'decline prompt still bypasses the shared context');
});
