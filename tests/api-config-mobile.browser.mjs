import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT=Number(process.env.API_CONFIG_QA_PORT||34921);
const base=process.env.BASE_URL||'http://127.0.0.1:'+PORT+'/';
const u=new URL(base);
assert.equal(u.protocol,'http:');
assert.ok(['localhost','127.0.0.1'].includes(u.hostname));
let server=null,browser=null;
try{
 if(!process.env.BASE_URL){
  server=spawn(process.execPath,[new URL('../node_modules/vite/bin/vite.js',import.meta.url).pathname,
    'preview','--host','127.0.0.1','--port',String(PORT),'--strictPort'],{stdio:'ignore'});
  let ready=false;
  for(let i=0;i<90;i++){
   if(server.exitCode!==null)throw Error('preview exited');
   try{const r=await fetch(new URL('settings/settings.html',base),{signal:AbortSignal.timeout(600)});if(r.ok){ready=true;break}}catch{}
   await new Promise(r=>setTimeout(r,150));
  }
  assert.ok(ready,'local preview not ready');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [375,390,430]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,
    serviceWorkers:'block',acceptDownloads:true});
  await context.route('**/*',route=>route.request().url().startsWith(u.origin+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{
   const item={id:'existing',name:'已有方案',provider:'openai',baseUrl:'https://api.openai.com/v1',
     apiKey:'synthetic-no-real-secret',model:'gpt-4o-mini',temperature:0.7,memoryCount:20};
   localStorage.setItem('api_profiles_v1',JSON.stringify([item]));
   localStorage.setItem('api_active_profile','existing');
   localStorage.setItem('api_settings',JSON.stringify(item));
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  try{
   await page.goto(new URL('settings/settings.html#api',base).href);
   await page.locator('#btnApiExportProfiles').waitFor({state:'visible',timeout:12000});
   assert.equal(await page.locator('#api-key').getAttribute('type'),'password');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const downloaded=page.waitForEvent('download');
   await page.locator('#btnApiExportProfiles').click();
   const file=await downloaded;
   assert.match(file.suggestedFilename(),/with-keys\.json$/);
   const chunks=[];for await(const chunk of await file.createReadStream())chunks.push(chunk);
   const json=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   assert.equal(json.profiles[0].apiKey,'synthetic-no-real-secret');
   await page.locator('#api-url').fill('https://api.openai.com/chat/completions');
   await page.locator('#api-name').focus();
   assert.equal(await page.locator('#api-url').inputValue(),'https://api.openai.com/v1');
   await page.evaluate(()=>{window.fetch=async()=>({ok:false,status:404})});
   await page.locator('#btn-fetch-models').click();
   await page.waitForFunction(()=>/手动输入/.test(document.querySelector('#model-fetch-msg').textContent));
   assert.equal(await page.locator('#btn-fetch-models').isDisabled(),false);
   await page.locator('#api-model').fill('custom-manual-model');
   assert.equal(await page.locator('#api-model').inputValue(),'custom-manual-model');
   const incoming={app:'maomao-api-profiles',schema:1,activeId:'incoming',profiles:[
     {id:'incoming',name:'导入方案',baseUrl:'https://proxy.invalid/v1',apiKey:'synthetic-incoming',model:'x',temperature:0,memoryCount:12}]};
   await page.locator('#apiProfilesImportFile').setInputFiles({
     name:'profiles.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))
   });
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('api_profiles_v1')||'[]').length===2);
   const saved=await page.evaluate(()=>({
     list:JSON.parse(localStorage.getItem('api_profiles_v1')),
     active:localStorage.getItem('api_active_profile'),
     mirror:JSON.parse(localStorage.getItem('api_settings'))
   }));
   assert.equal(saved.list[0].apiKey,'synthetic-no-real-secret');
   assert.equal(saved.list[1].apiKey,'synthetic-incoming');
   assert.equal(saved.active,'existing');
   assert.equal(saved.mirror.apiKey,'synthetic-no-real-secret');
   assert.deepEqual(errors,[]);
   console.log('API_CONFIG_CHROMIUM_PASS_WIDTH:'+width);
  }finally{await page.close();await context.close();}
 }
}finally{
 if(browser)await browser.close();
 if(server){server.kill('SIGTERM');}
}
