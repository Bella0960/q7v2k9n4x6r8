import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const script = read('shared/js/phone/chat-role-context.js');
const detail = read('chat/chat/chat-detail.html');
const editor = read('worldbook/characters/js/characters-manager.js');
const protocolPage = read('worldbook/settings/rp-protocol.html');
const win = {};
runInNewContext(script, {window: win});
const policy = win.MAOMAOChatRoleContext;

const speaker = {
  id: 'role-shenzhen', name:'陆昭辰',
  persona:'在深圳经营自己的店，性格克制，有明确的生活安排。',
  tone:'说话短，不卖萌，不喊大家小伙伴。',
  worldBookIds:['speaker-local']
};
const customProtocol = '用户自己保存的伴侣协议：忠于人物性格，不强制亲密，依据 {{persona}} 表达。';
const expanded = customProtocol.replace('{{persona}}', speaker.persona);
const activeBook = '【街巷 · 日常】\n常去的街道与作息安排。';
function request() {
  return {
    role:speaker,speakerId:speaker.id,persona:speaker.persona,tone:speaker.tone,
    protocol:customProtocol,expandedProtocol:expanded,worldbook:activeBook,
    worldbookPolicyReady:true,
    messages:[{role:'system',content:expanded+'\n'+speaker.tone+'\n'+activeBook},
      {role:'user',content:'你在忙吗？'}]
  };
}

test("same user's saved role, tone, protocol and activated worldbook all reach final outbound messages", () => {
  const result = policy.validateFinalApiMessages(request());
  assert.equal(result.ok,true, result.missing.join(','));
  assert.deepEqual(Array.from(result.missing),[]);
  assert.equal(result.evidence.personaChars,speaker.persona.length);
  assert.equal(result.evidence.toneChars,speaker.tone.length);
  assert.equal(result.evidence.protocolChars,customProtocol.length);
  assert.equal(result.evidence.worldbookChars,activeBook.length);
});

test('missing ANY source is a hard stop, and another group member cannot substitute for the selected speaker', () => {
  for(const [field,replace] of [
    ['speakerId','another-role'],
    ['persona','旧群成员快照'],
    ['tone','错误口吻'],
    ['expandedProtocol','未被写进请求的另一协议'],
    ['worldbook','尚未进入 system 的世界书'],
    ['worldbookPolicyReady',false]
  ]) {
    const output=policy.validateFinalApiMessages({...request(),[field]:replace});
    assert.equal(output.ok,false,field+' not verified');
    assert.ok(output.missing.length);
  }
  assert.equal(policy.validateFinalApiMessages({...request(),role:{id:speaker.id,persona:'过期人设',tone:speaker.tone}}).ok,false);
  assert.equal(policy.validateFinalApiMessages({...request(),messages:[{role:'user',content:'没有 system'}]}).ok,false);
});

test('group member uses group book mounts plus OWN bound local lore, not other members\' private local lore', () => {
  const books=[
    {id:'global',scope:'global'}, {id:'group-bound',scope:'local'},
    {id:'speaker-local',scope:'local'}, {id:'other-member-private',scope:'local'}
  ];
  const chosen=policy.selectWorldbooksForGroupSpeaker(books,['group-bound'],speaker);
  assert.deepEqual(Array.from(chosen.map(x=>x.id)),['global','group-bound','speaker-local']);
  assert.deepEqual(Array.from(policy.selectWorldbooksForGroupSpeaker(books,[],null).map(x=>x.id)),['global']);
  assert.match(detail,/selectWorldbooksForGroupSpeaker\(/);
  assert.match(detail,/groupReplyPick && getRoleById\(groupReplyPick\.id\)/);
});

test('chat always verifies last assembled apiMessages before PhoneStream.chat and never substitutes a stale group member snapshot', () => {
  const audit=detail.indexOf('const finalPayloadAudit =');
  const send=detail.indexOf('streamResult = await PhoneStream.chat(',audit);
  assert.ok(audit>0&&send>audit,'final audit must precede transport');
  assert.match(detail.slice(audit,send),/messages: apiMessages/);
  assert.match(detail.slice(audit,send),/if \(!finalPayloadAudit\.ok\)\s*\{/);
  assert.match(detail.slice(audit,send),/return;/);
  assert.match(detail,/const rawSpeakerPersona = isGroupChat && groupReplyPick[\s\S]*?String\(relationshipRole/);
  assert.doesNotMatch(detail,/groupReplyPick\.persona \|\| groupReplyPick\.prompt/);
  assert.match(detail,/roleForTurn\.id/);
  assert.match(detail,/latestSpeaker && \(latestSpeaker\.tone \|\| latestSpeaker\.speechStyle/);
  assert.match(detail,/chat_rp_protocol_/);
  assert.match(detail,/角色生活资料过长/);
  assert.match(editor,/target\.persona = personaVal/);
  assert.match(editor,/target\.tone = toneVal/);
  assert.match(protocolPage,/var STORAGE_KEY = 'chat_rp_protocol_'/);
});
