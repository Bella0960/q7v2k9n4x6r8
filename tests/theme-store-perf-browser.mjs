/* PERF-002 专项回归：新版商城栏目状态、收藏一致性、横滑不误触、滚动位置与离屏动画暂停。
 * 裸 http server（跨平台路径校验），headless Chromium，视口 375/390/430。
 * 只读既有存储与界面，不写入角色/聊天/账号数据。 */
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
    if(!p.startsWith(root)) throw Error();
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[extname(p)]||'application/octet-stream');
    res.end(readFileSync(p));
  }catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await pw.chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});

let count=0;
try{
for(const width of [375,390,430]){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));

  await page.goto(base+'/theme-store/theme-store.html');
  await page.waitForSelector('.sf-feature, .sf-theme-item');

  // 1. 首页精选与主题卡片渲染，栏目高亮为 discover。
  assert.equal(await page.locator('#categoryNav button.active').getAttribute('data-category'),'discover');
  const featured=page.locator('.sf-featured');
  assert.ok(await featured.count(),'featured rail exists on discover');

  // 2. 切到主题栏目：六套原版主题分区齐全，高亮跟随。
  await page.locator('#categoryNav button[data-category="themes"]').click();
  await page.waitForSelector('.sf-theme-item');
  assert.equal(await page.locator('#categoryNav button.active').getAttribute('data-category'),'themes');
  assert.equal(await page.locator('.sf-theme-collection .sf-theme-item').count(),6,'six showcase sections');

  // 3. 列表内收藏 / 取消收藏：星标状态即时同步，不打开弹窗。
  const firstFav=page.locator('.sf-theme-item .sf-favorite[data-sf="favorite"]').first();
  const favId=await firstFav.getAttribute('data-id');
  await firstFav.click();
  assert.equal(await firstFav.getAttribute('aria-pressed'),'true','favorite toggles on');
  assert.equal(await page.locator('.sf-dialog').count(),0,'list favorite must not open dialog');
  await firstFav.click();
  assert.equal(await firstFav.getAttribute('aria-pressed'),'false','favorite toggles off');

  // 4. 详情弹窗内收藏：弹窗保持打开，文案与 pressed 同步；关闭后焦点回到对应主题。
  const cover=page.locator('.sf-theme-cover[data-sf="detail"][data-id="'+favId+'"]').first();
  await cover.click();
  await page.waitForSelector('.sf-dialog');
  const dialogFav=page.locator('.sf-dialog [data-sf="favorite"][data-id="'+favId+'"]');
  await dialogFav.click();
  assert.ok(await page.locator('.sf-dialog').isVisible(),'favoriting in detail keeps dialog open');
  assert.equal(await dialogFav.getAttribute('aria-pressed'),'true');
  await page.locator('.sf-dialog [data-sf="close"]').click();
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-id')),favId,'focus returns to the themed item after rerender');

  // 5. 我的 · 收藏栏与刚才的收藏一致（readCache 不能留下陈旧状态）。
  await page.locator('#categoryNav button[data-category="mine"]').click();
  await page.locator('[data-sf="mine-tab"][data-id="favorites"]').click();
  const mineFav=page.locator('.sf-favorite[data-sf="favorite"][data-id="'+favId+'"]');
  assert.equal(await mineFav.count(),1,'favorited theme appears in mine/favorites');

  // 6. 回首页横滑精选：横向滚动生效，且横滑不误触打开详情弹窗。
  await page.locator('#categoryNav button[data-category="discover"]').click();
  const rail=page.locator('.sf-featured');
  const railBox=await rail.boundingBox();
  const railY=railBox.y+railBox.height*.5;
  const touch=await ctx.newCDPSession(page);
  const startX=railBox.x+railBox.width*.8;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:startX,y:railY}]});
  for(let i=1;i<=12;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:startX-i*railBox.width*.08,y:railY}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.detach();
  assert.ok(await rail.evaluate(el=>el.scrollLeft>0),'horizontal rail scrolls');
  assert.equal(await page.locator('.sf-dialog').count(),0,'swiping rail must not open detail');

  // 7. 滑出轨道的封面被暂停；视口内封面不被误标。IO 为异步回调，按状态等待而非固定延时。
  await page.waitForFunction(()=>{const s=document.querySelectorAll('.sf-feature-scene');return s[0]&&s[0].classList.contains('is-offscreen');});
  const offscreenOnScreen=()=>page.evaluate(()=>{
    const content=document.getElementById('storeContent').getBoundingClientRect();
    return [...document.querySelectorAll('.sf-feature-scene')].filter(el=>{
      const r=el.getBoundingClientRect();
      const intersects=r.right>content.left&&r.left<content.right&&r.bottom>content.top&&r.top<content.bottom;
      return intersects&&el.classList.contains('is-offscreen');
    }).length;
  });
  assert.equal(await offscreenOnScreen(),0,'on-screen featured art is not paused');

  // 7b. 滑回可视区后，重新进入视口的封面解除暂停；视口内不残留被误暂停的封面。
  const touchBack=await ctx.newCDPSession(page);
  const backBox=await rail.boundingBox();
  const backX=backBox.x+backBox.width*.2;
  await touchBack.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:backX,y:railY}]});
  for(let i=1;i<=12;i++)await touchBack.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:backX+i*backBox.width*.08,y:railY}]});
  await touchBack.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  touchBack.detach();
  await page.waitForFunction(()=>{
    const content=document.getElementById('storeContent').getBoundingClientRect();
    return [...document.querySelectorAll('.sf-feature-scene')].filter(el=>{
      const r=el.getBoundingClientRect();
      const intersects=r.right>content.left&&r.left<content.right&&r.bottom>content.top&&r.top<content.bottom;
      return intersects&&el.classList.contains('is-offscreen');
    }).length===0;
  });

  // 8. 主题列表纵滑后位置稳定，pageshow 不跳回顶部。
  await page.locator('#categoryNav button[data-category="themes"]').click();
  await page.locator('#storeContent').evaluate(el=>{el.scrollTop=el.scrollHeight*.5;});
  const remembered=await page.locator('#storeContent').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));
  const restored=await page.locator('#storeContent').evaluate(el=>el.scrollTop);
  assert.ok(Math.abs(restored-remembered)<5,'scroll position survives pageshow');

  // 9. 连续 50 轮「首页↔主题↔我的」往返：观察目标数与当前 DOM 一致，且不跨轮增长（旧节点已释放）。
  const switchCat=async cat=>page.locator('#categoryNav button[data-category="'+cat+'"]').click();
  const watchedCount=()=>page.evaluate(()=>window.MAOMAOStorefront._animWatchedCount());
  let baselineWatched=0;
  for(let round=0;round<2;round++){
    for(let i=0;i<50;i++){await switchCat('discover');await switchCat('themes');await switchCat('mine');}
    await switchCat('discover');
    await page.waitForSelector('.sf-feature-scene');
    const watched=await watchedCount();
    const live=await page.locator('.sf-feature-scene').count();
    assert.equal(watched,live,'observer targets match live DOM after 50 round-trips');
    if(round===0)baselineWatched=watched;
    else assert.equal(watched,baselineWatched,'observer target count does not grow across rounds');
  }

  assert.deepEqual(errors,[],'no page errors');
  count++;
  console.log('PASS perf width '+width+': category state, favorite sync, rail swipe, scroll restore, on-screen motion');
  await ctx.close();
}
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}
console.log(count+' perf scenarios passed');
