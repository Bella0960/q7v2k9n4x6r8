import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 角色档案页「顶部人设原文折叠」契约测试。
 *
 * 验收目标：
 * 1) 顶部人设默认只显示固定高度预览，长文本可展开、可再次收起；
 * 2) 原文完整转义渲染，不做截断、改写或重新生成；
 * 3) 下方结构化档案（角色设定 / 人物关系 / 个人生活线）不进入折叠容器；
 * 4) 短人设与空人设不出现点了没反应的「展开」入口。
 */
// 源码根目录：默认按测试文件自身位置推导；可用 MAOMAO_TEST_ROOT 指向隔离副本。
const root = process.env.MAOMAO_TEST_ROOT
  ? resolve(process.env.MAOMAO_TEST_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'worldbook/characters/characters.html'), 'utf8');
const js = readFileSync(resolve(root, 'worldbook/characters/js/characters-manager.js'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const mobileFit = readFileSync(resolve(root, 'shared/css/mobile-fit.css'), 'utf8');

const personaStart = js.indexOf('<div class="profile-persona"');
const heroSectionEnd = js.indexOf('</section>', personaStart);
const personaMarkup = personaStart > -1 && heroSectionEnd > personaStart
  ? js.slice(personaStart, heroSectionEnd)
  : '';

test('角色档案页是桌面「角色库」入口指向的页面', () => {
  assert.match(indexHtml, /data-href="worldbook\/characters\/characters\.html"/);
  assert.match(html, /角色档案 \/ PERSONA INDEX/);
});

test('顶部人设默认折叠：固定预览高度并隐藏溢出', () => {
  assert.match(html, /--persona-preview:\s*84px/);
  assert.match(html, /\.profile-persona-body\s*\{[^}]*overflow:hidden/);
  assert.match(html, /\.profile-persona-body\s*\{[^}]*max-height:none/);
  assert.match(js, /body\.style\.maxHeight = preview \+ 'px'/);
  assert.ok(personaMarkup, '未找到人设折叠容器标记');
  assert.match(personaMarkup, /aria-expanded="false"/);
  assert.match(personaMarkup, /\shidden>/);
});

test('展开入口轻量：纯文本 + 1.5px 细线箭头，且可再次收起', () => {
  assert.match(personaMarkup, /data-persona-toggle-text>展开全文</);
  assert.match(personaMarkup, /<svg[^>]*stroke-width="1\.5"/);
  assert.match(personaMarkup, /data-persona-toggle/);
  assert.match(js, /if \(wrap\.classList\.contains\('is-expanded'\)\)/);
  assert.match(js, /label\.textContent = '收起'/);
  assert.match(js, /label\.textContent = '展开全文'/);
  assert.match(js, /toggle\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(js, /toggle\.setAttribute\('aria-expanded', 'false'\)/);
});

test('人设原文一字不改：完整转义渲染，没有截断', () => {
  const renderLine = js.split('\n').find(line => line.includes('class="profile-hero-desc"'));
  assert.ok(renderLine, '未找到人设原文渲染行');
  assert.match(renderLine, /escapeHtml\(role\.persona \|\| /);
  assert.doesNotMatch(renderLine, /\.(slice|substring|substr|trim)\(/);
  assert.doesNotMatch(js, /role\.persona[^\n]*\.(slice|substring|substr)\(/);
});

test('下方结构化档案分区完全独立，不在折叠容器内', () => {
  assert.ok(personaStart > -1, '未找到折叠容器起点');
  const settingsIndex = js.indexOf('CHARACTER SETTINGS / 角色设定');
  assert.ok(settingsIndex > personaStart, '角色设定分区应位于人设折叠容器之后');
  const between = js.slice(personaStart, settingsIndex);
  assert.doesNotMatch(between, /profile-branch/, '结构化分区分支不应放进折叠容器');
  const structured = js.slice(settingsIndex);
  assert.match(structured, /data-profile-action="basic"/);
  assert.match(structured, /data-profile-action="tone"/);
  assert.match(structured, /data-profile-action="relationships"/);
  assert.match(structured, /data-profile-action="life"/);
});

test('短人设不显示展开入口（避免无效按钮）', () => {
  assert.match(js, /if \(fullHeight <= preview \+ 2\) return;/);
  assert.match(js, /toggle\.hidden = false;\s*\n\s*toggle\.addEventListener/);
});

test('空人设保留明确空态，不出现空壳折叠区', () => {
  assert.match(js, /还没有填写人物背景。可以从基本资料开始完善这个角色。/);
  // 空人设高度必然命中短内容分支并直接 return，不会 unhide 展开按钮
  assert.match(js, /if \(fullHeight <= preview \+ 2\) return;/);
});

test('折叠高度过渡 150-250ms，并遵循减少动态效果偏好', () => {
  assert.match(html, /transition:max-height 200ms ease/);
  assert.match(html, /@media \(prefers-reduced-motion:reduce\)/);
});

test('可滚动区域保持隐藏滚动条', () => {
  assert.match(mobileFit, /scrollbar-width:\s*none/);
  assert.match(mobileFit, /::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
});
