import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const previewSource=readFileSync(new URL('../theme-store/preview-scene.js',import.meta.url),'utf8');
const storefrontSource=readFileSync(new URL('../theme-store/storefront.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../theme-store/preview-scene.css',import.meta.url),'utf8');
const storefrontCSS=readFileSync(new URL('../theme-store/storefront.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../theme-store/theme-store.html',import.meta.url),'utf8');
function setup(){
 const window={};vm.runInNewContext(previewSource,{window});
 return window.MAOMAOStorefrontPreview;
}
test('renders six individually composed, isolated fictional page previews',()=>{
 const p=setup();
 const examples=new Map([
  ['desktop','sp-widget'],['list','sp-chat-row'],['detail','sp-message'],
  ['moments','sp-post-head'],['mine','sp-mine-menu'],['home','sp-gallery']
 ]);
 for(const id of ['default','atmosphere','imessage','wechat','qq','silver-butterfly']){
  for(const [page,marker] of examples){
   const markup=p.render(id,page);
   assert.match(markup,new RegExp('data-page="'+page+'"'));
   const legacyMarkers={
    wechat:{list:'sp-wx-conversation',detail:'sp-wx-msg',moments:'sp-wx-post',mine:'sp-wx-menu'},
    qq:{list:'sp-qq-list-row',detail:'sp-qq-msg',moments:'sp-qq-feed-post',mine:'sp-qq-menu'}
   };
   const uniqueMarker=legacyMarkers[id]?.[page]||marker;
   assert.ok(markup.includes(uniqueMarker),id+'/'+page+' unique composition');
   assert.ok(markup.includes('sp-home-indicator'));
   assert.ok(!/base64,|chat_history_|beauty_chat_|home_custom_wallpaper/.test(markup));
  }
 }
});
test('previews do not read browser data, even when storage access is blocked',()=>{
 const window={};
 Object.defineProperty(window,'localStorage',{get(){throw Error('must not read user data');}});
 Object.defineProperty(window,'indexedDB',{get(){throw Error('must not read private images');}});
 vm.runInNewContext(previewSource,{window});
 assert.ok(window.MAOMAOStorefrontPreview.render('atmosphere','detail').includes('沈知行'));
});
test('dark preview only affects the atmosphere scene',()=>{
 const p=setup();
 assert.match(p.render('atmosphere','detail','dark'),/sp-dark/);
 assert.doesNotMatch(p.render('wechat','detail','dark'),/\bsp-dark\b/);
 assert.match(p.render('atmosphere','detail','light'),/sf-atmosphere/);
});
test('iMessage detail scope does not claim to change unsupported pages',()=>{
 const p=setup();
 assert.equal(p.covered('imessage','detail'),true);
 assert.equal(p.covered('imessage','list'),false);
 assert.equal(p.covered('imessage','home'),false);
 assert.match(p.render('imessage','detail'),/sf-imessage/);
 assert.match(p.render('imessage','list'),/sf-default/);
});
test('chat themes never imply that they replace desktop or non-atmosphere home pages',()=>{
 const p=setup();
 for(const id of ['atmosphere','wechat','qq','silver-butterfly']){
  assert.equal(p.covered(id,'desktop'),false);
  assert.match(p.render(id,'desktop'),/sf-default/);
 }
 assert.equal(p.covered('wechat','home'),false);
 assert.equal(p.covered('atmosphere','home'),true);
});
test('large preview and reduced motion declarations preserve phone accessibility',()=>{
 assert.match(css,/\.sf-dialog \.sp-screen/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css, /prefers-reduced-motion:reduce/);
 assert.match(storefrontSource,/touchstart/);
 assert.match(storefrontSource,/ArrowRight/);
 assert.match(storefrontSource,/aria-pressed/);
});
test('real page includes preview resources before storefront and keeps existing systems',()=>{
 assert.ok(html.indexOf('preview-scene.js?v=20261113m7')<html.indexOf('storefront.js?v=20261113m12'));
 assert.match(html,/preview-scene.css\?v=20261113m7/);
 assert.match(html,/collection-store.js\?v=20261112m3/);
 assert.match(html,/market-expansion.js\?v=20261113m2/);
});

test('QQ and WeChat retain distinct legacy layouts, not an editorial repaint',()=>{
 const p=setup();
 const markers={
   wechat:['sp-wx-conversation','sp-wx-msg','sp-wx-post','sp-wx-menu'],
   qq:['sp-qq-list-row','sp-qq-msg','sp-qq-feed-post','sp-qq-menu']
 };
 for(const page of ['list','detail','moments','mine']){
  const index=['list','detail','moments','mine'].indexOf(page);
  const wechat=p.render('wechat',page),qq=p.render('qq',page);
  assert.ok(wechat.includes(markers.wechat[index]),'WeChat '+page+' keeps native-style layout');
  assert.ok(qq.includes(markers.qq[index]),'QQ '+page+' keeps different layout');
  assert.ok(!wechat.includes(markers.qq[index]),'WeChat cannot show QQ view');
  assert.ok(!qq.includes(markers.wechat[index]),'QQ cannot show WeChat view');
  assert.notEqual(wechat,qq);
 }
 assert.match(p.render('wechat','detail'),/sp-wx-out/);
 assert.match(p.render('qq','detail'),/sp-qq-out/);
});
test('only left-facing back arrow remains; no forward or up arrows in storefront previews',()=>{
 const p=setup();
 assert.match(previewSource,/back:'M15 18l-6-6 6-6'/);
 assert.doesNotMatch(previewSource,/icon\('arrow'\)|\barrow:'|icon\('up'\)/);
 assert.doesNotMatch(storefrontSource,/svg\('arrow'\)|\barrow:'|svg\('up'\)/);
 assert.match(p.render('wechat','detail'),/sp-wx-left/);
 assert.match(p.render('qq','detail'),/sp-qq-chat-head/);
});
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
 assert.match(storefrontSource,/nativeThemes\(\)/);
 assert.match(storefrontSource,/nativeArt\(t\)/);
 assert.match(storefrontSource,/function themes\(\)/);
 assert.match(html,/nativeThemes:renderThemes,\s*nativeArt:themeArt/);
 assert.match(html,/function renderThemes\(\)/);
 assert.match(html,/function themeArt\(theme\)/);
 for(const id of ['wechat','qq','silver-butterfly','atmosphere']){
  assert.ok(html.includes("id:'"+id+"'"),'original preset '+id+' is still in native catalogue');
 }
 for(const id of ['wechat','silver-butterfly','atmosphere']){
  assert.ok(html.includes("theme.id==='"+id+"'"),'special original cover '+id+' is retained');
 }
 assert.match(html,/theme-art-'\+theme\.id/); // QQ/default/iMessage use the original built-in bubble artwork
 assert.ok(html.includes('data-action="theme-apply"'),'original theme-apply control exists');
 assert.ok(html.includes('data-action="chat-list-theme-toggle"'),'original chat-list-theme-toggle control exists');
});
test('native legacy product details do not pretend to be a live six-screen theme',()=>{
 const start=storefrontSource.indexOf("function detail(id)");
 const branch=storefrontSource.indexOf("if(id!=='atmosphere')",start);
 const end=storefrontSource.indexOf("previewTone='light'",branch);
 assert.ok(start!==-1&&branch>start&&end>branch);
 const snippet=storefrontSource.slice(branch,end);
 assert.match(snippet,/sf-native-detail-art/);
 assert.match(snippet,/nativeArt\(t\)/);
 assert.doesNotMatch(snippet,/#sfPreview|MAOMAOStorefrontPreview\.render/);
 assert.match(snippet,/真实聊天页面/);
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

test('completed theme cards occupy a real two-column shelf, not the old swipe rail',()=>{
 assert.match(storefrontCSS,/\.store-app \.product-grid\s*\{[\s\S]*?display:grid/);
 assert.match(storefrontCSS,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/getComputedStyle\(rail\)\.display==='grid'/);
});


test('completed native themes show first and retain the independent list theme and featured product',()=>{
 const first=html.indexOf('function renderThemes(){');
 const end=html.indexOf('function renderBubbles()',first);
 assert.ok(first>0&&end>first);
 const render=html.slice(first,end);
 const grid=render.indexOf('<div class="product-grid">');
 const list=render.indexOf('<div class="chat-list-theme-grid">');
 const feature=render.indexOf('market.renderThemeFeature()');
 assert.ok(grid>0&&list>grid&&feature>list,'existing theme grid precedes secondary merchandising');
 assert.match(render,/themeArt\(item\)/);
 assert.match(render,/data-action="theme-apply"/);
 assert.match(render,/data-sf="detail"/);
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
test('existing spotlight shares the storefront preview and confirmation, with no forward arrows',()=>{
 const expansion=readFileSync(new URL('../theme-store/market-expansion.js',import.meta.url),'utf8');
 assert.match(expansion,/data-sf="detail" data-id="atmosphere"/);
 assert.match(expansion,/data-sf="apply-theme" data-id="atmosphere"/);
 assert.doesNotMatch(expansion,/›|→|↑|market-hub-arrow/);
 assert.match(storefrontSource,/action==='confirm-apply-theme'/);
});
test('native shelves, category rows and dialog controls stay usable at narrow phone widths',()=>{
 assert.match(storefrontCSS,/@media\(max-width:360px\)/);
 assert.match(storefrontCSS,/\.store-app \.product-grid \.action-btn/);
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
 const render=html.slice(html.indexOf('function renderThemes()'),html.indexOf('function renderBubbles()'));
 assert.match(render,/isOwned\?'应用主题':'免费应用'/);
 assert.doesNotMatch(render,/isOwned\?'应用主题':'免费获取并应用'/);
});
