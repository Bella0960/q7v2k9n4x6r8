import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path)=>readFileSync(resolve(root,path),'utf8');
const code=read('forum/forum-gossip.js');
const home=read('forum/forum.html');
const detail=read('forum/forum-detail.html');
const settings=read('forum/forum-settings.html');
const browser={window:{}};
runInNewContext(code,browser);
const G=browser.window.ForumGossip;

test('gossip outlines preserve the three selected story concepts',()=>{
  assert.deepEqual(Array.from(G.ideas,x=>x.id),['double_life','unspoken_crush','perfect_couple']);
  assert.ok(G.ideas.every(x=>x.outline&&x.direction));
});

test('each refresh uses three distinct outlines and prioritizes less used ones',()=>{
  const first=Array.from(G.planBatch([],3),x=>x.id);
  assert.equal(new Set(first).size,3);
  const existing=[{gossipStory:{outlineId:'double_life'}},{gossipStory:{outlineId:'double_life'}}];
  const next=Array.from(G.planBatch(existing,3),x=>x.id);
  assert.equal(next[0],'unspoken_crush');
  assert.equal(next[1],'perfect_couple');
  assert.equal(next[2],'double_life');
});

test('opening saves story bible and progressive update state without touching originals',()=>{
  const input={body:'这次想讲讲我身边一对情侣的故事。',storyPremise:'两人因职业安排产生分歧',storyCast:'甲和乙是虚构成年人',storyFacts:['甲准备搬家','乙还不知道']};
  const spec=G.idea('perfect_couple');
  const story=G.storyFromOpening(input,spec,2);
  assert.equal(story.outlineId,'perfect_couple');
  assert.equal(story.chapter,0);
  assert.equal(story.finished,false);
  assert.ok(story.maxChapters>=4);
  assert.equal(story.facts.length,2);
  assert.equal(input.storyFacts.length,2);
});

test('near-verbatim retells are rejected but a genuine new chapter is allowed',()=>{
  const first='她原本一直说自己不考虑离开这座城市，然而去年冬天突然去面试了其他地方的工作，直到月底才告诉朋友。';
  assert.equal(G.isRepeat(first,[first]),true);
  const next='新的一周里，她终于约好和室友面对面谈，还把自己藏在抽屉里的录取邮件拿了出来。他们才知道她早已做了决定。';
  assert.equal(G.isRepeat(next,[first]),false);
});

test('forum AI writes serialized gossip on the existing feed and preserves per-post story fields',()=>{
  assert.match(home,/src="forum-gossip\.js"/);
  assert.match(home,/const gossipMode=theme\.id==='bagua'/);
  assert.match(home,/const usedGossipPlans=new Set\(\)/);
  assert.match(home,/ForumGossip\.storyFromOpening\(item,gossipPlan,i\)/);
  assert.match(home,/ForumGossip\.isRepeat\(body,/);
});

test('comments can trigger the original author to continue and conclude in place',()=>{
  assert.match(detail,/id="gossipContinue"/);
  assert.match(detail,/async function generateGossipAuthorContinuation\(target,readerText\)/);
  assert.match(detail,/await generateGossipAuthorContinuation\(target,text\)/);
  assert.match(detail,/source:'gossip-author'/);
  assert.match(detail,/story\.chapter=nextChapter/);
  assert.match(detail,/story\.finished=ending/);
  assert.match(detail,/if\(!saveNow\(\)\)/);
  assert.match(detail,/ForumGossip\.validateUpdate\(data,/);
});


test('only explicit requests advance a gossip story, ordinary discussion does not',()=>{
  for(const message of ['继续说','继续','然后呢？','我蹲后续','楼主说完吧','后来怎么样','结局呢','接着更','继续生成']){
    assert.equal(G.wantsContinuation(message),true,message);
  }
  for(const message of ['哈哈这也太离谱了','我认识的人也遇到过','这一点我不同意','说法有点片面','']){
    assert.equal(G.wantsContinuation(message),false,message);
  }
});

test('saved author comments recover a stale chapter cursor without rewriting history',()=>{
  const p={gossipStory:{outlineId:'double_life',chapter:1,maxChapters:4,finished:false},
    comments:[{source:'forum-ai',text:'讨论'},{source:'gossip-author',gossipChapter:2,text:'第二章'}]};
  const state=G.progress(p);
  assert.equal(state.chapter,2);
  assert.equal(state.nextChapter,3);
  assert.equal(state.finished,false);
  assert.equal(p.gossipStory.chapter,1);
  p.comments.push({source:'gossip-author',gossipChapter:4});
  assert.equal(G.progress(p).finished,true);
  assert.equal(G.progress(p).nextChapter,4);
});

test('chapter count is bounded and a corrupt cursor cannot generate endless updates',()=>{
  const p={gossipStory:{outlineId:'unspoken_crush',chapter:999,maxChapters:999},comments:[]};
  const state=G.progress(p);
  assert.equal(state.maxChapters,8);
  assert.equal(state.chapter,8);
  assert.equal(state.finished,true);
  const q={gossipStory:{outlineId:'unspoken_crush',chapter:0,maxChapters:'invalid'},comments:[]};
  assert.equal(G.progress(q).maxChapters,4);
});

test('validation rejects repeated or content-free chapters but accepts substantive progress',()=>{
  const old='上周六我们在咖啡馆里碰面，才发现两个人一直说的不是同一件事。大家都以为他们早就商量过搬家的计划，但实际上谁也没有明确解释。';
  const update='周二下午我去了一趟旧公寓，发现她已经把墙上的相框收进了纸箱。她并没有立刻搬走，而是先给对方发了一条长消息，解释这几个月为什么一直犹豫。晚上两个人在小区门口聊了很久，最后决定先各自住一段时间，再一起处理租约。';
  const payload={update,newFacts:['她已经收起相框','两人决定暂时分开住']};
  const result=G.validateUpdate(payload,[old],['此前双方没有讨论过租约']);
  assert.equal(result.ok,true);
  assert.equal(result.newFacts.length,2);
  assert.equal(G.validateUpdate({...payload,update:old},[old],[]).ok,false);
  assert.equal(G.validateUpdate({...payload,newFacts:['她已经收起相框','她已经收起相框']},[old],[]).ok,false);
  assert.equal(G.validateUpdate({...payload,newFacts:['以前就知道的事实','新事实']},[old],['以前就知道的事实']).ok,false);
  assert.equal(G.validateUpdate({...payload,update:'还没完'},[old],[]).ok,false);
});

test('manual continuation and explicit comment continuation share the same safe path',()=>{
  assert.match(detail,/ForumGossip\.progress\(post\)/);
  assert.match(detail,/ForumGossip\.validateUpdate\(data,/);
  assert.match(detail,/ForumGossip\.wantsContinuation\(text\)/);
  assert.match(detail,/readForumConfig\(\)\.gossipAutoContinue!==false/);
  assert.match(detail,/story\.finished=ending;/);
  assert.doesNotMatch(detail,/story\.finished=ending\|\|/);
  assert.match(detail,/post\.gossipStory=previousStory/);
});

test('do not auto-spoil when the reader asks the author to stop',()=>{
  for(const message of ['不要继续说','先别讲了','别剧透','暂停更新','不用再讲','先别说结局']){
    assert.equal(G.wantsContinuation(message),false,message);
  }
});

test('legacy premature finished flag does not hide the missing final chapter',()=>{
  const p={gossipStory:{outlineId:'perfect_couple',chapter:3,maxChapters:4,finished:true},
    comments:[{source:'gossip-author',gossipChapter:3,text:'旧版本提前完结的第三回'}]};
  const progress=G.progress(p);
  assert.equal(progress.chapter,3);
  assert.equal(progress.nextChapter,4);
  assert.equal(progress.finished,false);
});

test('AI comments and user deletions roll back when local persistence fails',()=>{
  assert.match(detail,/post\.comments=previousComments/);
  assert.match(detail,/post\.aiCommentBatch=previousBatch/);
  assert.match(detail,/target\.replies=previousReplies/);
  assert.match(detail,/post\.comments\.splice\(i,0,removed\)/);
  assert.match(detail,/c\.replies\.splice\(j,0,removed\)/);
  assert.match(detail,/if\(!saveNow\(\)\)\{post\.comments\.pop\(\)/);
});

test('auto-continuation setting explains that casual comments keep normal replies',()=>{
  const settings=read('forum/forum-settings.html');
  assert.match(settings,/gossipAutoContinue/);
  assert.match(settings,/普通讨论仍由网友接话/);
  assert.match(detail,/ForumGossip\.wantsContinuation\(text\)/);
});

test('mobile gossip feed shows the real story and readable per-post progress',()=>{
  assert.match(home,/function gossipReadingHint\(p\)/);
  assert.match(home,/虚构连载 · /);
  assert.match(home,/ForumGossip\.progress\(p\)/);
  assert.match(home,/gossip-feed-body/);
  assert.match(home,/featured\.gossipStory\?featured\.title/);
  assert.match(home,/p\.id===featured\.id/);
  assert.match(home,/gossipUpdatedAt/);
});

test('mobile reader can filter for author chapters without changing saved comment indices',()=>{
  assert.match(detail,/id="gossipReaderTools"/);
  assert.match(detail,/id="gossipViewAll"/);
  assert.match(detail,/id="gossipViewAuthor"/);
  assert.match(detail,/aria-pressed/);
  assert.match(detail,/post\.comments\.map\(\(c,i\)=>\(\{c,i\}\)\)\.filter/);
  assert.match(detail,/data-gossip-chapter/);
  assert.match(detail,/function setGossipView\(mode\)/);
  assert.match(detail,/function jumpToGossipLatest\(\)/);
  assert.match(detail,/scrollIntoView/);
  assert.match(detail,/if\(gossipView==='author'\)gossipView='all'/);
  assert.match(detail,/gossip-author-update/);
});

test('explicit finish-to-ending is bounded, cancellable, and retains saved updates',()=>{
  assert.match(detail,/id="gossipFinishAll"/);
  assert.match(detail,/onclick="finishGossipSeries\(\)"/);
  assert.match(detail,/async function finishGossipSeries\(\)/);
  assert.match(detail,/gossipSeriesRunning=true/);
  assert.match(detail,/for\(let i=0;i<8;i\+\+\)/);
  assert.match(detail,/if\(gossipSeriesStopRequested\)break/);
  assert.match(detail,/await generateGossipAuthorContinuation\(null,/);
  assert.match(detail,/if\(!ok\)break/);
  assert.match(detail,/gossipSeriesStopRequested=true/);
  assert.match(detail,/addEventListener\('pagehide'/);
  assert.match(detail,/addEventListener\('visibilitychange'/);
  assert.match(detail,/if\(!target&&!gossipSeriesRunning\)jumpToGossipLatest\(\)/);
  assert.match(detail,/每更保存一次/);
});

test('each gossip story tracks reading locally without rewriting chapters or other posts',()=>{
  const saved=new Map();
  const storage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>{saved.set(key,value)}};
  const makePost=id=>({id,gossipStory:{outlineId:'double_life',chapter:2,maxChapters:4},
    comments:[{source:'gossip-author',gossipChapter:1,text:'第一更'},
      {source:'forum-ai',text:'有人在讨论'},
      {source:'gossip-author',gossipChapter:2,text:'第二更'}]});
  const a=makePost('fiction-a'),b=makePost('fiction-b');
  assert.equal(G.unreadCount(a,storage),2);
  assert.equal(G.nextUnreadChapter(a,storage),1);
  assert.equal(G.markReadChapter(a,1,storage),true);
  assert.equal(G.readChapter(a,storage),1);
  assert.equal(G.unreadCount(a,storage),1);
  assert.equal(G.nextUnreadChapter(a,storage),2);
  assert.equal(G.unreadCount(b,storage),2);
  assert.equal(G.markReadChapter(a,2,storage),true);
  assert.equal(G.readChapter(a,storage),2);
  assert.equal(G.markReadChapter(a,1,storage),true);
  assert.equal(G.readChapter(a,storage),2);
  assert.equal(G.nextUnreadChapter(a,storage),0);
  assert.equal(a.gossipStory.chapter,2);
  assert.equal(a.comments.length,3);
});

test('invalid or unpersisted chapters cannot be marked read and storage failure is safe',()=>{
  const p={id:'fiction-c',gossipStory:{outlineId:'unspoken_crush',chapter:3,maxChapters:4},
    comments:[{source:'gossip-author',gossipChapter:1}]};
  const storage={getItem:()=>null,setItem:()=>{}};
  assert.equal(G.markReadChapter(p,0,storage),false);
  assert.equal(G.markReadChapter(p,2,storage),false);
  assert.equal(G.markReadChapter(p,3,storage),false);
  assert.equal(G.markReadChapter(p,4,storage),false);
  assert.equal(G.markReadChapter(p,1,storage),true);
  const blocked={getItem:()=>{throw Error('unavailable')},setItem:()=>{throw Error('full')}};
  assert.equal(G.readChapter(p,blocked),0);
  assert.equal(G.markReadChapter(p,1,blocked),false);
  assert.equal(G.unreadCount({id:'other',comments:[],gossipStory:{outlineId:'unknown'}},blocked),0);
});

test('mobile feed and detail expose unread progress and the next unread chapter',()=>{
  assert.match(home,/ForumGossip\.unreadCount\(p,window\.localStorage\)/);
  assert.match(home,/gossip-feed-unread/);
  assert.match(detail,/id="gossipResume"/);
  assert.match(detail,/function resumeGossipReading\(\)/);
  assert.match(detail,/ForumGossip\.nextUnreadChapter\(post,gossipLocalStore\(\)\)/);
  assert.match(detail,/data-gossip-read-chapter/);
  assert.match(detail,/new IntersectionObserver\(/);
  assert.match(detail,/function markGossipRead\(chapter\)/);
  assert.match(detail,/data-gossip-mark-read/);
  assert.match(detail,/function syncGossipReading\(\)/);
  assert.match(detail,/if\(gossipReadObserver\)\{gossipReadObserver\.disconnect\(\)/);
});

test('forum detail and feed do not re-inject obsolete generic seeded posts',()=>{
  assert.match(home,/function getSeededPosts\(themeOverride\)\{\s*return \[\];\s*\}/);
  assert.match(detail,/function getSeededPosts\(themeOverride\)\{return \[\]\}/);
  assert.doesNotMatch(detail,/const seeded=\[/);
  assert.match(detail,/const seedPosts = getSeededPosts\(\)/);
});

test('mobile back navigation reloads persisted chapters and a failed refresh leaves original data alone',()=>{
  assert.match(home,/addEventListener\('pageshow',function\(event\)/);
  assert.match(home,/if\(!event\.persisted\)return/);
  assert.match(home,/posts=loadPosts\(\)/);
  assert.match(home,/render\(\);\s*scroll\.scrollTop=y/);
  assert.match(home,/fresh\.length!==gossipPlans\.length/);
  assert.match(home,/const before=posts;/);
  assert.match(home,/posts=fresh\.concat\(posts\.map\(p=>\(\{\.\.\.p,comments:/);
  assert.match(home,/if\(!save\(\)\)\{posts=before;return false\}/);
});


test('forum detail verifies persistence even when localStorage silently ignores the write',()=>{
  const start=detail.indexOf('  function saveNow() {');
  const end=detail.indexOf('  function toast(msg)',start);
  assert.ok(start>=0&&end>start,'forum saveNow must exist');
  const fn=detail.slice(start,end);
  const create=(storage,posts=[{id:'fiction-1',comments:[]}])=>{
    const ctx={post:{id:'fiction-1',comments:[{id:'new-comment',text:'这次新增的留言'}]},
      localStorage:storage,loadPosts:()=>posts,toast:()=>{},console};
    runInNewContext(fn+';this.writePost=saveNow;',ctx);
    return ctx.writePost;
  };
  let disk=JSON.stringify([{id:'fiction-1',comments:[]}]);
  const muted={getItem:()=>disk,setItem:()=>{}};
  assert.equal(create(muted)(),false,'write ignored without throwing must not report success');
  const store={getItem:()=>disk,setItem:(_key,text)=>{disk=text}};
  assert.equal(create(store)(),true);
  assert.equal(JSON.parse(disk)[0].comments[0].text,'这次新增的留言');
  const missing=create(store,[{id:'different-post'}]);
  assert.equal(missing(),false,'missing post cannot silently claim saved');
});

test('forum likes roll back visual changes when storage cannot persist',()=>{
  const section=detail.slice(detail.indexOf('  function likeComment(i) {'),detail.indexOf('  let replyToIdx',detail.indexOf('  function likeComment(i) {')));
  const toggle=detail.slice(detail.indexOf('  function toggleLike() {'),detail.indexOf('  // Serialized gossip:',detail.indexOf('  function toggleLike() {')));
  assert.match(section,/if \(!saveNow\(\)\) \{ c\.liked = wasLiked; c\.likes = oldLikes; \}/);
  assert.match(section,/if \(!saveNow\(\)\) \{ r\.liked = wasLiked; r\.likes = oldLikes; \}/);
  assert.match(toggle,/if \(!saveNow\(\)\) \{ post\.liked = wasLiked; post\.likes = oldLikes; \}/);
  const data={liked:false,likes:0,comments:[{liked:false,likes:0,replies:[{liked:true,likes:1}]}]};
  let renders=0;
  const ctx={post:data,saveNow:()=>false,renderComments:()=>{renders++},renderPost:()=>{renders++}};
  runInNewContext(section+toggle+';this.likeComment=likeComment;this.likeReply=likeReply;this.toggleLike=toggleLike;',ctx);
  ctx.likeComment(0);
  assert.equal(data.comments[0].liked,false);
  assert.equal(data.comments[0].likes,0);
  ctx.likeReply(0,0);
  assert.equal(data.comments[0].replies[0].liked,true);
  assert.equal(data.comments[0].replies[0].likes,1);
  ctx.toggleLike();
  assert.equal(data.liked,false);
  assert.equal(data.likes,0);
  assert.equal(renders,3);
});

test('forum settings cannot navigate or change selected theme after unverified writes',()=>{
  assert.match(settings,/localStorage\.getItem\('forum_config'\)!==raw/);
  assert.match(settings,/theme=previous/);
  assert.match(settings,/customThemes=nextThemes/);
  assert.match(settings,/保存失败，设置尚未写入本机/);
  assert.match(settings,/role="status" aria-live="polite"/);
  const scripts=[...settings.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  for(const [,script] of scripts) assert.doesNotThrow(()=>new Function(script));
});


test('failed deletion and follow writes cannot falsely report success or discard corrupt follows',()=>{
  const start=detail.indexOf('  function deletePost() {');
  const end=detail.indexOf('  async function aiReply()',start);
  assert.ok(start>=0&&end>start);
  const source=detail.slice(start,end);
  const saved=[{id:'post-1',body:'值得保留的原帖'},{id:'post-2',body:'第二篇'}];
  let disk=JSON.stringify(saved),follows='["阿诺"]',ignore=true,renders=0;
  const alerts=[],toasts=[];
  const storage={
    getItem(key){return key==='forum_posts'?disk:follows;},
    setItem(key,value){
      if(ignore)return;
      if(key==='forum_posts')disk=value;else follows=value;
    }
  };
  const context={localStorage:storage,post:{id:'post-1'},
    window:{location:{href:'forum-detail.html'}},confirm:()=>true,
    alert:x=>alerts.push(String(x)),toast:x=>toasts.push(String(x)),
    renderComments:()=>renders++,console};
  runInNewContext(source+';this.deletePost=deletePost;this.toggleFollow=toggleFollow;this.isFollowing=isFollowing;',context);
  context.deletePost();
  assert.equal(JSON.parse(disk).length,2);
  assert.equal(context.window.location.href,'forum-detail.html');
  assert.equal(alerts.at(-1),'删除失败，请重试');
  context.toggleFollow('阿诺');
  assert.equal(follows,'["阿诺"]');
  assert.equal(renders,0);
  assert.match(toasts.at(-1),/未保存/);
  follows='malformed-json';
  context.toggleFollow('阿诺');
  assert.equal(follows,'malformed-json','malformed follows must not be overwritten');
  assert.match(toasts.at(-1),/未覆盖原数据/);
  follows='[]';ignore=false;
  context.toggleFollow('阿诺');
  assert.equal(context.isFollowing('阿诺'),true);
  assert.equal(renders,1);
});
