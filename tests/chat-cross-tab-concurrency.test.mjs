import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const first = page.indexOf('        var _chatHistoryBaselines = new WeakMap();');
const last = page.indexOf('        // /photo 为用户显式触发',first);
assert.ok(first>=0 && last>first,'actual chat save and load helpers missing');
const code=page.slice(first,last);
function makeShared(existing) {
  const map=new Map();
  if(existing!==undefined)map.set('chat_history_role1',JSON.stringify(existing));
  return {
    map,
    area:{
      getItem:key=>map.has(key)?map.get(key):null,
      setItem(key,value){map.set(key,String(value));}
    }
  };
}
function openTab(area) {
  const notices=[];
  const create=new Function('localStorage','storageKey','currentCharacter','_storage',
    'showToast','getInitialMessages','console',
    code+'\nreturn {loadMessages,saveMessages,_inheritChatBaseline};');
  const instance=create(area,'chat_history_role1',{id:'role1'},null,
    message=>notices.push(message),
    ()=>[{role:'received',mid:'welcome',text:'欢迎'}],
    {warn(){}});
  return {...instance,notices};
}
const msg=(mid,text)=>({role:'user',mid,time:Number(mid.replace(/\D/g,''))||1,text});

test('two open tabs cannot silently overwrite messages added while an API reply was pending',()=>{
  const {area,map}=makeShared([msg('m1','最初的记录')]);
  const a=openTab(area),b=openTab(area);
  const inFlightA=a.loadMessages(),inFlightB=b.loadMessages();
  inFlightB.push(msg('m2','B 窗口新增的消息'));
  assert.equal(b.saveMessages(inFlightB),true);
  inFlightA.push({role:'assistant',mid:'a1',text:'A 旧历史上的延迟回复'});
  assert.equal(a.saveMessages(inFlightA),false);
  const persisted=JSON.parse(map.get('chat_history_role1'));
  assert.equal(persisted.length,2);
  assert.equal(persisted[1].mid,'m2');
  assert.ok(a.notices.some(s=>s.includes('其他窗口更新')));
});

test('same-count edits in another window are detected; protected records remain byte-for-byte unchanged',()=>{
  const initial=[msg('m1','A'),msg('m2','B')];
  const {area,map}=makeShared(initial);
  const a=openTab(area),b=openTab(area);
  const editA=a.loadMessages(),editB=b.loadMessages();
  editB[0].text='来自 B 的最新更正';
  assert.equal(b.saveMessages(editB),true);
  const bytes=map.get('chat_history_role1');
  editA[1].text='来自 A 的旧基线更正';
  assert.equal(a.saveMessages(editA),false);
  assert.equal(map.get('chat_history_role1'),bytes);
  assert.equal(JSON.parse(bytes)[0].text,'来自 B 的最新更正');
});

test('successful sequential writes in the SAME tab advance the baseline',()=>{
  const {area,map}=makeShared([msg('m1','hello')]);
  const a=openTab(area),list=a.loadMessages();
  list.push(msg('m2','first'));
  assert.equal(a.saveMessages(list),true);
  list.push(msg('m3','second'));
  assert.equal(a.saveMessages(list),true);
  assert.equal(JSON.parse(map.get('chat_history_role1')).length,3);
  assert.equal(a.notices.length,0);
});

test('after conflict, explicitly reloading merges no data silently; new writes start from the latest saved version',()=>{
  const {area,map}=makeShared([msg('m1','hello')]);
  const a=openTab(area),b=openTab(area);
  const stale=a.loadMessages();
  const newer=b.loadMessages();newer.push(msg('m2','B'));b.saveMessages(newer);
  stale.push(msg('m3','A'));
  assert.equal(a.saveMessages(stale),false);
  const refreshed=a.loadMessages();
  assert.deepEqual(refreshed.map(m=>m.mid),['m1','m2']);
  refreshed.push(msg('m3','A explicitly retried'));
  assert.equal(a.saveMessages(refreshed),true);
  assert.deepEqual(JSON.parse(map.get('chat_history_role1')).map(m=>m.mid),['m1','m2','m3']);
});

test('regenerated model-only clone inherits source version, rejecting concurrent deletion/replacement',()=>{
  const oldReply={role:'assistant',mid:'old-assistant',turnId:'t-old',text:'保存过的原始回复'};
  const {area,map}=makeShared([msg('m1','hi'),oldReply]);
  const a=openTab(area),b=openTab(area);
  const source=a.loadMessages();
  const filtered=a._inheritChatBaseline(source.filter(m=>m.mid!=='old-assistant'),source);
  const other=b.loadMessages();
  other.push(msg('m2','B during regeneration'));
  assert.equal(b.saveMessages(other),true);
  filtered.push({role:'assistant',mid:'replacement',text:'A 新生成的回复'});
  assert.equal(a.saveMessages(filtered),false);
  assert.deepEqual(JSON.parse(map.get('chat_history_role1')).map(m=>m.mid),
    ['m1','old-assistant','m2']);
});

test('quota failures and unreadable existing records still fail closed',()=>{
  const {area,map}=makeShared([msg('m1','record')]);
  const tab=openTab({...area,setItem(){throw new Error('QuotaExceededError')}});
  const snapshot=tab.loadMessages();snapshot.push(msg('m2','new'));
  assert.equal(tab.saveMessages(snapshot),false);
  assert.deepEqual(JSON.parse(map.get('chat_history_role1')).map(m=>m.mid),['m1']);
  const badArea={...area,getItem:k=>'{"corrupt":',setItem(){throw Error('must not write corrupt data')}};
  const bad=openTab(badArea);
  assert.deepEqual(bad.loadMessages(),[]);
  assert.equal(bad.saveMessages([msg('m2','no overwrite')]),false);
});

test('large saved histories protect all entries during a concurrent append',()=>{
  const many=Array.from({length:600},(_,i)=>msg('m'+(i+1),'聊天记录内容'+i+'。'.repeat(45)));
  const {area,map}=makeShared(many);
  const a=openTab(area),b=openTab(area);
  const pending=a.loadMessages();
  const fresh=b.loadMessages();
  fresh.push(msg('m601','最近一条'));
  assert.equal(b.saveMessages(fresh),true);
  pending.push({role:'assistant',mid:'reply-late',text:'旧窗口回复'});
  assert.equal(a.saveMessages(pending),false);
  const stored=JSON.parse(map.get('chat_history_role1'));
  assert.equal(stored.length,601);
  assert.equal(stored[0].mid,'m1');
  assert.equal(stored.at(-1).mid,'m601');
});
