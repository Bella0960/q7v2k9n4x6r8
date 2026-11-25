import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from 'playwright';

test('diary real mobile browser: separate user comments from role-authored diaries', {timeout:180000}, async()=>{
 const root=resolve(new URL('..',import.meta.url).pathname);
 const server=createServer(async(req,res)=>{
  try{
   const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
   if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
   const data=await readFile(path);
   res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.js')?'application/javascript':'application/octet-stream'}).end(data);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const width of [375,390,430]){
   const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true});
   try{
    await page.route('**/*',route=>{
     const u=new URL(route.request().url());
     if(u.origin!==base)return route.abort();
     if(u.pathname.endsWith('/phone_storage.js'))return route.fulfill({contentType:'application/javascript',body:'window.PhoneStorage={getCharacters:()=>[{id:"roleA",name:"Same name"},{id:"roleB",name:"Same name"}],getCurrentContactId:()=>"roleA"};'});
     if(u.pathname.endsWith('/phone_api.js'))return route.fulfill({contentType:'application/javascript',body:'window.diaryCalls=[];window.PhoneAPI={complete:opts=>{window.diaryCalls.push(opts);return Promise.resolve(opts.system.includes("写自己的私人日记")?"A synthetic role diary of adequate length.":"Synthetic comment");}};'});
     return route.continue();
    });
    await page.addInitScript(()=>{
     localStorage.setItem('char_peek_enabled','1');
     localStorage.setItem('maomao_diary_entries_v1',JSON.stringify([
      {id:'d_char_legacy',date:'2026-11-25',title:'Legacy role',content:'ROLE_PRIVATE_LEGACY',tags:[]},
      {id:'d_role',date:'2026-11-25',title:'Role diary',author:'roleB',authorName:'Same name',content:'ROLE_PRIVATE',tags:[]},
      {id:'d_user',date:'2026-11-24',title:'User diary',author:'me',content:'USER_TEXT',tags:[]}
     ]));
    });
    await page.goto(base+'/diary/diary.html');
    await page.waitForFunction(()=>{
     const entries=JSON.parse(localStorage.getItem('maomao_diary_entries_v1'));
     return entries.find(e=>e.id==='d_user')?.charComments?.length===1&&entries.some(e=>e.charWritten===true&&e.author==='roleA');
    },null,{timeout:15000});
    const records=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('maomao_diary_entries_v1')));
    const calls=await page.evaluate(()=>window.diaryCalls);
    assert.equal(calls.length,2);
    assert.ok(calls.some(c=>c.user.includes('USER_TEXT')));
    assert.ok(calls.every(c=>!c.user.includes('ROLE_PRIVATE')));
    for(const id of ['d_role','d_char_legacy']){
     await page.locator('[data-open-entry="'+id+'"]').click();
     await page.locator('#readerMoreBtn').click();
     assert.equal(await page.locator('#readerComment').isVisible(),false);
     assert.equal(await page.locator('#readerComment').isDisabled(),true);
     await page.locator('#readerClose').click();
    }
    await page.locator('[data-open-entry="d_user"]').click();
    await page.locator('#readerMoreBtn').click();
    await page.locator('#readerComment').click();
    await page.locator('#annotationCharacter').selectOption('roleB');
    await page.locator('#annotationGenerate').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('maomao_diary_entries_v1')).find(e=>e.id==='d_user')?.charComments?.length===2);
    const saved=await records();
    assert.deepEqual(saved.find(e=>e.id==='d_user').charComments.map(c=>c.characterId),['roleA','roleB']);
    assert.ok(saved.filter(e=>e.id!=='d_user').every(e=>!e.charComments?.length));
   }finally{await page.close();}
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
