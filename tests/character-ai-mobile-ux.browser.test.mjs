import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const archive=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
const css=archive.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '';
const parser=readFileSync(new URL('../worldbook/characters/js/character-ai-json.js',import.meta.url),'utf8');
const generator=readFileSync(new URL('../worldbook/characters/js/character-ai-drafts.js',import.meta.url),'utf8');
const phoneApi=readFileSync(new URL('../shared/js/phone/phone_api.js',import.meta.url),'utf8');
const markup=
'<div id="profileView"><div class="profile-branch-list"><details class="avatar-library-section"><summary class="profile-branch avatar-library-trigger"><span class="profile-branch-index">03</span><span class="profile-branch-copy"><span class="profile-branch-title">头像收藏</span><span class="profile-branch-desc">收藏和配对</span></span><span class="profile-branch-arrow">›</span></summary><div class="avatar-library-inner">头像管理</div></details></div></div>'+
'<button id="btnAiLife">AI 生成</button><button id="btnAiRelationships">AI 生成人物</button><button id="btnAiNpc">AI 解析</button>'+
'<div id="lifeAiStatus"></div><div id="relationshipsAiStatus"></div><div id="npcAiStatus"></div>'+
'<input id="lifeEventTitle"><input type="date" id="lifeEventDate"><input id="lifeEventPeople"><select id="lifeEventStatus"><option value="planned">计划中</option><option value="ongoing">进行中</option></select><textarea id="lifeEventDetail"></textarea>';

test('Chromium phone: click life AI, recover fenced JSON and fill form at 375/390/430px',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  for(const width of [375,390,430]){
   const page=await browser.newPage({viewport:{width,height:820}});
   try {
    await page.setContent(markup);
    await page.evaluate(()=>{
     window.confirm=()=>true;
     window.getActiveProfileRole=()=>({id:'test-role',name:'角色A',persona:'深圳摄影师',worldBookIds:[],npcCharacters:[],lifeEvents:[]});
     window.PhoneStorage={getApiConfig:()=>({apiKey:'non-production-test-only',model:'mock',baseUrl:'https://character-ai-qa.invalid/v1'}),pushApiLog:()=>{}};
    });
    // Intercept fetch at the browser boundary, keeping the actual PhoneAPI
    // request builder, response decoder and JSON cleaner under test.
    await page.evaluate(()=>{
      window.__calls=0; window.__lastPrompt='';
      window.fetch=async (url,options)=>{
        window.__calls++;
        const body=JSON.parse(options.body);
        window.__lastPrompt=body.messages[0].content;
        const raw=['模型给出的结果：',String.fromCharCode(96,96,96)+'json','{"event":{"title":"准备摄影展","date":"2026-11-23","people":"同事","status":"ongoing","detail":"挑选照片",}}',String.fromCharCode(96,96,96),'完成'].join('\n');
        return new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:'stop'}],usage:{total_tokens:50}}),{status:200,headers:{'content-type':'application/json'}});
      };
    });
    await page.addScriptTag({content:phoneApi});
    await page.addScriptTag({content:parser});
    await page.addScriptTag({content:generator});
    await page.click('#btnAiLife');
    await page.waitForFunction(()=>document.getElementById('lifeEventTitle').value==='准备摄影展');
    const result=await page.evaluate(()=>({values:['lifeEventTitle','lifeEventDate','lifeEventPeople','lifeEventStatus','lifeEventDetail'].map(id=>document.getElementById(id).value),status:document.getElementById('lifeAiStatus').textContent,calls:window.__calls,prompt:window.__lastPrompt}));
    assert.deepEqual(result.values,['准备摄影展','2026-11-23','同事','ongoing','挑选照片']);
    assert.equal(result.calls,1);assert.match(result.prompt,/严格合法的 JSON/);assert.match(result.status,/已生成生活事件/);
    const startCSS=css.indexOf('/* Portrait collection is the third plain editorial settings row');
    const endCSS=css.indexOf('/* Text-only opt-in AI actions',startCSS);
    assert.ok(startCSS>=0 && endCSS>startCSS,'expected shipping archive CSS section');
    await page.addStyleTag({content:css.slice(startCSS,endCSS)});
    const styles=await page.$eval('.avatar-library-section',node=>({bg:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderTopWidth}));
    assert.equal(styles.bg,'rgba(0, 0, 0, 0)');assert.equal(styles.border,'0px');
    await page.click('.avatar-library-trigger');
    assert.equal(await page.$eval('.avatar-library-section',el=>el.open),true);
   }finally{await page.close();}
  }
 }finally{await browser.close();}
});