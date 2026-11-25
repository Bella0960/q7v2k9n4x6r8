import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomChatLog,ROOM_CHAT_SCHEMA} from '../games/tabletop/room-chat-log.js';

const seats=[{seatId:'user',kind:'user'},{seatId:'role:r1',kind:'role',roleId:'r1'},{seatId:'role:r2',kind:'role',roleId:'r2',mode:'observer'}];
const ids=seats.map(s=>s.seatId);
const log=(extra={})=>createRoomChatLog({roomId:'game-room',seats,...extra});
const send=(l,id,text,who='user',readers=ids,time=1)=>l.append({senderSeatId:who,messageId:id,audienceSeatIds:readers,time},text);

test('user and roles have separate stable sender identities; order follows commit not wall clock',()=>{
  const l=log();send(l,'m1','你好','user',ids,10);send(l,'m2','轮到我啦','role:r1',ids,5);send(l,'m3','我来看棋','role:r2',ids,5);
  assert.deepEqual(l.read('user').map(m=>[m.id,m.sender.kind,m.sender.roleId,m.time]),[['m1','user',undefined,10],['m2','role','r1',5],['m3','role','r2',5]]);
  assert.ok(l.read('user').every(m=>m.schema===ROOM_CHAT_SCHEMA&&m.roomId==='game-room'));
});
test('retry with same id, text, actor and audience is idempotent even if retry clock or audience order changes',()=>{
  const l=log(),first=send(l,'m1','hello');const retry=send(l,'m1','hello','user',[...ids].reverse(),20);
  assert.equal(retry.duplicate,true);assert.equal(first.duplicate,false);assert.deepEqual(retry.message,first.message);assert.equal(l.read('user').length,1);
  send(l,'m2','hello');assert.equal(l.read('user').length,2,'same words with different IDs are not duplicates');
});
test('message ID conflict never mutates original content, sender or audience',()=>{
  const l=log();send(l,'m1','a');for(const args of [['m1','b'],['m1','a','role:r1'],['m1','a','user',['user']]]) assert.throws(()=>send(l,...args),/CHAT_MESSAGE_ID_CONFLICT/);
  assert.equal(l.read('role:r2')[0].text,'a');assert.equal(l.read('user').length,1);
});
test('private audience never leaks its message, recipients, count or sequence to excluded seats',()=>{
  const l=log();send(l,'a','public');send(l,'b','private fixture','role:r1',['role:r1']);send(l,'c','public 2');
  assert.deepEqual(l.read('user').map(m=>m.id),['a','c']);assert.deepEqual(l.read('role:r2').map(m=>m.id),['a','c']);assert.deepEqual(l.read('role:r1').map(m=>m.id),['a','b','c']);
  assert.ok(!JSON.stringify(l.read('user')).includes('private fixture'));assert.ok(!('audienceSeatIds' in l.read('role:r1')[1]));assert.ok(!('sequence' in l.read('user')[1]));
});
test('unknown sender, reader, invalid or sparse audience cannot access messages',()=>{
  const l=log();assert.throws(()=>send(l,'a','x','role:foreign'),/CHAT_UNKNOWN_SEAT/);assert.throws(()=>l.read('role:foreign'),/CHAT_UNKNOWN_SEAT/);
  for(const a of [undefined,[],['role:r1'],['user','role:foreign'],['user','user'],['user',,]]) assert.throws(()=>l.append({senderSeatId:'user',messageId:'a',time:1,audienceSeatIds:a},'x'),/INVALID_CHAT_AUDIENCE/);
  assert.deepEqual(l.read('user'),[]);
});
test('model text cannot choose actor or recipient; object payload rejected',()=>{
  const l=log();assert.throws(()=>send(l,'m1',{senderSeatId:'user',text:'x'},'role:r1'),/INVALID_CHAT_MESSAGE/);
  const message=send(l,'m2','{"senderSeatId":"user","action":"move"}','role:r1',['role:r1']).message;
  assert.equal(message.sender.seatId,'role:r1');assert.deepEqual(l.read('user'),[]);
});
test('read snapshots and caller seat definitions cannot mutate stored messages or identities',()=>{
  const mutable=seats.map(s=>({...s})),l=log({seats:mutable});mutable[1].roleId='changed';mutable.pop();
  const m=send(l,'m1','x','role:r1').message;assert.throws(()=>{m.text='changed'},TypeError);assert.throws(()=>{m.sender.roleId='changed'},TypeError);
  const list=l.read('role:r2');list.length=0;assert.equal(l.read('role:r2').length,1);assert.equal(l.read('user')[0].sender.roleId,'r1');
});
test('room instances do not share IDs or history even if same room id is reused',()=>{
  const a=log(),b=log();send(a,'m1','only A');send(b,'m1','only B');assert.equal(a.read('user')[0].text,'only A');assert.equal(b.read('user')[0].text,'only B');
  a.close();assert.throws(()=>a.read('user'),/CHAT_CLOSED/);assert.throws(()=>send(a,'m2','late'),/CHAT_CLOSED/);assert.equal(b.read('user').length,1);
});
test('bounded capacity and text fail explicitly without dropping existing entries; duplicate retry still succeeds',()=>{
  const l=log({maxMessages:2,maxTextLength:4});send(l,'m1','abcd');send(l,'m2','ef');assert.throws(()=>send(l,'m3','abcde'),/INVALID_CHAT_MESSAGE/);assert.throws(()=>send(l,'m3','ghi'),/CHAT_CAPACITY_REACHED/);
  assert.equal(send(l,'m1','abcd').duplicate,true);assert.deepEqual(l.read('user').map(m=>m.id),['m1','m2']);assert.deepEqual(l.read('user',{limit:1}).map(m=>m.id),['m2']);assert.throws(()=>l.read('user',{limit:0}),/INVALID_CHAT_LIMIT/);
});
test('malformed or sparse seats, invalid limits and invalid message values are rejected',()=>{
  for(const s of [[seats[0],,],[seats[1]], [seats[0],seats[0]],[{seatId:'user',kind:'role',roleId:'user'}],[seats[0],{seatId:'role:r1',kind:'role',roleId:'r2'}]]) assert.throws(()=>log({seats:s}),/INVALID_CHAT_SEAT/);
  for(const extra of [{roomId:''},{maxMessages:0},{maxTextLength:16001}])assert.throws(()=>log(extra),/INVALID_CHAT_SPEC/);
  const l=log();for(const [id,text,time] of [['','x',0],['x',' ',0],['x',{},0],['x','x',-1],['x','x',Infinity]]) assert.throws(()=>send(l,id,text,'user',ids,time),/INVALID_CHAT_MESSAGE/);
});
