import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const bridgeSource=readFileSync(new URL('../shared/js/phone/inspect_interaction_bridge.js',import.meta.url),'utf8');
const featureSource=readFileSync(new URL('../inspect-phone/inspect-feature.js',import.meta.url),'utf8');
const nativeSource=readFileSync(new URL('../inspect-phone/inspect-native-view.js',import.meta.url),'utf8');
const phoneSource=readFileSync(new URL('../inspect-phone/phone.html',import.meta.url),'utf8');
const chatSource=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const cssSource=readFileSync(new URL('../inspect-phone/inspect-native.css',import.meta.url),'utf8');

function setup(roleId='test-note-owner',store=new Map()) {
  const handlers={};let quota=false;
  const storage={
    getItem(k){return store.has(k)?store.get(k):null;},
    setItem(k,v){if(quota)throw new Error('quota exceeded');store.set(k,String(v));},
    removeItem(k){store.delete(k);}
  };
  const node=(name)=>({
    innerHTML:'',textContent:'',scrollTop:0,scrollHeight:700,style:{},
    classList:{add(){},remove(){}},
    addEventListener(event,fn){handlers[name+':'+event]=fn;}
  });
  const grid=node('grid'),dock=node('dock'),back=node('back'),
    reload=node('reload'),appBody=node('appBody'),appLayer=node('appLayer'),appTitle=node('appTitle');
  const document={querySelector(q){return q==='.grid'?grid:dock;},
    getElementById(q){return q==='appBack'?back:reload;}};
  const window={PhoneStorage:{getApiConfig(){return {};}},localStorage:storage,
    location:{hostname:'app.mao520.com',assign(href){window.navigatedTo=href;}}};
  const context={window,document,localStorage:storage,Date,Math,JSON,Number,String,Array,Object,console};
  vm.runInNewContext(bridgeSource,context);
  vm.runInNewContext(nativeSource,context);
  vm.runInNewContext(featureSource,context);
  const role={id:roleId,name:'林禾',occupation:'图书编辑',relationship:'朋友',affection:83};
  const mount=()=>window.InspectPhoneFeature.mount({
    role,requestedId:roleId,appBody,appLayer,appTitle
  });
  const key=window.InspectPhoneFeature.storyKey(roleId);
  const read=()=>JSON.parse(store.get(key));
  const click=(scope,attr,value)=>{
    const handler=handlers[scope+':click'];assert.equal(typeof handler,'function');
    handler({target:{closest(sel){
      if(attr==='action'&&sel==='[data-action]')return {dataset:{action:value}};
      if(attr==='app'&&sel==='[data-app]')return {dataset:{app:value}};
      if(attr==='detail'&&sel==='[data-detail]')return {dataset:{detail:value.kind,index:String(value.index)}};
      return null;
    }}});
  };
  const action=v=>click('appBody','action',v);
  const app=v=>click(v==='chat'||v==='browser'?'dock':'grid','app',v);
  const detail=(kind,index=0)=>click('appBody','detail',{kind,index});
  const submit=(formId,values)=>{
    const handler=handlers['appBody:submit'];assert.equal(typeof handler,'function');
    handler({target:{id:formId,querySelector(sel){
      const m=sel.match(/name=([\w-]+)/);
      return m?{value:values[m[1]]}:null;
    }},preventDefault(){}});
  };
  const start=()=>{mount();window.InspectPhoneFeature.onUnlock();action('grant');action('all');action('start');};
  return {window,store,key,read,appBody,appTitle,start,mount,action,app,detail,submit,
    failWrites(x){quota=x;},setApiResponse(fn){window.PhoneStorage.getApiConfig=()=>({apiKey:'test-only'});window.PhoneAPI={completeJSON:fn};},handlers};
}

test('备忘录可以新建，保存完整文字和角色可见事件；下一次正常AI回复可引用',()=>{
  const u=setup();u.start();u.app('notes');
  u.action('newNote');
  assert.match(u.appBody.innerHTML,/inspectNoteEditForm/);
  u.submit('inspectNoteEditForm',{title:'周五的提醒',text:'记得给小林带上那本书。\n我在这里留下了一句话。'});
  const d=u.read(),note=d.sections.notes.notes[0];
  assert.equal(note.title,'周五的提醒');
  assert.match(note.text,/我在这里留下了一句话/);
  assert.equal(note.lastEditedBy,'viewer');
  assert.ok(d.interactions.some(e=>e.type==='note_created'));
  assert.match(u.window.InspectInteractionBridge.buildPrompt(d.roleId,u.window.localStorage),/周五的提醒/);
  assert.match(u.appBody.innerHTML,/聊聊这件事/);
});

test('打开旧日记可以编辑，不修改角色的其他日记，并保留历史版本',()=>{
  const u=setup('edit-role');u.start();u.app('notes');
  const before=u.read();
  const original=before.sections.notes.notes[0].text;
  const second=before.sections.notes.notes[1].text;
  u.detail('note',0);u.action('editNote');
  u.submit('inspectNoteEditForm',{title:'后来的补充',text:original+'\n\n补充：记得早点出门。'});
  const after=u.read();
  assert.match(after.sections.notes.notes[0].text,/补充：记得早点出门/);
  assert.equal(after.sections.notes.notes[1].text,second);
  assert.equal(after.sections.notes.notes[0].editHistory[0].text,original);
  assert.ok(after.interactions.some(e=>e.type==='note_edited'));
});

test('朋友圈评论真的出现在原动态下面，并成为角色聊天的可延展话题',()=>{
  const u=setup('moment-role');u.start();u.app('moments');u.detail('moment',0);
  const before=u.read().sections.moments.moments[0].comments.length;
  u.submit('inspectMomentComment',{text:'照片里这家店在哪里呀？'});
  const d=u.read();
  assert.equal(d.sections.moments.moments[0].comments.length,before+1);
  assert.equal(d.sections.moments.moments[0].comments.at(-1).name,'我');
  assert.match(u.appBody.innerHTML,/照片里这家店在哪里呀/);
  assert.match(u.window.InspectInteractionBridge.buildPrompt(d.roleId,u.window.localStorage),/照片里这家店在哪里呀/);
  assert.match(u.appBody.innerHTML,/inspectMomentComment/);
});

test('储存失败时新备忘录和互动事件都完整回滚，不显示虚假已保存',()=>{
  const u=setup('quota-role');u.start();u.app('notes');u.action('newNote');
  const before=JSON.stringify(u.read().sections.notes.notes);
  u.failWrites(true);
  u.submit('inspectNoteEditForm',{title:'保存不成功',text:'这段文字不能被当作保存成功'});
  u.failWrites(false);
  const d=u.read();
  assert.equal(JSON.stringify(d.sections.notes.notes),before);
  assert.ok(!d.interactions?.some(e=>e.text.includes('保存不成功')));
  assert.doesNotMatch(u.appBody.innerHTML,/已保存。角色下次查看/);
});

test('同账号不同角色的手机互动不能泄露到另一位角色的 AI 上下文',()=>{
  const store=new Map(),a=setup('role-A',store),b=setup('role-B',store);
  a.start();a.app('notes');a.action('newNote');
  a.submit('inspectNoteEditForm',{title:'只有 A 的信息',text:'只告诉 A 的日记内容'});
  b.start();b.app('notes');
  assert.match(a.window.InspectInteractionBridge.buildPrompt('role-A',a.window.localStorage),/只有 A 的信息/);
  assert.equal(b.window.InspectInteractionBridge.buildPrompt('role-B',b.window.localStorage),'');
});

test('刷新前保留用户笔记和朋友圈评论，不得变成假 AI 回复',()=>{
  const u=setup('regeneration-role');u.start();u.app('notes');u.action('newNote');
  u.submit('inspectNoteEditForm',{title:'不能被删掉',text:'用户亲手写的内容'});
  const d=u.read();
  const bridge=u.window.InspectInteractionBridge;
  assert.ok(d.interactions.every(e=>e.origin==='user_on_fictional_phone'));
  assert.doesNotMatch(JSON.stringify(d.sections.chat),/不能被删掉/);
  assert.match(bridge.buildPrompt('regeneration-role',u.window.localStorage),/不能被删掉/);
  assert.match(featureSource,/preserveUserEntries\(id,oldSection,result\.data\)/);
  assert.match(featureSource,/origin==='user_on_fictional_phone'/);
});

test('真实聊天页面载入互动桥接，并只注入当前角色的提示词',()=>{
  assert.match(phoneSource,/inspect_interaction_bridge\.js\?v=20261112v2/);
  assert.match(chatSource,/inspect_interaction_bridge\.js\?v=20261112v2/);
  assert.match(chatSource,/if \(!isGroupChat && !silent && !contextOnly && !isRegen/);
  assert.match(chatSource,/InspectInteractionBridge\.buildPromptPacket/);
  assert.match(chatSource,/String\(currentRoleId \|\| currentCharacter\.id \|\| ''\)/);
});

test('所有 App 列表不添加重复箭头；含 HTML 字符的用户留言只渲染转义文本',()=>{
  const u=setup('escape-role');u.start();u.app('notes');u.action('newNote');
  u.submit('inspectNoteEditForm',{title:'标记',text:'<img src=x onerror=alert(1)> 只是一段文字'});
  assert.match(u.appBody.innerHTML,/&lt;img/);
  assert.doesNotMatch(u.appBody.innerHTML,/<img src=x onerror=/);
  assert.match(cssSource,/\.nv-tap \.nv-chevron,\.nv-chevron\{display:none!important\}/);
  assert.doesNotMatch(nativeSource,/<span class="nv-chevron" aria-hidden="true">/);
});


test('AI刷新不能删除用户亲手写的备忘录和朋友圈评论',async()=>{
  const u=setup('refresh-keep-role');u.start();u.app('notes');u.action('newNote');
  u.submit('inspectNoteEditForm',{title:'我写的不能丢',text:'这一条是访客亲自写给角色的。'});
  const before=u.read(),generatedNotes=JSON.parse(JSON.stringify(before.sections.notes));
  generatedNotes.notes=generatedNotes.notes.filter(x=>x.lastEditedBy!=='viewer');
  generatedNotes.notes[0].title='AI 新剧情更新';
  u.setApiResponse(async()=>({ok:true,data:generatedNotes}));
  u.action('refresh');
  for(let i=0;i<7;i++)await Promise.resolve();
  assert.ok(u.read().sections.notes.notes.some(n=>n.title==='我写的不能丢'));
  assert.ok(u.read().sections.notes.notes.some(n=>n.title==='AI 新剧情更新'));
  u.app('moments');u.detail('moment',0);
  u.submit('inspectMomentComment',{text:'这句话是我写给角色的评论'});
  const next=u.read(),generated=JSON.parse(JSON.stringify(next.sections.moments));
  generated.moments[0].comments=generated.moments[0].comments.filter(x=>x.origin!=='user_on_fictional_phone');
  generated.moments[0].text+='（新内容）';
  u.setApiResponse(async()=>({ok:true,data:generated}));
  u.action('refresh');
  for(let i=0;i<7;i++)await Promise.resolve();
  const saved=u.read().sections.moments.moments;
  assert.ok(saved.some(m=>m.comments.some(c=>c.text==='这句话是我写给角色的评论')));
  assert.ok(saved.some(m=>m.text.includes('新内容')));
});


test('多次离线刷新仍保存亲手编辑的日记，不把它悄悄扔出历史',()=>{
  const u=setup('diary-archive');u.start();u.app('notes');u.detail('note',0);u.action('editNote');
  u.submit('inspectNoteEditForm',{title:'这篇我亲手编辑过',text:'即使反复刷新也不允许消失的完整日记。'});
  for(let i=0;i<24;i++)u.action('refresh');
  const d=u.read(),all=d.sections.notes.notes.concat(d.sections.notes.archive||[]);
  assert.equal(all.filter(n=>n.title==='这篇我亲手编辑过').length,1);
  assert.ok(all.some(n=>n.text.includes('不允许消失的完整日记')));
});

test('聊天已提供给AI的状态不会被旧查手机标签页后续保存冲掉',()=>{
  const u=setup('same-role-tabs');u.start();u.app('notes');u.action('newNote');
  u.submit('inspectNoteEditForm',{title:'提醒只提一次',text:'角色聊天自然提起即可，不能每轮重复。'});
  const bridge=u.window.InspectInteractionBridge;
  const pending=bridge.buildPromptPacket('same-role-tabs',u.window.localStorage);
  assert.equal(pending.eventIds.length,1);
  assert.equal(bridge.markOffered('same-role-tabs',pending.eventIds,u.window.localStorage),true);
  // The inspect page's in-memory data is now stale; edit the note and save.
  u.action('editNote');
  u.submit('inspectNoteEditForm',{title:'提醒只提一次',text:'更新后也不应该重复提醒。'});
  const saved=u.read(),offered=saved.interactions.find(e=>e.id===pending.eventIds[0]);
  assert.ok(offered.offeredToAIAt>0);
  const latest=bridge.buildPromptPacket('same-role-tabs',u.window.localStorage);
  assert.equal(latest.eventIds.length,1,'仅新编辑产生的线索应该待提供');
  assert.doesNotMatch(latest.text,/角色聊天自然提起即可/);
  assert.match(latest.text,/更新后也不应该重复提醒/);
});


test('日记详情点击聊聊这件事，保存明确话题并跳入同角色正式聊天',()=>{
  const u=setup('focus-note-role');u.start();u.app('notes');u.detail('note',0);
  const original=u.read().sections.notes.notes[0];
  u.action('chatAboutNote');
  assert.equal(u.window.navigatedTo,'../chat/chat/chat-detail.html?id=focus-note-role');
  const d=u.read();
  assert.equal(d.pendingChatFocus.kind,'note');
  assert.equal(d.pendingChatFocus.title,original.title);
  assert.equal(d.pendingChatFocus.text,original.text);
  assert.equal(u.window.InspectInteractionBridge.buildPromptPacket('focus-note-role',u.window.localStorage).mode,'focused');
});

test('朋友圈详情点击去聊天只聚焦当前一条动态，不改变用户已发评论',()=>{
  const u=setup('focus-moment-role');u.start();u.app('moments');u.detail('moment',0);
  const before=u.read(),count=before.sections.moments.moments[0].comments.length;
  u.action('chatAboutMoment');
  assert.equal(u.window.navigatedTo,'../chat/chat/chat-detail.html?id=focus-moment-role');
  const after=u.read();
  assert.equal(after.pendingChatFocus.kind,'moment');
  assert.equal(after.pendingChatFocus.text,before.sections.moments.moments[0].text);
  assert.equal(after.sections.moments.moments[0].comments.length,count);
});

test('手机存储失败时指定话题不跳转、不显示虚假成功',()=>{
  const u=setup('focus-save-failed');u.start();u.app('notes');u.detail('note',0);
  u.failWrites(true);
  u.action('chatAboutNote');
  u.failWrites(false);
  assert.equal(u.window.navigatedTo,undefined);
  assert.equal(u.read().pendingChatFocus,undefined);
  assert.match(u.appBody.innerHTML,/存储空间不足/);
});

test('独立 Cloudflare 预览不能伪装成已联通正式聊天',()=>{
  const u=setup('preview-focus');u.start();u.app('notes');u.detail('note',0);
  u.window.location.hostname='maomao-inspect-native.miamor520000.workers.dev';
  u.action('chatAboutNote');
  assert.equal(u.window.navigatedTo,undefined);
  assert.equal(u.read().pendingChatFocus,undefined);
  assert.match(u.appBody.innerHTML,/不在同一个域名/);
});

test('旧手机标签页不把聊天已经消费的话题重新变成待发送',()=>{
  const u=setup('focus-consumed-saved');u.start();u.app('notes');u.detail('note',0);
  u.action('chatAboutNote');
  const bridge=u.window.InspectInteractionBridge;
  const packet=bridge.buildPromptPacket('focus-consumed-saved',u.window.localStorage);
  assert.equal(bridge.markOffered('focus-consumed-saved',[],u.window.localStorage,Date.now(),packet.focusId),true);
  // Inspect feature still holds a stale copy. Save an unrelated phone action.
  u.action('editNote');u.submit('inspectNoteEditForm',{title:'又修改的内容',text:'新的正文内容'});
  const after=u.read();
  assert.ok(after.pendingChatFocus.usedAt>0);
  assert.equal(bridge.buildPromptPacket('focus-consumed-saved',u.window.localStorage).mode,'fresh');
});
