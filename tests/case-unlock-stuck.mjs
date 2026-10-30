/* 复现用户截图状态：
 * - immCasesDone = [0]（沉浸式结案写的全局记录）
 * - maomao_detective_progress_v1[当前角色].completed = []
 * - maomao_detective_progress_v1[当前角色].notes 里也没有案件0的 solved 记录
 * 验证 startCase 的自愈逻辑能否把案件1解锁。
 */
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

// 模拟用户截图状态：直接写入 localStorage
localStorage.setItem('immCasesDone', JSON.stringify([0]));
// 注意：maomao_detective_progress_v1 故意不写当前角色的案件0记录
// （可能是之前版本 bug、key 错位、或迁移 marker 已设过但没迁成）
localStorage.setItem('maomao_detective_progress_v1', JSON.stringify({
  'char_abc123': { completed: [], attempts: {}, notes: {}, campaign: { trust: {}, flags: [], threads: [], choices: [] } }
}));
// 迁移 marker 已经设过，所以 migrateLegacy 不会再跑
localStorage.setItem('maomao_detective_immersive_progress_migrated_v1', '1');

console.log('=== 模拟用户截图状态 ===');
console.log('immCasesDone =', localStorage.getItem('immCasesDone'));
console.log('progress root =', localStorage.getItem('maomao_detective_progress_v1'));

// startCase 里的自愈逻辑（928 行）
const progress = caseProgress();
window.CASES.forEach((c, idx) => {
  if (progress.notes[c.title] && progress.notes[c.title].result === 'solved'
      && progress.completed.indexOf(idx) < 0) {
    progress.completed.push(idx);
  }
});
saveCaseProgress(progress);

console.log('\n=== startCase 自愈后 ===');
console.log('completed =', progress.completed);
console.log('notes =', Object.keys(progress.notes));

// 锁定判定
window.CASES.forEach((c, i) => {
  const done = progress.completed.indexOf(i) >= 0;
  const locked = i > 0 && progress.completed.indexOf(i - 1) < 0;
  const status = done ? '✓ 已结案' : locked ? '完成上一案后解锁' : i === 0 ? '可调查' : '待调查';
  console.log(`CASE ${String(i+1).padStart(2,'0')} ${c.title} → ${status}`);
});
