import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../worldbook/characters/js/character-ai-json.js',import.meta.url),'utf8');
function parse(response,kind) { const window={};vm.runInNewContext(src,{window});return window.CharacterAiJSON.fromCompletion(response,kind); }
test('parse fenced JSON and explanatory text without another model call',()=>{
  const raw='这里是整理结果：\n```json\n{"people":[{"name":"小林","relation":"同事",}]}\n```\n可供参考。';
  const out=parse({ok:false,raw},'relationships');
  assert.equal(out.ok,true);assert.equal(out.data.people[0].name,'小林');
});
test('recover balanced object despite stray brackets in prose',()=>{
  const raw='说明 [草稿]\n{"event":{"title":"去图书馆","people":"朋友","detail":"读书"}}\n完成';
  const out=parse({ok:false,raw},'life');
  assert.equal(out.ok,true);assert.equal(out.data.title,'去图书馆');
});
test('reject non JSON, wrong schema and prototype-like suggestions',()=>{
  for(const raw of ['你好，写好啦','```json\n{"people":[{}]}\n```','{"people":"hello"}']) assert.equal(parse({ok:false,raw},'relationships').ok,false);
});
test('do not break commas inside strings or re-request',()=>{
  const out=parse({ok:false,raw:'{"title":"活动,]名称","detail":"不错",}'},'life');
  assert.equal(out.ok,true);assert.equal(out.data.title,'活动,]名称');
});
test('retain direct completeJSON success and accept model-wrapped event',()=>{
  assert.equal(parse({ok:true,data:{title:'活动'}},'life').data.title,'活动');
  assert.equal(parse({ok:true,data:{events:[{title:'活动2'}]}},'life').data.title,'活动2');
});
test('AI parser is loaded before generator and PWA precache addresses match',()=>{
 const html=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
 const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
 assert.ok(html.indexOf('character-ai-json.js?v=20261122-json-v2')<html.indexOf('character-ai-drafts.js?v=20261122-json-v2'));
 assert.match(sw,/phone-app-pwa-v288/);
 for(const f of ['character-ai-json.js?v=20261122-json-v2','character-ai-drafts.js?v=20261122-json-v2']) assert.ok(sw.includes(f));
});
