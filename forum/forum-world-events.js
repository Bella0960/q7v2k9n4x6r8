/* Distinct fictional community arcs, no demo posts injected on their own. */
(function(root){
  'use strict';
  const WORLDS={
    reality:{tone:'都市生活，工作日/周末的细节与邻里关系，不要空泛感悟',arcs:[
      {id:'city_bookshop',topic:'邻里闲谈',outline:'街角旧书店原定关门，一份读者自发的借阅登记改变了老板的打算',cast:'书店老板、兼职店员、常来借书的邻居',steps:'消息传出→邻居各有猜测→具体行动→最后决定'},
      {id:'city_commute',topic:'职场见闻',outline:'跨城区通勤时一项临时调整，让同事和乘客误会彼此的安排',cast:'轮班同事、通勤乘客、协调排班的人',steps:'影响出现→误会升级→有人查到缘由→商量处理'},
      {id:'city_neighbors',topic:'生活观察',outline:'合租楼里一件不起眼的公共物品，引发住户对公共空间使用的不同意见',cast:'两位租客、保洁阿姨、物业联系人',steps:'小事发生→几方解释不同→找到时间线→订出新规则'}
    ]},
    academy:{tone:'校园日常：课程、社团、宿舍与学生的具体生活，不编造真实师生指控',arcs:[
      {id:'campus_club',topic:'社团日常',outline:'校园社团筹备展示活动，节目顺序和排练教室撞期，成员需要重新商量',cast:'社长、刚加入的学弟学妹、活动场地协调人',steps:'招新与准备→时间冲突→当面沟通→活动落地'},
      {id:'campus_room',topic:'宿舍见闻',outline:'宿舍四个人要协调作息和公共空间，群聊里一句话被误解',cast:'几位室友、宿舍楼值班同学',steps:'细节积累→误读出现→有当事人解释→约定调整'},
      {id:'campus_course',topic:'课业求助',outline:'小组展示和选课时间冲突，每个人都想把自己的部分做好',cast:'小组负责人、迟到的队员、借教室的同学',steps:'课程通知→时间冲突→换方案→课堂反馈'}
    ]},
    xiuxian:{tone:'完全虚构的修仙世界，守住修为层级、宗门规则和法器代价；修士也有生活琐事',arcs:[
      {id:'sect_herbs',topic:'灵兽奇闻',outline:'灵草园的夜间足迹引起误会，守园弟子和灵兽饲养者追查来历',cast:'守园弟子、灵兽饲养者、药堂管事',steps:'足迹发现→误会与排查→真相线索→善后'},
      {id:'sect_mission',topic:'宗门八卦',outline:'宗门外勤任务分工不均，有人暗中补做了最辛苦的一部分',cast:'外门弟子、领队师兄、任务执事',steps:'任务下达→分歧→事实浮现→重新分配'},
      {id:'sect_refining',topic:'丹药测评',outline:'丹房一批普通回灵散药效不稳，几名弟子用各自经历找原因',cast:'炼丹弟子、药堂记录员、试用修士',steps:'试用感受→比对炼制批次→排查材料→复核方法'}
    ]},
    future:{tone:'赛博朋克夜城的普通生活和技术代价；保留现实因果，避免黑客教程和犯罪操作细节',arcs:[
      {id:'night_transit',topic:'夜城生活',outline:'夜城末班电车调整通行名单，晚班工人寻找不折腾的回家路线',cast:'晚班工人、站务员、同区邻居',steps:'通行提醒→路线受阻→社区互助→解决'},
      {id:'night_repair',topic:'设备测评',outline:'一款旧式义体辅助设备更新后频繁误报，维修店和用户意见不一',cast:'维修师傅、长期使用者、厂家售后联络人',steps:'异常反馈→不同测试结果→发现条件→可行维修'},
      {id:'night_network',topic:'赛博见闻',outline:'社区公共信息屏连日不同步，邻居们追查是否是设备老化而非阴谋',cast:'社区管理员、屏幕维修员、路过住户',steps:'信息延误→传言→查验设备→公开解释'}
    ]}
  };
  const trim=(x,n)=>String(x==null?'':x).trim().slice(0,n||500);
  const normalize=x=>trim(x,2000).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
  function getWorld(theme){
    if(!theme||!theme.id||theme.id==='bagua')return null;
    if(WORLDS[theme.id])return WORLDS[theme.id];
    if(!String(theme.id).startsWith('custom_'))return null;
    const topics=(Array.isArray(theme.roleTopics)?theme.roleTopics:[]).filter(Boolean).slice(0,5);
    if(!topics.length)return null;
    // Custom topics are user-authored. Avoid imposing campus/city assumptions.
    return {tone:'以自定义论坛世界书和话题为准，延续同一批虚构人物的经历：'+trim(theme.world,900),
      arcs:topics.map((topic,i)=>({id:'custom_'+i,topic:topic,outline:'围绕「'+trim(topic,40)+'」的一个具体矛盾、变动或相遇，人物目标和日常细节必须符合世界书',cast:'由世界书确定固定角色及社会关系',steps:'事情起因→不同视角→解决尝试→后续结果'}))};
  }
  function plans(theme,posts,count){
    const world=getWorld(theme);if(!world)return [];
    const relevant=(Array.isArray(posts)?posts:[]).filter(p=>p&&p.worldEvent&&p.worldEvent.themeId===theme.id);
    const counts=new Map(world.arcs.map(a=>[a.id,0]));
    relevant.forEach(p=>{if(counts.has(p.worldEvent.arcId))counts.set(p.worldEvent.arcId,counts.get(p.worldEvent.arcId)+1)});
    const selected=world.arcs.slice().sort((a,b)=>counts.get(a.id)-counts.get(b.id)||world.arcs.indexOf(a)-world.arcs.indexOf(b));
    return selected.slice(0,Math.max(1,Math.min(3,count||2))).map(a=>({...a,tone:world.tone}));
  }
  function fromOpening(item,plan,theme){
    if(!item||!plan||!theme||!getWorld(theme))return null;
    const facts=(Array.isArray(item.threadFacts)?item.threadFacts:[])
      .map(x=>trim(x,140)).filter(Boolean).slice(0,8);
    return {schema:1,themeId:theme.id,arcId:plan.id,outline:plan.outline,
      cast:trim(item.threadCast,350),facts: facts,chapter:0,maxChapters:3,
      finished:false,updatedAt:Date.now()};
  }
  function isEvent(post){return !!(post&&post.worldEvent&&post.worldEvent.schema===1&&
    post.worldEvent.themeId&&post.worldEvent.arcId&&post.worldEvent.themeId!=='bagua')}
  function progress(post){
    const story=post&&post.worldEvent||{};
    const max=Number.isInteger(Number(story.maxChapters))?Math.max(2,Math.min(5,Number(story.maxChapters))):3;
    const revisions=(Array.isArray(post&&post.comments)?post.comments:[])
      .filter(c=>c&&c.source==='forum-world-author').map(c=>Number(c.worldChapter))
      .filter(n=>Number.isInteger(n)&&n>=1&&n<=max);
    const n=Number(story.chapter);
    return {chapter:Math.min(max,Math.max(Number.isInteger(n)?n:0,...revisions)),
      maxChapters:max,finished:revisions.includes(max)||n>=max};
  }
  function duplicated(text,earlier){
    const s=normalize(text);if(s.length<45)return false;
    return (Array.isArray(earlier)?earlier:[]).some(p=>{
      const t=normalize(p);return t.length>=45&&
        (s===t||(s.includes(t)&&t.length>=80)||(t.includes(s)&&s.length>=80));
    });
  }
  function checkUpdate(data,previous,facts){
    const update=trim(data&&data.update,1750);
    if(update.length<95)return {ok:false,reason:'新进展太短，原内容已保留'};
    if(duplicated(update,previous))return {ok:false,reason:'新进展与历史章节重复，原内容已保留'};
    const seen=new Set((Array.isArray(facts)?facts:[]).map(normalize));
    const news=[];
    (Array.isArray(data&&data.newFacts)?data.newFacts:[]).forEach(v=>{
      const value=trim(v,160),k=normalize(value);
      if(k.length<8||seen.has(k))return;seen.add(k);news.push(value);
    });
    if(news.length<2)return {ok:false,reason:'新进展没有提供两个新事实，原内容已保留'};
    return {ok:true,update,newFacts:news.slice(0,6)};
  }
  function wantsUpdate(text){
    const q=trim(text,200).replace(/\s+/g,'');
    if(/(?:别|不要|停止|暂停|不用|先别)(?:继续|更新|说|讲|写)|别剧透/.test(q))return false;
    return /(?:后来呢|后续呢|新进展|有(?:后续|结果|更新)吗|进度怎么样|进展如何|继续(?:说|讲|更新)|蹲后续|最后怎么样|怎么样了|下一更)/.test(q);
  }
  root.ForumWorldEvents={worlds:WORLDS,getWorld,plans,fromOpening,isEvent,progress,checkUpdate,duplicated,wantsUpdate};
})(window);
