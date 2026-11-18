import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const a=html.indexOf('        function _readBackHistory() {');
const b=html.indexOf('        // /photo 为用户显式触发',a);
assert.ok(a>=0 && b>a,'actual persistence functions unavailable');
const block=html.slice(a,b);

const initialRecord={
  role:'user',mid:'u1',time:1234,text:'图片在这儿',sendFailed:false,
  quote:{mid:'q1',text:'请问这个怎么样',authorName:'甲'},
  visionImageMids:['img-1','img-2'],
  bubbleIndex:0,bubbleCount:2
};
function setup(options={}) {
  const data=new Map();
  if(options.existing!==undefined) data.set('chat_history_role1',options.existing);
  const storage={
    getItem:key=>data.has(key)?data.get(key):null,
    setItem(key,value){
      if(options.quota) {const e=new Error('Quota exceeded');e.name='QuotaExceededError';throw e;}
      const list=JSON.parse(value);
      if(options.stripQuote && list[0]) delete list[0].quote;
      if(options.stripVision && list[0]) delete list[0].visionImageMids;
      if(options.stripBubble && list[0]) delete list[0].bubbleCount;
      data.set(key,JSON.stringify(list));
    }
  };
  let feedback=[];
  const fn=new Function('localStorage','storageKey','currentCharacter','_storage',
    '_chatHistoryUnreadable','showToast','_shouldWarnAgain','_resetWarnCooldown','console',
    block+'\nreturn {saveMessages,_verifyHistoryRoundTrip,_messageIdentity};');
  const svc=fn(storage,options.storageKey||'chat_history_role1',
    {id:'role1'},null,false,text=>feedback.push(text),
    ()=>true,()=>{},{warn(){}});
  return {svc,storage,data,feedback};
}

test('normal quoted-image multi-bubble user message roundtrips with all metadata',()=>{
  const {svc,data}=setup();
  const message=structuredClone(initialRecord);
  assert.equal(svc.saveMessages([message]),true);
  assert.deepEqual(JSON.parse(data.get('chat_history_role1')),[message]);
});

test('silent storage shims dropping quote, vision IDs, or bubble metadata are never treated as saved',()=>{
  for(const flag of ['stripQuote','stripVision','stripBubble']){
    const {svc,feedback}=setup({[flag]:true});
    assert.equal(svc.saveMessages([structuredClone(initialRecord)]),false,flag);
    assert.ok(feedback.some(x=>x.includes('未能保存')),flag);
  }
});

test('full localStorage quota cannot silently drop or overwrite older chat history',()=>{
  const stored=JSON.stringify([{role:'user',mid:'old',text:'保留的旧消息'}]);
  const {svc,data}=setup({existing:stored,quota:true});
  assert.equal(svc.saveMessages([{...initialRecord}]),false);
  assert.equal(data.get('chat_history_role1'),stored);
});

test('malformed primary chat JSON is guarded, never reset to empty history',()=>{
  const raw='[{"role":"user",garbled]';
  const {svc,data}=setup({existing:raw});
  assert.equal(svc.saveMessages([initialRecord]),false);
  assert.equal(data.get('chat_history_role1'),raw);
});

test('a role mismatch is blocked before touching another contact history',()=>{
  const {svc,data}=setup({storageKey:'chat_history_other'});
  assert.equal(svc.saveMessages([initialRecord]),false);
  assert.equal(data.size,0);
});

test('long existing conversations remain intact on a successful verified append',()=>{
  const prev=Array.from({length:400},(_,i)=>({
    role:i%2?'assistant':'user',mid:'m'+i,time:i+1,
    text:'以前保存的消息 '+i+'。'.repeat(42)
  }));
  const saved=prev.concat([structuredClone(initialRecord)]);
  const {svc,data}=setup({existing:JSON.stringify(prev)});
  assert.equal(svc.saveMessages(saved),true);
  const after=JSON.parse(data.get('chat_history_role1'));
  assert.equal(after.length,401);
  assert.equal(after[0].mid,'m0');
  assert.equal(after.at(-1).quote.mid,'q1');
});
