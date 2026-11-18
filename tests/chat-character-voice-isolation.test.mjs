import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const presenceJS = readFileSync(new URL('../shared/js/phone/chat-presence-policy.js', import.meta.url), 'utf8');
const roleJS = readFileSync(new URL('../shared/js/phone/chat-role-context.js', import.meta.url), 'utf8');
const scope = { window: {} };
runInNewContext(presenceJS, scope);
runInNewContext(roleJS, scope);
const voice = scope.window.ChatPresencePolicy;
const role = scope.window.MAOMAOChatRoleContext;
const group = [
  { id: 'member-a', name: '方屿', persona: '在深圳拍胶片，寡言、爱说短句。', tone: '几乎不使用表情。' },
  { id: 'member-b', name: '陆知', persona: '热情的烘焙师，喜欢长消息。', tone: '爱开玩笑。' }
];
const history = [
  {role:'received',type:'text',memberId:'member-a',text:'捕捉到一个元气满满的小伙伴！👋 随时在线待命。'},
  {role:'received',type:'text',memberId:'member-a',text:'有什么好玩的事想分享，还是有什么问题想聊？'},
  {role:'received',type:'text',memberId:'member-b',text:'我今天新烤了一盘面包，香得很。'},
  {role:'received',type:'text',memberId:'member-a',text:'我还在冲底片，灯不能开。'},
  {role:'received',type:'text',memberId:'member-a',text:'这地方我以前来过，路口有家照相馆。'},
  {role:'received',type:'text',memberId:'member-a',text:'晚点说吧，我得先把照片晾起来。'},
  {role:'received',type:'text',memberId:'member-a',text:'雨比刚才大了，我把相机收好了。'}
];
const options = {
  isGroupChat: true,
  speakerId: 'member-a',
  speakerName: '方屿',
  groupMembers: group,
  maxMessages: 80,
  maxSamples: 4
};

test('old bot greetings do not become role voice samples or long-term style statistics', () => {
  const samples = Array.from(voice.collectVoiceSamples(history, options));
  assert.equal(samples.length,4);
  assert.ok(samples.every(s => !/元气满满|随时在线待命|问题想聊|面包/.test(s)));
  const profile = voice.buildVoiceHabitProfile(history, options, null);
  assert.equal(profile.sampleCount,4);
  assert.equal(voice.buildVoiceHabitProfile(history.slice(0,2),options,null),null);
  assert.equal(voice.isGenericAssistantBoilerplate('随时在线待命！'),true);
  assert.equal(voice.isGenericAssistantBoilerplate('我还在冲底片，灯不能开。'),false);
  assert.equal(voice.isGenericAssistantBoilerplate('我是个数字生命，但我还在学画画。'),false);
});

test('voice is independently learned per group speaker, without copying another member', () => {
  const a = Array.from(voice.collectVoiceSamples(history,options));
  const b = Array.from(voice.collectVoiceSamples(history,{
    ...options,speakerId:'member-b',speakerName:'陆知'
  }));
  assert.equal(a.length,4);
  assert.equal(b.length,1);
  assert.match(b[0],/面包/);
  assert.ok(a.every(x=>!x.includes('面包')));
});

test('group public roster excludes every private full persona while preserving IDs and moderation', () => {
  const first = html.indexOf('                const personaLines = members.map(function (m, i) {');
  const end = html.indexOf('                if (availableMembers.length) {',first);
  assert.ok(first > 0 && end > first, 'use the live roster fragment');
  const fragment = html.slice(first,end);
  const build = new Function('members','currentGroup','window','groupMemberDisplayName','isGroupMemberInActiveHours',
    'let rolePersona;\n'+fragment+'\nreturn rolePersona;');
  const roster = build(
    [{id:'member-a',name:'方屿'},{id:'member-b',name:'陆知',title:'管理员'}],
    {name:'咖啡馆群',ownerId:'__user'},
    {GroupGovernance:null},
    m=>m.name,
    ()=>true
  );
  assert.match(roster,/方屿/);
  assert.match(roster,/陆知/);
  assert.match(roster,/管理员/);
  assert.doesNotMatch(roster,/在深圳拍胶片|热情的烘焙师/);
  assert.doesNotMatch(fragment,/getRoleById|\.persona|\.prompt/);
  assert.match(html,/turnSpeakerPersona \|\| '该成员尚未填写具体人设/);
  assert.match(html,/validateFinalApiMessages\(/);
});

test('final payload checks the active speaker, its exact saved persona and protocol', () => {
  const protocol='用户保存的完整协议';
  const speaker=group[0];
  const worldbook='用户保存的世界书内容';
  const good = {
    role:speaker,speakerId:speaker.id,persona:speaker.persona,tone:speaker.tone,
    protocol,expandedProtocol:protocol,worldbook,worldbookPolicyReady:true,
    messages:[{role:'system',content:[
      speaker.persona,speaker.tone,protocol,worldbook].join('\n')}]
  };
  assert.equal(role.validateFinalApiMessages(good).ok,true);
  assert.equal(role.validateFinalApiMessages({...good,role:group[1]}).ok,false);
  assert.equal(role.validateFinalApiMessages({...good,messages:[
    {role:'system',content:[group[1].persona,speaker.tone,protocol,worldbook].join('\n')}
  ]}).ok,false);
});

test('a single concise group correction replaces duplicated welcome rules', () => {
  assert.equal(html.split('【群聊口吻纠偏】').length-1,1);
  assert.doesNotMatch(html,/【群聊自然接话】/);
  assert.match(html,/随时在线待命/);
  assert.match(html,/chat-presence-policy\.js\?v=20261118voicepurity1/);
  assert.match(html,/roleModelHistory = window\.MAOMAOChatRoleContext\.getGroupModelHistory/);
});
