import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const extras = readFileSync(new URL('../chat/chat/js/chat-extras.js', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = extras.indexOf(start), b = extras.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'missing source ' + start);
  return extras.slice(a, b);
}
function storage(seed = {}, shouldFail = false) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (shouldFail && key.startsWith('chat_history_')) {
        const e = new Error('full'); e.name = 'QuotaExceededError'; throw e;
      }
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    read(key) { return values.has(key) ? values.get(key) : undefined; }
  };
}
function locks() {
  const tails = new Map();
  return { request(name, options, action) {
    assert.equal(options.mode, 'exclusive');
    const next = (tails.get(name) || Promise.resolve()).then(() => action({ name }));
    tails.set(name, next.catch(() => {}));
    return next;
  } };
}
let midCounter = 0;
function fixture(initial = { chat_history_role: '[]' }, fail = false) {
  const localStorage = storage(initial, fail);
  const window = {
    localStorage, navigator: { locks: locks() },
    PhoneStorage: { MediaRepository: function () {} }
  };
  runInNewContext(atomicSource, { window });
  const notes = [];
  let renderCount = 0;
  return {
    localStorage, window, notes,
    get renders() { return renderCount; },
    role: { id:'role', name:'角色' },
    toast: text => notes.push(text),
    render: () => { renderCount++; },
    uid: () => 'uid-' + ++midCounter,
    read(id = 'role') { return JSON.parse(localStorage.getItem('chat_history_' + id)); }
  };
}
const insertSection = section('  function atomicChatWriter() {', '  // 隐藏指令');
const insertFactory = new Function('window','currentCharacter','localStorage',
  'showToast','uid','renderAllMessages','appendMessageToDOM','chatMessages',
  insertSection + '\nreturn { insertChatMessage, atomicChatWriter, extrasRoleId, extrasPrimaryHistory };');
function insertFixture(f) {
  return insertFactory(f.window, f.role, f.localStorage, f.toast,
    f.uid, f.render, () => { throw new Error('fallback should not run'); }, {scrollTop:0,scrollHeight:0});
}
const imageSection = section('  async function saveChatImageBatch(files) {', '  function openChatImagePicker() {');
const imageFactory = new Function('window','chatImageMediaRepo','compressChatImage',
  'imageMessageId','showToast','atomicChatWriter','extrasRoleId','extrasPrimaryHistory',
  'renderAllMessages','appendMessageToDOM','sendSilentInstruction',
  imageSection + '\nreturn saveChatImageBatch;');

test('ordinary plus-panel messages from two tabs append without clobbering rich history', async () => {
  const old = Array.from({length:2000},(_,i)=>({mid:'m'+i,type:i%2?'image':'text',assetId:'asset-'+i,extra:{i}}));
  const f=fixture({chat_history_role:JSON.stringify(old)});
  const a=insertFixture(f),b=insertFixture(f);
  assert.deepEqual(await Promise.all([
    a.insertChatMessage({role:'user',type:'location',location:{label:'A'}}),
    b.insertChatMessage({role:'user',type:'anniversary',anniversary:{name:'B'}})
  ]),[true,true]);
  assert.equal(f.read().length,2002);
  assert.deepEqual(f.read().slice(0,2000),old);
  assert.equal(f.renders,2);
});

test('unavailable or corrupt history refuses extras without a phantom success', async () => {
  for(const primary of ['broken-json','{"value":"object"}']) {
    const f=fixture({chat_history_role:primary});
    assert.equal(await insertFixture(f).insertChatMessage({role:'user',text:'test'}),false);
    assert.equal(f.localStorage.read('chat_history_role'),primary);
    assert.equal(f.renders,0);
    assert.equal(f.notes.length,1);
  }
});

test('multi-image uses one locked batch; another tab message remains preserved', async () => {
  const f=fixture({chat_history_role:'[{"mid":"old","text":"existing"}]'});
  const util=insertFixture(f);
  let released=0,calledAI=0;
  const repo={async putBlob(_blob,options) {
    await f.window.ChatHistoryAtomic.appendIf('role',{mid:'remote',text:'other tab'});
    return {ok:true,value:{assetId:'asset-'+options.ownerId}};
  },async removeRef(){released++;return {ok:true}},async removeAsset(){released++;return {ok:true}}};
  const send=imageFactory(f.window,repo,async()=>({}),()=> 'image-mid-'+f.uid(),
    f.toast,util.atomicChatWriter,util.extrasRoleId,util.extrasPrimaryHistory,
    f.render,()=>{},()=>{calledAI++});
  await send([{name:'a.jpg'},{name:'b.jpg'}]);
  const saved=f.read();
  assert.equal(saved.length,4);
  // The synthetic other-tab replay uses one stable mid and must not duplicate.
  assert.deepEqual(saved.slice(0,2).map(m=>m.mid),['old','remote']);
  assert.equal(saved.filter(m=>m.type==='image').length,2);
  assert.equal(calledAI,1);
  assert.equal(released,0);
});

test('quota-exceeded batch preserves old data and media refs', async () => {
  const f=fixture({chat_history_role:'[{"mid":"keep"}]'},true),util=insertFixture(f);
  let releases=0,aiCalls=0;
  const repo={async putBlob(_blob,options){return {ok:true,value:{assetId:'asset-'+options.ownerId}};},
    async removeRef(){releases++;return {ok:true};},async removeAsset(){releases++;return {ok:true};}};
  const send=imageFactory(f.window,repo,async()=>({}),()=> 'img-'+f.uid(),
    f.toast,util.atomicChatWriter,util.extrasRoleId,util.extrasPrimaryHistory,
    f.render,()=>{},()=>{aiCalls++});
  await send([{name:'keep.jpg'}]);
  assert.equal(f.localStorage.read('chat_history_role'),'[{"mid":"keep"}]');
  assert.equal(releases,0);
  assert.equal(aiCalls,0);
  assert.match(f.notes.join(' '),/图片资源已保留/);
});

const clearSection = section('  function coreClearChat() {','  function coreCopyLast() {');
const clearFactory = new Function('openModal','document','closeModal','extrasRoleId',
  'atomicChatWriter','extrasPrimaryHistory','showToast','renderAllMessages',
  'chatMessages','window',clearSection+'\nreturn coreClearChat;');
function clearHarness(f, release) {
  let clearButton={disabled:false},cleans=0;
  const open=()=>{};
  const dom={getElementById(id) { return id==='clearYes'?clearButton:{onclick:null}; }};
  f.window.releaseDeletedChatImageReferences=async(before)=>{cleans++;if(release)release(before)};
  const util=insertFixture(f);
  const clear=clearFactory(open,dom,()=>{},util.extrasRoleId,
    util.atomicChatWriter,util.extrasPrimaryHistory,f.toast,f.render,{innerHTML:'x'},f.window);
  clear();
  return {click:()=>clearButton.onclick.call(clearButton),get cleans(){return cleans}};
}
test('clear chat fails closed after another tab appends and retains all media refs', async () => {
  const f=fixture({chat_history_role:'[{"mid":"old","assetId":"image-1"}]'});
  const original=f.window.ChatHistoryAtomic.replaceIfUnchanged.bind(f.window.ChatHistoryAtomic);
  f.window.ChatHistoryAtomic.replaceIfUnchanged=async(id,expected,next)=>{
    await f.window.ChatHistoryAtomic.appendIf('role',{mid:'new',assetId:'image-2'});
    return original(id,expected,next);
  };
  const flow=clearHarness(f);
  await flow.click();
  assert.deepEqual(f.read().map(m=>m.mid),['old','new']);
  assert.equal(flow.cleans,0);
});

test('verified clear removes only the confirmed old snapshot references', async () => {
  const f=fixture({chat_history_role:'[{"mid":"old","assetId":"image-1"}]'});
  let released;
  const flow=clearHarness(f,messages=>{released=messages});
  await flow.click();
  assert.deepEqual(f.read(),[]);
  assert.deepEqual(released,[{mid:'old',assetId:'image-1'}]);
  assert.equal(flow.cleans,1);
});

const forwardSection = section('  function coreForward() {','  // 给现有加号面板补充入口');
const forwardFactory = new Function('loadMessages','showToast','localStorage',
  'modalBody','openModal','closeModal','atomicChatWriter','extrasPrimaryHistory','uid',
  'navigator','window','escapeHtml','document',
  forwardSection+'\nreturn coreForward;');
test('forward saves only the canonical target role history, no legacy chatMessages key', async () => {
  const f=fixture({chat_history_role:'[]',chat_history_target:'[{"mid":"existing","text":"keep"}]',
    characters:JSON.stringify([{id:'target',name:'目标'}])});
  const util=insertFixture(f),button={dataset:{forward:'0'},disabled:false};
  const modalBody={querySelectorAll(){return [button];}};
  const open=()=>{},close=()=>{};
  const forward=forwardFactory(()=>[{text:'分享给你'}],f.toast,f.localStorage,modalBody,
    open,close,util.atomicChatWriter,util.extrasPrimaryHistory,f.uid,
    {clipboard:{}},f.window,x=>String(x),{getElementById:()=>null});
  forward();await button.onclick();
  assert.deepEqual(f.read('target').map(m=>m.mid).slice(0,1),['existing']);
  assert.equal(f.read('target').length,2);
  assert.equal(f.localStorage.read('chatMessages_target'),undefined);
});

test('wallet lock callback must return and await the asynchronous action', async () => {
  const script=section('  function runOutgoingPaymentExclusive(action, sending) {',
    '  function submitPayMessage() {');
  let held=false,busy=false,resolveAppend;
  const win={navigator:{locks:{request:async(_name,_opts,callback)=>{
    held=true;
    try{return await callback({});}finally{held=false;}
  }}}};
  const create=new Function('window','showToast','_outgoingPaymentBusy',script+
    '\nreturn runOutgoingPaymentExclusive;');
  const run=create(win,()=>{},false);
  const job=run(async()=>{busy=held;await new Promise(r=>{resolveAppend=r});return true},true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(busy,true);
  assert.equal(held,true);
  resolveAppend();await job;
  assert.equal(held,false);
});

test('no legacy whole-history writes remain in the four priority paths', () => {
  for(const source of [
    insertSection, imageSection,
    section('  async function submitPayMessageUnderLock() {','  // The virtual wallet'),
    clearSection, forwardSection
  ]) assert.doesNotMatch(source,/saveMessages\(|chatMessages_\\s*\\+/);
  assert.match(imageSection,/appendManyIf/);
  assert.match(clearSection,/replaceIfUnchanged/);
  assert.match(extras,/return action\(\);/);
  assert.match(extras,/await insertChatMessage/);
  new Script(extras);
});
