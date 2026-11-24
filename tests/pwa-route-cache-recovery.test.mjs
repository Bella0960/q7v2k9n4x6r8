import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const sw = readFileSync(resolve(import.meta.dirname, '../sw.js'), 'utf8');
const home = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
const native = readFileSync(resolve(import.meta.dirname, '../shared/js/native-feel.js'), 'utf8');
const origin = 'https://qa.example.test';
const activeName = (sw.match(/const CACHE_NAME = '([^']+)'/) || [])[1];

function harness(fetchImpl = async () => { throw Error('offline'); }) {
  const listeners = {}, names = [
    'phone-app-pwa-v282', 'phone-app-pwa-v283', 'phone-app-shell-v244', 'maomao-app-shell-v100',
    activeName, 'maomao-font-assets-v1',
    '__mao_account_v1__synthetic__maomao-font-assets-v1',
    'maomao-assets'
  ];
  const entries = new Map();
  let deletedKeys = [], globalLookups = 0, claimCount = 0, scopedLookups = 0;
  const caches = {
    async keys() { return [...names].filter(n => !deletedKeys.includes(n)); },
    async delete(name) { deletedKeys.push(name); entries.delete(name); return true; },
    async match() { globalLookups++; return new Response('foreign obsolete data', {
      headers: {'content-type':'text/html'}
    }); },
    async open(name) {
      if (!entries.has(name)) entries.set(name, new Map());
      const bucket = entries.get(name);
      const keyOf = r => typeof r === 'string' ? r : r.url;
      return {
        match: async r => { scopedLookups++; return bucket.get(keyOf(r)) || null; },
        put: async (r, response) => { bucket.set(keyOf(r), response); },
        delete: async r => bucket.delete(keyOf(r)),
        add: async () => {}
      };
    }
  };
  const self = {
    location:new URL(origin+'/'),registration:{scope:origin+'/'},
    clients:{ claim:async()=>{claimCount++;} }, skipWaiting:async()=>{},
    addEventListener:(type,callback)=>{listeners[type]=callback;}
  };
  const scope=createContext({self,caches,fetch:fetchImpl,Response,Request,Headers,
    URL,URLSearchParams,AbortController,console,Promise,setTimeout,clearTimeout});
  runInContext(sw,scope,{filename:'sw.js'});
  function request(path, mode='cors', destination='') {
    return {method:'GET',url:origin+path,mode,destination,headers:new Headers(),referrer:''};
  }
  async function dispatch(request) {
    const event={request,response:null,work:[],respondWith(p){this.response=Promise.resolve(p);},
      waitUntil(p){this.work.push(Promise.resolve(p));}};
    listeners.fetch(event);
    return event;
  }
  return {listeners,caches,request,dispatch,entries,
    get deletedKeys(){return deletedKeys;},
    get globalLookups(){return globalLookups;},
    get scopedLookups(){return scopedLookups;},
    get claimCount(){return claimCount;}};
}

test('new SW version removes stale app shell caches and preserves account and font media',async()=>{
  assert.ok(/^phone-app-pwa-v\d+$/.test(activeName));
  assert.ok(Number(activeName.slice('phone-app-pwa-v'.length)) >= 284);
  const h=harness();
  let task;
  h.listeners.activate({waitUntil(p){task=Promise.resolve(p);}});
  await task;
  assert.deepEqual([...h.deletedKeys].sort(),[
    'maomao-app-shell-v100','phone-app-pwa-v282','phone-app-pwa-v283','phone-app-shell-v244'].sort());
  assert.equal(h.claimCount,1);
});

test('private route network loss never turns into cached login page on the wrong path',async()=>{
  const h=harness();
  const event=await h.dispatch(h.request('/chat/chat/chat-detail.html','navigate'));
  const response=await event.response;
  assert.equal(response.status,503);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.text();
  assert.match(body,/连接暂时中断/);
  assert.doesNotMatch(body,/loginPanel|welcomePanel|<form/i);
  assert.equal(h.globalLookups,0);
  assert.equal(h.scopedLookups,0);
});

test('CSS must not come from a foreign cache or from a 200 HTML response',async()=>{
  const url='/account/legacy-styles.css';
  const h=harness(async()=>new Response('body { color: black; }',{
    headers:{'content-type':'text/css;charset=utf-8'}
  }));
  const cache=await h.caches.open(activeName);
  await cache.put(h.request(url),new Response('<html>broken styles</html>',{
    headers:{'content-type':'text/html'}
  }));
  const event=await h.dispatch(h.request(url,'cors','style'));
  const res=await event.response;
  assert.equal(await res.text(),'body { color: black; }');
  assert.equal(h.globalLookups,0);
  assert.equal(h.scopedLookups,0);
});

test('new SW is adopted without forcing a second protected-page navigation',()=>{
  assert.match(home,/navigator\.serviceWorker\.register\('\.\/sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.match(home,/registration\.update\(\)/);
  for(const source of [home,native]){
    const at=source.indexOf("addEventListener('controllerchange'");
    assert.ok(at>0);
    const section=source.slice(at,at+380);
    assert.doesNotMatch(section,/location\.reload\(/);
    assert.match(section,/data-maomao-sw-updated/);
  }
});
