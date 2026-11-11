import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const code=read('forum/forum-world-events.js');
const home=read('forum/forum.html');
const detail=read('forum/forum-detail.html');
const settings=read('forum/forum-settings.html');
const sw=read('sw.js');
const env={window:{}};
runInNewContext(code,env);
const W=env.window.ForumWorldEvents;
const theme=id=>({id,name:id,roleTopics:['社团日常','课业求助','宿舍见闻'],world:'宿舍和社团有自己的时间线'});

test('four worlds have distinct recurring arcs, vocabulary, and cast; custom uses own topics',()=>{
  assert.deepEqual(Object.keys(W.worlds),['reality','academy','xiuxian','future']);
  const ids=[];
  for(const id of Object.keys(W.worlds)){
    const w=W.getWorld(theme(id));
    assert.equal(w.arcs.length,3);
    assert.equal(new Set(w.arcs.map(x=>x.id)).size,3);
    assert.ok(w.arcs.every(x=>x.topic&&x.cast&&x.steps&&x.outline));
    ids.push(...w.arcs.map(x=>x.id));
  }
  assert.equal(new Set(ids).size,12);
  const custom=W.getWorld(theme('custom_nightlibrary'));
  assert.deepEqual(Array.from(custom.arcs,a=>a.topic),theme('custom_x').roleTopics);
  assert.ok(custom.arcs.every(a=>a.outline.includes('世界书')));
  assert.equal(W.getWorld(theme('bagua')),null);
});

test('future refresh picks least used arc without mutating historic posts',()=>{
  const t=theme('academy'),first=W.plans(t,[],2);
  assert.equal(first.length,2);
  assert.notEqual(first[0].id,first[1].id);
  const posts=[{id:'old',worldEvent:{schema:1,themeId:'academy',arcId:first[0].id}},
    {id:'other-theme',worldEvent:{schema:1,themeId:'xiuxian',arcId:first[1].id}}];
  const original=JSON.stringify(posts);
  const next=W.plans(t,posts,2);
  assert.equal(next[0].id,first[1].id);
  assert.equal(next[1].id,W.getWorld(t).arcs[2].id);
  assert.equal(JSON.stringify(posts),original);
  assert.equal(W.plans(theme('bagua'),posts,2).length,0);
});

test('new event carries theme, finite chapters and original facts separately',()=>{
  const t=theme('future'),plan=W.plans(t,[],2)[0];
  const item={threadCast:'末班工人、站务员',threadFacts:['晚班九点换车','公交站张贴临时通知']};
  const story=W.fromOpening(item,plan,t);
  assert.equal(story.themeId,'future');
  assert.equal(story.arcId,plan.id);
  assert.equal(story.chapter,0);
  assert.equal(story.maxChapters,3);
  assert.equal(story.finished,false);
  assert.equal(story.facts.length,2);
  assert.ok(W.isEvent({worldEvent:story}));
  assert.equal(item.threadFacts.length,2);
  assert.equal(W.isEvent({worldEvent:{themeId:'bagua',arcId:'foo',schema:1}}),false);
});

test('saved author updates recover chapter cursor and cannot exceed bounded limit',()=>{
  const story=W.fromOpening({threadFacts:['一个事实'],threadCast:'角色A'},W.plans(theme('academy'),[],1)[0],theme('academy'));
  const post={worldEvent:story,comments:[{source:'forum-ai',worldChapter:5},
    {source:'forum-world-author',worldChapter:2,text:'第二次真实更新'}]};
  const current=W.progress(post);
  assert.equal(current.chapter,2);
  assert.equal(current.finished,false);
  assert.equal(story.chapter,0);
  post.comments.push({source:'forum-world-author',worldChapter:3});
  assert.equal(W.progress(post).finished,true);
  assert.equal(W.progress({worldEvent:{chapter:999,maxChapters:999},comments:[]}).chapter,5);
});

test('reject duplicate chapters and missing facts; preserve useful new developments',()=>{
  const previous='这个晚上大家挤在会议室里，活动队长说排练教室又被别人借走了，于是有人建议拿着通知去问管理室。';
  const update='第二天清晨，社团的几个人一起去了教室管理处，先看了借用登记，再发现有人把时间写错了半小时。没有吵架，队长和管理人重新核对了表格。后来他们又去找了隔壁声乐社的同学，商量把最后一轮排练挪到午休。';
  assert.equal(W.checkUpdate({update:previous,newFacts:['新事实A','新事实B']},[previous],[]).ok,false);
  assert.equal(W.checkUpdate({update:'太短',newFacts:['事实甲','事实乙']},[],[]).ok,false);
  assert.equal(W.checkUpdate({update,newFacts:['管理处核对登记']},[],[]).ok,false);
  const valid=W.checkUpdate({update,newFacts:['排练室登记误差半小时','午休借到隔壁活动教室']},[previous],[]);
  assert.equal(valid.ok,true);
  assert.equal(valid.newFacts.length,2);
});

test('only explicit requests advance the storyline; denial or casual discussion does not',()=>{
  for(const text of ['后来呢','还有新进展吗','有结果吗','继续说','进度怎么样'])assert.equal(W.wantsUpdate(text),true,text);
  for(const text of ['我觉得这个方案好','没关系，慢慢来','不要继续说了','别剧透','先别更新'])assert.equal(W.wantsUpdate(text),false,text);
});

test('per-theme residents keep IDs but use recognizable different voices',()=>{
  const base=[{id:'resident_latewind',name:'晚风',style:'通用'},{id:'resident_orange',name:'橘子海',style:'通用'}];
  const a=W.residents(theme('academy'),base),b=W.residents(theme('xiuxian'),base),c=W.residents(theme('future'),base);
  assert.equal(a[0].id,base[0].id);
  assert.notEqual(a[0].name,b[0].name);
  assert.notEqual(b[0].name,c[0].name);
  assert.equal(W.residents(theme('custom_demo'),base)[0].name,'晚风');
  assert.equal(base[0].name,'晚风');
});

test('existing mobile forum actually uses world arcs, selected settings and role-post isolation',()=>{
  assert.match(home,/src="forum-world-events\.js\?v=20261111v1"/);
  assert.match(detail,/src="forum-world-events\.js\?v=20261111v1"/);
  assert.match(home,/ForumWorldEvents\.plans\(theme,posts,2\)/);
  assert.match(home,/ForumWorldEvents\.fromOpening\(item,eventPlan,theme\)/);
  assert.match(home,/usedEventPlans\.size!==eventPlans\.length/);
  assert.match(home,/function visibleInCurrentTheme\(p\)/);
  assert.match(home,/const postId='role_'\+activeTheme\.id\+'_'\+roleId/);
  assert.match(home,/postId:String\(post\.id\)/);
  assert.match(home,/themeId:getForumTheme\(\)\.id/);
  assert.match(detail,/id="forumWorldContinue"/);
  assert.match(detail,/async function generateForumWorldContinuation\(target,readerText\)/);
  assert.match(detail,/post\.worldEvent=previousStory/);
  assert.match(detail,/source:'forum-world-author'/);
  assert.match(detail,/ForumWorldEvents\.checkUpdate\(/);
  assert.match(detail,/readForumConfig\(\)\.worldAutoContinue!==false/);
  assert.match(settings,/id="worldAutoContinue"/);
  assert.match(settings,/cfg\.worldAutoContinue/);
  assert.match(sw,/forum\/forum-world-events\.js\?v=20261111v1/);
  assert.match(sw,/phone-app-pwa-v204/);
});

test('all modified inlined code parses for mobile browser execution',()=>{
  for(const src of [home,detail,settings]){
    const match=src.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i);
    assert.ok(match,'inline script must be present');
    assert.doesNotThrow(()=>new Function(match[1]));
  }
  assert.doesNotThrow(()=>new Function(code));
});


test('AI refresh publishes two complete campus event openings and preserves old-theme posts',async()=>{
  const source=home.slice(home.indexOf('async function refreshFeed(){'),
    home.indexOf('\n}\n\n// 自动为角色生成',home.indexOf('async function refreshFeed(){'))+2);
  const current={id:'academy',name:'校园',roleTopics:['社团日常','宿舍见闻','课业求助']};
  const selected=Array.from(W.plans(current,[],2));
  const old={id:'old-city',themeId:'reality',title:'原来的城市帖',body:'那间小店',comments:[],created:1};
  let writes=0,images=0;
  const fakePosts=selected.map((plan,i)=>({
    arcId:plan.id,threadCast:'社团负责人、借场地的学生',threadFacts:['十点发现排练教室撞期','午后讨论了新排练方案'],
    residentId:i?'resident_orange':'resident_latewind',
    topic:plan.topic,title:i?'宿舍讨论室临时借给社团后大家怎么排期':'社团活动和彩排时间撞在一起怎么办',
    body:'昨天晚上活动负责人来到小会议室，把每个人的排练时间重新写在了纸上。有人说上午的课不能改，有人说下午可以提前到场。负责借教室的同学跑去问值班室，另一位同学把其他社团的时间也列了出来。大家终于意识到问题不只在教室，还在各组的课表。'+String(i),
    comments:[{residentId:'resident_orange',text:'这个时间是学校统一安排的吗'}]
  }));
  const ctx={window:{PhoneAPI:{completeJSON:async()=>({ok:true,data:{posts:fakePosts,activity:[]}})},
    PhoneStorage:{getApiConfig:()=>({apiKey:'dummy'})},ForumWorldEvents:W},
    PhoneAPI:{completeJSON:async()=>({ok:true,data:{posts:fakePosts,activity:[]}})},
    PhoneStorage:{getApiConfig:()=>({apiKey:'dummy'})},
    ForumWorldEvents:W,forumRefreshBusy:false,posts:[old],getForumTheme:()=>current,
    visibleInCurrentTheme:p=>!p.themeId||p.themeId===current.id,forumWorldbook:()=>'', 
    FORUM_RESIDENTS:[{id:'resident_latewind',name:'晚风',style:'细心'},
      {id:'resident_orange',name:'小唐',style:'爽快'}],
    forumResident:(id)=>({id:id||'resident_orange',name:id||'小唐'}),
    forumMakeAIComment:item=>({text:item.text,name:'网友',source:'forum-ai'}),
    save:()=>{writes++;return true;},render:()=>{images++;},scroll:{scrollTop:50},
    toast:()=>{},console:{warn:()=>{}},Date,Math,Set,JSON};
  const api=runInNewContext(source+'\n({refreshFeed,getPosts:()=>posts})',ctx);
  assert.equal(await api.refreshFeed(),true);
  const resulting=api.getPosts();
  assert.equal(resulting.length,3);
  assert.equal(resulting.filter(p=>p.worldEvent).length,2);
  assert.ok(resulting.every(p=>p.themeId===current.id||p.id==='old-city'));
  assert.equal(resulting.find(p=>p.id==='old-city').title,'原来的城市帖');
  assert.equal(writes,1);
  assert.equal(images,1);

  // A partial batch must not replace the working feed or lose its persisted arcs.
  const before=JSON.stringify(api.getPosts());
  fakePosts[1].threadFacts=['不足'];
  assert.equal(await api.refreshFeed(),false);
  assert.equal(JSON.stringify(api.getPosts()),before);
  assert.equal(writes,1);
});

test('author updates persist sequential chapters; failure rolls back original fiction',async()=>{
  const start=detail.indexOf('  // Theme-specific fictional events progress');
  const end=detail.indexOf('  async function generateRepliesToUserComment',start);
  assert.ok(start>=0&&end>start);
  const source=detail.slice(start,end);
  const themeValue={id:'academy',name:'校园'};
  const makePost=()=>({
    id:'story-1',name:'图书馆靠窗',avatar:'图',residentId:'resident_latewind',
    themeId:'academy',title:'借教室出现了分歧',
    body:'原帖开篇：负责排练的同学发现教室被重复借用，决定先问清原委。',
    comments:[],
    worldEvent:W.fromOpening({threadCast:'社长与同学',threadFacts:['上午预约教室','时间表出错']},W.plans(themeValue,[],1)[0],themeValue)
  });
  let writes=0,request=0,persist=true;
  const post=makePost(),status={textContent:''};
  const ctx={window:{ForumWorldEvents:W},ForumWorldEvents:W,post,
    worldReplyBusy:false,worldPageHidden:false,
    document:{getElementById:()=>status,querySelectorAll:()=>[]},
    forumAIJSON:async()=>{
      request++;
      const newText='楼主这次又回到了活动楼，先向值班同学核对了预约表，发现大家看到的并不是同一份时间。负责排练的组长当场把自己的登记截图给了对方，几名社员又去找了参加活动的人确认。那天中午他们终于商量出另一种安排，也知道还有一些细节需要第二天说清。第'+request+'次更新。';
      return {ok:true,data:{update:newText.repeat(2),
        newFacts:['第'+request+'次发现了不同预约日期','第'+request+'次重新征求了社员意见']}};
    },
    saveNow:()=>{writes++;return persist;},renderPost:()=>{},renderComments:()=>{},
    getForumTheme:()=>themeValue,postTitle:()=>post.title,postBody:()=>post.body,
    toast:()=>{},console:{warn:()=>{}},Date,JSON};
  const api=runInNewContext(source+'\n({continueForumWorld,generateForumWorldContinuation})',ctx);
  assert.equal(await api.continueForumWorld(),true);
  assert.equal(post.comments.length,1);
  assert.equal(post.comments[0].source,'forum-world-author');
  assert.equal(post.worldEvent.chapter,1);
  assert.equal(post.worldEvent.finished,false);
  persist=false;
  const before=JSON.stringify(post);
  assert.equal(await api.continueForumWorld(),false);
  assert.equal(JSON.stringify(post),before,'failed persistence must not change post or chapter');
  persist=true;
  assert.equal(await api.continueForumWorld(),true);
  assert.equal(await api.continueForumWorld(),true);
  assert.equal(post.worldEvent.chapter,3);
  assert.equal(post.worldEvent.finished,true);
  assert.equal(post.comments.filter(c=>c.source==='forum-world-author').length,3);
  assert.equal(await api.continueForumWorld(),false);
  assert.equal(writes,4,'finished stories do not make another API write');
});
