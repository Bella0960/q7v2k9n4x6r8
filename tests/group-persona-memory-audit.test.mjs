import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function load(source, name) {
  const sandbox = {window:{}};
  runInNewContext(source, sandbox, {filename:name});
  return sandbox.window;
}
const policy = load(read('shared/js/phone/group-chat-policy.js'), 'group-chat-policy').GroupChatPolicy;
const voice = load(read('shared/js/phone/chat-presence-policy.js'), 'chat-presence-policy').ChatPresencePolicy;
const recall = load(read('shared/js/phone/memory_recall.js'), 'memory_recall').MemoryRecall;
const detail = read('chat/chat/chat-detail.html');
const sw = read('sw.js');

const members=[
  {id:'role-a',name:'江柏',nickname:'阿江',talkativeness:0.8,replyThreshold:85},
  {id:'role-b',name:'苏行',nickname:'阿苏',talkativeness:0.2,replyThreshold:85},
  {id:'role-c',name:'陈夏',nickname:'阿夏',talkativeness:0.4,replyThreshold:85}
];

test('explicit unique @mentions select the right role, duplicate names never silently route to the first', () => {
  assert.deepEqual(Array.from(policy.extractMentionedMemberIds('@阿苏 @role-a', members)),['role-b','role-a']);
  const ambiguous=[{id:'x',name:'同名'},{id:'y',nickname:'同名'}];
  assert.deepEqual(Array.from(policy.extractMentionedMemberIds('@同名',ambiguous)),[]);
  assert.deepEqual(Array.from(policy.extractMentionedMemberIds('@y',ambiguous)),['y']);
});

test('autonomous turns may naturally end without forcing a quiet high-threshold member', () => {
  assert.equal(policy.selectSpeaker({
    members,availableMembers:members,isFollowup:true,previousSpeakerId:'role-a',
    text:'好',random:()=>0
  }),null);
  assert.ok(policy.selectSpeaker({members,availableMembers:members,text:'好',random:()=>0}));
  assert.ok(policy.selectSpeaker({
    members,availableMembers:members,isFollowup:true,previousSpeakerId:'role-a',
    allowFallback:true,text:'好',random:()=>0
  }));
  const named=policy.selectSpeaker({
    members,availableMembers:members,isFollowup:true,previousSpeakerId:'role-a',
    text:'@阿苏 你在吗',random:()=>0
  });
  assert.equal(named.member.id,'role-b');
  assert.equal(named.isMentioned,true);
});

test('group speaking pool requires each existing saved role to have an actual persona', () => {
  const start=detail.indexOf('        function getAvailableGroupMembers() {');
  const end=detail.indexOf('        function saveCurrentGroupObject()',start);
  assert.ok(start>=0&&end>start);
  const source=detail.slice(start,end);
  const roles={a:{id:'a',persona:'在深圳经营书店'},b:{id:'b',persona:''},c:null};
  const run=new Function('currentGroup','window','isGroupMemberInActiveHours','getRoleById',
    source+'\nreturn getAvailableGroupMembers();');
  const options={members:[
    {id:'a'}, {id:'b'}, {id:'c'}, {id:'d',muted:true}
  ]};
  const list=run(options,{},()=>true,id=>roles[id]||null);
  assert.deepEqual(Array.from(list.map(m=>m.id)),['a']);
});

test('a group speaker reads only OWN opted-in direct long-term memory and no other member private memory', () => {
  const start=detail.indexOf('                if (groupSettings.memorySharing && !groupGameActiveForPrompt && relationshipRole) {');
  const end=detail.indexOf('                if (groupSettings.allowRoleActions)',start);
  assert.ok(start>=0&&end>start,'group memory-sharing delivery section missing');
  const body=detail.slice(start,end);
  const fn=new Function('groupSettings','groupGameActiveForPrompt','relationshipRole',
    'buildWeightedMemoryText','capText',
    'var systemPrompt="群聊正文";\n'+body+'\nreturn systemPrompt;');
  const roleMemory=(id)=>id==='a'?'A 在深圳有老朋友':'B 的私人日记内容';
  const load=id=>fn({memorySharing:true},false,{id,memory:roleMemory(id)},
    (key)=>roleMemory(key),(txt,limit)=>txt.slice(0,limit));
  const a=load('a'),b=load('b');
  assert.match(a,/A 在深圳有老朋友/);
  assert.doesNotMatch(a,/B 的私人日记内容/);
  assert.match(b,/B 的私人日记内容/);
  assert.doesNotMatch(b,/A 在深圳有老朋友/);
  assert.equal(fn({memorySharing:false},false,{id:'a',memory:'A'},()=>{throw Error('unexpected read')},x=>x),'群聊正文');
  assert.equal(fn({memorySharing:true},true,{id:'a',memory:'A'},()=>{throw Error('game secrets exposed')},x=>x),'群聊正文');
});

test('voice history attributes legacy names only when the selected identity is unique', () => {
  const duplicates=[{id:'a',name:'阿月'}, {id:'b',nickname:'阿月'}];
  const history=[
    {role:'assistant',name:'阿月',text:'我是旧昵称的说话风格'},
    {role:'assistant',memberId:'a',name:'错误昵称',text:'我自己早上去了书店。'},
    {role:'assistant',memberId:'b',name:'阿月',text:'另外一个人的表达方式完全不同。'}
  ];
  const sampled=voice.collectVoiceSamples(history,{
    isGroupChat:true,speakerId:'a',speakerName:'阿月',
    groupMembers:duplicates,maxSamples:4,maxSampleChars:90
  });
  assert.deepEqual(Array.from(sampled),['我自己早上去了书店。']);
  const profile=voice.buildVoiceHabitProfile(history,{
    isGroupChat:true,speakerId:'a',speakerName:'阿月',
    groupMembers:duplicates,maxMessages:80
  });
  // May have insufficient samples for a profile, but cannot learn the other voice.
  assert.ok(!profile || profile.sampleCount<=1);
});

test('long-term group history recall labels each public speaker and rejects private or failed messages', () => {
  const history=[
    {role:'assistant',memberId:'role-b',name:'过期昵称',
      text:'昨天我带大家去老街书店，门口摆满了旧书。',time:1700000000000},
    {role:'assistant',memberId:'role-a',text:'上周我也去过老街书店，但是没买东西。',time:1700000001000},
    {role:'assistant',memberId:'role-c',type:'group_private',text:'私密约定老街书店',time:1700000002000},
    {role:'assistant',memberId:'role-c',sendFailed:true,text:'失败的老街书店内容',time:1700000003000},
    {role:'assistant',type:'group_welcome',text:'欢迎来到老街书店群聊',time:1700000004000},
    {role:'assistant',memberId:'missing',text:'未知成员曾经去老街书店买过东西。',time:1700000005000}
  ];
  const before=JSON.stringify(history);
  const text=recall.buildHistoricalRecallText(history,'老街书店',{
    groupPublicOnly:true,groupMembers:members,maxScan:2500,maxItems:5,maxChars:1200
  });
  assert.match(text,/群聊公开历史/);
  assert.match(text,/群成员 阿苏/);
  assert.match(text,/群成员 阿江/);
  assert.match(text,/身份未核实/);
  assert.doesNotMatch(text,/私密约定|失败的|欢迎来到/);
  assert.doesNotMatch(text,/本角色历史聊天摘录/);
  assert.equal(JSON.stringify(history),before);
});

test('single-chat historical recall retains original formatting and purpose', () => {
  const history=[{role:'assistant',text:'我上次去老街书店买了一本漫画。',time:1700000001000}];
  const output=recall.buildHistoricalRecallText(history,'老街书店',{maxScan:100,maxChars:800});
  assert.match(output,/本角色历史聊天摘录/);
  assert.match(output,/\[.*角色\]/);
});

test('group voice and recall changes reach real app and PWA without changing the visual layout', () => {
  assert.match(detail,/CHAT-GROUP-MEMORY-BOUNDARY/);
  assert.match(detail,/allowFallback: isManualContinue/);
  assert.match(detail,/roleMemory.*isGroupChat/);
  assert.match(detail,/groupMembers: currentGroup && Array\.isArray\(currentGroup\.members\)/);
  assert.match(detail,/recallOptions\.groupMembers/);
  assert.match(detail,/chat-presence-policy\.js\?v=20261118groupvoice1/);
  assert.match(detail,/group-chat-policy\.js\?v=20261118groupvoice1/);
  assert.match(detail,/memory_recall\.js\?v=20261118groupmemory1/);
  assert.match(sw,/phone-app-pwa-v252/);
  for(const key of ['chat-presence-policy.js?v=20261118groupvoice1',
    'group-chat-policy.js?v=20261118groupvoice1','memory_recall.js?v=20261118groupmemory1']) {
    assert.ok(sw.includes(key));
  }
});
