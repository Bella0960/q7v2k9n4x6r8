import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/* APP-CAFE-001 — 咖啡馆经营决策链路契约
 * 静态契约检查：cafe/cafe.html 只有一个 chooseEvent 实现，且该实现记录搭档决策。
 * 这不是浏览器 E2E，也不验证视觉；仅防止同名函数重复定义再次静默覆盖真实逻辑。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

function inlineScript() {
  const start = source.indexOf('<script>', source.indexOf('</style>'));
  const end = source.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'cafe.html inline script block not found');
  return source.slice(start, end);
}

test('cafe event choice has exactly one implementation', () => {
  const matches = source.match(/function chooseEvent\(/g) || [];
  assert.equal(matches.length, 1, 'chooseEvent must be declared once, otherwise hoisting overwrites the partner-aware version');
});

test('the surviving chooseEvent records the partner decision chain', () => {
  const script = inlineScript();
  const start = script.indexOf('function chooseEvent(');
  const end = script.indexOf('function localPlan()', start);
  assert.ok(start >= 0 && end > start, 'cannot locate the chooseEvent body');
  const body = script.slice(start, end);

  for (const marker of ['st.partnerDecision', 'partnerDecision', 'p.decisions++', 'p.rapport', 'p.history.unshift', 'checkAchievements()']) {
    assert.ok(body.includes(marker), 'chooseEvent lost partner decision marker: ' + marker);
  }
});

test('cafe event choice refuses edits while the shop is operating', () => {
  const script = inlineScript();
  const start = script.indexOf('function chooseEvent(');
  const body = script.slice(start, script.indexOf('function localPlan()', start));
  assert.ok(body.includes("st.businessStatus==='operating'"), 'chooseEvent must reject changes during operating hours');
});

test('cafe keeps its existing storage keys and script dependencies', () => {
  assert.ok(source.includes("localStorage.getItem('maomao_cafe_state_v1')"), 'cafe state key changed');
  assert.ok(source.includes("localStorage.setItem('maomao_cafe_state_v1'"), 'cafe state write key changed');
  assert.ok(source.includes("'maomao_cafe_partner'"), 'cafe partner selection key changed');
  assert.ok(source.includes('../shared/js/phone/phone_storage.js'), 'cafe must keep loading PhoneStorage');
  assert.ok(source.includes('../shared/js/phone/phone_api.js'), 'cafe must keep loading PhoneAPI');
});
