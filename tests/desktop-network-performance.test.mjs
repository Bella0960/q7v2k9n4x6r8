import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(p, 'utf8');
const sw = read('sw.js');
const home = read('index.html');
const account = read('shared/js/mao-account-scope.js');
const section = sw.slice(sw.indexOf('async function fetchProtectedNavigation'), sw.indexOf("self.addEventListener('fetch'"));
function harness(fetch) {
  const context = vm.createContext({ fetch, AbortController, URL, Map, Date,
    setTimeout(fn, ms) { if (ms === 300) queueMicrotask(fn); return 1; }, clearTimeout() {} });
  vm.runInContext(section, context);
  return context;
}
test('one transport failure retries once; authorization response never retries', async () => {
  let count = 0;
  const h = harness(async (req, opts) => {
    assert.equal(opts.cache, 'no-store');
    assert.ok(opts.signal);
    if (++count === 1) throw new Error('network');
    return { status: 401 };
  });
  assert.equal((await h.fetchProtectedNavigation({ signal: new AbortController().signal })).status, 401);
  assert.equal(count, 2);
  await h.fetchProtectedNavigation({ signal: new AbortController().signal });
  assert.equal(count, 3);
});
test('two network failures reject and aborted navigation never fetches', async () => {
  let count = 0;
  const h = harness(async () => { count++; throw new Error('offline'); });
  await assert.rejects(h.fetchProtectedNavigation({ signal: new AbortController().signal }), /offline/);
  assert.equal(count, 2);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(h.fetchProtectedNavigation({ signal: aborted.signal }), /cancelled/);
  assert.equal(count, 2);
});
test('static cooldown is bounded and excludes HTML', () => {
  const h = harness(async () => {});
  assert.equal(h.isPublicStaticRequest({ url: 'https://example.test/index.html' }), false);
  assert.equal(h.isPublicStaticRequest({ url: 'https://example.test/a.css?v=1' }), true);
  assert.equal(h.shouldRevalidateStatic('a', 0), true);
  assert.equal(h.shouldRevalidateStatic('a', 100), false);
  assert.equal(h.shouldRevalidateStatic('a', 60000), true);
  for (let i = 0; i < 600; i++) h.shouldRevalidateStatic('k' + i, i);
  assert.ok(vm.runInContext('staticRevalidations.size', h) <= 512);
});
test('private navigation and API guard remain outside shared static caching', () => {
  assert.ok(sw.indexOf("url.pathname.startsWith('/api/')") < sw.indexOf('if (!isPublicStaticRequest(req))'));
  assert.match(sw, /return await fetchProtectedNavigation\(req\)/);
  assert.match(sw, /status: 503/);
});
test('wallpaper, icons and session checks guard duplicate work and stale results', () => {
  assert.match(home, /lastApplied === dataUrl/);
  assert.match(home, /revision === wallpaperRevision/);
  assert.match(home, /revision !== iconRefreshRevision/);
  assert.match(home, /appliedIcons.get\(iconEl\) === dataUrl/);
  assert.match(home, /if \(!reads.has\(appId\)\)/);
  assert.match(account, /now - lastSessionProbeAt < 1000\) return sessionProbeInFlight/);
  assert.match(account, /controller.abort\(\)/);
  assert.match(home, /maxRefractive: 2/);
  assert.doesNotMatch(read('desktop/js/script.js'), /localStorage.getItem\('home_custom_wallpaper'\)/);
});

test('slow successful navigation is not cut off by the optional precache deadline', async () => {
  let now=0, serial=0, calls=0;
  const timers=new Map();
  let fetchSignal, finish;
  const ctx=vm.createContext({
    AbortController,URL,Map,Date,
    fetch(_req,opts) { calls++; fetchSignal=opts.signal; return new Promise(resolve=>{finish=resolve;}); },
    setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout(id){timers.delete(id);}
  });
  vm.runInContext(section,ctx);
  const result=ctx.fetchProtectedNavigation({signal:new AbortController().signal});
  now=12000;
  for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn();}
  assert.equal(fetchSignal.aborted,false,'a valid slow response must not be prematurely aborted');
  assert.equal(calls,1);
  finish({status:200});
  assert.equal((await result).status,200);
  assert.equal(timers.size,0);
});
test('hung navigation has two finite deadlines, no infinite retry and no false HTTP logout',async()=>{
  let now=0,serial=0,calls=0;
  const timers=new Map();
  const ctx=vm.createContext({
    AbortController,URL,Map,Date,
    fetch(_req,opts){calls++;return new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(new Error('transport deadline')),{once:true});
    });},
    setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,at:now+ms});return id;},
    clearTimeout(id){timers.delete(id);}
  });
  vm.runInContext(section,ctx);
  const result=ctx.fetchProtectedNavigation({signal:new AbortController().signal});
  const checked=assert.rejects(result,/transport deadline/);
  async function advance(ms){
    now+=ms;
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
    // A rejected fetch settles before the retry delay is scheduled.
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
  }
  await advance(25000);
  assert.equal(calls,1);
  await advance(300);
  assert.equal(calls,2);
  await advance(15000);
  await checked;
  assert.equal(timers.size,0);
});
