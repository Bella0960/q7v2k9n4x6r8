import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-NOVEL-001 · 小说工坊 AI 通道（novel/js/novel-ai.js + 七个调用页）
 * 重点回归：
 *  1. 独立页面必须真实加载 phone_storage.js / phone_api.js（源码级断言，不用 VM 注入代替）
 *  2. novelAI 必须走共享 PhoneAPI.complete + 共享配置，不得自建 fetch / 读旧 api_settings
 *  3. 对外错误文案与旧实现兼容（调用方零改动）
 * 全部 mock，不产生真实付费请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const aiSrc = readFileSync(resolve(root, 'novel/js/novel-ai.js'), 'utf8');

const AI_PAGES = [
  'novel.html', 'novel-bible.html', 'novel-continuity.html', 'novel-editor.html',
  'novel-planning.html', 'novel-readers.html', 'novel-setup.html',
];

function makeRuntime({ apiKey = 'test-key', behavior = 'resolve', reply = '生成的正文。', legacyKey = null, storageMissing = false } = {}) {
  const calls = [];
  const logs = [];
  const sandbox = {
    fetch: () => { throw new Error('不应使用自建 fetch'); },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout, clearTimeout,
    JSON, Object, String, Number, Date, Promise, Error, Math, console,
  };
  sandbox.window = sandbox;
  if (!storageMissing) {
    sandbox.PhoneStorage = {
      getApiConfig: () => (legacyKey !== null ? legacyKey : { apiKey, baseUrl: 'https://api.test/v1', model: 'test-model', temperature: 0.7 }),
      pushApiLog: (entry) => logs.push(entry),
    };
  } else {
    /* 模拟真实旧页面：什么都没加载 */
    sandbox.localStorage = { getItem: () => (legacyKey !== null ? JSON.stringify(legacyKey) : null) };
  }
  sandbox.PhoneAPI = {
    /* 真实 PhoneAPI.complete 自己写调用日志；此桩模拟已写入一条的共享层。
       novelAI() 适配层不能再重复记录。 */
    complete: (payload) => {
      calls.push(payload);
      const emit = (status) => {
        if (sandbox.PhoneStorage && typeof sandbox.PhoneStorage.pushApiLog === 'function') {
          sandbox.PhoneStorage.pushApiLog({ status, model: 'test-model' });
        }
      };
      if (behavior === 'reject-timeout') { emit('error'); return Promise.reject(new Error('请求超时（60000ms）')); }
      if (behavior === 'reject-http') { emit('error'); return Promise.reject(new Error('请求失败（HTTP 401）')); }
      if (behavior === 'reject-key') { emit('error'); return Promise.reject(new Error('API Key 无效或已过期')); }
      emit('success');
      return Promise.resolve(reply);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(aiSrc, sandbox);
  return { sb: sandbox, calls, logs };
}

test('配置缺失：抛出旧文案，0 次请求', async () => {
  const { sb, calls } = makeRuntime({ legacyKey: { apiKey: '', baseUrl: 'x', model: 'm' } });
  await assert.rejects(() => sb.novelAI('s', 'u'), /请先打开「设置 → API 设置」/);
  assert.equal(calls.length, 0);
});

test('真实旧环境（未加载共享脚本）：不再退回旧 api_settings 裸键', async () => {
  const { sb, calls } = makeRuntime({ storageMissing: true, legacyKey: { apiKey: 'legacy', baseUrl: 'https://old/v1', model: 'old' } });
  await assert.rejects(() => sb.novelAI('s', 'u'), /请先打开「设置 → API 设置」/);
  assert.equal(calls.length, 0, '旧裸键不能作为调用依据');
});

test('共享通道：走 PhoneAPI.complete，不自建 fetch，参数透传', async () => {
  const { sb, calls } = makeRuntime({});
  const out = await sb.novelAI('系统提示', '用户提示');
  assert.equal(out, '生成的正文。');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].system, '系统提示');
  assert.equal(calls[0].user, '用户提示');
  assert.equal(calls[0].temperature, 0.7);
  assert.equal(calls[0].timeoutMs, 60000, '60s 超时与旧实现一致');
});

test('调用日志仅由共享层记录：成功、失败各一条，不双计费统计', async () => {
  const ok = makeRuntime({});
  await ok.sb.novelAI('s', 'u');
  assert.equal(ok.logs.length, 1, '成功请求不能出现小说层重复成功日志');
  assert.equal(ok.logs[0].status, 'success');

  const bad = makeRuntime({ behavior: 'reject-timeout' });
  await assert.rejects(() => bad.sb.novelAI('s', 'u'), /AI 请求超时，请稍后重试/);
  assert.equal(bad.logs.length, 1, '失败请求不能出现小说层重复失败日志');
  assert.equal(bad.logs[0].status, 'error');
});

test('错误文案兼容：超时与配置类错误保持旧文案', async () => {
  const t = makeRuntime({ behavior: 'reject-timeout' });
  await assert.rejects(() => t.sb.novelAI('s', 'u'), /AI 请求超时，请稍后重试/);

  const k = makeRuntime({ behavior: 'reject-key' });
  await assert.rejects(() => k.sb.novelAI('s', 'u'), /请先打开「设置 → API 设置」/);

  const h = makeRuntime({ behavior: 'reject-http' });
  await assert.rejects(() => h.sb.novelAI('s', 'u'), /请求失败（HTTP 401）/, 'HTTP 错误透传共享通道原文');

  const e = makeRuntime({ behavior: 'resolve', reply: '   ' });
  await assert.rejects(() => e.sb.novelAI('s', 'u'), /模型返回内容为空/);
});

/* ---------- 真实脚本链（源码级，不用 VM 注入代替） ---------- */

test('七个调用页都必须真实加载 phone_storage.js 与 phone_api.js，且在 novel-ai.js 之前', () => {
  for (const p of AI_PAGES) {
    const page = readFileSync(resolve(root, 'novel/' + p), 'utf8');
    assert.ok(page.includes('shared/js/phone/phone_storage.js'), p + ' 必须加载共享存储');
    assert.ok(page.includes('shared/js/phone/phone_api.js'), p + ' 必须加载共享通道');
    const storageAt = page.indexOf('phone_storage.js');
    const apiAt = page.indexOf('phone_api.js');
    const aiAt = page.indexOf('js/novel-ai.js');
    assert.ok(storageAt > 0 && storageAt < aiAt, p + ' 的存储脚本必须在 novel-ai.js 之前');
    assert.ok(apiAt > 0 && apiAt < aiAt, p + ' 的通道脚本必须在 novel-ai.js 之前');
    assert.ok(page.includes('novelAI('), p + ' 确实调用了 novelAI');
  }
});

test('源码守卫：novel-ai.js 不再自建 fetch、不读旧键', () => {
  /* 注释里会提到 fetch / api_settings，判定必须只看代码 */
  const codeOnly = aiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/\bfetch\s*\(/.test(codeOnly), false, '必须复用共享通道');
  assert.equal(codeOnly.includes('api_settings'), false, '不得再读旧 api_settings 裸键');
  assert.ok(aiSrc.includes('PhoneAPI.complete'), '必须走共享通道');
  assert.ok(aiSrc.includes('getApiConfig'), '必须走共享配置');
  assert.equal(/pushApiLog\s*\(/.test(codeOnly), false, '调用日志由共享层负责，小说层不能重复写');
  assert.ok(aiSrc.includes('global.novelAI = novelAI'), '全局签名不变，调用方零改动');
});
