import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const archive = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');
const original = readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const inlineCSS = archive.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1];

function scopedRule(selector) {
  assert.ok(inlineCSS, 'archive must keep its source CSS');
  const marker = '/* ROLE-LIST-V117:';
  const start = inlineCSS.indexOf(marker);
  assert.ok(start >= 0, 'compact role-list styles must have their own scoped guard');
  const latest = inlineCSS.indexOf('/* ROLE-LIST-PORTRAIT-V118');
  assert.ok(latest >= start, 'portrait layout override must be present after v117 styles');
  const endOverride = inlineCSS.indexOf('@media(max-width:360px)', latest);
  const section = inlineCSS.slice(latest, endOverride >= 0 ? endOverride : undefined);
  const begin = section.lastIndexOf(selector + ' {');
  assert.ok(begin >= 0, selector + ' must exist in the scoped guard');
  const end = section.indexOf('}', begin);
  return section.slice(begin, end);
}

test('balanced role rows stay scoped to list, preserve full width, hidden scrollbars and original controls', () => {
  assert.match(scopedRule('#listView .role-slim-bar'), /grid-template-columns:\s*minmax\(102px,35%\)\s+minmax\(0,1fr\)/);
  assert.match(scopedRule('#listView .role-slim-bar'), /min-height:\s*174px/);
  const photo = scopedRule('#listView .role-slim-bar .slim-avatar');
  assert.match(photo, /width:\s*100%/);
  assert.match(photo, /height:\s*146px/);
  assert.match(photo, /align-self:\s*start/);
  const desc = scopedRule('#listView .role-slim-bar .slim-desc');
  assert.match(desc, /overflow-y:\s*auto/);
  assert.match(desc, /scrollbar-width:\s*none/);
  assert.match(original, /role-slim-bar/);
  assert.match(original, /data-role-action="delete"/);
  assert.match(original, /data-role-action="use"/);
  assert.match(archive, /#listView \.role-list::-webkit-scrollbar\s*\{\s*display:none/);
  assert.match(archive, /#listView \.role-list\s*\{[\s\S]*?overflow-y:auto\s*!important/);
});

test('real Chromium: short and long roles align at top with scrollable biographies at 375/390/430px', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [375, 390, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 720 }, deviceScaleFactor: 1 });
      try {
        // Reuses the exact shipped CSS and role-card classes. No private
        // account state or destructive app operations are required.
        const shortRole = '<div class="role-slim-bar" data-id="short" role="button" tabindex="0"><div class="bar-left"><div class="slim-avatar" aria-hidden="true"></div><div class="slim-meta"><div class="slim-name-row"><span class="slim-name">测试一号</span></div><span class="slim-desc">简短人设。</span></div></div><div class="bar-right"><button class="act-opt btn-use">使用</button><button class="act-opt del btn-delete">删除</button></div></div>';
        const longRole = '<div class="role-slim-bar" data-id="long" role="button" tabindex="0"><div class="bar-left"><img class="slim-avatar" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22/%3E" alt=""><div class="slim-meta"><div class="slim-name-row"><span class="slim-name">陆昭辰</span><span class="slim-tag">使用中</span></div><span class="slim-desc">' + '很长的角色背景和人物关系描述，包含各种个性、故事和细节。'.repeat(12) + '</span></div></div><div class="bar-right"><button class="act-opt del btn-delete">删除</button></div></div>';
        const entries = [shortRole, longRole, shortRole, longRole, shortRole, longRole];
        await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + inlineCSS + '\n' + mobile + '</style></head><body><div class="phone-mockup" style="width:100vw;height:720px"><section class="view-section" id="listView" style="display:flex;flex-direction:column;height:100%"><main class="role-list" id="roleListContainer">' + entries.join('') + '</main></section></div></body></html>');
        const result = await page.evaluate(() => {
          const list = document.querySelector('#roleListContainer');
          const rows = [...list.querySelectorAll('.role-slim-bar')];
          const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,right:r.right }; };
          return {
            rows:rows.map(row => {
              const avatar=row.querySelector('.slim-avatar');
              const meta=row.querySelector('.slim-meta');
              const desc=row.querySelector('.slim-desc');
              const buttons=row.querySelector('.bar-right');
              const style=getComputedStyle(desc);
              return { row:rect(row), avatar:rect(avatar), meta:rect(meta), desc:rect(desc), buttons:rect(buttons),
                clamp:style.webkitLineClamp, lineHeight:parseFloat(style.lineHeight), contentWidth:desc.scrollWidth, scrollHeight:desc.scrollHeight, clientHeight:desc.clientHeight, overflowY:style.overflowY,
                text:desc.textContent, visible:style.display };
            }),
            list:rect(list), scrollHeight:list.scrollHeight, clientHeight:list.clientHeight,
            overflowY:getComputedStyle(list).overflowY, scrollbarWidth:getComputedStyle(list).scrollbarWidth,
            viewport:document.documentElement.clientWidth, documentWidth:document.documentElement.scrollWidth,
          };
        });
        assert.equal(result.rows.length, 6);
        assert.ok(result.list.w >= width - 1, 'full width scroll region');
        assert.ok(result.documentWidth <= width + 1, 'no horizontal scrolling');
        assert.equal(result.overflowY, 'auto');
        assert.equal(result.scrollbarWidth, 'none');
        assert.ok(result.scrollHeight > result.clientHeight, 'extra cards remain scrollable');
        const [short, long] = result.rows;
        assert.ok(Math.abs(short.row.h - long.row.h) <= 12,
          'short/long row heights must stay close: ' + JSON.stringify([short.row.h,long.row.h]));
        for (const item of [short,long]) {
          assert.ok(item.row.h >= 172 && item.row.h <= 178,
            'card stays compact: ' + item.row.h);
          assert.ok(item.avatar.w >= 100 && item.avatar.w <= 150);
          assert.equal(item.avatar.h, 146);
          assert.ok(Math.abs(item.avatar.y - item.meta.y) <= 2, 'photo top aligns with text');
          assert.ok(item.row.x >= result.list.x && item.row.right <= result.list.right + 1,
            'full-width card must fit without clipping');
          assert.equal(item.overflowY, 'auto');
          assert.ok(item.desc.h <= 73, 'biography viewport remains bounded');
          assert.ok(item.buttons.y >= item.meta.y, 'actions stay below the header');
          assert.ok(item.buttons.y + item.buttons.h <= item.row.y + item.row.h + 1,
            'action buttons cannot escape the row');
        }
        // User can still inspect the entire description by opening the full profile.
        assert.ok(long.text.length > 100 && long.scrollHeight > long.clientHeight, 'long biography must be independently scrollable');
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
