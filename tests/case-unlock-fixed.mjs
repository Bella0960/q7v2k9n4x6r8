/* 验证修复：在卡死状态下，加了 immCasesDone 合并后，案件02 是否解锁 */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const activeRole = { id: 'char_abc123', name: '小猫' };
const window = {
  CASES: [
    { title: '潮汐档案室的最后一夜', answer: 1 },
    { title: '走廊尽头的17号房', answer: 1 },
    { title: '图书馆的借书卡', answer: 2 },
  ],
};
const CASES = window.CASES;

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

// 模拟用户截图卡死状态
localStorage.setItem('immCasesDone', JSON.stringify([0]));
localStorage.setItem('maomao_detective_progress_v1', JSON.stringify({
  'char_abc123': { completed: [], attempts: {}, notes: {}, campaign: { trust: {}, flags: [], threads: [], choices: [] } }
}));

// ===== 修复后的 startCase 自愈逻辑（与 games.html 928-930 行一致）=====
const progress = caseProgress();
CASES.forEach(function(c, idx) {
  if (progress.notes[c.title] && progress.notes[c.title].result === 'solved'
      && progress.completed.indexOf(idx) < 0) progress.completed.push(idx);
});
try {
  var _legacyDone = JSON.parse(localStorage.getItem('immCasesDone') || '[]');
  if (Array.isArray(_legacyDone)) {
    var _today = new Date().toISOString().slice(0, 10);
    _legacyDone.forEach(function(v) {
      var n = Number(v);
      if (isFinite(n) && n >= 0 && Math.floor(n) === n && n < CASES.length) {
        if (progress.completed.indexOf(n) < 0) progress.completed.push(n);
        if (!progress.notes[CASES[n].title]) {
          progress.notes[CASES[n].title] = { result: 'solved', day: _today, legacy: true };
        }
      }
    });
  }
} catch (e) {}
saveCaseProgress(progress);

// 渲染判定
console.log('=== 修复后档案室状态 ===');
CASES.forEach((c, i) => {
  const done = progress.completed.indexOf(i) >= 0;
  const locked = i > 0 && progress.completed.indexOf(i - 1) < 0;
  const status = done ? '✓ 已结案' : locked ? '完成上一案后解锁' : i === 0 ? '可调查' : '待调查';
  console.log(`CASE ${String(i+1).padStart(2,'0')} ${c.title} → ${status}`);
});
console.log('\ncompleted =', progress.completed);
console.log('notes keys =', Object.keys(progress.notes));
