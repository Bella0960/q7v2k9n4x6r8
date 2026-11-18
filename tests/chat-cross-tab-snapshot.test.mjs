import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const begin = page.indexOf('        var _chatHistoryBaselines = new WeakMap();');
const end = page.indexOf('        // /photo 为用户显式触发', begin);
assert.ok(begin > 0 && end > begin, 'real per-role history source is present');
const source = page.slice(begin,end);
const records = new Map();
const sharedStorage = {
  getItem(key) { return records.has(key) ? records.get(key) : null; },
  setItem(key,value) { records.set(key,value); }
};
const makeTab = (id,options={}) => {
  const messages=[];
  const stats={parsed:0};
  const instrumentedJSON={
    parse(s) { stats.parsed++; return JSON.parse(s); },
    stringify(v) { return JSON.stringify(v); }
  };
  const compiled = new Function('localStorage','storageKey','currentCharacter','_storage','showToast',
    'getInitialMessages','console','JSON',source+'\nreturn {loadMessages,saveMessages,_inheritChatBaseline,_rememberChatBaseline};');
  const db = options.storage || sharedStorage;
  const api = compiled(db,'chat_history_'+id,{id},null,x=>messages.push(x),
    ()=>[{role:'received',mid:'initial',text:'Welcome',time:1}],
    {warn() {}, error() {}},instrumentedJSON);
  return {...api,messages,stats};
};
const make=(mid,text)=>({mid,role:'user',text,time:Date.now()});

test('stale tab B cannot silently replace messages appended by tab A',()=>{
  const key='chat_history_cross-tab-1';
  records.set(key,JSON.stringify([make('initial','starting')]));
  const a=makeTab('cross-tab-1');
  const b=makeTab('cross-tab-1');
  const listA=a.loadMessages(),listB=b.loadMessages();
  listA.push(make('from-A','newer A'));
  assert.equal(a.saveMessages(listA),true);
  const actualAfterA=records.get(key);
  listB.push(make('from-B','outdated B'));
  assert.equal(b.saveMessages(listB),false);
  assert.equal(records.get(key),actualAfterA);
  assert.equal(JSON.parse(actualAfterA).at(-1).mid,'from-A');
  assert.ok(b.messages.some(x=>x.includes('其他窗口更新')));
});

test('derived array used for bulk deletion inherits old revision, cannot bypass stale-save barrier',()=>{
  const key='chat_history_cross-tab-2';
  records.set(key,JSON.stringify([make('one','first'),make('two','second')]));
  const a=makeTab('cross-tab-2'),b=makeTab('cross-tab-2');
  const oldB=b.loadMessages(),currentA=a.loadMessages();
  currentA.push(make('three','new'));
  assert.equal(a.saveMessages(currentA),true);
  const clone=b._inheritChatBaseline(oldB.filter(x=>x.mid==='one'),oldB);
  assert.equal(b.saveMessages(clone),false);
  assert.equal(JSON.parse(records.get(key)).length,3);
});

test('derived image placeholder array is rejected if another tab edits its source meanwhile',()=>{
  const key='chat_history_cross-tab-3';
  records.set(key,JSON.stringify([make('first','hello')]));
  const a=makeTab('cross-tab-3'),b=makeTab('cross-tab-3');
  const originalA=a.loadMessages(),priorB=b.loadMessages();
  originalA.push(make('updated','updated in A'));
  assert.equal(a.saveMessages(originalA),true);
  const placeholder=b._inheritChatBaseline(priorB.slice(),priorB);
  placeholder.push({role:'assistant',mid:'pending',type:'image-pending',text:'generating'});
  assert.equal(b.saveMessages(placeholder),false);
  assert.equal(JSON.parse(records.get(key)).some(x=>x.mid==='pending'),false);
});

test('long-history exact readback is O(1) parsing after write, preserving each message',()=>{
  const key='chat_history_cross-tab-4';
  const initial=Array.from({length:2000},(_,i)=>make('m'+i,'detail '+i+' lorem '.repeat(10)));
  records.set(key,JSON.stringify(initial));
  const t=makeTab('cross-tab-4');
  const list=t.loadMessages();
  t.stats.parsed=0;
  list.push(make('m2000','new'));
  assert.equal(t.saveMessages(list),true);
  assert.equal(t.stats.parsed,1,'only parse existing record for corrupt-input preflight; exact bytes verify readback');
  const stored=JSON.parse(records.get(key));
  assert.equal(stored.length,2001);
  assert.equal(stored[0].mid,'m0');
  assert.equal(stored.at(-1).mid,'m2000');
});

test('one tab may save repeatedly on the same list once its baseline advances',()=>{
  const key='chat_history_cross-tab-5';
  records.set(key,JSON.stringify([make('start','old')]));
  const tab=makeTab('cross-tab-5'),list=tab.loadMessages();
  list.push(make('add','once'));
  assert.equal(tab.saveMessages(list),true);
  list.push(make('add2','twice'));
  assert.equal(tab.saveMessages(list),true);
  assert.equal(JSON.parse(records.get(key)).length,3);
});

test('corrupt primary content is protected from accidental replacement',()=>{
  const key='chat_history_cross-tab-6',raw='[NOT JSON]';
  records.set(key,raw);
  const tab=makeTab('cross-tab-6');
  const list=tab.loadMessages();
  assert.equal(list.length,0);
  assert.equal(tab.saveMessages([make('bad','should not write')]),false);
  assert.equal(records.get(key),raw);
});

test('derived write paths remain source-tracked in the real chat page',()=>{
  assert.match(page,/var withPending = _inheritChatBaseline\(prior\.slice\(\), prior\)/);
  assert.match(page,/saveMessages\(_inheritChatBaseline\(keep, list\)\)/);
  assert.match(page,/saveMessages\(_inheritChatBaseline\(cleaned, list\)\)/);
  assert.match(page,/_inheritChatBaseline\(historyList, regenSource\)/);
});


test('untracked replacement arrays fail closed instead of bypassing the cross-tab revision check',()=>{
  const key='chat_history_cross-tab-untracked';
  records.set(key,JSON.stringify([make('first','preserved')]));
  const tab=makeTab('cross-tab-untracked');
  const before=records.get(key);
  assert.equal(tab.saveMessages([make('new','unsourced')]),false);
  assert.equal(records.get(key),before);
});

test('group receipt repair reads versioned history and carries its version into the saved result',()=>{
  const start=page.indexOf('var receiptOriginalGroupHistory = null;');
  const end=page.indexOf('readRoleHistory: function (roleId)',start);
  assert.ok(start>0 && end>start);
  const callbacks=page.slice(start,end);
  assert.match(callbacks,/var versioned = loadMessages\(\)/);
  assert.match(callbacks,/_inheritChatBaseline\(messages, receiptOriginalGroupHistory\)/);
  assert.doesNotMatch(callbacks,/var versioned = _readBackHistory\(\)/);
});
