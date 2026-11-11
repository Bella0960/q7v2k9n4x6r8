/* Forum gossip serial stories: fictional outlines, continuity and repetition checks. */
(function(root){
  'use strict';
  var IDEAS=[
    {id:'double_life',outline:'某个人在大家面前和私下里的反差很大',direction:'用虚构人物讲一段反差被慢慢发现的故事。表面形象、私下选择、误会与真正动机要层层展开。不要简单写成坏人曝光。'},
    {id:'unspoken_crush',outline:'朋友一直没说出口的暗恋对象',direction:'围绕一个没说出口的喜欢，埋下线索，让关系、错过的时机和当事人不同的理解渐次浮现。不要第一篇就揭晓所有答案。'},
    {id:'perfect_couple',outline:'看起来特别般配的两个人，私下其实有矛盾',direction:'从外界眼里的完美关系切入，逐渐揭开两个人真实的相处困境、分歧及选择，不使用刻板反转。'}
  ];
  function idea(id){return IDEAS.find(function(x){return x.id===id})||null}
  function clean(v,limit){return String(v==null?'':v).trim().slice(0,limit||500)}
  function planBatch(posts,count){
    var list=Array.isArray(posts)?posts:[];
    var score={};
    IDEAS.forEach(function(x){score[x.id]=0});
    list.forEach(function(p){var id=p&&p.gossipStory&&p.gossipStory.outlineId;if(Object.prototype.hasOwnProperty.call(score,id))score[id]++});
    var sorted=IDEAS.slice().sort(function(a,b){return score[a.id]-score[b.id]||IDEAS.indexOf(a)-IDEAS.indexOf(b)});
    return sorted.slice(0,Math.max(1,Math.min(IDEAS.length,count||IDEAS.length))).map(function(x){return {id:x.id,outline:x.outline,direction:x.direction}});
  }
  function storyFromOpening(item,plan,index){
    var id=plan&&plan.id||IDEAS[index%IDEAS.length].id;
    var spec=idea(id)||IDEAS[0];
    var rawFacts=Array.isArray(item&&item.storyFacts)?item.storyFacts:[];
    return {outlineId:spec.id,outline:spec.outline,
      premise:clean(item&&item.storyPremise,320)||clean(item&&item.body,200),
      cast:clean(item&&item.storyCast,360),
      facts:rawFacts.map(function(x){return clean(x,160)}).filter(Boolean).slice(0,8),
      chapter:0,maxChapters:4+(index%2),finished:false,updatedAt:Date.now()};
  }
  function normalized(text){return clean(text,5000).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')}
  function isRepeat(text,earlier){
    var s=normalized(text);
    if(s.length<25)return false;
    return (Array.isArray(earlier)?earlier:[]).some(function(previous){
      var old=normalized(previous);
      if(old.length<25)return false;
      if(s===old||s.includes(old)&&old.length>75||old.includes(s)&&s.length>75)return true;
      var size=12,seen=new Set();
      for(var i=0;i+size<=old.length;i+=6)seen.add(old.slice(i,i+size));
      var matches=0,total=0;
      for(var j=0;j+size<=s.length;j+=6){total++;if(seen.has(s.slice(j,j+size)))matches++}
      return total>=5&&matches/total>0.65;
    });
  }
  // A casual reaction should not silently consume a chapter; only a clear request advances it.
  function wantsContinuation(text){
    var s=clean(text,300).replace(/\s+/g,'');
    return !!s&&/(?:继续(?:说|讲|更|写|更新|生成)|^继续(?:啊|呀|吧|！|!|。)?$|接着(?:说|讲|更|写)|往下(?:说|讲)|后续|后面呢|后来(?:呢|怎么样|如何|发生|咋样)|蹲(?:更|后续)?|催更|求(?:更|后续)|结局(?:呢|是|如何|怎么)|说完|讲完|然后呢|下一(?:更|章|集|回)|再讲|再说点)/i.test(s);
  }
  // Derive the chapter cursor from saved author updates as well as the story bible.
  function progress(post){
    var story=post&&post.gossipStory||{},count=Number(story.maxChapters);
    var maxChapters=Number.isFinite(count)?Math.min(8,Math.max(3,Math.floor(count))):4;
    var current=Number(story.chapter);
    var chapter=Number.isFinite(current)?Math.max(0,Math.floor(current)):0;
    (Array.isArray(post&&post.comments)?post.comments:[]).forEach(function(c){
      if(!c||c.source!=='gossip-author')return;
      var n=Number(c.gossipChapter);
      if(Number.isFinite(n))chapter=Math.max(chapter,Math.floor(n));
    });
    chapter=Math.min(maxChapters,chapter);
    return {chapter:chapter,maxChapters:maxChapters,nextChapter:Math.min(maxChapters,chapter+1),
      finished:!!story.finished||chapter>=maxChapters};
  }
  // Validate substantive progress before any new comment or chapter state is persisted.
  function validateUpdate(data,earlierTexts,existingFacts){
    var update=clean(data&&data.update,1800);
    if(update.length<90)return {ok:false,reason:'这一更太短，没讲清楚新情节'};
    if(isRepeat(update,earlierTexts))return {ok:false,reason:'这一更重复了之前的内容'};
    var seen=new Set((Array.isArray(existingFacts)?existingFacts:[]).map(normalized));
    var newFacts=[];
    (Array.isArray(data&&data.newFacts)?data.newFacts:[]).forEach(function(value){
      var fact=clean(value,180),key=normalized(fact);
      if(key.length<6||seen.has(key))return;
      seen.add(key);
      newFacts.push(fact);
    });
    if(newFacts.length<2)return {ok:false,reason:'没有提供足够的新情节，未保存这次更新'};
    return {ok:true,update:update,newFacts:newFacts.slice(0,8)};
  }
  function isGossipPost(post){return !!(post&&post.gossipStory&&idea(post.gossipStory.outlineId))}
  root.ForumGossip={ideas:IDEAS,idea:idea,planBatch:planBatch,storyFromOpening:storyFromOpening,
    isRepeat:isRepeat,wantsContinuation:wantsContinuation,progress:progress,
    validateUpdate:validateUpdate,isGossipPost:isGossipPost};
})(window);
