import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,access} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const endpoint='https://mcp.example.com/synthetic';
const token='synthetic-credential-never-real';
const key='maomao_mcp_connections_v1';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
test('MCP actual mobile connection page: token, consent, role isolation, stale connection and storage safety', {timeout:120000}, async()=>{
  const server=createServer(async(req,res)=>{
    try {
      const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
      if(!file.startsWith(root+sep))return res.writeHead(403).end();
      res.writeHead(200,{'Content-Type':MIME[extname(file)]||'application/octet-stream'}).end(await readFile(file));
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const width of [375,390,430]){
      const ctx=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
      try {
        const page=await ctx.newPage(), calls=[], errors=[];
        let holdInit=false, releaseInit, initStarted;
        page.on('pageerror',e=>errors.push(e.message));
        const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, DELETE, OPTIONS','access-control-allow-headers':'authorization, content-type, mcp-protocol-version, mcp-session-id','access-control-expose-headers':'mcp-session-id','mcp-session-id':'synthetic-session'};
        await page.route('**/*',async route=>{
          const req=route.request();
          if(req.url()!==endpoint)return req.url().startsWith(origin+'/')?route.continue():route.abort();
          if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
          if(req.method()==='DELETE')return route.fulfill({status:200,headers,body:''});
          const m=req.postDataJSON();
          calls.push({method:m.method,authorization:req.headers().authorization});
          if(m.method==='initialize'&&holdInit){initStarted?.();await new Promise(r=>{releaseInit=r;});}
          if(m.method==='notifications/initialized')return route.fulfill({status:202,headers,body:''}).catch(()=>{});
          let result;
          if(m.method==='initialize')result={protocolVersion:'2025-03-26',serverInfo:{name:'Synthetic',version:'1'}};
          else if(m.method==='tools/list')result={tools:[{name:'lookup',description:'Mock',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}]};
          else if(m.method==='tools/call')result={content:[{type:'text',text:'<script>not executable</script>'}]};
          else return route.abort();
          return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({jsonrpc:'2.0',id:m.id,result})}).catch(()=>{});
        });
        await ctx.addInitScript(()=>localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'a',name:'Role A'},{id:'b',name:'Role B'}])));
        await page.goto(origin+'/settings/mcp-connections.html');
        await page.locator('#serverName').fill('Synthetic');
        await page.locator('#serverUrl').fill(endpoint);
        await page.locator('#serverToken').fill(token);
        await page.locator('#connectBtn').click();
        await page.locator('#toolsPanel:not(.hidden)').waitFor();
        assert.ok(calls.some(c=>c.method==='initialize'&&c.authorization==='Bearer '+token));
        assert.equal(await page.locator('#serverToken').inputValue(),'');
        const saved=await page.evaluate(k=>localStorage.getItem(k),key);
        assert.ok(saved.includes(endpoint)&&!saved.includes(token));
        await page.locator('#permissionRole').selectOption('a');
        page.once('dialog',d=>d.accept());
        await page.locator('[data-permission-action]').click();
        await page.waitForFunction(()=>document.querySelector('[data-permission-action]').dataset.granted==='true');
        await page.locator('#permissionRole').selectOption('b');
        await page.waitForFunction(()=>document.querySelector('[data-permission-action]').dataset.granted==='false');
        await page.locator('.tool-input').fill('{"query":"synthetic"}');
        page.once('dialog',d=>d.dismiss());
        await page.locator('[data-call]').click();
        assert.equal(calls.filter(c=>c.method==='tools/call').length,0);
        page.once('dialog',d=>d.accept());
        await page.locator('[data-call]').click();
        await page.waitForFunction(()=>document.querySelector('[data-result]').textContent.includes('not executable'));
        assert.equal(calls.filter(c=>c.method==='tools/call').length,1);
        assert.equal(await page.locator('[data-result] script').count(),0);
        await page.locator('#disconnectBtn').click();
        assert.equal(await page.locator('#toolsPanel').isVisible(),false);
        assert.equal(await page.locator('#toolList').textContent(),'');
        holdInit=true;
        const started=new Promise(r=>{initStarted=r;});
        await page.locator('#serverToken').fill(token);
        await page.locator('#connectBtn').click();
        await started;
        await page.locator('#disconnectBtn').click();
        releaseInit?.();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#toolsPanel').isVisible(),false);
        assert.equal(await page.locator('#connectBtn').isEnabled(),true);
        holdInit=false;
        const before=calls.length;
        await page.evaluate(k=>localStorage.setItem(k,'{broken'),key);
        await page.locator('#connectBtn').click();
        assert.equal(calls.length,before);
        assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),'{broken');
        assert.deepEqual(errors,[]);
      }finally{await ctx.close();}
    }
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
test('built MCP route and scripts exist after Vite',async()=>{
  for(const file of ['settings/mcp-connections.html','shared/js/phone/mcp-client.js','shared/js/phone/mcp-role-permissions.js','shared/js/phone/mcp-ai-tools.js'])await access(resolve(root,'dist',file));
});
