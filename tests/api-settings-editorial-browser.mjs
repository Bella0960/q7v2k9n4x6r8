/* Real Chromium mobile smoke against built Vite output. No real provider requests. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const port=Number(process.env.API_UI_QA_PORT||34925);
const base=process.env.BASE_URL||'http://127.0.0.1:'+port+'/';
const root=new URL(base);
if(root.protocol!=='http:'||!['127.0.0.1','localhost'].includes(root.hostname))
  throw Error('Only a local Vite preview is allowed');
let server=null,browser=null;
try{
 if(!process.env.BASE_URL){
  server=spawn(process.execPath,[new URL('../node_modules/vite/bin/vite.js',import.meta.url).pathname,
    'preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
  let ready=false;
  for(let i=0;i<90;i++){
   if(server.exitCode!==null)throw Error('Vite preview exited');
   try{
    const response=await fetch(new URL('settings/settings.html',base),{signal:AbortSignal.timeout(650)});
    if(response.ok){ready=true;break;}
   }catch{}
   await new Promise(r=>setTimeout(r,160));
  }
  assert.ok(ready,'Vite preview must be running');
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [375,390,430]){
  const context=await browser.newContext({
   viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'
  });
  await context.route('**/*',route=>route.request().url().startsWith(root.origin+'/')?route.continue():route.abort());
  await context.addInitScript(()=>{
   const profile={id:'api-ui-qa',name:'测试配置',provider:'openai',baseUrl:'https://api.openai.com/v1',
      apiKey:'synthetic-test-only',model:'mock-model',temperature:0.7,topP:1,memoryCount:20};
   localStorage.setItem('api_profiles_v1',JSON.stringify([profile]));
   localStorage.setItem('api_active_profile',profile.id);
   localStorage.setItem('api_settings',JSON.stringify(profile));
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(new URL('settings/settings.html#api',base).href);
   await page.locator('#api-panel').waitFor({state:'visible'});
   await page.locator('#api-tools-drawer summary').waitFor({state:'visible'});
   assert.equal(await page.locator('#api-tools-drawer').evaluate(el=>el.open),false);
   for(const id of ['#btnProfileNew','#btnProfileDelete','#presetChips',
      '#btnApiImportProfiles','#btnApiExportProfiles'])
     assert.equal(await page.locator(id).isVisible(),false,'secondary control hidden: '+id);
   assert.equal(await page.locator('#profilePills').isVisible(),true);
   await page.locator('#api-tools-drawer summary').click();
   assert.equal(await page.locator('#api-tools-drawer').evaluate(el=>el.open),true);
   for(const id of ['#btnProfileNew','#btnProfileDelete','#presetChips',
      '#btnApiImportProfiles','#btnApiExportProfiles'])
     assert.equal(await page.locator(id).isVisible(),true,'tool reachable on demand: '+id);
   await page.locator('#api-tools-drawer summary').click();
   assert.equal(await page.locator('#api-tools-drawer').evaluate(el=>el.open),false);
   const metrics=await page.evaluate(()=>{
    const panel=document.querySelector('#api-panel');
    const footer=panel.querySelector('.api-editorial-footer').getBoundingClientRect();
    const container=panel.getBoundingClientRect();
    return {
     overflow:document.documentElement.scrollWidth>innerWidth,
     formColor:getComputedStyle(document.querySelector('#settingsForm')).backgroundColor,
     footerVisible:footer.top>=container.top&&footer.bottom<=container.bottom+1,
     footerHeight:footer.height
    };
   });
   assert.equal(metrics.overflow,false,'no horizontal overflow at '+width);
   assert.equal(metrics.formColor,'rgba(0, 0, 0, 0)','no old gray form card');
   assert.equal(metrics.footerVisible,true,'footer stays inside phone frame');
   assert.ok(metrics.footerHeight<155,'footer must not swallow viewport');
   assert.equal(await page.locator('#api-image-settings').evaluate(el=>el.open),false);
   assert.equal(await page.locator('#api-advanced-settings').evaluate(el=>el.open),false);
   await page.locator('#api-image-settings summary').click();
   await page.locator('#api-image-model').fill('mock-image');
   await page.locator('#api-advanced-settings summary').click();
   await page.locator('#api-temperature').fill('0');
   assert.equal(await page.locator('#api-temperature').inputValue(),'0');
   assert.equal(await page.locator('#api-key').getAttribute('type'),'password');
   await page.locator('#api-key').evaluate(el=>el.scrollIntoView({block:'center'}));
   await page.locator('#api-panel .eye-btn').click();
   assert.equal(await page.locator('#api-key').getAttribute('type'),'text');
   assert.deepEqual(errors,[]);
   console.log('API_EDITORIAL_CHROMIUM_VIEWPORT_PASS:'+width);
  }finally{await page.close();await context.close();}
 }
}finally{
 if(browser)await browser.close();
 if(server)server.kill('SIGTERM');
}
