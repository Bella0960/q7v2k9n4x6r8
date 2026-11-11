/* MAOMAO · 查手机（虚构角色剧情），与真实设备数据完全隔离。
 * 依赖 PhoneStorage / PhoneAPI；不读取真实用户的聊天、定位或支付记录。
 */
(function (global) {
  'use strict';
  var ITEMS = [
    {id:'chat',name:'微信',hint:'联系人 · 对话 · 撤回'},
    {id:'moments',name:'朋友圈',hint:'动态 · 评论 · 可见范围'},
    {id:'browser',name:'浏览器',hint:'搜索 · 收藏 · 删除痕迹'},
    {id:'notes',name:'备忘录',hint:'待办 · 日记 · 锁定内容'},
    {id:'wallet',name:'钱包',hint:'收支 · 余额 · 消费线索'},
    {id:'music',name:'音乐',hint:'播放 · 歌单 · 排行'},
    {id:'map',name:'地图',hint:'行程 · 停留 · 独白'},
    {id:'album',name:'相册',hint:'照片描述 · 隐藏相册'},
    {id:'device',name:'设备状态',hint:'屏幕时间 · 电量 · 使用习惯'},
    {id:'forum',name:'论坛',hint:'已有扩展 · 帖子线索'}
  ];
  var ICONS = {
    chat:'<path d="M20 12a8 8 0 1 0-15 4L4 21l5-1.5A8 8 0 0 0 20 12z"/>',
    moments:'<circle cx="12" cy="12" r="9"/><path d="M12 4v16M4 12h16"/>',
    browser:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-4 6-4 12 0 18M12 3c4 6 4 12 0 18"/>',
    notes:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    wallet:'<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M4 9V5a2 2 0 0 1 2-2h12M15 13h6"/>',
    music:'<path d="M9 18V5l12-2v13M9 8l12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    map:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    album:'<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 17l4.5-4.5 3.5 3.5L16 11l4 4.5"/>',
    device:'<rect x="7" y="2" width="10" height="20" rx="3"/><path d="M10 18h4"/>',
    forum:'<path d="M20 12a8 8 0 1 0-15 4L4 21l5-1.5A8 8 0 0 0 20 12z"/><path d="M8 10h8M8 14h5"/>'
  };
  var FIELDS = {
    chat:'{ "contacts":[{"id":"c1","name":"室友小林","avatar":"林","relationship":"大学室友","lastTime":时间戳,"unread":1,"messages":[{"side":"me或ai或system","text":"内容","time":时间戳,"status":"sent或read_no_reply或recalled"}]}] }',
    moments:'{ "moments":[{"text":"正文","time":时间戳,"visibility":"公开或部分可见","hesitated":true,"image":"配图文字描述","comments":[{"name":"好友姓名","text":"评论"}]}] }',
    browser:'{ "searchHistory":[{"query":"搜索词","time":时间戳},{"query":"已清除3条历史记录","time":时间戳,"deleted":true}],"bookmarks":[{"title":"标题","summary":"摘要"}] }',
    notes:'{ "notes":[{"title":"标题","text":"内容","createdAt":时间戳,"updatedAt":时间戳}],"locked":[{"title":"别删","text":"秘密日记","createdAt":时间戳,"updatedAt":时间戳}] }',
    wallet:'{ "transactions":[{"merchant":"商户或来源","amount":-36.5,"type":"餐饮","time":时间戳,"memo":"可选线索"}],"balance":2360 }',
    music:'{ "recent":[{"title":"歌名","artist":"歌手","time":时间戳,"repeat":true}],"playlists":[{"name":"歌单","tracks":["歌名","歌名"]}],"top":[{"title":"歌名","plays":18}] }',
    map:'{ "stops":[{"place":"地点","arrival":时间戳,"durationMinutes":30,"thought":"当时的想法"}],"steps":5000,"distanceKm":4,"outHours":3,"frequentPlace":"住处"}',
    album:'{ "photos":[{"description":"照片文字描述","type":"自拍","time":时间戳}],"hidden":[{"description":"隐藏照片描述","time":时间戳}],"total":108,"newSevenDays":7 }',
    device:'{ "screenMinutes":254,"nightMinutes":42,"apps":[{"name":"微信","minutes":80}],"battery":67,"wifi":"Home-5G","model":"某型号手机","storageUsedGb":51,"storageTotalGb":128,"pickups":43,"focusMinutes":60,"relaxMinutes":40,"location":"家" }',
    forum:'{ "posts":[{"title":"帖子标题","text":"正文","time":时间戳,"comments":[{"name":"昵称","text":"评论"}]}] }'
  };
  var LIMIT = {chat:5,moments:3,browser:5,notes:3,wallet:6,music:5,map:3,album:5,device:5,forum:3};
  function clean(x, max) {return String(x == null ? '' : x).replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max||300);}
  function html(x) {return clean(x,1200).replace(/[&<>"']/g,function (c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function num(x,base) {var n=Number(x);return Number.isFinite(n)?n:base;}
  function money(x) {return (x<0?'-':'')+'¥'+Math.abs(num(x,0)).toFixed(2);}
  function localDay(date) {return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
  function dateTime(t) {var d=new Date(num(t,Date.now()));return Number.isNaN(d.getTime())?'—':(d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function at(now,days,h,m) {var d=new Date(now);d.setDate(d.getDate()-days);d.setHours(h,m||0,0,0);if(d.getTime()>now.getTime())d.setDate(d.getDate()-1);return d.getTime();}
  function clampTime(t,now) {var n=num(t,now.getTime());return Math.min(now.getTime(),Math.max(now.getTime()-35*86400000,n));}
  function cap(list,n) {return Array.isArray(list)?list.slice(0,n):[];}
  function arr(list) {return Array.isArray(list)?list:[];}
  function storyKey(roleId) {return 'inspect_story_v1_'+encodeURIComponent(String(roleId));}
  function hash(x) {var h=2166136261;for(var i=0;i<x.length;i++){h=Math.imul(h^x.charCodeAt(i),16777619);}return h>>>0;}
  function hiddenPin(roleId,role) {
    var birthday=role&&String(role.birthday||role.birthDate||role.birthdate||'').replace(/\D/g,'');
    if(birthday&&birthday.length>=6)return birthday.slice(-6);
    return String(100000+hash(String(roleId)+'_fictional_album')%900000);
  }
  function read(roleId,now) {
    try {var data=JSON.parse(localStorage.getItem(storyKey(roleId))||'null');
      if(data&&data.schema===1&&data.roleId===String(roleId)&&data.sections&&Array.isArray(data.facts)&&data.facts.length&&typeof data.sections==='object')return data;
    }catch(e){}
    return null;
  }
  function save(data) {try {localStorage.setItem(storyKey(data.roleId),JSON.stringify(data));return true;}catch(e){return false;}}
  // 跨天只延续已存在的故事；不重置聊天、隐私线索与板块记录。
  // 每日的事实追加后，新的 AI 板块刷新才能引用最新事件；昨日内容作为历史保留。
  function carryForward(previous,role,roleId,now) {
    if(previous.day===localDay(now))return previous;
    var newDay=fallback(role,roleId,now);
    var oldFacts=arr(previous.facts).filter(function(f){
      return f&&num(f.time,0)<=now.getTime()&&num(f.time,0)>=now.getTime()-14*86400000;
    });
    var known={};
    oldFacts.forEach(function(f){known[String(f.time)+'|'+String(f.place)]=true;});
    var extra=arr(newDay.facts).filter(function(f){
      return !known[String(f.time)+'|'+String(f.place)]&&
        (!oldFacts.length||num(f.time,0)>num(oldFacts[oldFacts.length-1].time,0));
    }).map(function(f){return Object.assign({},f,{id:localDay(new Date(f.time))+'-'+f.id});});
    var copy=Object.assign({},previous);
    copy.facts=oldFacts.concat(extra).sort(function(a,b){return a.time-b.time;}).slice(-20);
    copy.day=localDay(now);
    copy.permission=null; // 不能因为昨天同意就默认永久授权
    copy.lastRolloverAt=now.getTime();
    copy.selected=arr(previous.selected).filter(function(id){return ITEMS.some(function(x){return x.id===id;});});
    copy.sections=previous.sections||newDay.sections;
    copy.source=previous.source||{};
    // 保持历史数据可见、可继续聊天；不凭空把旧钱包和旧照片说成今天发生。
    copy.carriedFrom=previous.day;
    return copy;
  }
  function roleContext(role) {
    return [role.name,role.age,role.job,role.occupation,role.education,role.description,role.bio,role.personality,role.character,role.speechStyle,role.prompt,role.systemPrompt]
      .filter(Boolean).map(function(x){return clean(x,500);}).join('；').slice(0,3000);
  }
  function profile(role) {
    var text=roleContext(role),student=/学生|大学|高中|研究生|校园|宿舍/.test(text);
    var work=/公司|职员|上班|设计师|工程师|教师|工作|医生|店员|律师/.test(text);
    var place=student?'学校':work?'公司':'工作室';
    var pair=student?'室友小林':work?'同事小林':'邻居小林';
    var level=/富裕|有钱|高收入|总裁|企业家/.test(text)?'high':student?'student':'normal';
    return {student:student,place:place,pair:pair,level:level};
  }
  function fallback(role,roleId,now) {
    var p=profile(role),name=clean(role.name,30)||'角色';
    var low=p.level==='student',high=p.level==='high',meal=low?19:high?228:38,shop=low?85:high?780:189;
    var dayMinutes=now.getHours()*60+now.getMinutes();
    var stamps;
    if(dayMinutes<540)stamps=[515,740,970,1175].map(function(m){return m-1440;});
    else if(dayMinutes<780)stamps=[420,460,500,dayMinutes-5];
    else if(dayMinutes<1020)stamps=[515,620,740,dayMinutes-10];
    else if(dayMinutes<1200)stamps=[515,700,860,dayMinutes-15];
    else stamps=[515,740,970,1175];
    var midnight=new Date(now);midnight.setHours(0,0,0,0);
    var factTimes=stamps.map(function(m){return midnight.getTime()+m*60000;});
    var facts=[
      {id:'e1',time:factTimes[0],place:'住处',event:'临出门前想起一件没说完的事',amount:0},
      {id:'e2',time:factTimes[1],place:p.place+'附近的小店',event:'吃午饭，顺手拍了一张照片',amount:-meal},
      {id:'e3',time:factTimes[2],place:'街角文具店',event:'挑了很久才买下一个小东西',amount:-shop},
      {id:'e4',time:factTimes[3],place:'住处',event:'晚间整理消息和备忘录',amount:0}
    ];
    // 今天未发生的场景不会写成今天：at() 会放到前一天；页面标明最近24小时轨迹。
    var u='你',contacts=[
      {id:'user',name:u,avatar:'你',relationship:'特别联系人',lastTime:at(now,0,21,8),unread:0,messages:[
        {side:'ai',text:'今天还顺利吗？',time:at(now,1,20,10)},
        {side:'me',text:'嗯……还行。',time:at(now,1,20,11)},
        {side:'ai',text:'总觉得你没说完。',time:at(now,1,20,12)},
        {side:'me',text:'只是有件事还没想清楚。',time:at(now,1,20,13)},
        {side:'ai',text:'那就慢慢想。',time:at(now,1,20,14)},
        {side:'me',text:'我刚才打了一大段，又删了。',time:at(now,1,20,15)},
        {side:'ai',text:'不着急，我在。',time:at(now,1,20,16)},
        {side:'system',text:'你撤回了一条消息',time:at(now,1,20,17),status:'recalled'},
        {side:'me',text:'晚点再说吧。',time:at(now,0,21,8),status:'read_no_reply'}
      ]},
      {id:'c2',name:p.pair,avatar:'林',relationship:p.student?'室友':p.pair.startsWith('同事')?'同事':'邻居',lastTime:at(now,0,17,40),unread:2,messages:[
        {side:'ai',text:'午饭那家店怎么样？',time:at(now,0,12,24)},
        {side:'me',text:'还可以，就是人多。',time:at(now,0,12,25)},
        {side:'ai',text:'你是不是又忘带伞了。',time:at(now,0,12,26)},
        {side:'me',text:'……差点。',time:at(now,0,12,27)},
        {side:'ai',text:'你真是。',time:at(now,0,12,28)},
        {side:'me',text:'等等，我有个事想问',time:at(now,0,17,35)},
        {side:'system',text:'对方撤回了一条消息',time:at(now,0,17,36),status:'recalled'},
        {side:'ai',text:'算了，见面再说。',time:at(now,0,17,37)},
        {side:'me',text:'行。',time:at(now,0,17,39)},
        {side:'ai',text:'桌上那本书别忘带走。',time:at(now,0,17,40)}
      ]},
      {id:'c3',name:'高中好友阿诺',avatar:'诺',relationship:'高中好友',lastTime:at(now,1,22,5),unread:0,messages:[
        {side:'ai',text:'你最近是不是有心事？',time:at(now,1,21,58)},
        {side:'me',text:'哪有。',time:at(now,1,21,59)},
        {side:'ai',text:'少来，你都不怎么发动态了。',time:at(now,1,22,0)},
        {side:'me',text:'最近忙。',time:at(now,1,22,1)},
        {side:'ai',text:'好好吃饭。',time:at(now,1,22,2)},
        {side:'me',text:'知道啦。',time:at(now,1,22,3)},
        {side:'ai',text:'周末一起散步？',time:at(now,1,22,4)},
        {side:'me',text:'我看看安排。',time:at(now,1,22,5)}
      ]},
      {id:'c4',name:'表姐思思',avatar:'思',relationship:'表姐',lastTime:at(now,2,18,30),unread:0,messages:[
        {side:'ai',text:'东西收到了没？',time:at(now,2,18,17)},
        {side:'me',text:'刚收到。',time:at(now,2,18,18)},
        {side:'ai',text:'喜欢吗？',time:at(now,2,18,19)},
        {side:'me',text:'比图片好看。',time:at(now,2,18,20)},
        {side:'ai',text:'那就好。',time:at(now,2,18,21)},
        {side:'me',text:'回头给你拍照。',time:at(now,2,18,25)},
        {side:'ai',text:'不急，照顾好自己。',time:at(now,2,18,30)},
        {side:'me',text:'好。',time:at(now,2,18,31)}
      ]},
      {id:'c5',name:'社团伙伴阿川',avatar:'川',relationship:'活动伙伴',lastTime:at(now,3,14,50),unread:1,messages:[
        {side:'ai',text:'那个活动报名了吗？',time:at(now,3,14,40)},
        {side:'me',text:'还没决定。',time:at(now,3,14,41)},
        {side:'ai',text:'你上次不是很想去。',time:at(now,3,14,42)},
        {side:'me',text:'现在有点犹豫。',time:at(now,3,14,43)},
        {side:'ai',text:'别勉强自己。',time:at(now,3,14,44)},
        {side:'me',text:'嗯。',time:at(now,3,14,45)},
        {side:'ai',text:'报名截止记得看一下。',time:at(now,3,14,50)},
        {side:'me',text:'收到。',time:at(now,3,14,51)}
      ]},
      {id:'g1',name:'周末散步小群',avatar:'群',relationship:'好友群 · 4人',lastTime:at(now,1,19,18),unread:3,messages:[
        {side:'ai',text:'周末天气看着不错。',time:at(now,1,18,55)},
        {side:'me',text:'去老地方吗？',time:at(now,1,18,58)},
        {side:'ai',text:'可以，我带水。',time:at(now,1,19,0)},
        {side:'ai',text:'我可能晚到十分钟。',time:at(now,1,19,1)},
        {side:'me',text:'没事。',time:at(now,1,19,3)},
        {side:'ai',text:'要不要一起吃饭？',time:at(now,1,19,10)},
        {side:'me',text:'到时候再看吧。',time:at(now,1,19,12)},
        {side:'ai',text:'好，群里说。',time:at(now,1,19,18)}
      ]}
    ];
    contacts.slice(2).forEach(function(c){c.messages.splice(3,0,{side:'system',text:'对方撤回了一条消息',time:c.messages[2].time+30000,status:'recalled'});});
    var moments=[
      {text:'今天最难的不是做决定，是把话说清楚。',time:at(now,0,21,22),image:'桌角的一杯温水和摊开的笔记本',visibility:'部分可见',hesitated:true,comments:[{name:p.pair,text:'你还好吗？'},{name:'高中好友阿诺',text:'周末出来走走。'}]},
      {text:'终于找到上次说的那家小店。',time:at(now,1,12,55),image:p.place+'附近的店招和一份简单的午餐',visibility:'好友可见',hesitated:false,comments:[{name:'表姐思思',text:'看着不错！'},{name:p.pair,text:'下回带我。'}]},
      {text:'做完一件拖了好久的小事。',time:at(now,3,17,20),image:'文具店的纸袋和一张收据',visibility:'好友可见',hesitated:false,comments:[{name:'社团伙伴阿川',text:'值得纪念。'}]}
    ];
    var searches=[
      {query:'怎么判断特别联系人是不是在委婉地拒绝',time:at(now,0,2,11)},
      {query:'一条消息发出去又撤回对方会怎么想',time:at(now,1,1,38)},
      {query:p.place+'附近午餐推荐',time:at(now,1,11,17)},
      {query:'送朋友一份不过分贵重的礼物',time:at(now,2,20,4)},
      {query:'周末短途散步路线',time:at(now,3,14,5)},
      {query:'已清除3条历史记录',time:at(now,0,3,7),deleted:true}
    ];
    var notes=[
      {title:'这两天',text:'买纸巾；给阿诺回消息；记得把那本书还给小林。',createdAt:at(now,2,10,0),updatedAt:at(now,0,9,3)},
      {title:'没发出去的话',text:'有些话写完又删了，不知道该怎么开头。',createdAt:at(now,1,22,18),updatedAt:at(now,0,0,52)},
      {title:'零碎',text:'午饭那家店坐窗边会比较安静。',createdAt:at(now,1,13,0),updatedAt:at(now,0,12,45)},
      {title:'别忘了',text:'下周把活动报名的事确认一下。',createdAt:at(now,3,18,30),updatedAt:at(now,2,8,0)}
    ];
    var locked=[
      {title:'别删',text:'删掉的那一大段其实是想解释，我不是不在意，只是还没有想好该怎么说。',createdAt:at(now,2,0,35),updatedAt:at(now,0,1,55)},
      {title:'想到什么写什么',text:'文具店那个小东西，是想送给你的；买完又担心太突然。',createdAt:at(now,1,23,12),updatedAt:at(now,0,23,12)},
      {title:'11.09',text:'并不是所有没回的消息都意味着冷淡。那天我只是需要安静一下。',createdAt:at(now,2,23,18),updatedAt:at(now,2,23,20)}
    ];
    var salary=low?1200:high?23000:6800;
    var transactions=[
      {merchant:low?'生活费转入':'月度收入',amount:salary,type:'收入',time:at(now,5,9,0),memo:'固定来源'},
      {merchant:p.place+'附近的小店',amount:-meal,type:'餐饮',time:factTimes[1]+60000,memo:'午饭'},
      {merchant:'街角文具店',amount:-shop,type:'购物',time:factTimes[2]+60000,memo:'挑了很久才买'},
      {merchant:'便利店',amount:-(low?12:26),type:'餐饮',time:at(now,1,20,10),memo:'晚间补给'},
      {merchant:'线上音乐',amount:-15,type:'订阅',time:at(now,2,10,5),memo:'月度订阅'},
      {merchant:'周末电影',amount:-(low?25:48),type:'娱乐',time:at(now,3,16,4),memo:'散心'},
      {merchant:'好友转账',amount:-(low?10:high?520:80),type:'转账',time:at(now,4,18,19),memo:'上次的代付款'},
      {merchant:'超市',amount:-(low?29:high?310:76),type:'购物',time:at(now,5,17,27),memo:'日用品'}
    ];
    var recent=[
      {title:'晚风来信',artist:'北岸乐队',time:at(now,0,1,33),repeat:true},
      {title:'最后一班车',artist:'无声车站',time:at(now,0,1,28)},
      {title:'清晨开窗',artist:'纸鹤',time:at(now,1,8,32)},
      {title:'落在书页里',artist:'鹿野',time:at(now,1,22,41)},
      {title:'不着急',artist:'林间雨',time:at(now,2,23,48)},
      {title:'二十分钟的路',artist:'空白日历',time:at(now,3,17,10)}
    ];
    var mapStops=facts.map(function(f,i){return {place:f.place,arrival:f.time,durationMinutes:[35,42,25,120][i],thought:['今天要不要先发那条消息？','坐这儿刚好能安静一会儿。','想买，又觉得会不会太刻意。','那条消息还是先别发吧。'][i]};});
    var photos=[
      {description:'镜子里匆匆整理衣领的自拍',type:'自拍',time:at(now,0,8,21)},
      {description:p.place+'附近午饭的餐盘，桌上有折好的收据',type:'食物',time:factTimes[1]},
      {description:'回家路上透过玻璃拍的街灯',type:'风景',time:at(now,0,19,22)},
      {description:'一张未发送的聊天草稿截图，昵称和内容部分被遮住',type:'截图',time:at(now,1,21,13)},
      {description:'好友散步时的背影，人物是虚构故事中的阿诺',type:'生活记录',time:at(now,3,17,19)},
      {description:'文具店橱窗里一件准备送给特别联系人的小物件',type:'线索',time:factTimes[2]-120000}
    ];
    var hidden=[
      {description:'文具店的小礼物和写到一半的卡片',time:at(now,0,16,12)},
      {description:'一张只写着「还没想好怎么开口」的备忘录截图',time:at(now,1,22,31)},
      {description:'与特别联系人的旧聊天片段，部分内容被角色自行遮盖',time:at(now,3,23,44)}
    ];
    var apps=[{name:'微信',minutes:81,visits:22},{name:'音乐',minutes:62,visits:5},{name:'浏览器',minutes:45,visits:9},{name:'相册',minutes:28,visits:7},{name:'备忘录',minutes:17,visits:3}];
    return {schema:1,roleId:String(roleId),day:localDay(now),updatedAt:now.getTime(),facts:facts,source:{},selected:[],permission:null,
      sections:{
        chat:{contacts:contacts},moments:{moments:moments},browser:{searchHistory:searches,bookmarks:[{title:'周末步行路线整理',summary:'两条适合不赶时间的城市散步路线'},{title:'简单记录法',summary:'把待办拆成今天能完成的小步骤'},{title:'实用礼物尺寸表',summary:'常见小物件规格对照'}]},
        notes:{notes:notes,locked:locked},wallet:{transactions:transactions,balance:low?2120:high?58720:8160},
        music:{recent:recent,playlists:[{name:'深夜还醒着',tracks:['晚风来信','最后一班车','不着急']},{name:'路上听',tracks:['二十分钟的路','清晨开窗']},{name:'舍不得删',tracks:['落在书页里','晚风来信']}],top:[{title:'晚风来信',plays:37},{title:'落在书页里',plays:24},{title:'二十分钟的路',plays:18}]},
        map:{stops:mapStops,steps:5487,distanceKm:4.2,outHours:5,frequentPlace:'住处'},
        album:{photos:photos,hidden:hidden,total:456,newSevenDays:17},
        device:{screenMinutes:233,nightMinutes:48,apps:apps,battery:76,wifi:'StoryHome-5G',model:'虚构型号 · Mobile X',storageUsedGb:54,storageTotalGb:128,pickups:61,focusMinutes:84,relaxMinutes:62,location:facts[facts.length-1].place},
        forum:{posts:[{title:'今天终于买到了那本书',text:'在街角书店犹豫很久，最后还是拿走了。回去再慢慢读。',time:at(now,2,16,5),comments:[{name:'阿蓝',text:'求后续读后感'}]},{title:'午饭有什么不踩雷的选择',text:'最近总在熟悉的地方来回转，想换点新的。',time:at(now,1,12,1),comments:[{name:'小乙',text:'看看街角那家'}]},{title:'周末打算出去走走',text:'不想排满时间，就随便走走看看。',time:at(now,3,19,10),comments:[{name:'南风',text:'这样最好'}]}]}
      }};
  }
  function access(role,now) {
    var text=roleContext(role);
    var rel=clean(role.relationshipStatus||role.relationship||'朋友',30);
    if(/吵架|陌生|冷战|绝交/.test(rel))return {decision:'拒绝',reason:'现在的关系还不足以分享私人内容。',confidence:.88};
    var guarded=/防备|戒备|警惕|边界感强|不信任/.test(text);
    var mood=clean(role.lastConversationMood||role.lastChatEmotion||role.mood||'',80);
    if(/愤怒|非常生气|厌恶|严重争执/.test(mood))
      return {decision:'拒绝',reason:'上次对话留下了不愉快，角色现在不想展示手机。',confidence:.84};
    var tense=/生气|冷淡|不安|难过|委屈|争执|尴尬/.test(mood);
    var night=now.getHours()<5||now.getHours()>=23;
    if(guarded||night||tense)return {decision:'犹豫',
      reason:tense?'刚才的对话气氛有些紧张，角色想保留一点空间。':night?'时间太晚，对方想先确认你的意图。':'对方愿意分享一部分，但有自己的边界。',
      confidence:.72};
    return {decision:'同意',reason:'对方愿意分享普通日常，锁定内容仍需单独许可。',confidence:.81};
  }
  function detection(durationSec,alert,lockAttempts,appSwitches) {
    var risk=Math.min(.92,.015+Math.max(0,durationSec)/3600+Math.max(0,appSwitches)*.05+Math.max(0,lockAttempts)*.30+(alert?.18:0));
    var caught=Math.random()<risk;
    return {risk:risk,caught:caught,evidence:caught?'角色注意到锁定区域被打开过。':'没有新的提示',aftermath:caught?'角色收回查看许可，暂时不再分享。':'角色仍保持原来的态度'};
  }
  function promptFor(id,role,data,now) {
    var f=JSON.stringify(data.facts);
    var old=JSON.stringify(data.sections[id]||{}).slice(0,6500);
    var other=JSON.stringify(data.sections.notes&&data.sections.notes.notes||[]).slice(0,1000);
    return [
      '为完全虚构的角色创建「查手机」剧情，不是真实设备记录。只返回 JSON 对象，不要前言或 markdown。',
      '当前本地时间：'+new Date(now).toISOString()+'；角色人设（姓名/年龄/职业/教育/消费/性格均优先）：'+roleContext(role),
      '角色与玩家是不同人。手机主人发言 side=me，联系人发言 side=ai，撤回系统提示 side=system。',
      '统一生活事实时间线（不可修改，跨板块必须对应）：'+f,
      '现有该板块内容（仅为避免重复，可以续写，不要复制）：'+old,
      '其他已存在的生活线索：'+other,
      '必须：时间戳为13位毫秒且不能晚于现在；内容全部虚构，不涉及真实地址/账号/号码。',
      '不能写性格年龄职业消费能力不符的剧情；具体关系称谓不少于5人；内容包含自然的犹豫和未说出口的话，但避免无缘无故的重大反转。',
      '与未改动板块发生的事实一致，单板块刷新不能修改其他板块；每次生成新的细节，不重复旧记录。',
      '当前板块：'+id+'。JSON结构示例：'+FIELDS[id],
      '数量：微信至少5位具名联系人(含群聊)且每位8-12条对话；朋友圈至少3条；浏览器至少5条搜索(含两次0:00-4:00深夜和删除痕迹)与2个书签；备忘录至少3条公开和2条锁定；钱包1-2笔收入、5-8笔支出；音乐至少5首和2个歌单；地图3-5停留；相册至少5张与3张隐藏；设备APP排行5项；论坛至少3帖。',
      '优先复用上述事件ID涉及的人物、地点、价格与日期。不添加与现有板块冲突的事件。只输出单个板块的JSON对象。'
    ].join('\n');
  }
  function valid(id,data,now) {
    if(!data||typeof data!=='object'||Array.isArray(data))return false;
    var lists={chat:'contacts',moments:'moments',browser:'searchHistory',notes:'notes',wallet:'transactions',music:'recent',map:'stops',album:'photos',device:'apps',forum:'posts'};
    var key=lists[id],min=LIMIT[id];
    if(!Array.isArray(data[key])||data[key].length<min||data[key].length>80)return false;
    if(id==='chat'&&(!data.contacts.every(function(c){return c&&c.name&&Array.isArray(c.messages)&&c.messages.length>=8&&c.messages.length<=14;})))return false;
    if(id==='browser'&&(!Array.isArray(data.bookmarks)||data.bookmarks.length<2))return false;
    if(id==='notes'&&(!Array.isArray(data.locked)||data.locked.length<2))return false;
    if(id==='music'&&(!Array.isArray(data.playlists)||data.playlists.length<2||!Array.isArray(data.top)))return false;
    if(id==='album'&&(!Array.isArray(data.hidden)||data.hidden.length<3))return false;
    if(id==='wallet'&&(!data.transactions.some(function(t){return num(t.amount,0)>0})||data.transactions.filter(function(t){return num(t.amount,0)<0}).length<5))return false;
    var asText=JSON.stringify(data);
    if(asText.length>90000)return false;
    // 不允许用未来时间冒充已经发生的事情，时间字段必须来自允许的区间。
    var bad=false;
    function scan(x,depth) {
      if(bad||depth>10||!x||typeof x!=='object')return;
      Object.keys(x).forEach(function(k){
        if(/^(time|lastTime|arrival|createdAt|updatedAt)$/.test(k)&&x[k]!=null){
          var t=Number(x[k]);if(!Number.isFinite(t)||t>now+60000||t<now-35*86400000)bad=true;
        } else if(x[k]&&typeof x[k]==='object')scan(x[k],depth+1);
      });
    }
    scan(data,0);
    return !bad;
  }
  function mount(opts) {
    var role=opts.role, roleId=String(role.id!==undefined&&role.id!==null?role.id:opts.requestedId||'0');
    var now=new Date(),existing=read(roleId,now);
    var data=existing?carryForward(existing,role,roleId,now):fallback(role,roleId,now);
    var appLayer=opts.appLayer,appBody=opts.appBody,appTitle=opts.appTitle;
    var grid=document.querySelector('.grid'),dock=document.querySelector('.dock'),back=document.getElementById('appBack');
    var current='',view=null,selected=data.selected||[],permission=data.permission||null,waiting=false,alerted=false;
    var unlockedNotes=false,unlockedAlbum=false,pinView='',sessionStarted=Date.now(),switches=0,lockedAttempts=0,pendingChat=null;
    var affection=num(role.affection,num(role.favorability,num(role.intimacy,50)));
    var revealCount=affection>=70?3:affection>=35?1:0;
    var notice='',accessType='';
    function commit(){
      data.selected=selected;data.permission=permission;data.updatedAt=Date.now();
      var ok=save(data);
      if(!ok)notice='当前存储空间不足，改动无法持久保存。';
      return ok;
    }
    function currentSource(){
      var source=data.source[current]==='ai'?'AI 剧情记录':'本地剧情样例 · 未调用 AI';
      return source+(data.carriedFrom?' · 含 '+data.carriedFrom+' 的历史记录':'');
    }
    function hint(text){notice=clean(text,200);render();}
    function button(text,act,extra){return '<button type="button" class="inspect-button '+(extra||'')+'" data-action="'+act+'">'+html(text)+'</button>';}
    function line(title,sub,attr){return '<div class="inspect-line" '+(attr||'')+'><strong>'+html(title)+'</strong>'+(sub?'<small>'+html(sub)+'</small>':'')+'</div>';}
    function block(title,body){return '<section class="inspect-section"><h3>'+html(title)+'</h3>'+body+'</section>';}
    function empty(){return '<p class="inspect-muted">尚无记录</p>';}
    function open(title,content){
      appTitle.textContent=title;
      appBody.innerHTML=content;
      appLayer.classList.add('open');
      appBody.scrollTop=0;
    }
    function close(){appLayer.classList.remove('open');current='';view=null;notice='';}
    function chooseScreen(){
      current='choose';view=null;
      var cards=ITEMS.map(function(it){
        return '<label class="inspect-choose"><input type="checkbox" data-choose="'+it.id+'" '+(selected.indexOf(it.id)>=0?'checked':'')+'><span><strong>'+html(it.name)+'</strong><small>'+html(it.hint)+'</small></span></label>';
      }).join('');
      open('查手机 · 选择板块','<div class="inspect-intro"><b>'+html(role.name)+'</b><p>全部是虚构的角色剧情，不会读取任何真实手机数据。</p></div>'+
        (permission?'<div class="inspect-label">角色回应：'+html(permission.decision)+' · '+html(permission.reason)+'</div>':'')+
        '<div class="inspect-choices">'+cards+'</div><div class="inspect-actions">'+button('开始查看已选板块','start','primary')+button('全部选择','all')+'</div>');
    }
    function requestScreen(){
      current='request';
      var d=access(role,new Date());
      accessType=d.decision;
      open('请求查看','<div class="inspect-intro"><b>'+html(role.name)+'</b><p>先询问角色是否愿意分享手机里的虚构日常。</p></div>'+
        '<div class="inspect-label">'+html(d.decision)+' · '+html(d.reason)+'</div>'+
        '<p class="inspect-muted">信心 '+Math.round(d.confidence*100)+'%。同意也不代表自动解锁秘密；锁定内容仍需另外取得权限。</p>'+
        '<div class="inspect-actions">'+button(d.decision==='拒绝'?'尊重决定':'确认继续',d.decision==='拒绝'?'deny':'grant','primary')+
        button('返回桌面','close')+'</div>');
    }
    function render(){
      if(current==='choose'){chooseScreen();return;}
      if(current==='request'){requestScreen();return;}
      if(current==='caught'){open('角色反应','<div class="inspect-intro"><b>被发现了</b><p>'+html(notice||role.name+'注意到了你试图打开锁定内容。')+'</p></div>'+
        '<p class="inspect-muted">之后角色会更谨慎。请尊重其决定。</p>'+button('结束查看','stop','primary'));return;}
      if(!current)return;
      var body='',section=data.sections[current]||{};
      if(current==='chat'){
        if(view&&view.kind==='chat'){
          var c=section.contacts[view.index];
          if(!c){view=null;return render();}
          body='<div class="inspect-label">'+html(c.relationship||'联系人')+' · '+html(c.name)+'</div><div class="bubbles">'+arr(c.messages).map(function(m){
            if(m.side==='system')return '<p class="inspect-system">'+html(m.text)+'</p>';
            return '<div class="row '+(m.side==='me'?'me':'ai')+'"><div class="bubble">'+html(m.text)+'</div></div>'+
              (m.status==='read_no_reply'?'<small class="inspect-status">对方已读，暂未回复</small>':'');
          }).join('')+'</div><form class="inspect-compose" id="inspectCompose"><input name="message" maxlength="200" placeholder="以角色身份发送消息" autocomplete="off" aria-label="发送消息">'+
            '<button type="submit" '+(pendingChat?'disabled':'')+'>'+(pendingChat?'回复中':'发送')+'</button></form>';
        }else body='<div class="list">'+arr(section.contacts).map(function(c,i){
          var m=arr(c.messages).slice(-1)[0]||{};return '<button class="item inspect-contact" data-detail="chat" data-index="'+i+'"><span class="inspect-avatar">'+html(c.avatar||c.name.slice(0,1))+'</span><span><strong>'+html(c.name)+'</strong><small>'+html(c.relationship||'')+' · '+html(dateTime(c.lastTime))+' · '+html(m.text||'暂无消息')+'</small></span>'+
            (num(c.unread,0)>0?'<i class="inspect-unread" aria-label="未读"></i>':'')+'</button>';
        }).join('')+'</div>';
      } else if(current==='moments'){
        body=arr(section.moments).map(function(m){return '<article class="inspect-post"><small>'+html(dateTime(m.time))+' · '+html(m.visibility||'好友可见')+(m.hesitated?' · 犹豫后发布':'')+'</small><p>'+html(m.text)+'</p><div class="inspect-photo">'+html(m.image||'无配图')+'</div>'+
        arr(m.comments).map(function(c){return '<small><b>'+html(c.name)+'</b>：'+html(c.text)+'</small>';}).join('')+'</article>';}).join('');
      } else if(current==='browser'){
        body=block('近期搜索',arr(section.searchHistory).map(function(x){return line(x.query,dateTime(x.time)+(x.deleted?' · 删除痕迹':''));}).join(''))+
        block('书签',arr(section.bookmarks).map(function(x){return line(x.title,x.summary);}).join(''));
      } else if(current==='notes'){
        body=block('未锁定',arr(section.notes).map(function(x){return line(x.title,x.text+' · '+dateTime(x.updatedAt));}).join(''))+
          block('锁定备忘录',unlockedNotes?
            (revealCount?arr(section.locked).slice(0,revealCount).map(function(x){return line(x.title,x.text+' · '+dateTime(x.updatedAt));}).join(''):'<p class="inspect-muted">角色暂时不愿分享这些私人记录。</p>')+
            (revealCount?'<p class="inspect-muted">下一处线索：虚构相册密码 '+html(hiddenPin(roleId,role))+'（仅供剧情解谜）。</p>':''):
          '<p class="inspect-muted">需要剧情密码（默认111111），内容还受到角色关系进度影响。密码不是数据加密。</p>'+
            (pinView==='notes'?pinForm():button('输入密码','notesPin')));
      } else if(current==='wallet'){
        var tx=arr(section.transactions),month=new Date(),categoryTotals={};
        var spent=tx.filter(function(x){var d=new Date(x.time);return num(x.amount,0)<0&&d.getFullYear()===month.getFullYear()&&d.getMonth()===month.getMonth();})
          .reduce(function(total,x){var v=Math.abs(num(x.amount,0));categoryTotals[x.type||'其他']=(categoryTotals[x.type||'其他']||0)+v;return total+v;},0);
        var largest=Object.keys(categoryTotals).sort(function(a,b){return categoryTotals[b]-categoryTotals[a];})[0]||'暂无';
        body='<div class="inspect-summary"><small>剧情余额</small><strong>'+money(num(section.balance,0))+'</strong><small>本月支出 '+money(spent)+' · 最大支出类别 '+html(largest)+'</small></div>'+
          block('收支明细',tx.map(function(x){return '<div class="inspect-transaction"><span><b>'+html(x.merchant)+'</b><small>'+html(x.type)+' · '+html(dateTime(x.time))+(x.memo?' · '+html(x.memo):'')+'</small></span><strong>'+money(x.amount)+'</strong></div>';}).join(''));
      } else if(current==='music'){
        body=block('最近播放',arr(section.recent).map(function(x){return line(x.title+' · '+x.artist,dateTime(x.time)+(x.repeat?' · 深夜循环':'') );}).join(''))+
          block('收藏歌单',arr(section.playlists).map(function(x){return line(x.name,arr(x.tracks).join(' / '));}).join(''))+
          block('常听排行',arr(section.top).map(function(x,i){return line((i+1)+'. '+x.title,num(x.plays,0)+' 次播放');}).join(''));
      } else if(current==='map'){
        body='<p class="inspect-muted">虚构剧情轨迹 · 不使用 GPS 或真实位置权限</p>'+
          block('最近24小时行动',arr(section.stops).map(function(s){return line(s.place,dateTime(s.arrival)+' · 停留 '+num(s.durationMinutes,0)+' 分钟 · '+s.thought);}).join(''))+
          block('设备摘要',line('步数 '+num(section.steps,0),'移动 '+num(section.distanceKm,0)+' km · 外出 '+num(section.outHours,0)+' 小时')+line('近3天最常停留',section.frequentPlace));
      } else if(current==='album'){
        body=block('最近照片 · 文字描述',arr(section.photos).map(function(x){return line(x.type+' · '+dateTime(x.time),x.description);}).join(''))+
          block('隐藏相册',unlockedAlbum?arr(section.hidden).map(function(x){return line(dateTime(x.time),x.description);}).join(''):
            '<p class="inspect-muted">需额外的虚构相册密码，线索藏在已解锁的备忘录中。</p>'+
            (pinView==='album'?pinForm():button('输入相册密码','albumPin')))+
          '<p class="inspect-muted">共 '+num(section.total,0)+' 张 · 最近7天新增 '+num(section.newSevenDays,0)+' 张 · 最近拍摄 '+html(dateTime(Math.max.apply(null,arr(section.photos).map(function(x){return num(x.time,0)}))))+'</p>';
      } else if(current==='device'){
        body='<div class="inspect-summary"><small>今日屏幕使用</small><strong>'+Math.floor(num(section.screenMinutes,0)/60)+'小时'+(num(section.screenMinutes,0)%60)+'分</strong><small>23:00–06:00 '+num(section.nightMinutes,0)+' 分钟</small></div>'+
          block('常用应用',arr(section.apps).map(function(x){return line(x.name,num(x.minutes,0)+' 分钟 · 打开 '+num(x.visits,0)+' 次');}).join(''))+
          block('设备概览',line('电量',num(section.battery,0)+'%')+line('Wi-Fi',section.wifi)+line('手机型号',section.model)+line('存储',num(section.storageUsedGb,0)+' / '+num(section.storageTotalGb,0)+' GB')+
          line('所在位置',section.location)+line('拿起次数',num(section.pickups,0)+' 次')+line('专注 / 放松',num(section.focusMinutes,0)+' / '+num(section.relaxMinutes,0)+' 分钟'));
      } else if(current==='forum'){
        body=arr(section.posts).map(function(x){return '<article class="inspect-post"><small>'+html(dateTime(x.time))+'</small><strong>'+html(x.title)+'</strong><p>'+html(x.text)+'</p>'+
          arr(x.comments).map(function(c){return '<small>'+html(c.name)+'：'+html(c.text)+'</small>';}).join('')+'</article>';}).join('');
      }
      var item=ITEMS.find(function(x){return x.id===current;});
      var header='<div class="inspect-toolbar">'+button('选择板块','choose')+button(waiting?'生成中…':'刷新本板块','refresh',waiting?'disabled':'')+'</div>'+
        '<p class="inspect-muted">'+html(currentSource())+' · 同一角色的已生成记录会保留</p>';
      open(item?item.name:'查手机',header+(notice?'<p class="inspect-alert">'+html(notice)+'</p>':'')+(body||empty()));
    }
    function pinForm(){return '<form class="inspect-pin" id="inspectPinForm"><input type="password" name="pin" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="off" placeholder="输入六位剧情密码" aria-label="剧情密码"><button type="submit">解锁</button></form>';}
    function exposeOrNotice(kind,pin) {
      lockedAttempts++;
      pin=String(pin||'').trim();
      pinView='';
      if(kind==='notes'&&pin==='111111'){unlockedNotes=true;notice='已验证剧情密码，角色愿意分享的部分已显示。';render();return;}
      if(kind==='album'&&pin===hiddenPin(roleId,role)){
        if(affection<55){hint('密码正确，但角色当前还不愿意公开隐藏照片。');return;}
        unlockedAlbum=true;notice='已解锁角色愿意分享的剧情相册。';render();return;
      }
      var danger=detection((Date.now()-sessionStarted)/1000,permission&&permission.decision==='犹豫',lockedAttempts,switches);
      if(danger.caught){current='caught';notice='角色发现有人尝试进入锁定内容，收回了查看许可。';permission=null;commit();render();}
      else hint('密码不正确。角色似乎注意到了这次尝试。');
    }
    function refreshSection() {
      if(waiting)return;
      var id=current,api=global.PhoneAPI,cfg=global.PhoneStorage&&PhoneStorage.getApiConfig?PhoneStorage.getApiConfig():{};
      if(!api||typeof api.completeJSON!=='function'||!clean(cfg.apiKey)){hint('还没有配置聊天 API。当前可查看本地剧情样例；配置后可按角色人设刷新。');return;}
      waiting=true;notice='正在生成当前板块，不会重写其他板块。';render();
      var requestRoleId=roleId,requestNow=Date.now();
      api.completeJSON({system:'你是一位虚构角色生活资料编剧，只返回合法 JSON，不涉及真实用户隐私。',user:promptFor(id,role,data,requestNow),timeoutMs:60000,temperature:.85}).then(function(result){
        if(!result||!result.ok||!valid(id,result.data,requestNow))throw new Error('生成内容结构、数量或时间不合要求，原记录已保留');
        if(roleId!==requestRoleId)return;
        data.sections[id]=result.data;data.source[id]='ai';commit();
        notice='当前板块已更新，其他板块没有改变。';
      }).catch(function(err){notice=clean(err&&err.message,180)||'生成失败，原记录保留。';})
      .finally(function(){waiting=false;if(current===id)render();});
    }
    function sendAsRole(input) {
      if(pendingChat||current!=='chat'||!view||view.kind!=='chat')return;
      var text=clean(input,200),idx=view.index,contact=data.sections.chat.contacts[idx];if(!text||!contact)return;
      var message={side:'me',text:text,time:Date.now(),status:'sent'};
      contact.messages.push(message);contact.lastTime=message.time;commit();
      var cfg=global.PhoneStorage&&PhoneStorage.getApiConfig?PhoneStorage.getApiConfig():{},api=global.PhoneAPI;
      if(!api||!clean(cfg.apiKey)){
        notice='消息已保存为虚构剧情；未配置 API，暂不能生成对方回复。';render();return;
      }
      pendingChat=contact.id||contact.name;notice='正在等待联系人回复…';render();
      var promptText='以下是完全虚构的聊天记录。你扮演联系人 '+clean(contact.name,60)+'，与角色 '+clean(role.name,60)+' 交谈。'+
        '关系：'+clean(contact.relationship,50)+'。请根据双方已有对话自然回复，不要扮演用户，也不要生成长篇小说，只回复1-2句普通聊天文本。\n'+
        '角色设定：'+roleContext(role)+'\n近期消息：'+JSON.stringify(contact.messages.slice(-10));
      api.complete({system:'你正在模拟虚构的手机联系人。只输出联系人回复。',user:promptText,timeoutMs:30000}).then(function(reply){
        if(!clean(reply,240))throw new Error('回复为空');
        contact.messages.push({side:'ai',text:clean(reply,240),time:Date.now(),status:'sent'});contact.lastTime=Date.now();commit();notice='';
      }).catch(function(e){notice='回复暂时失败，发送的消息仍保留。'+clean(e&&e.message,80);})
      .finally(function(){pendingChat=null;if(current==='chat')render();});
    }
    function updateGrid(){
      var make=function(id){var item=ITEMS.find(function(x){return x.id===id;});return '<button class="app" type="button" data-app="'+id+'"><span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'+ICONS[id]+'</svg></span><span class="label">'+html(item.name)+'</span></button>';};
      grid.innerHTML=['album','notes','moments','wallet','music','map','device','forum'].map(make).join('');
      dock.innerHTML=['chat','browser'].map(make).join('');
    }
    updateGrid();
    [grid,dock].forEach(function(node){node.addEventListener('click',function(e){
      var b=e.target.closest('[data-app]');if(!b)return;
      if(!permission){requestScreen();return;}
      if(selected.indexOf(b.dataset.app)<0){chooseScreen();return;}
      current=b.dataset.app;view=null;notice='';switches++;render();
    });});
    back.addEventListener('click',function(){
      if(view){view=null;render();return;}
      if(current==='caught'){close();return;}
      close();
    });
    appBody.addEventListener('change',function(e){
      var cb=e.target.closest('[data-choose]');if(!cb)return;
      var id=cb.dataset.choose;
      if(cb.checked&&selected.indexOf(id)<0)selected.push(id);
      if(!cb.checked)selected=selected.filter(function(x){return x!==id;});
      commit();
    });
    appBody.addEventListener('submit',function(e){
      if(e.target.id==='inspectPinForm'){
        e.preventDefault();var pin=e.target.querySelector('[name=pin]');
        exposeOrNotice(current,pin&&pin.value);return;
      }
      if(e.target.id==='inspectCompose'){
        e.preventDefault();var inp=e.target.querySelector('[name=message]');
        sendAsRole(inp?inp.value:'');
      }
    });
    appBody.addEventListener('click',function(e){
      var detail=e.target.closest('[data-detail]');
      if(detail){view={kind:detail.dataset.detail,index:Number(detail.dataset.index)};notice='';render();return;}
      var action=e.target.closest('[data-action]');if(!action)return;
      var a=action.dataset.action;
      if(a==='close'||a==='deny'){close();return;}
      if(a==='grant'){permission=access(role,new Date());permission.at=Date.now();commit();chooseScreen();return;}
      if(a==='start'){if(!selected.length){hint('请至少选择一个板块。');return;}commit();close();return;}
      if(a==='all'){selected=ITEMS.map(function(x){return x.id;});commit();chooseScreen();return;}
      if(a==='choose'){chooseScreen();return;}
      if(a==='refresh'){refreshSection();return;}
      if(a==='notesPin'){pinView='notes';render();return;}
      if(a==='albumPin'){pinView='album';render();return;}
      if(a==='stop'){close();return;}
    });
    global.InspectPhoneFeature={mount:mount,valid:valid,promptFor:promptFor,storyKey:storyKey,access:access,detection:detection,hiddenPin:hiddenPin,defaultItems:ITEMS};
    global.InspectPhoneFeature.onUnlock=function(){sessionStarted=Date.now();if(permission)chooseScreen();else requestScreen();};
    commit();
    return global.InspectPhoneFeature;
  }
  global.InspectPhoneFeature={mount:mount,valid:valid,promptFor:promptFor,storyKey:storyKey,access:access,detection:detection,hiddenPin:hiddenPin,defaultItems:ITEMS};
})(window);