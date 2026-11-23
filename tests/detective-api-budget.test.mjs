import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-GAMES-002 · 侦探新案生成的付费调用预算契约
 * 从 games/games.html 截取真实实现，在隔离上下文跑真实 generateDetectiveCase：
 * 一次确认=最多一次请求、失败不自动重试且计入预算、达上限不发请求、跨日重置、切角色不串写。
 * 全部使用 mock，不产生任何真实付费请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'games/games.html'), 'utf8');

const block = (() => {
  const start = page.indexOf('/* ===== 侦探新案生成：付费调用预算');
  const end = page.indexOf('function installFloatingInvestigationTools(');
  assert.ok(start > 0 && end > start, 'detective budget block not found');
  return page.slice(start, end);
})();

const VALID_CASE = {
  title: '雨夜的第七码头',
  chapter: '第一章',
  intro: '雨停之前，没有人离开过仓库。',
  evidence: ['湿透的伞', '打卡记录', '半截车票', '录音笔'],
  suspects: [{ name: '甲', desc: '仓管' }, { name: '乙', desc: '司机' }, { name: '丙', desc: '会计' }],
  answer: 1,
  explain: '车票时间与口供矛盾。',
};

function makeStore(seed = {}) {
  const raw = { ...seed };
  let quota = false;
  return {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      raw[k] = String(v);
    },
    removeItem: (k) => { delete raw[k]; },
    failWrites: (flag) => { quota = flag; },
    raw,
  };
}

function makeRuntime({ store, confirmAnswer = true, aiBehavior = 'resolve', saveWorks = true }) {
  const toasts = [];
  const calls = [];
  const confirms = [];
  const pending = [];
  const sandbox = {
    localStorage: store,
    activeRole: { id: 'roleA', name: '阿岚' },
    CASES: [],
    detectiveGenToken: 0,
    detectiveGenBusy: false,
    detectiveGenFailed: false,
    detectiveBudgetCache: null,
    byId: () => ({ textContent: '', disabled: false }),
    showToast: (t) => toasts.push(t),
    confirm: (msg) => { confirms.push(msg); return confirmAnswer; },
    warnGameStorage: (m) => toasts.push(m),
    saveJSON: (key, value, quiet) => {
      if (!saveWorks) return false;
      try { store.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    detectiveTeam: () => [{ id: 'roleA', name: '阿岚' }],
    detectivePersona: () => '阿岚；性格：温柔',
    JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = { getApiConfig: () => ({ apiKey: 'test-key' }) };
  sandbox.PhoneAPI = {
    complete: () => {
      calls.push(Date.now());
      if (aiBehavior === 'reject') return Promise.reject(new Error('请求超时（45000ms）'));
      if (aiBehavior === 'hang') return new Promise((r) => pending.push(r));
      return Promise.resolve(JSON.stringify(VALID_CASE));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, toasts, calls, confirms, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

test('默认每天上限 3 次，且初始显示剩余 3', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });
  assert.equal(sb.DETECTIVE_DAILY_LIMIT, 3);
  assert.equal(sb.detectiveRemaining(), 3);
});

test('用户取消：0 请求、0 扣次数', () => {
  const store = makeStore();
  const { sb, calls, confirms } = makeRuntime({ store, confirmAnswer: false });

  sb.generateDetectiveCase();
  assert.equal(confirms.length, 1, 'must ask before spending');
  assert.ok(confirms[0].includes('付费 AI 接口') && confirms[0].includes('失败也可能产生费用'), 'confirm copy must state the cost risk');
  assert.equal(calls.length, 0);
  assert.equal(sb.detectiveRemaining(), 3);
});

test('一次确认 = 恰好一次请求，成功后扣 1 次', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(sb.detectiveRemaining(), 2);
  assert.equal(JSON.parse(store.raw.maomao_detective_gen_budget_v1).roleA.used, 1);
  assert.equal(sb.CASES.length, 1);
});

test('快速连点：只发 1 次请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store, aiBehavior: 'hang' });

  sb.generateDetectiveCase();
  sb.generateDetectiveCase();
  sb.generateDetectiveCase();
  assert.equal(calls.length, 1, 'double tap must not spend extra calls');
  assert.equal(sb.detectiveRemaining(), 2, 'only one attempt is charged');
});

test('失败不自动重试，但仍计入预算', async () => {
  const store = makeStore();
  const { sb, calls, toasts } = makeRuntime({ store, aiBehavior: 'reject' });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 1, 'must never auto-retry a failed paid call');
  assert.equal(sb.detectiveRemaining(), 2, 'failed attempts still consume budget');
  assert.ok(toasts.some((t) => t.includes('不会自动重试')), 'user must be told there is no auto retry');
  assert.equal(sb.CASES.length, 0);
});

test('达到上限后 0 请求，并说明是仅本机限制', async () => {
  const store = makeStore();
  const { sb, calls, toasts } = makeRuntime({ store });
  sb.detectiveBudgetCache = { day: sb.detectiveDayKey(), owner: 'roleA', used: 3 };

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0);
  assert.ok(toasts.some((t) => t.includes('已用完') && t.includes('本机')), 'must not pretend it is a server-side quota');
});

test('跨日自动重置（刷新也无法绕过当天计数）', () => {
  const store = makeStore({
    maomao_detective_gen_budget_v1: JSON.stringify({ roleA: { day: '2020-01-01', used: 3 } }),
  });
  const { sb } = makeRuntime({ store });
  assert.equal(sb.detectiveRemaining(), 3, 'a new day resets the counter');
});

test('当天计数已落盘，刷新后不会归零', () => {
  const store = makeStore();
  const first = makeRuntime({ store });
  first.sb.detectiveBudgetCache = { day: first.sb.detectiveDayKey(), owner: 'roleA', used: 2 };
  first.sb.consumeDetectiveBudget();

  const second = makeRuntime({ store });   // 模拟刷新：新的运行环境，同一份存储
  assert.equal(second.sb.detectiveRemaining(), 0, 'reload must keep charging the same day');
});

test('角色/账号隔离：A 用完不影响 B', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });
  sb.detectiveBudgetCache = { day: sb.detectiveDayKey(), owner: 'roleA', used: 3 };
  assert.equal(sb.detectiveRemaining(), 0);

  sb.activeRole = { id: 'roleB', name: '白露' };
  assert.equal(sb.detectiveRemaining(), 3, 'budget must be per role/account');
});

test('切角色后旧结果不写入：不串角色、不弹成功', async () => {
  const store = makeStore();
  const { sb, pending, toasts } = makeRuntime({ store, aiBehavior: 'hang' });

  sb.generateDetectiveCase();
  assert.equal(pending.length, 1);

  sb.activeRole = { id: 'roleB', name: '白露' };
  sb.detectiveGenToken++;             // selectRole 会做同样的事
  pending[0](JSON.stringify(VALID_CASE));
  await flush();

  assert.equal(sb.CASES.length, 0, 'stale response must not be added to the archive');
  assert.equal(toasts.some((t) => t.includes('已加入案件档案')), false, 'must not claim success for a stale response');
});

test('存盘失败不谎报「加入档案」', async () => {
  const store = makeStore();
  const { sb, toasts } = makeRuntime({ store, saveWorks: false });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(toasts.some((t) => t.includes('已加入案件档案')), false);
  assert.ok(toasts.some((t) => t.includes('没能存下')), 'must state that it will not survive a refresh');
});

test('预算落盘失败时明确提示并仍按本机内存继续限制', async () => {
  const store = makeStore();
  const { sb, toasts, calls } = makeRuntime({ store, saveWorks: false });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 1);
  assert.ok(toasts.some((t) => t.includes('刷新后可能重置')), 'must disclose that the local limit may reset');
  assert.equal(sb.detectiveRemaining(), 2, 'in-session counting must keep working');
});

test('无 API 配置时 0 请求、不扣次数', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.PhoneStorage = { getApiConfig: () => ({ apiKey: '' }) };

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(sb.detectiveRemaining(), 3);
});

test('源码守卫：预算常量、确认与零重试都在实现里', () => {
  assert.ok(page.includes('var DETECTIVE_DAILY_LIMIT=3;'), 'daily limit must be an explicit constant');
  assert.ok(page.includes('maomao_detective_gen_budget_v1'), 'budget must be persisted locally');
  assert.ok(page.includes('今日剩余'), 'remaining count must be visible');
  assert.equal(/retry|重试并自动|setTimeout\([^)]*generateDetectiveCase/.test(block), false, 'no automatic retry path');
});
