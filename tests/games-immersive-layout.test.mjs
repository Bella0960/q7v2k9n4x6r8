import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 运行时实测回归：沉浸式侦探开场白屏。
 *
 * 现象（390×844 / Edge）：进入文游后只有顶部约 232px 显示内容，下方整屏空白。
 * 根因：shared/css/mobile-fit.css 在窄屏把 body 的 min-height 从 100vh 改成 100%，
 * body 高度随内容塌缩到 232px；immersive-v21.js 的 #immRoot 用
 * position:absolute + top/right/bottom/left:0，100% 高度就变成塌缩后的 body 高度。
 * 修复：根容器改为 position:fixed + 100dvh 铺满视口，同时保留 460px 宽度上限，
 * 不破坏桌面端手机预览。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const immersive = readFileSync(resolve(root, 'games/js/immersive-v21.js'), 'utf8');
const gamesHtml = readFileSync(resolve(root, 'games/games.html'), 'utf8');

test('01 沉浸式根容器按视口铺满，不再继承塌缩后的 body 高度', () => {
  assert.match(
    immersive,
    /root\.style\.cssText = 'position:fixed;top:0;left:50%;transform:translateX\(-50%\);width:100%;max-width:460px;height:100%;height:100dvh;overflow-y:auto;/,
    '沉浸式根容器应使用 fixed 定位并按 100dvh 铺满视口'
  );
  assert.doesNotMatch(
    immersive,
    /root\.style\.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;/,
    '沉浸式根容器仍是 absolute + 四边 0，会随 body 高度塌缩被裁切'
  );
  assert.ok(
    immersive.includes('max-width:460px;height:100%;height:100dvh'),
    '沉浸式容器应保留 460px 宽度上限，避免桌面预览被拉满'
  );
});

test('02 旧「自由调查」入口仍被沉浸式入口拦截，不会重复触发', () => {
  assert.ok(
    gamesHtml.includes('[data-open-case]') && gamesHtml.includes('function openCase('),
    '未找到旧自由调查入口（若已彻底移除，请更新本用例）'
  );
  assert.ok(
    immersive.includes("closest('.case-archive-item[data-open-case]')"),
    '沉浸式入口未监听案件卡片'
  );
  assert.ok(immersive.includes('e.stopPropagation();'), '沉浸式入口未阻止旧入口继续执行');
  assert.ok(immersive.includes('openImmersive(Number(card.getAttribute'), '沉浸式入口未正常调用');
  assert.ok(immersive.includes('不再注入旧版调查入口'), '档案室仍会注入旧版调查入口');
});
