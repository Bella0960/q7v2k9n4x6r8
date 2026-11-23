import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-KITCHEN-001 · 投喂厨房试吃交互契约
 * 覆盖：连点「端给 TA」不重复入账；角色切换/重做/改菜后旧 AI 请求不得回写。
 * 行为测试跑真实的 reactionIsCurrent()，其余用源码顺序守卫。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const src = readFileSync(resolve(root, 'games/js/cooking.js'), 'utf8');

const guardSource = (() => {
  const start = src.indexOf('function reactionIsCurrent(');
  assert.ok(start > 0, 'reactionIsCurrent not found');
  return src.slice(start, src.indexOf('\n', start));
})();

function makeSandbox(token, dish) {
  const sandbox = { reactionToken: token, currentDish: dish };
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  return sandbox;
}

test('当前请求：token 与菜品都匹配才算有效', () => {
  const dish = { id: 'dish_1' };
  const sb = makeSandbox(3, dish);
  assert.equal(sb.reactionIsCurrent(3, dish), true);
});

test('过期 token（重做/改菜后）不生效', () => {
  const dish = { id: 'dish_1' };
  const sb = makeSandbox(4, dish);
  assert.equal(sb.reactionIsCurrent(3, dish), false);
});

test('换了菜品后不生效', () => {
  const sb = makeSandbox(3, { id: 'dish_2' });
  assert.equal(sb.reactionIsCurrent(3, { id: 'dish_1' }), false);
});

test('端给 TA 具备连点锁，且记录本次 token', () => {
  const start = src.indexOf('function beginTasting(');
  const end = src.indexOf('function requestReaction(', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('if(!currentDish||tastingLock)return;'), 'missing double-tap lock');
  assert.ok(body.includes('tastingLock=true'), 'lock must be set on entry');
  assert.ok(body.includes('++reactionToken'), 'each tasting round must own a token');
  assert.ok(body.includes('requestReaction(token,dish)'), 'deferred request must carry token and dish');
});

test('AI 回调写回前校验归属', () => {
  const start = src.indexOf('function requestReaction(');
  const end = src.indexOf('function saveHistory(', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('function requestReaction(token,dish)'), 'requestReaction must accept token and dish');
  assert.ok(body.includes('if(!reactionIsCurrent(token,dish))return;'), 'stale responses must be dropped before writing');
});

test('切换角色也会让进行中的请求失效', () => {
  const at = src.indexOf('b.onclick=function(){reactionToken++');
  assert.ok(at > 0, 'role switch must invalidate in-flight reaction');
});

test('重做与改菜都会让进行中的请求失效', () => {
  const again = src.indexOf("$('cookAgain').onclick");
  assert.ok(src.slice(again, src.indexOf('\n', again)).includes('reactionToken++'), 'cookAgain must invalidate in-flight reaction');
  const edit = src.indexOf("$('editDish').onclick");
  assert.ok(src.slice(edit, src.indexOf('\n', edit)).includes('reactionToken++'), 'editDish must invalidate in-flight reaction');
});
