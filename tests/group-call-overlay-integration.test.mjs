import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const overlay=readFileSync(new URL('../chat/call/call-overlay.js',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const atomicSource=readFileSync(new URL('../shared/js/phone/chat-history-atomic.js',import.meta.url),'utf8');
function extract(start,end){const a=overlay.indexOf(start),b=overlay.indexOf(end,a);assert.ok(a>=0&&b>a);return overlay.slice(a,b);}
const recordSource=extract('    async function saveGroupCallRecord(record) {','    function addCallRecord() {');
test('actual group hangup helper uses the existing lock and confirms save before notification',async()=>{
 let allowed=true,release;const events=[],notices=[];
 const data=new Map([['chat_history_g1',JSON.stringify([{mid:'keep',text:'previous'}])]]);
 const global={localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},navigator:{locks:{request:async(n,o,fn)=>{await new Promise(r=>{release=r;});return fn();}}},dispatchEvent:e=>events.push(e)};
 new Function('window',atomicSource)(global);
 const helper=new Function('global','groupRoster','character','ensureMid','showToast','CustomEvent',recordSource+'\nreturn saveGroupCallRecord;')(global,{isCurrent:()=>allowed},{id:'g1'},m=>{m.mid='call-mid';},m=>notices.push(m),function(type,options){this.type=type;this.detail=options.detail;});
 const first=helper({role:'user',type:'call'});release();assert.equal(await first,true);assert.equal(events.length,1);
 assert.equal(JSON.parse(data.get('chat_history_g1')).length,2);
 const next=helper({role:'user',type:'call'});allowed=false;release();assert.equal(await next,false);
 assert.equal(events.length,1);assert.equal(JSON.parse(data.get('chat_history_g1')).length,2);
});
test('actual group transcript reads confirmed unique mids only',()=>{
 const rows=[{mid:'unrelated',role:'user',text:'x'},{mid:'u1',role:'user'},{mid:'r1',role:'assistant',memberId:'a'},{mid:'r2',role:'assistant',memberId:'b'},{mid:'dup',role:'user'},{mid:'dup',role:'user'}];
 const fn=new Function('isGroupCall','groupRoster','groupCallMids','readHistory','historyStart',extract('    function currentMessages() {','    function renderTranscript() {')+'\nreturn currentMessages;')(true,{isCurrent:()=>true,speakerFor:m=>m.memberId==='a'?'a':null},new Set(['u1','r1','r2','dup']),()=>rows,0);
 assert.deepEqual(fn().map(x=>x.mid),['u1','r1']);
});
test('group overlay is actually wired to exact receipt admission, scope lifecycle and cache references',()=>{
 assert.match(overlay,/global\.sendGroupCallMessage\(text,token,groupTurn\.canContinue/);
 assert.match(overlay,/groupTurn\.inspect\(token,progress\)/);
 assert.match(overlay,/groupTurn\.settle\(token,receipt\)/);
 assert.match(overlay,/if\(groupTurn\)groupTurn\.close\(\)/);
 assert.match(overlay,/var isSpeaker = !!latestSpeakerId && id === latestSpeakerId;/);
 for(const path of ['shared/js/phone/group-call-roster.js','shared/js/phone/group-call-turn.js','chat/call/call-overlay.js']){
  assert.ok(sw.includes(path+'?v=20261126c04'));assert.ok(page.includes(path.replace('chat/call/','call/')+'?v=20261126c04'));
 }
});
