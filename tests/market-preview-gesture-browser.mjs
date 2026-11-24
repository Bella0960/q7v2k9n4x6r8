/* PREVIEW-004 专项回归：五页手机预览的手势翻页、弹层生命周期与只读隔离。
 * 裸 http server（跨平台路径校验），headless Chromium，视口 320/375/390/430。
 * 预览始终为虚构示例；打开 / 滑动 / 关闭不得写入 ChatBeauty、localStorage 或 IndexedDB。 */
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

async function swipe(ctx,page,locator,dx,dy){
 const box=await locator.boundingBox();
 assert.ok(box&&box.width>0,'visual box measurable');
 const touch=await ctx.newCDPSession(page);
 const x=box.x+box.width*.5,y=box.y+box.height*.5;
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 const steps=6;
 for(let i=1;i<=steps;i++){
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/steps,y:y+dy*i/steps}]});
 }
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await touch.detach();
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
// The featured entry button may or may not be mounted by the current storefront shell;
// the public preview() API is the same entry either way. Prefer a real click when present.
async function openPreview(page){
 const btn=page.locator('[data-action="market-preview"]');
 if(await btn.count())await btn.first().click();
 else await page.evaluate(()=>window.MAOMAOMarketExpansion.preview('atmosphere'));
 await page.waitForSelector('.market-preview-overlay');
}

try{
for(const width of [320,375,390,430]){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:width<500});
 const page=await ctx.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));

 await page.goto(base+'/theme-store/theme-store.html');
 await page.waitForSelector('.sf-product, .sf-theme-item');
 const entryButtonCount=await page.locator('[data-action="market-preview"]').count();

 // 主页面先滚到中部，验证关闭后滚动偏移保持。
 await page.locator('#storeContent').evaluate(el=>{el.scrollTop=Math.max(60,el.scrollHeight*.4);});
 const rememberedTop=await page.locator('#storeContent').evaluate(el=>el.scrollTop);
 const storageBefore=await page.evaluate(()=>JSON.stringify({...localStorage}));
 const themeBefore=await page.evaluate(()=>window.ChatBeauty&&ChatBeauty.getThemePreset&&ChatBeauty.getThemePreset());

 // 1. 打开预览：初始第 0 页，文案 / aria-selected 同步。
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

 // 5. 手势与键盘同时可用：tab 聚焦后方向键继续翻页。
 await page.locator('.market-preview-tabs button').first().click();
 await page.keyboard.press('ArrowRight');
 assert.equal(await selectedTab(page),SCREENS[1],'arrow right works after gesture session');
 await page.keyboard.press('ArrowLeft');
 assert.equal(await selectedTab(page),SCREENS[0],'arrow left works after gesture session');

 // 6. Tab / Shift+Tab 焦点约束循环：backdrop 为首个可聚焦按钮，apply 为末个。
 const all=await page.locator('.market-preview-overlay button').all();
 const visible=[];
 for(const b of all){if(await b.boundingBox())visible.push(b);}
 const last=visible[visible.length-1];
 await last.focus();
 await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭预览','Tab wraps from last to backdrop');
 await page.keyboard.press('Shift+Tab');
 assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'应用这个主题','Shift+Tab wraps from backdrop to apply');

 // 7. Esc 关闭：清理 overlay / 滚动锁 / 焦点，滚动位置与存储保持。
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('.market-preview-overlay').count(),0,'overlay removed on Esc');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'','body scroll lock released');
 assert.equal((await previewState(page)).open,false,'closed state reported');
 assert.equal((await previewState(page)).gestureActive,false,'no stale gesture state');
 assert.ok(await page.evaluate(()=>document.activeElement&&document.activeElement.isConnected),'focus returns to a live element after close');
 assert.ok(Math.abs(await page.locator('#storeContent').evaluate(el=>el.scrollTop)-rememberedTop)<5,'main scroll offset preserved after close');

 // 8. 遮罩点击关闭同样清理。
 await openPreview(page);
 await page.locator('.market-preview-backdrop').evaluate(b=>b.click());
 assert.equal(await page.locator('.market-preview-overlay').count(),0,'backdrop click closes overlay');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'','scroll lock released after backdrop close');

 // 9. 反复开关 50 次：不残留 overlay / 滚动锁 / 手势状态，无报错。
 for(let round=0;round<50;round++){
  await openPreview(page);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.market-preview-overlay').count(),0,'round '+round+' overlay removed');
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden','round '+round+' no scroll lock left');
  const st=await previewState(page);
  assert.equal(st.open,false,'round '+round+' closed state');
  assert.equal(st.gestureActive,false,'round '+round+' gesture cleared');
 }

 // 10. 50 次开关后手势仍生效，监听器未失效。
 await openPreview(page);
 await swipe(ctx,page,visual,-120,0);
 assert.equal(await selectedTab(page),SCREENS[1],'gesture still works after 50 open/close cycles');
 await page.keyboard.press('Escape');

 // 11. 全程只读：localStorage 与当前主题预设未被预览改动。
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storageBefore,'preview writes no localStorage');
 assert.equal(await page.evaluate(()=>window.ChatBeauty&&ChatBeauty.getThemePreset&&ChatBeauty.getThemePreset()),themeBefore,'preview does not change applied theme');
 assert.deepEqual(errors,[],'no page errors');
 count++;
 console.log('PASS preview-gesture width '+width+' (mounted entry buttons: '+entryButtonCount+'): five-screen order, swipe thresholds, lifecycle cleanup, focus loop, read-only');
 await ctx.close();
}
}finally{
 await browser.close();
 await new Promise(r=>server.close(r));
}
console.log(count+' preview-gesture scenarios passed');
