import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
const context=()=>({accountId:'a',sessionId:'s',roleIds:['r1','r2','user']});
function fixture() {
  let c=context(), revision=0, phase='playing', observer=false, calls=[];
  const life=createRoomLifetime({getContext:()=>c,createDispatcher:({getContext})=>({
    token(actor){getContext();return {actor,revision};},
    view(actor){getContext();return {phase,seats:[{seatId:'user',kind:'user',mode:'player'},{seatId:'role:r1',kind:'role',roleId:'r1',mode:observer?'observer':'player'},{seatId:'role:user',kind:'role',roleId:'user',mode:'player'}]};},
    dispatch(actor,token,action){getContext();if(token.revision!==revision)throw Error('STALE_ACTION');calls.push({actor,action});revision++;return {revision};}
  }),spec:{roomId:'r',gameId:'gomoku'}});
  return {life,calls,setContext:x=>{c=x;},setPhase:x=>{phase=x;},setObserver:x=>{observer=x;}};
}
test('missing or malformed context refuses creation before dispatcher factory',()=>{for(const c of [null,{accountId:'a',sessionId:'s',roleIds:[null]}, {accountId:'a',roleIds:[]}])assert.throws(()=>createRoomLifetime({getContext:()=>c,createDispatcher:()=>assert.fail('factory called')}),/UNVERIFIED_CONTEXT/);});
test('one callback can commit only once, even if user retains it',()=>{const f=fixture(),send=f.life.prepareUserAction();send({type:'move',move:1});assert.throws(()=>send({type:'move',move:2}),/CALLBACK_CONSUMED/);assert.equal(f.calls.length,1);});
test('role callback binds actor and wraps forged action as move payload',()=>{const f=fixture(),send=f.life.prepareRoleMove('r1');send({type:'close',actor:'user'});assert.deepEqual(f.calls,[{actor:'role:r1',action:{type:'move',move:{type:'close',actor:'user'}}}]);});
test('role called user is not the user seat',()=>{const f=fixture();f.life.prepareRoleMove('user')({x:1});assert.equal(f.calls[0].actor,'role:user');});
test('unknown roster role, nonparticipant, observer and lobby role rejected',()=>{const f=fixture();assert.throws(()=>f.life.prepareRoleMove('foreign'),/ROLE_UNAVAILABLE/);assert.throws(()=>f.life.prepareRoleMove('r2'),/ROLE_CANNOT_MOVE/);f.setObserver(true);assert.throws(()=>f.life.prepareRoleMove('r1'),/ROLE_CANNOT_MOVE/);f.setObserver(false);f.setPhase('lobby');assert.throws(()=>f.life.prepareRoleMove('r1'),/ROLE_CANNOT_MOVE/);});
test('removed role cannot use pending callback',()=>{const f=fixture(),send=f.life.prepareRoleMove('r1');f.setContext({...context(),roleIds:[]});assert.throws(()=>send({x:1}),/ROLE_UNAVAILABLE/);assert.equal(f.calls.length,0);});
test('account or session switch permanently invalidates observed room lifetime',()=>{for(const c of [{...context(),accountId:'b'},{...context(),sessionId:'new'}]){const f=fixture(),send=f.life.prepareRoleMove('r1');f.setContext(c);assert.throws(()=>send({x:1}),/SCOPE_CHANGED/);f.setContext(context());assert.throws(()=>f.life.viewUser(),/ROOM_DISPOSED/);assert.equal(f.calls.length,0);}});
test('unverified context and explicit page disposal block all existing callbacks',()=>{const f=fixture(),send=f.life.prepareRoleMove('r1');f.setContext(null);assert.throws(()=>f.life.viewUser(),/UNVERIFIED_CONTEXT/);assert.throws(()=>send({x:1}),/ROOM_DISPOSED/);const g=fixture(),pending=g.life.prepareUserAction();g.life.dispose();g.life.dispose();assert.throws(()=>pending({type:'close'}),/ROOM_DISPOSED/);assert.equal(g.calls.length,0);});
test('two prepared callbacks retain their original tokens',()=>{const f=fixture(),a=f.life.prepareUserAction(),b=f.life.prepareRoleMove('r1');a({type:'move'});assert.throws(()=>b({x:1}),/STALE_ACTION/);assert.equal(f.calls.length,1);});
