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
     if(u.pathname.endsWith('/phone_storage.js'))return route.fulfill({contentType:'application/javascript',body:'window.PhoneStorage={getCharacters:()=>[{id:"roleA",name:"Same name",persona:"ROLE_A_PERSONA: studies plants",tone:"ROLE_A_TONE"},{id:"roleB",name:"Same name",persona:"ROLE_B_PERSONA: studies music",tone:"ROLE_B_TONE"}],getCurrentContactId:()=>"roleA"};'});
     if(u.pathname.endsWith('/phone_api.js'))return route.fulfill({contentType:'application/javascript',body:'window.diaryCalls=[];window.PhoneAPI={complete:opts=>{window.diaryCalls.push(opts);if(window.holdPersonWrite){return new Promise(resolve=>window.finishPersonWrite=resolve);}return Promise.resolve(opts.system.includes("创作一篇自己的私人日记")?"A synthetic role diary of adequate length.":"Synthetic comment");}};'});
     return route.continue();
    });
    await page.addInitScript(()=>{
     if(localStorage.getItem('diary_fixture_seeded'))return;
     localStorage.setItem('diary_fixture_seeded','1');
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
    assert.ok(calls.every(c=>c.system.includes('ROLE_A_PERSONA')&&c.system.includes('ROLE_A_TONE')&&!c.system.includes('ROLE_B_PERSONA')));
    for(const id of ['d_role','d_char_legacy']){
     await page.locator('[data-open-entry="'+id+'"]').click();
     await page.locator('#readerMoreBtn').click();
     assert.equal(await page.locator('#readerComment').isVisible(),false);
     assert.equal(await page.locator('#readerComment').isDisabled(),true);
     await page.locator('#readerMenuLayer').click({position:{x:8,y:8}});
     await page.locator('#readerMenuLayer').waitFor({state:'hidden'});
     await page.locator('#readerClose').click();
    }
    await page.locator('[data-open-entry="d_role"]').click();
    await page.locator('#readerMoreBtn').click();
    assert.equal(await page.locator('#readerFavorite').innerText(),'收藏');
    await page.locator('#readerPersonalRemark').click();
    await page.locator('#personalRemarkInput').fill('PRIVATE_REMARK');
    await page.locator('#personalRemarkSave').click();
    await page.locator('.reader-personal-remark p').filter({hasText:'PRIVATE_REMARK'}).waitFor();
    assert.equal(await page.locator('.reader-content').innerText(),'ROLE_PRIVATE');
    assert.equal((await records()).find(e=>e.id==='d_role').personalRemark.text,'PRIVATE_REMARK');
    assert.equal((await page.evaluate(()=>window.diaryCalls)).length,2);
    await page.locator('#readerClose').click();
    await page.locator('[data-open-entry="d_user"]').click();
    await page.locator('#readerMoreBtn').click();
    await page.locator('#readerComment').click();
    await page.locator('#annotationCharacter').selectOption('roleB');
    await page.locator('#annotationGenerate').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('maomao_diary_entries_v1')).find(e=>e.id==='d_user')?.charComments?.length===2);
    const manual=await page.evaluate(()=>window.diaryCalls.at(-1));
    assert.match(manual.system,/ROLE_B_PERSONA/);assert.match(manual.system,/ROLE_B_TONE/);assert.doesNotMatch(manual.system,/ROLE_A_PERSONA/);
    const saved=await records();
    assert.deepEqual(saved.find(e=>e.id==='d_user').charComments.map(c=>c.characterId),['roleA','roleB']);
    assert.ok(saved.filter(e=>e.id!=='d_user').every(e=>!e.charComments?.length));
    assert.equal(saved.find(e=>e.id==='d_role').personalRemark.text,'PRIVATE_REMARK');
    assert.doesNotMatch(JSON.stringify(manual),/PRIVATE_REMARK/);
    await page.evaluate(()=>localStorage.setItem('char_peek_enabled','0'));
    await page.reload();
    await page.locator('[data-open-entry="d_role"]').click();
    await page.locator('.reader-personal-remark p').filter({hasText:'PRIVATE_REMARK'}).waitFor();
    await page.locator('#readerMoreBtn').click();
    assert.equal(await page.locator('#readerPersonalRemark').innerText(),'编辑备注');
    assert.equal(await page.locator('#readerReadRemark').isVisible(),true);
    page.once('dialog',d=>d.accept());
    await page.locator('#readerReadRemark').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('maomao_diary_entries_v1')).find(e=>e.id==='d_role')?.personalRemark?.readReceipt?.roleId==='roleB');
    const readCall=await page.evaluate(()=>window.diaryCalls.at(-1));
    assert.match(readCall.user,/PRIVATE_REMARK/);assert.match(readCall.system,/ROLE_B_PERSONA/);assert.doesNotMatch(readCall.system,/ROLE_A_PERSONA/);
    await page.locator('.reader-personal-remark').filter({hasText:'备注回复'}).waitFor();
    await page.locator('#readerClose').click();
    await page.locator('#newEntryBtn').click();
    await page.locator('#editorBackdrop').waitFor({state:'visible'});
    await page.locator('#entryType').selectOption('备忘');
    assert.equal(await page.locator('#entryType').inputValue(),'备忘');
    await page.locator('#closeEditor').click();
    await page.locator('#moreBtn').click();
    assert.equal(await page.locator('#writeDiaryMenu,#writeMemoMenu').count(),0);
    await page.evaluate(()=>{window.diaryCalls=[]});
    await page.locator('#personRecordOpen').click();
    const dialog=page.locator('#personRecordBackdrop');
    await dialog.waitFor({state:'visible'});
    const center=await page.locator('.person-record-card').boundingBox();
    assert.ok(Math.abs(center.x+center.width/2-width/2)<3);
    assert.ok(Math.abs(center.y+center.height/2-844/2)<3);
    assert.equal(await page.locator('#personRecordGenerate').isDisabled(),true);
    assert.equal((await page.evaluate(()=>window.diaryCalls)).length,0);
    await page.locator('#personNameSelect').click();
    assert.equal(await page.locator('#personNameOptions').evaluate(el=>getComputedStyle(el).scrollbarWidth),'none');
    await page.locator('[data-person-id="roleB"]').click();
    await page.locator('#personKindSelect').click();
    await page.locator('[data-person-kind="备忘"]').click();
    assert.equal(await page.locator('#personKindValue').innerText(),'备忘录');
    assert.equal((await page.evaluate(()=>window.diaryCalls)).length,0);
    await page.evaluate(()=>window.holdPersonWrite=true);
    await page.locator('#personRecordGenerate').click();
    await dialog.waitFor({state:'hidden'});
    await page.locator('.person-record-status').filter({hasText:'正在写备忘录'}).waitFor();
    await page.waitForFunction(()=>typeof window.finishPersonWrite==='function');
    const personCall=await page.evaluate(()=>window.diaryCalls[0]);
    assert.match(personCall.system,/ROLE_B_PERSONA/);
    assert.doesNotMatch(personCall.system,/ROLE_A_PERSONA|PRIVATE_REMARK|ROLE_PRIVATE/);
    assert.match(personCall.system,/自己的备忘录/);
    await page.evaluate(()=>window.finishPersonWrite('整理乐谱'));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('maomao_diary_entries_v1')).some(e=>e.author==='roleB'&&e.noteType==='备忘'&&e.content==='整理乐谱'));
    await page.locator('.entry-card').filter({hasText:'整理乐谱'}).waitFor();
    assert.equal(await page.evaluate(()=>PhoneStorage.getCurrentContactId()),'roleA');
    const memo=(await records()).find(e=>e.author==='roleB'&&e.noteType==='备忘');
    await page.locator('[data-open-entry="'+memo.id+'"]').click();
    await page.locator('#readerMoreBtn').click();
    assert.equal(await page.locator('#readerComment').isVisible(),false);
    assert.equal(await page.locator('#readerPersonalRemark').isVisible(),false);
   }finally{await page.close();}
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
