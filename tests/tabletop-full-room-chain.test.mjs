import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyRoomContext} from '../games/tabletop/account-room-context.js';
import {createRoomSession} from '../games/tabletop/room-session.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';

// Exercise all five real room modules together. Only server, roster and game rules
// are fixtures; this is not an authenticated browser or real game-rule test.
const id='MAO-ABCDEFGHIJKL';
function fixture(roomId='room') {
  let roleIds=['r1','r2'], sessionId='s1', status='active';
  const calls=[];
  const readScope=()=>({ready:true,accountId:id,pageAccountId:id,role:'user'});
  const request=async path=>({ok:true,json:async()=>path.endsWith('/me')
    ? {account:{id,role:'user',status}} : {currentSessionId:sessionId}});
  const session=createRoomSession({
    verifyContext:({signal})=>verifyRoomContext({request,readScope,readScopedRoster:async x=>({...x,roleIds}),signal}),
    createLifetime:x=>createRoomLifetime({...x,createDispatcher:createRoomDispatcher}),
    spec:{roomId,gameId:'gomoku'},
    rules:{gameId:'gomoku',init:()=>({n:0}),step:({state,actorSeatId,move})=>{
      if(move!=='ok') throw Error('ILLEGAL_MOVE');
      calls.push(actorSeatId);
      return {state:{n:state.n+1},nextSeatId:actorSeatId==='user'?'role:r1':'user'};
    }}
  });
  const user=(type,extra={})=>session.prepareUserAction()({type,...extra});
  const start=async()=>{await session.refresh();user('invite',{roleId:'r1'});user('start');user('move',{move:'ok'});};
  return {session,user,start,calls,roster:x=>{roleIds=x;},sid:x=>{sessionId=x;},status:x=>{status=x;}};
}
test('all five actual modules alternate turns',async()=>{
  const f=fixture();await f.start();
  assert.equal(f.session.prepareRoleMove('r1')('ok').turnSeatId,'user');
  assert.deepEqual(f.calls,['user','role:r1']);
});
test('duplicate callback from same revision commits only once',async()=>{
  const f=fixture();await f.start();
  const a=f.session.prepareRoleMove('r1'),b=f.session.prepareRoleMove('r1');
  a('ok');assert.throws(()=>b('ok'),/STALE_ACTION/);assert.equal(f.calls.length,2);
});
test('removed and restored role never revives prepared move',async()=>{
  const f=fixture();await f.start();const a=f.session.prepareRoleMove('r1');
  f.roster(['r2']);await f.session.refresh();assert.throws(()=>a('ok'),/ROLE_UNAVAILABLE/);
  f.roster(['r1','r2']);await f.session.refresh();assert.throws(()=>a('ok'),/STALE_ROSTER/);
  f.session.prepareRoleMove('r1')('ok');assert.equal(f.calls.length,2);
});
test('reordering roster preserves callback',async()=>{
  const f=fixture();await f.start();const a=f.session.prepareRoleMove('r1');
  f.roster(['r2','r1']);await f.session.refresh();a('ok');assert.equal(f.calls.length,2);
});
test('new server session permanently invalidates room and pending move',async()=>{
  const f=fixture();await f.start();const a=f.session.prepareRoleMove('r1');
  f.sid('s2');await assert.rejects(f.session.refresh(),/SCOPE_CHANGED/);
  assert.throws(()=>a('ok'),/ROOM_DISPOSED/);assert.equal(f.calls.length,1);
});
test('disabled account permanently invalidates room',async()=>{
  const f=fixture();await f.start();f.status('disabled');
  await assert.rejects(f.session.refresh(),/ACCOUNT_VERIFICATION_FAILED/);
  assert.throws(()=>f.session.viewUser(),/ROOM_DISPOSED/);
});
test('independent rooms never share state',async()=>{
  const f=fixture('a'),g=fixture('b');await f.start();await g.start();
  const before=g.session.viewUser();f.session.prepareRoleMove('r1')('ok');
  assert.deepEqual(g.session.viewUser(),before);
});
test('invalid move preserves current room view',async()=>{
  const f=fixture();await f.start();const before=f.session.viewUser();
  assert.throws(()=>f.session.prepareRoleMove('r1')('bad'),/ILLEGAL_MOVE/);
  assert.deepEqual(f.session.viewUser(),before);
});
