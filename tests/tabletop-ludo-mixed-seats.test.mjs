import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
function fixture(ids=['alpha']){
  let ctx={accountId:'a',sessionId:'s',roleIds:ids};
  const session=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'mixed',gameId:'ludo'},rules:createLudoRules({mode:'adventure',rollDie:()=>3})});
  const act=a=>session.prepareUserAction()(a);
  const start=(n,roles=[])=>{for(const roleId of roles)act({type:'invite',roleId});act({type:'fillBots',playerCount:n});return act({type:'start'});};
  const userTurn=()=>{act({type:'move',move:{kind:'roll'}});act({type:'move',move:{kind:'choose',plane:0}});};
  return {session,act,start,userTurn,switchAccount:()=>{ctx={...ctx,accountId:'b'}}};
}
test('2–4 seats, 0–3 real roles, distinct temporary identities',()=>{
  for(const count of [2,3,4])for(let n=0;n<count;n++){
    const ids=['alpha','beta','bot:1'].slice(0,n),f=fixture(ids),v=f.start(count,ids);
    assert.equal(v.seats.length,count);assert.equal(v.seats.filter(s=>s.kind==='bot').length,count-n-1);
    assert.ok(v.seats.filter(s=>s.kind==='bot').every(s=>!Object.hasOwn(s,'roleId')));
    assert.equal(new Set(v.seats.map(s=>s.seatId)).size,count);
  }
});
test('invalid capacity and mid-game refill rejected',()=>{
  const f=fixture();f.act({type:'invite',roleId:'alpha'});
  assert.throws(()=>f.act({type:'fillBots',playerCount:5}),/INVALID_PLAYER_COUNT/);
  assert.throws(()=>f.act({type:'fillBots',playerCount:1}),/INVALID_PLAYER_COUNT/);
  f.act({type:'fillBots',playerCount:4});f.act({type:'fillBots',playerCount:3});
  assert.equal(f.act({type:'start'}).seats.length,3);
  assert.throws(()=>f.act({type:'fillBots',playerCount:4}),/NOT_IN_LOBBY/);
  assert.throws(()=>f.session.prepareBotTurn('bot:1'),/BOT_CANNOT_MOVE/);
});
test('ordinary seat commits legal turn and cannot impersonate role or host',()=>{
  const f=fixture([]);f.start(2);f.userTurn();
  assert.throws(()=>f.session.prepareRoleTurn('bot:1'),/ROLE_UNAVAILABLE/);
  const turn=f.session.prepareBotTurn('bot:1');
  assert.throws(()=>turn.commit({type:'close'}),/LUDO_EXPECT_ROLL/);
  assert.equal(f.session.viewUser().phase,'playing');
  assert.throws(()=>turn.commit({kind:'roll'}),/CALLBACK_CONSUMED/);
  f.session.prepareBotTurn('bot:1').commit({kind:'roll'});
  f.session.prepareBotTurn('bot:1').commit({kind:'choose',plane:0});
  assert.equal(f.session.viewUser().turnSeatId,'user');
});
test('prepared bot move expires after account switch',()=>{
  const f=fixture([]);f.start(2);f.userTurn();const turn=f.session.prepareBotTurn('bot:1');
  f.switchAccount();assert.throws(()=>turn.commit({kind:'roll'}),/SCOPE_CHANGED/);
});
