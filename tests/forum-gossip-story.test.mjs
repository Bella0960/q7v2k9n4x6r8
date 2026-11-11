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
