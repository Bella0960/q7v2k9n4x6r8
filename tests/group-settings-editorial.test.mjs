import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const js = read('shared/js/group-settings-editorial.js');
const css = read('shared/css/group-settings-editorial.css');
const html = read('chat/chat/chat-settings.html');
test('group-only adapter parses and exits without touching DOM in single-chat mode', () => {
  new vm.Script(js);
  vm.runInNewContext(js, {isGroupSetting:false, document:{getElementById(){throw Error('unexpected DOM access')}}});
  vm.runInNewContext(js, {isGroupSetting:true, loadCurrentGroup:()=>null, document:{getElementById(){throw Error('missing group DOM access')}}});
});
test('adapter loads after original settings handlers and delegates existing operations', () => {
  assert.ok(html.indexOf('refreshMeta();\n</script>') < html.indexOf('src="../../shared/js/group-settings-editorial.js'));
  for (const id of ['actionGroupNotice','gpAvatarEditBtn','actionSearchHistory','actionBackground','actionGroupManage','gpInviteToggle','actionPin','actionTimeAware','actionSound']) {
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),id);
  }
  assert.doesNotMatch(js, /\b(?:setItem|removeItem|saveCurrentGroup|saveByKey|fetch)\s*\(/);
});
test('only the member strip collapses; no group name overlays cover', () => {
  assert.match(js,/inner\.append\(strip\)/);
  assert.match(js,/drawer\.append\(inner\)/);
  for (const section of ['drawer','shortcuts','notice']) assert.ok(js.includes('home.insertBefore('+section+',list);'));
  assert.match(js,/cover\.append\(photo, empty\)/);
  assert.match(js,/drawer\.setAttribute\('inert'/);
  assert.match(js,/toggle\.setAttribute\('aria-expanded'/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/repeat\(4,minmax\(0,1fr\)\)/);
});

test('no quick grid or extra heading; group management first, real pin in ordinary list', () => {
  assert.match(js,/list\.replaceChildren\(manage,info,alias,own,pinCard,advanced\)/);
  assert.match(js,/var pinCard = pin\.closest\('\.settings-card'\)/);
  assert.doesNotMatch(js,/gp-quick|quickTitle|settingsTitle|time\.closest\(|sound\.closest\(/);
  assert.doesNotMatch(css,/\.gp-quick/);
  assert.match(css,/\.gp-pin-card #pinSub/);
});

test('white editorial page, localized English details, real invitation handler', () => {
  assert.match(css,/\.cs-stage\.gp-editorial\{background:#fff/);
  assert.match(css,/--gp-serif:/);
  assert.match(css,/--gp-sans:/);
  assert.doesNotMatch(css,/@import|https?:\/\//);
  assert.match(js,/title\.prepend\(english\('GROUP SETTINGS'\)\)/);
  assert.match(js,/bilingual\(noticeButton,'NOTICE'\)/);
  assert.match(js,/actionTile\('\+','邀请',function\(\)\{openManagement\(true\);\}\)/);
  assert.match(js,/renderInviteCandidates\(\)/);
  assert.match(js,/inviteToggle\.click\(\)/);
  assert.match(html,/data-invite-role/);
  assert.match(html,/g\.members\.push\(defaultGroupMember\(target\)\)/);
  assert.match(html,/if \(!saveCurrentGroup\(g\)\)/);
  assert.doesNotMatch(js,/https?:\/\/[^|]/);
});

test('group management exposes existing administrator and title controls',()=>{
  const play=read('chat/chat/group-play.html');
  assert.match(js,/function managementUrl\(section\)/);
  assert.match(js,/byId\('actionGroupManage'\)\.addEventListener\('click'/);
  assert.ok(play.indexOf('id="memberManagement"')<play.indexOf('id="settingsList"'));
  assert.equal((play.match(/data-member-field="isAdmin"/g)||[]).length,1);
  assert.equal((play.match(/data-member-field="title"/g)||[]).length,1);
  assert.match(play,/if\(field==='isAdmin'&&String\(group\.ownerId/);
});

test('directory routes preserve all original controls and scoped subpages',()=>{
  const play=read('chat/chat/group-play.html');
  for(const section of ['members','roles','behavior','relations','memory'])assert.ok(play.includes('data-management-route="'+section+'"'));
  for(const section of ['roles','behavior','relations','memory'])assert.ok(play.includes('data-management-view="'+section+'"'));
  for(const key of ['scheduleEnabled','memorySharing','spectatorMode','allowRoleActions','allowPrivateMessages','autoTalkEnabled','relationshipDynamicsEnabled','followUpEnabled'])assert.equal((play.match(new RegExp('data-setting="'+key+'"','g'))||[]).length,1);
  for(const id of ['membersList','ownerSelect','relationshipsList','autoTalkRounds','groupChatMode'])assert.equal((play.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.match(js,/subpage\.append\(manage\)/);
  assert.match(js,/subpage\.append\(byId\('memCard'\)\)/);
  assert.match(js,/&view=members/);
  assert.match(css,/\.gp-subpage-content/);
});

test('group portrait modal, media reference and chat member-ID routing',()=>{
  const portraits=read('shared/js/phone/group-portraits.js');
  const detail=read('chat/chat/chat-detail.html');
  new vm.Script(portraits);
  assert.match(js,/btn\('gp-shortcut','群内头像',openPortraits\)/);
  assert.match(js,/dialog\.showModal\(\)/);
  assert.match(js,/await api\.save\(state,changes\)/);
  assert.match(portraits,/ownerId:JSON\.stringify\(\[s\.account,String\(s\.group\.id\),id\]\)/);
  assert.match(portraits,/global\.localStorage\.setItem\('phone_groups',encoded\)/);
  assert.doesNotMatch(portraits,/setItem\('(?:myProfile|ai_custom_characters)'/);
  assert.match(portraits,/record\.accountId===account/);
  assert.match(detail,/if\(isGroupChat\)fillGroupPortrait\(avatar,msg,true\)/);
  assert.match(detail,/msg\.memberId!=null\?String\(msg\.memberId\)/);
});
