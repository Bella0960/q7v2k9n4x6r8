import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root = {};
vm.runInNewContext(fs.readFileSync(new URL('../shared/js/phone/moments-chat-action.js', import.meta.url), 'utf8'), { window: root });
const action = root.MomentsChatAction;
test('only explicit posting requests are accepted', () => {
  for (const text of ['你发一个朋友圈吧','发一条动态','请你自动发个朋友圈','发个朋友圈给我看看','你发朋友圈可以吗']) assert.equal(action.requestsPost(text), true, text);
  for (const text of ['怎么发朋友圈','不要发朋友圈','你发朋友圈了吗','发朋友圈不太好']) assert.equal(action.requestsPost(text), false, text);
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
