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
let browser,phase=0;
try{
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 for(const width of [375,390,430]){
  phase=width;
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==base)return route.abort();
   if(u.pathname.endsWith('/phone_storage.js'))return route.fulfill({contentType:'application/javascript',body:'window.PhoneStorage={getCharacters:()=>[{id:"r1",name:"Test role",worldBookIds:[]},{id:"r2",name:"Second reader",worldBookIds:[]}],getApiConfig:()=>({apiKey:"mock-only"}),getChatHistory:()=>[],getMemories:()=>[],getWorldbooks:()=>[]};'});
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
  await book.waitFor();
  phase=width+1;
  await page.locator('.tab-item[data-route="home"]').click();
  await page.locator('#homeGrid .book-card').filter({hasText:'QA fixture'}).click();
  await page.locator('#bookDetailView[aria-hidden=false]').waitFor();
  assert.match(await page.locator('#bookDetailName').innerText(),/QA fixture/);
  assert.equal(await page.locator('[data-detail-chapter]').count(),2);
  await page.locator('[data-detail-chapter="1"]').click();
  await page.locator('#readerView[aria-hidden=false]').waitFor();
  await page.waitForFunction(()=>location.hash.startsWith('#read-detail-')&&!location.hash.includes('?chapter='));
  await page.locator('#readerBack').click();
  await page.locator('#bookDetailView[aria-hidden=false]').waitFor();
  assert.equal(await page.locator('#bookDetailRead').innerText(),'继续阅读');
  await page.locator('[data-detail-chapter="0"]').click();
  await page.locator('#readerView[aria-hidden=false]').waitFor();
  await page.locator('#readerBack').click();
  await page.locator('#bookDetailBack').click();
  await page.locator('.tab-item[data-route="settings"]').click();
  assert.equal(await page.locator('#writeRow').count(),0);
  assert.equal(await page.locator('.import-help').count(),0);
  const fileChooser=page.waitForEvent('filechooser');
  await page.locator('#importRow').click();
  await (await fileChooser).setFiles([]);
  await page.locator('.tab-item[data-route="shelf"]').click();
  await book.click();
  await page.locator('#readerView[aria-hidden=false]').waitFor();
  const openPrefs=async()=>{
   if(!await page.locator('#readerControls').evaluate(el=>el.classList.contains('is-open'))){
    await page.locator('#readerBody').click({position:{x:120,y:100}});
   }
   await page.locator('#ctrlSet').click();
   await page.locator('#readSettings.is-open').waitFor();
  };
  // Header hides on a real scrolling gesture, not on a mere chapter render. A tap restores it.
  const assertHeader=async()=>{
   const h=await page.locator('#readerTitle').evaluate(e=>{
    const r=e.getBoundingClientRect(),head=e.closest('.reader-head').getBoundingClientRect();
    const body=document.getElementById('readerBody').getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {top:r.top,bottom:r.bottom,headBottom:head.bottom,bodyTop:body.top,visible:!!hit&&(hit===e||e.contains(hit)),text:e.textContent};
   });
   assert.ok(h.visible && h.top>=0 && h.bottom<=h.headBottom && h.headBottom<=h.bodyTop+1);
   assert.match(h.text,/QA fixture/);
   return h.top;
  };
  phase=width+2;
  await page.waitForFunction(()=>{const e=document.getElementById('readerView');return getComputedStyle(e).visibility==='visible'&&Number(getComputedStyle(e).opacity)===1;});
  const top=await assertHeader();
  const scrollGesture=async(dx,dy)=>{
   await page.locator('#sheetBackdrop').waitFor({state:'hidden'});
   await page.locator('#readSettings').waitFor({state:'hidden'});
   const box=await page.locator('#readerBody').boundingBox();
   const cdp=await context.newCDPSession(page);
   const x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2);
   const stepX=dx? -28:0,stepY=dy? -28:0;
   phase=width+2;
   try {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=4;i++){
     await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+stepX*i,y:y+stepY*i}]});
     await page.waitForTimeout(35);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.locator('#readerTitle').waitFor({state:'hidden',timeout:8000});
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#readerTitle').isVisible(),false);
    phase=width+3;
    const current=await page.locator('#readerBody').boundingBox();
    const tx=Math.round(current.x+14),ty=Math.round(current.y+45);
    assert.ok(await page.evaluate(({x,y})=>document.getElementById('readerBody').contains(document.elementFromPoint(x,y)),{x:tx,y:ty}));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty}]});
    await page.waitForTimeout(70);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.locator('#readerTitle').waitFor({state:'visible',timeout:8000});
    assert.ok(Math.abs(await assertHeader()-top)<2);
   }finally{await cdp.detach();}
  };
  await scrollGesture(0,320);
  await page.locator('#readerBody').evaluate(e=>{e.scrollTop=0;});
  await openPrefs();
  await page.locator('[data-mode="smooth"]').click();
  await page.locator('#sheetBackdrop').click({position:{x:10,y:10}});
  await scrollGesture(320,0);
  await page.locator('#readerBody').evaluate(e=>{e.scrollLeft=0;});
  await page.waitForTimeout(500);
  await openPrefs();
  await page.locator('[data-mode="scroll"]').click();
  await page.locator('#sheetBackdrop').click({position:{x:10,y:10}});
  await page.locator('#readerBody').evaluate(e=>{e.scrollTop=0;});
  await openPrefs();
  phase=width+3;
  const rolePrefs=page.locator('#readerRolePreferences');
  assert.equal(await rolePrefs.evaluate(e=>e.open),false);
  await rolePrefs.locator('summary').click();
  await page.locator('[data-reading-role="r2"]').check();
  assert.equal(await page.locator('#readerRoleCount').innerText(),'2 人');
  await rolePrefs.locator('summary').click();
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

  phase=width+4;
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
  await page.locator('#paragraphInvite summary').click();
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
  phase=width+5;
  await page.locator('#closeParagraphSheet').click();await page.waitForTimeout(750);await first.click();
  await page.locator('#paragraphCommentThread').getByText('讨论回复',{exact:false}).waitFor();
  assert.equal(await first.innerText(),'2');
  assert.equal(await page.locator('#paragraphExcerpt').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#paragraphInvite').evaluate(e=>e.open),false);
  await page.locator('#paragraphInvite summary').click();
  await page.locator('#paragraphRoleSelect').selectOption('r2');
  await page.locator('#generateParagraphComment').click();
  await page.waitForFunction(()=>window.mockRequests.length===2);
  await page.evaluate(()=>window.mockRequests[1].resolve('第二位读者的评论'));
  await page.locator('#paragraphCommentThread').getByText('第二位读者的评论',{exact:false}).waitFor();
  assert.equal(await first.innerText(),'3');
  const authors=await page.locator('#paragraphCommentThread .paragraph-comment-content strong').allTextContents();
  assert.deepEqual(authors,['我','Test role','Second reader']);
  await page.reload();
  await first.click();
  phase=width+6;
  await page.locator('#paragraphCommentThread').getByText('我的讨论',{exact:false}).waitFor();
  await page.locator('#paragraphCommentThread').getByText('讨论回复',{exact:false}).waitFor();
  await page.locator('#paragraphCommentThread').getByText('第二位读者的评论',{exact:false}).waitFor();
  await page.evaluate(()=>{
   const orig=Storage.prototype.setItem;
   Storage.prototype.setItem=function(k,v){if(k.includes('maomao_reader_budget_v1:'))throw Error('quota test');return orig.call(this,k,v);};
  });
  await page.locator('#paragraphInvite summary').click();
  await page.locator('#generateParagraphComment').click();
  await page.waitForFunction(()=>!document.getElementById('generateParagraphComment').disabled);
  assert.equal(await page.evaluate(()=>window.mockRequests.length),0);
  await page.locator('#closeParagraphSheet').click();
  await page.locator('#readerBack').click();
  await page.locator('#shelfView[aria-hidden=false]').waitFor();
  await book.waitFor();
  phase=width+7;
  console.log('SEALED_BROWSER_CHECKPOINT:391');
  const holdBook=async(card=book)=>{
   await page.locator('#shelfView[aria-hidden=false]').waitFor();
   await page.locator('#bookActionSheet.is-open').waitFor({state:'hidden'});
   await card.scrollIntoViewIfNeeded();
   // Let the scroll events settle before pressing; a pending scroll event
   // legitimately cancels the application's stationary long-press timer.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const box=await card.boundingBox();
   assert.ok(box,'book hold target is visible');
   const name=await card.locator('.book-name').innerText();
   const id=await card.getAttribute('data-book-id');
   const point={x:box.x+box.width/2,y:box.y+box.height/2,id};
   await page.mouse.move(point.x,point.y);
   await page.waitForFunction(({x,y,id})=>document.elementFromPoint(x,y)?.closest('#shelfGrid .book-card')?.dataset.bookId===id,point,{timeout:5000});
   // The app uses a 550ms timer. Keep a real pointer pressed until its menu
   // is observed, rather than racing a fixed 650ms host-side sleep.
   await page.mouse.down();
   try {
    await page.locator('#bookActionSheet.is-open').waitFor({timeout:8000});
    assert.equal(await page.locator('#bookActionTitle').innerText(),name,'wrong book action target');
   } finally {await page.mouse.up();}
   await page.locator('#bookActionSheet.is-open').waitFor();
  };
  await holdBook();
  await page.locator('#showShelfBookDetail').click();
  await page.locator('#bookDetailView[aria-hidden=false]').waitFor();
  assert.equal(await page.locator('[data-detail-chapter]').count(),2);
  await page.locator('#bookDetailBack').click();
  await page.locator('#shelfView[aria-hidden=false]').waitFor();
  console.log('SEALED_BROWSER_CHECKPOINT:392');
  await holdBook();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=120;const g=c.getContext('2d');g.fillStyle='#444';g.fillRect(0,0,80,120);return c.toDataURL('image/png').split(',')[1];});
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#changeBookCover').click();
  await (await chooser).setFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await book.locator('.has-custom img').waitFor();
  await page.reload();
  await book.locator('.has-custom img').waitFor();
  console.log('SEALED_BROWSER_CHECKPOINT:393');
  const before=await page.locator('#shelfGrid .book-card').count();
  await holdBook();
  page.once('dialog',d=>d.accept());
  await page.locator('#deleteShelfBook').click();
  await book.waitFor({state:'detached'});
  await page.reload();
  await page.locator('#shelfView[aria-hidden=false]').waitFor();
  await page.locator('#shelfGrid [data-book-id="b1"]').waitFor();
  assert.equal(await page.locator('#shelfGrid .book-card').count(),before-1);
  assert.equal(await book.count(),0);
  console.log('SEALED_BROWSER_CHECKPOINT:394');
  const defaultBook=page.locator('#shelfGrid [data-book-id="b2"]');
  await defaultBook.click();
  await page.locator('#readerView[aria-hidden=false]').waitFor();
  await page.locator('#readerBack').click();
  await page.locator('#shelfView[aria-hidden=false]').waitFor();
  await page.locator('.tab-item[data-route="home"]').click();
  await page.locator('#homeView[aria-hidden=false]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#homeGrid .book-card')?.dataset.bookId==='b2');
  await page.reload();
  await page.locator('#homeView[aria-hidden=false]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#homeGrid .book-card')?.dataset.bookId==='b2');
  await page.locator('.tab-item[data-route="shelf"]').click();
  console.log('SEALED_BROWSER_CHECKPOINT:500');
  await holdBook(defaultBook);
  const defaultChooser=page.waitForEvent('filechooser');
  await page.locator('#changeBookCover').click();
  await (await defaultChooser).setFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await defaultBook.locator('.has-custom img').waitFor();
  await page.reload();
  await defaultBook.locator('.has-custom img').waitFor();
  console.log('SEALED_BROWSER_CHECKPOINT:600');
  await holdBook(defaultBook);
  page.once('dialog',d=>d.accept());
  await page.locator('#deleteShelfBook').click();
  await defaultBook.waitFor({state:'detached'});
  await page.reload();
  console.log('SEALED_BROWSER_CHECKPOINT:700');
  await page.locator('#shelfView[aria-hidden=false]').waitFor();
  await page.locator('#shelfGrid [data-book-id="b1"]').waitFor();
  assert.equal(await defaultBook.count(),0);
  await page.locator('.tab-item[data-route="home"]').click();
  await page.locator('#homeView[aria-hidden=false]').waitFor();
  assert.equal(await page.locator('#homeGrid [data-book-id="b2"]').count(),0);
  assert.equal(await page.locator('#homeGrid .book-card').count(),2);
  assert.deepEqual(errors,[]);
  await context.close();
  console.log('READING_BROWSER_PASS:'+width);
 }
}catch(error){
 const code=error?.name==='TimeoutError'?'timeout':error?.code==='ERR_ASSERTION'?'assertion':!browser?'browser-environment':'other';
 console.error('SEALED_BROWSER_FAILURE:'+phase+':'+code);
 throw error;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
