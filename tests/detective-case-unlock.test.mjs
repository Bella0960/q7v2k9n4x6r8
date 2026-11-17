import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

/**
 * 侦探档案室「完成上一案后解锁」回归测试。
 *
 * 历史 Bug：games.html 里 <script id="maomao-case-closed-fullscreen-v12-script">
 * 是一段独立的顶层脚本，它直接调用主 IIFE 内部定义的 caseProgress()。跨 <script>
 * 作用域拿不到该函数 → 抛 ReferenceError → 被空 catch 吞掉 → completed 被当成空数组。
 * 该脚本又把 refreshArchiveStatuses 挂在 document.body 的 MutationObserver 上，
 * 于是每次 startCase() 刚解锁的卡片都会被立刻重新算回「锁定 / 完成上一案后解锁」，
 * 表现为：案件01 显示「可调查」而不是「✓ 已结案」，案件02 永远点不进去。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gamesHtml = readFileSync(resolve(root, 'games/games.html'), 'utf8');

/* ---------- 源码提取工具 ---------- */

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `未找到函数定义：${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name} 括号未闭合`);
}

function extractCases(src) {
  const start = src.indexOf('var CASES=[');
  assert.notEqual(start, -1, '未找到 CASES 定义');
  const end = src.indexOf('];', start);
  return src.slice(start, end + 2);
}

/** 截取某个独立的 <script id="..."> 标签内部的 JS */
function extractScriptBlockById(src, id) {
  const marker = `<script id="${id}">`;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `未找到 script 标签：${id}`);
  const bodyStart = start + marker.length;
  const end = src.indexOf('</script>', bodyStart);
  return src.slice(bodyStart, end);
}

/* ---------- 用户浏览器实际 localStorage 快照（来自 BUG-REPORT） ---------- */

const USER_DATA = {
  maomao_game_role: 'role_3',
  maomao_detective_progress_v1: JSON.stringify({
    role_3: {
      completed: [0],
      attempts: {},
      notes: { '潮汐档案室的最后一夜': { result: 'solved', day: '2026-10-29', legacy: true } },
      campaign: { trust: {}, flags: [], threads: [], choices: [] }
    },
    'default-partner': {
      completed: [0],
      notes: {
        '潮汐档案室的最后一夜': {
          result: 'solved', day: '2026-10-29', suspect: '贺知远', evidence: 7, source: 'immersive'
        }
      },
      attempts: {},
      campaign: { trust: {}, flags: [], threads: [], choices: [] }
    }
  }),
  immCasesDone: JSON.stringify([0]),
  maomao_detective_team_v1: JSON.stringify(['role_3', 'role_1', 'role_2'])
};

function makeStorage(seed) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map
  };
}

/** 在沙箱里重建主脚本的案件进度相关函数 */
function buildProgressScope({ seed, roleId }) {
  const storage = makeStorage(seed);
  const sources = [
    extractCases(gamesHtml),
    `var activeRole = ${JSON.stringify({ id: roleId })};`,
    extractFunction(gamesHtml, 'caseProgressRoot'),
    extractFunction(gamesHtml, 'activeRoleKey'),
    extractFunction(gamesHtml, 'caseProgress'),
    extractFunction(gamesHtml, 'healCaseProgress'),
    extractFunction(gamesHtml, 'caseSolvedIndexes'),
    extractFunction(gamesHtml, 'isCaseSolved'),
    extractFunction(gamesHtml, 'readSolvedIndexesFromStorage'),
    extractFunction(gamesHtml, 'saveCaseProgress')
  ].join('\n');
  const sandbox = { localStorage: storage };
  runInNewContext(sources, sandbox);
  // 顶层 var/function 声明会挂到 vm 的全局对象上
  return { storage, api: sandbox };
}

/** 档案室卡片解锁判定：完全复刻 games.html 里两处地图/disabled 的判定公式 */
function computeCards(solved, total) {
  const cards = [];
  for (let i = 0; i < total; i += 1) {
    const done = solved.indexOf(i) >= 0;
    const locked = i > 0 && solved.indexOf(i - 1) < 0;
    cards.push({
      index: i,
      done,
      locked,
      disabled: locked,
      status: done ? '✓ 已结案' : locked ? '完成上一案后解锁' : i === 0 ? '可调查' : '待调查'
    });
  }
  return cards;
}

/** vm 沙箱里产生的数组属于另一个 realm，跨 realm 的 deepEqual 会因原型不同而失败 */
const toLocalArray = (value) => JSON.parse(JSON.stringify(value));

/* ---------- 用例 ---------- */

test('01 用户实际数据：案件02 解锁、案件01 显示已结案', () => {
  const { api } = buildProgressScope({ seed: USER_DATA, roleId: 'role_3' });
  const solved = toLocalArray(api.caseSolvedIndexes());
  assert.deepEqual([...solved], [0], '已结案列表应为 [0]');
  assert.equal(api.isCaseSolved(0), true, '案件01 应判定为已结案');

  const cards = computeCards(solved, api.CASES.length);
  assert.equal(cards[0].status, '✓ 已结案', '案件01 状态文字错误');
  assert.equal(cards[0].disabled, false);
  assert.equal(cards[1].locked, false, '案件02 不应该被锁定');
  assert.equal(cards[1].disabled, false, '案件02 按钮不应该 disabled');
  assert.equal(cards[1].status, '待调查');
  assert.equal(cards[2].locked, true, '案件03 仍应保持锁定（案件02 未破）');
});

test('02 角色 key 漂移：沉浸式把进度写进 default-partner 时仍能解锁', () => {
  // immersive-v21.js 曾因跨 IIFE 读不到 activeRole，永远把结案写进 'default-partner' 槽。
  const seed = {
    maomao_game_role: 'role_3',
    maomao_detective_progress_v1: JSON.stringify({
      'default-partner': {
        completed: [0],
        notes: { '潮汐档案室的最后一夜': { result: 'solved', source: 'immersive' } }
      }
    }),
    immCasesDone: JSON.stringify([0])
  };
  const { api } = buildProgressScope({ seed, roleId: 'role_3' });
  const solved = api.caseSolvedIndexes();
  assert.ok(solved.indexOf(0) >= 0, '应通过 immCasesDone 合并把案件01 记为已结案');
  assert.equal(computeCards(solved, api.CASES.length)[1].disabled, false);
});

test('03 notes 自愈：结案记录只在 notes 里、completed 为空时也能解锁', () => {
  const seed = {
    maomao_game_role: 'role_3',
    maomao_detective_progress_v1: JSON.stringify({
      role_3: {
        completed: [],
        notes: { '潮汐档案室的最后一夜': { result: 'solved', day: '2026-10-29' } }
      }
    }),
    immCasesDone: JSON.stringify([])
  };
  const { api } = buildProgressScope({ seed, roleId: 'role_3' });
  assert.deepEqual([...api.caseSolvedIndexes()], [0]);
  assert.equal(computeCards(api.caseSolvedIndexes(), api.CASES.length)[1].disabled, false);
});

test('04 兜底读取：不依赖主 IIFE 也能从 localStorage 还原已结案列表', () => {
  const { api } = buildProgressScope({ seed: USER_DATA, roleId: 'role_3' });
  const solved = [...api.readSolvedIndexesFromStorage()];
  assert.deepEqual(solved, [0]);
  // 这个函数供主 IIFE 之外的脚本使用，不能依赖 IIFE 内部任何闭包变量以外的东西
  const cards = computeCards(solved, api.CASES.length);
  assert.equal(cards[1].disabled, false);
});

test('05 外部刷新脚本不再静默失败：拿到真实进度并正确设置 disabled', () => {
  // 直接执行 games.html 里那段独立的 <script id="maomao-case-closed-fullscreen-v12-script">
  const source = extractScriptBlockById(gamesHtml, 'maomao-case-closed-fullscreen-v12-script');
  const storage = makeStorage(USER_DATA);

  /** 伪造 .case-archive-item 卡片 DOM */
  function makeCard(index) {
    const statusEl = { textContent: '' };
    return {
      _i: index,
      disabled: false,
      classes: new Set(),
      classList: {
        add(c) { this._o.classes.add(c); },
        remove(c) { this._o.classes.delete(c); }
      },
      getAttribute() { return String(this._i); },
      querySelector() { return statusEl; },
      statusEl
    };
  }
  const cards = [makeCard(0), makeCard(1), makeCard(2)];
  cards.forEach((c) => { c.classList._o = c; });

  let observerCallback = null;
  class MutationObserver {
    constructor(cb) { observerCallback = cb; }
    observe() {}
  }

  const win = { caseSolvedIndexes: () => [0] };
  const documentStub = {
    body: {},
    addEventListener() {},
    querySelectorAll: () => cards
  };
  const sandbox = { document: documentStub, MutationObserver, localStorage: storage, window: win };
  runInNewContext(source, sandbox);

  assert.ok(observerCallback, '应注册 MutationObserver');
  observerCallback(); // 等价于 startCase() 渲染后 DOM 变更触发的一次刷新

  assert.equal(cards[0].disabled, false, '案件01 应可点击');
  assert.match(cards[0].statusEl.textContent, /已结案/, `案件01 状态文字异常：${cards[0].statusEl.textContent}`);
  assert.equal(cards[1].disabled, false, '案件02 不应被 disabled');
  assert.equal(cards[1].statusEl.textContent, '待调查', '案件02 状态文字异常');
  assert.equal(cards[2].disabled, true, '案件03 应保持锁定');
});

test('06 外部脚本兜底：主脚本未暴露接口时（旧版/加载顺序异常）依然不退化', () => {
  const source = extractScriptBlockById(gamesHtml, 'maomao-case-closed-fullscreen-v12-script');
  const storage = makeStorage(USER_DATA);

  function makeCard(index) {
    const statusEl = { textContent: '' };
    const card = {
      _i: index, disabled: false, classes: new Set(), statusEl,
      getAttribute() { return String(this._i); },
      querySelector() { return statusEl; }
    };
    card.classList = { add(c) { card.classes.add(c); }, remove(c) { card.classes.delete(c); } };
    return card;
  }
  const cards = [makeCard(0), makeCard(1), makeCard(2)];
  let observerCallback = null;
  class MutationObserver {
    constructor(cb) { observerCallback = cb; }
    observe() {}
  }
  // 关键：window 上什么都没有，模拟「主脚本还没执行 / 未导出」
  const sandbox = {
    document: { body: {}, addEventListener() {}, querySelectorAll: () => cards },
    MutationObserver,
    localStorage: storage,
    window: {}
  };
  runInNewContext(source, sandbox);
  observerCallback();

  // 兜底路径依赖 window.readSolvedIndexesFromStorage；没有它时应照实判定为未结案，
  // 但绝不能抛出未捕获异常，也不能假装成功。
  assert.equal(cards[0].disabled, false, '案件01 永远可调查');
  assert.equal(cards[1].disabled, true, '拿不到进度时保守锁定');
});

/** 去掉纯注释行，避免源码里的中文说明误伤守卫断言 */
function stripLineComments(src) {
  return src.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

test('07 源码守卫：外部脚本不得再直接调用 IIFE 内部未导出的 caseProgress()', () => {
  const mainEnd = gamesHtml.indexOf('window.roleList=roleList;');
  assert.notEqual(mainEnd, -1, '未找到主 IIFE 导出段');
  const external = stripLineComments(gamesHtml.slice(mainEnd));
  assert.doesNotMatch(
    external,
    /\bcaseProgress\s*\(\s*\)/,
    '外部 script 标签里出现了裸调用 caseProgress()，会抛 ReferenceError 并被空 catch 吞掉'
  );
  // 主脚本必须把解锁判定接口暴露出去
  ['window.caseProgress=', 'window.caseSolvedIndexes=', 'window.activeRoleKey=',
    'window.readSolvedIndexesFromStorage='].forEach((token) => {
    assert.ok(gamesHtml.includes(token), `缺少导出：${token}`);
  });
});

test('08 沉浸式结案入口不再恒写 default-partner', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  assert.ok(
    immersive.includes('window.activeRoleKey'),
    'detectiveProgressKey 应先取主脚本暴露的 activeRoleKey'
  );
  assert.ok(
    immersive.includes("localStorage.getItem('maomao_game_role')"),
    'activeRoleKey 不可用时至少要用 localStorage 里记录的当前角色'
  );
  assert.doesNotMatch(
    immersive,
    /typeof activeRole !== 'undefined'/,
    '仍在引用跨 IIFE 拿不到的 activeRole 变量'
  );
});

test('10 案件02 现场配图：不再沿用案件01 的档案室图', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  assert.match(
    gamesHtml,
    /index===1\?'<img class="scene-real-image" src="assets\/hotel-corridor-17-v22\.jpg"/,
    '自由调查现场的案件02 应引用走廊配图'
  );
  assert.ok(
    existsSync(resolve(root, 'games/assets/hotel-corridor-17-v22.jpg')),
    '缺少资源文件 games/assets/hotel-corridor-17-v22.jpg'
  );
  // 沉浸式流程的两处配图（开场背景、现场页）都必须按案件取图
  assert.ok(immersive.includes('function sceneImageFor('), '沉浸式缺少按案件取图的 sceneImageFor');
  assert.ok(
    immersive.includes("return 'assets/hotel-corridor-17-v22.jpg'"),
    'sceneImageFor 未返回案件02 的走廊图'
  );
  assert.ok(immersive.includes('var openingImg = sceneImageFor('), '开场背景未走 sceneImageFor');
  assert.ok(immersive.includes('var sceneImg = sceneImageFor('), '现场页配图未走 sceneImageFor');
  // 不允许再出现「非案件01 也写死档案室图」
  const opening = immersive.slice(
    immersive.indexOf('function tplOpening()'),
    immersive.indexOf('/* ---------- 共用内联样式片段')
  );
  assert.doesNotMatch(
    opening,
    /tidal-archive-room-v21\.jpg/,
    '开场模板里仍写死了案件01 的配图'
  );
});

test('11 现场热点坐标：任意证据条数都不重叠（案件02 有 8 条）', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  // 不得再用 spots[i % spots.length] 复用坐标（注释里的说明不算，先去掉注释行）
  assert.doesNotMatch(
    stripLineComments(immersive),
    /spots\[i % spots\.length\]/,
    '热点坐标仍在取模复用，证据数超过坐标数时会完全重叠、有热点永远点不到'
  );

  // 取出 sceneSpots 与其预设坐标表，实跑验证
  const constStart = immersive.indexOf('var SCENE_SPOTS');
  assert.notEqual(constStart, -1, '未找到 SCENE_SPOTS 预设坐标表');
  const constSrc = immersive.slice(constStart, immersive.indexOf(';', constStart) + 1);
  const fnSrc = extractFunction(immersive, 'sceneSpots');
  const sandbox = {};
  runInNewContext(constSrc + '\n' + fnSrc, sandbox);
  const sceneSpots = sandbox.sceneSpots;
  assert.equal(typeof sceneSpots, 'function');

  for (let n = 1; n <= 16; n += 1) {
    const spots = sceneSpots(n);
    assert.equal(spots.length, n, `sceneSpots(${n}) 数量不对`);
    spots.forEach((p, i) => {
      assert.ok(p && p.length === 2, `sceneSpots(${n})[${i}] 结构异常`);
      assert.ok(p[0] >= 0 && p[0] <= 100 && p[1] >= 0 && p[1] <= 100, `坐标越界：${p}`);
    });
    const keys = new Set(spots.map((p) => p.join(',')));
    assert.equal(keys.size, n, `sceneSpots(${n}) 存在完全重合的热点`);
    // 相邻热点也要留出可点击间距（按钮 34px ≈ 宽 10% / 高 9%）
    for (let i = 0; i < spots.length; i += 1) {
      for (let j = i + 1; j < spots.length; j += 1) {
        const dx = Math.abs(spots[i][0] - spots[j][0]);
        const dy = Math.abs(spots[i][1] - spots[j][1]);
        assert.ok(dx >= 10 || dy >= 9, `sceneSpots(${n}) 第 ${i + 1} 与第 ${j + 1} 个热点挨得太近`);
      }
    }
  }
  // 案件02 实际是 8 条证据，必须给到 8 个互不重叠的位置
  const casesSandbox = {};
  const cs = gamesHtml.indexOf('var CASES=[');
  runInNewContext(gamesHtml.slice(cs, gamesHtml.indexOf('];', cs) + 2), casesSandbox);
  const case02 = casesSandbox.CASES[1];
  assert.equal(case02.evidence.length, 8, '案件02 证据条数已变化，请同步更新本用例');
  assert.equal(new Set(sceneSpots(case02.evidence.length).map((p) => p.join(','))).size, 8);
});

test('12 勘查完毕后自动推进到下一步，且每局只自动跳一次', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  assert.ok(immersive.includes('function armSceneAutoAdvance('), '缺少现场自动推进逻辑');
  assert.ok(immersive.includes('function clearSceneAutoTimer('), '缺少定时器清理');
  assert.ok(immersive.includes('syncSceneAutoAdvance();'), 'render 之后未同步自动推进状态');
  assert.ok(immersive.includes('IMM.step = 3; // 3 = 人物'), '未推进到「见相关人员」');
  // 必须楼上有 sceneAdvanced 一次性开关，避免回到现场页被反复弹走
  assert.ok(immersive.includes('sceneAdvanced: false'), 'IMM 缺少 sceneAdvanced 字段');
  assert.ok(immersive.includes('if (IMM.sceneAdvanced) return;'), '缺少一次性推进开关');
  // 退出沉浸式时要清定时器
  const restore = immersive.slice(immersive.indexOf('function restoreShell()'));
  assert.ok(restore.slice(0, 200).includes('clearSceneAutoTimer()'), '退出沉浸式未清理定时器');
  // 只有「现场」这一步才播广告式推进
  assert.ok(immersive.includes("if (IMM.step !== 1) { clearSceneAutoTimer(); return; }"), '非现场步骤应取消定时器');
});

test('13 盘问按剧本分人物出题，不再是所有人共用一套问句', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  const code = stripLineComments(immersive);

  // 旧的通用问句/通用答复必须彻底删掉
  assert.doesNotMatch(code, /三年前那次事故/, '仍在用案件01 的「三年前那次事故」通用问句');
  assert.doesNotMatch(code, /safeReplies/, '仍在用所有人共用的通用答复数组');

  // 取出剧本表与取单函数
  const start = immersive.indexOf('var INTERROGATION_SCRIPTS');
  assert.notEqual(start, -1, '未找到 INTERROGATION_SCRIPTS');
  const end = immersive.indexOf('\n  };', start);
  const scriptBlock = immersive.slice(start, end + 5);
  const fnSrc = extractFunction(immersive, 'interrogationEntries');

  const casesSb = {};
  const cs = gamesHtml.indexOf('var CASES=[');
  runInNewContext(gamesHtml.slice(cs, gamesHtml.indexOf('];', cs) + 2), casesSb);
  const CASES = casesSb.CASES;

  const sandbox = { c: () => ({}), };

  function entriesFor(caseIndex, suspectIndex) {
    Object.assign(sandbox, {});
    const ctx = { c: () => CASES[caseIndex] };
    runInNewContext(scriptBlock + '\n' + fnSrc, ctx);
    return ctx.interrogationEntries(suspectIndex);
  }

  // 每个案件的每个人都要有得可问
  CASES.forEach((kase, ci) => {
    kase.suspects.forEach((s, si) => {
      const entries = entriesFor(ci, si);
      assert.ok(entries.length > 0, `${kase.title} / ${s.name} 没有任何可问的问题`);
      entries.forEach((e) => {
        assert.ok(e.q && e.a, `${kase.title} / ${s.name} 的回答或问句为空`);
      });
    });
  });

  // 写了剧本的案件：三个人物的问句必须互不相同
  const case02 = CASES.findIndex((x) => x.title === '走廊尽头的17号房');
  assert.notEqual(case02, -1);
  const sets = CASES[case02].suspects.map((s, si) =>
    entriesFor(case02, si).map((e) => e.q).join('|')
  );
  assert.equal(new Set(sets).size, 3, '写了剧本的案件里，三个证人的问句仍然重复');
  // 三个人的回答也各不相同
  const answers = CASES[case02].suspects.map((s, si) =>
    entriesFor(case02, si).map((e) => e.a).join('|')
  );
  assert.equal(new Set(answers).size, 3, '三个证人的答复仍然重复');

  // 剧本内容要对得上：问句必须引用本案真实存在的证据/人物关系
  const allQ = entriesFor(case02, 0).map((e) => e.q + e.a).join('')
    + entriesFor(case02, 1).map((e) => e.q + e.a).join('')
    + entriesFor(case02, 2).map((e) => e.q + e.a).join('');
  ['林伟', '周茂才', '陈建斌', '老陈', '23 点 12 分', '蒸笼'].forEach((token) => {
    assert.ok(allQ.includes(token), `盘问剧本里缺少关键设定：${token}`);
  });

  // 没写剧本的案件退化为「用本案证据出题」，问句要跟本案有关
  const other = CASES.findIndex((x) => x.title !== '走廊尽头的17号房');
  const fallback = entriesFor(other, 0);
  assert.ok(fallback.length > 0, '未写剧本的案件也要有问句');
  fallback.forEach((e, i) => {
    assert.ok(
      e.q.includes(CASES[other].evidence[i].title),
      '兜底问句应当引用本案自己的证据标题'
    );
  });

  // 渲染与答复都必须走 interrogationEntries
  const tpl = immersive.slice(
    immersive.indexOf('function tplInterrogate()'),
    immersive.indexOf('/* ---------- 06 推理板')
  );
  assert.ok(tpl.includes('interrogationEntries(si)'), '盘问页没有按剧本渲染问题按钮');
  assert.doesNotMatch(tpl, /var qs = \[/, '盘问页仍在写死通用问题数组');
  assert.ok(
    immersive.includes('var entry = interrogationEntries(IMM.activeSuspect)'),
    'handleQuestion 没有改用剧本答复'
  );
});

test('14 第三个案件：午夜列车的第四位乘客已就位', () => {
  const casesSb = {};
  const cs = gamesHtml.indexOf('var CASES=[');
  runInNewContext(gamesHtml.slice(cs, gamesHtml.indexOf('];', cs) + 2), casesSb);
  const CASES = casesSb.CASES;
  const kase = CASES[2];
  assert.equal(kase.title, '午夜列车的第四位乘客', '第 3 槽不是新案件');
  assert.equal(kase.answer, 0, '真凶下标应为 0（胡国柱）');
  assert.equal(kase.suspects.length, 3);
  assert.equal(kase.suspects[kase.answer].name, '胡国柱');
  assert.ok(kase.evidence.length >= 8, `证据条数偏少：${kase.evidence.length}`);
  ['intro', 'story', 'motive', 'truth', 'aftermath', 'explain'].forEach((f) => {
    assert.ok(kase[f] && String(kase[f]).length > 20, `缺少结案字段 ${f}`);
  });
  // 核心诡计要在证据/真相里体现
  const blob = JSON.stringify(kase);
  ['02:15', '渌口', '23:48', '01:20', '胡德厚'].forEach((token) => {
    assert.ok(blob.includes(token), `案件内容缺少关键设定：${token}`);
  });

  // 证词表同步
  const ivSb = {};
  const is = gamesHtml.indexOf('var CASE_INTERVIEWS=');
  runInNewContext(gamesHtml.slice(is, gamesHtml.indexOf('function caseProgressRoot')), ivSb);
  const names = ivSb.CASE_INTERVIEWS[2].map((x) => x.title).join('|');
  ['胡国柱', '文珊珊', '老周'].forEach((n) => {
    assert.ok(names.includes(n), `证词表缺少 ${n}`);
  });
  assert.doesNotMatch(names, /陈女士|林同学/, '旧案件证词未清干净');

  // 配图
  assert.ok(
    existsSync(resolve(root, 'games/assets/midnight-train-berth-v23.jpg')),
    '缺少列车包厢配图'
  );
  assert.match(
    gamesHtml,
    /index===2\?'<img class="scene-real-image" src="assets\/midnight-train-berth-v23\.jpg"/,
    '自由调查现场未引用列车配图'
  );
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  assert.ok(
    immersive.includes("if (idx === 2) return 'assets/midnight-train-berth-v23.jpg';"),
    '沉浸式场景图未接上列车配图'
  );
  assert.ok(
    /'午夜列车的第四位乘客':\s*\{/.test(immersive),
    '新案件没有专属盘问剧本'
  );
  assert.ok(gamesHtml.includes('scene-art-train'), '缺少 scene-art-train 场景样式类');
  // 自由调查现场的坐标表要够新案件用，不能出现取模重叠
  const spotsMatch = gamesHtml.match(/spots=\[\[23,43[\s\S]*?\]\];/);
  assert.ok(spotsMatch, '未找到自由调查现场坐标表');
  const spotCount = (spotsMatch[0].match(/\],\[/g) || []).length + 1;
  assert.ok(
    spotCount >= kase.evidence.length,
    `坐标点 ${spotCount} 个 < 证据 ${kase.evidence.length} 条，会重叠导致线索点不到`
  );
});

test('15 槽位替换后，旧存档中被顶掉的通关状态会被迁移清掉', () => {
  const fnSrc = extractFunction(gamesHtml, 'migrateReplacedCaseSlots');
  const store = new Map([
    ['maomao_detective_progress_v1', JSON.stringify({
      role_3: {
        completed: [0, 1, 2],
        notes: { '图书馆的借书卡': { result: 'solved' }, '走廊尽头的17号房': { result: 'solved' } },
        caseStates: { '图书馆的借书卡': { revealed: {} } }
      }
    })],
    ['immCasesDone', JSON.stringify([0, 1, 2])]
  ]);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  const ctx = { localStorage };
  runInNewContext(fnSrc, ctx);
  ctx.migrateReplacedCaseSlots();

  const saved = JSON.parse(store.get('maomao_detective_progress_v1'));
  assert.deepEqual([...saved.role_3.completed], [0, 1], '第 3 槽的旧通关状态未被清掉');
  assert.equal(saved.role_3.notes['图书馆的借书卡'], undefined, '旧案件笔记未清除');
  assert.ok(saved.role_3.notes['走廊尽头的17号房'], '不该误删其它案件的笔记');
  assert.equal(saved.role_3.caseStates['图书馆的借书卡'], undefined, '旧案件调查状态未清除');
  assert.deepEqual(JSON.parse(store.get('immCasesDone')), [0, 1], 'immCasesDone 未清理');
  assert.equal(store.get('maomao_detective_slot_remap_v1'), '1', '迁移标记未写入');
});

test('09 Service Worker 导航：缓存优先 + 后台更新，且不使用桌面页作兜底', () => {
  const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
  const nav = sw.slice(sw.indexOf("req.mode === 'navigate'"));
  const cachedIndex = nav.indexOf('caches.match(req)');
  const networkIndex = nav.indexOf('fetch(req)');
  assert.ok(cachedIndex !== -1 && networkIndex !== -1, '未找到导航缓存与网络处理逻辑');
  assert.ok(cachedIndex < networkIndex, '导航应先读缓存，让已缓存页面立即打开');
  assert.ok(nav.includes('if (cached) return cached;'), '缓存命中时必须立即返回缓存页面');
  assert.ok(nav.includes('event.waitUntil(updatePromise'), '网络更新必须在后台继续完成');
  assert.ok(
    nav.includes("return new Response('此页面暂时无法连接"),
    '缓存与网络均不可用时应返回明确的离线提示'
  );
  assert.doesNotMatch(nav, /caches\.match\('\.\/index\.html'\)/, '不得用桌面 index.html 作为其它应用的兜底');
  assert.match(sw, /const CACHE_NAME = 'phone-app-pwa-v\d+';/, '缓存版本必须保持递增');
});

/* ==================== GAME-UNLOCK-001 回归补充 ====================
 * 结案写入与解锁读取必须是同一份真实数据：
 * A. 角色隔离——全局遗留镜像不得把 A 的结案持久化进 B 的存档；
 * B. 历史兼容——从未玩过的角色仍可通过遗留镜像继承旧记录；
 * C. 不假成功——写入失败（抛错/静默丢弃）必须返回 false 并如实提示；
 * D. immersive——不再写全局镜像，结案庆祝以保存结果为门控；
 * E. 缓存——SW 版本与脚本引用版本必须一起升级，否则用户拿不到修复。
 * ---------------------------------------------------------------- */

test('16 角色隔离：已有自己进度的角色不会被全局遗留镜像放大或串档', () => {
  // role_2 自己只结案了案件01；role_3 结案了 01+02；全局遗留 immCasesDone=[0,1,2]。
  const seed = {
    maomao_game_role: 'role_2',
    maomao_detective_progress_v1: JSON.stringify({
      role_3: { completed: [0, 1], notes: { '潮汐档案室的最后一夜': { result: 'solved', source: 'immersive' } } },
      role_2: { completed: [0], notes: { '潮汐档案室的最后一夜': { result: 'solved' } } }
    }),
    immCasesDone: JSON.stringify([0, 1, 2])
  };
  const { api, storage } = buildProgressScope({ seed, roleId: 'role_2' });
  const solved = toLocalArray(api.caseSolvedIndexes());
  assert.deepEqual([...solved], [0], 'role_2 只应看到自己的进度，不应吸收全局镜像里的 1、2');
  const cards = computeCards(solved, api.CASES.length);
  assert.equal(cards[1].done, false, 'role_2 未结案案件02');
  assert.equal(cards[1].locked, false, 'role_2 已结案案件01，案件02 应对其解锁');
  assert.equal(cards[2].locked, true, '案件03 对 role_2 保持锁定');

  // 存档不被污染：heal + save 之后 role_2.completed 仍是 [0]，role_3 原样保留
  api.saveCaseProgress(api.healCaseProgress(api.caseProgress()));
  const saved = JSON.parse(storage.getItem('maomao_detective_progress_v1'));
  assert.deepEqual([...toLocalArray(saved.role_2.completed)], [0], 'role_2 的存档被全局镜像污染了');
  assert.deepEqual([...toLocalArray(saved.role_3.completed)], [0, 1], 'role_3 的存档不应被改动');
});

test('17 遗留兜底：从未玩过的角色可继承旧版全局记录（历史合法存档兼容）', () => {
  const seed = {
    maomao_game_role: 'role_9',
    maomao_detective_progress_v1: JSON.stringify({ role_3: { completed: [0] } }),
    immCasesDone: JSON.stringify([0, 1])
  };
  const { api, storage } = buildProgressScope({ seed, roleId: 'role_9' });
  const solved = toLocalArray(api.caseSolvedIndexes());
  assert.deepEqual([...solved], [0, 1], '没有自己进度的角色应通过遗留镜像解锁 01、02');
  assert.equal(computeCards(solved, api.CASES.length)[2].disabled, false, '案件03 应解锁');
  // 兜底合并结果会持久化为该角色自己的记录，此后不再依赖全局镜像
  api.saveCaseProgress(api.healCaseProgress(api.caseProgress()));
  const saved = JSON.parse(storage.getItem('maomao_detective_progress_v1'));
  assert.deepEqual([...toLocalArray(saved.role_9.completed)], [0, 1], '兜底结果应写为角色自己的记录');
});

/** 与 buildProgressScope 相同的函数集合，便于换用不同 localStorage 桩 */
function progressScopeSources() {
  return [
    extractCases(gamesHtml),
    `var activeRole = ${JSON.stringify({ id: 'role_3' })};`,
    extractFunction(gamesHtml, 'caseProgressRoot'),
    extractFunction(gamesHtml, 'activeRoleKey'),
    extractFunction(gamesHtml, 'caseProgress'),
    extractFunction(gamesHtml, 'healCaseProgress'),
    extractFunction(gamesHtml, 'caseSolvedIndexes'),
    extractFunction(gamesHtml, 'isCaseSolved'),
    extractFunction(gamesHtml, 'readSolvedIndexesFromStorage'),
    extractFunction(gamesHtml, 'saveCaseProgress')
  ].join('\n');
}

test('18 存储写入失败不假成功：saveCaseProgress 必须返回 false（含静默丢弃）', () => {
  // 18a：setItem 直接抛错（配额满 / 隐私模式拦截）
  const throwing = {
    _map: new Map(),
    getItem: function (k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem: function () { throw new Error('QuotaExceededError'); },
    removeItem: function (k) { this._map.delete(k); }
  };
  const sb1 = { localStorage: throwing };
  runInNewContext(progressScopeSources(), sb1);
  assert.equal(sb1.saveCaseProgress(sb1.caseProgress()), false, '写入抛错时必须返回 false');
  assert.equal(throwing.getItem('maomao_detective_progress_v1'), null, '失败时不得留下半截数据');

  // 18b：setItem 假成功（写入后读回不一致，如隐私模式静默丢弃）
  const silent = {
    _map: new Map(),
    getItem: function (k) { return this._map.has(k) ? this._map.get(k) : null; },
    setItem: function (k, v) { this._map.set(k, 'x' + String(v)); },
    removeItem: function (k) { this._map.delete(k); }
  };
  const sb2 = { localStorage: silent };
  runInNewContext(progressScopeSources(), sb2);
  assert.equal(sb2.saveCaseProgress(sb2.caseProgress()), false, '读回不一致时必须返回 false');

  // 18c：正常写入返回 true
  const ok = makeStorage({});
  const sb3 = { localStorage: ok };
  runInNewContext(progressScopeSources(), sb3);
  assert.equal(sb3.saveCaseProgress(sb3.caseProgress()), true, '正常写入应返回 true');
});

test('19 immersive 结案：按角色写入、不再写全局镜像、失败返回 false', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  const casesSb = {};
  const cs = gamesHtml.indexOf('var CASES=[');
  runInNewContext(gamesHtml.slice(cs, gamesHtml.indexOf('];', cs) + 2), casesSb);
  const CASES = casesSb.CASES;

  function buildRecordSandbox(storage) {
    const ctx = {
      localStorage: storage,
      window: {},
      console: { warn() {} },
      IMM: { caseIndex: 0, accusation: 1, revealed: { 0: true, 1: true } },
      c: () => CASES[0]
    };
    runInNewContext(extractFunction(immersive, 'detectiveProgressKey'), ctx);
    runInNewContext(extractFunction(immersive, 'recordSolvedCaseInArchive'), ctx);
    return ctx;
  }

  // 19a：成功路径——写进当前角色槽，且不碰全局 immCasesDone
  const store = makeStorage({ immCasesDone: JSON.stringify([0]) });
  const ctx = buildRecordSandbox(store);
  assert.equal(ctx.recordSolvedCaseInArchive(), true, '正常写入应返回 true');
  const saved = JSON.parse(store.getItem('maomao_detective_progress_v1'));
  assert.ok(saved['default-partner'], '无 window.activeRoleKey 时按兜底 key（当前角色）写入');
  assert.deepEqual([...toLocalArray(saved['default-partner'].completed)], [0]);
  assert.equal(saved['default-partner'].notes[CASES[0].title].suspect, CASES[0].suspects[1].name, '结案笔记应记录被指认者');
  assert.deepEqual(JSON.parse(store.getItem('immCasesDone')), [0], '不得再写全局 immCasesDone 镜像');

  // 19b：失败路径——setItem 抛错时返回 false，不假装结案成功
  const throwing = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {}
  };
  const ctx2 = buildRecordSandbox(throwing);
  assert.equal(ctx2.recordSolvedCaseInArchive(), false, '写入失败必须返回 false');
});

test('20 immersive 迁移：遗留进度写入失败时不落 marker，下次仍会重试', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  const casesSb = {};
  const cs = gamesHtml.indexOf('var CASES=[');
  runInNewContext(gamesHtml.slice(cs, gamesHtml.indexOf('];', cs) + 2), casesSb);

  function buildMigrateSandbox(storage) {
    const ctx = {
      localStorage: storage,
      window: { CASES: casesSb.CASES },
      console: { warn() {} },
      detectiveProgressKey: () => 'role_3'
    };
    runInNewContext(extractFunction(immersive, 'migrateLegacyImmersiveProgress'), ctx);
    return ctx;
  }

  // 成功：迁移写入 + 落 marker
  const okStore = makeStorage({ immCasesDone: JSON.stringify([0]) });
  buildMigrateSandbox(okStore).migrateLegacyImmersiveProgress();
  const migrated = JSON.parse(okStore.getItem('maomao_detective_progress_v1'));
  assert.deepEqual([...toLocalArray(migrated.role_3.completed)], [0]);
  assert.equal(okStore.getItem('maomao_detective_immersive_progress_migrated_v1'), '1');

  // 失败：setItem 抛错 → marker 不落，下次载入重试
  const throwing = {
    getItem: (k) => (k === 'immCasesDone' ? JSON.stringify([0]) : null),
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {}
  };
  buildMigrateSandbox(throwing).migrateLegacyImmersiveProgress();
  assert.equal(throwing.getItem('maomao_detective_immersive_progress_migrated_v1'), null, '迁移失败时不得写 marker');
});

test('21 源码守卫：immersive 不再写全局镜像，结案庆祝以保存结果为门控', () => {
  const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
  const code = stripLineComments(immersive);
  assert.doesNotMatch(code, /localStorage\.setItem\(\s*'immCasesDone'/, 'immersive 不得再写全局 immCasesDone');
  assert.ok(
    code.includes('var progressSaved = correct ? recordSolvedCaseInArchive() : true;'),
    '结案渲染必须以保存结果为门控'
  );
  assert.ok(code.includes("progressSaved ? '已结案' : '未归档'"), '保存失败时不得盖「已结案」章');
  assert.match(code, /结案进度保存失败：浏览器存储暂时不可用/, '保存失败必须给用户明确提示');
  // 角标按角色进度判定
  const tagStart = immersive.indexOf('function tagArchive()');
  assert.notEqual(tagStart, -1, '未找到 tagArchive');
  const tag = stripLineComments(immersive.slice(tagStart));
  assert.ok(tag.includes('window.caseSolvedIndexes'), '角标应优先使用按角色的 caseSolvedIndexes');
  assert.doesNotMatch(tag, /immCasesDone/, '角标不得再读全局 immCasesDone');
});

test('22 缓存一致性：SW 版本升级且 games.html 引用新的 immersive 脚本版本', () => {
  const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
  const m = sw.match(/const CACHE_NAME = 'phone-app-pwa-v(\d+)';/);
  assert.ok(m, '未找到 CACHE_NAME');
  assert.ok(
    Number(m[1]) >= 206,
    `SW 缓存版本必须 ≥ v206（当前 v${m[1]}），否则已安装用户拿不到修复后的 games.html`
  );
  const q = gamesHtml.match(/js\/immersive-v21\.js\?v=(\d+)/);
  assert.ok(q, 'games.html 未引用带版本号的 immersive 脚本');
  assert.ok(Number(q[1]) >= 50, `immersive 脚本引用版本必须 ≥ 50（当前 v${q[1]}）`);
});

test('23 档案室与经典结案：先保存后渲染/庆祝，失败必须可见', () => {
  const startFn = extractFunction(gamesHtml, 'startCase');
  assert.match(startFn, /if\(!saveCaseProgress\(progress\)\)showToast\(/, 'startCase 必须在保存失败时给出 toast');
  assert.ok(
    startFn.indexOf('saveCaseProgress(progress)') < startFn.indexOf('var solved=progress.completed.slice()'),
    '渲染数据必须以保存后的存储状态为准'
  );

  const verdictIdx = gamesHtml.indexOf('var caseSaved=saveCaseProgress(progress)');
  assert.notEqual(verdictIdx, -1, '经典结案必须先保存并校验结果');
  const verdictLine = gamesHtml.slice(verdictIdx, gamesHtml.indexOf('\n', verdictIdx));
  const celebrateIdx = verdictLine.indexOf('showCaseClosedCelebration(c.title');
  assert.ok(celebrateIdx > -1, '保存成功后应庆祝结案');
  assert.ok(celebrateIdx > verdictLine.indexOf('if(caseSaved){'), '庆祝必须发生在保存成功分支内');
  assert.match(verdictLine, /结案进度保存失败/, '经典结案保存失败必须如实提示');
  assert.match(verdictLine, /showCaseStoryReveal\(c\)/, '庆祝回调仍应展示完整真相');
});
