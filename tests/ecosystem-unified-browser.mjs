/**
 * ECO-LINK unified Chromium verification against real Vite dist.
 * Run: npm run build && node tests/ecosystem-unified-browser.mjs
 * Uses synthetic account headers in a local static server; official Worker
 * identity/session, SW and real phones require separate public-QA validation.
 * Never connects to paid AI APIs or real user accounts.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=resolve(root,'dist');
const artifacts=resolve(root,'test-results');
const roleId='role_enc_qa777';
const firstDate='2026-11-21';
const originDate='2026-11-18T09:20:00.000Z'; // deliberately different from event
const firstAt='2026-11-21T08:30:00.000Z';
const A='MAO-AAAAAAAAAAAA', B='MAO-BBBBBBBBBBBB';
let serverAccount=A;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml',
  '.png':'image/png','.woff2':'font/woff2'};
const mustExist=['chat/footprint/footprint.html','worldbook/characters/characters.html',
  'encounter/encounter.html','chat/chat/chat-detail.html',
  'shared/js/phone/world-events.js','shared/js/phone/world-events-memory.js'];
for(const file of mustExist) if(!existsSync(resolve(dist,file))) {
  throw new Error('Missing Vite dist resource: '+file+' (run npm run build first)');
}

const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=resolve(dist,'.'+pathname);
    if(target!==dist&&!target.startsWith(dist+'/')) {
      res.writeHead(403);res.end();return;
    }
    const targetStat=await stat(target);
    const file=targetStat.isDirectory()?resolve(target,'index.html'):target;
    let data=await readFile(file);
    if(extname(file)==='.html'){
      // Synthetic local identity metadata only; NOT an official Worker login.
      const tags='<meta name="mao-account-id" content="'+serverAccount+'">'+
        '<meta name="mao-account-role" content="user">'+
        '<script>window.__MAO_ACCOUNT_SCOPE__={accountId:"'+serverAccount+
        '",role:"user",ready:true};</script>';
      const markup=data.toString('utf8');
      if(!/<head\b[^>]*>/i.test(markup)) throw new Error('head tag absent');
      data=Buffer.from(markup.replace(/<head\b[^>]*>/i,match=>match+tags));
    }
    res.setHeader('content-type',mime[extname(file)]||'application/octet-stream');
    res.setHeader('cache-control','no-store');
    res.end(data);
  }catch(e){res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const report={schemaVersion:1,branch:'integration/qa-eco-unified',
  gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  scope:'synthetic-browser-account-metadata (not real Worker login)',
  viewports:[],timings:{},errors:[],checked:{}};
let browser;
try{
  await mkdir(artifacts,{recursive:true});
  try{
    browser=await chromium.launch({headless:true});
  }catch(original){
    const candidates=[process.env.PLAYWRIGHT_CHROMIUM_PATH,
      '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].filter(Boolean);
    let error=original;
    for(const executablePath of candidates) {
      if(!existsSync(executablePath)) continue;
      try{browser=await chromium.launch({headless:true,executablePath,
        args:process.platform==='linux'?['--no-sandbox']:[]});break;}catch(e){error=e;}
    }
    if(!browser) throw error;
  }
  for(const width of [375,390,430]){
    const context=await browser.newContext({viewport:{width,height:width===430?932:width===390?844:812},
      isMobile:true,hasTouch:true,deviceScaleFactor:2,timezoneId:'Asia/Shanghai',
      reducedMotion:'reduce'});
    const page=await context.newPage();
    const pageErrors=[];
    page.on('pageerror',e=>pageErrors.push(String(e)));
    await page.addInitScript(({roleId,originDate})=>{
      if(localStorage.getItem('__eco_unified_seed_v1')==='1')return;
      localStorage.setItem('ai_custom_characters',JSON.stringify([{
        id:roleId,name:'测试角色七',persona:'独立角色，不改变原始人设',
        tone:'简短自然',encounterOrigin:{version:1,sourceCandidateId:'enc_qa777',
          linkedAt:'2026-11-21T08:30:00.000Z',createdAt:originDate}
      }]));
      localStorage.setItem('__eco_unified_seed_v1','1');
    },{roleId,originDate});
    const path='/worldbook/characters/characters.html?from=footprint&encounterRole='+
      encodeURIComponent(roleId)+'&showEncounter=1&returnDate='+firstDate;
    await page.goto(base+path,{waitUntil:'load'});
    const details=page.locator('#profileContent details.eco-profile-history');
    await details.waitFor({state:'visible'});
    assert.equal(await details.getAttribute('open'),'','direct link should expand existing history');
    await page.locator('[data-eco-restore-first]').waitFor();
    assert.equal(await page.locator('[data-eco-restore-first]').count(),1,
      'a verified saved role without an event needs a manual recovery entry');
    const initially=await page.evaluate(id=>window.WorldEvents.listForRole(id),roleId);
    assert.equal(initially.value.length,0,'opening profile must not create an event');
    await page.locator('[data-eco-restore-first]').click();
    await page.waitForFunction(id=> {
      const result=window.WorldEvents.listForRole(id);
      return result.ok&&result.value.some(e=>e.type==='encounter.first_met');
    },roleId);
    const after=await page.evaluate(id=>window.WorldEvents.listForRole(id),roleId);
    assert.equal(after.value.length,1,'first-meet recovery must be idempotent');
    assert.equal(after.value[0].roleId,roleId);
    assert.equal(after.value[0].occurredAt,firstAt,
      'the real saved first-meet date must be used, not role.createdAt/today');
    const footLink=await page.locator('.eco-profile-links a[href*="footprint"]').getAttribute('href');
    assert.ok(footLink.includes('date='+firstDate),'link must target true first-meet day');
    assert.ok(!footLink.includes('date=2026-11-18'),'creation day is not a first-meet record');
    await page.reload({waitUntil:'load'});
    assert.equal(await page.locator('[data-eco-restore-first]').count(),0,
      'an existing first-meet event must not show a duplicate repair button');
    await page.locator('.back-circle').click();
    await page.waitForURL(url=>url.pathname.endsWith('/chat/footprint/footprint.html'));
    assert.equal(new URL(page.url()).searchParams.get('roleId'),roleId);
    assert.equal(new URL(page.url()).searchParams.get('date'),firstDate);
    await page.locator('.t-eco-item').first().waitFor();
    assert.match(await page.locator('.t-eco-item').first().innerText(),/初次相识/);
    await page.locator('.t-eco-item').first().click();
    await page.waitForURL(url=>url.pathname.endsWith('/worldbook/characters/characters.html'));
    assert.equal(await page.locator('details.eco-profile-history[open]').count(),1);
    await page.locator('.back-circle').click();
    await page.waitForURL(url=>url.pathname.endsWith('/chat/footprint/footprint.html'));
    assert.equal(new URL(page.url()).searchParams.get('date'),firstDate);
    report.checked['firstMeetAndRoute'+width]=true;

    // Direct reunion preview alone is read-only; only confirmation saves.
    const reunionLink=base+'/encounter/encounter.html?from=footprint&reunionRole='+
      encodeURIComponent(roleId)+'&returnDate='+firstDate;
    await page.goto(reunionLink,{waitUntil:'load'});
    await page.locator('#sheet [data-reunion-confirm]').waitFor();
    const before=await page.evaluate(id=>window.WorldEvents.listForRole(id),roleId);
    assert.equal(before.value.length,1,'reunion preview must not write a new event');
    await page.locator('[data-reunion-confirm]').click();
    await page.waitForFunction(id=>window.WorldEvents.listForRole(id).value.length===2,roleId);
    const events=await page.evaluate(id=>window.WorldEvents.listForRole(id),roleId);
    const reunion=events.value.find(e=>e.type==='encounter.reunion');
    assert.ok(reunion&&reunion.roleId===roleId);
    await page.locator('[data-return-footprint]').click();
    await page.waitForURL(url=>url.pathname.endsWith('/chat/footprint/footprint.html'));
    assert.equal(new URL(page.url()).searchParams.get('date'),firstDate,
      'return link must preserve the original footprint date');
    const recentDay=await page.evaluate(event=>{
      const d=new Date(event.occurredAt);
      return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+
        '-'+String(d.getDate()).padStart(2,'0');
    },reunion);
    await page.goto(base+'/chat/footprint/footprint.html?roleId='+
      encodeURIComponent(roleId)+'&date='+recentDay,{waitUntil:'load'});
    const reunionCard=page.locator('.t-eco-item').filter({hasText:'再次相遇'});
    await reunionCard.waitFor();
    await reunionCard.click();
    await page.waitForURL(url=>url.pathname.endsWith('/encounter/encounter.html'));
    assert.equal(await page.locator('[data-return-footprint]').count(),1);
    await page.locator('[data-return-footprint]').click();
    await page.waitForURL(url=>url.pathname.endsWith('/chat/footprint/footprint.html'));
    assert.equal(new URL(page.url()).searchParams.get('date'),recentDay);
    report.checked['reunionAndReturn'+width]=true;

    // User opt-in and one-event-scan performance measurement in real Chromium JS.
    await page.goto(base+path,{waitUntil:'load'});
    const toggle=page.locator('[data-eco-memory-consent]');
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(),false,'historical memory defaults to off');
    await toggle.check();
    await page.waitForFunction(id=>window.RoleEventMemory.getConsent(id).value===true,roleId);
    const memoryTiming=await page.evaluate(id=>{
      const original=window.WorldEvents;
      let scans=0;
      window.WorldEvents=Object.assign({},original,{
        listForRole:function(){scans++;return original.listForRole.apply(original,arguments);}
      });
      const t0=performance.now();
      const result=window.RoleEventMemory.buildPrompt(id);
      const singleMs=performance.now()-t0;
      window.WorldEvents=original;
      return {singleMs,scans,ok:result.ok,text:result.value||''};
    },roleId);
    assert.equal(memoryTiming.scans,1,'one authorized context build must scan once');
    assert.equal(memoryTiming.ok,true);
    assert.match(memoryTiming.text,/初遇|认识/);
    report.timings['singleChatMemoryQueryMs'+width]=Number(memoryTiming.singleMs.toFixed(3));
    report.checked['chatMemoryScoped'+width]=true;

    // Switch synthetic account identity without replacing the browser origin;
    // account A's event keys must not be visible under B, then recover under A.
    serverAccount=B;
    const t0=Date.now();
    await page.reload({waitUntil:'load'});
    const bView=await page.evaluate(id=>({
      account:window.WorldEvents.account(),
      events:window.WorldEvents.listForRole(id),
      memory:window.RoleEventMemory.buildPrompt(id)
    }),roleId);
    assert.equal(bView.account.value,B);
    assert.equal(bView.events.ok,true);
    assert.equal(bView.events.value.length,0,'account B saw account A events');
    assert.equal(bView.memory.value,'','account B inherited A chat memory');
    const isolationMs=Date.now()-t0;
    report.timings['syntheticAccountSwitchMs'+width]=isolationMs;
    serverAccount=A;
    await page.reload({waitUntil:'load'});
    const aView=await page.evaluate(id=>window.WorldEvents.listForRole(id),roleId);
    assert.equal(aView.value.length,2,'switching back to A lost its history');
    report.checked['accountIsolationSynthetic'+width]=true;
    const doc=await page.evaluate(()=>({
      horizontalOverflow:document.documentElement.scrollWidth>
        document.documentElement.clientWidth+1
    }));
    assert.equal(doc.horizontalOverflow,false,'mobile page horizontal overflow');
    report.viewports.push(width);
    assert.deepEqual(pageErrors,[],'browser page JS error at width '+width);
    await context.close();
    serverAccount=A;
  }
  report.over200Ms=Object.entries(report.timings)
    .filter(([key,value])=>key.startsWith('singleChatMemoryQueryMs')&&value>200)
    .map(([key,value])=>({key,value,action:'investigate localStorage event scan; record technical debt'}));
  await writeFile(resolve(artifacts,'eco-unified-browser-receipt.json'),
    JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2)+'\n','utf8');
  console.log('PASS ECO-LINK Chromium; viewports='+report.viewports.join(',')+
    '; timing='+JSON.stringify(report.timings)+
    '; >200ms='+report.over200Ms.length);
}finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
