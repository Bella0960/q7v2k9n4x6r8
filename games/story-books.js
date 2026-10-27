/* ============================================================
 * story-books.js  —  互动故事剧本库
 *
 * 想加新剧本？照下面的格式，在 STORY_BOOKS 里再加一个对象就行。
 * 引擎会自动在封面生成卡片、自动隔离存档。
 *
 * 【剧本对象格式】
 *   '你的剧本id': {
 *     meta: {
 *       title:   '剧本名',
 *       subtitle:'英文/拼音小字',
 *       desc:    '一句话简介',
 *       tag:     '题材标签，用 · 分隔',
 *       coverBg:'bg-xxx（封面色调，见下面可用值）',
 *       chars:   ['角色A','角色B']  // 展示用
 *     },
 *     start: 'wake',   // 起始场景 id
 *     scenes: {
 *       '场景id': {
 *         bg: 'bg-xxx',          // 场景背景色
 *         speaker: 'narr',       // narr=旁白 jiang=江屿...（见下）
 *         sprites: ['jiang'],    // 屏幕上显示谁的立绘
 *         text: '对话文本，\n 换行用 \n',
 *         onEnter: {jiang:1},    // 进入时自动加属性（可选）
 *         next: '下一场景id',     // 无选项时的下一场景（可选）
 *         choices: [             // 有选项时（可选）
 *           { t:'选项文字', fx:{jiang:2}, et:'江屿好感 +2', next:'场景id' }
 *         ],
 *         ending: { tag:'ENDING · A', title:'结局名', text:'结局文字' }
 *       }
 *     }
 *   }
 *
 * 【speaker 可选值】narr / jiang / chen / su / me
 *   （新剧本如果有新角色，speaker 直接写名字，引擎会用通用样式）
 *
 * 【bg 可用色调】
 *   bg-dawn 清晨暖米   bg-class 教室白天   bg-roof 天台淡蓝
 *   bg-hall 走廊       bg-basket 篮球场    bg-rain 雨天
 *   bg-night 夜晚      bg-sunset 夕阳      bg-cover 深紫封面
 *
 * 【属性名】在 fx / onEnter 里自定义，引擎会自动建条。
 *   常见：jiang（江屿好感）、chen（陈野好感）、su（苏念友情）、courage、wisdom
 * ============================================================ */

var STORY_BOOKS = {

/* ============ 剧本一：重返高二（重生校园） ============ */
'campus-rebirth': {
  meta: {
    title: '重返高二',
    subtitle: 'REBIRTH · 2019',
    desc: '重生回到十八岁那年九月。你的每个选择，都会导向不同的结局。',
    tag: '校园 · 重生 · 四结局',
    coverBg: 'bg-dawn',
    chars: ['江屿', '陈野', '苏念'],
    charsImg: {
      jiang: 'assets/char-jiang.png',
      chen: 'assets/char-chen.png',
      su: 'assets/char-su.png',
      linwan: 'assets/char-linwan.png'
    },
    charsName: {
      jiang: '江屿', chen: '陈野', su: '苏念', linwan: '林晚'
    },
    statNames: {
      jiang: '江屿好感', chen: '陈野好感', su: '苏念友情', courage: '勇气', wisdom: '智慧'
    },
    bgImg: {
      'bg-dawn':     'assets/bg-classroom.png',
      'bg-class':    'assets/bg-classroom.png',
      'bg-roof':     'assets/bg-rooftop.png',
      'bg-hall':     'assets/bg-sunset.png',
      'bg-basket':   'assets/bg-rooftop.png',
      'bg-rain':     'assets/bg-rain.png',
      'bg-sunset':   'assets/bg-sunset.png'
    }
  },
  start: 'wake',
  scenes: {

wake:{
  bg:'bg-dawn', speaker:'narr',
  text:'早读课的铃声从很远的地方传来。\n你猛地睁开眼，刺眼的阳光透过窗户洒在课桌上。\n\n黑板旁的日历写着——2019年9月2日。',
  sprites:[],
  choices:[
    {t:'掐自己一把', fx:{courage:1}, et:'勇气 +1', next:'reality'},
    {t:'小声问旁边的人：今天几号？', fx:{wisdom:1}, et:'智慧 +1', next:'reality'}
  ]
},
reality:{
  bg:'bg-dawn', speaker:'su',
  text:'「{{player}}！你发什么呆呢？开学第一天就走神，暑假玩疯了？」\n\n同桌{{su}}用胳膊肘捅了你一下。\n\n——你认得她。十年了，你以为自己早就忘了这张脸。',
  sprites:['su'],
  choices:[
    {t:'「我做了个很长的梦。」', fx:{su:1}, et:'{{su}}友情 +1', next:'paperNote'},
    {t:'「……{{su}}，我好想你。」', fx:{su:2}, et:'{{su}}友情 +2', next:'paperNote'}
  ]
},
paperNote:{
  bg:'bg-class', speaker:'narr',
  text:'你深吸一口气，转过头。\n\n旁边坐着的是——{{jiang}}。\n\n前世的这个时候，你和他因为一件小事冷战，从此三年没说过超过十句话。你甚至不知道他后来去了哪所大学。',
  sprites:['jiang'],
  choices:[
    {t:'接过他递来的纸条', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'noteRead'},
    {t:'愣住，没有接', fx:{}, et:'', next:'noteRead'}
  ]
},
noteRead:{
  bg:'bg-class', speaker:'jiang',
  text:'纸条上是清瘦的字：\n\n「脸很白。要不要去医务室？」\n\n他没看你，耳朵尖却有点红。',
  sprites:['jiang'],
  next:'seatChoice'
},
seatChoice:{
  bg:'bg-class', speaker:'narr',
  text:'班主任拍了拍手：「开学第一件事——重新排座位。想坐哪儿，自己说。」',
  sprites:['jiang','su'],
  choices:[
    {t:'「我想继续坐这里。」（{{jiang}}旁边）', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'classMorning'},
    {t:'「我想和{{su}}坐一起。」', fx:{su:1}, et:'{{su}}友情 +1', next:'classSu'},
    {t:'「……随便吧。」', fx:{wisdom:1}, et:'智慧 +1', next:'classMorning'}
  ]
},
classMorning:{
  bg:'bg-class', speaker:'narr',
  text:'第一节课是数学。\n\n{{jiang}}在你旁边做题，笔尖划过纸面的声音很轻。你瞥了一眼他的练习册——\n\n扉页空白处写着一行小字：「想去南方，靠海的学校。」',
  sprites:['jiang'],
  choices:[
    {t:'「你想去哪所大学？」', fx:{jiang:2,wisdom:1}, et:'{{jiang}}好感 +2 · 智慧 +1', next:'rooftop'},
    {t:'不打扰他，自己看书', fx:{}, et:'', next:'rooftop'}
  ]
},
classSu:{
  bg:'bg-class', speaker:'su',
  text:'「{{player}}！」{{su}}凑过来，「下课去篮球场呗？{{chen}}今天第一天训练，说要给你表演三分球。」\n\n你愣了一下。{{chen}}——那个前世毕业聚会后再也没联系过的人。',
  sprites:['su'],
  choices:[
    {t:'「去看看吧。」', fx:{chen:2}, et:'{{chen}}好感 +2', next:'basket'},
    {t:'「不去了，怕尴尬。」', fx:{}, et:'', next:'rooftop'}
  ]
},
rooftop:{
  bg:'bg-roof', speaker:'narr',
  text:'午休。你一个人爬上了天台。\n\n风很大，远处传来操场的哨声。你以为天台上只有自己——\n\n「哟。」\n\n栏杆边靠着的是{{chen}}。校服外套搭在肩上，手里攥着一瓶没开的汽水。',
  sprites:['chen'],
  choices:[
    {t:'「……你怎么在这儿？」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'rooftopTalk'},
    {t:'默默走到另一边吹风', fx:{}, et:'', next:'rooftopTalk'}
  ]
},
rooftopTalk:{
  bg:'bg-roof', speaker:'chen',
  text:'「我爸非让我打篮球，说能保送。」他笑了一下，踢了踢脚边的铁丝网，「可我其实……更喜欢弹吉他。」\n\n他说完自己先愣住了，大概没想到会跟一个不太熟的人说这些。',
  sprites:['chen'],
  choices:[
    {t:'「那你喜欢什么样的歌？」', fx:{chen:2,courage:1}, et:'{{chen}}好感 +2 · 勇气 +1', next:'rain'},
    {t:'「打球也挺好的啊。」', fx:{}, et:'', next:'rain'}
  ]
},
basket:{
  bg:'bg-basket', speaker:'narr',
  text:'篮球场。{{chen}}投进一个三分，转头看见你，整个人僵住，球"咚"地砸在自己头上。\n\n队友爆笑。他捂着额头跑过来，耳朵通红：「你、你怎么来了？」',
  sprites:['chen'],
  choices:[
    {t:'「嗯，路过。」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'rain'},
    {t:'「刚才那个球，三不沾哦。」', fx:{chen:2}, et:'{{chen}}好感 +2', next:'rain'}
  ]
},
rain:{
  bg:'bg-rain', speaker:'narr',
  text:'放学。\n\n雨下得猝不及防。你站在校门口翻遍书包——没带伞。\n\n校门口，{{jiang}}撑着一把黑伞站在梧桐树下，像在等人。\n\n另一边，{{chen}}顶着校服外套从雨里冲出来，大喊你的名字。',
  sprites:['jiang','chen'],
  choices:[
    {t:'走向{{jiang}}', fx:{}, next:'rainJiang'},
    {t:'跑向{{chen}}，一起淋雨', fx:{chen:1,courage:1}, et:'{{chen}}好感 +1 · 勇气 +1', next:'rainChen'},
    {t:'直接冲进雨里', fx:{courage:2}, et:'勇气 +2', next:'rainAlone'}
  ]
},
rainJiang:{
  bg:'bg-rain', speaker:'jiang',
  text:'{{jiang}}把伞往你这边倾了倾：「一起走？我家顺路。」\n\n伞很小，你们的肩膀偶尔碰到。他一直没说话，但伞始终歪向你那边，自己半个肩膀都湿了。',
  sprites:['jiang'],
  choices:[
    {t:'「你肩膀湿了。伞往你那边挪挪。」', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'montage'},
    {t:'不说话，默默把伞扶正', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'montage'}
  ]
},
rainChen:{
  bg:'bg-rain', speaker:'chen',
  text:'{{chen}}把校服外套整个盖在你俩头上：「跑！」\n\n雨砸在外套上噼里啪啦响。你俩一边跑一边笑，像两个傻子。\n\n跑到公交站时，他的头发全贴在额头上，却把干的那半边外套让给了你。',
  sprites:['chen'],
  onEnter:{chen:1},
  next:'montage'
},
rainAlone:{
  bg:'bg-rain', speaker:'narr',
  text:'你把书包顶在头上，一头扎进雨里。\n\n其实没那么糟。雨水顺着头发流下来的时候，你突然觉得——\n\n这一次，你不需要等任何人的伞。',
  sprites:[],
  next:'montage'
},
montage:{
  bg:'bg-night', speaker:'narr',
  text:'【一个月后】\n\n这一个月里，你试着不再重蹈前世的覆辙。\n\n你主动和{{jiang}}借笔记，你听{{chen}}弹了那首他写的歌，你陪{{su}}去了她一直想去的画展。\n\n月考成绩贴出来那天，整个走廊都是人声。',
  sprites:[],
  onEnter:{wisdom:2,courage:2},
  next:'exam'
},
exam:{
  bg:'bg-hall', speaker:'narr',
  text:'你挤到红榜前，踮起脚找自己的名字。',
  sprites:[],
  next:function(st){ return st.wisdom >= 3 ? 'examGood' : 'examMid'; }
},
examGood:{
  bg:'bg-hall', speaker:'jiang',
  text:'年级第47名。\n\n你愣在原地——前世你最好的成绩也只是年级两百名开外。\n\n肩膀被人轻轻敲了一下。{{jiang}}站在你旁边，抱着胳膊：「可以啊。偷偷努力？」',
  sprites:['jiang'],
  choices:[
    {t:'「晚上一起自习？」', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'sportsDay'},
    {t:'笑一下，不说话', fx:{}, et:'', next:'sportsDay'}
  ]
},
examMid:{
  bg:'bg-hall', speaker:'su',
  text:'进步了十二名。\n\n不算耀眼，但你已经很满意了。{{su}}从后面抱住你：「可以啊{{player}}！下次请你喝奶茶！」',
  sprites:['su'],
  next:'sportsDay'
},

/* ===== 第三章：运动会 ===== */
sportsDay:{
  bg:'bg-roof', speaker:'narr',
  text:'十一月。校运动会。\n\n操场上彩旗招展，广播里放着进行曲。{{chen}}在篮球场上热身，{{jiang}}被班长报了一千五百米——他看起来不太情愿。\n\n你站在看台边上，手里攥着两瓶水。',
  sprites:['jiang','chen'],
  choices:[
    {t:'把水递给{{jiang}}（他跑长跑）', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'sportsRun'},
    {t:'去篮球场给{{chen}}加油', fx:{chen:2}, et:'{{chen}}好感 +2', next:'sportsBasket'},
    {t:'找{{su}}一起坐看台', fx:{su:1}, et:'{{su}}友情 +1', next:'sportsWatch'}
  ]
},
sportsRun:{
  bg:'bg-roof', speaker:'jiang',
  text:'{{jiang}}接过水的时候手指碰到你的。他没说话，只是点了点头。\n\n一千五百米。他跑在第二圈就开始喘，但最后一百米突然加速，超过了前面的人。\n\n冲过终点时，他第一个看向的人是你。',
  sprites:['jiang'],
  choices:[
    {t:'递毛巾过去', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'homeVisit'},
    {t:'站在原地笑', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'homeVisit'}
  ]
},
sportsBasket:{
  bg:'bg-basket', speaker:'chen',
  text:'{{chen}}在球场上看见你，整个人像打了鸡血，连进三个三分。\n\n终场哨响，他队友把他抬起来往天上抛。他下来第一件事就是冲过来，满头大汗地问你：「刚才那个三分帅不帅？」',
  sprites:['chen'],
  choices:[
    {t:'「帅。但你投篮姿势有点丑。」', fx:{chen:2,courage:1}, et:'{{chen}}好感 +2 · 勇气 +1', next:'homeVisit'},
    {t:'「特别帅！」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'homeVisit'}
  ]
},
sportsWatch:{
  bg:'bg-roof', speaker:'su',
  text:'{{su}}啃着冰棍坐在你旁边，指着操场：「你看{{chen}}——他往你这边看了三次了。」\n\n你顺着她的手指看过去，正好撞上{{chen}}的目光。他愣了一下，假装转头去看天。',
  sprites:['su'],
  onEnter:{su:1},
  next:'homeVisit'
},

/* ===== 第四章：回家与悬念 ===== */
homeVisit:{
  bg:'bg-night', speaker:'narr',
  text:'运动会结束那天晚上，你回到家。\n\n妈妈端出一碗汤，随口说：「对了，你前阵子状态不对，日记写在抽屉最里面，我没偷看啊。」\n\n你打开抽屉。一个上锁的本子。钥匙在你笔袋的夹层里——你早忘了这回事。',
  sprites:[],
  choices:[
    {t:'打开日记看看', fx:{wisdom:2}, et:'智慧 +2', next:'diaryRead'},
    {t:'不看，把它放回去', fx:{courage:1}, et:'勇气 +1', next:'secret'}
  ]
},
diaryRead:{
  bg:'bg-night', speaker:'narr',
  text:'日记里的字迹是你自己的——但语气很陌生。\n\n「今天又梦见坠楼了。他站在我旁边，但我不敢看他的脸。」\n「如果能重来一次，我一定不会把那封信塞进他抽屉。」\n\n信？你不记得写过什么信。',
  sprites:[],
  choices:[
    {t:'继续翻最后一页', fx:{wisdom:1,courage:1}, et:'智慧 +1 · 勇气 +1', next:'secret'},
    {t:'合上日记，不想了', fx:{}, et:'', next:'secret'}
  ]
},
secret:{
  bg:'bg-night', speaker:'narr',
  text:'第二天课间。\n\n{{jiang}}突然把你叫到走廊尽头。他手里拿着一张泛黄的纸条——\n\n是你前世塞给他的那封。\n\n「其实我找了你很久。」他声音很轻，「开学第一天你问我想去哪所大学的时候，我就知道是你。」',
  sprites:['jiang'],
  choices:[
    {t:'「你……一直记得我？」', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'confess'},
    {t:'「你拿这个干什么？」', fx:{wisdom:1}, et:'智慧 +1', next:'confess'},
    {t:'转身就走', fx:{courage:1}, et:'勇气 +1', next:'confess'}
  ]
},

/* ===== 终章：校庆 ===== */
confess:{
  bg:'bg-sunset', speaker:'narr',
  text:'校庆晚会。礼堂里灯光很吵。\n\n你一个人走到走廊透气。晚风从敞开的窗户吹进来，带着桂花的味道。\n\n走廊尽头，有人在等你。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 10) return 'endJiang';
    if(st.chen >= 10) return 'endChen';
    if(st.courage >= 6 && st.wisdom >= 5) return 'endSelf';
    if(st.su >= 5) return 'endSu';
    if(st.jiang >= 6 || st.chen >= 6) return 'endBittersweet';
    return 'endNormal';
  }
},

/* ===== 结局 ===== */
endJiang:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}靠在走廊的柱子上，手里拿着那本练习册。\n\n「开学第一天，你问我想去哪所大学。」他把练习册递给你，扉页上除了那行小字，还有——\n\n你的名字。\n\n「我那时候就觉得，你和以前不一样了。」',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · A',
    title:'南方的约定',
    text:'后来你们真的考去了同一座靠海的城市。\n\n开学那天他在火车站出口等你，手里举着两瓶冰可乐，像举着整个夏天。\n\n有些错过，重生一次就够了。'
  }
},
endChen:{
  bg:'bg-sunset', speaker:'chen',
  text:'{{chen}}抱着一把吉他站在走廊尽头。他居然在晚会上唱了一首歌——一首你从没听过的歌。\n\n他走到你面前，把吉他背带往肩上紧了紧：\n\n「{{player}}。我跟我爸说了，我不打篮球了。」\n\n「我想写歌。第一首，写给你。」',
  sprites:['chen'],
  ending:{
    tag:'ENDING · B',
    title:'雨天的奔跑',
    text:'他真的写了那首歌。\n\n很多年后你在Livehouse里听到他唱，台下举着荧光海，他的目光穿过人群，准确地落在你身上。\n\n那场雨里跑过的路，原来一直通向这里。'
  }
},
endSelf:{
  bg:'bg-roof', speaker:'narr',
  text:'你没有走向任何一个人。\n\n你一个人走上天台。夕阳把整座城市染成蜜色。\n\n手机震了两下——\n\n{{jiang}}：「大学见。」\n{{chen}}：「以后写歌给你听。」\n{{su}}：「奶茶我请！」',
  sprites:[],
  ending:{
    tag:'ENDING · C',
    title:'重生者',
    text:'这一次你没有为任何人活。\n\n你考去了想去的城市，读了喜欢的专业，一个人看过很多次日落。\n\n那些曾经让你午夜梦回哭醒的遗憾，被你一个一个，亲手补回来了。\n\n——十八岁的{{player}}，你做得很好。'
  }
},
endSu:{
  bg:'bg-class', speaker:'su',
  text:'走廊尽头站着的是{{su}}。\n\n她手里拿着两杯奶茶，递你一杯：「我就知道你会一个人跑出来。」\n\n她靠在栏杆上，忽然说：「其实我高中三年最开心的事，就是遇见你。」',
  sprites:['su'],
  ending:{
    tag:'ENDING · D',
    title:'最好的朋友',
    text:'你们后来去了不同的城市，但每个月都会通一次长长的电话。\n\n她婚礼那天你当伴娘，她在台上哭着说：「谢谢{{player}}，陪我走过最兵荒马乱的三年。」\n\n有些感情，不需要爱情来定义。'
  }
},
endBittersweet:{
  bg:'bg-night', speaker:'narr',
  text:'走廊尽头没有人。\n\n你等了一会儿，风把桂花吹到你肩膀上。你笑了笑，转身走回礼堂。\n\n好像有人在背后叫你名字，但你没有回头。',
  sprites:[],
  ending:{
    tag:'ENDING · E',
    title:'差一点',
    text:'你们都没有说出口。\n\n毕业后各奔东西，朋友圈里偶尔点赞。多年后同学会再见，他/她身边站着别人，你也是。\n\n那朵没说出口的花，开在了十七岁的风里。'
  }
},
endNormal:{
  bg:'bg-night', speaker:'narr',
  text:'走廊上空空荡荡。\n\n你站了一会儿，笑了笑，转身走回礼堂。\n\n晚会还在继续，歌声、掌声、玻璃杯碰撞的声音从门里涌出来。\n\n好像还有很多故事，要慢慢讲。',
  sprites:[],
  ending:{
    tag:'ENDING · F',
    title:'未完待续',
    text:'这是一个普通的结局。\n\n你没有和谁在一起，也没有逆袭成传奇。但你不再是前世那个缩在角落里的{{player}}了。\n\n故事才刚刚开始。'
  }
}

  }
},

/* ============ 剧本二：嫡女归来（古言重生） ============ */
'guyan-dini': {
  meta: {
    title: '嫡女归来',
    subtitle: 'REBIRTH · ANCIENT',
    desc: '前世被庶妹和未婚夫毒杀在冷院，重生回到及笄礼前。这一世，仇要报，人要护。',
    tag: '古言 · 重生 · 宅斗 · 四结局',
    coverBg: 'bg-night',
    chars: ['萧珩', '沈惊鸿', '碧荷'],
    charsImg: { jiang: 'assets/char-jiang.png', chen: 'assets/char-chen.png', su: 'assets/char-su.png' },
    charsName: { jiang: '萧珩', chen: '沈惊鸿', su: '碧荷' },
    statNames: {
      jiang: '萧珩好感', chen: '沈惊鸿好感', su: '碧荷忠诚', courage: '胆识', wisdom: '谋略'
    },
    bgImg: {
      'bg-dawn': 'assets/bg-sunset.png',
      'bg-class': 'assets/bg-classroom.png',
      'bg-roof': 'assets/bg-rooftop.png',
      'bg-hall': 'assets/bg-sunset.png',
      'bg-rain': 'assets/bg-rain.png',
      'bg-night': 'assets/bg-night.png',
      'bg-sunset': 'assets/bg-sunset.png'
    }
  },
  start: 'gyWake',
  scenes: {

gyWake:{
  bg:'bg-night', speaker:'narr',
  text:'冷水泼在脸上。\n\n你猛地睁开眼，雕花拔步床，鲛绡帐子。桌上一面菱花镜——镜中人十五岁，眉目清秀，脖子上没有那道勒痕。\n\n你重生了。回到了及笄礼前三个月。',
  sprites:[],
  choices:[
    {t:'掐自己一把确认', fx:{courage:1}, et:'勇气 +1', next:'gyMaid'},
    {t:'先回忆前世怎么死的', fx:{wisdom:1}, et:'智慧 +1', next:'gyMaid'}
  ]
},
gyMaid:{
  bg:'bg-class', speaker:'su',
  text:'「姑娘！你可算醒了！夫人听说你落水，急得都来了！」\n\n碧荷端着铜盆冲进来，眼圈红红的。这是你前世最忠心的丫鬟，最后为了护你，被庶妹的人活活打死。',
  sprites:['su'],
  choices:[
    {t:'抓住碧荷的手：「以后有我在，没人敢动你。」', fx:{su:2}, et:'{{su}}忠诚 +2', next:'gySister'},
    {t:'冷静问：「今天是什么日子？」', fx:{wisdom:1}, et:'智慧 +1', next:'gySister'}
  ]
},
gySister:{
  bg:'bg-class', speaker:'narr',
  text:'门外环佩叮当。庶妹赵灵珊穿着一身粉色襦裙，笑盈盈地走进来：\n\n「姐姐醒了？听闻姐姐落水，妹妹担心得一宿没睡。」\n\n前世，就是这双手，在你及笄礼上把你推下水，又在冷院里给你灌了毒酒。',
  sprites:['su'],
  choices:[
    {t:'冷笑：「妹妹倒消息灵通。」', fx:{courage:1}, et:'勇气 +1', next:'gyGarden'},
    {t:'假装柔弱：「劳妹妹挂心。」', fx:{wisdom:1}, et:'智慧 +1', next:'gyGarden'}
  ]
},
gyGarden:{
  bg:'bg-roof', speaker:'narr',
  text:'后花园。你独自散步盘算下一步。\n\n假山后面传来男子的声音。一个是你前世的未婚夫——太子萧玦，正和庶妹低语。另一个是坐在亭中看戏的——摄政王{{jiang}}。\n\n他抬眼看见你，目光停了一瞬。',
  sprites:['jiang'],
  choices:[
    {t:'转身就走，不凑热闹', fx:{wisdom:1}, et:'智慧 +1', next:'gyDecision'},
    {t:'故意弄出声响，让他们发现你', fx:{courage:1}, et:'勇气 +1', next:'gyPrince'}
  ]
},
gyPrince:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}从亭中缓步走出来。他一身玄色锦袍，腰束玉带，眉眼冷淡如霜。\n\n「赵家大小姐？」他声音很低，「本王倒是第一次见你。」\n\n前世他是权倾朝野的摄政王，最后被太子（你的未婚夫）以谋逆罪赐死。',
  sprites:['jiang'],
  choices:[
    {t:'行礼：「见过王爷。」', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'gyDecision'},
    {t:'直言：「王爷可得小心太子。」', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 勇气 +1', next:'gyDecision'}
  ]
},
gyDecision:{
  bg:'bg-night', speaker:'narr',
  text:'夜里。碧荷研墨，你在纸上写下三行字：\n\n一、及笄礼上，反将庶妹一军。\n二、退婚。这太子，谁爱嫁谁嫁。\n三、找一个比太子更粗的大腿。\n\n窗外落下一只手，敲了敲窗棂。',
  sprites:[],
  choices:[
    {t:'开窗——是{{jiang}}', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'gyNightTalk'},
    {t:'开窗——是沈惊鸿（风流世子）', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyNightTalk2'},
    {t:'不开窗，吹熄蜡烛', fx:{wisdom:1}, et:'智慧 +1', next:'gyRite'}
  ]
},
gyNightTalk:{
  bg:'bg-night', speaker:'jiang',
  text:'{{jiang}}翻窗而入，一身夜风吹不散的龙涎香。\n\n「你白天那句话什么意思？」他目光如刀，「你知道太子要对本王做什么？」\n\n你笑了：「王爷信我，我助你登位。你信我，我保你不死。」',
  sprites:['jiang'],
  choices:[
    {t:'「合作吗？王爷。」', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'gyRite'},
    {t:'「夜闯闺阁，王爷就不怕我喊人？」', fx:{courage:1}, et:'勇气 +1', next:'gyRite'}
  ]
},
gyNightTalk2:{
  bg:'bg-night', speaker:'chen',
  text:'{{chen}}翻窗而入，摇着一把折扇，笑得像个狐狸。\n\n「赵家大小姐好胆识。」他凑近，「我在墙外听了半天——你要退婚？」\n\n他是沈国公府的世子，前世你嫁过去的庶妹被他宠上天。',
  sprites:['chen'],
  choices:[
    {t:'「世子也来听墙根？」', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyRite'},
    {t:'「你想娶我？」', fx:{courage:1}, et:'勇气 +1', next:'gyRite'}
  ]
},
gyRite:{
  bg:'bg-sunset', speaker:'narr',
  text:'及笄礼。满座宾客。\n\n庶妹果然在你下水的台阶上动了手脚。但你早有准备——\n\n她伸手推你的那一刻，你侧身让开，她自己一脚踩空，跌进了水池里。\n\n满堂哗然。',
  sprites:[],
  onEnter:{wisdom:2,courage:1},
  next:'gyRetreat'
},
gyRetreat:{
  bg:'bg-hall', speaker:'narr',
  text:'你当着满座宾客的面，向皇帝递了退婚折子。\n\n「太子殿下，高攀不起。」\n\n太子脸色铁青。庶妹在水里被捞起来，浑身湿透。\n\n摄政王{{jiang}}在席间端起酒杯，对你遥遥一敬。',
  sprites:['jiang'],
  choices:[
    {t:'回敬{{jiang}}一杯', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'gyEnding'},
    {t:'看向{{chen}}（他在角落偷笑）', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyEnding'},
    {t:'转身离席，不看任何人', fx:{courage:2}, et:'勇气 +2', next:'gyEnding'}
  ]
},
gyEnding:{
  bg:'bg-night', speaker:'narr',
  text:'夜已深。你站在廊下，风卷起宫灯的流苏。\n\n这一世，你不再是那个任人宰割的嫡女。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 6) return 'gyEndEmpress';
    if(st.chen >= 6) return 'gyEndPrince';
    if(st.courage >= 4 && st.wisdom >= 4) return 'gyEndLady';
    return 'gyEndNormal';
  }
},
gyEndEmpress:{
  bg:'bg-sunset', speaker:'jiang',
  text:'三个月后。{{jiang}}以"谋逆"罪名拿下太子，扶三皇子登基，自己成了摄政相王。\n\n他亲自来赵家提亲。\n\n「本王不需要一个皇后，」他把凤冠放在你手上，「本王要一个和我并肩的人。」',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · 古A',
    title:'权倾天下',
    text:'你成了大曜最有权势的女人。\n\n不是皇后，是摄政王身边那个能站着和他议事的人。庶妹被送去了家庙，太子被圈禁终身。\n\n前世欠你的，这一世连本带利都讨回来了。'
  }
},
gyEndPrince:{
  bg:'bg-sunset', speaker:'chen',
  text:'{{chen}}第二天就抬着聘礼上了赵家的门。\n\n他笑得像只偷了鸡的狐狸：「大小姐，我沈家不纳妾，不宠妓，一辈子就你一个。」\n\n你将信将疑。后来你才知道，他说的是真的。',
  sprites:['chen'],
  ending:{
    tag:'ENDING · 古B',
    title:'世子夫人',
    text:'沈惊鸿是真的纨绔，也是真的疼你。\n\n他为你遣散了所有通房，在京里修了一座你的园子。庶妹想攀他，被他一条绳子打了出去。\n\n这一世，你嫁了爱情。'
  }
},
gyEndLady:{
  bg:'bg-roof', speaker:'narr',
  text:'你谁也没嫁。\n\n及笄礼后你向父亲讨了分家，带着碧荷去了江南。你用前世的记忆做丝绸生意，三年成了江南首富。\n\n有人来提亲，你都婉拒了。',
  sprites:[],
  ending:{
    tag:'ENDING · 古C',
    title:'江南女商',
    text:'后来听说摄政王登基为帝，三宫六院空着，他派人来江南找过你。\n\n你站在自己的绸缎庄门口，看着江南的烟雨，摇了摇头。\n\n这一世，你为自己活。'
  }
},
gyEndNormal:{
  bg:'bg-night', speaker:'narr',
  text:'你站在廊下，看着宫灯一盏盏灭了。\n\n退了婚，报了仇，但未来还长。\n\n碧荷给你披上披风：「姑娘，夜深了。」',
  sprites:['su'],
  ending:{
    tag:'ENDING · 古D',
    title:'未完待续',
    text:'这是一个开始。\n\n你不再是那个冷院里的枉死嫡女。前路还长，故事才刚翻开第二页。'
  }
}

  }
},

/* ============ 剧本三：星光入场券（现代娱乐圈重生） ============ */
'xian-star': {
  meta: {
    title: '星光入场券',
    subtitle: 'REBIRTH · ENTERTAINMENT',
    desc: '前世被全网黑到退圈，重生回到选秀前夜。这一次，舞台是你的。',
    tag: '现代 · 重生 · 娱乐圈 · 四结局',
    coverBg: 'bg-sunset',
    chars: ['陆时衍', '顾星眠', '唐糖'],
    charsImg: { jiang: 'assets/char-jiang.png', chen: 'assets/char-chen.png', su: 'assets/char-su.png' },
    charsName: { jiang: '陆时衍', chen: '顾星眠', su: '唐糖' },
    statNames: {
      jiang: '陆时衍好感', chen: '顾星眠好感', su: '唐糖信任', courage: '魄力', wisdom: '才智'
    },
    bgImg: {
      'bg-dawn': 'assets/bg-classroom.png',
      'bg-class': 'assets/bg-classroom.png',
      'bg-roof': 'assets/bg-rooftop.png',
      'bg-hall': 'assets/bg-sunset.png',
      'bg-rain': 'assets/bg-rain.png',
      'bg-night': 'assets/bg-night.png',
      'bg-sunset': 'assets/bg-sunset.png'
    }
  },
  start: 'starWake',
  scenes: {

starWake:{
  bg:'bg-night', speaker:'narr',
  text:'化妆间。镜子里是一张黑眼圈的脸。\n\n桌上手机弹出推送：《选秀选手{{player}}凌晨发文卖惨，网友：又卖人设》。\n\n你认得这条热搜。前世你就是从这一刻开始，一步步被网暴到退圈、抑郁、最后车祸身亡。',
  sprites:[],
  choices:[
    {t:'删掉那条卖惨微博', fx:{wisdom:1}, et:'智慧 +1', next:'starAgent'},
    {t:'先睡一觉，明天再说', fx:{courage:1}, et:'勇气 +1', next:'starAgent'}
  ]
},
starAgent:{
  bg:'bg-class', speaker:'su',
  text:'门被推开。经纪人{{su}}——唐糖，前世陪你到最后却被你骂走的人——把一杯咖啡拍在桌上。\n\n「你疯了？明天就是初舞台，你现在发这种微博？」\n\n她眼圈是黑的，显然又陪你熬了一夜。',
  sprites:['su'],
  choices:[
    {t:'「糖糖，对不起。以后我听你的。」', fx:{su:2}, et:'{{su}}信任 +2', next:'starBackstage'},
    {t:'「帮我删掉那条。」', fx:{wisdom:1}, et:'智慧 +1', next:'starBackstage'}
  ]
},
starBackstage:{
  bg:'bg-hall', speaker:'narr',
  text:'选秀初舞台。后台挤满了练习生。\n\n你看见顶流影帝{{jiang}}——陆时衍，坐在评委席第一排。他是这档节目的导师，前世你连他的微信都没加上。\n\n另一边，你的对家{{chen}}——顾星眠，正冲你假笑。',
  sprites:['jiang','chen'],
  choices:[
    {t:'主动去和{{jiang}}打招呼', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'starStage'},
    {t:'不理会{{chen}}，自己练舞', fx:{wisdom:1}, et:'智慧 +1', next:'starStage'},
    {t:'走过去和{{chen}}说话', fx:{chen:1}, et:'{{chen}}好感 +1', next:'starStage'}
  ]
},
starStage:{
  bg:'bg-sunset', speaker:'narr',
  text:'聚光灯。你站在舞台中央。\n\n前世你唱了一首公司给的安全歌，成绩中游。这一次，你选了一首自己写的、关于网暴的歌。\n\n台下安静了。{{jiang}}抬起头，第一次正眼看你。',
  sprites:['jiang'],
  onEnter:{courage:2,wisdom:1},
  next:'starAfter'
},
starAfter:{
  bg:'bg-class', speaker:'jiang',
  text:'表演结束。{{jiang}}在后台拦住你。\n\n「那首歌是你自己写的？」他声音很淡，但眼神认真，「你以前不唱这种。」\n\n你心里一紧——他知道你以前什么样。',
  sprites:['jiang'],
  choices:[
    {t:'「人总会长大。」', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'starChoice'},
    {t:'「导师过奖。」', fx:{}, et:'', next:'starChoice'}
  ]
},
starChoice:{
  bg:'bg-night', speaker:'narr',
  text:'一个月后。你进了决赛。\n\n公司给你两个选择：一是抱{{jiang}}的大腿炒CP，二是和{{chen}}和解炒闺蜜情。\n\n{{su}}——唐糖——看着你：「你选哪个？我都帮你运作。」',
  sprites:['su'],
  choices:[
    {t:'选{{jiang}}路线', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'starEnd'},
    {t:'选{{chen}}路线', fx:{chen:2}, et:'{{chen}}好感 +2', next:'starEnd'},
    {t:'都不选，自己单干', fx:{courage:2}, et:'勇气 +2', next:'starEnd'}
  ]
},
starEnd:{
  bg:'bg-sunset', speaker:'narr',
  text:'决赛夜。\n\n聚光灯打在你身上。这一次，你不是那个被全网黑的小透明了。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 5) return 'starEndBest';
    if(st.chen >= 5) return 'starEndIdol';
    if(st.courage >= 4 && st.wisdom >= 3) return 'starEndQuit';
    return 'starEndNormal';
  }
},
starEndBest:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}在赛后采访被问到你。他难得地笑了：\n\n「她是我见过最有天赋也最倔强的选手。」\n\n当晚他微博关注了你。评论区炸了。',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · 星A',
    title:'影后之路',
    text:'后来你拿了金马影后。领奖台上你感谢了{{jiang}}，他在台下鼓掌。\n\n你们没有在一起，但他成了你这辈子最尊重的前辈。前世的网暴，被你用作品一句话堵了回去。'
  }
},
starEndIdol:{
  bg:'bg-sunset', speaker:'chen',
  text:'{{chen}}在赛后发了一条微博：一张你俩的合影，配文「以后请多指教，队友」。\n\n你笑了。前世你们是对家，这一世成了朋友。',
  sprites:['chen'],
  ending:{
    tag:'ENDING · 星B',
    title:'闺蜜出道',
    text:'你和{{chen}}后来组了双人组合，火遍亚洲。\n\n演唱会他把最后一首歌送给你：「谢谢{{player}}，没有你就没有今天的我。」\n\n前世的黑粉，成了你粉丝团的后援会会长。'
  }
},
starEndQuit:{
  bg:'bg-roof', speaker:'narr',
  text:'决赛后你签了辞职信。\n\n{{su}}——唐糖——没拦你。她只是说：「想清楚就好。」\n\n你去了国外读书，离开了这个是非圈。偶尔刷到热搜，笑一笑就划过去。',
  sprites:[],
  ending:{
    tag:'ENDING · 星C',
    title:'退圈后',
    text:'你在国外读了电影系。\n\n三年后你拍的第一部短片在戛纳入围。领奖台上没人记得你曾经是个被网暴的小透明——大家只知道你是个新锐导演。\n\n这一世，你为自己而活。'
  }
},
starEndNormal:{
  bg:'bg-night', speaker:'narr',
  text:'后台。你卸下妆。\n\n{{su}}递过来一瓶水：「辛苦了。」\n\n你笑了笑。路还长。',
  sprites:['su'],
  ending:{
    tag:'ENDING · 星D',
    title:'未完待续',
    text:'这只是开始。\n\n你不再是那个被全网黑到抑郁的小透明。前路漫漫，星光刚亮。'
  }
}

  }
}

};
