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
  assert.match(detail,/ForumGossip\.isRepeat\(update,/);
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
