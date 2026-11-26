import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const storefrontSource=readFileSync(new URL('../theme-store/storefront.js',import.meta.url),'utf8');
const expansion=readFileSync(new URL('../theme-store/market-expansion.js',import.meta.url),'utf8');
const storefrontCSS=readFileSync(new URL('../theme-store/storefront.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');

test('opening preview does not apply a theme; applying requires a second explicit confirmation',()=>{
 assert.match(storefrontSource,/action==='apply-theme'/);
 assert.match(storefrontSource,/action==='confirm-apply-theme'/);
 assert.match(storefrontSource,/确认应用主题/);
 const start=storefrontSource.indexOf("if(action==='apply-theme')");
 const end=storefrontSource.indexOf("if(action==='confirm-apply-theme')",start);
 assert.ok(start!==-1&&end>start);
 assert.doesNotMatch(storefrontSource.slice(start,end),/api\.applyTheme\(/);
});

test('expanded theme tab renders native original catalogue instead of replacing it',()=>{
 assert.match(storefrontSource,/gallery\(api\.themes\)/,'all original theme options remain in actual storefront');
 assert.match(storefrontSource,/nativeArt\(t\)/);
 assert.match(storefrontSource,/function themes\(\)/);
 assert.match(html,/nativeArt:themeArt,\s*listCard:renderChatListCard/);
 assert.doesNotMatch(html,/nativeThemes|renderThemes/);
 assert.match(html,/function themeArt\(theme\)/);
 for(const id of ['wechat','qq','silver-butterfly','atmosphere']){
  assert.ok(html.includes("id:'"+id+"'"),'original preset '+id+' is still in native catalogue');
 }
 for(const id of ['wechat','silver-butterfly','atmosphere']){
  assert.ok(html.includes("theme.id==='"+id+"'"),'special original cover '+id+' is retained');
 }
 assert.match(html,/theme-art-'\+theme\.id/); // QQ/default/iMessage use the original built-in bubble artwork
 assert.ok(html.includes('data-action="chat-list-theme-toggle"'),'original chat-list-theme-toggle control exists');
 assert.doesNotMatch(html,/data-action="theme-apply"/);
});

test('named outfit preview uses original theme artwork only when theme scope is saved',()=>{
 const start=storefrontSource.indexOf('async function recordPreview(encoded)');
 const end=storefrontSource.indexOf('async function imageData(file)',start);
 assert.ok(start!==-1&&end>start);
 const preview=storefrontSource.slice(start,end);
 assert.match(preview,/item\.scopes\.includes\('theme'\)/);
 assert.match(preview,/nativeArt\(chosen\)/);
 assert.doesNotMatch(preview,/host\.innerHTML=scene\(/);
});

test('completed theme cards render on the new vertical shelf, not the old swipe rail',()=>{
 assert.match(storefrontSource,/function gallery\(items\)/);
 assert.match(storefrontSource,/sf-theme-collection/);
 assert.match(storefrontSource,/sf-theme-item/);
 assert.doesNotMatch(html,/class="product-grid"/);
 assert.doesNotMatch(storefrontSource,/enableProductDrag/);
});

test('themes section renders full themes first, then the independent list theme card',()=>{
 const start=storefrontSource.indexOf('function themes()');
 const end=storefrontSource.indexOf('function discover()',start);
 assert.ok(start>0&&end>start);
 const render=storefrontSource.slice(start,end);
 const galleryPos=render.indexOf('gallery(api.themes)');
 const listPos=render.indexOf('api.listCard()');
 assert.ok(galleryPos>0&&listPos>galleryPos,'full theme gallery precedes the secondary list card');
 assert.match(render,/sf-theme-list-only/);
 assert.match(storefrontSource,/'apply-theme'/);
 assert.match(storefrontSource,/data-sf="detail"/);
 assert.match(html,/data-action="chat-list-theme-toggle"/);
});

test('save current outfit defaults to theme only, never silently capturing icons or wallpaper',()=>{
 assert.match(storefrontSource,/checkboxes\(Object\.keys\(model\.scopes\),\['theme'\]\)/);
 assert.match(storefrontSource,/function checkboxes\(selected,checked=selected\)/);
 assert.match(storefrontSource,/checked\.includes\(s\)/);
 assert.match(storefrontSource,/默认只保存当前聊天主题/);
});

test('favorite controls expose their selected state and refresh open detail',()=>{
 assert.match(storefrontSource,/aria-pressed/);
 assert.match(storefrontSource,/model\.read\(\)\.favorites\.includes\(id\)/);
 assert.match(storefrontSource,/overlay\?\.querySelectorAll\('\[data-sf="favorite"/);
 assert.match(storefrontSource,/已收藏 · 点击取消/);
});

test('existing spotlight keeps the preview and confirmation flow, with no forward arrows',()=>{
 assert.doesNotMatch(expansion,/›|→|↑|market-hub-arrow/);
 assert.match(storefrontSource,/action==='confirm-apply-theme'/);
});

test('native shelves, category rows and dialog controls stay usable at narrow phone widths',()=>{
 assert.match(storefrontCSS,/@media\(max-width:360px\)/);
 assert.match(storefrontCSS,/\.store-app \.sf-theme-collection \.sf-button/);
 assert.match(storefrontCSS,/\.store-app \.sf-category-row/);
 assert.match(storefrontCSS,/\.store-app \.sf-favorite/);
});

test('native theme artwork avoids the gray-orb thumbnail and every narrow CTA stays short',()=>{
 const start=html.indexOf('function themeArt(theme)');
 const end=html.indexOf('function editorialListArt()',start);
 const art=html.slice(start,end);
 assert.ok(art.includes('class="at-mini-symbol"'));
 assert.ok(!art.includes('class="at-mini-avatar"'));
 assert.match(art,/stroke-width="1\.15"/);
 assert.match(storefrontSource,/应用这套主题/);
 assert.doesNotMatch(html,/免费应用'/);
});
