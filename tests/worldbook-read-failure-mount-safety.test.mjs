import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');

function failureBlock() {
  const start = detail.indexOf('            if (worldbookReadError) {');
  const end = detail.indexOf('            if (worldbookText.length > 32000)', start);
  assert.ok(start >= 0 && end > start, 'must exercise the real worldbook failure branch');
  return detail.slice(start, end);
}

test('worldbook read failure routes through the confirmed-message handler', () => {
  const block = failureBlock();
  assert.match(block, /stopForMissingRoleSource\('worldbook-read'/);
  assert.doesNotMatch(block, /按相同正文|String\(item\.text \|\| ''\) === String\(text \|\| ''\)/,
    'must not search history by identical text and mark an unrelated message');
  assert.match(detail, /let sourceGateUser = null/);
});

test('worldbook read failure never rewrites role, mount or worldbook library storage', () => {
  const block = failureBlock();
  assert.doesNotMatch(block, /localStorage\.(setItem|removeItem)/);
  assert.doesNotMatch(block, /RoleWorldbookBindings\.save/);
  assert.doesNotMatch(block, /saveCharacters|saveWorldbooks|chat_worldbooks_|worldBookIds/);
  assert.doesNotMatch(block, /_markUserSendFailed\(\s*historyList,\s*wbFailureTarget/);
});
