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

test('the existing menu retains access to other features and the archive', () => {
  const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
  assert.match(header, /data-open-cafe="menu"/);
  assert.ok(source.includes("key:'records',label:'记录',id:'view-extra'"));
  assert.ok(source.includes("var node=$(route.id)"));
  assert.ok(source.includes("else if(key==='records')renderCafeDetails()"));
});

test('archive reward handling stays on the mounted view across rerenders', () => {
  assert.equal(source.split("nodes.records.addEventListener('click'").length, 2);
  assert.ok(source.includes("reward.getAttribute('data-growth-claim')"));
});
