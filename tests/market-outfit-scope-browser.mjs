import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pw=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer((req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.toLowerCase().startsWith(root.toLowerCase()))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(p)]||'application/octet-stream');res.end(readFileSync(p));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await pw.chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
let count=0;
const ITEM={id:'outfit_scope_test',name:'甲的气泡搭配',createdAt:Date.now(),scopes:['bubbles'],data:{bubbles:{scope:'role_a',vars:{myBubbleBg:'#444444'}}}};
try{
 for(const width of [375,390,430]){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/theme-store/theme-store.html');await page.waitForSelector('.sf-product');
  await page.evaluate(item=>{
   localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'role_a',name:'角色甲'},{id:'role_b',name:'角色乙'}]));
   ChatBeauty.save('role_a',{myBubbleBg:'#444444'});
   ChatBeauty.save('role_b',{myBubbleBg:'#777777'});
   localStorage.setItem('phone_current_contact','role_b');
   localStorage.setItem('maomao_market_collection_v1',JSON.stringify({v:1,favorites:[],outfits:[item],creations:[]}));
  },ITEM);
  await page.reload();await page.waitForSelector('.sf-product');
  const val=scope=>page.evaluate(s=>ChatBeauty.resolve(s).myBubbleBg,scope);
  assert.equal(await val('role_a'),'#444444','baseline A');
  assert.equal(await val('role_b'),'#777777','baseline B');
  await page.locator('[data-category="mine"]').click();
  await page.locator('[data-sf="mine-tab"][data-id="outfits"]').click();
  await page.locator('[data-sf="record-preview"]').first().click();
  assert.match(await page.locator('.sf-dialog').innerText(),/气泡来自：角色甲/,'preview labels the source role');
  // Re-apply with bubbles checked: must open the target-scope confirmation before any write.
  await page.locator('[data-sf="record-apply"]').click();
  assert.equal(await page.locator('.sf-dialog h2').innerText(),'确认气泡应用位置','confirmation dialog before writing');
  const radios=await page.locator('[name="bubble-target"]').all();
  assert.ok(radios.length>=2,'source and current target offered');
  assert.equal(await val('role_b'),'#777777','B unchanged before confirmation');
  assert.equal(await val('role_a'),'#444444','A unchanged before confirmation');
  // Cancel: nothing written.
  await page.locator('[data-sf="close"]').first().click();
  assert.equal(await val('role_b'),'#777777','B unchanged after cancel');
  assert.equal(await val('role_a'),'#444444','A unchanged after cancel');
  // Reopen and retarget onto current role B.
  await page.locator('[data-sf="record-preview"]').first().click();
  await page.locator('[data-sf="record-apply"]').click();
  await page.locator('[name="bubble-target"][value="role_b"]').check();
  await page.locator('[data-sf="confirm-outfit-apply"]').click();
  await page.waitForSelector('.sf-record');
  assert.equal(await val('role_b'),'#444444','B receives the copied bubble value');
  assert.equal(await val('role_a'),'#444444','source role A keeps its own config');
  const record=await page.evaluate(()=>MAOMAOMarketCollection.read().outfits[0]);
  assert.equal(record.data.bubbles.scope,'role_a','record source scope is not rewritten');
  assert.deepEqual(errors,[]);
  count++;console.log('PASS width '+width+': bubble source shown, unconfirmed write blocked, retarget isolates roles');
  await ctx.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
console.log(count+' outfit-scope browser scenarios passed');
