/* 复现：案件0沉浸式结案后，案件1为什么还锁着
 * 不读用户浏览器 localStorage，全部用内存存储。
 * 函数体直接抄自 games/games.html 与 games/js/immersive-v21.js，保持原逻辑。
 */

// ---- 模拟内存 localStorage ----
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// ---- 模拟全局对象 ----
const activeRole = { id: 'test-role-1', name: '测试搭档' };
const window = {
  CASES: [
    { title: '潮汐档案室的最后一夜', answer: 1 },
    { title: '走廊尽头的17号房', answer: 1 },
    { title: '图书馆的借书卡', answer: 2 },
  ],
};

// ============ 抄自 games.html ============
function caseProgressRoot() {
  try { return JSON.parse(localStorage.getItem('maomao_detective_progress_v1') || '{}') || {}; }
  catch (e) { return {}; }
}
function caseProgress() {
  const all = caseProgressRoot();
  const key = String(activeRole && activeRole.id || 'default-partner');
  if (!all[key]) all[key] = { completed: [], attempts: {}, notes: {}, campaign: { trust: {}, flags: [], threads: [], choices: [] } };
  if (!all[key].campaign) all[key].campaign = { trust: {}, flags: [], threads: [], choices: [] };
  if (!all[key].campaign.trust) all[key].campaign.trust = {};
  if (!Array.isArray(all[key].campaign.flags)) all[key].campaign.flags = [];
  if (!Array.isArray(all[key].campaign.threads)) all[key].campaign.threads = [];
  if (!Array.isArray(all[key].campaign.choices)) all[key].campaign.choices = [];
  return all[key];
}
function saveCaseProgress(progress) {
  const all = caseProgressRoot();
  all[String(activeRole && activeRole.id || 'default-partner')] = progress || caseProgress();
  localStorage.setItem('maomao_detective_progress_v1', JSON.stringify(all));
}
// startCase 里的自愈逻辑（928 行）
function startCaseSelfHeal() {
  const progress = caseProgress();
  window.CASES.forEach((c, idx) => {
    if (progress.notes[c.title] && progress.notes[c.title].result === 'solved'
        && progress.completed.indexOf(idx) < 0) {
      progress.completed.push(idx);
    }
  });
  saveCaseProgress(progress);
  return progress;
}
// 档案室渲染时的锁定判定（930 行）
function lockStatus() {
  const progress = caseProgress();
  return window.CASES.map((c, i) => {
    const done = progress.completed.indexOf(i) >= 0;
    const locked = i > 0 && progress.completed.indexOf(i - 1) < 0;
    return `CASE ${String(i+1).padStart(2,'0')} ${c.title} | done=${done} locked=${locked}`;
  });
}

// ============ 抄自 immersive-v21.js ============
function detectiveProgressKey() {
  try {
    if (typeof activeRole !== 'undefined' && activeRole && activeRole.id != null) {
      return String(activeRole.id);
    }
  } catch (e) {}
  return 'default-partner';
}
// 沉浸式正确指认后调用（771 行）
function recordSolvedCaseInArchive(immCaseIndex, immAccusation) {
  const cc = window.CASES[immCaseIndex];
  const today = new Date().toISOString().slice(0, 10);
  try {
    let done = JSON.parse(localStorage.getItem('immCasesDone') || '[]');
    if (!Array.isArray(done)) done = [];
    if (done.indexOf(immCaseIndex) < 0) done.push(immCaseIndex);
    localStorage.setItem('immCasesDone', JSON.stringify(done));
  } catch (e) {}

  try {
    const all = JSON.parse(localStorage.getItem('maomao_detective_progress_v1') || '{}') || {};
    const key = detectiveProgressKey();
    const progress = all[key] && typeof all[key] === 'object' ? all[key] : {};
    if (!Array.isArray(progress.completed)) progress.completed = [];
    if (progress.completed.indexOf(immCaseIndex) < 0) progress.completed.push(immCaseIndex);
    if (!progress.notes || typeof progress.notes !== 'object') progress.notes = {};
    if (!progress.attempts || typeof progress.attempts !== 'object') progress.attempts = {};
    if (!progress.campaign || typeof progress.campaign !== 'object') {
      progress.campaign = { trust: {}, flags: [], threads: [], choices: [] };
    }
    if (!progress.campaign.trust || typeof progress.campaign.trust !== 'object') progress.campaign.trust = {};
    if (!Array.isArray(progress.campaign.flags)) progress.campaign.flags = [];
    if (!Array.isArray(progress.campaign.threads)) progress.campaign.threads = [];
    if (!Array.isArray(progress.campaign.choices)) progress.campaign.choices = [];
    const suspect = cc.suspects && cc.suspects[immAccusation] ? cc.suspects[immAccusation].name : '';
    progress.notes[cc.title] = {
      result: 'solved',
      day: today,
      suspect,
      evidence: 0,
      source: 'immersive',
    };
    all[key] = progress;
    localStorage.setItem('maomao_detective_progress_v1', JSON.stringify(all));
  } catch (e) {
    console.warn('[immersive] archive sync failed', e);
  }
}

// ============ 跑流程 ============
console.log('=== 初始状态 ===');
console.log(lockStatus().join('\n'));

console.log('\n=== 沉浸式结案：案件0 正确指认（answer=1）===');
recordSolvedCaseInArchive(0, 1);

console.log('\n=== 结案后直接看档案室（不调用 startCase 自愈）===');
console.log(lockStatus().join('\n'));

console.log('\n=== 调用 startCase 自愈（928 行）===');
startCaseSelfHeal();
console.log(lockStatus().join('\n'));

console.log('\n=== 当前 localStorage 快照 ===');
console.log('immCasesDone =', localStorage.getItem('immCasesDone'));
console.log('maomao_detective_progress_v1 =', localStorage.getItem('maomao_detective_progress_v1'));
