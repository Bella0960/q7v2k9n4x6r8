import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { stampPwaRelease } from '../scripts/stamp-pwa-release.mjs';
import { startPwaBuiltServer } from './helpers/pwa-built-server.mjs';

// Two genuinely different stamped release artifacts, served successively at
// the same loopback origin. Use the actual app Service Worker and build stamper.
// Synthetic records only; no live identities, network APIs, or real user data.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-upgrade-'));
const source=fs.readFileSync('sw.js','utf8');
function make(dir,version){
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'sw.js'),source);
  fs.writeFileSync(path.join(dir,'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><script src="app.js?v=same"></script></head><body>upgrade fixture</body></html>');
  fs.writeFileSync(path.join(dir,'app.js'),'window.fixtureVersion='+JSON.stringify(version)+';');
  fs.writeFileSync(path.join(dir,'lazy.js'),'window.lazyVersion='+JSON.stringify(version)+';');
  return stampPwaRelease(dir);
}
let fixture,browser;
try{
  const rootA=path.join(tmp,'A'),rootB=path.join(tmp,'B');
  const a=make(rootA,'A'),b=make(rootB,'B');
  assert.notEqual(a,b);
  fixture=await startPwaBuiltServer({root:rootA});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'allow'});
  try{
    const oldPage=await context.newPage();
    await oldPage.goto(fixture.origin+'/index.html',{waitUntil:'load',timeout:15000});
    assert.equal(await oldPage.evaluate(()=>window.fixtureVersion),'A');
    await oldPage.evaluate(()=>navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}));
    await oldPage.waitForFunction(()=>!!navigator.serviceWorker.controller,null,{timeout:20000});
    await oldPage.evaluate(async()=>{
      localStorage.setItem('fixture_layout','layout-A');
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('fixture_user_data',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('data');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const db=request.result;
          const tx=db.transaction('data','readwrite');
          tx.objectStore('data').put('record-A','chat');
          tx.oncomplete=()=>{db.close();resolve();};
          tx.onerror=()=>reject(tx.error);
        };
      });
      const cache=await caches.open('maomao-font-assets-v1');
      await cache.put('/fixture-user-font',new Response('font-A'));
      const scoped=await caches.open('__mao_account_v1__fixture__maomao-font-assets-v1');
      await scoped.put('/fixture-scoped-font',new Response('scoped-A'));
      window.upgradeControllerChanges=0;
      navigator.serviceWorker.addEventListener('controllerchange',()=>{window.upgradeControllerChanges++;});
    });
    assert.ok((await oldPage.evaluate(()=>caches.keys())).some(key=>key.endsWith('-'+a)));
    assert.equal(fixture.switchRoot(rootB),b);
    await oldPage.evaluate(async()=>{
      const registration=await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await oldPage.waitForFunction(()=>window.upgradeControllerChanges>0,null,{timeout:25000});
    assert.equal(await oldPage.evaluate(()=>window.fixtureVersion),'A','update must not reload a working old document');
    const stale=await oldPage.evaluate(async release=>{
      const response=await fetch('/lazy.js?v=same&mao_rev='+release,{cache:'no-store'});
      return {status:response.status,text:await response.text()};
    },a);
    assert.equal(stale.status,409,'old lazy asset must not silently receive new release bytes');
    assert.doesNotMatch(stale.text,/lazyVersion/);
    const fresh=await context.newPage();
    await fresh.goto(fixture.origin+'/index.html',{waitUntil:'load',timeout:15000});
    assert.equal(await fresh.evaluate(()=>window.fixtureVersion),'B');
    const result=await fresh.evaluate(async release=>{
      const response=await fetch('/lazy.js?v=same&mao_rev='+release,{cache:'no-store'});
      const record=await new Promise((resolve,reject)=>{
        const open=indexedDB.open('fixture_user_data',1);
        open.onerror=()=>reject(open.error);
        open.onsuccess=()=>{
          const db=open.result;
          const tx=db.transaction('data','readonly');
          const get=tx.objectStore('data').get('chat');
          get.onsuccess=()=>resolve(get.result);
          get.onerror=()=>reject(get.error);
          tx.oncomplete=()=>db.close();
        };
      });
      const font=await (await caches.open('maomao-font-assets-v1')).match('/fixture-user-font');
      const scoped=await (await caches.open('__mao_account_v1__fixture__maomao-font-assets-v1')).match('/fixture-scoped-font');
      return {status:response.status,script:await response.text(),release:document.querySelector('meta[name="mao-build-release"]').content,
        record,layout:localStorage.getItem('fixture_layout'),font:await font?.text(),scoped:await scoped?.text(),keys:await caches.keys()};
    },b);
    assert.equal(result.status,200);
    assert.match(result.script,/lazyVersion="B"/);
    assert.equal(result.release,b);
    assert.equal(result.record,'record-A');
    assert.equal(result.layout,'layout-A');
    assert.equal(result.font,'font-A');
    assert.equal(result.scoped,'scoped-A');
    assert.ok(result.keys.some(key=>key.endsWith('-'+b)));
    assert.ok(!result.keys.some(key=>key.endsWith('-'+a)));
    console.log('PWA_CROSS_RELEASE_UPGRADE_PASS');
  }finally{await context.close();}
}finally{
  if(browser)await browser.close();
  if(fixture)await fixture.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}
