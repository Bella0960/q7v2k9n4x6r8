/* Scoped QA: both real HTML pages, character-scoped persistence and chat safety. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const port = Number(process.env.COUPLE_GROWTH_QA_PORT || 4184);
const origin='http://127.0.0.1:'+port;
const cli=fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url));
const proc=spawn(process.execPath,[cli,'preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
let browser;
try {
  let ready=false;
  for(let i=0;i<60;i++){
    if(proc.exitCode!==null)throw new Error('Preview terminated');
    try{const r=await fetch(origin+'/couple/couple.html',{signal:AbortSignal.timeout(700)});if(r.status===200){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,180));
  }
  assert.equal(ready,true);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [375,390,430]){
    const ctx=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
    try{
      await ctx.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await ctx.addInitScript(()=>{
        localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'qa-A',name:'角色甲'},{id:'qa-B',name:'角色乙'}]));
        localStorage.setItem('phone_current_contact','qa-A');
      });
      const page=await ctx.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/couple/couple.html?id=qa-A',{waitUntil:'domcontentloaded'});
      await page.locator('#checkinBtn').click();
      const checkin=await page.evaluate(()=>JSON.parse(localStorage.getItem('maoer_couple_checkin_qa-A')||'[]'));
      assert.equal(checkin.length,1,'clicked check-in must persist exactly once');
      await page.evaluate(()=>window.openSheet('bucket'));
      await page.locator('#bucketInput').fill('跨应用计划');
      await page.locator('button[onclick="addBucket()"]').click();
      let list=await page.evaluate(()=>JSON.parse(localStorage.getItem('maoer_couple_bucket_qa-A')||'[]'));
      assert.equal(list.length,1);
      await page.evaluate(id=>window.toggleBucket(id),list[0].id);
      await page.goto(origin+'/growth/growth.html?id=qa-A',{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('#planStat').textContent(),'1','growth must read the same A bucket');
      assert.equal(await page.locator('#points').textContent(),'15','completed bucket must add points');
      await page.goto(origin+'/growth/growth.html?id=qa-B',{waitUntil:'domcontentloaded'});
      assert.equal(await page.locator('#planStat').textContent(),'0','B must not inherit A plans');
      assert.equal(await page.locator('#points').textContent(),'0');
      await page.goto(origin+'/couple/couple.html?id=ghost',{waitUntil:'domcontentloaded'});
      await page.locator('#checkinBtn').click();
      assert.equal(await page.evaluate(()=>localStorage.getItem('maoer_couple_checkin_ghost')),null);
      assert.equal(await page.evaluate(()=>localStorage.getItem('maoer_couple_checkin_default')),null);
      await page.goto(origin+'/couple/couple.html?id=qa-A',{waitUntil:'domcontentloaded'});
      await page.evaluate(()=>localStorage.setItem('chat_history_qa-B','{corrupt-chat'));
      await page.evaluate(()=>{
        window.openSet();
        document.getElementById('setNameA').value='玩家';
        document.getElementById('setNameB').value='角色乙';
        document.getElementById('setPartner').value='qa-B';
        window.saveSet();
      });
      assert.equal(await page.evaluate(()=>localStorage.getItem('chat_history_qa-B')),'{corrupt-chat',
        'corrupt chat history must never be replaced by an empty synthetic list');
      assert.match(await page.locator('#toast').textContent(),/邀请消息没有写入/);
      assert.ok(!errors.some(e=>/PhoneStorage|saveSet|addBucket|toggleBucket.*not defined/.test(e)),
        'real pages must not be missing shared dependencies');
      console.log('COUPLE_GROWTH_BROWSER_PASS '+width);
    } finally{await ctx.close();}
  }
}finally{if(browser)await browser.close();proc.kill('SIGTERM');}
