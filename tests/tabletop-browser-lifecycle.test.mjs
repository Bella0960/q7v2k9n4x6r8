// Real Chromium, local fixture identity endpoints and roster storage only.
// This is not an authenticated QA deployment or a production account test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const id='MAO-AAAAAAAAAAAA';
const key='__mao_account_v1__'+id+'__ai_custom_characters';
const modules=new Set(['room-engine','room-dispatcher','room-lifetime','account-room-context','room-session','browser-room-session']);
const fixture=`<!doctype html><meta name="mao-account-id" content="${id}"><meta name="mao-account-role" content="user"><script type="module">
import {createBrowserRoomSession} from '/games/tabletop/browser-room-session.js';
const key=${JSON.stringify(key)};
window.__MAO_ACCOUNT_SCOPE__=Object.freeze({ready:true,accountId:${JSON.stringify(id)},role:'user'});
window.PhoneStorage={result:{getCharacters(){try{const raw=localStorage.getItem(key);if(raw===null)return {ok:false,error:{code:'NOT_FOUND'}};return {ok:true,value:JSON.parse(raw),meta:{source:'ai_custom_characters'}};}catch{return {ok:false,error:{code:'CORRUPT_DATA'}};}}}};
window.events=[];window.moves=[];
window.addEventListener('storage',e=>events.push(e.key));
window.session=createBrowserRoomSession({spec:{roomId:'local-browser-fixture',gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({n:0}),step:({state,actorSeatId})=>{moves.push(actorSeatId);return {state:{n:state.n+1},nextSeatId:actorSeatId==='user'?'role:r1':'user'};}}});
window.action=async(type,extra={})=>(await session.prepareUserAction())({type,...extra});
window.begin=async()=>{await action('invite',{roleId:'r1'});await action('start');await action('move',{move:'fixture'});window.reply=await session.prepareRoleMove('r1');};
window.errorOf=async fn=>{try{await fn();return null;}catch(error){return error.message;}};
window.fixtureReady=true;
</script>`;

async function run(fn) {
  let sessionId='session-a',accountStatus='active',accountId=id,requests=0;
  let browser;
  try {
    browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const origin='https://tabletop-fixture.invalid';
    // Serve every fixture response inside Playwright; no external network or account access.
    await context.route(origin+'/**',async route=>{
      try {
        const req=route.request(),path=new URL(req.url()).pathname;
        if(path==='/fixture')return route.fulfill({contentType:'text/html',body:fixture});
        if(path==='/writer')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture writer</title>'});
        if(path==='/api/accounts/me'||path==='/api/accounts/security'){
          requests++;
          assert.equal(req.headers()['x-mao-account-context'],id);
          if(accountId!==id)return route.fulfill({status:409,contentType:'application/json',body:'{}'});
          return route.fulfill({contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(path.endsWith('/me')?{account:{id,role:'user',status:accountStatus}}:{currentSessionId:sessionId})});
        }
        const match=/^\/games\/tabletop\/([a-z-]+)\.js$/.exec(path);
        if(match&&modules.has(match[1]))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../games/tabletop/'+match[1]+'.js',import.meta.url))});
        return route.fulfill({status:404,body:''});
      }catch{return route.fulfill({status:500,body:''});}
    });
    const writer=await context.newPage();await writer.goto(origin+'/writer');
    const write=ids=>writer.evaluate(({key,ids})=>localStorage.setItem(key,JSON.stringify(ids.map(id=>({id})))),{key,ids});
    await write(['r1','r2']);
    const page=await context.newPage();await page.goto(origin+'/fixture');await page.waitForFunction(()=>window.fixtureReady===true);await page.bringToFront();
    await fn({page,writer,context,write,requests:()=>requests,switchSession:()=>{sessionId='session-b';},switchAccount:()=>{accountId='MAO-BBBBBBBBBBBB';},disable:()=>{accountStatus='disabled';}});
  } finally {await browser?.close();}
}
const begin=page=>page.evaluate(()=>begin());
const delayed=page=>page.evaluate(()=>errorOf(()=>reply('fixture')));
const moves=page=>page.evaluate(()=>window.moves);

test('Chromium native storage events invalidate a deleted and re-added role',async()=>run(async({page,write})=>{
  await begin(page);await write(['r2']);await write(['r1','r2']);
  await page.waitForFunction(key=>events.filter(x=>x===key).length>=2,key);
  assert.equal(await delayed(page),'STALE_BROWSER_CONTEXT');
  assert.deepEqual(await moves(page),['user']);
  await page.evaluate(async()=>{const fresh=await session.prepareRoleMove('r1');await fresh('fixture');});
  assert.deepEqual(await moves(page),['user','role:r1']);
}));
test('Chromium real cross-page reorder and foreign key events preserve a valid callback',async()=>run(async({page,writer,write})=>{
  await begin(page);await write(['r2','r1']);await writer.evaluate(()=>localStorage.setItem('__mao_account_v1__MAO-BBBBBBBBBBBB__ai_custom_characters','[]'));
  await page.waitForFunction(()=>events.length>=2);
  assert.equal(await delayed(page),null);assert.deepEqual(await moves(page),['user','role:r1']);
}));
test('Chromium same-account replacement session and account switch reject delayed move',async()=>{
  for(const change of ['switchSession','switchAccount','disable']) await run(async f=>{
    await begin(f.page);f[change]();
    assert.match(await delayed(f.page),/SCOPE_CHANGED|ACCOUNT_VERIFICATION_FAILED/);
    assert.equal(await f.page.evaluate(()=>session.status()),'disposed');assert.deepEqual(await moves(f.page),['user']);
  });
});
test('Chromium offline event blocks old callback and online recheck allows fresh action',async()=>run(async({page,context})=>{
  await begin(page);await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);
  assert.equal(await delayed(page),'PAGE_INACTIVE');await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine===true);
  assert.equal(await delayed(page),'STALE_BROWSER_CONTEXT');
  await page.evaluate(async()=>{const fresh=await session.prepareRoleMove('r1');await fresh('fixture');});assert.deepEqual(await moves(page),['user','role:r1']);
}));
test('Chromium pagehide event disposes the room, including pending callback',async()=>run(async({page})=>{
  await begin(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  assert.equal(await delayed(page),'ROOM_DISPOSED');assert.equal(await page.evaluate(()=>session.status()),'disposed');assert.deepEqual(await moves(page),['user']);
}));
