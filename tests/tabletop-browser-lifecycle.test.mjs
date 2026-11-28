// Real Chromium, local fixture identity endpoints and roster storage only.
// This is not an authenticated QA deployment or a production account test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const id='MAO-AAAAAAAAAAAA';
const key='__mao_account_v1__'+id+'__ai_custom_characters';
const modules=new Set(['room-engine','room-dispatcher','room-lifetime','account-room-context','room-session','browser-room-session','room-chat-log','room-speech-queue','room-speech-context','room-speech-runner']);
const fixture=`<!doctype html><meta name="mao-account-id" content="${id}"><meta name="mao-account-role" content="user"><script type="module">
import {createBrowserRoomSession} from '/games/tabletop/browser-room-session.js';
import {createRoomChatLog} from '/games/tabletop/room-chat-log.js';
import {createRoomSpeechRunner} from '/games/tabletop/room-speech-runner.js';
import {buildRoomSpeechContext} from '/games/tabletop/room-speech-context.js';
const key=${JSON.stringify(key)};
window.__MAO_ACCOUNT_SCOPE__=Object.freeze({ready:true,accountId:${JSON.stringify(id)},role:'user'});
window.PhoneStorage={result:{getCharacters(){try{const raw=localStorage.getItem(key);if(raw===null)return {ok:false,error:{code:'NOT_FOUND'}};return {ok:true,value:JSON.parse(raw),meta:{source:'ai_custom_characters'}};}catch{return {ok:false,error:{code:'CORRUPT_DATA'}};}}}};
window.events=[];window.moves=[];
window.addEventListener('storage',e=>events.push(e.key));
window.session=createBrowserRoomSession({spec:{roomId:'local-browser-fixture',gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({n:0}),step:({state,actorSeatId})=>{moves.push(actorSeatId);return {state:{n:state.n+1},nextSeatId:actorSeatId==='user'?'role:r1':'user'};},project:({state,actorSeatId})=>({count:state.n,seat:actorSeatId})}});
window.action=async(type,extra={})=>(await session.prepareUserAction())({type,...extra});
window.begin=async()=>{await action('invite',{roleId:'r1'});await action('start');await action('move',{move:'fixture'});window.reply=await session.prepareRoleMove('r1');};
window.errorOf=async fn=>{try{await fn();return null;}catch(error){return error.message;}};
// Test-only wiring of the real discussion modules, no external provider.
window.startSpeech=async()=>{
  const view=await session.viewUser(),signal=await session.discussionSignal();
  const log=createRoomChatLog({roomId:view.roomId,seats:view.seats});
  window.speechLog=log;window.speechOutcome=null;window.speechCalls=[];
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:['role:r1'],
    async prepare(t){const roleView=await session.viewRole(t.seatId.slice(5));return {request:buildRoomSpeechContext({roleSeatId:t.seatId,view:roleView,chatLog:log}),audienceSeatIds:['user','role:r1']};},
    generate(request,{signal}){speechCalls.push({request,signal});return new Promise(resolve=>{window.releaseSpeech=resolve;});},
    async authorize(t,p){await session.viewRole(t.seatId.slice(5));return p.audienceSeatIds;},
    validateCommit:()=>!signal.aborted,now:()=>1});
  runner.runRound([{jobId:'speech-1',seatId:'role:r1'}],{signal}).then(result=>{speechOutcome=result;},error=>{speechOutcome=error.message;});
};
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

test('Chromium discussion leaves board usable and publishes only the selected role reply',async()=>run(async({page})=>{
  await begin(page);await page.evaluate(()=>startSpeech());await page.waitForFunction(()=>speechCalls.length===1);
  assert.deepEqual(await page.evaluate(()=>speechCalls[0].request.game),{count:1,seat:'role:r1'});
  await page.evaluate(()=>reply('fixture'));assert.deepEqual(await moves(page),['user','role:r1']);
  await page.evaluate(()=>releaseSpeech('fixture reply'));await page.waitForFunction(()=>speechOutcome!==null);
  assert.deepEqual(await page.evaluate(()=>speechOutcome),{committed:1});
  assert.deepEqual(await page.evaluate(()=>speechLog.read('user').map(m=>[m.id,m.sender.seatId,m.text])),[['speech-1','role:r1','fixture reply']]);
}));
test('Chromium native roster event cancels in-flight discussion before late reply',async()=>run(async({page,write})=>{
  await begin(page);await page.evaluate(()=>startSpeech());await page.waitForFunction(()=>speechCalls.length===1);
  await write(['r2']);await page.waitForFunction(()=>speechOutcome!==null);
  assert.equal(await page.evaluate(()=>speechOutcome),'SPEECH_CANCELLED');
  assert.equal(await page.evaluate(()=>speechCalls[0].signal.aborted),true);
  await page.evaluate(async()=>{releaseSpeech('late fixture');await new Promise(resolve=>setTimeout(resolve,0));});
  assert.deepEqual(await page.evaluate(()=>speechLog.read('user')),[]);
}));

// Integration gate: use actual checked-out shared scripts, never a substitute.
// The accepted integration candidate must contain both files. Missing files fail
// this gate explicitly; this test is not a live Worker/login verification.
test('Chromium real account scope and PhoneStorage isolate game rosters',async()=>{
  const sharedPaths=['/shared/js/mao-account-scope.js','/shared/js/phone/phone_storage.js'];
  const sharedSources=new Map(await Promise.all(sharedPaths.map(async path=>[path,await readFile(new URL('..'+path,import.meta.url))])));
  const other='MAO-BBBBBBBBBBBB',founder='MAO-FFFFFFFFFFFF';
  const accounts=new Map([[id,'user'],[other,'user'],[founder,'super_admin']]);
  const physical=account=>'__mao_account_v1__'+account+'__ai_custom_characters';
  const origin='https://tabletop-fixture.invalid';
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route(origin+'/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      if(path==='/writer')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture writer</title>'});
      if(path==='/actual'){
        const account=url.searchParams.get('account'),role=accounts.get(account);
        if(!role)return route.fulfill({status:400,body:''});
        return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="mao-account-id" content="${account}"><meta name="mao-account-role" content="${role}"><script src="${sharedPaths[0]}"></script><script src="${sharedPaths[1]}"></script><script type="module">
import {createBrowserRoomVerifier} from '/games/tabletop/account-room-context.js';
import {createBrowserRoomSession} from '/games/tabletop/browser-room-session.js';
window.verify=createBrowserRoomVerifier(window);window.events=[];window.moves=[];
window.addEventListener('storage',e=>events.push(e.key));
window.room=createBrowserRoomSession({spec:{roomId:'shared-fixture',gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({n:0}),step:({state,actorSeatId})=>{moves.push(actorSeatId);return {state:{n:state.n+1},nextSeatId:actorSeatId==='user'?'role:a-role':'user'};}}});
window.fixtureReady=true;
</script>`});
      }
      if(sharedSources.has(path))return route.fulfill({contentType:'text/javascript',body:sharedSources.get(path)});
      if(path==='/api/accounts/me'||path==='/api/accounts/security'){
        const account=req.headers()['x-mao-account-context'],role=accounts.get(account);
        if(!role)return route.fulfill({status:401,contentType:'application/json',body:'{}'});
        return route.fulfill({contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify(path.endsWith('/me')?{account:{id:account,role,status:'active'}}:{currentSessionId:'fixture-session-'+account})});
      }
      const match=/^\/games\/tabletop\/([a-z-]+)\.js$/.exec(path);
      if(match&&modules.has(match[1]))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../games/tabletop/'+match[1]+'.js',import.meta.url))});
      return route.fulfill({status:404,body:''});
    });
    const writer=await context.newPage();await writer.goto(origin+'/writer');
    const seed=async(key,raw)=>writer.evaluate(({key,raw})=>raw===null?localStorage.removeItem(key):localStorage.setItem(key,raw),{key,raw});
    const roster=role=>JSON.stringify([{id:role}]);
    await seed('ai_custom_characters',roster('founder-role'));await seed(physical(id),roster('a-role'));await seed(physical(other),roster('b-role'));
    for(const [account,expected] of [[other,'b-role'],[founder,'founder-role']]){
      const page=await context.newPage();await page.goto(origin+'/actual?account='+account);await page.waitForFunction(()=>window.fixtureReady===true);await page.bringToFront();
      assert.equal(await page.evaluate(()=>window.__MAO_ACCOUNT_SCOPE__?.ready),true);
      assert.deepEqual((await page.evaluate(()=>verify())).roleIds,[expected]);await page.close();
    }
    const page=await context.newPage();await page.goto(origin+'/actual?account='+id);await page.waitForFunction(()=>window.fixtureReady===true);await page.bringToFront();
    assert.equal(await page.evaluate(()=>window.__MAO_ACCOUNT_SCOPE__?.ready),true);
    assert.deepEqual((await page.evaluate(()=>verify())).roleIds,['a-role']);
    await seed(physical(other),roster('b-role-updated'));await seed(physical(id),JSON.stringify([{id:'a-role',name:'renamed'}]));
    await page.waitForFunction(key=>events.includes(key),physical(id));
    assert.ok(!(await page.evaluate(()=>events)).includes(physical(other)));
    assert.deepEqual((await page.evaluate(()=>verify())).roleIds,['a-role']);
    await seed(physical(id),null);assert.deepEqual((await page.evaluate(()=>verify())).roleIds,[]);
    await seed(physical(id),'{');assert.equal(await page.evaluate(async()=>{try{await verify();return null;}catch(e){return e.message;}}),'ROSTER_UNVERIFIED');
    await seed(physical(id),roster('a-role'));
    await page.evaluate(async()=>{const act=async(type,extra={})=>(await room.prepareUserAction())({type,...extra});await act('invite',{roleId:'a-role'});await act('start');await act('move',{move:'ok'});window.reply=await room.prepareRoleMove('a-role');});
    assert.equal(await page.evaluate(()=>PhoneStorage.result.saveCharacters([{id:'a-role-2'}]).ok),true);
    assert.match(await page.evaluate(async()=>{try{await reply('ok');return '';}catch(e){return e.message;}}),/ROLE_UNAVAILABLE|STALE_ROSTER|ROSTER_CHANGED|STALE_BROWSER_CONTEXT/);
    assert.deepEqual(await page.evaluate(()=>moves),['user']);
    assert.equal(await writer.evaluate(key=>localStorage.getItem(key),physical(other)),roster('b-role-updated'));
    assert.equal(await writer.evaluate(()=>localStorage.getItem('ai_custom_characters')),roster('founder-role'));
  }finally{await browser.close();}
});
