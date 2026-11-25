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
