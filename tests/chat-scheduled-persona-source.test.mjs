import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext, Script} from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const notifier = read('shared/js/chat-notifier.js');
const presence = read('shared/js/phone/chat-presence-policy.js');
const followup = read('shared/js/phone/chat-followup-policy.js');
const scheduleSource = read('shared/js/phone/chat-scheduled-role-context.js');
const roles = [
  {id:'a',name:'许川', persona:'深圳一家修书铺的主人。'.repeat(500),tone:'惜字如金',
   memory:'喜欢收集旧书签',worldBookIds:['a-local']},
  {id:'b',name:'秦葵',persona:'经营一间花房',tone:'直接',worldBookIds:['b-local']}
];
const books = [
  {id:'global',scope:'global',title:'公共世界',entries:[
    {name:'公共事实',injectMode:'always',content:'城里有一条旧街'}
  ]},
  {id:'a-local',scope:'local',title:'许川私人背景',content:'私人收藏室在二楼'},
  {id:'b-local',scope:'local',title:'秦葵私人背景',content:'花房主人自己的手记'},
  {id:'group-local',scope:'local',title:'群聊公共背景',content:'群聊聚会约在剧院'}
];

function harness(values={}) {
  const map = new Map(Object.entries({
    ai_custom_characters:JSON.stringify(roles),
    phone_worldbooks:JSON.stringify(books),
    chat_rp_protocol_:'按人物原有的语气表达，不要以客服身份说话。\\n{{char}}\\n{{persona}}\\n{{worldbook}}\\n{{memory}}',
    chat_worldbooks_a:JSON.stringify(['a-local']),
    chat_worldbooks_b:JSON.stringify(['b-local']),
    ...values
  }));
  const store = {
    getItem:key => map.has(key) ? map.get(key) : null,
    setItem: (key,val)=>map.set(key,String(val)),
    removeItem:key=>map.delete(key)
  };
  const win={localStorage:store};
  const sandbox={window:win,localStorage:store};
  for (const name of [
    'shared/js/phone/rp-default-protocol.js',
    'shared/js/phone/chat-context-policy.js',
    'shared/js/phone/role-worldbook-bindings.js',
    'shared/js/phone/chat-role-context.js',
    'shared/js/phone/chat-scheduled-role-context.js'
  ]) runInNewContext(read(name),sandbox,{filename:name});
  return {window:win,store, snapshot:()=>JSON.stringify([...map.entries()])};
}

test('scheduled proactive/follow-up sees complete current persona, global RP, activated lore and confirmed memory',()=>{
  const h=harness();
  const before=h.snapshot();
  const result=h.window.ChatScheduledRoleContext.build({
    role:roles[0],storage:h.store,history:[
      {role:'assistant',text:'我是一个人工智能模型'},
      {role:'user',text:'今天忙吗？'}
    ],currentText:'今天忙吗？',userName:'用户甲',
    memories:[{status:'confirmed',content:'修书铺周一闭店'}]
  });
  assert.equal(result.ok,true,result.code);
  assert.ok(result.system.includes(roles[0].persona),'full untruncated persona');
  assert.match(result.system,/惜字如金/);
  assert.match(result.system,/按人物原有的语气表达/);
  assert.match(result.system,/公共事实/);
  assert.match(result.system,/私人收藏室在二楼/);
  assert.doesNotMatch(result.system,/花房主人自己的手记/);
  assert.match(result.system,/修书铺周一闭店/);
  assert.doesNotMatch(JSON.stringify(result.history),/我是一个人工智能模型/);
  assert.equal(h.snapshot(),before,'read-only does not modify any source');
});

test('scheduled group speaker gets own and group books, never another member private lore',()=>{
  const h=harness({chat_worldbooks_g1:JSON.stringify(['group-local'])});
  const before=h.snapshot();
  const result=h.window.ChatScheduledRoleContext.build({
    role:roles[0],storage:h.store,groupId:'g1',
    groupMembers:[{id:'a',name:'许川'},{id:'b',name:'秦葵'}],
    roleLoader:id=>roles.find(r=>r.id===id),
    history:[{role:'user',text:'约在剧院见面吧'}],
    currentText:'约在剧院见面吧'
  });
  assert.equal(result.ok,true,result.code);
  assert.match(result.system,/私人收藏室在二楼/);
  assert.match(result.system,/群聊聚会约在剧院/);
  assert.doesNotMatch(result.system,/花房主人自己的手记/);
  assert.equal(h.snapshot(),before);
});

test('corrupt worldbook source fails closed without a generic response or writes',()=>{
  const h=harness({chat_worldbooks_a:'{broken'});
  const before=h.snapshot();
  const result=h.window.ChatScheduledRoleContext.build({
    role:roles[0],storage:h.store,currentText:'今天做什么'
  });
  assert.equal(result.ok,false);
  assert.equal(h.snapshot(),before);
});

test('notifier uses one scheduled source for proactive and follow-up, validating outputs before save',()=>{
  assert.doesNotThrow(()=>new Script(scheduleSource));
  assert.match(notifier,/function ensureScheduledSources\(/);
  assert.match(notifier,/function buildScheduledSource\(/);
  assert.match(notifier,/ChatScheduledRoleContext\.build\(/);
  assert.match(notifier,/scheduled\.system \+ '\\n\\n' \+/);
  assert.match(notifier,/scheduledReplyMatchesIdentity\(scheduled\.role, content, false/);
  assert.match(notifier,/scheduledReplyMatchesIdentity\(scheduled\.role, content, scope === 'group'/);
  assert.doesNotMatch(presence,/persona[^\n]*\.slice\(0, 5000\)/);
  assert.doesNotMatch(followup,/persona[^\n]*\.slice\(0, 1200\)/);
});
