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
const personaSource=readFileSync(new URL('../inspect-phone/inspect-persona-web.js',import.meta.url),'utf8');

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
  vm.runInNewContext(personaSource,context);
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
  assert.match(phoneSource,/inspect_interaction_bridge\.js\?v=20261112v4/);
  assert.match(chatSource,/inspect_interaction_bridge\.js\?v=20261112v4/);
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


test('朋友圈去聊天精确带上本条动态最近两条本人评论，不吞掉更早或其他新评论',()=>{
  const u=setup('focus-comment-detail');u.start();u.app('moments');u.detail('moment',0);
  for(const text of ['第一条旧评论','第二条最近评论','第三条最新评论']){
    u.submit('inspectMomentComment',{text});
  }
  const before=u.read(),comments=before.sections.moments.moments[0].comments
    .filter(x=>x.origin==='user_on_fictional_phone');
  assert.equal(comments.length,3);
  assert.ok(comments.every(c=>c.interactionId));
  u.action('chatAboutMoment');
  const focus=u.read().pendingChatFocus;
  assert.equal(focus.kind,'moment');
  assert.match(focus.text,/第二条最近评论/);
  assert.match(focus.text,/第三条最新评论/);
  assert.doesNotMatch(focus.text,/第一条旧评论/);
  assert.equal(focus.includedEventIds.length,2);
  const bridge=u.window.InspectInteractionBridge;
  const packet=bridge.buildPromptPacket('focus-comment-detail',u.window.localStorage);
  assert.equal(packet.mode,'focused');
  assert.match(packet.text,/第三条最新评论/);
  assert.equal(bridge.markOffered('focus-comment-detail',[],u.window.localStorage,Date.now(),packet.focusId),true);
  const after=u.read(),byId=Object.fromEntries(after.interactions.map(x=>[x.id,x]));
  assert.equal(byId[comments[0].interactionId].offeredToAIAt,undefined);
  assert.ok(byId[comments[1].interactionId].offeredToAIAt>0);
  assert.ok(byId[comments[2].interactionId].offeredToAIAt>0);
  const remaining=bridge.buildPromptPacket('focus-comment-detail',u.window.localStorage);
  assert.equal(remaining.mode,'fresh');
  assert.match(remaining.text,/第一条旧评论/);
  assert.doesNotMatch(remaining.text,/第三条最新评论/);
});


test('论坛首页显示角色人设帖子，「我发的」只显示当前角色的发帖',()=>{
  const u=setup('forum-persona');u.start();u.app('forum');
  const d=u.read();
  assert.ok(d.sections.forum.posts.some(p=>p.authorId==='forum-persona'));
  assert.ok(d.sections.forum.posts.some(p=>/书|阅读/.test(p.title)));
  assert.match(u.appBody.innerHTML,/nv-forum-card/);
  u.action('forumMine');
  assert.match(u.appBody.innerHTML,/我发的/);
  assert.match(u.appBody.innerHTML,/nv-forum-row/);
  u.action('forumAll');
  assert.match(u.appBody.innerHTML,/正在讨论/);
});

test('角色论坛评论和点赞保存后不丢失，也可以准确带进角色聊天',()=>{
  const u=setup('forum-comment');u.start();u.app('forum');u.detail('post',0);
  const original=u.read().sections.forum.posts[0],before=original.comments.length;
  u.submit('inspectForumComment',{text:'我觉得浅色玫瑰也挺不错。'});
  let d=u.read(),post=d.sections.forum.posts[0];
  assert.equal(post.comments.length,before+1);
  assert.equal(post.comments.at(-1).origin,'user_on_fictional_phone');
  assert.ok(d.interactions.some(x=>x.type==='forum_comment'));
  const oldLikes=post.likes;
  u.action('forumLike');
  d=u.read();post=d.sections.forum.posts[0];
  assert.equal(post.likes,oldLikes+1);
  assert.equal(post.liked,true);
  u.action('chatAboutForum');
  d=u.read();
  assert.equal(d.pendingChatFocus.kind,'forum');
  assert.match(d.pendingChatFocus.text,/浅色玫瑰/);
  assert.equal(d.pendingChatFocus.includedEventIds.length,1);
  assert.ok(u.window.navigatedTo.includes('forum-comment'));
  const bridge=u.window.InspectInteractionBridge;
  const packet=bridge.buildPromptPacket('forum-comment',u.window.localStorage);
  assert.equal(packet.mode,'focused');
  assert.equal(bridge.markOffered('forum-comment',[],u.window.localStorage,Date.now(),packet.focusId),true);
  const saved=u.read().interactions.find(e=>e.type==='forum_comment');
  assert.ok(saved.offeredToAIAt>0);
});

test('浏览器能真实搜索、阅读、收藏，并分别留下搜索史和访问史',()=>{
  const u=setup('browser-real');u.start();u.app('browser');
  assert.match(u.appBody.innerHTML,/inspectBrowserSearch/);
  u.submit('inspectBrowserSearch',{query:'如何给女朋友买鲜花'});
  assert.match(u.appBody.innerHTML,/玫瑰|郁金香/);
  assert.ok(u.read().sections.browser.searchHistory.some(x=>x.query==='如何给女朋友买鲜花'));
  u.detail('browser-result',0);
  assert.match(u.appBody.innerHTML,/nv-browser-article/);
  assert.ok(u.read().sections.browser.pageViews.length>=1);
  u.action('browserBookmark');
  let d=u.read();
  assert.ok(d.sections.browser.bookmarks.some(x=>x.articleId));
  u.action('browserVisits');
  assert.match(u.appBody.innerHTML,/浏览记录/);
  u.action('browserBookmarks');
  assert.match(u.appBody.innerHTML,/书签/);
});

test('API可以通过现有配置为未知查询生成虚构文章，但不能伪装实时网站',async()=>{
  const u=setup('browser-ai');
  u.setApiResponse(async()=>({ok:true,data:{pages:[
    {title:'模拟工具使用完整指南',snippet:'一篇围绕普通日常搜索需求创作的独立参考文章。',
      paragraphs:['这是模型生成的正文段落，用来帮助角色理解自己的搜索需求，不是真实搜索引擎页面。','引用时应明确它是 AI 合成参考，任何商家信息都不是实时数据。']},
    {title:'另一个主题研究笔记',snippet:'对普通用户问题提供不同角度的原创解释文案。',
      paragraphs:['先了解当前具体问题，找出已经确定的事实，再区分无法验证的网上信息。','如果没有实时数据，不应假装收录真实网站或者可以当场向商家下单。']}
  ]}}));
  u.start();u.app('browser');
  u.submit('inspectBrowserSearch',{query:'星际快递怎么包装一颗月亮'});
  for(let i=0;i<12;i++)await Promise.resolve();
  const d=u.read(),pages=d.sections.browser.aiPages||[];
  assert.equal(pages.length,2);
  assert.ok(pages.every(x=>x.domain.includes('非实时')));
  assert.match(u.appBody.innerHTML,/模拟工具使用完整指南/);
  assert.equal(d.sections.browser.searchHistory[0].query,'星际快递怎么包装一颗月亮');
});

test('浏览器存储失败不假成功，搜索和 AI 页面都不污染原记录',()=>{
  const u=setup('browser-quota');u.start();u.app('browser');
  const before=u.read().sections.browser.searchHistory.length;
  u.failWrites(true);
  u.submit('inspectBrowserSearch',{query:'这条搜索不能被保存'});
  u.failWrites(false);
  const d=u.read();
  assert.equal(d.sections.browser.searchHistory.length,before);
  assert.ok(!d.sections.browser.searchHistory.some(x=>x.query==='这条搜索不能被保存'));
});
