import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root=resolve(new URL('..',import.meta.url).pathname);
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  const path=resolve(root,'.'+pathname);
  if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
  const body=await readFile(path);
  res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'application/javascript':'application/octet-stream'}).end(body);
 } catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [375,390,430]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==base)return route.abort();
   if(u.pathname.endsWith('/phone_storage.js'))return route.fulfill({contentType:'application/javascript',body:'window.PhoneStorage={getCharacters:()=>[{id:"r1",name:"Test role",worldBookIds:[]}],getApiConfig:()=>({apiKey:"mock-only"}),getChatHistory:()=>[],getMemories:()=>[],getWorldbooks:()=>[]};'});
   if(u.pathname.endsWith('/phone_api.js'))return route.fulfill({contentType:'application/javascript',body:'window.mockRequests=[];window.PhoneAPI={complete:opts=>new Promise(resolve=>window.mockRequests.push({opts,resolve}))};'});
   return route.continue();
  });
  await context.addInitScript(()=>{
   if(!localStorage.getItem('maomao_reader_settings_v1'))localStorage.setItem('maomao_reader_settings_v1',JSON.stringify({comments:true,commentRoleId:'r1',mode:'scroll'}));
  });
  await page.goto(base+'/library/library.html#shelf');
  await page.locator('.tab-item[data-route="home"]').click();
  assert.doesNotMatch(await page.locator('#homeView').innerText(),/\bMAOMAO\b|MM[—–-]\d+/i);
  await page.locator('.tab-item[data-route="settings"]').click();
  assert.doesNotMatch(await page.locator('#settingsView').innerText(),/\bMAOMAO\b|MM[—–-]\d+/i);
  const fonts=await page.locator('#settingsView .set-label').evaluateAll(els=>els.map(e=>{const c=getComputedStyle(e);return [c.fontFamily,c.fontSize,c.fontWeight].join('|')}));
  assert.equal(new Set(fonts).size,1);
  await page.locator('.tab-item[data-route="shelf"]').click();
  await page.locator('#shelfGrid .book-card').first().waitFor();
  await page.locator('#importFile').setInputFiles({name:'QA fixture.txt',mimeType:'text/plain',buffer:Buffer.from('第一章 起点\n　　第一段测试。\n　　第二段测试。\n第二章 后续\n　　未读内容测试。')});
  await page.locator('#importDialog.is-open').waitFor();
  assert.match(await page.locator('#importSummary').innerText(),/2/);
  await page.locator('#confirmBookImport').click();
  const book=page.locator('#shelfGrid .book-card').filter({hasText:'QA fixture'});
  await book.waitFor();await book.click();
  await page.locator('#readerView[aria-hidden=false]').waitFor();
  const openPrefs=async()=>{
   if(!await page.locator('#readerControls').evaluate(el=>el.classList.contains('is-open'))){
    await page.locator('#readerBody').click({position:{x:120,y:100}});
   }
   await page.locator('#ctrlSet').click();
   await page.locator('#readSettings.is-open').waitFor();
  };
  await openPrefs();
  const prefs=page.locator('#coReadPreferences');
  assert.equal(await prefs.evaluate(e=>e.open),false);
  assert.equal(await page.locator('#coReadInterval').isVisible(),false);
  assert.equal(await page.locator('#coReadLimit').isVisible(),false);
  await prefs.locator('summary').click();
  await page.locator('#coReadLimit').selectOption('10');
  await page.locator('#coReadInterval').selectOption('300');
  assert.match(await page.locator('#coReadBudgetLabel').innerText(),/0\s*\/\s*10/);
  const alignment=await page.locator('#coReadLimit').evaluate(e=>{const a=e.getBoundingClientRect(),r=e.closest('.rs-row').getBoundingClientRect();return {right:r.right-a.right,scroll:e.closest('.rs-scroll').scrollWidth,client:e.closest('.rs-scroll').clientWidth};});
  assert.ok(Math.abs(alignment.right)<3);
  assert.ok(alignment.scroll<=alignment.client+1);
  await page.locator('#sheetBackdrop').click({position:{x:10,y:10}});
  await openPrefs();
  assert.equal(await prefs.evaluate(e=>e.open),false);
  await prefs.locator('summary').click();
  assert.equal(await page.locator('#coReadLimit').inputValue(),'10');
  assert.equal(await page.locator('#coReadInterval').inputValue(),'300');
  await page.locator('#sheetBackdrop').click({position:{x:10,y:10}});
  assert.equal(await page.evaluate(()=>window.mockRequests.length),0);

  const first=page.locator('.chapter-page[data-ch="0"] [data-paragraph-comment="0"]');
  const second=page.locator('.chapter-page[data-ch="0"] [data-paragraph-comment="1"]');
  const paragraph=i=>page.locator('.chapter-page[data-ch="0"] [data-reader-paragraph="'+i+'"] .reader-paragraph');
  const hold=async i=>{
   const p=paragraph(i);await p.scrollIntoViewIfNeeded();
   const box=await p.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
   await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
   await page.locator('#paragraphSheet.is-open').waitFor();
  };
  assert.equal(await page.locator('.reader-divider').count(),0);
  assert.equal(await page.locator('[data-paragraph-comment]').count(),0);
  await hold(0);
  await page.locator('#coReadReplyInput').fill('我的讨论');
  await page.locator('#coReadReplySend').click();
  await page.locator('#paragraphCommentThread').getByText('我的讨论',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.mockRequests.length),0);
  assert.equal(await first.innerText(),'1');
  await page.locator('#generateParagraphComment').click();
  await page.waitForFunction(()=>window.mockRequests.length===1);
  assert.ok((await page.evaluate(()=>window.mockRequests[0].opts.user)).includes('我的讨论'));
  assert.ok(!(await page.evaluate(()=>window.mockRequests[0].opts.user)).includes('未读内容测试'));
  await page.locator('#closeParagraphSheet').click();await page.waitForTimeout(750);await hold(1);
  assert.equal(await page.locator('#generateParagraphComment').isDisabled(),true);
  await page.evaluate(()=>window.mockRequests[0].resolve('讨论回复'));
  await page.waitForFunction(()=>!document.getElementById('generateParagraphComment').disabled);
  assert.ok(!(await page.locator('#paragraphCommentThread').innerText()).includes('讨论回复'));
  assert.equal(await second.count(),0);
  await page.locator('#closeParagraphSheet').click();await page.waitForTimeout(750);await first.click();
  await page.locator('#paragraphCommentThread').getByText('讨论回复',{exact:false}).waitFor();
  assert.equal(await first.innerText(),'2');
  await page.reload();
  await first.click();
  await page.locator('#paragraphCommentThread').getByText('我的讨论',{exact:false}).waitFor();
  await page.locator('#paragraphCommentThread').getByText('讨论回复',{exact:false}).waitFor();
  await page.evaluate(()=>{
   const orig=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k.includes('maomao_reader_budget_v1:'))throw Error('quota test');return orig.call(this,k,v);};
  });
  await page.locator('#generateParagraphComment').click();
  await page.waitForFunction(()=>!document.getElementById('generateParagraphComment').disabled);
  assert.equal(await page.evaluate(()=>window.mockRequests.length),0);
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('READING_BROWSER_PASS:'+width);
 }
}finally{await browser?.close();await new Promise(r=>server.close(r));}
