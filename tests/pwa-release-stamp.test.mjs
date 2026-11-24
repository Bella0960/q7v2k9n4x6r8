import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampPwaRelease } from '../scripts/stamp-pwa-release.mjs';
function fixture(root,script='const v=1;') {
  fs.mkdirSync(path.join(root,'shared/js'),{recursive:true});
  fs.mkdirSync(path.join(root,'account'),{recursive:true});
  fs.writeFileSync(path.join(root,'sw.js'), "const CACHE_NAME = 'phone-app-pwa-v311';\nconst BUILD_RELEASE = '__MAOMAO_BUILD_RELEASE__';\nconst BUILD_CORE_ASSETS = [];");
  fs.writeFileSync(path.join(root,'shared/js/app.js'),script);
  fs.writeFileSync(path.join(root,'shared/js/font-loader.js'),'const font=true;');
  fs.writeFileSync(path.join(root,'app.css'),'body{}');
  fs.writeFileSync(path.join(root,'index.html'), '<html><head><script src="shared/js/app.js?v=old"></script><script src="shared/js/font-loader.js"></script><link rel="stylesheet" href="app.css"><script>const x=\'<link href="app.css">\';</script><script src="https://example.invalid/a.js"></script></head></html>');
  fs.writeFileSync(path.join(root,'account/index.html'),'<html><head><script src="../shared/js/app.js"></script></head></html>');
}
test('same emitted bytes yield the same release; changed code yields a new release; existing query survives',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pwa-release-'));
  try {
    const a=path.join(root,'a'),b=path.join(root,'b'),c=path.join(root,'c');
    fixture(a);fixture(b);fixture(c,'const v=2;');
    const first=stampPwaRelease(a);
    assert.equal(first,stampPwaRelease(b));
    assert.notEqual(first,stampPwaRelease(c));
    const html=fs.readFileSync(path.join(a,'index.html'),'utf8');
    assert.ok(html.includes('app.js?v=old&mao_rev='+first));
    assert.ok(html.includes('font-loader.mao-'+first+'.js?mao_rev='+first));
    assert.ok(fs.existsSync(path.join(a,'shared/js/font-loader.mao-'+first+'.js')));
    assert.ok(html.includes('https://example.invalid/a.js"'));
    assert.ok(html.includes("const x='<link href=\"app.css\">';"));
    const sw=fs.readFileSync(path.join(a,'sw.js'),'utf8');
    assert.ok(sw.includes('phone-app-pwa-v311-'+first));
    assert.ok(sw.includes('./shared/js/app.js?mao_rev='+first));
    assert.ok(sw.includes('./shared/js/app.js?v=old&mao_rev='+first));
    assert.equal(JSON.parse(fs.readFileSync(path.join(a,'pwa-release.json'),'utf8')).release,first);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

import vm from 'node:vm';
const current='c'.repeat(24), old='d'.repeat(24);
const origin='https://app.invalid';
function swHarness() {
  const calls={matches:[],writes:[],fetches:[],deleted:[]};
  const handlers={};
  const cache={
    async match(req) {
      calls.matches.push(req.url);
      return new Response('const correct=true;', {headers:{'content-type':'text/javascript','x-mao-release':current}});
    },
    async put(req){calls.writes.push(req.url);}
  };
  const self={
    location:new URL(origin),registration:{scope:origin+'/'},
    addEventListener(name,fn){handlers[name]=fn;},
    clients:{claim:async()=>{}}
  };
  const caches={
    open:async()=>cache,
    keys:async()=>['phone-app-pwa-v310','phone-app-pwa-v311-'+current,'maomao-font-assets-v1','maomao-media-store','__mao_account_v1__example'],
    delete:async key=>{calls.deleted.push(key);return true;}
  };
  const fetch=async(req,options)=>{
    calls.fetches.push({url:req.url,cache:options?.cache});
    if(new URL(req.url).pathname==='/pwa-release.json')return Response.json({release:current});
    return new Response('const wrong=true;', {headers:{'content-type':'text/javascript','x-mao-release':current}});
  };
  const source=fs.readFileSync('sw.js','utf8')
    .replace("const BUILD_RELEASE = '__MAOMAO_BUILD_RELEASE__';","const BUILD_RELEASE = '"+current+"';")
    .replace("const CACHE_NAME = 'phone-app-pwa-v311';","const CACHE_NAME = 'phone-app-pwa-v311-"+current+"';");
  vm.runInNewContext(source,{self,caches,fetch,URL,Request,Response,Headers,Map,Date,AbortController,setTimeout,clearTimeout,console});
  async function request(path) {
    const tasks=[];let response;
    handlers.fetch({request:new Request(origin+path),respondWith(p){response=Promise.resolve(p);},waitUntil(p){tasks.push(Promise.resolve(p));}});
    const result=await response;await Promise.all(tasks);return result;
  }
  async function activate(){let task;handlers.activate({waitUntil(p){task=Promise.resolve(p);}});await task;}
  return {calls,request,activate};
}
test('a stale executable request never receives current bytes under its old version; current exact hit works',async()=>{
  const h=swHarness();
  const res=await h.request('/shared/app.js?mao_rev='+old);
  assert.equal(res.status,409);
  assert.deepEqual(h.calls.matches,[]);
  assert.deepEqual(h.calls.writes,[]);
  assert.equal(h.calls.fetches[0].cache,'no-store');
  const good=await h.request('/shared/app.js?mao_rev='+current);
  assert.equal(good.status,200);
  assert.equal(await good.text(),'const correct=true;');
  assert.equal(h.calls.fetches.length,1);
  const manifest=await h.request('/pwa-release.json');
  assert.equal((await manifest.json()).release,current);
  assert.equal(h.calls.fetches[1].cache,'no-store');
});
test('activation removes only obsolete app-shell generations, never media or scoped account caches',async()=>{
  const h=swHarness();
  await h.activate();
  assert.deepEqual(h.calls.deleted,['phone-app-pwa-v310']);
});
