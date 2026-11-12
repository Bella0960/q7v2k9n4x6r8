/* MAOMAO / InspectPhoneLifeClock
 * Deterministic offline story catch-up, NOT a server cron or AI response.
 * Daily episodes are shared facts referenced by each fictional app.
 * Side effects limited to the supplied role-owned story object.
 */
(function(global){
  'use strict';
  var VERSION=1, MAX_DAYS=7, HOUR=21, MINUTE=10;
  function list(x){return Array.isArray(x)?x:[];}
  function number(x,b){var n=Number(x);return Number.isFinite(n)?n:b;}
  function day(t){var d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function midnight(t){var d=new Date(t);d.setHours(0,0,0,0);return d;}
  function hash(s){var h=2166136261;for(var i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
  function owns(x,id){return x&&String(x.storyEventId)===id;}
  function has(a,id){return list(a).some(function(x){return owns(x,id)||x&&x.id===id;});}
  function put(a,x,id,limit){
    if(has(a,id))return false;
    a.unshift(x);
    // Only evict synthesized records. Never discard handwritten/player/AI history.
    while(a.length>limit){
      var oldest=-1;
      for(var j=a.length-1;j>=0;j--){if(a[j]&&a[j].origin==='autonomous_story'){oldest=j;break;}}
      if(oldest<0)break;
      a.splice(oldest,1);
    }
    return true;
  }
  function roleType(role){
    var t=[role&&role.occupation,role&&role.job,role&&role.education,role&&role.description].filter(Boolean).join(' ');
    return /学生|在校|大一|大二|大三|高一|高二/.test(t)&&!/毕业|已工作/.test(t)?'school':'work';
  }
  var SCENES=[
    {place:'街角书店',cost:29,object:'一本薄薄的书',photo:'书架和夹在书页里的纸质书签',
     diary:'下班后绕去了一趟书店。原本打算只是进去看看，结果站在书架旁读了很久。带走一本小书，收据夹进了书页。\n\n回家整理聊天时看见小林发来的消息，忽然想起来之前还有一本借来的书没有还。明天该把它放进包里。今天没发生什么大事，但这样普通的晚上也值得记一下。',
     chatA:'刚在书店看了半天，差点忘记时间。',chatB:'你之前说的那本书还没看完吧？',
     post:'今天在旧书架前站了好一会儿',postBody:'本来只想路过看看，后来在书店里待了很久。买了一本不厚的书，准备慢慢读。有人也喜欢随意逛书店吗？'},
    {place:'小巷咖啡店',cost:28,object:'一杯热饮',photo:'靠窗座位和杯边的一张折叠便签',
     diary:'今天走到小巷口的时候有点累，就找了家安静的小店坐下来。靠窗的位置空着，桌面有一点被太阳晒过的温度。\n\n小林说周末想约大家出去走走，我还没有决定。不是不想出门，只是最近想给自己留一点发呆的时间。回去的路上拍了张照片，留着以后再看。',
     chatA:'在小巷里找到一家还挺安静的店。',chatB:'有空发我地址，下次一起去。',
     post:'一个人坐一会儿也挺好',postBody:'今天随意进了一家小店。没有赶着做什么，坐了半小时再回去。偶尔放空一下，很舒服。'},
    {place:'便利店',cost:16,object:'一包日用品',photo:'夜间路口亮着的便利店招牌',
     diary:'晚上回家的路上顺手买了些日用品。排队时想起早上忘掉的事情，拿出手机记在了备忘录里。\n\n有人问我今天怎么样，我想了一会儿才回复。日常里其实有很多琐碎的小事，不一定都值得发朋友圈，但记下来之后，会觉得一天确实好好过完了。',
     chatA:'我到家了，刚在便利店买了点东西。',chatB:'好，那早点整理完休息。',
     post:'记录一件很普通的小事',postBody:'路过便利店买东西，回家后顺手把一天的琐事记下来。你们有没有写零碎日记的习惯？'},
    {place:'文具小店',cost:24,object:'一支细笔',photo:'纸袋、签字笔和写了半句的卡片',
     diary:'在文具店里挑了一会儿，最后买了支手感很好的笔。其实家里还有好几支能用的，但这一支看起来很适合写长一点的东西。\n\n回家翻开旧笔记时发现，前几天写下一半的话还没有补完。算了，今天先把白天的事情记下来。其余的，等想清楚再继续写。',
     chatA:'今天又买了支笔，明明已经有很多支了。',chatB:'你这个习惯是真的改不掉。',
     post:'你们会收藏好用的文具吗',postBody:'今天挑到一支写起来很顺的笔，拿起来就舍不得放下。想听听大家最近用过什么不错的文具。'},
    {place:'社区花店',cost:35,object:'一小束鲜花',photo:'包着素色纸的花束放在书桌一角',
     diary:'经过花店时看到一小束颜色很淡的花。原本没打算买，后来想想，桌上正好缺一点新鲜的东西，就带回来了。\n\n小林发来一张路上的照片，我回了一句挺好看。今晚把桌子整理了一遍，给花找了个杯子插上。看起来很简单，房间却一下有了些不同。',
     chatA:'回来的路上买了束花，放桌上还挺合适。',chatB:'记得换水，别像上次一样忘了。',
     post:'房间里多了一束花',postBody:'偶然路过花店，带了一小束回家。今天的房间看着比昨天更有精神了。'},
    {place:'街边面馆',cost:21,object:'一碗晚饭',photo:'小面馆靠墙的位置和冒着热气的餐盘',
     diary:'晚上没有什么做饭的心情，就在路边找了家小面馆。刚坐下的时候店里很热闹，后来慢慢安静下来。\n\n一边吃饭一边想周末的安排。阿诺之前提过想一起散步，我还没有回复确定时间。回去之后要记得给人家一个准话，不要老让别人等。',
     chatA:'今天晚饭在外面解决了，人还挺多。',chatB:'你最近忙，也别总忘记好好吃饭。',
     post:'熟悉的小店总有点安心',postBody:'最近吃饭总在两三家店里轮换。可能是习惯，也可能是那种熟悉的感觉很难替代。'}
  ];
  function generate(data,role,time){
    var date=day(time),roleId=String(data.roleId||role&&role.id||'role');
    var id='life:'+roleId+':'+date;
    var s=SCENES[hash(roleId+'|'+date)%SCENES.length],type=roleType(role);
    var when=new Date(time);when.setHours(HOUR,MINUTE,0,0);var at=when.getTime();
    var nick=String(role&&role.name||'我');
    var fact={id:id,storyEventId:id,origin:'autonomous_story',time:at,place:s.place,
      event:'晚间在'+s.place+'买下'+s.object,amount:-s.cost};
    var sec=data.sections;
    if(!sec||!sec.notes||!sec.chat||!sec.wallet||!sec.map||!sec.album||!sec.moments||!sec.forum)return 0;
    data.facts=list(data.facts);
    if(has(data.facts,id))return 0;
    var journal={title:date+' · 晚间随记',text:s.diary,createdAt:at+5*60000,
      updatedAt:at+5*60000,origin:'autonomous_story',storyEventId:id};
    var wallet={merchant:s.place,amount:-s.cost,type:'日常消费',
      time:at,memo:s.object,origin:'autonomous_story',storyEventId:id};
    var route={place:s.place,arrival:at,durationMinutes:16,thought:'今天只是想慢慢走一段路。',
      origin:'autonomous_story',storyEventId:id};
    var photo={description:s.photo,type:'生活记录',time:at+8*60000,
      origin:'autonomous_story',storyEventId:id};
    var moment={text:'晚饭以后绕路走了走，刚好经过'+s.place+'。',time:at+10*60000,
      image:s.photo,visibility:'好友可见',hesitated:false,origin:'autonomous_story',
      storyEventId:id,comments:[{name:'阿诺',text:'最近也想出去走走。'}]};
    var forum={title:s.post,text:s.postBody,time:at+15*60000,
      origin:'autonomous_story',storyEventId:id,
      comments:[{name:'南风',text:'这种普通日子也很好。'}]};
    var chat=sec.chat.contacts&&sec.chat.contacts.find(function(c){return c&&c.id!=='user'&&c.id!=='g1';});
    var chatA={side:'me',text:s.chatA,time:at+3*60000,status:'sent',
      origin:'autonomous_story',storyEventId:id};
    var chatB={side:'ai',text:s.chatB,time:at+4*60000,status:'sent',
      origin:'autonomous_story',storyEventId:id};
    put(sec.notes.notes,journal,id,32);
    put(sec.wallet.transactions,wallet,id,40);
    put(sec.map.stops,route,id,36);
    put(sec.album.photos,photo,id,38);
    put(sec.moments.moments,moment,id,35);
    put(sec.forum.posts,forum,id,32);
    if(chat&&Array.isArray(chat.messages)&&!has(chat.messages,id)){
      chat.messages.push(chatA,chatB);
      chat.messages.sort(function(a,b){return number(a.time,0)-number(b.time,0);});
      // A multi-message event is kept as one story ID, but both messages remain.
      while(chat.messages.length>90){
        var index=chat.messages.findIndex(function(m){return m.origin==='autonomous_story';});
        if(index<0)break;chat.messages.splice(index,1);
      }
      chat.lastTime=Math.max(number(chat.lastTime,0),chatB.time);
      chat.unread=Math.max(0,Math.min(99,number(chat.unread,0)+1));
    }
    data.facts.push(fact);
    data.facts.sort(function(a,b){return number(a.time,0)-number(b.time,0);});
    while(data.facts.length>65)data.facts.shift();
    // Only local plot records are added. Never falsely mark them as AI output.
    ['notes','wallet','map','album','moments','forum','chat'].forEach(function(k){
      if(!data.source)data.source={};
      if(!data.source[k])data.source[k]='local-story';
    });
    return 1;
  }
  function advance(data,role,now){
    if(!data||typeof data!=='object'||!data.sections)return {added:0,recovered:0};
    var current=now instanceof Date?now:new Date(now);
    if(!Number.isFinite(current.getTime()))return {added:0,recovered:0};
    var epoch=current.getTime();
    var state=data.lifeClock&&data.lifeClock.version===VERSION?data.lifeClock:null;
    if(!state){
      data.lifeClock={version:VERSION,lastObservedAt:epoch,episodes:0,mode:'catch-up-on-open'};
      return {added:0,recovered:0,initialized:true};
    }
    var prior=number(state.lastObservedAt,epoch);
    if(prior>epoch+60000)return {added:0,recovered:0,clockBackwards:true};
    var beginning=Math.max(prior,epoch-MAX_DAYS*86400000);
    var d=midnight(beginning),latest=midnight(epoch),added=0,checked=0;
    for(var i=0;i<=MAX_DAYS+1&&d.getTime()<=latest.getTime();i++){
      var due=new Date(d);due.setHours(HOUR,MINUTE,0,0);
      var dueTime=due.getTime(),fullyWritten=dueTime+30*60000;
      // Create a complete episode only after all its events could have happened.
      if(fullyWritten>prior&&fullyWritten<=epoch){
        added+=generate(data,role,dueTime);
        checked++;
      }
      d.setDate(d.getDate()+1);
    }
    state.lastObservedAt=epoch;
    state.episodes=number(state.episodes,0)+added;
    state.lastBackfillCount=added;
    state.mode='catch-up-on-open';
    return {added:added,recovered:checked};
  }
  global.InspectPhoneLifeClock={advance:advance,day:day,version:VERSION};
})(window);
