/* ============================================================
 * story-books.js  —  互动故事剧本库（长篇版 v2）
 *
 * 【剧本对象格式】
 *   '你的剧本id': {
 *     meta: { title, subtitle, desc, tag, coverBg, chars,
 *             charsImg, charsName, statNames, bgImg },
 *     start: 'wake',
 *     scenes: {
 *       '场景id': {
 *         bg:'bg-xxx', speaker:'narr', sprites:[...],
 *         text:'...\n...',
 *         onEnter:{key:n},
 *         next:'场景id' | function(st){...},
 *         choices:[{t, fx, et, next}],
 *         ending:{ tag, title, text }
 *       }
 *     }
 *   }
 *
 * speaker: narr / jiang / chen / su / me（新角色直接写名字）
 * bg: bg-dawn / bg-class / bg-roof / bg-hall / bg-basket / bg-rain / bg-night / bg-sunset
 * ============================================================ */

var STORY_BOOKS = {

/* ============================================================
 * 剧本一：重返高二（校园重生）
 * 章节：醒来 → 第一周 → 九月 → 月考 → 运动会 → 冬天 → 日记 → 元旦 → 结局
 * ============================================================ */
'campus-rebirth': {
  meta: {
    title: '重返高二',
    subtitle: 'REBIRTH · 2019',
    desc: '重生回到十八岁那年九月。这一次，你要把所有错过的人和事，一个一个找回来。',
    tag: '校园 · 重生 · 六结局',
    coverBg: 'bg-dawn',
    chars: ['江屿', '陈野', '苏念'],
    charsImg: {
      jiang: 'assets/char-jiang.png',
      chen: 'assets/char-chen.png',
      su: 'assets/char-su.png',
      linwan: 'assets/char-linwan.png'
    },
    charsName: { jiang:'江屿', chen:'陈野', su:'苏念', linwan:'林晚' },
    statNames: {
      jiang:'江屿好感', chen:'陈野好感', su:'苏念友情',
      courage:'勇气', wisdom:'智慧', study:'成绩'
    },
    bgImg: {
      'bg-dawn':  'assets/bg-classroom.png',
      'bg-class': 'assets/bg-classroom.png',
      'bg-roof':  'assets/bg-rooftop.png',
      'bg-hall':  'assets/bg-sunset.png',
      'bg-basket':'assets/bg-rooftop.png',
      'bg-rain':  'assets/bg-rain.png',
      'bg-sunset':'assets/bg-sunset.png',
      'bg-night': 'assets/bg-rain.png'
    }
  },
  start: 'wake',
  scenes: {

/* ---------- 第一章 醒来 ---------- */
wake:{
  bg:'bg-dawn', speaker:'narr',
  text:'早读课的铃声从很远的地方传来，像隔着一层水。\n\n你猛地睁开眼。\n\n刺眼的阳光透过窗户洒在课桌上，粉笔灰在光柱里浮着。黑板旁的日历用红粉笔圈着——\n\n2019年9月2日，星期一。\n\n你今年十七岁。不是二十七。',
  sprites:[],
  choices:[
    {t:'狠狠掐自己一把', fx:{courage:1}, et:'勇气 +1', next:'reality'},
    {t:'先闭上眼，把刚才那场"梦"捋一遍', fx:{wisdom:1}, et:'智慧 +1', next:'reality'}
  ]
},
reality:{
  bg:'bg-dawn', speaker:'su',
  text:'「{{player}}！你发什么呆呢？」\n\n同桌{{su}}用胳膊肘狠狠捅了你一下，「开学第一天就走神，暑假是玩疯了还是睡傻了？」\n\n——你认得她。\n\n十年了。你以为自己早就忘了这张脸，可她连翻白眼的样子都和记忆里一模一样。',
  sprites:['su'],
  choices:[
    {t:'「……{{su}}，我好想你。」', fx:{su:2}, et:'{{su}}友情 +2', next:'paperNote'},
    {t:'「做了个很长的梦。」', fx:{wisdom:1}, et:'智慧 +1', next:'paperNote'},
    {t:'盯着她看，一句话说不出来', fx:{courage:1}, et:'勇气 +1', next:'paperNote'}
  ]
},
paperNote:{
  bg:'bg-class', speaker:'narr',
  text:'你深吸一口气，转过头。\n\n旁边坐着的是——{{jiang}}。\n\n他正低头抄黑板，侧脸被阳光切出一道金边。前世的这个时候，你和他因为一件芝麻大的小事冷战，从此三年没说过超过十句话。\n\n你甚至不知道他后来去了哪所大学。\n\n一张折成方块的纸条，从桌子中间推了过来。',
  sprites:['jiang'],
  choices:[
    {t:'接过来，展开看', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'noteRead'},
    {t:'假装没看见，继续看黑板', fx:{wisdom:1}, et:'智慧 +1', next:'noteRead'}
  ]
},
noteRead:{
  bg:'bg-class', speaker:'jiang',
  text:'纸条上是清瘦的字，一笔一划都很用力：\n\n「脸很白。要不要去医务室？」\n\n他没看你，假装继续抄笔记，可耳朵尖红得发烫。\n\n前排的{{su}}回头递了个"哟——"的口型。',
  sprites:['jiang'],
  next:'seatChoice'
},
seatChoice:{
  bg:'bg-class', speaker:'narr',
  text:'班主任王老师敲了敲讲台：「开学第一件事——重新排座位。想坐哪儿，自己说。」\n\n教室里一下子炸开锅。你听见{{chen}}在后排吹了声口哨，{{su}}在桌子底下攥住了你袖子。',
  sprites:['jiang','su'],
  choices:[
    {t:'「我想继续坐这里。」（{{jiang}}旁边）', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'classMorning'},
    {t:'「我想和{{su}}坐一起。」', fx:{su:1}, et:'{{su}}友情 +1', next:'classSu'},
    {t:'「随便吧，老师您安排。」', fx:{wisdom:1}, et:'智慧 +1', next:'classMorning'}
  ]
},

/* ---------- 第二章 开学第一周 ---------- */
classMorning:{
  bg:'bg-class', speaker:'narr',
  text:'第一节课是数学。\n\n{{jiang}}在你旁边做题，笔尖划过纸面的声音很轻。你瞥了一眼他的练习册——扉页空白处写着一行小字：\n\n「想去南方，靠海的学校。」\n\n他察觉到你的目光，"啪"地合上了本子。',
  sprites:['jiang'],
  choices:[
    {t:'「你想去哪所大学？」', fx:{jiang:2,wisdom:1}, et:'{{jiang}}好感 +2 · 智慧 +1', next:'lunch'},
    {t:'不打扰他，自己看书', fx:{study:1}, et:'成绩 +1', next:'lunch'}
  ]
},
classSu:{
  bg:'bg-class', speaker:'su',
  text:'「{{player}}！」{{su}}凑过来，声音压得低低的，「下课去篮球场呗？{{chen}}今天第一天训练，说要给你表演三分球。」\n\n你愣了一下。\n\n{{chen}}——那个前世毕业聚会后，你再也没联系过的人。听说他后来接了他爸的班，在老家开了个汽修店。',
  sprites:['su'],
  choices:[
    {t:'「去看看。」', fx:{chen:2}, et:'{{chen}}好感 +2', next:'basket'},
    {t:'「不去了，怕尴尬。」', fx:{wisdom:1}, et:'智慧 +1', next:'rooftop'}
  ]
},
lunch:{
  bg:'bg-hall', speaker:'narr',
  text:'中午。食堂。\n\n塑料托盘在手里沉甸甸的。糖醋排骨、番茄炒蛋、一勺米饭——前世你最讨厌食堂的这道菜，可现在闻着，居然有点想哭。\n\n{{su}}端着盘子在你对面坐下，{{jiang}}犹豫了一下，也端着盘子走过来。',
  sprites:['jiang','su'],
  choices:[
    {t:'把自己盘里的排骨夹给{{jiang}}', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'library'},
    {t:'把排骨夹给{{su}}', fx:{su:2}, et:'{{su}}友情 +2', next:'library'},
    {t:'低头自己吃，谁也不看', fx:{study:1}, et:'成绩 +1', next:'library'}
  ]
},
library:{
  bg:'bg-hall', speaker:'narr',
  text:'午休。图书馆。\n\n空调嗡嗡响。你在历史书架前停下——你前世最讨厌的就是历史，可这一世，你想把漏掉的十年补回来。\n\n{{jiang}}抱着一摞练习册坐在靠窗的位置，阳光在他睫毛上跳。\n\n他抬头看见你，拍了拍旁边的椅子。',
  sprites:['jiang'],
  choices:[
    {t:'走过去，在他旁边坐下', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'libraryTalk'},
    {t:'「我先去那边看看。」', fx:{study:2}, et:'成绩 +2', next:'libraryTalk'}
  ]
},
libraryTalk:{
  bg:'bg-hall', speaker:'jiang',
  text:'「你最近……」他翻着书，声音很轻，「有点不一样。」\n\n你的心猛地一跳。\n\n「哪里不一样？」\n\n他想了想，耳朵又红了：「……说不上来。就是，好像以前不怎么抬头看人的。」',
  sprites:['jiang'],
  choices:[
    {t:'「那我以后多抬头看看。」', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 勇气 +1', next:'afternoonClass'},
    {t:'笑一下，继续看书', fx:{wisdom:1}, et:'智慧 +1', next:'afternoonClass'}
  ]
},
afternoonClass:{
  bg:'bg-class', speaker:'narr',
  text:'下午第一节是英语。\n\n老师点你起来念课文。前世你磕磕巴巴念完，全班笑了三年。\n\n这一次，你深吸一口气，用你在二十七岁那年练出来的、带点口音但很稳的语调念完了一整段。\n\n教室里静了一秒。{{jiang}}在旁边轻轻"咦"了一声。',
  sprites:['jiang'],
  onEnter:{study:2},
  next:'firstDayEnd'
},
firstDayEnd:{
  bg:'bg-rain', speaker:'narr',
  text:'放学。\n\n天不知道什么时候阴了，梧桐叶被风卷着打旋。你站在校门口，看着来来往往的自行车，突然反应过来——\n\n你真的回来了。\n\n不是梦。',
  sprites:[],
  choices:[
    {t:'一个人走回家，把这一天想清楚', fx:{wisdom:2}, et:'智慧 +2', next:'montage'},
    {t:'回头看一眼教学楼', fx:{courage:1}, et:'勇气 +1', next:'rooftop'}
  ]
},

/* ---------- 第三章 九月 ---------- */
rooftop:{
  bg:'bg-roof', speaker:'narr',
  text:'你不知道自己怎么就爬上了天台。\n\n风很大，远处操场的哨声一阵一阵。你以为天台上只有自己——\n\n「哟。」\n\n栏杆边靠着的是{{chen}}。校服外套搭在肩上，手里攥着一瓶没开的橘子汽水。',
  sprites:['chen'],
  choices:[
    {t:'「……你怎么在这儿？」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'rooftopTalk'},
    {t:'默默走到另一边吹风', fx:{wisdom:1}, et:'智慧 +1', next:'rooftopTalk'}
  ]
},
rooftopTalk:{
  bg:'bg-roof', speaker:'chen',
  text:'「我爸非让我打篮球，说能保送。」他笑了一下，踢了踢脚边的铁丝网，「可我其实……更喜欢弹吉他。」\n\n他说完自己先愣住了，大概没想到会跟一个不太熟的人说这些。\n\n汽水被他捏得"咔"一声响。',
  sprites:['chen'],
  choices:[
    {t:'「那你喜欢什么样的歌？」', fx:{chen:2,courage:1}, et:'{{chen}}好感 +2 · 勇气 +1', next:'rain'},
    {t:'「打球也挺好的啊。」', fx:{}, et:'', next:'rain'},
    {t:'「弹给我听听？」', fx:{chen:3}, et:'{{chen}}好感 +3', next:'rooftopSong'}
  ]
},
rooftopSong:{
  bg:'bg-roof', speaker:'chen',
  text:'他真的从书包里掏出一把缺了角的木吉他。\n\n手指拨了两下弦，跑调跑到天边去了。他自己先笑场，你也跟着笑。\n\n「这是我自己写的，」他挠挠头，「还没起名字。」\n\n风把他的校服吹得鼓起来，像一面帆。',
  sprites:['chen'],
  onEnter:{chen:2},
  next:'rain'
},
basket:{
  bg:'bg-basket', speaker:'narr',
  text:'篮球场。\n\n{{chen}}投进一个三分，转头看见你，整个人僵住，球"咚"地砸在自己头上。\n\n队友爆笑。他捂着额头跑过来，耳朵通红：「你、你怎么来了？」',
  sprites:['chen'],
  choices:[
    {t:'「嗯，路过。」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'rain'},
    {t:'「刚才那个球，三不沾哦。」', fx:{chen:2,courage:1}, et:'{{chen}}好感 +2 · 勇气 +1', next:'rain'}
  ]
},
rain:{
  bg:'bg-rain', speaker:'narr',
  text:'放学。\n\n雨下得猝不及防，打在梧桐叶上噼里啪啦。你站在校门口翻遍书包——没带伞。\n\n校门口，{{jiang}}撑着一把黑伞站在梧桐树下，像在等人。\n\n另一边，{{chen}}顶着校服外套从雨里冲出来，大喊你的名字。',
  sprites:['jiang','chen'],
  choices:[
    {t:'走向{{jiang}}', fx:{}, et:'', next:'rainJiang'},
    {t:'跑向{{chen}}，一起淋雨', fx:{chen:1,courage:1}, et:'{{chen}}好感 +1 · 勇气 +1', next:'rainChen'},
    {t:'直接冲进雨里', fx:{courage:2}, et:'勇气 +2', next:'rainAlone'}
  ]
},
rainJiang:{
  bg:'bg-rain', speaker:'jiang',
  text:'{{jiang}}把伞往你这边倾了倾：「一起走？我家顺路。」\n\n伞很小，你们的肩膀偶尔碰到。他一直没说话，但伞始终歪向你那边，自己半个肩膀都湿了。\n\n路过积水坑，他很自然地把你拉到内侧。',
  sprites:['jiang'],
  choices:[
    {t:'「你肩膀湿了。伞往你那边挪挪。」', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'rainHome'},
    {t:'不说话，默默把伞扶正', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'rainHome'},
    {t:'「……谢谢。」', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'rainHome'}
  ]
},
rainHome:{
  bg:'bg-rain', speaker:'narr',
  text:'你家楼下。\n\n他把伞递给你：「明天还我就行。」\n\n「那你怎么办？」\n\n「我跑回去，五分钟。」\n\n他真的把外套往头上一蒙，冲进了雨里。你站在楼道口，握着那把还带着他体温的伞，站了很久。',
  sprites:[],
  onEnter:{jiang:1},
  next:'montage'
},
rainChen:{
  bg:'bg-rain', speaker:'chen',
  text:'{{chen}}把校服外套整个盖在你俩头上：「跑！」\n\n雨砸在外套上噼里啪啦响。你俩一边跑一边笑，像两个傻子。\n\n跑到公交站时，他的头发全贴在额头上，却把干的那半边外套让给了你。',
  sprites:['chen'],
  onEnter:{chen:2},
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
  text:'【九月底。一个月后。】\n\n这一个月里，你试着不再重蹈前世的覆辙。\n\n你主动和{{jiang}}借笔记，你听{{chen}}在天台弹完了他那首没名字的歌，你陪{{su}}去了她一直想去的画展。\n\n你每天六点起来背单词，晚上十二点才睡。\n\n月考成绩贴出来那天，整个走廊都是人声。',
  sprites:[],
  onEnter:{wisdom:2,courage:2,study:3},
  next:'exam'
},

/* ---------- 第四章 月考 ---------- */
exam:{
  bg:'bg-hall', speaker:'narr',
  text:'红榜前挤得水泄不通。\n\n你踮起脚，在密密麻麻的名字里找自己。',
  sprites:[],
  next:function(st){ return st.study >= 4 ? 'examGood' : 'examMid'; }
},
examGood:{
  bg:'bg-hall', speaker:'jiang',
  text:'年级第47名。\n\n你愣在原地——前世你最好的成绩也只是年级两百名开外。\n\n肩膀被人轻轻敲了一下。{{jiang}}站在你旁边，抱着胳膊，眼睛里有点笑意：「可以啊。偷偷努力？」',
  sprites:['jiang'],
  choices:[
    {t:'「晚上一起自习？」', fx:{jiang:2,study:1}, et:'{{jiang}}好感 +2 · 成绩 +1', next:'selfStudy'},
    {t:'笑一下，不说话', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'selfStudy'}
  ]
},
examMid:{
  bg:'bg-hall', speaker:'su',
  text:'进步了十二名。\n\n不算耀眼，但你已经很满意了。{{su}}从后面抱住你：「可以啊{{player}}！下次请你喝奶茶！」\n\n她凑到你耳边：「对了，{{jiang}}刚才在这儿站了十分钟，一直等你过来。」',
  sprites:['su'],
  onEnter:{su:1},
  next:'selfStudy'
},
selfStudy:{
  bg:'bg-night', speaker:'narr',
  text:'晚自习。\n\n教室里只有笔尖的声音和风扇转动的嗡鸣。{{jiang}}在你旁边，两道题之间会停下来，把草稿纸往你这边推一点——他在给你讲题。\n\n你低头看，他的字比黑板上的好看。',
  sprites:['jiang'],
  choices:[
    {t:'「你怎么什么都会？」', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'selfStudyLate'},
    {t:'认真把题听完，抄进错题本', fx:{study:2}, et:'成绩 +2', next:'selfStudyLate'}
  ]
},
selfStudyLate:{
  bg:'bg-night', speaker:'jiang',
  text:'下自习的铃响了。\n\n教室里的人走光了。{{jiang}}还没走，他从书包里掏出一个苹果，放在你桌上。\n\n「看你晚上没吃饭。」\n\n他收拾书包的动作有点快，像在逃。',
  sprites:['jiang'],
  onEnter:{jiang:1,study:1},
  next:'sportsDay'
},

/* ---------- 第五章 运动会 ---------- */
sportsDay:{
  bg:'bg-roof', speaker:'narr',
  text:'十一月。校运动会。\n\n操场上彩旗招展，广播里放着进行曲。{{chen}}在篮球场上热身，{{jiang}}被班长报了一千五百米——他看起来不太情愿，正在看台下面无表情地压腿。\n\n你站在看台边上，手里攥着两瓶水。',
  sprites:['jiang','chen'],
  choices:[
    {t:'把水递给{{jiang}}（他跑长跑）', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'sportsRun'},
    {t:'去篮球场给{{chen}}加油', fx:{chen:2}, et:'{{chen}}好感 +2', next:'sportsBasket'},
    {t:'找{{su}}一起坐看台', fx:{su:1}, et:'{{su}}友情 +1', next:'sportsWatch'}
  ]
},
sportsRun:{
  bg:'bg-roof', speaker:'jiang',
  text:'{{jiang}}接过水的时候手指碰到你的。他没说话，只是点了点头。\n\n一千五百米。他跑在第二圈就开始喘，脸色发白，但最后一百米突然加速，超过了前面的人。\n\n冲过终点时，他第一个看向的人是你。',
  sprites:['jiang'],
  choices:[
    {t:'递毛巾过去', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'sportsAfter'},
    {t:'冲过去扶他', fx:{jiang:3,courage:1}, et:'{{jiang}}好感 +3 · 勇气 +1', next:'sportsAfter'},
    {t:'站在原地笑', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'sportsAfter'}
  ]
},
sportsBasket:{
  bg:'bg-basket', speaker:'chen',
  text:'{{chen}}在球场上看见你，整个人像打了鸡血，连进三个三分。\n\n终场哨响，他队友把他抬起来往天上抛。他下来第一件事就是冲过来，满头大汗地问你：「刚才那个三分帅不帅？」',
  sprites:['chen'],
  choices:[
    {t:'「帅。但你投篮姿势有点丑。」', fx:{chen:2,courage:1}, et:'{{chen}}好感 +2 · 勇气 +1', next:'sportsAfter'},
    {t:'「特别帅！」', fx:{chen:1}, et:'{{chen}}好感 +1', next:'sportsAfter'}
  ]
},
sportsWatch:{
  bg:'bg-roof', speaker:'su',
  text:'{{su}}啃着冰棍坐在你旁边，指着操场：「你看{{chen}}——他往你这边看了三次了。」\n\n你顺着她的手指看过去，正好撞上{{chen}}的目光。他愣了一下，假装转头去看天。\n\n{{su}}叹了口气：「你们两个，急死我了。」',
  sprites:['su'],
  onEnter:{su:1},
  next:'sportsAfter'
},
sportsAfter:{
  bg:'bg-sunset', speaker:'narr',
  text:'运动会散场。\n\n夕阳把跑道染成蜜色。你一个人抱着一堆空矿泉水瓶往垃圾桶走，{{jiang}}不知道从哪儿冒出来，接过去一半。\n\n「你以前不会干这种事。」他说。',
  sprites:['jiang'],
  choices:[
    {t:'「以前是以前。」', fx:{jiang:1,courage:1}, et:'{{jiang}}好感 +1 · 勇气 +1', next:'winterComes'},
    {t:'「……你怎么知道我以前什么样？」', fx:{wisdom:1}, et:'智慧 +1', next:'winterComes'}
  ]
},

/* ---------- 第六章 冬天 ---------- */
winterComes:{
  bg:'bg-night', speaker:'narr',
  text:'十二月。\n\n第一场雪下在一个晚自习。教室里有人发出小声的惊呼。{{jiang}}看着窗外，突然说：\n\n「我小时候，我妈带我在雪地里堆过雪人。」\n\n这是他第一次主动跟你说家里的事。',
  sprites:['jiang'],
  choices:[
    {t:'「你妈……现在呢？」', fx:{jiang:2,wisdom:1}, et:'{{jiang}}好感 +2 · 智慧 +1', next:'jiangSick'},
    {t:'「周末一起堆一个？」', fx:{jiang:3,courage:1}, et:'{{jiang}}好感 +3 · 勇气 +1', next:'snowman'}
  ]
},
jiangSick:{
  bg:'bg-class', speaker:'narr',
  text:'第二天，{{jiang}}没来上课。\n\n班主任说他发烧了。你看着旁边那个空座位，一整节课都没听进去。\n\n放学的时候，你从书包里掏出那把他还你的黑伞，又塞了进去。',
  sprites:[],
  choices:[
    {t:'买点退烧药，按{{su}}给的地址找过去', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 勇气 +1', next:'jiangHome'},
    {t:'让{{su}}把笔记和作业带给他', fx:{su:1}, et:'{{su}}友情 +1', next:'bandNight'}
  ]
},
jiangHome:{
  bg:'bg-night', speaker:'narr',
  text:'{{jiang}}家在一个老小区。\n\n你敲开门，他穿着一件洗得发白的毛衣，头发乱翘，看见是你，整个人僵在门口。\n\n「你怎么来了？」\n\n「送作业。」你把塑料袋举起来，里面除了作业，还有粥和退烧药。',
  sprites:['jiang'],
  choices:[
    {t:'「你先躺下，我给你煮粥。」', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'jiangHomeCook'},
    {t:'把东西放下就走', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'bandNight'}
  ]
},
jiangHomeCook:{
  bg:'bg-night', speaker:'jiang',
  text:'他家厨房很小。\n\n你围着他的围裙（围裙上印着一只卡通猫）熬粥。{{jiang}}靠在门框上看你，烧还没退，脸红红的。\n\n「……你以前不会做饭吧。」\n\n「你怎么知道？」\n\n「猜的。」他声音很轻，「你今天做的一切，都不像以前的{{player}}。」',
  sprites:['jiang'],
  choices:[
    {t:'（不说话，把盛好的粥递给他）', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'jiangHomeAfter'},
    {t:'「那你喜欢现在的我吗？」', fx:{jiang:3,courage:2}, et:'{{jiang}}好感 +3 · 勇气 +2', next:'jiangHomeAfter'}
  ]
},
jiangHomeAfter:{
  bg:'bg-night', speaker:'narr',
  text:'你走的时候，他塞给你一本书。\n\n《海子诗选》。扉页上写着他的名字。\n\n「借你看。」他说，「看完……还我。」',
  sprites:['jiang'],
  onEnter:{jiang:2},
  next:'bandNight'
},
snowman:{
  bg:'bg-night', speaker:'narr',
  text:'周六下午。雪停了。\n\n你和{{jiang}}在小区楼下堆雪人。他堆得很认真，滚了一个比他还高的雪球。\n\n你把自己的围巾解下来，给雪人围上。他看着那条围巾，突然说：\n\n「围在你身上，比围在它身上好看。」',
  sprites:['jiang'],
  onEnter:{jiang:2},
  next:'bandNight'
},
bandNight:{
  bg:'bg-night', speaker:'chen',
  text:'{{chen}}的乐队在学校后门的琴行排练。\n\n你和{{su}}推开门的时候，他们正在跑调。看见你，{{chen}}的吉他"嗡"地一声弹错了。\n\n「来，」他把吉他递过来，「副歌那段，你帮我听听。」',
  sprites:['chen','su'],
  choices:[
    {t:'认真听，给他提建议', fx:{chen:2,su:1}, et:'{{chen}}好感 +2 · {{su}}友情 +1', next:'suSecret'},
    {t:'起哄让他唱那首天台的歌', fx:{chen:1,courage:1}, et:'{{chen}}好感 +1 · 勇气 +1', next:'suSecret'}
  ]
},
suSecret:{
  bg:'bg-night', speaker:'su',
  text:'回家的路上，{{su}}突然拉住你。\n\n「{{player}}，我跟你说个事，你别告诉别人。」\n\n她深吸一口气：「我……我喜欢{{chen}}。从高一就开始了。」\n\n你愣住了。前世这件事，{{su}}到毕业都没说出口。',
  sprites:['su'],
  choices:[
    {t:'「我支持你。」', fx:{su:3,courage:1}, et:'{{su}}友情 +3 · 勇气 +1', next:'suReaction'},
    {t:'「你……你确定吗？」', fx:{wisdom:1}, et:'智慧 +1', next:'suReaction'},
    {t:'「这件事，我谁也不说。」', fx:{su:2}, et:'{{su}}友情 +2', next:'suReaction'}
  ]
},
suReaction:{
  bg:'bg-night', speaker:'narr',
  text:'{{su}}笑了，眼睛红红的。\n\n「我就知道告诉你是对的。」她抱住你，「你最近真的变了，以前你才不会听我说这些。」\n\n雪又下起来了。你们俩在路灯下站成两个雪人。',
  sprites:['su'],
  onEnter:{su:2},
  next:'homeVisit'
},

/* ---------- 第七章 日记与信 ---------- */
homeVisit:{
  bg:'bg-night', speaker:'narr',
  text:'一月初。\n\n运动会结束那天晚上，你回到家。妈妈端出一碗汤，随口说：「对了，你前阵子状态不对，日记写在抽屉最里面，我没偷看啊。」\n\n你打开抽屉。一个上锁的本子。钥匙在你笔袋的夹层里——你早忘了这回事。',
  sprites:[],
  choices:[
    {t:'打开日记看看', fx:{wisdom:2}, et:'智慧 +2', next:'diaryRead'},
    {t:'不看，把它放回去', fx:{courage:1}, et:'勇气 +1', next:'secret'}
  ]
},
diaryRead:{
  bg:'bg-night', speaker:'narr',
  text:'日记里的字迹是你自己的——但语气很陌生。\n\n「今天又梦见坠楼了。他站在我旁边，但我不敢看他的脸。」\n「如果能重来一次，我一定不会把那封信塞进他抽屉。」\n「{{jiang}}今天和我说话了。我假装没听见。」\n\n信？你不记得写过什么信。',
  sprites:[],
  choices:[
    {t:'继续翻最后一页', fx:{wisdom:1,courage:1}, et:'智慧 +1 · 勇气 +1', next:'diaryLast'},
    {t:'合上日记，不想了', fx:{}, et:'', next:'secret'}
  ]
},
diaryLast:{
  bg:'bg-night', speaker:'narr',
  text:'最后一页的日期，是2019年9月1日。\n\n——重生前一天。\n\n「明天就要开学了。我决定了。明天，我要把那封信给{{jiang}}。\n\n如果他不要我，我就从教学楼上跳下去。」\n\n你手一抖，本子掉在地上。\n\n原来前世的你，是这样的一个你。',
  sprites:[],
  onEnter:{courage:2,wisdom:1},
  next:'secret'
},
secret:{
  bg:'bg-hall', speaker:'narr',
  text:'第二天课间。\n\n{{jiang}}突然把你叫到走廊尽头。他手里拿着一张泛黄的纸条——\n\n是你前世塞给他的那封。\n\n「其实我找了你很久。」他声音很轻，「开学第一天你问我想去哪所大学的时候，我就知道是你。」',
  sprites:['jiang'],
  choices:[
    {t:'「你……一直记得我？」', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'confessPrep'},
    {t:'「你拿这个干什么？」', fx:{wisdom:1}, et:'智慧 +1', next:'confessPrep'},
    {t:'转身就走', fx:{courage:1}, et:'勇气 +1', next:'confessPrep'}
  ]
},
confessPrep:{
  bg:'bg-hall', speaker:'jiang',
  text:'他把纸条展开。\n\n那是一封你从来没见过的信，字迹发抖，内容笨拙——\n\n「{{jiang}}，我喜欢你。从高一第一次见你就喜欢。如果你不喜欢我，也没关系。」\n\n他看着你：「这封信，我一直没扔。」',
  sprites:['jiang'],
  onEnter:{jiang:1},
  next:'newYear'
},

/* ---------- 第八章 元旦晚会 ---------- */
newYear:{
  bg:'bg-sunset', speaker:'narr',
  text:'十二月三十一日。元旦晚会。\n\n礼堂里灯光很吵，气球和彩带挂得乱七八糟。{{chen}}报了个吉他弹唱，{{su}}在后台帮他整理吉他背带。\n\n你一个人走到走廊透气。晚风从敞开的窗户吹进来，带着桂花的味道。\n\n走廊尽头，有人在等你。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 12) return 'endJiang';
    if(st.chen >= 12) return 'endChen';
    if(st.su >= 10) return 'endSu';
    if(st.courage >= 8 && st.wisdom >= 7) return 'endSelf';
    if(st.jiang >= 7 || st.chen >= 7) return 'endBittersweet';
    return 'endNormal';
  }
},

/* ---------- 结局 ---------- */
endJiang:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}靠在走廊的柱子上，手里拿着那本《海子诗选》。\n\n「开学第一天，你问我想去哪所大学。」他把书递给你，扉页上除了他的名字，还有——\n\n你的名字。\n\n「我那时候就觉得，你和以前不一样了。」他顿了顿，「后来我发现，你是不一样了。但我喜欢。」',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · A',
    title:'南方的约定',
    text:'后来你们真的考去了同一座靠海的城市。\n\n开学那天他在火车站出口等你，手里举着两瓶冰可乐，像举着整个夏天。\n\n他一直没说过"我喜欢你"。但他的每一个选择，都是。\n\n有些错过，重生一次就够了。'
  }
},
endChen:{
  bg:'bg-sunset', speaker:'chen',
  text:'{{chen}}抱着一把吉他站在走廊尽头。他居然在晚会上唱了一首歌——一首你从没听过的歌。\n\n他走到你面前，把吉他背带往肩上紧了紧：\n\n「{{player}}。我跟我爸说了，我不打篮球了。」\n\n「我想写歌。第一首，写给你。」\n\n他顿了顿，挠挠头：「……哦对，{{su}}说她也喜欢我。但我喜欢的是你。对不起。」',
  sprites:['chen'],
  ending:{
    tag:'ENDING · B',
    title:'雨天的奔跑',
    text:'他真的写了那首歌。\n\n很多年后你在Livehouse里听到他唱，台下举着荧光海，他的目光穿过人群，准确地落在你身上。\n\n那场雨里跑过的路，原来一直通向这里。\n\n——献给所有没说出口的年少。'
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
  text:'走廊尽头站着的是{{su}}。\n\n她手里拿着两杯奶茶，递你一杯：「我就知道你会一个人跑出来。」\n\n她靠在栏杆上，忽然说：「其实我高中三年最开心的事，就是遇见你。」\n\n「至于{{chen}}……」她笑了，「我想通了。有些喜欢，放在心里就好。」',
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

/* ============================================================
 * 剧本二：嫡女归来（古言重生）
 * ============================================================ */
'guyan-dini': {
  meta: {
    title: '嫡女归来',
    subtitle: 'REBIRTH · ANCIENT',
    desc: '前世被庶妹和未婚夫毒杀在冷院，重生回到及笄礼前。这一世，仇要报，人要护，大腿要抱最粗的。',
    tag: '古言 · 重生 · 宅斗 · 四结局',
    coverBg: 'bg-night',
    chars: ['萧珩', '沈惊鸿', '碧荷'],
    charsImg: { jiang:'assets/char-xiaoheng.png?v=7', chen:'assets/char-shen.png?v=7', su:'assets/char-bihe.png?v=7' },
    charsName: { jiang:'萧珩', chen:'沈惊鸿', su:'碧荷' },
    statNames: {
      jiang:'萧珩好感', chen:'沈惊鸿好感', su:'碧荷忠诚',
      courage:'胆识', wisdom:'谋略', fame:'名望'
    },
    bgImg: {
      'bg-dawn':'assets/bg-gu-garden.png',
      'bg-class':'assets/bg-gu-room.png?v=3',
      'bg-roof':'assets/bg-gu-garden.png',
      'bg-hall':'assets/bg-gu-hall.png',
      'bg-rain':'assets/bg-gu-room.png',
      'bg-night':'assets/bg-gu-room.png',
      'bg-sunset':'assets/bg-gu-garden.png'
    }
  },
  start: 'gyWake',
  scenes: {

/* ---------- 第一章 醒 ---------- */
gyWake:{
  bg:'bg-night', speaker:'narr',
  text:'冷水泼在脸上。\n\n你猛地睁开眼，雕花拔步床，鲛绡帐子。桌上一面菱花镜——镜中人十五岁，眉目清秀，脖子上没有那道勒痕。\n\n你重生了。\n\n回到了及笄礼前三个月。',
  sprites:[],
  choices:[
    {t:'掐自己一把确认', fx:{courage:1}, et:'胆识 +1', next:'gyMaid'},
    {t:'先回忆前世怎么死的', fx:{wisdom:1}, et:'谋略 +1', next:'gyMaid'}
  ]
},
gyMaid:{
  bg:'bg-class', speaker:'su',
  text:'「姑娘！你可算醒了！」\n\n碧荷端着铜盆冲进来，眼圈红红的。这是你前世最忠心的丫鬟，最后为了护你，被庶妹的人活活打死在雪地里。\n\n你看着她年轻的、还没挨过打的脸，喉咙一紧。',
  sprites:['su'],
  choices:[
    {t:'抓住碧荷的手：「以后有我在，没人敢动你。」', fx:{su:2}, et:'{{su}}忠诚 +2', next:'gyMother'},
    {t:'冷静问：「今天是什么日子？」', fx:{wisdom:1}, et:'谋略 +1', next:'gyMother'}
  ]
},
gyMother:{
  bg:'bg-class', speaker:'narr',
  text:'门帘一挑，你母亲——侯府夫人——快步走进来。\n\n前世她在你"落水"后第三天就被庶妹的娘（柳姨娘）气病，没撑过那个冬天。\n\n她握住你的手：「我的儿，吓死娘了。」\n\n你看着她鬓边还没白的头发，把头埋进她怀里。',
  sprites:[],
  choices:[
    {t:'「娘，以后我护着你。」', fx:{courage:1,wisdom:1}, et:'胆识 +1 · 谋略 +1', next:'gySister'},
    {t:'（默默记下柳姨娘这笔账）', fx:{wisdom:2}, et:'谋略 +2', next:'gySister'}
  ]
},
gySister:{
  bg:'bg-class', speaker:'narr',
  text:'门外环佩叮当。庶妹赵灵珊穿着一身粉色襦裙，笑盈盈地走进来：\n\n「姐姐醒了？听闻姐姐落水，妹妹担心得一宿没睡。」\n\n她递过来一个小瓷瓶：「这是我特意从静安寺求的安神香，姐姐闻着可好睡些。」\n\n前世，就是这瓶香里，被她加了让你身子日渐虚弱的料。',
  sprites:['su'],
  choices:[
    {t:'冷笑：「妹妹倒消息灵通。这香，我怕是受不起。」', fx:{courage:1}, et:'胆识 +1', next:'gyGarden'},
    {t:'假装柔弱接过：「劳妹妹挂心。」', fx:{wisdom:1}, et:'谋略 +1', next:'gyGarden'}
  ]
},

/* ---------- 第二章 后园 ---------- */
gyGarden:{
  bg:'bg-roof', speaker:'narr',
  text:'后花园。\n\n你独自散步盘算下一步。假山后面传来男子的声音。一个是你前世的未婚夫——太子萧玦，正和庶妹低语。\n\n另一个是坐在亭中看戏的——摄政王{{jiang}}。\n\n他抬眼看见你，目光停了一瞬。',
  sprites:['jiang'],
  choices:[
    {t:'转身就走，不凑热闹', fx:{wisdom:1}, et:'谋略 +1', next:'gyDecision'},
    {t:'故意弄出声响，让他们发现你', fx:{courage:1}, et:'胆识 +1', next:'gyPrince'}
  ]
},
gyPrince:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}从亭中缓步走出来。他一身玄色锦袍，腰束玉带，眉眼冷淡如霜。\n\n「赵家大小姐？」他声音很低，「本王倒是第一次见你。」\n\n前世他是权倾朝野的摄政王，最后被太子（你的未婚夫）以谋逆罪赐死。抄家那天，满门妇孺都被发往教坊司。',
  sprites:['jiang'],
  choices:[
    {t:'行礼：「见过王爷。」', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'gyDecision'},
    {t:'直言：「王爷可得小心太子。」', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 胆识 +1', next:'gyDecision'}
  ]
},
gyDecision:{
  bg:'bg-night', speaker:'narr',
  text:'夜里。碧荷研墨，你在纸上写下三行字：\n\n一、及笄礼上，反将庶妹一军。\n二、退婚。这太子，谁爱嫁谁嫁。\n三、找一个比太子更粗的大腿。\n\n窗外落下一只手，敲了敲窗棂。',
  sprites:[],
  choices:[
    {t:'开窗——是{{jiang}}', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'gyNightTalk'},
    {t:'开窗——是沈惊鸿（风流世子）', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyNightTalk2'},
    {t:'不开窗，吹熄蜡烛', fx:{wisdom:1}, et:'谋略 +1', next:'gyPrepare'}
  ]
},
gyNightTalk:{
  bg:'bg-night', speaker:'jiang',
  text:'{{jiang}}翻窗而入，一身夜风吹不散的龙涎香。\n\n「你白天那句话什么意思？」他目光如刀，「你知道太子要对本王做什么？」\n\n你笑了：「王爷信我，我助你登位。你信我，我保你不死。」\n\n他盯着你看了很久，突然笑了：「赵家什么时候出了你这么个东西。」',
  sprites:['jiang'],
  choices:[
    {t:'「合作吗？王爷。」', fx:{jiang:3}, et:'{{jiang}}好感 +3', next:'gyPrepare'},
    {t:'「夜闯闺阁，王爷就不怕我喊人？」', fx:{courage:1}, et:'胆识 +1', next:'gyPrepare'}
  ]
},
gyNightTalk2:{
  bg:'bg-night', speaker:'chen',
  text:'{{chen}}翻窗而入，摇着一把折扇，笑得像个狐狸。\n\n「赵家大小姐好胆识。」他凑近，「我在墙外听了半天——你要退婚？」\n\n他是沈国公府的世子，前世你嫁过去的庶妹被他宠上天，最后他却在庶妹倒台时第一个划清界限。',
  sprites:['chen'],
  choices:[
    {t:'「世子也来听墙根？」', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyPrepare'},
    {t:'「你想娶我？」', fx:{courage:1}, et:'胆识 +1', next:'gyPrepare'}
  ]
},

/* ---------- 第三章 及笄准备 ---------- */
gyPrepare:{
  bg:'bg-class', speaker:'narr',
  text:'接下来的一个月，你没闲着。\n\n你跟母亲学管家，把柳姨娘的中馈一点一点拿回来。你让碧荷把后院的人换了一半，都是你母亲的陪房。\n\n你还每天早起一个时辰，跟着京城最好的妈妈学规矩——前世你在冷院里，连坐都坐不直。',
  sprites:['su'],
  onEnter:{wisdom:2,fame:1},
  next:'gyManage'
},
gyManage:{
  bg:'bg-hall', speaker:'narr',
  text:'管家中馈交接那天，柳姨娘"病了"没来。\n\n你当着全府管事的面，把三年的账本一笔一笔对完。谁在采买里吃了回扣，谁把月例挪去放高利贷，你记得比谁都清楚——前世这些账，最后都成了她捏在你父亲手里的把柄。\n\n三个管事当场跪下。',
  sprites:[],
  choices:[
    {t:'念在初犯，发两个月月钱', fx:{wisdom:1,fame:1}, et:'谋略 +1 · 名望 +1', next:'gyTemple'},
    {t:'直接撵出去，杀鸡儆猴', fx:{courage:2,fame:2}, et:'胆识 +2 · 名望 +2', next:'gyTemple'}
  ]
},
gyTemple:{
  bg:'bg-roof', speaker:'narr',
  text:'静安寺上香。\n\n庶妹"恰好"也来了。她在佛像前跪了你半个时辰，起身时"不小心"把一桶准备泼花的水，往你这边一扬——\n\n前世，你就是这样被泼了一身，在台阶上摔断了手腕。',
  sprites:['su'],
  choices:[
    {t:'侧身让开，让水泼在她自己裙角', fx:{wisdom:2,courage:1}, et:'谋略 +2 · 胆识 +1', next:'gyTempleAfter'},
    {t:'抓住她手腕：「妹妹小心。」', fx:{courage:2,fame:1}, et:'胆识 +2 · 名望 +1', next:'gyTempleAfter'}
  ]
},
gyTempleAfter:{
  bg:'bg-roof', speaker:'narr',
  text:'满堂香客都看着。\n\n庶妹的湿裙子贴在腿上，脸色一阵青一阵白。你微微福身：「妹妹若是累了，便回去歇着。」\n\n旁边一个老夫人合十念了声佛：「赵家这大丫头，倒比我想的沉稳。」',
  sprites:[],
  onEnter:{fame:2},
  next:'gyPoem'
},
gyPoem:{
  bg:'bg-sunset', speaker:'chen',
  text:'三日后。沈国公府办赏花诗会。\n\n{{chen}}——沈惊鸿——亲自递了帖子。你到场时，他正倚在栏杆上摇扇子，看见你就笑：「赵家大小姐，今日可得让我开开眼。」\n\n庶妹也来了，坐在角落里，指甲掐进了掌心。',
  sprites:['chen'],
  choices:[
    {t:'当场作一首，技惊四座', fx:{chen:2,wisdom:1,fame:1}, et:'{{chen}}好感 +2 · 谋略 +1 · 名望 +1', next:'gyBanquet'},
    {t:'推说身体不适，早走', fx:{wisdom:1}, et:'谋略 +1', next:'gyBanquet'}
  ]
},
gyBanquet:{
  bg:'bg-hall', speaker:'narr',
  text:'赏花宴。\n\n京中贵女都来了。庶妹准备了一肚子挑拨的话，可你只是笑，把她每一句都轻轻挡了回去。\n\n她急了，指着你头上的钗：「姐姐这支钗……是太子殿下送的吧？」\n\n满座安静下来。',
  sprites:[],
  choices:[
    {t:'把钗拔下来，放在桌上：「是。但我现在不想戴了。」', fx:{courage:2,fame:2}, et:'胆识 +2 · 名望 +2', next:'gyRite'},
    {t:'笑而不答，转话题', fx:{wisdom:1}, et:'谋略 +1', next:'gyRite'}
  ]
},

/* ---------- 第四章 及笄礼 ---------- */
gyRite:{
  bg:'bg-sunset', speaker:'narr',
  text:'及笄礼。\n\n满座宾客。\n\n庶妹果然在你下水的台阶上动了手脚。但你早有准备——她伸手推你的那一刻，你侧身让开，她自己一脚踩空，跌进了水池里。\n\n满堂哗然。',
  sprites:[],
  onEnter:{wisdom:2,courage:1,fame:1},
  next:'gyRetreat'
},
gyRetreat:{
  bg:'bg-hall', speaker:'narr',
  text:'你当着满座宾客的面，向皇帝递了退婚折子。\n\n「太子殿下，高攀不起。」\n\n太子脸色铁青。庶妹在水里被捞起来，浑身湿透。\n\n摄政王{{jiang}}在席间端起酒杯，对你遥遥一敬。',
  sprites:['jiang'],
  choices:[
    {t:'回敬{{jiang}}一杯', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'gyPalace'},
    {t:'看向{{chen}}（他在角落偷笑）', fx:{chen:2}, et:'{{chen}}好感 +2', next:'gyPalace'},
    {t:'转身离席，不看任何人', fx:{courage:2}, et:'胆识 +2', next:'gyPalace'}
  ]
},

/* ---------- 第五章 反扑 ---------- */
gyPalace:{
  bg:'bg-hall', speaker:'narr',
  text:'退婚的折子递上去第三天，宫里来了旨。\n\n皇帝"夸"你知礼，赏了一对玉镯。可你知道，太子在皇帝面前告了你一状。\n\n回家路上，碧荷低声说：「姑娘，柳姨娘那边……最近在往外头递话，说你克父克母。」',
  sprites:['su'],
  choices:[
    {t:'收集柳姨娘放高利贷的证据', fx:{wisdom:2}, et:'谋略 +2', next:'gyPoison'},
    {t:'直接告诉父亲', fx:{courage:1}, et:'胆识 +1', next:'gyPoison'}
  ]
},
gyPoison:{
  bg:'bg-class', speaker:'narr',
  text:'晚上。\n\n你小厨房送来的燕窝，碧荷刚要盛，你拦住了。\n\n"拿银针试试。"\n\n银针，黑了。\n\n你看着那盏燕窝，手心里全是汗。前世你就是这样，被一勺一勺喂了三年的慢药。',
  sprites:['su'],
  choices:[
    {t:'把燕窝原样送回柳姨娘院里', fx:{wisdom:2,courage:1}, et:'谋略 +2 · 胆识 +1', next:'gyBibo'},
    {t:'留着，作为证据', fx:{wisdom:1}, et:'谋略 +1', next:'gyBibo'}
  ]
},
gyBibo:{
  bg:'bg-night', speaker:'su',
  text:'碧荷"扑通"跪下了。\n\n「姑娘，是我没用，让人在小厨房安了钉子。」\n\n你把她扶起来：「不怪你。从今天起，小厨房的人全部换。你亲自盯着。」\n\n她哭着点头。你看着她——前世她替你死了，这一世，你替她挡。',
  sprites:['su'],
  onEnter:{su:2},
  next:'gyBiboFamily'
},
gyBiboFamily:{
  bg:'bg-night', speaker:'narr',
  text:'三日后。\n\n碧荷的爹在城外码头被人打断了一条腿。她弟弟被衙门抓了，说偷了东西。\n\n她跪在你面前，哭得说不出整话。你知道这是柳姨娘临死前的反扑——她在拿碧荷的家人警告你。',
  sprites:['su'],
  choices:[
    {t:'直接动用你新接手的中馈，把人捞出来', fx:{su:3,courage:1,fame:1}, et:'{{su}}忠诚 +3 · 胆识 +1 · 名望 +1', next:'gySnow'},
    {t:'去找父亲，当面陈情', fx:{wisdom:1}, et:'谋略 +1', next:'gySnow'}
  ]
},

/* ---------- 第六章 雪夜 ---------- */
gySnow:{
  bg:'bg-night', speaker:'narr',
  text:'腊月初八。大雪。\n\n你在院子里看雪，门房来报：摄政王府递了帖子，请你过府赏梅。\n\n——这是把合作摆到台面上了。',
  sprites:[],
  choices:[
    {t:'去。换衣服，上轿', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 胆识 +1', next:'gyHorse'},
    {t:'称病不去', fx:{wisdom:1}, et:'谋略 +1', next:'gyCoup'}
  ]
},
gyHorse:{
  bg:'bg-night', speaker:'jiang',
  text:'摄政王府的梅林在雪夜里开得吓人。\n\n{{jiang}}站在梅树下，一身白色大氅。他递给你一只手炉：「手这么冰。」\n\n「太子最近在查本王。」他声音很低，「下个月，本王要动一动。你帮不帮？」',
  sprites:['jiang'],
  choices:[
    {t:'「我帮你。」', fx:{jiang:3,wisdom:1}, et:'{{jiang}}好感 +3 · 谋略 +1', next:'gyRiding'},
    {t:'「我能做什么？」', fx:{wisdom:1}, et:'谋略 +1', next:'gyRiding'}
  ]
},
gyRiding:{
  bg:'bg-roof', speaker:'narr',
  text:'春猎。\n\n太子设局，邀京中贵女同去围场。你知道他想在猎场"惊马"伤你——前世他就是这样吓疯了另一个反对他的官员之女。\n\n{{jiang}}暗中让人给你牵来一匹温顺的老马。他在你耳边说：「跟在我身后，别逞强。」',
  sprites:['jiang'],
  choices:[
    {t:'听话，跟在他身后', fx:{jiang:2,wisdom:1}, et:'{{jiang}}好感 +2 · 谋略 +1', next:'gyCoup'},
    {t:'故意惊了马，反过来嫁祸太子的人', fx:{courage:2,wisdom:2}, et:'胆识 +2 · 谋略 +2', next:'gyCoup'}
  ]
},
gyCoup:{
  bg:'bg-hall', speaker:'narr',
  text:'半个月后。\n\n{{jiang}}以"谋逆"罪名拿下太子，扶三皇子登基。\n\n消息传进侯府那天，柳姨娘在自己院里自缢了。庶妹被父亲送去家庙。\n\n你站在廊下，听着外头的爆竹声，突然觉得空。',
  sprites:[],
  onEnter:{fame:3,wisdom:1},
  next:'gyEnding'
},

/* ---------- 结局 ---------- */
gyEnding:{
  bg:'bg-night', speaker:'narr',
  text:'夜已深。\n\n你站在廊下，风卷起宫灯的流苏。\n\n这一世，你不再是那个任人宰割的嫡女。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 8) return 'gyEndEmpress';
    if(st.chen >= 6) return 'gyEndPrince';
    if(st.courage >= 6 && st.wisdom >= 6) return 'gyEndLady';
    return 'gyEndNormal';
  }
},
gyEndEmpress:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}亲自来赵家提亲。\n\n他把凤冠放在你手上：「本王不需要一个皇后。」\n\n「本王要一个和我并肩的人。」',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · 古A',
    title:'权倾天下',
    text:'你成了大曜最有权势的女人。\n\n不是皇后，是摄政王身边那个能站着和他议事的人。庶妹被送去了家庙，太子被圈禁终身。\n\n前世欠你的，这一世连本带利都讨回来了。\n\n——至于爱情？你和他之间，早就超越了那个字。'
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

/* ============================================================
 * 剧本三：星光入场券（现代娱乐圈重生）
 * ============================================================ */
'xian-star': {
  meta: {
    title: '星光入场券',
    subtitle: 'REBIRTH · ENTERTAINMENT',
    desc: '前世被全网黑到退圈，重生回到选秀前夜。这一次，舞台是你的，话筒是你的，黑热搜你也接得住。',
    tag: '现代 · 重生 · 娱乐圈 · 四结局',
    coverBg: 'bg-sunset',
    chars: ['陆时衍', '顾星眠', '唐糖'],
    charsImg: { jiang:'assets/char-lu.png?v=3', chen:'assets/char-gu.png?v=7', su:'assets/char-tang.png?v=3' },
    charsName: { jiang:'陆时衍', chen:'顾星眠', su:'唐糖' },
    statNames: {
      jiang:'陆时衍好感', chen:'顾星眠好感', su:'唐糖信任',
      courage:'魄力', wisdom:'才智', fame:'人气'
    },
    bgImg: {
      'bg-dawn':'assets/bg-star-makeup.png',
      'bg-class':'assets/bg-star-makeup.png',
      'bg-roof':'assets/bg-star-stage.png',
      'bg-hall':'assets/bg-star-redcarpet.png',
      'bg-rain':'assets/bg-star-makeup.png',
      'bg-night':'assets/bg-star-stage.png',
      'bg-sunset':'assets/bg-star-redcarpet.png'
    }
  },
  start: 'starWake',
  scenes: {

/* ---------- 第一章 醒 ---------- */
starWake:{
  bg:'bg-night', speaker:'narr',
  text:'化妆间。镜子里是一张黑眼圈的脸。\n\n桌上手机弹出推送：《选秀选手{{player}}凌晨发文卖惨，网友：又卖人设》。\n\n你认得这条热搜。前世你就是从这一刻开始，一步步被网暴到退圈、抑郁、最后车祸身亡。\n\n那辆车撞过来的时候，你正在哭着看一条"去死"的私信。',
  sprites:[],
  choices:[
    {t:'删掉那条卖惨微博', fx:{wisdom:1}, et:'才智 +1', next:'starAgent'},
    {t:'先睡一觉，明天再说', fx:{courage:1}, et:'魄力 +1', next:'starAgent'}
  ]
},
starAgent:{
  bg:'bg-class', speaker:'su',
  text:'门被推开。经纪人{{su}}——唐糖——把一杯冰咖啡拍在桌上。\n\n「你疯了？明天就是初舞台，你现在发这种微博？」\n\n她眼圈是黑的，显然又陪你熬了一夜。前世你骂过她"你根本不懂我"，她第二天就递了辞呈，后来你听说她抑郁症住院。',
  sprites:['su'],
  choices:[
    {t:'「糖糖，对不起。以后我听你的。」', fx:{su:2}, et:'{{su}}信任 +2', next:'starBackstage'},
    {t:'「帮我删掉那条。」', fx:{wisdom:1}, et:'才智 +1', next:'starBackstage'}
  ]
},

/* ---------- 第二章 初舞台 ---------- */
starBackstage:{
  bg:'bg-hall', speaker:'narr',
  text:'选秀初舞台。后台挤满了练习生。\n\n你看见顶流影帝{{jiang}}——陆时衍，坐在评委席第一排。他是这档节目的导师，前世你连他的微信都没加上。\n\n另一边，你的对家{{chen}}——顾星眠，正冲你假笑。她旁边围着三四个练习生，正在咬耳朵。',
  sprites:['jiang','chen'],
  choices:[
    {t:'主动去和{{jiang}}打招呼', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'starStage'},
    {t:'不理会{{chen}}，自己练舞', fx:{wisdom:1}, et:'才智 +1', next:'starStage'},
    {t:'走过去和{{chen}}说话', fx:{chen:1}, et:'{{chen}}好感 +1', next:'starStage'}
  ]
},
starStage:{
  bg:'bg-sunset', speaker:'narr',
  text:'聚光灯。\n\n你站在舞台中央。\n\n前世你唱了一首公司给的安全歌，成绩中游。这一次，你选了一首自己写的、关于网暴的歌。\n\n台下安静了。{{jiang}}抬起头，第一次正眼看你。',
  sprites:['jiang'],
  onEnter:{courage:2,wisdom:1,fame:1},
  next:'starAfter'
},
starAfter:{
  bg:'bg-class', speaker:'jiang',
  text:'表演结束。{{jiang}}在后台拦住你。\n\n「那首歌是你自己写的？」他声音很淡，但眼神认真，「你以前不唱这种。」\n\n你心里一紧——他知道你以前什么样。',
  sprites:['jiang'],
  choices:[
    {t:'「人总会长大。」', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'starDorm'},
    {t:'「导师过奖。」', fx:{}, et:'', next:'starDorm'}
  ]
},

/* ---------- 第三章 宿舍 ---------- */
starDorm:{
  bg:'bg-class', speaker:'narr',
  text:'节目录了一周，练习生都住进了节目组安排的宿舍。\n\n你和另外三个女孩一间。其中一个叫小林，是个十八线小模特，夜里偷偷哭，说家里要她退赛。\n\n{{su}}——唐糖——给你发消息：「最近顾星眠那边在买水军，盯着你呢。」',
  sprites:[],
  choices:[
    {t:'陪小林聊一晚上', fx:{su:1,courage:1}, et:'{{su}}信任 +1 · 魄力 +1', next:'starDorm2'},
    {t:'不管，自己背歌词', fx:{wisdom:1}, et:'才智 +1', next:'starDorm2'}
  ]
},
starDorm2:{
  bg:'bg-night', speaker:'narr',
  text:'凌晨两点。\n\n小林蜷在被窝里，声音很小：「{{player}}姐，你是不是被网上那些话骂过？我看你微博评论了。」\n\n你沉默了一会儿：「骂过。」\n\n「那你怎么扛过来的？」\n\n你想了想：「因为我知道，我不是他们说的那种人。」',
  sprites:[],
  onEnter:{su:1,fame:1},
  next:'starTeammate'
},
starTeammate:{
  bg:'bg-class', speaker:'narr',
  text:'第二天分组公演。\n\n你被分到了B组，组长是顾星眠。\n\n她把最难的那段舞蹈留给你，自己挑了最省力的位置。其他组员敢怒不敢言。\n\n你看着她，笑了一下：「行啊。」',
  sprites:['chen'],
  choices:[
    {t:'练到凌晨，把那段舞跳到最好', fx:{courage:2,fame:1}, et:'魄力 +2 · 人气 +1', next:'starRehearse'},
    {t:'找节目组换组', fx:{wisdom:1}, et:'才智 +1', next:'starRehearse'}
  ]
},

/* ---------- 第四章 公演 ---------- */
starRehearse:{
  bg:'bg-roof', speaker:'narr',
  text:'排练室。\n\n你一遍一遍跳那段难舞。膝盖青了，喉咙哑了。{{chen}}在旁边练她的简单段落，眼神闪烁。\n\n凌晨三点，排练室只剩你。门被推开——是{{jiang}}。\n\n他不知道怎么进来的，手里提着一袋热豆浆。',
  sprites:['jiang'],
  choices:[
    {t:'「导师怎么还没走？」', fx:{jiang:1}, et:'{{jiang}}好感 +1', next:'starShowcase'},
    {t:'接过豆浆，鞠了一躬', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'starShowcase'}
  ]
},
starShowcase:{
  bg:'bg-sunset', speaker:'narr',
  text:'公演舞台。\n\n你站在C位，那段最难的舞一个动作没跳错。ending pose的时候，聚光灯打在你脸上。\n\n台下尖叫。\n\n{{chen}}在你旁边笑，但你看见她攥紧的拳头。',
  sprites:['chen'],
  onEnter:{fame:3,courage:1},
  next:'starInterview'
},
starInterview:{
  bg:'bg-hall', speaker:'narr',
  text:'后台采访。\n\n记者把话筒怼到你脸上：「{{player}}，你刚才的ending pose是站在C位的。你知道这意味着什么吗？」\n\n你知道。这意味着{{chen}}的粉丝明天会把你撕了。\n\n你笑了一下：「意味着我昨晚练到三点，没白练。」',
  sprites:[],
  choices:[
    {t:'顺便夸一下队友', fx:{chen:1,fame:1}, et:'{{chen}}好感 +1 · 人气 +1', next:'starTrend'},
    {t:'不接话，直接走', fx:{courage:1}, et:'魄力 +1', next:'starTrend'}
  ]
},

/* ---------- 第五章 黑热搜 ---------- */
starTrend:{
  bg:'bg-night', speaker:'narr',
  text:'公演结束两小时，热搜炸了。\n\n#{{player}}皇族# #{{player}}加戏# #顾星眠被抢C位#\n\n点进去，全是"她肯定后台有人""那种歌也能上台""长得就一副心机样"。\n\n前世，你就是被这些字逼到崩溃的。',
  sprites:[],
  choices:[
    {t:'开直播，正面回应', fx:{courage:2,fame:1}, et:'魄力 +2 · 人气 +1', next:'starClarify'},
    {t:'不理，让{{su}}处理', fx:{wisdom:1}, et:'才智 +1', next:'starClarify'}
  ]
},
starClarify:{
  bg:'bg-night', speaker:'narr',
  text:'你点开直播。\n\n一万人涌进来。弹幕是黑的。\n\n你没有哭。你看着镜头，把公演那段舞的排练视频放出来——凌晨三点的排练室，{{jiang}}提着豆浆站在门口。\n\n「这段舞是我自己练的。」你说，「热搜我看过了。我不解释。\n\n我只希望，下次你们骂我的时候，先看看我做了什么。」',
  sprites:[],
  onEnter:{courage:2,fame:2},
  next:'starFans'
},
starFans:{
  bg:'bg-night', speaker:'su',
  text:'直播结束一小时。\n\n{{su}}——唐糖——冲进你宿舍，手机举到你脸上：「你看！」\n\n热搜变了。\n\n#{{player}}好刚# #被网暴的女孩# #凌晨三点排练室#\n\n前排热评：「对不起，之前骂错了。」「这才是选秀该有的人。」「路转粉。」\n\n{{su}}红着眼眶：「{{player}}，我们有粉丝了。真的粉丝。」',
  sprites:['su'],
  onEnter:{fame:2,su:1},
  next:'starMentor'
},

/* ---------- 第六章 导师 ---------- */
starMentor:{
  bg:'bg-class', speaker:'jiang',
  text:'第二天。\n\n{{jiang}}把你叫到他的休息室。\n\n「你昨晚那个直播，我看了。」他递给你一份合同，「我有个电影女二号，缺个新人。你要不要试镜？」\n\n——前世这个角色，是顾星眠的。',
  sprites:['jiang'],
  choices:[
    {t:'「我试。」', fx:{jiang:2,courage:1}, et:'{{jiang}}好感 +2 · 魄力 +1', next:'starPrivate'},
    {t:'「我怕我配不上。」', fx:{wisdom:1}, et:'才智 +1', next:'starPrivate'}
  ]
},
starPrivate:{
  bg:'bg-night', speaker:'jiang',
  text:'试镜在一个下雨天。\n\n{{jiang}}亲自给你讲戏。他离你很近，你能闻到他身上的雪松味。\n\n「你演过被网暴的人。」他忽然说，「你怎么演那种眼神？」\n\n你愣住了。他看出来了。',
  sprites:['jiang'],
  choices:[
    {t:'「因为我就是。」', fx:{jiang:3,courage:2}, et:'{{jiang}}好感 +3 · 魄力 +2', next:'starLuPast'},
    {t:'「演的。」', fx:{wisdom:1}, et:'才智 +1', next:'starLuPast'}
  ]
},
starLuPast:{
  bg:'bg-night', speaker:'jiang',
  text:'他沉默了很久，从钱包里掏出一张旧照片。\n\n照片上是一个笑得很灿烂的女孩。\n\n「我妹妹。」他声音很平，「六年前，她也是被网暴。十九岁，从家里楼顶跳下去的。」\n\n「所以我看你的时候，总觉得在看她。」他把照片收起来，「你别学她。」',
  sprites:['jiang'],
  onEnter:{jiang:2},
  next:'starFinalePrep'
},

/* ---------- 第七章 决赛 ---------- */
starFinalePrep:{
  bg:'bg-night', speaker:'narr',
  text:'决赛周。\n\n公司给你两个选择：一是抱{{jiang}}的大腿炒CP，二是和{{chen}}和解炒闺蜜情。\n\n{{su}}——唐糖——看着你：「你选哪个？我都帮你运作。」',
  sprites:['su'],
  choices:[
    {t:'选{{jiang}}路线', fx:{jiang:2}, et:'{{jiang}}好感 +2', next:'starEnd'},
    {t:'选{{chen}}路线', fx:{chen:2}, et:'{{chen}}好感 +2', next:'starEnd'},
    {t:'都不选，自己单干', fx:{courage:2}, et:'魄力 +2', next:'starEnd'}
  ]
},
starEnd:{
  bg:'bg-sunset', speaker:'narr',
  text:'决赛夜。\n\n聚光灯打在你身上。\n\n这一次，你不是那个被全网黑的小透明了。',
  sprites:[],
  next:function(st){
    if(st.jiang >= 6) return 'starEndBest';
    if(st.chen >= 5) return 'starEndIdol';
    if(st.courage >= 6 && st.wisdom >= 4) return 'starEndQuit';
    return 'starEndNormal';
  }
},
starEndBest:{
  bg:'bg-sunset', speaker:'jiang',
  text:'{{jiang}}在赛后采访被问到你。\n\n他难得地笑了：「她是我见过最有天赋也最倔强的选手。」\n\n当晚他微博关注了你。评论区炸了。',
  sprites:['jiang'],
  ending:{
    tag:'ENDING · 星A',
    title:'影后之路',
    text:'后来你拿了金马影后。\n\n领奖台上你感谢了{{jiang}}，他在台下鼓掌。\n\n你们没有在一起，但他成了你这辈子最尊重的前辈。前世的网暴，被你用作品一句话堵了回去。'
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
  text:'后台。\n\n你卸下妆。\n\n{{su}}递过来一瓶水：「辛苦了。」\n\n你笑了笑。路还长。',
  sprites:['su'],
  ending:{
    tag:'ENDING · 星D',
    title:'未完待续',
    text:'这只是开始。\n\n你不再是那个被全网黑到抑郁的小透明。\n\n前路漫漫，星光刚亮。'
  }
}

  }
}

};
