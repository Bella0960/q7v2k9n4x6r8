import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const notifier = readFileSync(new URL('../shared/js/chat-notifier.js', import.meta.url), 'utf8');
const policySource = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');
function section(begin,end) {
  const a=notifier.indexOf(begin),b=notifier.indexOf(end,a);
  assert.ok(a>=0&&b>a,'missing source section '+begin);
  return notifier.slice(a,b);
}
const proactiveHistory=section('    function historyForProactivePrompt(history) {',
  '    // Autonomous responses do not run through chat-detail');
const autonomyContext=section('    // Autonomous responses do not run through chat-detail',
  '    function cleanProactiveMessage(value) {');
const followUpSource=section('    function followUpMessages(history) {',
  '    function followUpHistoryContext(history, isGroup) {');
const factory=new Function('global','localStorage','readCharacters',
  proactiveHistory+followUpSource+autonomyContext+
  '\nreturn {buildAutonomousPersonaContext,followUpMessages};');
const roleA={id:'a',name:'林策',persona:'安静、喜欢天文',memory:'一对一聊过的私人心事'};
const roleB={id:'b',name:'周遥',persona:'直率、足球爱好者',memory:'B的私人日记'};
const worldbooks=[
  {id:'global',scope:'global',title:'共同背景',content:'生活在未来城'},
  {id:'a-local',scope:'local',title:'A私有',content:'望远镜收藏'},
  {id:'b-local',scope:'local',title:'B私有',content:'隐藏身份'}
];
function setup(seed={},roles=[roleA,roleB]) {
  const data=Object.assign({phone_worldbooks:JSON.stringify(worldbooks)},seed);
  const localStorage={
    getItem(k){return Object.prototype.hasOwnProperty.call(data,k)?data[k]:null;},
    setItem(k,v){data[k]=String(v);}
  };
  const global={};
  runInNewContext(policySource,{window:global});
  const instance=factory(global,localStorage,()=>roles);
  return {...instance,data,global,localStorage};
}
const sample=[
  {role:'user',text:'最近在干什么',time:100},
  {role:'assistant',text:'刚在楼顶看天',time:101},
  {role:'assistant',type:'group_private',text:'私聊秘密',time:102},
  {role:'assistant',visibility:'role_only',text:'仅供某个角色知道',time:103}
];
test('private automatic contact includes selected current role and global lore',()=>{
  const x=setup({'chat_rp_protocol_':'姓名={{char}}；档案={{persona}}；场景={{worldbook}}'});
  const prompt=x.buildAutonomousPersonaContext(roleA,'private','a',sample);
  assert.match(prompt,/林策/);
  assert.match(prompt,/安静、喜欢天文/);
  assert.match(prompt,/共同背景/);
  assert.doesNotMatch(prompt,/周遥|A私有|B私有|隐藏身份/);
  assert.match(prompt,/JSON 输出格式/);
});
test('two roles never borrow each other private worldbook mounts',()=>{
  const x=setup({chat_worldbooks_a:JSON.stringify(['a-local']),
    chat_worldbooks_b:JSON.stringify(['b-local'])});
  const a=x.buildAutonomousPersonaContext(roleA,'private','a',sample);
  const b=x.buildAutonomousPersonaContext(roleB,'private','b',sample);
  assert.match(a,/A私有/);
  assert.doesNotMatch(a,/B私有/);
  assert.match(b,/B私有/);
  assert.doesNotMatch(b,/A私有/);
});
test('group follow-up excludes one-to-one memory and unmounted private lore',()=>{
  const x=setup({chat_rp_protocol_:'已知姓名：{{char}}。长期记忆：{{memory}}'});
  const group=x.buildAutonomousPersonaContext(roleA,'group','g1',sample);
  assert.match(group,/林策/);
  assert.doesNotMatch(group,/一对一聊过的私人心事|B的私人日记|A私有|B私有/);
  assert.doesNotMatch(group,/私聊秘密|仅供某个角色知道/);
});
test('an explicitly mounted group book is isolated to that group',()=>{
  const x=setup({chat_worldbooks_g1:JSON.stringify(['a-local'])});
  assert.match(x.buildAutonomousPersonaContext(roleA,'group','g1',sample),/A私有/);
  assert.doesNotMatch(x.buildAutonomousPersonaContext(roleA,'group','g2',sample),/A私有/);
});
test('saved RP overrides shared built-in default, but default activates when absent',()=>{
  const x=setup({},[roleA]);
  x.global.MAOMAO_RP_DEFAULT_PROTOCOL='默认规则：{{char}}保持自然';
  const d=x.buildAutonomousPersonaContext(roleA,'private','a',sample);
  assert.match(d,/默认规则：林策保持自然/);
  x.data.chat_rp_protocol_='保存规则：{{char}}喜欢清静';
  const s=x.buildAutonomousPersonaContext(roleA,'private','a',sample);
  assert.match(s,/保存规则：林策喜欢清静/);
  assert.doesNotMatch(s,/默认规则：/);
});
test('corrupt, oversized or missing worldbook policy stops before paid generation',()=>{
  const x=setup({chat_worldbooks_a:'{broken'});
  assert.equal(x.buildAutonomousPersonaContext(roleA,'private','a',sample),null);
  x.data.chat_worldbooks_a='[]';
  x.data.chat_rp_protocol_='X'.repeat(24001);
  assert.equal(x.buildAutonomousPersonaContext(roleA,'private','a',sample),null);
  x.data.chat_rp_protocol_='';
  x.data.phone_worldbooks='{bad';
  assert.equal(x.buildAutonomousPersonaContext(roleA,'private','a',sample),null);
  delete x.global.ChatContextPolicy;
  assert.equal(x.buildAutonomousPersonaContext(roleA,'private','a',sample),null);
});
test('group-private and role-only history are excluded at the source',()=>{
  const x=setup();
  assert.deepEqual(x.followUpMessages(sample).map(m=>m.text),
    ['最近在干什么','刚在楼顶看天']);
});
test('both autonomous model calls require a verified RP/lore context',()=>{
  assert.match(notifier,/buildAutonomousPersonaContext\(\s*candidate\.contact, 'private'/);
  assert.match(notifier,/buildAutonomousPersonaContext\(\s*role, scope, contact\.id/);
  const proactive=section('            var roleContext = buildAutonomousPersonaContext(',
    '            var messages = [{ role:');
  assert.match(proactive,/if \(!roleContext\) return;/);
  const follow=section('        var roleContext = buildAutonomousPersonaContext(',
    '        var messages = [{ role:');
  assert.match(follow,/if \(!roleContext\) return;/);
  const deps=section('    function ensureProactiveDependencies() {',
    '    function ensureFollowUpDependencies() {');
  assert.match(deps,/chat-context-policy\.js/);
  assert.match(notifier,/item\.visibility === 'role_only'/);
});
