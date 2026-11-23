import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/* APP-CAFE-002 — 咖啡馆经营档案入口契约
 * 经营档案（成长面板、每日目标、搭档建议、结算复盘、成就）曾经因为 DOM 缺少
 * #view-extra 而整体不可达，页头按钮也没有处理器。此契约固定住入口链路。
 * 静态契约，不替代浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');
const markup = source.slice(0, source.indexOf('<script>', source.indexOf('</style>')));

test('the archive container is mounted in the page markup', () => {
  assert.ok(/<section id="view-extra"[^>]*>/.test(markup), '#view-extra must exist in the DOM, otherwise renderCafeDetails() returns early');
  assert.ok(markup.indexOf('id="view-extra"') > markup.indexOf('id="view-partner"'), '#view-extra should follow the existing view sections');
});

test('the header control is a real entry, not a placeholder', () => {
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  assert.ok(header.includes('id="openArchive"'), 'header archive control must have an id');
  assert.ok(!header.includes('data-open-cafe'), 'header must not keep the orphaned data-open-cafe trigger');
  assert.ok(header.includes('aria-controls="view-extra"'), 'header control should declare what it opens');
});

test('tab routing shows and hides the archive view', () => {
  const setTab = source.match(/function setTab\(tab\)\{[^\n]*\}/);
  assert.ok(setTab, 'setTab not found');
  assert.ok(setTab[0].includes("'extra'"), 'setTab must toggle the extra view');

  const renderTab = source.match(/function renderTab\(\)\{[^\n]*\}/);
  assert.ok(renderTab, 'renderTab not found');
  assert.ok(renderTab[0].includes("if(TAB==='extra')renderCafeDetails();"), 'renderTab must render the archive when its tab is active');

  const renderAll = source.match(/function renderAll\(\)\{[^\n]*\}/);
  assert.ok(renderAll, 'renderAll not found');
  assert.ok(renderAll[0].includes("'extra'"), 'renderAll must keep the extra view visibility in sync');
});

test('archive actions refresh after state changes and can be closed', () => {
  assert.ok(source.includes("if(TAB==='extra')renderCafeDetails();"), 'overview re-render must refresh the archive while it is open');
  assert.ok(source.includes('id="closeArchive"'), 'archive needs an explicit way back');
  assert.ok(source.includes("archiveBtn.addEventListener('click'"), 'header archive control must be wired');
});
