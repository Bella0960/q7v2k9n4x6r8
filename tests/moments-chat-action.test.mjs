import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = {};
vm.runInNewContext(fs.readFileSync(new URL('../shared/js/phone/moments-chat-action.js', import.meta.url), 'utf8'), { window: root });
const action = root.MomentsChatAction;
test('only explicit posting requests are accepted', () => {
  for (const text of ['你发一个朋友圈吧','发一条动态','请你自动发个朋友圈','发个朋友圈给我看看','你发朋友圈可以吗','今天看完书，你发一条关于阅读的朋友圈吧','把今天的心情写成一条朋友圈']) assert.equal(action.requestsPost(text), true, text);
  for (const text of ['怎么发朋友圈','不要发朋友圈','你发朋友圈了吗','发朋友圈不太好','我想发朋友圈','帮我发我自己的朋友圈','他说发朋友圈']) assert.equal(action.requestsPost(text), false, text);
});
test('strict action marker', () => {
  assert.equal(action.parsePost('[朋友圈动态:看书]'), '看书');
  assert.equal(action.parsePost('[朋友圈动态:看书]多余内容'), '');
});
test('same-name roles and replay do not misattribute or duplicate posts', () => {
  const values = {};
  const storage = {getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v};
  const getCharacters = () => [{id:'A',name:'同名'},{id:'B',name:'同名'}];
  const opts = {roleId:'B',requestId:'u1',content:'今天看书',storage,getCharacters};
  action.publish(opts);
  action.publish(opts);
  const posts = JSON.parse(values.moments);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorId, 'B');
  assert.throws(()=>action.publish({...opts,roleId:'C'}));
  assert.throws(()=>action.publish({...opts,storage:{getItem:()=>null,setItem:()=>{throw new Error('quota')}}}));
  assert.throws(()=>action.publish({...opts,storage:{getItem:()=>null,setItem:()=>{}}}));
});

test('auto posting is opt-in, role-isolated, and subject to a rolling cooldown', () => {
  const values = {};
  const storage = {getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v};
  const now = Date.now();
  assert.equal(action.autoEligible(storage,'A',now),false);
  values.chat_auto_moment_A = 'true';
  assert.equal(action.autoEligible(storage,'A',now),true);
  assert.equal(action.autoEligible(storage,'B',now),false);
  values.moments=JSON.stringify([{authorId:'B',byAI:true,time:now}]);
  assert.equal(action.autoEligible(storage,'A',now),true);
  values.moments=JSON.stringify([{authorId:'A',byAI:true,time:now}]);
  assert.equal(action.autoEligible(storage,'A',now),false);
  assert.equal(action.autoEligible(storage,'A',now+86400001),true);
  values.chat_auto_moment_A='false';
  assert.equal(action.autoEligible(storage,'A',now+86400001),false);
});
test('auto markers remain hidden, incomplete or repeated markers cannot post', () => {
  const result=action.extractAuto('正常回复\n[自主朋友圈:今天看书]');
  assert.equal(result.text,'正常回复');
  assert.equal(result.content,'今天看书');
  assert.equal(action.extractAuto('回复[自主朋友圈:未完成').content,'');
  assert.equal(action.extractAuto('回复[自主朋友圈:A][自主朋友圈:B]').content,'');
  assert.equal(action.stripAuto('回复[自主朋友'),'回复');
  assert.equal(action.parseNoPost('[不发布朋友圈:只是问问]'),'只是问问');
});
test('menu and chat use one author-validated publisher with separate IDs', () => {
  const values = {};
  const storage = {getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v};
  const getCharacters=()=>[{id:'A',name:'同名'},{id:'B',name:'同名'}];
  const opts={roleId:'B',requestId:'r1',content:'阅读',storage,getCharacters};
  for(const source of ['menu','chat']) { action.publish({...opts,source}); action.publish({...opts,source}); }
  const posts=JSON.parse(values.moments);
  assert.equal(posts.length,2);
  assert.ok(posts.every(x=>x.authorId==='B'));
});

test('write-time opt-in and context validation stop stale actions', () => {
  const values = {chat_auto_moment_A:'true'};
  const storage = {getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=v};
  const getCharacters=()=>[{id:'A',name:'A'}];
  const opts={roleId:'A',requestId:'a1',content:'阅读',source:'auto',storage,getCharacters};
  action.publish(opts);
  action.publish(opts);
  assert.throws(()=>action.publish({...opts,requestId:'a2'}));
  values.chat_auto_moment_A='false';
  assert.throws(()=>action.publish({...opts,requestId:'a3'}));
  assert.throws(()=>action.publish({...opts,source:'chat',canPublish:()=>false}));
  assert.equal(JSON.parse(values.moments).length,1);
});
test('no Web Locks cannot silently run automatic publication', async () => {
  let failed=false;
  try { await action.publishLocked({source:'auto'}); } catch { failed=true; }
  assert.ok(failed);
});
test('explicit and partial action markers are stripped from unrelated replies', () => {
  assert.equal(action.stripAuto('回复[朋友圈动态:正文]'),'回复');
  assert.equal(action.stripAuto('回复[朋友圈动'),'回复');
});

test('Moments completion times out while reading a stalled response and does not retry', async () => {
  let calls = 0;
  const window = {
    PhoneStorage: { getApiConfig: () => ({ apiKey: 'mock-only' }), pushApiLog() {} }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../shared/js/phone/phone_api.js', import.meta.url), 'utf8'), {
    window, AbortController, DOMException, setTimeout, clearTimeout,
    async fetch(_url, { signal }) {
      calls++;
      return {
        ok: true,
        json: () => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
      };
    }
  });
  await assert.rejects(window.PhoneAPI.complete({ user: '生成一条动态', timeoutMs: 20 }), /请求超时/);
  assert.equal(calls, 1);
});
