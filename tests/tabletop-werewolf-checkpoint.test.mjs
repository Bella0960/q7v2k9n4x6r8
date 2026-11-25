import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createWerewolfRules,createWerewolfRulesFromMode} from '../games/tabletop/werewolf-rules.js';
import {createWerewolfTurnDriver} from '../games/tabletop/werewolf-turn-driver.js';
import {createGameJournal} from '../games/tabletop/ludo-journal.js';
const spec={gameId:'werewolf',roomId:'w'},ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','r3','r4','r5','outside']};
function fixture({bots=false,maxRounds=12}={}){
 const d=createRoomDispatcher({getContext:()=>ctx,spec,rules:createWerewolfRules({randomIndex:n=>n-1,maxRounds})});
 const send=a=>d.dispatch('user',d.token('user'),a);
 for(const roleId of bots?['r1']:ctx.roleIds.slice(0,5))send({type:'invite',roleId});
 if(bots)send({type:'fillBots',playerCount:6});send({type:'start'});
 return d;
}
const move=(d,id,m)=>d.dispatch(id,d.token(id),{type:'move',move:m});
const restore=(b,c=ctx)=>createRoomDispatcher({getContext:()=>c,spec,rules:createWerewolfRulesFromMode(b.mode),checkpoint:b});
test('private deck and pending night actions replay without reshuffling or leaking identities',()=>{
 const d=fixture();move(d,'user',{kind:'choose',targetSeatId:'role:r4'});
 const b=d.checkpoint(),fresh=restore(b,{...ctx,sessionId:'new'});
 assert.deepEqual(fresh.view('user'),d.view('user'));assert.deepEqual(fresh.view('role:r1'),d.view('role:r1'));
 assert.equal(Object.hasOwn(fresh.view('role:r2').game,'privateInit'),false);assert.ok(fresh.view('role:r2').game.players.every(p=>!Object.hasOwn(p,'role')));
 const token=d.token('role:r1');assert.throws(()=>fresh.dispatch('role:r1',token,{type:'move',move:{kind:'pass'}}),/STALE_ACTION/);
 assert.throws(()=>restore(b,{...ctx,accountId:'other'}),/INVALID_CHECKPOINT/);
 assert.throws(()=>restore(b,{...ctx,roleIds:['r1']}),/INVALID_CHECKPOINT_SEAT/);
 const bad=JSON.parse(JSON.stringify(b));bad.privateInit.deck[0]='seer';assert.throws(()=>restore(bad),/WOLF_INVALID_PRIVATE_INIT/);
 const wrong=JSON.parse(JSON.stringify(b));wrong.moves[0].actorSeatId='role:r3';assert.throws(()=>restore(wrong),/WOLF_NOT_YOUR_TURN/);
});
test('terminal journal records team result and own public speech only; no private deck or skill history',()=>{
 const d=fixture({maxRounds:1});
 for(const id of ['user','role:r1','role:r3','role:r2'])move(d,id,{kind:'pass'});
 for(const id of ['user','role:r1','role:r2','role:r3','role:r4','role:r5'])move(d,id,id==='role:r2'?{kind:'speak',text:'先听大家意见。'}:{kind:'pass'});
 for(const id of ['user','role:r1','role:r2','role:r3','role:r4','role:r5'])move(d,id,{kind:'vote',targetSeatId:id==='user'?'role:r1':'user'});
 const b=d.checkpoint(),v=restore(b).view('user');assert.equal(v.phase,'finished');assert.equal(v.result.kind,'draw');
 const j=createGameJournal({getContext:()=>ctx});assert.equal(j.recordSavedMatch({schema:1,board:b}).duplicate,false);assert.equal(j.recordSavedMatch({schema:1,board:b}).duplicate,true);
 const mem=j.read({roleId:'r2'});assert.equal(mem[0].outcome,'draw');assert.equal(mem[1].text,'先听大家意见。');assert.deepEqual(j.read({roleId:'outside'}),[]);assert.deepEqual(j.read({roleId:'r2',channel:'daily'}),[]);
 assert.ok(!JSON.stringify(j.list()).includes('privateInit'));assert.ok(!JSON.stringify(mem).includes('inspections'));
});
test('mixed anonymous seats restore and cannot receive persistent role memory',async()=>{
 const d=fixture({bots:true,maxRounds:1});move(d,'user',{kind:'pass'});
 const saved=d.checkpoint();
 const life=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec,rules:createWerewolfRulesFromMode(saved.mode),checkpoint:saved});
 const session={viewUser:async()=>life.viewUser(),viewRole:async id=>life.viewRole(id),viewBot:async id=>life.viewBot(id),prepareRoleTurn:async id=>life.prepareRoleTurn(id),prepareBotTurn:async id=>life.prepareBotTurn(id)};
 const calls=[],driver=createWerewolfTurnDriver({session,decideRole:v=>{calls.push(v);return {kind:'pass'};},allowSpeech:()=>true});
 const result=await driver.runUntilUser();assert.ok(['user','finished','yield'].includes(result.status));assert.ok(result.actions>0);assert.ok(calls.every(v=>v.selfSeatId==='role:r1'));
 const checkpoint=life.checkpoint();assert.equal(checkpoint.seats.filter(s=>s.kind==='bot').length,4);assert.ok(checkpoint.seats.filter(s=>s.kind==='bot').every(s=>!Object.hasOwn(s,'roleId')));
 assert.deepEqual(restore(checkpoint).view('user'),life.viewUser());
 assert.throws(()=>life.viewRole('bot:1'),/ROLE_UNAVAILABLE/);
 driver.dispose();
});
