import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserRoomSession} from '../games/tabletop/browser-room-session.js';
const id='MAO-AAAAAAAAAAAA', foreign='MAO-BBBBBBBBBBBB';
const key='__mao_account_v1__'+id+'__ai_custom_characters';
const roster=ids=>JSON.stringify(ids.map(id=>({id})));
function target(){const m=new Map();return {addEventListener(n,f){if(!m.has(n))m.set(n,new Set());m.get(n).add(f);},removeEventListener(n,f){m.get(n)?.delete(f);},fire(n,e={}){for(const f of [...(m.get(n)||[])])f(e);},count(){return [...m.values()].reduce((a,s)=>a+s.size,0);}};}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({founder=false,project}={}) {
  let roles=['r1','r2'],sid='s1',active=true,reads=0,hold=null;
  const role=founder?'super_admin':'user',calls=[];
  const win=Object.assign(target(),{document:Object.assign(target(),{hidden:false,querySelector:s=>({content:s.includes('mao-account-role')?role:id})}),navigator:{onLine:true},__MAO_ACCOUNT_SCOPE__:{ready:true,accountId:id,role},PhoneStorage:{result:{getCharacters(){reads++;return {ok:true,value:roles.map(id=>({id})),meta:{source:'ai_custom_characters'}};}}},async fetch(path){if(hold){const p=hold;hold=null;await p;}return {ok:true,json:async()=>path.endsWith('/me')?{account:{id,role,status:active?'active':'disabled'}}:{currentSessionId:sid}};}});
  const session=createBrowserRoomSession({win,spec:{roomId:'room',gameId:'gomoku'},rules:{gameId:'gomoku',project,init:()=>({n:0}),step:({state,actorSeatId})=>{calls.push(actorSeatId);return {state:{n:state.n+1},nextSeatId:actorSeatId==='user'?'role:r1':'user'};}}});
  const action=async(type,more={})=>(await session.prepareUserAction())({type,...more});
  const start=async()=>{await action('invite',{roleId:'r1'});await action('start');await action('move',{move:'ok'});};
  const change=(ids,k=founder?'ai_custom_characters':key)=>{const oldValue=roster(roles);roles=ids;win.fire('storage',{key:k,oldValue,newValue:roster(ids)});};
  return {win,session,action,start,change,calls,setRoles:ids=>{roles=ids;},reads:()=>reads,sessionId:x=>{sid=x;},active:x=>{active=x;},hold:p=>{hold=p;}};
}
test('browser factory uses all five real room modules and validates each move',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');assert.equal((await reply('ok')).turnSeatId,'user');assert.deepEqual(f.calls,['user','role:r1']);assert.ok(f.reads()>=8);});
test('same-account session change without a browser event rejects delayed role result',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');f.sessionId('new');await assert.rejects(reply('ok'),/SCOPE_CHANGED/);assert.equal(f.session.status(),'disposed');assert.deepEqual(f.calls,['user']);assert.equal(f.win.count()+f.win.document.count(),0);});
test('observed removal and immediate re-addition invalidate old role callback',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');f.change(['r2']);f.change(['r1','r2']);await assert.rejects(reply('ok'),/STALE_BROWSER_CONTEXT/);await (await f.session.prepareRoleMove('r1'))('ok');assert.deepEqual(f.calls,['user','role:r1']);});
test('reordering roles and unrelated or foreign storage events do not invalidate callback',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');f.change(['r2','r1']);f.win.fire('storage',{key:'unrelated'});f.win.fire('storage',{key:'__mao_account_v1__'+foreign+'__ai_custom_characters',get oldValue(){throw Error('foreign payload read');}});await reply('ok');assert.equal(f.calls.length,2);});
test('founder unprefixed roster event invalidates prior callback',async()=>{const f=fixture({founder:true});await f.start();const reply=await f.session.prepareRoleMove('r1');f.change(['r2']);await assert.rejects(reply('ok'),/STALE_BROWSER_CONTEXT/);assert.equal(f.calls.length,1);});
test('background and offline prevent operations and invalidate delayed callback on return',async()=>{for(const mode of ['hidden','offline']){const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');if(mode==='hidden'){f.win.document.hidden=true;f.win.document.fire('visibilitychange');}else{f.win.navigator.onLine=false;f.win.fire('offline');}await assert.rejects(reply('ok'),/PAGE_INACTIVE/);if(mode==='hidden'){f.win.document.hidden=false;f.win.document.fire('visibilitychange');}else{f.win.navigator.onLine=true;f.win.fire('online');}await assert.rejects(reply('ok'),/STALE_BROWSER_CONTEXT/);await (await f.session.prepareRoleMove('r1'))('ok');assert.equal(f.calls.length,2);}});
test('pagehide permanently closes session, removes listeners and blocks old callbacks',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');f.win.fire('pagehide',{persisted:true});assert.equal(f.win.count()+f.win.document.count(),0);await assert.rejects(reply('ok'),/ROOM_DISPOSED/);await assert.rejects(f.session.refresh(),/ROOM_DISPOSED/);assert.equal(f.calls.length,1);});
test('pagehide during preflight cannot resurrect room after a delayed response',async()=>{const f=fixture(),d=deferred();f.hold(d.promise);const p=f.session.refresh();await Promise.resolve();f.win.fire('pagehide');d.resolve();await assert.rejects(p,/ROOM_DISPOSED|CONTEXT_CANCELLED/);assert.equal(f.session.status(),'disposed');});
test('focus during pending verification requires a fresh verification before use',async()=>{const f=fixture();await f.session.refresh();const before=f.reads(),d=deferred();f.hold(d.promise);const p=f.session.refresh();await Promise.resolve();f.win.fire('focus');d.resolve();await p;assert.equal(f.reads(),before+4);});
test('disabled account detected at callback commit and explicit close disposes listeners',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');f.active(false);await assert.rejects(reply('ok'),/ACCOUNT_VERIFICATION_FAILED/);assert.equal(f.calls.length,1);const g=fixture();await g.start();assert.equal((await g.action('close')).phase,'closed');assert.equal(g.session.status(),'disposed');assert.equal(g.win.count()+g.win.document.count(),0);});

test('same-page role removal during final callback verification cannot commit a move',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');const fetch=f.win.fetch;let requests=0;f.win.fetch=async(...args)=>{const response=await fetch(...args);if(++requests===4){const json=response.json;response.json=async()=>{const value=await json();f.setRoles(['r2']);return value;};}return response;};await assert.rejects(reply('ok'),/ROSTER_CHANGED/);assert.deepEqual(f.calls,['user']);assert.equal(f.session.status(),'disposed');});

test('transport failure during callback verification suspends room and invalidates old callback',async()=>{const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1');const fetch=f.win.fetch,d=deferred();f.win.fetch=async()=>{await d.promise;throw new TypeError('Failed to fetch');};const p=reply('ok');await Promise.resolve();f.win.navigator.onLine=false;f.win.fire('offline');d.resolve();await assert.rejects(p,/ACCOUNT_TEMPORARILY_UNAVAILABLE/);assert.equal(f.session.status(),'suspended');assert.deepEqual(f.calls,['user']);f.win.fetch=fetch;f.win.navigator.onLine=true;f.win.fire('online');await f.session.refresh();assert.equal(f.session.status(),'ready');assert.equal(f.session.lastError(),null);await assert.rejects(reply('ok'),/STALE_BROWSER_CONTEXT|STALE_ROSTER/);await (await f.session.prepareRoleMove('r1'))('ok');assert.deepEqual(f.calls,['user','role:r1']);});
test('temporary 503 or 429 suspends without permitting stale moves; explicit retry recovers',async()=>{for(const status of [503,429]){const f=fixture();await f.start();const reply=await f.session.prepareRoleMove('r1'),fetch=f.win.fetch;f.win.fetch=async()=>({ok:false,status});await assert.rejects(reply('ok'),/ACCOUNT_TEMPORARILY_UNAVAILABLE/);assert.equal(f.session.status(),'suspended');assert.deepEqual(f.calls,['user']);f.win.fetch=fetch;await f.session.refresh();await assert.rejects(reply('ok'),/STALE_BROWSER_CONTEXT|STALE_ROSTER/);await (await f.session.prepareRoleMove('r1'))('ok');assert.deepEqual(f.calls,['user','role:r1']);}});
test('session replacement during temporary outage still permanently invalidates room',async()=>{const f=fixture();await f.start();const fetch=f.win.fetch;f.win.fetch=async()=>({ok:false,status:503});await assert.rejects(f.session.refresh(),/ACCOUNT_TEMPORARILY_UNAVAILABLE/);assert.equal(f.session.status(),'suspended');f.win.fetch=fetch;f.sessionId('new');await assert.rejects(f.session.refresh(),/SCOPE_CHANGED/);assert.equal(f.session.status(),'disposed');assert.deepEqual(f.calls,['user']);});
test('temporary initial verification failure is retryable, but unauthorized and malformed replies are fatal',async()=>{const f=fixture(),fetch=f.win.fetch;f.win.fetch=async()=>({ok:false,status:503});await assert.rejects(f.session.refresh(),/ACCOUNT_TEMPORARILY_UNAVAILABLE/);assert.equal(f.session.status(),'suspended');f.win.fetch=fetch;await f.start();assert.deepEqual(f.calls,['user']);for(const response of [{ok:false,status:401},{ok:false,status:403},{ok:false,status:409},{ok:true,json:async()=>{throw new SyntaxError('invalid JSON');}}]){const g=fixture();g.win.fetch=async()=>response;await assert.rejects(g.session.refresh(),/ACCOUNT_VERIFICATION_FAILED|invalid JSON/);assert.equal(g.session.status(),'disposed');}});

// Exercise the trusted scheduler's seat-specific snapshot plus move capability
// through the entire existing browser/session/lifetime/dispatcher chain.
const projectTurn=({state,actorSeatId})=>({count:state.n,privateField:actorSeatId==='user'?'user-only':'role-only'});
test('role turn request exposes its own detached snapshot and commits only that revision',async()=>{
  const f=fixture({project:projectTurn});await f.start();
  const request=await f.session.prepareRoleTurn('r1');
  assert.equal(request.view.selfSeatId,'role:r1');assert.equal(request.view.turnSeatId,'role:r1');
  assert.deepEqual(request.view.game,{count:1,privateField:'role-only'});
  assert.ok(!JSON.stringify(request.view).includes('user-only'));
  assert.ok(!('accountId' in request.view)&&!('sessionId' in request.view));
  const user=await f.session.viewUser();assert.deepEqual(user.game,{count:1,privateField:'user-only'});
  request.view.game.count=999;
  const result=await request.commit('ok');assert.deepEqual(result.game,{count:2,privateField:'role-only'});
  assert.equal((await f.session.viewUser()).game.count,2);assert.deepEqual(f.calls,['user','role:r1']);
  await assert.rejects(request.commit('ok'),/CALLBACK_CONSUMED|STALE_ACTION/);
});
test('role turn snapshot cannot be obtained before turn or by an observer or foreign role',async()=>{
  const f=fixture({project:projectTurn});await f.action('invite',{roleId:'r1'});await f.action('invite',{roleId:'r2',mode:'observer'});await f.action('start');
  await assert.rejects(f.session.prepareRoleTurn('r1'),/NOT_YOUR_TURN/);
  await assert.rejects(f.session.prepareRoleTurn('r2'),/ROLE_CANNOT_MOVE/);
  await assert.rejects(f.session.prepareRoleTurn('foreign'),/ROLE_UNAVAILABLE/);
  assert.deepEqual(f.calls,[]);
});
test('two requests for the same role turn cannot commit twice',async()=>{
  const f=fixture({project:projectTurn});await f.start();
  const a=await f.session.prepareRoleTurn('r1'),b=await f.session.prepareRoleTurn('r1');
  assert.equal(a.view.revision,b.view.revision);await a.commit('ok');
  await assert.rejects(b.commit('ok'),/STALE_ACTION/);assert.deepEqual(f.calls,['user','role:r1']);
});
test('role turn capability is revoked on role removal or login replacement',async()=>{
  for(const change of ['roster','session']){const f=fixture({project:projectTurn});await f.start();const request=await f.session.prepareRoleTurn('r1');
    if(change==='roster')f.change(['r2']);else f.sessionId('replacement');
    await assert.rejects(request.commit('ok'),/STALE_BROWSER_CONTEXT|ROLE_UNAVAILABLE|SCOPE_CHANGED/);assert.deepEqual(f.calls,['user']);
  }
});

// A stalled network request or response body must not permanently lock the room.
async function observe(p) {
  return Promise.race([p.then(value=>({value}),error=>({error})),new Promise(resolve=>setImmediate(()=>resolve({pending:true})))]);
}
test('stalled identity request times out, suspends and permits a fresh verified turn',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();await f.start();const turn=await f.session.prepareRoleTurn('r1'), original=f.win.fetch;
  const stall=deferred();let signal;
  f.win.fetch=async(path,options)=>{signal=options.signal;await stall.promise;return original(path,options);};
  const pending=turn.commit('ok');await observe(pending);
  t.mock.timers.tick(15000);
  const outcome=await observe(pending);
  // Release the fixture even when running against the unpatched baseline.
  f.win.fetch=original;stall.resolve();await pending.catch(()=>{});
  assert.equal(outcome.error?.message,'ACCOUNT_TEMPORARILY_UNAVAILABLE');assert.equal(signal?.aborted,true);
  assert.equal(f.session.status(),'suspended');assert.deepEqual(f.calls,['user']);
  await f.session.refresh();await assert.rejects(turn.commit('ok'),/STALE_ROSTER|STALE_BROWSER_CONTEXT/);
  await (await f.session.prepareRoleTurn('r1')).commit('ok');assert.deepEqual(f.calls,['user','role:r1']);
});
test('stalled response body obeys the same verification deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),original=f.win.fetch,stall=deferred();let signal;
  f.win.fetch=async(path,options)=>{signal=options.signal;const response=await original(path,options),json=response.json;return {...response,json:async()=>{await stall.promise;return json();}};};
  const pending=f.session.refresh();await observe(pending);t.mock.timers.tick(15000);const outcome=await observe(pending);
  f.win.fetch=original;stall.resolve();await pending.catch(()=>{});
  assert.equal(outcome.error?.message,'ACCOUNT_TEMPORARILY_UNAVAILABLE');assert.equal(signal?.aborted,true);assert.equal(f.session.status(),'suspended');
  await f.session.refresh();assert.equal(f.session.status(),'ready');
});
test('page exit cancels stalled request immediately without waiting for deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),original=f.win.fetch,stall=deferred();let signal;
  f.win.fetch=async(path,options)=>{signal=options.signal;await stall.promise;return original(path,options);};
  const pending=f.session.refresh();await observe(pending);f.win.fire('pagehide');const outcome=await observe(pending);
  f.win.fetch=original;stall.resolve();await pending.catch(()=>{});
  assert.match(outcome.error?.message??'',/CONTEXT_CANCELLED|ROOM_DISPOSED/);assert.equal(signal?.aborted,true);assert.equal(f.session.status(),'disposed');
});

// Discussion needs a read-only per-seat view, even when the speaker cannot move.
test('out-of-turn and observer speech views are read-only and seat-projected',async()=>{
  const f=fixture({project:({state,actorSeatId})=>({n:state.n,visibleTo:actorSeatId})});
  await f.action('invite',{roleId:'r1'});await f.action('invite',{roleId:'r2',mode:'observer'});await f.action('start');
  const before=await f.session.viewUser();
  for(const roleId of ['r1','r2']){
    const v=await f.session.viewRole(roleId);assert.equal(v.selfSeatId,'role:'+roleId);
    assert.deepEqual(v.game,{n:0,visibleTo:'role:'+roleId});assert.equal(v.turnSeatId,'user');
    assert.equal(v.revision,before.revision);assert.equal('commit' in v,false);assert.equal('accountId' in v,false);
    v.game.n=999;assert.equal((await f.session.viewRole(roleId)).game.n,0);
  }
  await assert.rejects(f.session.prepareRoleTurn('r1'),/NOT_YOUR_TURN/);
  await assert.rejects(f.session.prepareRoleTurn('r2'),/ROLE_CANNOT_MOVE/);
  assert.deepEqual(f.calls,[]);assert.equal((await f.session.viewUser()).revision,before.revision);
});
test('speech view rejects lobby, uninvited, unknown and removed role',async()=>{
  const f=fixture({project:projectTurn});await f.action('invite',{roleId:'r1'});
  await assert.rejects(f.session.viewRole('r1'),/ROLE_CANNOT_VIEW/);
  await f.action('start');await assert.rejects(f.session.viewRole('r2'),/UNKNOWN_SEAT/);
  await assert.rejects(f.session.viewRole('foreign'),/ROLE_UNAVAILABLE/);
  await assert.rejects(f.session.viewRole(''),/INVALID_ROLE_ID/);
  f.setRoles(['r2']);await assert.rejects(f.session.viewRole('r1'),/ROLE_UNAVAILABLE|ROSTER_CHANGED/);
});
test('speech view never reads old room after login replacement or page exit',async()=>{
  const f=fixture({project:projectTurn});await f.start();f.sessionId('new');await assert.rejects(f.session.viewRole('r1'),/SCOPE_CHANGED/);assert.equal(f.session.status(),'disposed');
  const g=fixture({project:projectTurn});await g.start();g.win.fire('pagehide');await assert.rejects(g.session.viewRole('r1'),/ROOM_DISPOSED/);
});
test('speech view rejects hidden or offline page and re-verifies roster after recovery',async()=>{
  const f=fixture({project:projectTurn});await f.start();f.win.document.hidden=true;f.win.document.fire('visibilitychange');await assert.rejects(f.session.viewRole('r1'),/PAGE_INACTIVE/);
  f.win.document.hidden=false;f.win.document.fire('visibilitychange');f.win.navigator.onLine=false;f.win.fire('offline');await assert.rejects(f.session.viewRole('r1'),/PAGE_INACTIVE/);
  f.win.navigator.onLine=true;f.win.fire('online');f.setRoles(['r2']);await assert.rejects(f.session.viewRole('r1'),/ROLE_UNAVAILABLE|ROSTER_CHANGED/);
});
