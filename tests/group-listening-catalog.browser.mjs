// Run in the repository's authorized Playwright environment. No live site or real accounts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const files = {
  '/scope.js': '../shared/js/mao-account-scope.js',
  '/guard.js': '../shared/js/phone/group-write-guard.js',
  '/catalog.js': '../shared/js/phone/music-catalog-adapter.js',
};
const source=Object.fromEntries(Object.entries(files).map(([route,path])=>[route,readFileSync(new URL(path,import.meta.url),'utf8')]));
const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB';
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(Object.hasOwn(source,path)){res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(source[path]);}
  if(path==='/api/accounts/me'){
    const id=req.headers['x-mao-account-context'];
    res.writeHead([A,B].includes(id)?200:401,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({account:{id,role:'member',status:'active'}}));
  }
  const id=path==='/b'?B:A;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><meta name="mao-account-id" content="${id}"><meta name="mao-account-role" content="member"><script src="/scope.js"></script><script src="/guard.js"></script><script src="/catalog.js"></script>`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;
try{
  browser=await chromium.launch();
  const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
  const url=`http://127.0.0.1:${server.address().port}`;
  await a.goto(url+'/a');await b.goto(url+'/b');
  for(const [page,id] of [[a,A],[b,B]])assert.equal(await page.evaluate(()=>window.MAOGroupWriteGuard.account()),id);
  // Fixtures share the same browser origin and track ID; only the real account namespaces separate them.
  async function seed(page,marker){return page.evaluate(async marker=>{
    localStorage.setItem('music_local_tracks',JSON.stringify([{id:'local_fixture',name:marker,source:'local',durSec:1}]));
    localStorage.setItem('music_cover_assets_v1',JSON.stringify({local_fixture:'as_'+'A'.repeat(32)}));
    const request=indexedDB.open('maomao-media-store',2);
    request.onupgradeneeded=()=>{request.result.createObjectStore('wallpapers');request.result.createObjectStore('audio',{keyPath:'id'});};
    const db=await new Promise((ok,no)=>{request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});
    const blob=new Blob([marker],{type:'audio/mpeg'}),tx=db.transaction('audio','readwrite');
    tx.objectStore('audio').put({id:'local_fixture',blob,size:blob.size,mimeType:blob.type});
    await new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=tx.onerror=()=>no(tx.error);});db.close();
  },marker);}
  await seed(a,'fixture-A');
  // Missing database must not be implicitly created in account B.
  const empty=await b.evaluate(async()=>{
    localStorage.setItem('music_local_tracks',JSON.stringify([{id:'local_fixture',name:'fixture-B',source:'local'}]));
    const result=await MAOMusicCatalogAdapter.resolveSource('local_fixture');
    return {code:result.code,dbs:await indexedDB.databases()};
  });
  assert.equal(empty.code,'AUDIO_DB_MISSING');assert.ok(!empty.dbs.some(x=>x.name==='maomao-media-store'));
  await seed(b,'fixture-B');
  for(const [page,marker] of [[a,'fixture-A'],[b,'fixture-B']]){
    const result=await page.evaluate(async()=>{
      const before=localStorage.getItem('music_local_tracks');const listing=MAOMusicCatalogAdapter.listTracks();
      const resolved=await MAOMusicCatalogAdapter.resolveSource('local_fixture');
      return {name:listing.tracks[0].name,cover:listing.tracks[0].coverAssetId,ok:resolved.ok,bytes:await resolved.source.blob.text(),unchanged:before===localStorage.getItem('music_local_tracks')};
    });
    assert.equal(result.name,marker);assert.equal(result.bytes,marker);assert.equal(result.cover,'as_'+'A'.repeat(32));assert.equal(result.ok,true);assert.equal(result.unchanged,true);
  }
  const stale=await a.evaluate(async()=>{
    const pending=MAOMusicCatalogAdapter.resolveSource('local_fixture');
    document.querySelector('meta[name="mao-account-role"]').content='other';
    const r=await pending;return r.code;
  });assert.equal(stale,'SCOPE_CHANGED');
  console.log('PASS: real browser storage, two account namespaces, missing DB no-create, Blob bytes, canonical covers, stale account guard. Synthetic bytes only; decoding/playback is M04.');
  await context.close();
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
