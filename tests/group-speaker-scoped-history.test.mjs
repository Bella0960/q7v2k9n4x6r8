import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const policySource = readFileSync(new URL('../shared/js/phone/chat-context-policy.js', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const sandbox = {};
runInNewContext(policySource, sandbox);
const map = (history, speakerId, members, speakerName = '') =>
  JSON.parse(JSON.stringify(sandbox.ChatContextPolicy.mapHistoryToApiMessages(
    history, String, { isGroupChat:true, speakerId, speakerName, groupMembers:members }
  )));

const members=[
  {id:'a',name:'林予',nickname:'小林'},
  {id:'b',name:'周池',nickname:'阿池'}
];

test('selected speaker owns only their own assistant history; other speakers remain attributed participants', () => {
  const history = [
    {role:'user',text:'你们在忙吗？'},
    {role:'assistant',memberId:'a',name:'旧昵称',text:'我在画稿。'},
    {role:'assistant',memberId:'b',name:'阿池',text:'我刚到店。'},
    {role:'assistant',memberId:'a',name:'小林',text:'等我一会儿。'}
  ];
  const before=JSON.stringify(history);
  const forA=map(history,'a',members,'小林');
  assert.deepEqual(forA.map(x=>x.role),['user','assistant','user','assistant','user']);
  assert.match(forA[1].content,/【群成员 小林】\n我在画稿/);
  assert.match(forA[2].content,/【群成员 阿池】\n我刚到店/);
  const forB=map(history,'b',members,'阿池');
  assert.deepEqual(forB.map(x=>x.role),['user','user','assistant','user']);
  assert.equal(JSON.stringify(history),before);
});

test('multi-bubble turns merge only for the selected speaker, not other group members', () => {
  const history=[
    {role:'assistant',memberId:'a',turnId:'t1',text:'我刚到'},
    {role:'assistant',memberId:'a',turnId:'t1',bubbleIndex:1,text:'你们在哪儿'},
    {role:'assistant',memberId:'b',turnId:'t2',text:'在门口'},
    {role:'assistant',memberId:'b',turnId:'t2',bubbleIndex:1,text:'进来吧'},
    {role:'user',text:'好'}
  ];
  const forA=map(history,'a',members,'小林');
  assert.deepEqual(forA.map(x=>x.role),['assistant','user','user','user']);
  assert.equal(forA[0].content, '【群成员 小林】\n我刚到\n\n你们在哪儿');
  assert.deepEqual(forA.slice(1,3).map(x=>x.content),[
    '【群成员 阿池】\n在门口','【群成员 阿池】\n进来吧'
  ]);
  const forB=map(history,'b',members,'阿池');
  assert.deepEqual(forB.map(x=>x.role),['user','user','assistant','user']);
  assert.equal(forB[2].content,'【群成员 阿池】\n在门口\n\n进来吧');
});

test('older messages match a unique saved alias only; duplicate names are not trusted', () => {
  const old=[{role:'received',name:'小林',text:'旧消息'}];
  assert.equal(map(old,'a',members,'小林')[0].role,'assistant');
  assert.equal(map(old,'b',members,'阿池')[0].role,'user');
  assert.equal(map(old,'a',[...members,{id:'c',name:'小林'}],'小林')[0].role,'user');
  assert.equal(map([{role:'assistant',name:'小林',memberId:'b',text:'写错姓名'}],'a',members,'小林')[0].role,'user');
});

test('group privacy markers and synthetic welcome remain excluded from every speaker history', () => {
  const input=[
    {role:'received',type:'group_welcome',text:'欢迎来到群聊'},
    {role:'assistant',memberId:'b',type:'group_private',text:'私密指令'},
    {role:'assistant',memberId:'b',type:'group_game_private',text:'秘密身份'},
    {role:'assistant',memberId:'b',visibility:'role_only',text:'自己的隐私'},
    {role:'user',text:'今天下雨了'},
    {role:'assistant',memberId:'b',text:'带伞'}
  ];
  for (const id of ['a','b']) {
    const result=map(input,id,members,id==='a'?'小林':'阿池');
    assert.ok(!JSON.stringify(result).includes('私密指令'));
    assert.ok(!JSON.stringify(result).includes('秘密身份'));
    assert.ok(!JSON.stringify(result).includes('自己的隐私'));
    assert.ok(!JSON.stringify(result).includes('欢迎来到群聊'));
    assert.ok(JSON.stringify(result).includes('今天下雨了'));
    assert.ok(JSON.stringify(result).includes('带伞'));
  }
});

test('group page passes selected speakerId to mapping and preserves it for the temporary avatar', () => {
  assert.match(detail,/speakerId: isGroupChat && groupReplyPick \? String\(groupReplyPick\.id\) : ''/);
  assert.match(detail,/speakerName: isGroupChat && groupReplyPick \? String\(groupReplyPick\.name \|\| ''\) : ''/);
  assert.match(detail,/speaker-scoped history mapper unavailable/);
  assert.match(detail,/var tmpStreamMsg = \{ role: 'assistant', text: tmpText,[\s\S]*?memberId: groupReplyPick/);
});

test('single-chat and legacy callers without speakerId keep their previous history semantics', () => {
  const history=[{role:'user',text:'你好'},{role:'assistant',text:'好'}];
  const normal=sandbox.ChatContextPolicy.mapHistoryToApiMessages(history, String, {});
  assert.equal(normal[1].role,'assistant');
  assert.equal(normal[1].content,'好');
  const legacyGroup=sandbox.ChatContextPolicy.mapHistoryToApiMessages([
    {role:'assistant',memberId:'a',text:'甲'},
    {role:'assistant',memberId:'b',text:'乙'}
  ], String, {isGroupChat:true,groupMembers:members});
  assert.deepEqual(JSON.parse(JSON.stringify(legacyGroup)).map(x=>x.role),['assistant','assistant','user']);
});
