import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const roles=[
  {id:'coder-a',name:'夜班工程师',persona:'在深圳昼夜颠倒的程序员，下午才睡醒，凌晨修复代码问题。',
    personality:'疲惫时话少，但吐槽犀利',profession:'独立游戏程序员',
    lifeLine:'这个月正在赶凌晨的游戏发布。',
    lifeEvents:[{date:'2026-11-23',title:'夜间紧急修复',detail:'上线前修复移动端崩溃'}]},
  {id:'cult-b',name:'门派大师兄',persona:'青霄剑派首席弟子，年少时入山门修仙，不知现代城市。',
    profession:'守山大师兄',background:'师尊闭关后代管修行事务。',
    lifeLine:'每日巡查西崖阵法，夜里练剑。',
    lifeEvents:[{date:'2026-11-23',title:'护山阵法松动',detail:'准备御剑巡查西崖'}]}
];
const coder=[
  {time:'14:05',action:'起床后检查昨夜的构建日志',status:'还没完全清醒',thought:'别告诉我又爆红了'},
  {time:'23:10',action:'对照错误日志修补游戏崩溃',status:'专注',thought:'这次一定能定位到问题'},
  {time:'02:30',action:'点夜宵继续写补丁',status:'又饿又烦',thought:'修完才能安心睡觉'}
];
const master=[
  {time:'06:20',action:'在祖师殿静坐调息',status:'清明',thought:'今晨真气运转比昨日稳了'},
  {time:'15:40',action:'御剑巡查西崖法阵',status:'警觉',thought:'西侧阵眼似乎弱了一寸'},
  {time:'21:10',action:'月下练剑',status:'沉静',thought:'这一式不能再求快'}
];

async function serve(req,res){
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(root,'.'+pathname);
  if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403);res.end();return;}
  const extension=path.extname(target).toLowerCase();
  const mime=extension==='.html'?'text/html; charset=utf-8':
    extension==='.js'?'text/javascript; charset=utf-8':
    extension==='.css'?'text/css; charset=utf-8':'application/octet-stream';
  try {
    const buf=await readFile(target);
    res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});
    res.end(buf);
  } catch(_){res.writeHead(404);res.end('Not Found');}
}
test('actual footprint page on Chromium 375/390/430px: two incompatible personas, strict JSON fields and reload',{timeout:120000},async()=>{
  const server=createServer((req,res)=>void serve(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    for(const width of [375,390,430]){
      const context=await browser.newContext({viewport:{width,height:820}});
      await context.addInitScript(({roles,coder,master})=>{
        localStorage.setItem('ai_custom_characters',JSON.stringify(roles));
        localStorage.setItem('api_settings',JSON.stringify({apiKey:'old-key',model:'old-model',baseUrl:'https://obsolete.invalid/v1'}));
        localStorage.setItem('api_profiles_v1',JSON.stringify([
          {id:'live',apiKey:'current-key',model:'current-model',baseUrl:'https://current.invalid/v1',maxTokens:2048}
        ]));
        localStorage.setItem('api_active_profile',JSON.stringify('live'));
        window.confirm=()=>true;
        window.__requests=[];
        const originalFetch=window.fetch.bind(window);
        window.fetch=(url,options)=>{
          if(!String(url).includes('current.invalid'))return originalFetch(url,options);
          const payload=JSON.parse(options.body);
          const user=String(payload.messages[1].content);
          const isCultivator=user.includes('青霄剑派');
          window.__requests.push({
            url:String(url), model:payload.model,auth:options.headers.Authorization,
            user,system:String(payload.messages[0].content)
          });
          const entries=isCultivator?master:coder;
          const raw='模型返回：\n'+String.fromCharCode(96,96,96)+'json\n'+
            JSON.stringify({entries})+'\n'+String.fromCharCode(96,96,96);
          return Promise.resolve(new Response(JSON.stringify({
            choices:[{message:{content:raw},finish_reason:'stop'}],usage:{total_tokens:250}
          }),{status:200,headers:{'content-type':'application/json'}}));
        };
      },{roles,coder,master});
      const page=await context.newPage();
      try {
        await page.goto(origin+'/chat/footprint/footprint.html',{waitUntil:'domcontentloaded'});
        await page.waitForSelector('.role-item[data-role-id="coder-a"]');
        assert.equal(await page.locator('.timeline .t-item').count(),0,'loading the page cannot auto-generate');
        await page.locator('.top-bar .icon-btn').click();
        await page.waitForFunction(()=>document.querySelector('#footprintGenerationStatus')?.dataset.state==='success');
        assert.equal(await page.locator('.timeline .t-item').count(),3);
        const first=await page.locator('.timeline').innerText();
        assert.match(first,/检查昨夜的构建日志/);
        assert.match(first,/心声 ·/);
        assert.match(first,/状态 ·/);
        assert.doesNotMatch(first,/祖师殿|御剑/);
        await page.locator('#rolesScroll .role-item[data-role-id="cult-b"]').click();
        assert.equal(await page.locator('.timeline .t-item').count(),0,'new role must not see previous role timeline');
        await page.locator('.top-bar .icon-btn').click();
        await page.waitForFunction(()=>window.__requests.length===2&&document.querySelector('#footprintGenerationStatus')?.dataset.state==='success');
        assert.equal(await page.locator('.timeline .t-item').count(),3);
        const second=await page.locator('.timeline').innerText();
        assert.match(second,/祖师殿|御剑/);
        assert.doesNotMatch(second,/写补丁|游戏崩溃|点夜宵/);
        const record=await page.evaluate(()=>({
          requests:window.__requests,
          coder:JSON.parse(localStorage.getItem('footprint_coder-a')),
          cultivator:JSON.parse(localStorage.getItem('footprint_cult-b')),
          overflow:document.documentElement.scrollWidth>window.innerWidth+1
        }));
        assert.equal(record.requests.length,2);
        assert.ok(record.requests[0].user.includes('游戏发布'));
        assert.ok(record.requests[1].user.includes('护山阵法松动'));
        assert.equal(record.requests[0].model,'current-model');
        assert.equal(record.requests[1].auth,'Bearer current-key');
        assert.match(record.requests[0].system,/严格合法的 JSON/);
        assert.equal(record.overflow,false);
        for(const key of ['coder','cultivator']) {
          const dates=Object.values(record[key]);
          assert.equal(dates.length,1);
          assert.equal(dates[0].length,3);
          assert.ok(dates[0].every(x=>x.time&&x.action&&x.status&&x.thought));
        }
        await page.reload({waitUntil:'domcontentloaded'});
        assert.equal(await page.locator('.timeline .t-item').count(),3,'first role records persist through reload');
        assert.match(await page.locator('.timeline').innerText(),/检查昨夜的构建日志/);
      } finally {await page.close();await context.close();}
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test('Chromium phone: malformed model JSON never overwrites existing day or invents an early-riser schedule',{timeout:60000},async()=>{
 const server=createServer((req,res)=>void serve(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.addInitScript(({roles})=>{
    localStorage.setItem('ai_custom_characters',JSON.stringify([roles[0]]));
    localStorage.setItem('api_settings',JSON.stringify({apiKey:'test-key',model:'mock',baseUrl:'https://fake.invalid/v1'}));
    window.confirm=()=>true;
    window.fetch=()=>Promise.resolve(new Response(JSON.stringify({
      choices:[{message:{content:'not a JSON timeline'},finish_reason:'stop'}]
    }),{status:200,headers:{'content-type':'application/json'}}));
    window.__savedBefore=JSON.stringify({'2026-11-23':[{
      id:'prior-record',time:'23:50',title:'旧足迹',desc:'不得消失'
    }]});
    const date=new Date(),key=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
    localStorage.setItem('footprint_coder-a',JSON.stringify({[key]:[{id:'prior-record',time:'23:50',title:'旧足迹',desc:'不得消失'}]}));
  },{roles});
  const page=await context.newPage();
  try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/chat/footprint/footprint.html',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('.timeline .t-item').count(),1);
    await page.locator('.top-bar .icon-btn').click();
    await page.waitForFunction(()=>document.querySelector('#footprintGenerationStatus')?.dataset.state==='error');
    assert.match(await page.locator('.timeline').innerText(),/旧足迹/);
    assert.doesNotMatch(await page.locator('.timeline').innerText(),/起床洗漱|按时吃饭|准备睡觉/);
    const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('footprint_coder-a')));
    assert.equal(Object.values(saved)[0].length,1);
    assert.equal(Object.values(saved)[0][0].id,'prior-record');
  }finally{await page.close();await context.close();}
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
