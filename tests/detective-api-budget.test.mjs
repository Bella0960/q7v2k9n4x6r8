import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-GAMES-002 · 侦探新案生成的付费调用预算契约
 * 从 games/games.html 截取真实实现，在隔离上下文跑真实 generateDetectiveCase：
 * 一次确认=最多一次请求、失败不自动重试且计入预算、达上限不发请求、跨日重置、
 * 限额按本机（不按角色）计算、生成的案件必须与运行时字段形状一致。
 * 全部使用 mock，不产生任何真实付费请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'games/games.html'), 'utf8');

const block = (() => {
  const start = page.indexOf('/* ===== 侦探新案生成：付费调用预算');
  const end = page.indexOf('function installFloatingInvestigationTools(');
  assert.ok(start > 0 && end > start, 'detective budget block not found');
  return page.slice(start, end);
})();

const repairBlock = (() => {
  const start = page.indexOf('function repairSavedDetectiveCase(c){');
  const end = page.indexOf('function detectiveTeamRoot(', start);
  assert.ok(start > 0 && end > start, 'saved-case repair block not found');
  return page.slice(start, end);
})();

/* 运行时真实形状：界面读 ev.title / ev.detail、suspect.name / suspect.job */
const VALID_CASE = {
  title: '雨夜的第七码头',
  chapter: '第一章',
  intro: '雨停之前，没有人离开过仓库。',
  evidence: [
    { title: '湿透的伞', detail: '伞面还滴着水，说明刚进过雨里。' },
    { title: '打卡记录', detail: '23:10 有一次出库打卡。' },
    { title: '半截车票', detail: '票根时间与口供对不上。' },
    { title: '录音笔', detail: '里面有一段未删掉的争执。' },
  ],
  suspects: [{ name: '甲', job: '仓管' }, { name: '乙', job: '司机' }, { name: '丙', job: '会计' }],
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

function makeRuntime({ store, confirmAnswer = true, aiBehavior = 'resolve', saveWorks = true, failKey = null, reply = null }) {
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
      if (!saveWorks || (failKey && key === failKey)) return false;
      try { store.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    detectiveTeam: () => [{ id: 'roleA', name: '阿岚' }],
    startCase: () => { sandbox.__startCaseCalls = (sandbox.__startCaseCalls || 0) + 1; },
    detectivePersona: () => '阿岚；性格：温柔',
    campaignBrief: () => '过往选择：旧案：选择 相信队长；结果 结案。持续伏笔：旧案留下：一枚旧钥匙。调查队信任记录：阿岚：2。',
    JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
  };
  sandbox.activeRoleKey = () => String((sandbox.activeRole && sandbox.activeRole.id) || 'default-partner');
  sandbox.window = sandbox;
  sandbox.PhoneStorage = { getApiConfig: () => ({ apiKey: 'test-key' }) };
  sandbox.PhoneAPI = {
    complete: (payload) => {
      calls.push(payload);
      if (aiBehavior === 'reject') return Promise.reject(new Error('请求超时（45000ms）'));
      if (aiBehavior === 'hang') return new Promise((r) => pending.push(r));
      return Promise.resolve(JSON.stringify(reply == null ? VALID_CASE : reply));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, toasts, calls, confirms, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

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

test('一次确认 = 恰好一次请求，成功后扣 1 次（按本机记账）', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(sb.detectiveRemaining(), 2);
  assert.equal(JSON.parse(store.raw.maomao_detective_gen_budget_v1).device.used, 1);
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
  sb.detectiveBudgetCache = { day: sb.detectiveDayKey(), owner: 'device', used: 3 };

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0);
  assert.ok(toasts.some((t) => t.includes('已用完') && t.includes('本机')), 'must not pretend it is a server-side quota');
});

/* ---------- P1-02：限额按本机，不按角色 ---------- */

test('P1-02 A 用满 3 次 → 切到 B 仍剩 0 次（角色不能刷新额度）', async () => {
  const store = makeStore();
  const { sb, calls, toasts } = makeRuntime({ store });

  sb.detectiveBudgetCache = { day: sb.detectiveDayKey(), owner: 'device', used: 3 };
  assert.equal(sb.detectiveRemaining(), 0);

  sb.activeRole = { id: 'roleB', name: '白露' };
  assert.equal(sb.detectiveRemaining(), 0, '换个角色不得凭空多出 3 次');

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0);
  assert.ok(toasts.some((t) => t.includes('已用完')));
});

test('P1-02 同机刷新：当天计数仍然生效', () => {
  const store = makeStore();
  const first = makeRuntime({ store });
  first.sb.detectiveBudgetCache = { day: first.sb.detectiveDayKey(), owner: 'device', used: 2 };
  first.sb.consumeDetectiveBudget();
  assert.equal(first.sb.detectiveRemaining(), 0);

  const second = makeRuntime({ store });    // 模拟刷新：新运行环境，同一份存储
  assert.equal(second.sb.detectiveRemaining(), 0, 'reload must keep charging the same day');
});

test('P1-02 跨日自动重置', () => {
  const store = makeStore({
    maomao_detective_gen_budget_v1: JSON.stringify({ device: { day: '2020-01-01', used: 3 } }),
  });
  const { sb } = makeRuntime({ store });
  assert.equal(sb.detectiveRemaining(), 3, 'a new day resets the counter');
});

test('P1-02 旧版按角色分桶的记录在升级当天仍计入，不会凭空重置', () => {
  const store = makeStore({
    maomao_detective_gen_budget_v1: JSON.stringify({ roleA: { day: today(), used: 3 } }),
  });
  const { sb } = makeRuntime({ store });
  assert.equal(sb.detectiveRemaining(), 0, '当天已花的钱不能在升级后被忘掉');
});

/* ---------- P1-01：案件结构与运行时一致 ---------- */

test('P1-01 生成的提示词要求对象证据、name+job 嫌疑人，并带上跨案主线记忆', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.generateDetectiveCase();
  await flush();

  const payload = calls[0];
  const all = String(payload.system || '') + '\n' + String(payload.user || '');
  assert.ok(/"evidence":\[\{"title"/.test(payload.system), 'system prompt must ask for object evidence');
  assert.ok(/"job"/.test(payload.system), 'system prompt must ask for suspect.job');
  assert.equal(/"evidence":\[""/.test(payload.system), false, 'must not ask for bare string evidence');
  assert.ok(String(payload.user).includes('跨案记忆'), 'user prompt must carry campaign memory');
  assert.ok(String(payload.user).includes('独立支持结论'), 'must keep the original quality requirements');
  assert.ok(all.includes('阿岚'), 'team persona still included');
});

test('P1-01 有效案件按真实字段存进档案，界面不会出现 undefined', async () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });
  sb.generateDetectiveCase();
  await flush();

  const saved = sb.CASES[0];
  assert.ok(saved.evidence.every((e) => e && e.title && e.detail));
  assert.ok(saved.suspects.every((s) => s && s.name && s.job));
  assert.equal(saved.answer, 1);
  assert.equal(saved.generated, true);
});

test('P1-01 字符串证据：拒绝存档、提示结构不合规、不额外计费重试', async () => {
  const store = makeStore();
  const bad = { ...VALID_CASE, evidence: ['湿透的伞', '打卡记录', '半截车票', '录音笔'] };
  const { sb, calls, toasts } = makeRuntime({ store, reply: bad });

  sb.generateDetectiveCase();
  await flush();

  assert.equal(calls.length, 1, '不允许为了补格式再花一次钱');
  assert.equal(sb.CASES.length, 0, '字符串证据不得入库');
  assert.ok(toasts.some((t) => t.includes('结构不合规')), 'must explain the shape failure');
  assert.equal(JSON.parse(store.raw.maomao_detective_generated_cases_v1 || '{"x":1}').x, 1, '未写入任何案件');
});

test('P1-01 嫌疑人缺 job：同样拒绝存档', async () => {
  const store = makeStore();
  const bad = { ...VALID_CASE, suspects: [{ name: '甲', desc: '仓管' }, { name: '乙', desc: '司机' }, { name: '丙', job: '会计' }] };
  const { sb, toasts } = makeRuntime({ store, reply: bad });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(sb.CASES.length, 0);
  assert.ok(toasts.some((t) => t.includes('结构不合规')));
});

test('P1-01 证据不足 4 条 / answer 越界：拒绝存档', async () => {
  const store = makeStore();
  for (const bad of [
    { ...VALID_CASE, evidence: VALID_CASE.evidence.slice(0, 2) },
    { ...VALID_CASE, answer: 5 },
    { ...VALID_CASE, suspects: VALID_CASE.suspects.slice(0, 2) },
  ]) {
    const { sb } = makeRuntime({ store, reply: bad });
    sb.generateDetectiveCase();
    await flush();
    assert.equal(sb.CASES.length, 0);
  }
});

test('P1-01 旧存档兜底：字符串证据/缺 job 的旧案仍可玩，不丢已付费内容', () => {
  const sandbox = { JSON, Object, String, Number, Array, Math, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(repairBlock, sandbox);

  const repaired = sandbox.repairSavedDetectiveCase({
    title: '旧案', intro: '旧案情',
    evidence: ['门禁记录', { title: '监控', detail: '23:12 有出入' }],
    suspects: ['甲', { name: '乙', desc: '司机' }],
    answer: 9, explain: '旧解释',
  });
  assert.ok(repaired);
  assert.equal(repaired.evidence[0].title, '门禁记录');
  assert.ok(repaired.evidence[0].detail.length > 0, 'missing detail must be filled so the UI never shows undefined');
  assert.equal(repaired.suspects[0].job, '身份未记录');
  assert.equal(repaired.suspects[1].job, '身份未记录');
  assert.equal(repaired.answer, 0, 'answer 越界时退回安全值');
  assert.equal(sandbox.repairSavedDetectiveCase({ title: '空案', evidence: [], suspects: [] }), null);
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
  /* 只让「案件存档」这一键失败：预算能正常记账（否则走 fail-closed，根本不会发请求） */
  const { sb, toasts } = makeRuntime({ store, failKey: 'maomao_detective_generated_cases_v1' });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(toasts.some((t) => t.includes('已加入案件档案')), false);
  assert.ok(toasts.some((t) => t.includes('没能存下')), 'must state that it will not survive a refresh');
});

test('总控 P1 续：保存成功后列表立即刷新，刚付费生成的案件立刻可见', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  const before = sb.__startCaseCalls || 0;
  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal((sb.__startCaseCalls || 0) > before, true, '成功保存后必须调用 startCase() 刷新');
});

/* 总控最新复审 P1：预算写入+读回确认成功才允许付费请求；失败 0 请求并释放 busy。 */
test('预算落盘失败：0 请求、释放 busy、明确提示', async () => {
  const store = makeStore();
  const { sb, toasts, calls } = makeRuntime({ store, saveWorks: false });

  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0, '预算写不进本机就绝不发付费请求');
  assert.equal(sb.detectiveGenBusy, false, '必须释放 busy，界面不能永久转圈');
  assert.ok(toasts.some((t) => t.includes('暂停生成新案')), '必须说明原因');
});

test('预算落盘失败：读回被改也视为失败（不只看有没有抛异常）', async () => {
  const raw = {};
  const store = {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => { raw[k] = String(v) + '!corrupted'; },   /* 读回不匹配 */
    removeItem: (k) => { delete raw[k]; },
    failWrites: () => {},
    raw,
  };
  const { sb, calls } = makeRuntime({ store });
  sb.generateDetectiveCase();
  await flush();
  assert.equal(calls.length, 0, '读回校验失败也必须 fail-closed');
});

test('预算落盘失败：模拟刷新后重试同样 0 请求', async () => {
  const store = makeStore({ saveWorks: true });
  const first = makeRuntime({ store, saveWorks: false });
  first.sb.generateDetectiveCase();
  await flush();
  assert.equal(first.calls.length, 0);

  const second = makeRuntime({ store, saveWorks: false });   // 模拟刷新
  second.sb.generateDetectiveCase();
  await flush();
  assert.equal(second.calls.length, 0, '刷新重入仍 fail-closed');
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

test('源码守卫：预算常量、确认、零重试、本机 scope 都在实现里', () => {
  assert.ok(page.includes('var DETECTIVE_DAILY_LIMIT=3;'), 'daily limit must be an explicit constant');
  assert.ok(page.includes('maomao_detective_gen_budget_v1'), 'budget must be persisted locally');
  assert.ok(page.includes('今日剩余'), 'remaining count must be visible');
  assert.ok(block.includes("function detectiveBudgetOwner(){return 'device';}"), '限额必须绑本机，不绑角色');
  assert.equal(/detectiveBudgetOwner\(\)\{return String\(activeRole/.test(block), false, '不得再按角色计费');
  assert.equal(/retry|重试并自动|setTimeout\([^)]*generateDetectiveCase/.test(block), false, 'no automatic retry path');
  assert.ok(block.includes('normalizeDetectiveCase'), 'must validate the case shape before saving');
});
