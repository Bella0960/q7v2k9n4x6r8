import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer((req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[extname(p)]||'application/octet-stream');res.end(readFileSync(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await pw.chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']}: {})});
let count=0;
try{
for(const width of [320,375,390,430,1280]){
 const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:width<500});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/theme-store/theme-store.html');await page.waitForSelector('.sf-product');
 assert.deepEqual(await page.locator('#categoryNav button').allTextContents(),['首页','主题','分类','我的']);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 const columns=await page.locator('.sf-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(columns,2);
 const nav=await page.locator('#categoryNav').boundingBox();assert.ok(nav.y+nav.height<=845);assert.ok(nav.y>700);
 const rail=page.locator('.sf-featured');await rail.evaluate(el=>el.scrollLeft=el.clientWidth);assert.ok(await rail.evaluate(el=>el.scrollLeft>0));
 const before=await page.evaluate(()=>JSON.stringify({...localStorage}));
 await page.locator('[data-sf="detail"][data-id="atmosphere"]').last().click();
 for(const id of ['desktop','list','detail','moments','mine','home'])await page.locator('[data-sf="page"][data-id="'+id+'"]').click();
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),before,'preview must not change storage');
 await page.locator('[data-sf="close"]').click();
 await page.locator('[data-category="themes"]').click();
 for(const id of ['wechat','imessage','qq','silver-butterfly','atmosphere','default']){
  await page.locator('.sf-cover[data-id="'+id+'"]').click();await page.locator('[data-sf="apply-theme"]').click();
  assert.equal(await page.evaluate(()=>ChatBeauty.getThemePreset()),id);
 }
 await page.locator('[data-sf="favorite"][data-id="wechat"]').click();
 await page.locator('[data-category="mine"]').click();assert.equal(await page.locator('.sf-product').count(),1);
 await page.locator('[data-sf="mine-tab"][data-id="outfits"]').click();await page.locator('[data-sf="save-outfit"]').click();
 await page.locator('#sfName').fill('周末留白');for(const checkbox of await page.locator('[name="scope"]').all())await checkbox.uncheck();await page.locator('[name="scope"][value="theme"]').check();await page.locator('[data-sf="confirm-save"]').click();assert.equal(await page.locator('.sf-record').count(),1);
 await page.reload();await page.locator('[data-category="mine"]').click();await page.locator('[data-sf="mine-tab"][data-id="outfits"]').click();assert.equal(await page.locator('.sf-record').count(),1);
 await page.locator('[data-sf="rename"]').click();await page.locator('#sfName').fill('新的名字');await page.locator('[data-sf="confirm-rename"]').click();assert.ok((await page.locator('.sf-record-main').innerText()).includes('新的名字'));
 await page.evaluate(()=>ChatBeauty.setThemePreset('wechat'));
 await page.locator('[data-sf="record-preview"]').first().click();await page.locator('[data-sf="record-apply"]').click();assert.equal(await page.evaluate(()=>ChatBeauty.getThemePreset()),'default');
 await page.locator('[data-sf="delete"]').click();assert.equal(await page.evaluate(()=>MAOMAOMarketCollection.read().outfits.length),1);await page.locator('[data-sf="close"]').first().click();assert.equal(await page.locator('.sf-record').count(),1);
 await page.locator('[data-sf="delete"]').click();await page.locator('[data-sf="confirm-delete"]').click();assert.equal(await page.locator('.sf-record').count(),0);
 await page.locator('[data-sf="mine-tab"][data-id="creations"]').click();await page.locator('[data-sf="upload"]').click();await page.locator('#sfName').fill('我自己的素材');await page.locator('#sfFile').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA8sAAAAASUVORK5CYII=','base64')});await page.locator('[data-sf="confirm-upload"]').click();await page.waitForSelector('.sf-record');
 await page.locator('[data-sf="record-preview"]').first().click();await page.waitForSelector('.sf-image');await page.locator('[data-sf="record-apply"]').click();assert.ok((await page.evaluate(()=>MAOMAOWallpaperStore.get())).startsWith('data:image/webp;'));
 assert.ok(!(await page.evaluate(()=>localStorage.getItem('maomao_market_collection_v1'))).includes('base64'));
 await page.locator('[data-category="categories"]').click();assert.equal(await page.locator('.sf-category-row').count(),9);
 await page.locator('[data-sf="category"][data-id="bubbles"]').click();await page.waitForSelector('.bubble-list');
 assert.deepEqual(errors,[]);count++;console.log('PASS width '+width+': navigation, preview isolation, six themes, favorites, outfit CRUD/apply, image persistence, categories');await ctx.close();
}
const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});const page=await ctx.newPage();await page.goto(base+'/theme-store/theme-store.html');await page.waitForSelector('.sf-feature-scene');assert.equal(await page.locator('.sf-feature-scene').first().evaluate(el=>getComputedStyle(el).animationName),'none');await ctx.close();console.log('PASS reduced motion');count++;
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log(count+' browser scenarios passed');
