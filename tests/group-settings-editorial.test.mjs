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
  for (const id of ['actionGroupNotice','actionSearchHistory','actionBackground','actionGroupManage','gpInviteToggle','actionPin','actionTimeAware','actionSound']) {
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes("'"+id+"'"),id);
  }
  assert.ok(html.includes('id="gpAvatarEditBtn"')); // original group icon control still exists in group info
  assert.match(js,/btn\('gp-shortcut','群内头像',openPortraits\)/);
  assert.doesNotMatch(js, /\b(?:setItem|removeItem|saveByKey|fetch)\s*\(/);
  assert.match(js,/if\(!saveCurrentGroup\(group\)\)/);
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
  assert.match(portraits,/guard\.commit\(s\.expected,updated\)/);
  assert.doesNotMatch(portraits,/localStorage\.setItem\(/);
  assert.doesNotMatch(portraits,/setItem\('(?:myProfile|ai_custom_characters)'/);
  assert.match(portraits,/record\.accountId===account/);
  assert.match(detail,/if\(isGroupChat\)fillGroupPortrait\(avatar,msg,true\)/);
  assert.match(detail,/msg\.memberId!=null\?String\(msg\.memberId\)/);
});

test('group title permissions are based on member IDs and current role, not title',()=>{
 const policy=read('shared/js/phone/group-admin-policy.js'), context={}; context.window=context;
 vm.runInNewContext(policy,context);
 const api=context.MAOGroupAdminPolicy;
 const group={ownerId:'owner',settings:{allowRoleActions:true},members:[{id:'owner'},{id:'admin',isAdmin:true},{id:'peer',isAdmin:true},{id:'ordinary',title:'群主'},{id:'other'}]};
 assert.equal(api.can(group,'admin','头衔','ordinary'),true);
 assert.equal(api.can(group,'ordinary','头衔','ordinary'),true);
 assert.equal(api.can(group,'ordinary','头衔','other'),false);
 assert.equal(api.can(group,'admin','头衔','peer'),false);
 assert.equal(api.can(group,'admin','移除','owner'),false);
 assert.equal(api.can(group,'admin','禁言','__user'),false);
 assert.equal(api.can(group,'owner','头衔','admin'),true);
 assert.equal(api.can(group,'admin','头衔','__user'),false);
 group.members[1].isAdmin=false;
 assert.equal(api.can(group,'admin','头衔','ordinary'),false);
 group.settings.allowRoleActions=false;
 assert.equal(api.can(group,'ordinary','头衔','ordinary'),false);
 assert.equal(api.title('  气氛组  '),'气氛组');
 assert.equal(api.title('a\nb'),null);
 assert.equal(api.title('x'.repeat(21)),null);
 const detail=read('chat/chat/chat-detail.html'),play=read('chat/chat/group-play.html');
 assert.match(detail,/expected=window\.MAOGroupWriteGuard\.read\(gid\)/);
 assert.match(detail,/policy\.can\(fresh,actor,action,target\)/);
 assert.match(detail,/if\(!saveCurrentGroupObject\(expected\)\)/);
 assert.match(play,/group\.selfTitle=value/);
});

test('write guard rejects stale and cross-account updates and verifies readback',()=>{
  let data=JSON.stringify([{id:'g1',members:[]},{id:'g2',name:'other'}]),account='001',fail=false;
  const context={document:{querySelector:()=>({content:account})},localStorage:{getItem:()=>data,setItem:(_key,value)=>{if(fail)throw Error('quota');data=value;}}};
  context.window=context;
  vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),context);
  const api=context.MAOGroupWriteGuard,old=api.read('g1'),fresh=api.read('g1');
  assert.equal(api.commit(fresh,{...fresh.group,selfTitle:'新头衔'}).ok,true);
  assert.equal(api.commit(old,{...old.group,name:'旧页面'}).reason,'stale');
  assert.equal(JSON.parse(data)[0].selfTitle,'新头衔');
  const snap=api.read('g1');account='002';
  assert.equal(api.commit(snap,snap.group).reason,'scope');
  account='001';fail=true;
  assert.equal(api.commit(snap,snap.group).reason,'storage');
  fail=false;data=JSON.stringify([{id:'g2'}]);
  assert.equal(api.commit(snap,snap.group).reason,'stale');
});

test('portrait media ownership, isolated group, failed batch and stale selection',async()=>{
  const context={Map,Blob,document:{querySelector:()=>({content:account})}};
  const A='as_'+'A'.repeat(32),B='as_'+'B'.repeat(32), image='data:image/png;base64,AAAA';
  let account='001',data=JSON.stringify([{id:'g1',members:[{id:'r',avatar:'old'}]},{id:'g2',members:[{id:'r',avatar:'other'}]}]), count=0, failAt=0;
  const refs=new Map();
  context.localStorage={getItem:()=>data,setItem:(_key,v)=>{data=v;}};
  context.PhoneStorage={MediaRepository:class{
    async putBlob(blob,opts){count++;if(count===failAt)return {ok:false};const id=count%2?A:B;refs.set(opts.ownerId,[{assetId:id}]);return {ok:true,value:{assetId:id}};}
    async getBlob(){return {ok:true};}
    async listByOwner(_type,id){return {ok:true,value:refs.get(id)||[]};}
    async toDataUrl(){return {ok:true,value:image};}
  }};
  context.window=context;vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),context);vm.runInNewContext(read('shared/js/phone/group-portraits.js'),context);
  const api=context.MAOGroupPortraits, blob=new Blob(['image'],{type:'image/png'});
  const original=data;
  failAt=2;
  await assert.rejects(api.save(api.snapshot('g1'),new Map([['r',blob],['__user',blob]])));
  assert.equal(data,original);
  failAt=0;
  await api.save(api.snapshot('g1'),new Map([['r',blob]]));
  let list=JSON.parse(data),group=list[0];
  assert.equal(await api.resolve(group,'r'),image);
  assert.equal(await api.resolve(list[1],'r'),'');
  assert.equal(group.members[0].avatar,'old');
  account='002';assert.equal(await api.resolve(group,'r'),'');
  assert.throws(()=>api.snapshot('g1'));
  account='001';
  const stale=api.snapshot('g1');
  list[0].name='new';data=JSON.stringify(list);
  await assert.rejects(api.save(stale,new Map([['r',null]])));
  const forged={id:'g2',members:[{id:'r'}],portraitOverridesV1:group.portraitOverridesV1};list[1]=forged;data=JSON.stringify(list);
  assert.equal(await api.resolve(forged,'r'),'');
  api.forgetMember(list[0],'r');data=JSON.stringify(list);
  assert.equal(await api.resolve(group,'r'),'');
  await api.save(api.snapshot('g1'),new Map([['r',null]]));
  assert.equal(JSON.parse(data)[0].portraitOverridesV1.entries.length,0);
});

test('group nickname is editable without global profile writes and back routes terminate',()=>{
  const detail=read('chat/chat/chat-detail.html');
  assert.match(js,/btn\('gp-own-name', '', openOwnName\)/);
  assert.match(js,/group\.preferences\.myNickname=name/);
  assert.match(js,/if\(!saveCurrentGroup\(group\)\)/);
  assert.match(detail,/isGroupChat && currentGroup && currentGroup\.preferences/);
  assert.match(detail,/const userName = groupNickname \|\|/);
  assert.match(js,/location\.href='chat-detail\.html\?id='/);
  assert.match(js,/&view=members&from=overview/);
  assert.match(js,/viewParams\.get\('from'\)==='overview'/);
});

test('portrait saves preserve other group writes during upload and retry safely after failure',async()=>{
  let account='001',data=JSON.stringify([{id:'g1',members:[{id:'r'}]},{id:'g2',name:'original'}]),failWrite=false,changeDuringUpload=true;
  const asset='as_'+'A'.repeat(32),context={Map,Blob,document:{querySelector:()=>({content:account})}};
  context.localStorage={getItem:()=>data,setItem:(_key,v)=>{if(failWrite)throw Error('quota');data=v;}};
  context.PhoneStorage={MediaRepository:class{
    async putBlob(){if(changeDuringUpload){const list=JSON.parse(data);list[1].name='updated during upload';data=JSON.stringify(list);}return {ok:true,value:{assetId:asset}};}
    async getBlob(){return {ok:true};}
  }};
  context.window=context;
  vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),context);
  vm.runInNewContext(read('shared/js/phone/group-portraits.js'),context);
  const api=context.MAOGroupPortraits,blob=new Blob(['image'],{type:'image/png'});
  const snap=api.snapshot('g1');
  await api.save(snap,new Map([['r',blob]]));
  assert.equal(JSON.parse(data)[1].name,'updated during upload');
  assert.equal(JSON.parse(data)[0].portraitOverridesV1.entries[0].assetId,asset);
  changeDuringUpload=false;
  const retry=api.snapshot('g1'),before=data;
  failWrite=true;
  await assert.rejects(api.save(retry,new Map([['r',null]])));
  assert.equal(data,before);
  failWrite=false;
  await api.save(retry,new Map([['r',null]]));
  assert.equal(JSON.parse(data)[0].portraitOverridesV1.entries.length,0);
});

test('group deletion refuses stale or failed writes, preserves other groups',()=>{
  let data=JSON.stringify([{id:'g1',name:'old'},{id:'g2',name:'other'}]),account='001',fail=false;
  const ctx={document:{querySelector:()=>({content:account})},localStorage:{getItem:()=>data,setItem:(_key,v)=>{if(fail)throw Error('quota');data=v;}}};ctx.window=ctx;
  vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
  const api=ctx.MAOGroupWriteGuard,stale=api.read('g1');
  assert.equal(api.commit(stale,{...stale.group,name:'new'}).ok,true);
  assert.equal(api.remove(stale).reason,'stale');
  const now=api.read('g1'),before=data;fail=true;
  assert.equal(api.remove(now).reason,'storage');
  assert.equal(data,before);
  fail=false;account='002';
  assert.equal(api.remove(now).reason,'scope');
  account='001';
  assert.equal(api.remove(now).ok,true);
  assert.equal(JSON.parse(data).length,1);
  assert.equal(JSON.parse(data)[0].id,'g2');
  assert.equal(api.commit(now,now.group).reason,'stale');
  const deletion=html.slice(html.indexOf("document.getElementById('actionGpDismiss').addEventListener"),html.indexOf('var gpAdvancedEntry'));
  assert.ok(deletion.indexOf('MAOGroupWriteGuard.remove(snapshot)')<deletion.indexOf("var keys=['chat_history_'"));
  assert.match(deletion,/if\(!result\.ok\).*return;/);
});
test('AI invitation uses exact identity and complete existing member defaults',()=>{
 const ctx={};ctx.window=ctx;vm.runInNewContext(read('shared/js/phone/group-admin-policy.js'),ctx);
 const api=ctx.MAOGroupAdminPolicy;
 const pool=[{id:'c1',name:'同名'},{id:'c2',name:'同名'},{id:'c3',name:'独立'},{id:'__user',name:'我'}];
 assert.equal(api.findInviteRole(pool,'同名'),null);
 assert.equal(api.findInviteRole(pool,'c2').id,'c2');
 assert.equal(api.findInviteRole(pool,'独立').id,'c3');
 assert.equal(api.findInviteRole(pool,'__user'),null);
 assert.equal(api.findInviteRole([...pool,{id:'c2',name:'另名'}],'c2'),null);
 assert.equal(api.findInviteRole([...pool,{id:'c3',name:'其他'}],'独立'),null);
 const member=api.defaultMember(pool[0]);
 assert.equal(member.id,'c1');assert.equal(member.isAdmin,false);
 assert.equal(member.talkativeness,0.5);assert.equal(member.replyThreshold,55);
 assert.equal(member.interestTags.length,0);assert.equal(member.expertiseTags.length,0);assert.equal(member.backgroundTags.length,0);
 assert.equal(api.defaultMember(pool[3]),null);
 const detail=read('chat/chat/chat-detail.html');
 assert.match(detail,/policy\.findInviteRole\(pool,target\)/);
 assert.match(detail,/policy\.defaultMember\(targetRole\)/);
 assert.match(detail,/JSON\.stringify\(managementRoster\)/);
});


test('missing account identity fails closed remotely, only explicit loopback remains compatible',()=>{
  let account='',host='preview.mao520.com',data=JSON.stringify([{id:'g1',name:'original'},{id:'g2'}]),writes=0,changeOnRead=false;
  const ctx={document:{querySelector:()=>account?{content:account}:null},location:{get hostname(){return host}},localStorage:{getItem(){if(changeOnRead)account='002';return data},setItem(k,v){writes++;data=v}}};ctx.window=ctx;
  vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
  const api=ctx.MAOGroupWriteGuard, fake={id:'g1',account:'',serialized:JSON.stringify(JSON.parse(data)[0])};
  assert.equal(api.read('g1'),null);
  assert.equal(api.commit(fake,{id:'g1',name:'wrong'}).reason,'scope');
  assert.equal(api.remove(fake).reason,'scope');
  assert.equal(writes,0);
  account='001';const snapshot=api.read('g1');account='';
  assert.equal(api.commit(snapshot,snapshot.group).reason,'scope');
  assert.equal(api.remove(snapshot).reason,'scope');
  assert.equal(writes,0);
  account='001';changeOnRead=true;assert.equal(api.read('g1'),null);changeOnRead=false;account='';
  host='localhost.example.org';assert.equal(api.read('g1'),null);
  for(const h of ['localhost','127.0.0.1','[::1]']){
    host=h;const local=api.read('g1');assert.ok(local);
    assert.equal(api.commit(local,{...local.group,name:'local'}).ok,true);
    assert.equal(JSON.parse(data)[1].id,'g2');
  }
});


test('group creation never overwrites damaged, duplicate, stale or foreign-account data',()=>{
  function setup(raw='[{"id":"g1","name":"old","extra":{"keep":true}}]'){
    const state={raw,owner:'A',writes:0,reads:0,host:'preview.mao520.com'};
    const ctx={location:{get hostname(){return state.host}},document:{querySelector:()=>({content:state.owner})},localStorage:{getItem(){state.reads++;if(state.onRead)state.onRead();return state.raw},setItem(k,v){state.writes++;if(state.fail)throw Error('quota');if(!state.ignore)state.raw=v}}};ctx.window=ctx;
    vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
    return [ctx.MAOGroupWriteGuard,state];
  }
  const next={id:'g2',name:'new',members:[]};
  {const [g,s]=setup();const old=JSON.parse(s.raw)[0];assert.equal(g.create('A',next).ok,true);assert.deepEqual(JSON.parse(s.raw),[old,next]);}
  {const [g,s]=setup(null);assert.equal(g.create('A',next).ok,true);assert.deepEqual(JSON.parse(s.raw),[next]);}
  for(const raw of ['', '{oops','null','{}']){const [g,s]=setup(raw);assert.equal(g.create('A',next).ok,false);assert.equal(s.raw,raw);assert.equal(s.writes,0);}
  {const [g,s]=setup();assert.equal(g.create('A',{id:'g1'}).reason,'duplicate');assert.equal(s.writes,0);}
  {const [g,s]=setup();s.owner='B';assert.equal(g.create('A',next).reason,'scope');s.owner='';assert.equal(g.create('',next).reason,'scope');assert.equal(s.writes,0);}
  {const [g,s]=setup();s.onRead=()=>{s.owner='B'};assert.equal(g.create('A',next).ok,false);assert.equal(s.writes,0);}
  {const [g,s]=setup();s.onRead=()=>{if(s.reads===2)s.raw='[{"id":"g3"}]'};assert.equal(g.create('A',next).reason,'stale');assert.equal(s.raw,'[{"id":"g3"}]');assert.equal(s.writes,0);}
  {const [g,s]=setup();const old=s.raw;s.fail=true;assert.equal(g.create('A',next).reason,'storage');assert.equal(s.raw,old);}
  {const [g,s]=setup();s.ignore=true;assert.equal(g.create('A',next).reason,'unconfirmed');}
  {const [g,s]=setup();const snap=g.read('g1');s.raw='[{"id":"g1","name":"newer"}]';assert.equal(g.commit(snap,{id:'g1',name:'wrong'}).reason,'stale');assert.equal(s.writes,0);}
});
test('chat list create menu reaches original modal and waits for verified save',()=>{
  const list=read('chat/chat/chat.html');
  assert.ok(list.includes('group-write-guard.js?v=20261125g8'));
  assert.ok(list.includes("document.getElementById('menuGroup').addEventListener('click',function(){"));
  assert.ok(list.includes("document.getElementById('wechatMenu').style.display='none';\n        openModal();"));
  assert.ok(list.includes('guard.create(modalAccount,'));
  const handler=list.slice(list.indexOf("document.getElementById('groupModalCreate').addEventListener"));
  assert.ok(handler.indexOf('if(!result.ok)')<handler.indexOf('closeModal();'));
  assert.equal(handler.includes("localStorage.setItem('phone_groups'"),false);
});


test('group reply snapshot rejects removed, muted, duplicate and cross-account speakers',()=>{
  const state={account:'001',groups:[{id:'g1',members:[{id:'r1',name:'同名'},{id:'r2',name:'同名'}]},{id:'g2',members:[{id:'r1'}]}]};
  const ctx={document:{querySelector:()=>({content:state.account})},location:{hostname:'preview.mao520.com'},localStorage:{getItem:()=>state.raw??JSON.stringify(state.groups)}};ctx.window=ctx;
  vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
  const api=ctx.MAOGroupWriteGuard,snap=api.read('g1'),original=JSON.stringify(state.groups);
  assert.equal(api.matches(snap,'r1'),true);
  state.groups[1].name='other changed';assert.equal(api.matches(snap,'r1'),true);
  for(const owner of ['002','']){state.account=owner;assert.equal(api.matches(snap,'r1'),false);}state.account='001';
  state.groups.shift();assert.equal(api.matches(snap,'r1'),false);state.groups=JSON.parse(original);
  state.groups[0].members.shift();assert.equal(api.matches(snap,'r1'),false);state.groups=JSON.parse(original);
  state.groups[0].members[0].muted=true;assert.equal(api.matches(snap,'r1'),false);assert.equal(api.matches(api.read('g1'),'r1'),false);state.groups=JSON.parse(original);
  state.groups[0].settings={allowPrivateMessages:false};assert.equal(api.matches(snap,'r1'),false);state.groups=JSON.parse(original);
  state.groups[0].members.push({id:'r1'});assert.equal(api.matches(api.read('g1'),'r1'),false);state.groups=JSON.parse(original);
  assert.equal(api.matches(snap,'同名'),false);
  state.groups[0].members.push({id:'__user'});assert.equal(api.matches(api.read('g1'),'__user'),false);
  state.raw='{broken';assert.equal(api.matches(snap,'r1'),false);
});
test('group reply is guarded before request, after stream, on pagehide and before delayed followup',()=>{
  const detail=read('chat/chat/chat-detail.html');
  assert.ok(detail.includes('const groupPageAccount=groupWriteBase?groupWriteBase.account:null'));
  assert.ok(detail.includes('singleChatTurnSnapshots.set(historyList, localStorage.getItem(storageKey))'));
  const send=detail.slice(detail.indexOf('async function sendMsgTurn(opts)'),detail.indexOf('// 暴露给 chat-extras.js'));
  const request=send.indexOf('await PhoneStream.chat('),marker=send.indexOf('fullText = processGroupInteractionMarkers(');
  assert.ok(request>0&&marker>request);
  assert.ok(send.slice(0,request).includes('MAOGroupWriteGuard.matches(groupTurnScope'));
  assert.ok(send.slice(request,marker).includes('MAOGroupWriteGuard.matches(groupTurnScope'));
  assert.ok(send.includes('followupToken !== groupAutoFollowupToken || !readPageGroup() || !singleChatTurnIsCurrent(historyList)'));
  assert.ok(detail.includes('!singleChatTurnIsCurrent(inflightSnapshot.historyList)'));
  assert.ok(detail.includes("exactId!==String(speaker.id)||exactId==='__user'"));
  assert.ok(detail.includes('privateActionSeen||isRegeneration'));
});


test('group preferences preserve newer writes and reject scope changes',()=>{
  function setup(){
    const state={account:'001',writes:0,data:new Map([['phone_groups',JSON.stringify([{id:'g1',name:'one'},{id:'g2',name:'two'}])],['chat_group_alias_g1','old'],['chat_group_notice_g2','other']])};
    const ctx={document:{querySelector:()=>({content:state.account})},location:{hostname:'preview.mao520.com'},localStorage:{getItem:k=>state.data.get(k)??null,setItem(k,v){state.writes++;if(state.fail)throw Error('quota');if(!state.ignore)state.data.set(k,v)}}};ctx.window=ctx;
    vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
    const api=ctx.MAOGroupWriteGuard;return {api,state,group:api.read('g1')};
  }
  {const {api,state,group}=setup();assert.equal(api.writePreference(api.readPreference(group,'alias'),'new').ok,true);assert.equal(state.data.get('chat_group_alias_g1'),'new');assert.equal(state.data.get('chat_group_notice_g2'),'other');}
  {const {api,state,group}=setup();assert.equal(api.writePreference(api.readPreference(group,'notice'),'').ok,true);assert.equal(state.data.get('chat_group_notice_g1'),'');}
  {const {api,state,group}=setup();const snap=api.readPreference(group,'alias');state.data.set('chat_group_alias_g1','newer');assert.equal(api.writePreference(snap,'old editor').reason,'stale');assert.equal(state.writes,0);}
  for(const account of ['002','']){const {api,state,group}=setup();const snap=api.readPreference(group,'alias');state.account=account;assert.equal(api.writePreference(snap,'wrong').ok,false);assert.equal(state.writes,0);}
  {const {api,state,group}=setup();const snap=api.readPreference(group,'notice');state.data.set('phone_groups','[{"id":"g2"}]');assert.equal(api.writePreference(snap,'wrong').ok,false);assert.equal(state.writes,0);}
  {const {api,state,group}=setup();assert.equal(api.readPreference(group,'history'),null);assert.equal(api.writePreference({group,kind:'history',raw:null},'wrong').ok,false);assert.equal(state.writes,0);}
  {const {api,state,group}=setup();const snap=api.readPreference(group,'alias');state.fail=true;assert.equal(api.writePreference(snap,'new').reason,'storage');assert.equal(state.data.get('chat_group_alias_g1'),'old');}
  {const {api,state,group}=setup();const snap=api.readPreference(group,'alias');state.ignore=true;assert.equal(api.writePreference(snap,'new').reason,'unconfirmed');}
  {const {api,state,group}=setup();const snap=api.readPreference(group,'alias');const groups=JSON.parse(state.data.get('phone_groups'));groups[1].name='updated';state.data.set('phone_groups',JSON.stringify(groups));assert.equal(api.writePreference(snap,'new').ok,true);}
});
test('group settings binds initial account and edit snapshots instead of reloading a new target at save',()=>{
  assert.ok(html.includes('snapshot.account!==groupPageScope.account'));
  assert.ok(html.includes('var g=renderedGroup;'));
  assert.ok(html.includes('avatarSelection=loadCurrentGroup()'));
  assert.ok(html.includes('var g=avatarSelection;avatarSelection=null'));
  assert.ok(html.includes('writePreference(aliasSnapshot,val)'));
  assert.ok(html.includes('writePreference(noticeSnapshot,val)'));
  assert.ok(html.includes("targets.length===1&&rid!=='__user'"));
});


test('group wallpaper transaction rejects stale background and scope and never overwrites other keys',async()=>{
  const source=read('shared/js/wallpaper-store.js');
  const start=source.indexOf('  function groupBackgroundKey('),end=source.indexOf('  function removeByKey(',start);
  assert.ok(start>=0&&end>start);
  const code=source.slice(start,end);
  const A='data:image/png;base64,AAAA',B='data:image/png;base64,BBBB',C='data:image/png;base64,CCCC',K='chat_bg_g1';
  function setup(){
    const images=new Map([[K,{dataUrl:A}],['chat_bg_g2',{dataUrl:C}],['home_custom_wallpaper',{dataUrl:C}]]),legacy=new Map(),state={valid:true,writes:0};
    const db={transaction(){let aborted=false,staged;const tx={abort(){aborted=true;queueMicrotask(()=>tx.onabort())},objectStore(){return {
      get(key){const r={};queueMicrotask(()=>{r.result=images.get(key);r.onsuccess()});return r},
      put(value,key){const r={};staged=[key,value];queueMicrotask(()=>{if(aborted)return;if(state.fail){tx.onerror();return}if(state.onPut)state.onPut();r.onsuccess();if(!aborted){images.set(...staged);state.writes++;queueMicrotask(()=>tx.oncomplete())}});return r}
    }}};return tx}};
    const ctx={window:{localStorage:{getItem:k=>legacy.get(k)??null,removeItem:k=>legacy.delete(k)}},STORE_NAME:'wallpapers',openDB:()=>state.unavailable?Promise.reject(Error('DB offline')):Promise.resolve(db),readDB:k=>Promise.resolve(images.get(k)?.dataUrl||''),Date,Promise,Error};
    vm.runInNewContext(code,ctx);return {...ctx,state,images,legacy,check:()=>state.valid};
  }
  {const s=setup();s.images.delete(K);s.legacy.set(K,A);const snap=await s.snapshotGroupBackground(K,s.check);assert.equal(snap.legacy,A);assert.equal(s.images.has(K),false);assert.equal(s.state.writes,0);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);assert.equal(await s.saveGroupBackground(snap,B,s.check),true);assert.equal(s.images.get(K).dataUrl,B);assert.equal(s.images.get('chat_bg_g2').dataUrl,C);assert.equal(s.images.get('home_custom_wallpaper').dataUrl,C);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.images.set(K,{dataUrl:C});await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.images.get(K).dataUrl,C);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.legacy.set(K,C);await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.legacy.get(K),C);assert.equal(s.images.get(K).dataUrl,A);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.state.valid=false;await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.state.writes,0);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.state.onPut=()=>s.state.valid=false;await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.images.get(K).dataUrl,A);assert.equal(s.state.writes,0);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.state.fail=true;await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.images.get(K).dataUrl,A);}
  {const s=setup();const snap=await s.snapshotGroupBackground(K,s.check);s.state.unavailable=true;await assert.rejects(s.saveGroupBackground(snap,B,s.check));assert.equal(s.legacy.has(K),false);}
  {const s=setup();for(const key of ['chat_bg_r1','home_custom_wallpaper','chat_bg_g'])await assert.rejects(s.snapshotGroupBackground(key,s.check));}
  {const s=setup();s.legacy.set(K,A);const snap=await s.snapshotGroupBackground(K,s.check);assert.equal(await s.saveGroupBackground(snap,B,s.check),true);assert.equal(s.legacy.has(K),false);}
});
test('group wallpaper page preserves existing key and uses selection-time snapshot',()=>{
  assert.ok(html.includes("var BG_KEY = 'chat_bg_' + roleId"));
  assert.ok(html.includes('groupBackgroundSelection={scope:scope,snapshot:'));
  assert.ok(html.includes('wallpaperStore.saveGroupBackground(snapshot,dataUrl'));
  assert.ok(html.includes('return saveBackgroundImage(dataUrl,selection)'));
  assert.ok(html.includes('saved!==true||!groupBackgroundCheck(selection.scope)'));
});


test('shared group settings validate values and preserve neighboring group and private keys',()=>{
  function setup(){
    const state={account:'001',writes:0,data:new Map([['phone_groups',JSON.stringify([{id:'g1'},{id:'g2'}])]])};
    const ctx={document:{querySelector:()=>({content:state.account})},location:{hostname:'preview.mao520.com'},localStorage:{getItem:k=>state.data.get(k)??null,setItem(k,v){state.writes++;if(state.fail)throw Error('quota');if(!state.ignore)state.data.set(k,v)}}};ctx.window=ctx;
    vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);
    return {api:ctx.MAOGroupWriteGuard,state,group:ctx.MAOGroupWriteGuard.read('g1')};
  }
  const cases=[['pin','chat_pin_','true','false','1'],['memory','chat_memory_limit_','50','20','100'],['time','chat_time_config_',JSON.stringify({mode:'virtual',virtualTimeStr:'2026-12-01'}),JSON.stringify({mode:'real',virtualTimeStr:''}),JSON.stringify({mode:'virtual',virtualTimeStr:' '})],['sound','sound_char_','default','bell','']];
  for(const [kind,prefix,value,newer,bad] of cases){
    {const {api,state,group}=setup();state.data.set(prefix+'g2',newer);state.data.set(prefix+'r1',newer);assert.equal(api.writePreference(api.readPreference(group,kind),value).ok,true);assert.equal(state.data.get(prefix+'g1'),value);assert.equal(state.data.get(prefix+'g2'),newer);assert.equal(state.data.get(prefix+'r1'),newer);}
    {const {api,state,group}=setup();const snap=api.readPreference(group,kind);state.data.set(prefix+'g1',newer);assert.equal(api.writePreference(snap,value).reason,'stale');assert.equal(state.data.get(prefix+'g1'),newer);assert.equal(state.writes,0);}
    {const {api,state,group}=setup();assert.equal(api.writePreference(api.readPreference(group,kind),bad).reason,'invalid');assert.equal(state.writes,0);}
    {const {api,state,group}=setup();const snap=api.readPreference(group,kind);state.account='002';assert.equal(api.writePreference(snap,value).ok,false);assert.equal(state.writes,0);}
    {const {api,state,group}=setup();const snap=api.readPreference(group,kind);state.fail=true;assert.equal(api.writePreference(snap,value).reason,'storage');state.fail=false;state.ignore=true;assert.equal(api.writePreference(snap,value).reason,'unconfirmed');assert.equal(state.data.has(prefix+'g1'),false);}
  }
});
test('group shared settings route to scoped saves, keeping original private keys',()=>{
  for(const kind of ['pin','memory','time','sound'])assert.ok(html.includes("scopedSetting('"+kind+"')"));
  for(const expression of ['saveScopedSetting(pinSnapshot,next)','saveScopedSetting(memorySnapshot,n)','saveScopedSetting(timeSnapshot,JSON.stringify(data))','saveScopedSetting(soundSnapshot,value)'])assert.ok(html.includes(expression));
  assert.ok(html.includes("if(!saveSound(key)){renderSub();renderList();return;}"));
});

test('account switch during final storage reread blocks creation and modification before any write',()=>{
  function setup(){
    const state={account:'001',reads:0,writes:0,raw:JSON.stringify([{id:'g1',members:[]},{id:'g2'}])};
    const ctx={document:{querySelector:()=>({content:state.account})},location:{hostname:'preview.mao520.com'},localStorage:{getItem(){state.reads++;if(state.reads===state.switchAt)state.account='002';return state.raw},setItem(k,v){state.writes++;state.raw=v}}};ctx.window=ctx;
    vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);return {state,api:ctx.MAOGroupWriteGuard};
  }
  {const {state,api}=setup();const old=state.raw;state.switchAt=2;assert.equal(api.create('001',{id:'g3'}).ok,false);assert.equal(state.writes,0);assert.equal(state.raw,old);}
  {const {state,api}=setup();const snap=api.read('g1'),old=state.raw;state.switchAt=3;assert.equal(api.commit(snap,{...snap.group,name:'new'}).ok,false);assert.equal(state.writes,0);assert.equal(state.raw,old);}
  {const {state,api}=setup();const snap=api.read('g1'),old=state.raw;state.switchAt=3;assert.equal(api.remove(snap).ok,false);assert.equal(state.writes,0);assert.equal(state.raw,old);}
});
test('all four group pages load the same current write guard',()=>{
  for(const path of ['chat/chat/chat.html','chat/chat/chat-detail.html','chat/chat/chat-settings.html','chat/chat/group-play.html'])assert.ok(read(path).includes('group-write-guard.js?v=20261125g8'),path);
});


test('all six preferences refuse late competing writes and late account changes',()=>{
  const cases=[['pin','chat_pin_','true','false'],['memory','chat_memory_limit_','50','20'],['time','chat_time_config_',JSON.stringify({mode:'virtual',virtualTimeStr:'明天'}),JSON.stringify({mode:'real',virtualTimeStr:''})],['sound','sound_char_','default','bell'],['alias','chat_group_alias_','甲','乙'],['notice','chat_group_notice_','公告甲','公告乙']];
  function setup(){const state={owner:'A',data:new Map([['phone_groups',JSON.stringify([{id:'g1',members:[{id:'r1'}]},{id:'g2'}])]]),writes:0};
    const ctx={location:{hostname:'preview.mao520.com'},document:{querySelector:()=>({content:state.owner})},localStorage:{getItem(k){state.hook?.(k,state);return state.data.get(k)??null},setItem(k,v){state.writes++;state.data.set(k,v)}}};ctx.window=ctx;vm.runInNewContext(read('shared/js/phone/group-write-guard.js'),ctx);return {s:state,g:ctx.MAOGroupWriteGuard};}
  for(const [kind,prefix,val,newer] of cases){
    {const {s,g}=setup();const snap=g.readPreference(g.read('g1'),kind);let sawKey=false;s.hook=(key)=>{if(key===prefix+'g1')sawKey=true;else if(key==='phone_groups'&&sawKey)s.data.set(prefix+'g1',newer)};assert.equal(g.writePreference(snap,val).ok,false);assert.equal(s.writes,0);assert.equal(s.data.get(prefix+'g1'),newer);}
    {const {s,g}=setup();const snap=g.readPreference(g.read('g1'),kind);let n=0;s.hook=(key)=>{if(key===prefix+'g1'&&++n===2)s.owner='B'};assert.equal(g.writePreference(snap,val).ok,false);assert.equal(s.writes,0);}
  }
});
