/* MAOMAO fictional phone: persona-led forum and offline browser.
 * Non-network simulated pages; never claims real web search or real user history.
 * Each record belongs to the fictional role's existing local story object.
 */
(function(global){
'use strict';
var VERSION=1;
function arr(v){return Array.isArray(v)?v:[];}
function str(v,max){return String(v==null?'':v).slice(0,max||500);}
function nowAt(now,h,min,back){var d=new Date(now);d.setHours(h,min||0,0,0);if(back)d.setDate(d.getDate()-back);return Math.min(d.getTime(),new Date(now).getTime()-60000);}
function context(role){return [role&&role.name,role&&role.occupation,role&&role.job,role&&role.description,role&&role.bio,role&&role.personality,role&&role.hobbies,role&&role.relationship,role&&role.relationshipStatus,role&&role.prompt].filter(Boolean).join('；').slice(0,1300);}
function persona(role){
  var raw=context(role),name=str(role&&role.name||'我',30);
  var student=/在校|大学生|研究生|高中生|大一|大二|大三|社团|室友/.test(raw);
  var work=/设计|建筑|美术|摄影|创作|插画/.test(raw)?'creative':/出版|编辑|书店|写作|图书/.test(raw)?'books':/开发|软件|程序|代码|工程师/.test(raw)?'tech':'daily';
  var care=/女朋友|男朋友|恋人|伴侣|对象|交往|纪念日|情侣/.test(raw);
  var florist=/花|植物|园艺|玫瑰/.test(raw);
  return {name:name,student:student,work:work,care:care,florist:florist,raw:raw};
}
var flowers=[
 {id:'flower-first',category:'礼物灵感',domain:'花事手册 · 示例资料',title:'第一次送花怎么选：先考虑对方喜好，再考虑花语',
 snippet:'玫瑰、郁金香、洋桔梗和小花束怎么选？从颜色、气味与照顾难度开始。',
 paragraphs:['送花不一定要选最大的一束。先想想对方平时喜欢鲜艳颜色还是素雅的颜色，是否对浓郁花香敏感，以及拿着花束回家是否方便。',
 '玫瑰常用于表达重视和欣赏，浅色玫瑰通常比大红花束更日常；郁金香线条简洁，适合喜欢干净风格的人。洋桔梗与小型配花适合做轻巧、自然的花束。',
 '如果不确定对方喜欢什么，可以考虑花材数量少、体积适中的组合。附一张写着具体心意的小卡片，通常比昂贵的包装更有意义。',
 '以上为虚构手机中的原创花艺资料，不是实时商品、商家推荐或报价。']},
 {id:'flower-rose',category:'花材百科',domain:'花材观察 · 示例资料',title:'玫瑰花怎么选？颜色、花期和包装的几个细节',
 snippet:'红玫瑰、粉玫瑰、白玫瑰各有不同气质，花瓣状态比数量更值得看。',
 paragraphs:['玫瑰是常见的赠花选择，但不必执着于固定朵数。挑选时可以留意外层花瓣是否完整、枝叶是否有明显损伤，花束的整体配色是否协调。',
 '深红玫瑰视觉存在感较强；淡粉色与奶油色通常显得柔和。白色花材也能搭配绿色枝叶，做成相对简洁的花束。',
 '如果想让花多陪伴几天，收到后应及时换水、修剪花茎，并放在避免暴晒的位置；具体养护方式以花材特点为准。',
 '这篇内容是离线模拟网页文章，不提供真实商户链接或实时售价。']},
 {id:'flower-tulip',category:'花材百科',domain:'花材观察 · 示例资料',title:'除了玫瑰：郁金香、洋桔梗、绣球花如何搭配',
 snippet:'不喜欢传统红玫瑰，也有更轻盈的选择；需要注意季节与保鲜条件。',
 paragraphs:['郁金香的花型简单、枝干有线条感，常适合更克制的包装。洋桔梗的花瓣层次丰富，可以让花束看起来柔和一些。',
 '绣球花体积大、吸水量较高，对养护要求相对高。如果收花的人要通勤或长时间外出，轻巧且耐放的花材会更方便。',
 '选择时优先考虑对方的生活习惯、过敏情况和当地季节花材。别把任何一种花的象征意义当成绝对的关系暗示。',
 '以上是离线原创模拟资料，并不代表现实花店库存。']},
 {id:'flower-card',category:'送礼准备',domain:'日常礼物研究室 · 示例资料',title:'送花小卡片怎么写才自然，不必写得很隆重',
 snippet:'比起夸张的句子，一句具体的感谢、一段共同回忆就足够。',
 paragraphs:['写卡片时可以简单说清为什么在这一天想送花。比如对某次帮助表示感谢，或者只是觉得对方最近很辛苦，想送一点轻松的心情。',
 '文字不需要很长。真实而具体的表达通常比套话更容易让人理解。也可以只写名字、日期和一句日常问候。',
 '如果关系还没有明确，不要用花束或卡片制造压力。尊重对方意愿，让赠送行为保持轻松和有分寸。',
 '这是一篇虚构手机内的原创示例文章。']},
 {id:'work-focus',category:'生活技巧',domain:'日常整理 · 示例资料',title:'工作和生活挤在一起时，怎样整理当天待办',
 snippet:'把大任务拆成最小步骤，给每天留出一点空白，而不是安排满整天。',
 paragraphs:['首先从最重要的三件事开始记录。已经完成的项目划掉，没完成的任务按实际情况移到下一天。','把需要联系别人才能继续的事项单独标注，避免一直把等待误当成自己的拖延。','备忘录可以写得很随意，真正有用的是能找回来，而不是排版多漂亮。']},
 {id:'school-focus',category:'校园生活',domain:'学习笔记 · 示例资料',title:'课程、社团、休息怎么安排：简单的周计划',
 snippet:'给课程和社团活动留出缓冲，不把每一个晚上都塞满。',
 paragraphs:['先固定上课与作业截止日期，再安排社团和休息时间。','一张可以随时修改的计划表，比写得太满却无法执行的清单更有效。','如果计划临时变化，可以在备忘录里写下原因，下周再调整。']},
 {id:'creative-focus',category:'创作手记',domain:'设计手札 · 示例资料',title:'灵感碎片太多，怎样整理成可完成的小项目',
 snippet:'把截图、草稿与文字想法放在同一主题下，保留创作过程。',
 paragraphs:['灵感不必立刻变成作品。先保存原始想法和日期，再按主题整理。','做项目时把参考图与自己的草稿分开，避免误把别人作品当成自己的素材。','每周挑一个可以真正完成的小项目，剩下的留在素材盒里。']},
 {id:'book-focus',category:'阅读生活',domain:'书页之间 · 示例资料',title:'从阅读随笔到书签：怎样记录一本书带来的想法',
 snippet:'不急着写完整读后感，记录某一页的具体感受。',
 paragraphs:['读到喜欢的一段可以记下页码，再写两三句自己的想法。','很多阅读感受会在几天之后改变，不必追求第一次写下的观点就完全正确。','把书签、笔记和借阅记录整理在一起，下次找书会方便很多。']}
];
var contentById={};flowers.forEach(function(p){contentById[p.id]=p;});
function resultGroups(query,p){
  var q=str(query,120).toLowerCase().trim();
  if(!q)return [];
  if(/花|玫瑰|郁金香|花店|女朋友|对象|恋人|女友|男友|送礼|纪念日|礼物/.test(q))
    return ['flower-first','flower-rose','flower-tulip','flower-card'].map(function(id){return contentById[id];});
  if(/作业|学习|课程|社团|考试|校园/.test(q))return [contentById['school-focus'],contentById['work-focus']];
  if(/设计|灵感|创作|摄影|素材/.test(q))return [contentById['creative-focus'],contentById['work-focus']];
  if(/书|阅读|读书|书签|写作/.test(q))return [contentById['book-focus'],contentById['work-focus']];
  if(/工作|待办|时间|生活|计划/.test(q))return [contentById['work-focus'],contentById[p.student?'school-focus':'book-focus']];
  return [];
}
function seed(role,roleId,data,now){
  if(!data||!data.sections)return {added:0};
  var p=persona(role),browser=data.sections.browser,forum=data.sections.forum;
  if(!browser||!forum)return {added:0};
  browser.searchHistory=arr(browser.searchHistory);
  browser.bookmarks=arr(browser.bookmarks);
  browser.pageViews=arr(browser.pageViews);
  forum.posts=arr(forum.posts);
  var added=0;
  if(!browser.personaSeedVersion){
    var searches=[
      {query:p.care?'如何给女朋友买鲜花 玫瑰花和郁金香怎么选':p.florist?'适合放在书桌上的简单鲜花':p.student?'课程和社团怎么安排时间':p.work==='books'?'最近想读的书怎么做笔记':p.work==='creative'?'灵感资料怎么整理':'工作日怎么安排生活待办',time:nowAt(now,21,12,1),origin:'role_persona_sample',searchId:'persona:'+roleId+':1'},
      {query:p.care?'送给对象的花束怎么包装比较自然':p.student?'周计划怎么做不拖延':p.work==='creative'?'设计项目灵感记录方法':'周末一个人散步带什么',time:nowAt(now,23,35,2),origin:'role_persona_sample',searchId:'persona:'+roleId+':2'}
    ];
    searches.forEach(function(x){if(!browser.searchHistory.some(function(h){return h.searchId===x.searchId;})){browser.searchHistory.push(x);added++;}});
    browser.searchHistory.sort(function(a,b){return Number(b.time)-Number(a.time);});
    browser.personaSeedVersion=VERSION;
  }
  if(!forum.personaSeedVersion){
    var topic=p.care?
      {title:'想认真挑一束花，有没有人懂花材搭配？',text:'最近在想给一位很重要的人送花。看了玫瑰和郁金香的资料，发现花色、香味和花束大小都要考虑。\n\n我不太想送那种特别夸张的包装，最好是能方便带回去、放在桌上的。对方平时喜欢简单一点的东西。\n\n有人送过比较克制的花束吗？欢迎聊聊自己挑花的经验。',topic:'花艺与礼物'}:
      p.student?{title:'课程排得很满，社团活动和作业要怎么分配时间？',text:'最近课表和社团时间撞在一起，临时安排总是被打乱。\n\n我试着把本周要做的事情写进备忘录，发现比只在脑子里记着轻松。有人有什么简单的整理方法吗？',topic:'校园日常'}:
      p.work==='books'?{title:'你们会把书店的收据夹在书里当书签吗？',text:'最近整理看过的书，发现自己留下不少纸质书签和小票。\n\n有时候并不是舍不得票据本身，而是那天逛书店的场景还留在脑子里。你们怎么保存阅读过程中的小记录？',topic:'阅读讨论'}:
      p.work==='creative'?{title:'工作里的灵感碎片究竟怎么整理比较好？',text:'最近手机里有太多草稿和参考图。单独看每张都挺有意思，放到一起却很难找到真正要用的内容。\n\n现在尝试给每个小项目建一条清单。大家有什么比较顺手的整理方法？',topic:'创作交流'}:
      {title:'最近终于试着把零碎的日常记下来了',text:'之前觉得这些小事没必要记录，后来发现一周过得很快，很多瞬间不写下来就忘了。\n\n现在每晚花几分钟记一段，想问问大家平时都怎么留下自己的生活片段？',topic:'日常随笔'};
    var id='persona-forum:'+roleId+':'+VERSION;
    if(!forum.posts.some(function(x){return x.postId===id;})){
      forum.posts.unshift({postId:id,authorId:String(roleId),author:p.name,
        title:topic.title,text:topic.text,topic:topic.topic,time:nowAt(now,19,25,1),
        likes:14,liked:false,views:73,origin:'role_persona_sample',
        comments:[{name:'阿蓝',text:p.care?'我比较喜欢低饱和色的花束，包装别太厚。':'我也有类似的习惯。',time:nowAt(now,20,2,1)},
          {name:'南风',text:'与其跟风，不如选适合对方生活方式的。',time:nowAt(now,20,10,1)}]});
      added++;
    }
    forum.personaSeedVersion=VERSION;
  }
  return {added:added,persona:p};
}
function search(section,query,now){
  if(!section)return {ok:false,error:'浏览器资料不可用'};
  var q=str(query,120).trim();if(!q)return {ok:false,error:'请输入搜索词'};
  section.searchHistory=arr(section.searchHistory);
  var t=Number(now)||Date.now();
  section.searchHistory.unshift({query:q,time:t,searchId:'manual:'+t+':'+Math.floor(Math.random()*1e7),origin:'user_on_fictional_phone'});
  section.searchHistory=section.searchHistory.slice(0,45);
  return {ok:true,query:q,results:resultGroups(q)};
}
function visit(section,id,query,now){
  if(!section||!contentById[id])return false;
  section.pageViews=arr(section.pageViews);
  section.pageViews.unshift({articleId:id,title:contentById[id].title,query:str(query,120),
    time:Number(now)||Date.now(),origin:'fictional_browsing'});
  section.pageViews=section.pageViews.slice(0,50);
  return true;
}
function bookmark(section,id,now){
  if(!section||!contentById[id])return false;
  section.bookmarks=arr(section.bookmarks);
  if(section.bookmarks.some(function(x){return x.articleId===id;}))return true;
  section.bookmarks.unshift({articleId:id,title:contentById[id].title,summary:contentById[id].snippet,
    time:Number(now)||Date.now(),origin:'user_on_fictional_phone'});
  section.bookmarks=section.bookmarks.slice(0,30);return true;
}
function history(section){return arr(section&&section.searchHistory).slice().sort(function(a,b){return Number(b.time)-Number(a.time);});}
function article(id){return contentById[id]||null;}
function find(query,p){return resultGroups(query,p);}
global.InspectPersonaWeb={seed:seed,persona:persona,search:search,visit:visit,bookmark:bookmark,history:history,article:article,find:find};
})(window);
