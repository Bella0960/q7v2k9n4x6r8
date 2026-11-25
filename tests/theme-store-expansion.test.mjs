import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const get=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const store=get('theme-store/theme-store.html');
const extension=get('theme-store/market-expansion.js');
const styles=get('theme-store/market-expansion.css');
const widgetManager=get('desktop/widgets.html');
const wallpaperStore=get('shared/js/wallpaper-store.js');
const themeEngine=get('shared/js/chat-beauty.js');
const serviceWorker=get('sw.js');

function environment(layout){
 const calls=[],storage={},location={href:''};
 if(layout)storage.ds_layout_v14=JSON.stringify(layout);
 const asyncWallpaper={
  save(uri){calls.push({action:'save',uri});return Promise.resolve(true);},
  get(){return Promise.resolve(calls.length?calls[calls.length-1].uri:'');}
 };
 const win={
  location,
  localStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=String(value);}},
  MAOMAOWallpaperStore:asyncWallpaper,
  MAOMAOAtmosphereIcons:{paths:{},markup:name=>'<svg data-icon="'+name+'"></svg>'}
 };
 runInNewContext(extension,{window:win});
 return {catalog:win.MAOMAOMarketExpansion,win,calls,storage,location};
}
test('seven storefront tabs supplement—not replace—the original theme, bubble and font categories',()=>{
 for(const id of ['discover','themes','bubbles','widgets','wallpapers','fonts','mine']){
  assert.match(store,new RegExp('data-category="'+id+'"'));
 }
 for(const id of ['default','imessage','qq','silver-butterfly','wechat','atmosphere']){
  assert.match(store,new RegExp("id:'"+id+"'"));
 }
 assert.match(store,/var OWN_KEY='maomao_theme_store_owned_v1'/);
 assert.match(store,/var VISUAL_KEY='beauty_visual_presets_v1'/);
 assert.match(store,/function applyTheme\(id\)/);
 assert.match(store,/ChatBeauty\.setThemePreset\(id\)/);
 assert.match(store,/function applyBubblePreset\(id\)/);
 assert.match(store,/ChatBeauty\.save\(scope,payload\)/);
 assert.match(themeEngine,/NS\.setThemePreset = function \(theme\)/);
 assert.match(store,/theme-art-atmosphere/);
 assert.match(store,/market\.renderThemeFeature\(\)/);
});
test('the featured preview names all five actual supported surfaces and is explicitly sample content',()=>{
 const e=environment(),catalog=e.catalog;
 const html=catalog.renderDiscover();
 assert.match(html,/预览五个页面/);
 for(const surface of ['聊天首页','聊天详情','动态','我的','我的主页']){
  assert.ok(html.includes(surface),surface);
 }
 assert.equal(catalog.widgets.length,12);
 assert.equal(catalog.wallpapers.length,6);
 assert.match(extension,/这是五页布局示意/);
 assert.match(extension,/role="dialog" aria-modal="true"/);
 assert.match(extension,/document\.dispatchEvent\(new CustomEvent\('maomao:market-apply-atmosphere'\)\)/);
 assert.match(store,/maomao:market-apply-atmosphere/);
 assert.match(styles,/prefers-reduced-motion:reduce/);
});
test('wallpapers use existing IndexedDB-backed desktop wallpaper store, never any chat/image cover key',async()=>{
 const env=environment();
 const catalog=env.catalog;
 const item=catalog.wallpapers[0];
 const name=await catalog.applyWallpaper(item);
 assert.equal(name,'留白纸页');
 assert.equal(env.calls.length,1);
 assert.equal(env.calls[0].action,'save');
 assert.match(env.calls[0].uri,/^data:image\/svg\+xml;charset=utf-8,/);
 const svg=decodeURIComponent(env.calls[0].uri.split(',')[1]);
 assert.match(svg,/viewBox="0 0 390 844"/);
 assert.match(svg,/<rect/);
 assert.doesNotMatch(svg,/<(?:script|image|foreignObject)|https?:\/\//i);
 assert.match(wallpaperStore,/function saveWallpaper\(dataUrl\) \{ return saveByKey\(WALLPAPER_KEY, dataUrl\)/);
 assert.match(wallpaperStore,/var WALLPAPER_KEY = 'home_custom_wallpaper'/);
 assert.doesNotMatch(extension,/myProfile\.cover|chat_bg_|my_home_cover_v1|saveMoments\(/);
 assert.equal(env.storage.home_custom_wallpaper,undefined);
 assert.equal(catalog.renderWallpapers().includes('已应用到桌面'),true);
 await assert.rejects(()=>catalog.applyWallpaper('not-a-product'),/壁纸不存在/);
 assert.equal(env.calls.length,1);
});
test('widgets use real ds_layout_v14 as read-only status and navigate to the native manager',()=>{
 const env=environment({v:14,pages:[['clock-lg','photowall']],dock:[],removed:[]});
 const html=env.catalog.renderWidgets();
 assert.match(html,/已添加 · 管理/);
 assert.match(html,/添加到桌面/);
 assert.match(html,/12 款精选入口/);
 assert.equal(env.catalog.widgetRoute('clock-lg'),true);
 assert.equal(env.location.href,'../desktop/widgets.html?widget=clock-lg');
 assert.equal(env.catalog.widgetRoute('invented'),false);
 assert.equal(env.location.href,'../desktop/widgets.html?widget=clock-lg');
 assert.match(widgetManager,/var LS_KEY = 'ds_layout_v14'/);
 assert.match(widgetManager,/URLSearchParams\(window\.location\.search\)/);
 assert.match(widgetManager,/target\.classList\.add\('is-store-target'\)/);
 assert.match(widgetManager,/function addWidget\(layout, id\)/);
 assert.doesNotMatch(extension,/localStorage\.setItem\(|localStorage\.removeItem\(/);
 assert.equal(env.storage.ds_layout_v14,JSON.stringify({v:14,pages:[['clock-lg','photowall']],dock:[],removed:[]}));
});
test('store navigation only exposes verified native destinations',()=>{
 const e=environment(),api=e.catalog;
 assert.equal(api.route('icons'),true);
 assert.equal(e.location.href,'../settings/icon-settings.html');
 assert.equal(api.route('beauty'),true);
 assert.equal(e.location.href,'../beauty/beauty.html');
 assert.equal(api.route('appearance'),true);
 assert.equal(e.location.href,'../settings/appearance.html');
 assert.equal(api.route('../../malicious'),false);
 assert.equal(e.location.href,'../settings/appearance.html');
 for(const link of ['settings/icon-settings.html','settings/appearance.html','desktop/widgets.html']){
  assert.ok(serviceWorker.includes("'./"+link+"'"),link+' cached');
 }
});
test('store HTML loads actual runtime assets and only adjusts the atmosphere feature presentation',()=>{
 assert.match(store,/wallpaper-store\.js\?v=20261026v2/);
 assert.match(store,/atmosphere-icons\.js\?v=20261112i1/);
 assert.match(store,/market-expansion\.js\?v=20261112m1/);
 assert.match(store,/market-expansion\.css\?v=20261112m1/);
 assert.match(store,/currentCategory='discover'/);
 assert.match(store,/market\.renderWidgets\(\)/);
 assert.match(store,/market\.renderWallpapers\(\)/);
 assert.match(store,/market\.applyWallpaper\(id\)/);
 assert.match(store,/market\.widgetRoute\(id\)/);
 assert.match(store,/else if\(currentCategory==='fonts'\)content\.innerHTML=renderFonts\(\)/);
 assert.match(store,/else if\(currentCategory==='bubbles'\)content\.innerHTML=renderBubbles\(\)/);
 assert.match(store,/else if\(currentCategory==='themes'\)content\.innerHTML=renderThemes\(\)/);
 assert.match(serviceWorker,/phone-app-pwa-v217/);
 assert.match(serviceWorker,/theme-store\/market-expansion\.js\?v=20261112m1/);
});
