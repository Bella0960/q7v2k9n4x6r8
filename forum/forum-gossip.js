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
  function isGossipPost(post){return !!(post&&post.gossipStory&&idea(post.gossipStory.outlineId))}
  root.ForumGossip={ideas:IDEAS,idea:idea,planBatch:planBatch,storyFromOpening:storyFromOpening,isRepeat:isRepeat,isGossipPost:isGossipPost};
})(window);
