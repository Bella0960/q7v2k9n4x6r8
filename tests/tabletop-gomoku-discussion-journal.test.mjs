import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createGomokuRules} from '../games/tabletop/gomoku-rules.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {createGomokuDiscussion,gomokuDiscussionEvent} from '../games/tabletop/gomoku-discussion.js';
import {createGameJournal,createLudoJournal} from '../games/tabletop/ludo-journal.js';
const ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','outside']};
function fixture(){
 const d=createRoomDispatcher({getContext:()=>ctx,spec:{gameId:'gomoku',roomId:'room'},rules:createGomokuRules()});
 const send=a=>d.dispatch('user',d.token('user'),a);
 send({type:'invite',roleId:'r1'});send({type:'invite',roleId:'r2',mode:'observer'});send({type:'start'});
 const ac=new AbortController(),session={viewUser:async()=>d.view('user'),viewRole:async id=>d.view('role:'+id),discussionSignal:async()=>ac.signal,discussionCurrent:()=>!ac.signal.aborted};
 const move=(x,y)=>{const who=d.view('user').turnSeatId;d.dispatch(who,d.token(who),{type:'move',move:{kind:'place',x,y}});return d.view('user');};
 return {d,session,move};
}
function threat(f){f.move(3,3);f.move(0,10);f.move(4,3);f.move(2,10);return f.move(5,3);}
test('committed open three produces bounded public role reaction; normal move quiet and duplicate ignored',async()=>{
 const f=fixture(),calls=[];
 const chat=createGomokuDiscussion({session:f.session,view:f.d.view('user'),generateRole:c=>{calls.push(c);return '注意这一手。';},allowOutput:()=>true});
 const first=f.move(3,3);assert.equal(gomokuDiscussionEvent(first),null);assert.equal((await chat.react(first)).reason,'QUIET');
 f.move(0,10);f.move(4,3);f.move(2,10);const v=f.move(5,3);
 assert.equal(gomokuDiscussionEvent(v).event,'open-three');assert.equal((await chat.react(v)).committed,1);
 assert.equal(calls[0].selfSeatId,'role:r1');assert.equal(calls[0].trigger.actorSeatId,'user');assert.equal((await chat.react(v)).reason,'STALE_EVENT');
 const saved=await chat.save(v.revision);assert.equal(saved.jobIds.length,1);
 const restored=createGomokuDiscussion({session:f.session,view:v,checkpoint:saved});assert.deepEqual(await restored.read(),await chat.read());assert.equal((await restored.react(v)).reason,'STALE_EVENT');chat.close();restored.close();
});
test('manual message preempts optional commentary and cancelled event remains reserved',async()=>{
 const f=fixture();let started,release;const waiting=new Promise(r=>{started=r;});
 const chat=createGomokuDiscussion({session:f.session,view:f.d.view('user'),generateRole:c=>c.trigger?(started(),new Promise(r=>{release=r;})):'正常回复',allowOutput:()=>true});
 const v=threat(f),event=chat.react(v).catch(e=>e.message);await waiting;
 const manual=chat.send({messageId:'a',text:'你觉得如何',replyToSeatId:'role:r2'});release('过时发言');
 await event;await manual;
 const log=await chat.read();assert.equal(log.length,2);assert.equal(log[1].sender.seatId,'role:r2');assert.equal(log[1].text,'正常回复');
 assert.equal((await chat.save(v.revision)).jobIds.length,2);chat.close();
});
test('old optional reaction is dropped after board moves on; no generated stale text',async()=>{
 const f=fixture();let started,release;const waiting=new Promise(r=>{started=r;});
 const chat=createGomokuDiscussion({session:f.session,view:f.d.view('user'),generateRole:()=>{started();return new Promise(r=>{release=r;});},allowOutput:()=>true});
 const v=threat(f),event=chat.react(v).catch(e=>e.message);await waiting;
 f.move(4,10);f.move(0,0);f.move(6,10);f.move(2,0);f.move(8,10);
 release('过时');await event;assert.deepEqual(await chat.read(),[]);chat.close();
});
test('terminal journal records board-derived winner and observer memory without treating observer as loser',async()=>{
 const f=fixture(),chat=createGomokuDiscussion({session:f.session,view:f.d.view('user'),generateRole:()=> '观战记录',allowOutput:()=>true});
 await chat.send({messageId:'x',text:'观战',replyToSeatId:'role:r2'});
 for(let i=0;i<5;i++){f.move(i,3);if(i<4)f.move(i*2,10);}
 const v=f.d.view('user'),saved={schema:1,board:f.d.checkpoint(),chat:await chat.save(v.revision),difficulty:'normal'};
 const j=createGameJournal({getContext:()=>ctx});assert.equal(j.recordSavedMatch(saved).duplicate,false);assert.equal(j.recordSavedMatch(saved).duplicate,true);
 assert.equal(j.list()[0].winnerSeatId,'user');assert.equal(j.read({roleId:'r1'})[0].outcome,'loss');
 const mem=j.read({roleId:'r2'});assert.equal(mem[0].outcome,'observed');assert.equal(mem[1].text,'观战记录');assert.deepEqual(j.read({roleId:'r2',channel:'daily'}),[]);
 j.permit({fragmentId:mem[1].id,targetRoleId:'outside',channel:'game',allowed:true});assert.equal(j.read({roleId:'outside'})[0].text,'观战记录');
 j.permit({fragmentId:mem[1].id,targetRoleId:'outside',channel:'game',allowed:false});assert.deepEqual(j.read({roleId:'outside'}),[]);
 assert.throws(()=>createLudoJournal({getContext:()=>ctx}).recordSavedMatch(saved),/JOURNAL_INVALID_MATCH/);
 const bad=JSON.parse(JSON.stringify(saved));bad.chat.messages[1].senderSeatId='role:r1';assert.throws(()=>createGameJournal({getContext:()=>ctx}).recordSavedMatch(bad),/GOMOKU_CHAT_CHECKPOINT/);
 chat.close();
});
