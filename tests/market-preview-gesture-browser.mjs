/* PREVIEW-004 专项回归：五页手机预览的真实入口、手势翻页、弹层生命周期与只读隔离。
 * 裸 http server（跨平台路径校验），headless Chromium，视口 320/375/390/430。
 * 预览始终为虚构示例；打开 / 滑动 / 关闭不得写入 ChatBeauty、localStorage 或 IndexedDB。
 *
 * 入口约定：主回归由 theme-store.html 自行加载真实商城首页（MAOMAOStorefront.render('discover')），
 * 断言首页真实 [data-action="market-preview"] 按钮存在、可见、未禁用，再用 Playwright 真实点击进入；
 * 不做 innerHTML 人工注入，不用内部 API 兜底。直接调用 preview() 仅在末尾单独标注的 API 级用例中使用。 */
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');

const server=createServer((req,res)=>{
 try{
  const p=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!p.toLowerCase().startsWith(root.toLowerCase()))throw Error();
  res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[extname(p)]||'application/octet-stream');
  res.end(readFileSync(p));
 }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await pw.chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});

const SCREENS=['聊天首页','聊天详情','动态','我的','我的主页'];
let count=0;

// Multi-segment track: points are [dx,dy] steps from the visual center; end as
// touchEnd or touchCancel. Drives the real PointerEvent gesture on the DOM.
async function gestureTrack(ctx,page,locator,points,endType='touchEnd'){
 const box=await locator.boundingBox();
 assert.ok(box&&box.width>0,'visual box measurable');
 const touch=await ctx.newCDPSession(page);
 const x=box.x+box.width*.5,y=box.y+box.height*.5;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(const [dx,dy] of points){
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
 }
 await touch.send('Input.dispatchTouchEvent',{type:endType,touchPoints:[]});
 await touch.detach();
}
async function swipe(ctx,page,locator,dx,dy){
 await gestureTrack(ctx,page,locator,[[dx,dy]],'touchEnd');
}
async function tapHold(ctx,page,locator){
 const box=await locator.boundingBox();
 const touch=await ctx.newCDPSession(page);
 const x=box.x+box.width*.5,y=box.y+box.height*.5;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await touch.detach();
}
const currentName=page=>page.locator('.market-preview-current').innerText();
const selectedTab=page=>page.locator('.market-preview-tabs button[aria-selected="true"]').innerText();
const previewState=page=>page.evaluate(()=>window.MAOMAOMarketExpansion._previewState());

// The real homepage entry: the storefront renders its own discover view; wait for
// the genuine preview button mounted in that DOM, then assert it is one visible,
// enabled button. No innerHTML injection, no internal API fallback.
async function assertEntryButton(page){
 const btn=page.locator('[data-action="market-preview"]');
 await btn.waitFor({state:'visible'});
 assert.equal(await btn.count(),1,'real preview entry button rendered once on the homepage');
 const box=await btn.boundingBox();
 assert.ok(box&&box.width>0&&box.height>0,'entry button visible');
 assert.equal(await btn.isDisabled(),false,'entry button enabled');
 return btn;
}
async function openPreview(page){
 // Real Playwright click on the genuine entry button (visibility / hit-test /
 // focus checks run through the normal user path).
 await (await assertEntryButton(page)).click();
 await page.waitForSelector('.market-preview-overlay');
}
// Install a counter for indexedDB.open after page load; counts only open calls,
// not per-transaction writes. Read-only check complements localStorage/theme assertions.
async function installIdbCounter(page){
 await page.evaluate(()=>{
  if(!window.__idbOpenCount){
   window.__idbOpenCount=0;
   const open=indexedDB.open.bind(indexedDB);
   indexedDB.open=function(...args){window.__idbOpenCount++;return open(...args);};
  }
 });
}

try{
for(const width of [320,375,390,430]){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:width<500});
 const page=await ctx.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));

 await page.goto(base+'/theme-store/theme-store.html');
 // Wait for the real storefront homepage to mount its preview entry.
 await assertEntryButton(page);
 await installIdbCounter(page);
 const entryButtonCount=await page.locator('[data-action="market-preview"]').count();

 // Record the natural scroll offset before opening; closing must restore it.
 const rememberedTop=await page.locator('#storeContent').evaluate(el=>el.scrollTop);
 const storageBefore=await page.evaluate(()=>JSON.stringify({...localStorage}));
 const themeBefore=await page.evaluate(()=>window.ChatBeauty&&ChatBeauty.getThemePreset&&ChatBeauty.getThemePreset());
 const idbBefore=await page.evaluate(()=>window.__idbOpenCount);

 // 1. 真实入口打开预览：初始第 0 页，文案 / aria-selected 同步。
 await openPreview(page);
 assert.equal((await previewState(page)).open,true,'overlay open state');
 assert.equal(await currentName(page),SCREENS[0]+' / 干净的会话节奏','first screen on open');
 assert.equal(await selectedTab(page),SCREENS[0],'first tab selected');
 assert.equal(await page.locator('.market-preview-tabs button').count(),5,'five preview tabs');

 // 2. 按钮翻页：五页顺序准确，循环回到首页。
 for(let i=1;i<=4;i++){
  await page.locator('[data-market-next]').click();
  assert.match(await currentName(page),new RegExp('^'+SCREENS[i]+' / '),'next reaches screen '+i);
  assert.equal(await selectedTab(page),SCREENS[i],'tab follows next button');
 }
 await page.locator('[data-market-next]').click();
 assert.equal(await selectedTab(page),SCREENS[0],'next wraps back to first screen');
 await page.locator('[data-market-prev]').click();
 assert.equal(await selectedTab(page),SCREENS[4],'prev wraps back to last screen');

 // 3. 手势：左滑一次仅翻一页（当前第 5 页，循环到第 1 页）；右滑一次回上一页。
 const visual=page.locator('.market-preview-visual');
 await swipe(ctx,page,visual,-120,0);
 assert.equal(await selectedTab(page),SCREENS[0],'left swipe moves one page forward');
 await swipe(ctx,page,visual,120,0);
 assert.equal(await selectedTab(page),SCREENS[4],'right swipe moves one page back');

 // 4. 纵向滑动不误触；短点按不误触。
 const beforeVertical=await selectedTab(page);
 await swipe(ctx,page,visual,0,90);
 assert.equal(await selectedTab(page),beforeVertical,'vertical swipe does not turn page');
 await tapHold(ctx,page,visual);
 assert.equal(await selectedTab(page),beforeVertical,'short tap does not turn page');

 // 5. 取消手势：滑过阈值后被取消，不翻页、手势状态清空，下一次横滑仍生效。
 await gestureTrack(ctx,page,visual,[[-70,0]],'touchCancel');
 assert.equal(await selectedTab(page),SCREENS[4],'cancelled gesture does not turn page');
 assert.equal((await previewState(page)).gestureActive,false,'cancelled gesture clears state');
 await swipe(ctx,page,visual,-120,0);
 assert.equal(await selectedTab(page),SCREENS[0],'next swipe still works after cancel');

 // 6. 回拉：先滑过阈值再退回起点附近，结束不翻页。
 await gestureTrack(ctx,page,visual,[[-70,0],[0,0]],'touchEnd');
 assert.equal(await selectedTab(page),SCREENS[0],'pull-back to start does not turn page');

 // 7. 反向变化：先右滑再 settle 到左侧，按最终位置方向翻一页。
 await gestureTrack(ctx,page,visual,[[70,0],[-70,0]],'touchEnd');
 assert.equal(await selectedTab(page),SCREENS[1],'reverse settle follows final position');

 // 8. 手势与键盘同时可用：tab 聚焦后方向键继续翻页。
 await page.locator('.market-preview-tabs button').first().click();
 await page.keyboard.press('ArrowRight');
 assert.equal(await selectedTab(page),SCREENS[1],'arrow right works after gesture session');
 await page.keyboard.press('ArrowLeft');
 assert.equal(await selectedTab(page),SCREENS[0],'arrow left works after gesture session');

 // 9. Tab / Shift+Tab 焦点约束循环：backdrop 为首个可聚焦按钮，apply 为末个。
 const all=await page.locator('.market-preview-overlay button').all();
 const visible=[];
 for(const b of all){if(await b.boundingBox())visible.push(b);}
 const last=visible[visible.length-1];
 await last.focus();
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭预览','Tab wraps from last to backdrop');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'应用这个主题','Shift+Tab wraps from backdrop to apply');

 // 10. Esc 关闭：清理 overlay / 滚动锁 / 焦点，滚动位置与存储保持。
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.market-preview-overlay').count(),0,'overlay removed on Esc');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'','body scroll lock released');
 assert.equal((await previewState(page)).open,false,'closed state reported');
 assert.equal((await previewState(page)).gestureActive,false,'no stale gesture state');
 assert.ok(await page.evaluate(()=>document.activeElement&&document.activeElement.isConnected),'focus returns to a live element after close');
 assert.ok(Math.abs(await page.locator('#storeContent').evaluate(el=>el.scrollTop)-rememberedTop)<5,'main scroll offset preserved after close');

 // 11. 从真实入口第二次打开，遮罩点击关闭同样清理。
 // backdrop 被 dialog 本体覆盖，命中测试点不透；这里直接在遮罩元素上派发关闭点击，
 // 不代表产品入口路径（入口始终走上面 openPreview 的真实按钮点击）。
 await openPreview(page);
 await page.locator('.market-preview-backdrop').evaluate(b=>b.click());
 assert.equal(await page.locator('.market-preview-overlay').count(),0,'backdrop click closes overlay');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'','scroll lock released after backdrop close');

 // 12. 反复开关 50 次：每次都从真实入口打开，不残留 overlay / 滚动锁 / 手势状态，无报错。
 for(let round=0;round<50;round++){
  await openPreview(page);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.market-preview-overlay').count(),0,'round '+round+' overlay removed');
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','round '+round+' no scroll lock left');
  const st=await previewState(page);
  assert.equal(st.open,false,'round '+round+' closed state');
  assert.equal(st.gestureActive,false,'round '+round+' gesture cleared');
 }

 // 13. 50 次开关后手势仍生效，监听器未失效。
 await openPreview(page);
 await swipe(ctx,page,visual,-120,0);
 assert.equal(await selectedTab(page),SCREENS[1],'gesture still works after 50 open/close cycles');
 await page.keyboard.press('Escape');

 // 14. 全程只读：localStorage、当前主题预设、IDB open 计数均未被预览改动。
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storageBefore,'preview writes no localStorage');
 assert.equal(await page.evaluate(()=>window.ChatBeauty&&ChatBeauty.getThemePreset&&ChatBeauty.getThemePreset()),themeBefore,'preview does not change applied theme');
 assert.equal(await page.evaluate(()=>window.__idbOpenCount),idbBefore,'preview opens no new IndexedDB database');
 assert.deepEqual(errors,[],'no page errors');
 count++;
 console.log('PASS preview-gesture width '+width+' (entry buttons: '+entryButtonCount+'): real homepage entry click, swipe thresholds, cancel/pull-back/reverse, lifecycle cleanup, focus loop, read-only');
 await ctx.close();
}

// API 级 sanity（非页面入口路径）：直接调用公开 preview() 模块入口可用且可清理。
const apiCtx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
const apiPage=await apiCtx.newPage();
await apiPage.goto(base+'/theme-store/theme-store.html');
await apiPage.waitForSelector('[data-action="market-preview"]');
await apiPage.evaluate(()=>window.MAOMAOMarketExpansion.preview('atmosphere'));
await apiPage.waitForSelector('.market-preview-overlay');
assert.equal((await apiPage.evaluate(()=>window.MAOMAOMarketExpansion._previewState())).open,true,'direct API preview opens');
await apiPage.keyboard.press('Escape');
assert.equal(await apiPage.locator('.market-preview-overlay').count(),0,'direct API preview closes');
assert.equal((await apiPage.evaluate(()=>window.MAOMAOMarketExpansion._previewState())).gestureActive,false,'direct API preview clears gesture');
await apiCtx.close();
console.log('PASS direct API entry sanity: preview() opens and cleans up');
}finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
console.log(count+' preview-gesture scenarios passed');
