/* 验证新的解锁逻辑：以 immCasesDone 为准 */
const progress = { completed: [], notes: {} };
let immDone = [0]; // 案件0结了，但 progress.completed 是空的（错位状态）

function _isCaseDone(i) {
  return progress.completed.indexOf(i) >= 0 || immDone.indexOf(i) >= 0;
}
const CASES = [{}, {}, {}];

CASES.forEach((c, i) => {
  const done = _isCaseDone(i);
  const locked = i > 0 && !_isCaseDone(i - 1);
  const status = done ? '✓ 已结案' : locked ? '完成上一案后解锁' : i === 0 ? '可调查' : '待调查';
  console.log(`CASE ${String(i+1).padStart(2,'0')} → ${status}`);
});
