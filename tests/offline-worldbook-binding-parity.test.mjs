import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const roleSource = read('shared/js/phone/chat-role-context.js');
const bridgeSource = read('shared/js/phone/role-worldbook-bindings.js');
const contextSource = read('shared/js/phone/chat-context-policy.js');
const datePage = read('chat/date/date.html');
const journeyPage = read('chat/date/journey.html');
const sw = read('sw.js');

const books = [
  {id:'public', title:'公开街巷', scope:'global', content:'这是公开街巷背景'},
  {id:'local-a', title:'角色A私有', scope:'local', entries:[
    {name:'私密',injectMode:'always',content:'只有角色A知道的旧书店'},
    {name:'触发',injectMode:'keyword',keywords:['雨天'],content:'角色A雨天会去老街'}]},
  {id:'local-b', title:'角色B私有', scope:'local',content:'角色B的独有秘密'}
];
const roles = [
  {id:'role-a',name:'阿甲',persona:'阿甲是有自己生活的普通人',worldBookIds:['local-a']},
  {id:'role-b',name:'阿乙',persona:'阿乙有自己的生活',worldBookIds:['local-b']}
];
const initial = {
  ai_custom_characters:JSON.stringify(roles),
  phone_worldbooks:JSON.stringify(books),
  chat_rp_protocol_:'用户自定义人设协议：{{char}} / {{persona}} / {{worldbook}}'
};
function make(seed={}, binder=true) {
  const original = {...initial,...seed};
  const data = new Map(Object.entries(original));
  const localStorage = {
    getItem:key=>data.has(key)?data.get(key):null,
    setItem:(key,value)=>data.set(key,String(value)),
    removeItem:key=>data.delete(key)
  };
  const window = {localStorage};
  const sandbox = {window,localStorage};
  runInNewContext(contextSource,sandbox);
  if(binder) runInNewContext(bridgeSource,sandbox);
  runInNewContext(roleSource,sandbox);
  const resolve = (extras={})=>window.MAOMAOChatRoleContext.buildSavedSourceEnvelope({
    role:roles[0],storage:localStorage,conversationId:'role-a',
    contextPolicy:window.ChatContextPolicy,defaultProtocol:'',
    currentText:'今天怎么样',userName:'用户',...extras
  });
  return {resolve,data,bridge:window.RoleWorldbookBindings,window};
}

test('offline chat uses the exact checked selection shared with the character editor and online chat',()=>{
  const h=make({'chat_worldbooks_role-a':JSON.stringify(['local-a'])});
  const selected=h.bridge.read('role-a');
  assert.equal(selected.ok,true);
  assert.deepEqual(Array.from(selected.ids),['local-a']);
  const result=h.resolve();
  assert.equal(result.ok,true);
  assert.equal(result.activeBookCount,1);
  assert.match(result.worldbook,/只有角色A知道的旧书店/);
  assert.match(result.expandedProtocol,/只有角色A知道的旧书店/);
  assert.doesNotMatch(result.worldbook,/这是公开街巷背景|角色B的独有秘密/);
});

test('explicitly empty mount cannot resurrect stale role worldBookIds or legacy global defaults',()=>{
  const h=make({'chat_worldbooks_role-a':'[]'});
  assert.deepEqual(Array.from(h.bridge.read('role-a').ids),[]);
  const result=h.resolve();
  assert.equal(result.ok,true);
  assert.equal(result.worldbook,'');
  assert.equal(result.activeBookCount,0);
  assert.doesNotMatch(result.expandedProtocol,/旧书店|公开街巷|独有秘密/);
});

test('legacy object with enabled:false is a real opt-out in offline prompts too',()=>{
  const h=make({'chat_worldbooks_role-a':JSON.stringify({enabled:false,worldbookIds:['local-a']})});
  assert.deepEqual(Array.from(h.bridge.read('role-a').ids),[]);
  const result=h.resolve();
  assert.equal(result.ok,true);
  assert.equal(result.worldbook,'');
});

test('without saved global mount, only the role explicitly selected book is available',()=>{
  const h=make();
  const result=h.resolve();
  assert.equal(result.ok,true);
  assert.equal(result.activeBookCount,1);
  assert.doesNotMatch(result.worldbook,/公开街巷背景/);
  assert.match(result.worldbook,/只有角色A知道的旧书店/);
  assert.doesNotMatch(result.worldbook,/角色B的独有秘密/);
});

test('damaged legacy mount blocks both offline routes before any request, without writing data',()=>{
  const h=make({'chat_worldbooks_role-a':'{bad'});
  const before=JSON.stringify(Array.from(h.data.entries()));
  assert.equal(h.resolve().ok,false);
  assert.equal(h.resolve().code,'worldbook-storage');
  assert.equal(JSON.stringify(Array.from(h.data.entries())),before);
});

test('missing shared binder fails closed rather than silently using the obsolete union reader',()=>{
  const h=make({},false);
  assert.deepEqual({ok:h.resolve().ok,code:h.resolve().code},
    {ok:false,code:'worldbook-binding-policy'});
});

test('entry keyword activation still uses latest user input without leaking untriggered entries',()=>{
  const h=make({'chat_worldbooks_role-a':JSON.stringify(['local-a'])});
  assert.doesNotMatch(h.resolve().worldbook,/角色A雨天会去老街/);
  const rainy=h.resolve({currentText:'雨天'});
  assert.equal(rainy.ok,true);
  assert.match(rainy.worldbook,/角色A雨天会去老街/);
});

test('both existing offline pages load the shared binding before the updated resolver; PWA caches the same assets',()=>{
  const binder='role-worldbook-bindings.js?v=20261119-qa1';
  const role='chat-role-context.js?v=20261119source3';
  for(const page of [datePage,journeyPage]){
    assert.ok(page.includes(binder));
    assert.ok(page.includes(role));
    assert.ok(page.indexOf(binder)<page.indexOf(role));
    assert.match(page,/buildSavedSourceEnvelope\(/);
    assert.match(page,/validateFinalApiMessages\(/);
  }
  const cacheVersion = Number(sw.match(/phone-app-pwa-v(\d+)/)?.[1] || 0);
  assert.ok(cacheVersion >= 265, 'PWA cache version must not regress below validated v265');
  assert.ok(sw.includes(binder));
  assert.ok(sw.includes(role));
});
