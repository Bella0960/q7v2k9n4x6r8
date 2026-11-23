/**
 * V124 virtual-user acceptance against the actual Vite dist, localhost only.
 * All identities, roles, prompts and images are synthetic; no real AI or
 * authentication endpoints are contacted. Screenshots contain fixtures only.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const output=resolve(root,'test-results/virtual-user');
const shots=resolve(output,'screenshots');
const identity='MAO-VIRTUALTEST0001';
const role={id:'virtual-footprint-01',name:'虚拟验收角色',persona:'每天记录生活和兴趣。',
  appearanceDescription:'short silver hair, amber eyes, simple white shirt',
  styleKeywords:['natural daylight','editorial photography']};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLw+wAAAABJRU5ErkJggg==';
const illustration='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#e7e7e7"/><path d="M0 340 Q160 180 390 310 T800 230 L800 500 L0 500Z" fill="#d2d2d2"/><circle cx="635" cy="105" r="52" fill="#f7f7f7"/></svg>';
const mime={'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8',
  '.js':'text/javascript;charset=utf-8','.json':'application/json',
  '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp',
  '.woff2':'font/woff2'};
const results=[];
const server=http.createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=resolve(dist,'.'+path);
    if(target!==dist&&!target.startsWith(dist+'/'))throw Error('outside dist');
    const info=await stat(target);
    const file=info.isDirectory()?resolve(target,'index.html'):target;
    let bytes=await readFile(file);
    if(extname(file)==='.html'){
      const inject='<meta name="mao-account-id" content="'+identity+'">'+
        '<meta name="mao-account-role" content="user">'+
        '<script>window.__MAO_ACCOUNT_SCOPE__={accountId:"'+identity+'",role:"user",ready:true};</script>';
      bytes=Buffer.from(bytes.toString('utf8').replace(/<head\b[^>]*>/i,s=>s+inject));
    }
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream',
      'cache-control':'no-store'});
    res.end(bytes);
  }catch{res.writeHead(404);res.end('Not Found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
let failure=null;
try{
  await mkdir(shots,{recursive:true});
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [375,390,430]){
    let context;
    const row={width,footprint:'NOT_RUN',ai:'NOT_RUN',screenshots:[],dialogs:0,
      pageErrors:[],mockApiCalls:0,externalApiRequests:0};
    results.push(row);
    try{
      context=await browser.newContext({viewport:{width,height:width===430?932:width===390?844:812},
        isMobile:true,hasTouch:true,deviceScaleFactor:1,reducedMotion:'reduce',
        serviceWorkers:'block',timezoneId:'Asia/Shanghai'});
      await context.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(origin+'/'))return route.continue();
        if(url.startsWith('https://images.unsplash.com/')){
          return route.fulfill({status:200,contentType:'image/svg+xml',body:illustration});
        }
        if(url.startsWith('https://qa-stub.invalid/'))row.externalApiRequests++;
        return route.abort('blockedbyclient');
      });
      await context.addInitScript(({role,png})=>{
        if(!localStorage.getItem('__qa_virtual_init__')){
          localStorage.setItem('ai_custom_characters',JSON.stringify([role]));
          localStorage.setItem('api_settings',JSON.stringify({apiKey:'synthetic-non-secret',
            baseUrl:'https://qa-stub.invalid/v1',model:'synthetic-scene-model',
            imageModel:'synthetic-image-model',
            imageEndpoint:'https://qa-stub.invalid/v1/images/generations'}));
          localStorage.setItem('__qa_virtual_init__','1');
        }
        window.__qaMockCalls=[];
        const original=window.fetch.bind(window);
        window.fetch=function(input,options){
          const url=String(input&&input.url||input);
          if(url.startsWith('https://qa-stub.invalid/')){
            const body=JSON.parse(String(options&&options.body||'{}'));
            const image=url.includes('/images/generations');
            window.__qaMockCalls.push({kind:image?'image':'scene',model:body.model,prompt:body.prompt||'',
              requestedScene:JSON.stringify(body.messages||[]).includes('咖啡店')});
            const payload=image?{data:[{b64_json:png,mime_type:'image/png'}]}:
              {choices:[{message:{content:'At a quiet cafe window in afternoon daylight.'}}]};
            return Promise.resolve(new Response(JSON.stringify(payload),{
              status:200,headers:{'content-type':'application/json'}}));
          }
          return original(input,options);
        };
      },{role,png});
      const page=await context.newPage();
      page.on('pageerror',err=>row.pageErrors.push(String(err.message).slice(0,140)));
      page.on('dialog',async d=>{row.dialogs++;await d.dismiss();});
      // 1. Real footprint UI: select role, open calendar, scroll and return.
      await page.goto(origin+'/chat/footprint/footprint.html',{waitUntil:'load'});
      await page.locator('#rolesScroll .role-item').first().waitFor({state:'visible',timeout:12000});
      await page.locator('#rolesScroll .role-item').first().click();
      assert.equal(await page.locator('#page-home').isVisible(),true);
      assert.ok(await page.locator('.top-title').innerText().then(t=>t.includes('角色足迹')));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await page.screenshot({path:resolve(shots,'footprint-'+width+'.png'),fullPage:true,animations:'disabled'});
      row.screenshots.push('footprint-'+width+'.png');
      await page.locator('.bottom-nav .nav-btn').nth(1).click();
      await page.locator('#page-calendar').waitFor({state:'visible'});
      await page.mouse.wheel(0,300);
      await page.screenshot({path:resolve(shots,'footprint-calendar-'+width+'.png'),fullPage:true,animations:'disabled'});
      row.screenshots.push('footprint-calendar-'+width+'.png');
      await page.locator('.bottom-nav .nav-btn').first().click();
      assert.equal(await page.locator('#page-home').isVisible(),true);
      row.footprint='PASS';
      // 2. Real image-generation UI, real orchestration and local IndexedDB;
      // only the two paid API replies are mocked before network dispatch.
      await page.goto(origin+'/settings/image-generation.html',{waitUntil:'load'});
      await page.locator('#characterSelect option').first().waitFor({state:'attached'});
      await page.locator('#appearance').fill(role.appearanceDescription);
      await page.locator('#styleKeywords').fill(role.styleKeywords.join(', '));
      await page.locator('#scene').fill('下午在咖啡店靠窗的位置');
      await page.locator('#saveRole').click();
      await page.locator('#roleSaveStatus').filter({hasText:'已保存'}).waitFor();
      await page.locator('#generateImage').click();
      await page.waitForFunction(()=>document.getElementById('generationStatus')?.textContent?.includes('生成完成'),
        null,{timeout:20000});
      await page.locator('#gallery .image-item').first().waitFor({state:'visible'});
      const payload=await page.evaluate(()=>({
        calls:window.__qaMockCalls||[],
        galleryCount:document.querySelectorAll('#gallery .image-item').length,
        status:document.querySelector('#generationStatus')?.textContent||'',
        image:document.querySelector('#gallery .image-item img')?.getAttribute('src')||''
      }));
      assert.equal(payload.calls.length,2,'expect scene and image requests');
      assert.equal(payload.calls[0].kind,'scene');
      assert.equal(payload.calls[1].kind,'image');
      assert.equal(payload.calls[1].model,'synthetic-image-model');
      assert.ok(payload.calls[1].prompt.includes(role.appearanceDescription));
      assert.ok(payload.calls[1].prompt.includes('quiet cafe window'));
      assert.ok(payload.calls[0].requestedScene);
      assert.ok(payload.galleryCount>0);
      row.mockApiCalls=payload.calls.length;
      await page.screenshot({path:resolve(shots,'ai-generation-'+width+'.png'),fullPage:true,animations:'disabled'});
      row.screenshots.push('ai-generation-'+width+'.png');
      // Controlled input error: empty scene is allowed, but no alerts, no JS crash.
      assert.equal(await page.locator('#generateImage').isEnabled(),true);
      assert.equal(row.dialogs,0);
      assert.deepEqual(row.pageErrors,[]);
      assert.equal(row.externalApiRequests,0,'no actual external AI API request');
      row.ai='PASS';
      await page.close();
    }catch(e){
      failure=failure||{width,stage:row.footprint==='NOT_RUN'?'footprint':'ai'};
      row.errorCode=String(e&&e.name||'Error').slice(0,40);
      throw e;
    }finally{
      if(context)await context.close();
    }
  }
}catch(e){
  if(!failure)failure={stage:'setup'};
  process.exitCode=1;
}finally{
  if(browser)await browser.close();
  await new Promise(ok=>server.close(ok));
  try{
    await mkdir(output,{recursive:true});
    await writeFile(resolve(output,'report.json'),JSON.stringify({
      schemaVersion:1,scope:'local Chromium only, synthetic identity and AI API',
      builtAssets:true,results,failure,finishedAt:new Date().toISOString()
    },null,2)+'\n');
  }catch{}
  console.log('VIRTUAL_USER_ACCEPTANCE:'+(failure?'FAIL':'PASS'));
  if(failure)console.log('VIRTUAL_USER_FAILED_STAGE:'+failure.stage);
}
