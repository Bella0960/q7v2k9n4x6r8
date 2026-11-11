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
