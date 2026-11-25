/**
 * STAGE04 MARKET INTEGRATION QA: synthetic Chromium smoke for widget route highlight,
 * studio <-> storefront <-> beauty cross-links and three-viewport overflow.
 * Local static assets only; no paid API, account, real photo or production endpoint.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve('.');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  try{
    let pathname=new URL(req.url||'/','http://localhost').pathname;
    pathname=decodeURIComponent(pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const filename=resolve(root,'.'+pathname);
    if(!filename.startsWith(root+sep)){res.writeHead(403).end();return;}
    let bytes=await readFile(filename);
    res.writeHead(200,{'Content-Type':MIME[extname(filename)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch{res.writeHead(404).end('Not Found');}
});
await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let count=0;
const pass=(name)=>{count++;console.log('STAGE04_PASS '+name);};

const WIDGET_IDS=['clock-lg','photowall','postcard','music','calendar','todo','polaroid','social','note','stack','countdown','dialog'];

async function newPage(width,errors){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:width<500});
  const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  return {ctx,page};
}

// ---- A: widget route highlight ----
for(const id of WIDGET_IDS){
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/desktop/widgets.html?widget='+encodeURIComponent(id),{waitUntil:'load',timeout:40000});
  await page.waitForSelector('[data-widget="'+id+'"]');
  await page.waitForTimeout(450);
  const target=page.locator('[data-widget="'+id+'"].is-target');
  assert.equal(await target.count(),1,'highlight target for '+id);
  const others=await page.locator('.widget-item.is-target').count();
  assert.equal(others,1,'only one highlighted item for '+id);
  const rect=await page.evaluate(id=>{const t=document.querySelector('[data-widget="'+id+'"].is-target');if(!t)return null;const r=t.getBoundingClientRect();return {top:r.top,h:r.height};},id);
  const vh=await page.evaluate(()=>innerHeight);
  assert.ok(rect&&rect.top>=0&&rect.top+rect.h<=vh,'highlighted '+id+' is within viewport');
  assert.equal(await page.evaluate(()=>localStorage.getItem('ds_layout_v14')),null,'route highlight must not write layout storage for '+id);
  assert.deepEqual(errors,[],'no page errors for '+id);
  await ctx.close();
  pass('widget locate/highlight '+id);
}

// Illegal parameter falls back cleanly, no highlight, no storage write.
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/desktop/widgets.html?widget=not-a-real-widget',{waitUntil:'load'});
  await page.waitForSelector('.widget-item');
  assert.equal(await page.locator('.widget-item.is-target').count(),0,'illegal widget id highlights nothing');
  assert.equal(await page.evaluate(()=>localStorage.getItem('ds_layout_v14')),null);
  assert.deepEqual(errors,[]);
  await ctx.close();pass('illegal widget param falls back cleanly');
}

// No parameter: page renders, no highlight.
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/desktop/widgets.html',{waitUntil:'load'});
  await page.waitForSelector('.widget-item');
  assert.equal(await page.locator('.widget-item.is-target').count(),0,'bare manager has no highlight');
  assert.deepEqual(errors,[]);
  await ctx.close();pass('widget manager without param renders cleanly');
}

// Highlight must not mutate an existing preset layout.
{
  const preset={v:14,pages:[['clock-lg','app_chat']],dock:['app_chat'],removed:['note']};
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/desktop/widgets.html',{waitUntil:'load'});
  await page.evaluate(p=>localStorage.setItem('ds_layout_v14',JSON.stringify(p)),preset);
  await page.goto(origin+'/desktop/widgets.html?widget=music',{waitUntil:'load'});
  await page.waitForSelector('[data-widget="music"].is-target');
  const after=await page.evaluate(()=>localStorage.getItem('ds_layout_v14'));
  assert.equal(after,JSON.stringify(preset),'existing layout preserved through route highlight');
  assert.deepEqual(errors,[]);
  await ctx.close();pass('route highlight preserves existing layout storage');
}

// Highlight class is removed after the transient window (default motion).
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/desktop/widgets.html?widget=postcard',{waitUntil:'load'});
  await page.waitForSelector('[data-widget="postcard"].is-target');
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('.widget-item.is-target').count(),0,'transient highlight clears');
  await ctx.close();pass('transient highlight clears after timeout');
}

// ---- B: three-way cross links ----
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/theme-store/theme-store.html',{waitUntil:'load'});
  await page.waitForSelector('.sf-product');
  await page.locator('[data-category="categories"]').click();
  await page.waitForSelector('.sf-category-row');
  const studioRow=page.locator('[data-sf="category"][data-id="studio"]');
  assert.equal(await studioRow.count(),1,'studio entry in chat-beauty category');
  assert.match(await studioRow.innerText(),/高级主题工作台/);
  await studioRow.click();
  await page.waitForURL(/theme-studio\/theme-studio\.html/);
  assert.ok(page.url().includes('theme-studio/theme-studio.html'),'storefront routes to studio');
  await ctx.close();pass('storefront -> studio entry navigates');
}
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/theme-studio/theme-studio.html',{waitUntil:'load'});
  await page.waitForTimeout(300);
  const storeLink=page.locator('.utilities a[href="../theme-store/theme-store.html"]');
  assert.equal(await storeLink.count(),1,'studio links back to storefront');
  assert.match(await storeLink.innerText(),/主题商城/);
  const beautyLink=page.locator('.utilities a[href="../beauty/beauty.html"]');
  assert.equal(await beautyLink.count(),1,'studio keeps beauty centre link');
  await ctx.close();pass('studio -> storefront / beauty links present');
}
{
  const errors=[];const {ctx,page}=await newPage(390,errors);
  await page.goto(origin+'/beauty/beauty.html',{waitUntil:'load'});
  await page.waitForTimeout(300);
  assert.equal(await page.locator('a[href="../theme-store/theme-store.html"]').count(),1,'beauty centre links to storefront');
  await ctx.close();pass('beauty centre -> storefront link present');
}

// ---- D: three-viewport overflow, no page errors ----
for(const width of [375,390,430]){
  for(const [name,path] of [['storefront','/theme-store/theme-store.html'],['studio','/theme-studio/theme-studio.html']]){
    const errors=[];const {ctx,page}=await newPage(width,errors);
    await page.goto(origin+path,{waitUntil:'load'});
    await page.waitForTimeout(400);
    if(name==='storefront'){await page.locator('[data-category="categories"]').click();await page.waitForTimeout(200);}
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`${name} ${width}px no horizontal overflow`);
    assert.deepEqual(errors,[],`${name} ${width}px no page errors`);
    await ctx.close();pass(`${name} ${width}px clean`);
  }
}

await browser.close();
await new Promise(r=>server.close(r));
console.log(count+' stage04 browser scenarios passed');
