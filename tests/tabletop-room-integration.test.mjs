import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
const context=()=>({accountId:'a',sessionId:'s',roleIds:['r1','r2','user']});
function fixture(roomId='room',getContext) {
  let ctx=context(), calls=[];
  const life=createRoomLifetime({getContext:getContext||(()=>ctx),createDispatcher:createRoomDispatcher,spec:{roomId,gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({count:0}),step:({state,actorSeatId,move})=>{
    calls.push({actorSeatId,move});
    if(move!=='valid'&&move!=='win')throw Error('ILLEGAL_MOVE');
    return {state:{count:state.count+1},nextSeatId:move==='win'?null:actorSeatId==='user'?'role:r1':'user',result:move==='win'?{kind:'win',winnerSeatIds:[actorSeatId]}:null};
  }}});
  const user=(type,extra={})=>life.prepareUserAction()({type,...extra});
  const start=()=>{user('invite',{roleId:'r1'});user('start');};
  const roleTurn=()=>{start();user('move',{move:'valid'});};
  return {life,user,start,roleTurn,calls,setContext:c=>{ctx=c;}};
}
test('real dispatcher lifecycle runs invite, start and alternating legal moves',()=>{const f=fixture();f.start();assert.equal(f.life.viewUser().turnSeatId,'user');assert.throws(()=>f.life.prepareRoleMove('r1'),/NOT_YOUR_TURN/);assert.equal(f.calls.length,0);f.user('move',{move:'valid'});assert.equal(f.life.prepareRoleMove('r1')('valid').turnSeatId,'user');assert.deepEqual(f.calls.map(x=>x.actorSeatId),['user','role:r1']);});
test('two role callbacks from same revision cannot both commit',()=>{const f=fixture();f.roleTurn();const a=f.life.prepareRoleMove('r1'),b=f.life.prepareRoleMove('r1');a('valid');assert.throws(()=>b('valid'),/STALE_ACTION/);assert.throws(()=>a('valid'),/CALLBACK_CONSUMED/);assert.equal(f.calls.length,2);});
test('role payload cannot become host action and failed move preserves revision',()=>{const f=fixture();f.roleTurn();const before=f.life.viewUser();const send=f.life.prepareRoleMove('r1');assert.throws(()=>send({type:'close',actor:'user'}),/ILLEGAL_MOVE/);assert.deepEqual(f.life.viewUser(),before);assert.equal(f.calls.at(-1).actorSeatId,'role:r1');assert.throws(()=>send('valid'),/CALLBACK_CONSUMED/);assert.equal(f.life.prepareRoleMove('r1')('valid').turnSeatId,'user');});
test('close and terminal result reject pending real callbacks',()=>{const f=fixture();f.roleTurn();const pending=f.life.prepareRoleMove('r1');f.user('close');assert.throws(()=>pending('valid'),/STALE_ACTION|ROOM_TERMINAL/);assert.equal(f.life.viewUser().phase,'closed');const g=fixture();g.roleTurn();const a=g.life.prepareRoleMove('r1'),b=g.life.prepareRoleMove('r1');assert.equal(a('win').phase,'finished');assert.throws(()=>b('valid'),/STALE_ACTION|ROOM_TERMINAL/);assert.deepEqual(g.life.viewUser().result,{kind:'win',winnerSeatIds:['role:r1']});});
test('account switch and logout permanently invalidate observed old rooms',()=>{for(const c of [null,{...context(),accountId:'b'},{...context(),sessionId:'new'}]){const f=fixture();f.roleTurn();const pending=f.life.prepareRoleMove('r1');f.setContext(c);assert.throws(()=>pending('valid'),/UNVERIFIED_CONTEXT|SCOPE_CHANGED/);f.setContext(context());assert.throws(()=>f.life.viewUser(),/ROOM_DISPOSED/);assert.equal(f.calls.length,1);}});
test('deleted role cannot act and owner can close invalid roster',()=>{const f=fixture();f.roleTurn();const pending=f.life.prepareRoleMove('r1');f.setContext({...context(),roleIds:[]});assert.throws(()=>pending('valid'),/ROLE_UNAVAILABLE/);assert.equal(f.user('close').phase,'closed');assert.equal(f.calls.length,1);});
test('disposal and recreation of same room id cannot revive callbacks',()=>{const f=fixture();f.roleTurn();const pending=f.life.prepareRoleMove('r1');f.life.dispose();const g=fixture();g.roleTurn();const before=g.life.viewUser();assert.throws(()=>pending('valid'),/ROOM_DISPOSED/);assert.deepEqual(g.life.viewUser(),before);assert.equal(g.calls.length,1);});
test('two independent rooms using same roles do not share state',()=>{const a=fixture('a'),b=fixture('b');a.roleTurn();b.start();const before=b.life.viewUser();a.life.prepareRoleMove('r1')('win');assert.deepEqual(b.life.viewUser(),before);assert.equal(b.calls.length,0);});
test('observer cannot schedule a move against the actual dispatcher',()=>{const f=fixture();f.user('invite',{roleId:'r2',mode:'observer'});f.start();assert.throws(()=>f.life.prepareRoleMove('r2'),/ROLE_CANNOT_MOVE/);assert.equal(f.calls.length,0);});
