import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const previewSource=readFileSync(new URL('../theme-store/preview-scene.js',import.meta.url),'utf8');
const storefrontSource=readFileSync(new URL('../theme-store/storefront.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../theme-store/preview-scene.css',import.meta.url),'utf8');
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
   assert.ok(markup.includes(marker),id+'/'+page+' unique composition');
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
 assert.ok(html.indexOf('preview-scene.js?v=20261112m4')<html.indexOf('storefront.js?v=20261112m4'));
 assert.match(html,/preview-scene.css\?v=20261112m5/);
 assert.match(html,/collection-store.js\?v=20261112m3/);
 assert.match(html,/market-expansion.js\?v=20261112m1/);
});
