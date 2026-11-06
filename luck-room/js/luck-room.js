(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var DATA_KEY = 'maomao_luck_room_v1';
var SETTINGS_KEY = 'maomao_luck_room_settings_v1';
var DISCLAIMER = '以上内容均为娱乐体验，不具备预测未来或指导现实决策的作用，请勿当真，一切仅供娱乐参考。';
var DEFAULT_POOLS = [
  { id: 'meal', name: '中午吃什么', items: ['火锅', '寿司', '面条', '汉堡', '盖饭', '饺子'] },
  { id: 'weekend', name: '周末做什么', items: ['看一场电影', '去散步', '逛逛街', '在家休息', '找一家新店'] },
  { id: 'little-task', name: '今天的小任务', items: ['整理一个小角落', '听一张专辑', '给朋友发消息', '读几页书', '早点休息'] }
];
var DEFAULT_WHEELS = [
  { id: 'lunch', name: '中午吃什么', items: ['火锅', '面条', '寿司', '汉堡', '咖喱饭', '饺子'] },
  { id: 'weekend', name: '周末做什么', items: ['看电影', '逛街', '去公园', '宅家', '喝咖啡', '短途走走'] },
  { id: 'watch', name: '今晚看什么', items: ['喜剧', '纪录片', '悬疑片', '动画', '随便挑一部'] }
];
var TAROT_MAJOR = [
  ['0','愚者','新的开始 · 好奇 · 自由','留意冲动与准备不足，给自己一点观察时间。','灵感与探索','轻率与分心','◇'],
  ['I','魔术师','行动力 · 创造 · 专注','你拥有把想法变成小行动的资源。','表达与执行','分散与过度承诺','✧'],
  ['II','女祭司','直觉 · 静观 · 内在','先安静听听自己的想法，不必急着下结论。','观察与倾听','信息不足与猜测','☾'],
  ['III','皇后','滋养 · 创造 · 丰盛','照顾好日常，也给创意留出空间。','温柔与生长','忽略需求与过度付出','❀'],
  ['IV','皇帝','结构 · 边界 · 稳定','把复杂的事分成清楚的小步骤。','秩序与计划','僵化与控制','▣'],
  ['V','教皇','经验 · 学习 · 传统','参考可靠经验，也保留独立判断。','学习与交流','盲从与固守','⌂'],
  ['VI','恋人','连接 · 选择 · 价值','看清自己重视什么，再做小小选择。','坦诚与共识','犹豫与不协调','♡'],
  ['VII','战车','方向 · 推进 · 自律','选定一个方向，稳稳地向前一点。','专注与行动','急躁与失去节奏','➤'],
  ['VIII','力量','耐心 · 勇气 · 温和','温和并不等于软弱，耐心也是一种力量。','韧性与自信','急于证明与消耗','∞'],
  ['IX','隐者','独处 · 反思 · 寻找','给自己一点独处时间，整理真正重要的事。','思考与沉淀','封闭与过度孤立','⌕'],
  ['X','命运之轮','变化 · 周期 · 机会','变化会带来新视角，保持灵活就好。','转机与适应','反复与不确定','◉'],
  ['XI','正义','平衡 · 诚实 · 判断','尽量看完整信息，再做公平的判断。','清晰与平衡','偏见与信息缺口','⚖'],
  ['XII','倒吊人','暂停 · 换位 · 等待','暂时停一停，换个角度也许会有新发现。','换位思考','拖延与停滞','⌁'],
  ['XIII','死神','转变 · 告别 · 更新','某个阶段可以结束了，为新的安排腾出位置。','更新与整理','抗拒改变','✦'],
  ['XIV','节制','协调 · 节奏 · 融合','不用一次做到完美，找到适合自己的节奏。','调和与耐心','失衡与过量','◌'],
  ['XV','恶魔','欲望 · 习惯 · 觉察','注意那些让你分心的习惯，重新拿回主动权。','看见束缚','沉迷与自我限制','⌘'],
  ['XVI','高塔','震动 · 重整 · 真实','计划出现变化时，先确认事实，再慢慢调整。','打破旧框架','慌乱与抗拒','⌂'],
  ['XVII','星星','希望 · 修复 · 灵感','给自己一点恢复空间，继续保留希望。','灵感与信心','疲惫与失望','✧'],
  ['XVIII','月亮','想象 · 情绪 · 未知','信息不完整时先别急着判断，照顾当下感受。','想象与敏感','误解与不安','☽'],
  ['XIX','太阳','明朗 · 活力 · 分享','把简单的快乐留给今天，也分享一点好心情。','活力与表达','疲惫与过度乐观','☼'],
  ['XX','审判','回顾 · 醒悟 · 新阶段','回顾经验，挑一件真正想继续的事。','觉察与重启','自我苛责与犹豫','⌁'],
  ['XXI','世界','完成 · 整合 · 旅程','认可已经走过的路，再开始下一段。','收获与完整','未完成感与分散','◎']
];
var TAROT_MINOR = [
  { roman:'A', name:'权杖王牌', suit:'权杖', keywords:'灵感 · 起步', upright:'新的兴趣或创作冲动正在出现。先迈出一个小步，看看它会带你去哪里。', reversed:'热情暂时分散，或计划还没有准备好。先整理资源，不必急着证明什么。', glyph:'Ⅰ' },
  { roman:'II', name:'权杖二', suit:'权杖', keywords:'规划 · 视野', upright:'你正在比较不同方向。把眼前选择写下来，再决定下一步。', reversed:'计划可能过于宽泛，或因顾虑而迟迟没有行动。先缩小范围。', glyph:'Ⅱ' },
  { roman:'III', name:'权杖三', suit:'权杖', keywords:'拓展 · 等待', upright:'已经开始的事情需要一点时间发酵。保持开放，也留意新的可能。', reversed:'进展不如预期时，可以重新检查时间与资源安排。', glyph:'Ⅲ' },
  { roman:'IV', name:'权杖四', suit:'权杖', keywords:'庆祝 · 安定', upright:'适合分享阶段性成果，与身边的人一起享受片刻轻松。', reversed:'聚会或安排可能有变化，给彼此留一点弹性。', glyph:'Ⅳ' },
  { roman:'V', name:'权杖五', suit:'权杖', keywords:'磨合 · 竞争', upright:'不同意见带来碰撞，也可能帮助你发现更好的做法。', reversed:'不必为了争个输赢消耗太多精力，先找共同目标。', glyph:'Ⅴ' },
  { roman:'VI', name:'权杖六', suit:'权杖', keywords:'认可 · 进展', upright:'一次努力值得被看见。记得认可自己，也感谢协作的人。', reversed:'暂时没得到回应，不代表努力没有价值；把注意力放回过程。', glyph:'Ⅵ' },
  { roman:'VII', name:'权杖七', suit:'权杖', keywords:'立场 · 坚持', upright:'守住真正重要的原则，同时给不同观点留出交流空间。', reversed:'压力堆积时，分清哪些事值得坚持，哪些可以暂时放下。', glyph:'Ⅶ' },
  { roman:'VIII', name:'权杖八', suit:'权杖', keywords:'速度 · 消息', upright:'事情可能进入较快节奏。确认重点后，顺势处理眼前事项。', reversed:'消息或安排稍有延迟，先核对信息，不必急着下判断。', glyph:'Ⅷ' },
  { roman:'IX', name:'权杖九', suit:'权杖', keywords:'韧性 · 边界', upright:'你已经积累了经验。继续保持耐心，也记得给自己休息空间。', reversed:'长期紧绷容易让人疲惫。适当求助或调整边界并不是退步。', glyph:'Ⅸ' },
  { roman:'X', name:'权杖十', suit:'权杖', keywords:'责任 · 分担', upright:'手上的责任有些多了。重新排序，看看哪些任务可以分担。', reversed:'放下不必要的负担，或把复杂任务拆成更容易完成的小步。', glyph:'Ⅹ' },
  { roman:'P', name:'权杖侍从', suit:'权杖', keywords:'好奇 · 尝试', upright:'一个新点子值得探索。先做轻量尝试，再决定是否深入。', reversed:'热情来得快也容易散。为想法加一个简单计划会更稳妥。', glyph:'侍' },
  { roman:'N', name:'权杖骑士', suit:'权杖', keywords:'行动 · 冲劲', upright:'行动力很强，适合推进明确的小目标，同时留意节奏。', reversed:'冲得太快容易忽略细节。停一停，确认方向再继续。', glyph:'骑' },
  { roman:'Q', name:'权杖王后', suit:'权杖', keywords:'自信 · 温暖', upright:'用坦然和热情表达自己，也能给周围的人带来鼓励。', reversed:'不要为了照顾所有人的期待而忽略自己的需求。', glyph:'后' },
  { roman:'K', name:'权杖国王', suit:'权杖', keywords:'愿景 · 领导', upright:'把长远想法变成清晰步骤，并以身作则推动事情。', reversed:'热情需要配合倾听与协商，避免把个人节奏强加给别人。', glyph:'王' },

  { roman:'A', name:'圣杯王牌', suit:'圣杯', keywords:'感受 · 开始', upright:'新的情感体验或创作灵感正在萌芽。允许自己感受，也保持真诚。', reversed:'情绪暂时不容易表达。先照顾好自己，再慢慢整理感受。', glyph:'∪' },
  { roman:'II', name:'圣杯二', suit:'圣杯', keywords:'互相 · 共鸣', upright:'一次平等的交流有机会增进理解。把真实想法温和说出来。', reversed:'彼此期待可能没有对齐，试着确认对方真正想表达什么。', glyph:'Ⅱ' },
  { roman:'III', name:'圣杯三', suit:'圣杯', keywords:'友谊 · 分享', upright:'适合与朋友分享好消息，或为一件小事庆祝。', reversed:'社交安排可能太满。选择让自己舒服的相处方式。', glyph:'Ⅲ' },
  { roman:'IV', name:'圣杯四', suit:'圣杯', keywords:'停顿 · 觉察', upright:'先停下来确认自己真正需要什么，再决定是否接受新的机会。', reversed:'重新留意身边的小变化，也许有被忽略的选择。', glyph:'Ⅳ' },
  { roman:'V', name:'圣杯五', suit:'圣杯', keywords:'失落 · 接纳', upright:'允许自己对未如愿的部分感到失望，同时看看仍然拥有的支持。', reversed:'情绪开始松动，可以从一件很小的事情重新找回节奏。', glyph:'Ⅴ' },
  { roman:'VI', name:'圣杯六', suit:'圣杯', keywords:'回忆 · 善意', upright:'回忆能带来温暖，也能提醒你哪些关系与习惯值得珍惜。', reversed:'不必只停留在过去。把曾经的经验带进当下的新选择。', glyph:'Ⅵ' },
  { roman:'VII', name:'圣杯七', suit:'圣杯', keywords:'想象 · 选择', upright:'想法和选项很多。先分清真正想要的与一时被吸引的内容。', reversed:'逐渐看清重点，可以把注意力收回到最实际的一两个选项。', glyph:'Ⅶ' },
  { roman:'VIII', name:'圣杯八', suit:'圣杯', keywords:'转向 · 寻找', upright:'某件事也许已经不再适合现在的你。允许自己重新寻找方向。', reversed:'离开或留下都需要时间想清楚，不必因为一时疲惫仓促决定。', glyph:'Ⅷ' },
  { roman:'IX', name:'圣杯九', suit:'圣杯', keywords:'满足 · 感谢', upright:'留意已经完成的小愿望，认真享受当下的满足感。', reversed:'外在看起来不错，不代表内心一定满足。给真实需求留点空间。', glyph:'Ⅸ' },
  { roman:'X', name:'圣杯十', suit:'圣杯', keywords:'归属 · 和谐', upright:'关系中的支持与理解值得珍惜，也可以主动表达感谢。', reversed:'每个人对和谐的想象不同，沟通具体期待会比追求完美更有用。', glyph:'Ⅹ' },
  { roman:'P', name:'圣杯侍从', suit:'圣杯', keywords:'敏感 · 灵感', upright:'保持好奇和柔软，新的灵感可能来自一件微小的日常。', reversed:'情绪容易受到外界影响。先确认事实，再回应感受。', glyph:'侍' },
  { roman:'N', name:'圣杯骑士', suit:'圣杯', keywords:'邀请 · 浪漫', upright:'以温柔和真诚表达欣赏，也要让行动与承诺保持一致。', reversed:'不要只凭想象填补信息空白，先观察对方真实的表达。', glyph:'骑' },
  { roman:'Q', name:'圣杯王后', suit:'圣杯', keywords:'共情 · 直觉', upright:'认真倾听自己与他人的感受，同时保留清晰的个人边界。', reversed:'共情不等于承担所有人的情绪，照顾自己同样重要。', glyph:'后' },
  { roman:'K', name:'圣杯国王', suit:'圣杯', keywords:'平和 · 成熟', upright:'以稳定和理解面对复杂感受，让温和与原则并存。', reversed:'情绪可能被压得太深。找一个安全、合适的方式表达出来。', glyph:'王' },

  { roman:'A', name:'宝剑王牌', suit:'宝剑', keywords:'清晰 · 真相', upright:'新的理解或关键线索出现。整理信息，用清楚的语言表达判断。', reversed:'信息仍有缺口，先核对来源与细节，避免急着定论。', glyph:'╱' },
  { roman:'II', name:'宝剑二', suit:'宝剑', keywords:'权衡 · 暂缓', upright:'面对两种选择时，给自己一点时间比较事实与在意之处。', reversed:'回避已久的问题需要被看见。先处理最容易确认的一部分。', glyph:'Ⅱ' },
  { roman:'III', name:'宝剑三', suit:'宝剑', keywords:'诚实 · 疏理', upright:'坦诚面对失望或误会，给情绪一个被理解和梳理的空间。', reversed:'修复需要循序渐进。不要催促自己立刻恢复如常。', glyph:'Ⅲ' },
  { roman:'IV', name:'宝剑四', suit:'宝剑', keywords:'休整 · 沉淀', upright:'适合暂时减少干扰，让思绪和精力得到休整。', reversed:'休息太久也可能让人更难开始。选一件轻量任务重新启动。', glyph:'Ⅳ' },
  { roman:'V', name:'宝剑五', suit:'宝剑', keywords:'分歧 · 取舍', upright:'争论的输赢未必等于真正的收获。想想怎样解决问题而非延长冲突。', reversed:'可以尝试放下无意义的较劲，必要时坦诚修补沟通。', glyph:'Ⅴ' },
  { roman:'VI', name:'宝剑六', suit:'宝剑', keywords:'过渡 · 调整', upright:'你正在从复杂阶段走向较清晰的安排，允许变化慢慢发生。', reversed:'旧问题可能仍有牵连。先处理现实阻碍，不必要求一步到位。', glyph:'Ⅵ' },
  { roman:'VII', name:'宝剑七', suit:'宝剑', keywords:'策略 · 诚实', upright:'灵活思考有帮助，但重要事情仍要建立在坦诚和可靠信息上。', reversed:'遗漏的信息需要补齐。主动说明情况有助于重新建立信任。', glyph:'Ⅶ' },
  { roman:'VIII', name:'宝剑八', suit:'宝剑', keywords:'限制 · 视角', upright:'感觉受限时，试着区分实际阻碍与自己尚未验证的担忧。', reversed:'你可能正在发现新的解决路径，从一个小选择开始恢复主动。', glyph:'Ⅷ' },
  { roman:'IX', name:'宝剑九', suit:'宝剑', keywords:'担忧 · 安顿', upright:'脑中的担心值得被认真对待，但不必把每种设想都当成事实。', reversed:'把烦恼说出来、写下来，或寻求可信任的支持，能帮助你整理思绪。', glyph:'Ⅸ' },
  { roman:'X', name:'宝剑十', suit:'宝剑', keywords:'结束 · 重启', upright:'某个阶段可能已经走到尽头。先接受变化，再考虑如何重新安排。', reversed:'恢复需要时间。不要急着回到原来的节奏，先照顾眼前的小事。', glyph:'Ⅹ' },
  { roman:'P', name:'宝剑侍从', suit:'宝剑', keywords:'观察 · 提问', upright:'保持好奇，提出具体问题并核实信息，会比轻信传闻更可靠。', reversed:'表达前多检查一次语气和事实，避免误读或仓促传播。', glyph:'侍' },
  { roman:'N', name:'宝剑骑士', suit:'宝剑', keywords:'迅速 · 果断', upright:'目标清楚时可以迅速行动，同时为重要细节留出检查时间。', reversed:'想法跑得太快可能压过倾听。放慢一点，先确认彼此理解一致。', glyph:'骑' },
  { roman:'Q', name:'宝剑王后', suit:'宝剑', keywords:'独立 · 明辨', upright:'以清醒和诚实表达边界，既尊重事实，也尊重自己的判断。', reversed:'过于严厉的标准可能让沟通变得生硬。清晰不必等于冷漠。', glyph:'后' },
  { roman:'K', name:'宝剑国王', suit:'宝剑', keywords:'逻辑 · 公正', upright:'使用理性与完整信息处理问题，也给不同观点公平的表达空间。', reversed:'规则和逻辑不应成为忽略人感受的理由，记得检查判断是否偏颇。', glyph:'王' },

  { roman:'A', name:'星币王牌', suit:'星币', keywords:'基础 · 机会', upright:'一个务实的新起点值得认真对待。先建立可持续的小习惯。', reversed:'想法还缺少现实条件。先确认时间、资源与能力范围。', glyph:'◇' },
  { roman:'II', name:'星币二', suit:'星币', keywords:'协调 · 平衡', upright:'多件事情需要协调。重新排序，让安排更贴合实际精力。', reversed:'任务太多时容易顾此失彼。适当减少同时进行的事项。', glyph:'Ⅱ' },
  { roman:'III', name:'星币三', suit:'星币', keywords:'合作 · 技艺', upright:'认真打磨技能并与他人协作，会让成果更扎实。', reversed:'合作方式或分工需要说清楚，避免重复劳动和期待落差。', glyph:'Ⅲ' },
  { roman:'IV', name:'星币四', suit:'星币', keywords:'保存 · 边界', upright:'稳定和安全感很重要，同时也可以留出适度尝试的空间。', reversed:'过度紧抓旧安排可能限制成长。检查哪些地方可以更灵活。', glyph:'Ⅳ' },
  { roman:'V', name:'星币五', suit:'星币', keywords:'支持 · 现实', upright:'遇到实际困难时，不必独自承担。看看身边有哪些可用支持。', reversed:'留意正在出现的帮助与改善空间，先解决最紧迫的一件小事。', glyph:'Ⅴ' },
  { roman:'VI', name:'星币六', suit:'星币', keywords:'互助 · 公平', upright:'给予与接受都需要边界。让帮助建立在尊重与清楚沟通之上。', reversed:'付出不对等时，重新协商期待，不必勉强自己。', glyph:'Ⅵ' },
  { roman:'VII', name:'星币七', suit:'星币', keywords:'耐心 · 评估', upright:'阶段性回顾能帮助你判断方向。给长期目标足够时间成长。', reversed:'投入与收获不匹配时，可以调整方法，而不是只靠加倍努力。', glyph:'Ⅶ' },
  { roman:'VIII', name:'星币八', suit:'星币', keywords:'练习 · 专注', upright:'持续练习会慢慢积累能力。专注做好眼前这一部分。', reversed:'重复劳动可能失去重点，试着找到更有效的练习方式。', glyph:'Ⅷ' },
  { roman:'IX', name:'星币九', suit:'星币', keywords:'独立 · 品味', upright:'享受自己努力建立的稳定感，也给生活留一点美好细节。', reversed:'外在成果不必成为压力。按自己的节奏定义什么叫足够好。', glyph:'Ⅸ' },
  { roman:'X', name:'星币十', suit:'星币', keywords:'传承 · 长久', upright:'长期积累与互相支持值得珍惜，可以思考怎样让成果更可持续。', reversed:'家庭或团队对稳定的期待可能不同，先沟通各自看重的部分。', glyph:'Ⅹ' },
  { roman:'P', name:'星币侍从', suit:'星币', keywords:'学习 · 实践', upright:'适合从基础知识开始，制定一个具体、可完成的学习计划。', reversed:'想学的内容太多时，先选一项练熟，再逐步增加难度。', glyph:'侍' },
  { roman:'N', name:'星币骑士', suit:'星币', keywords:'稳定 · 负责', upright:'稳定推进、认真检查细节，会让日常计划更可靠。', reversed:'过于固守流程可能让进度停滞，尝试微调一个步骤。', glyph:'骑' },
  { roman:'Q', name:'星币王后', suit:'星币', keywords:'照料 · 实际', upright:'把关心落实到具体行动，也别忘了照料自己的日常需要。', reversed:'照顾别人时要留意精力边界，别把所有责任都揽在自己身上。', glyph:'后' },
  { roman:'K', name:'星币国王', suit:'星币', keywords:'稳健 · 建立', upright:'以长期视角处理实际事务，重视稳定、诚信与可持续安排。', reversed:'过度看重结果或控制感，会让合作失去弹性。重新检查优先级。', glyph:'王' }
];
var TAROT = TAROT_MAJOR.concat(TAROT_MINOR);
var DAILY = [
  { keyword: '慢一点，也很好', headline: '适合把节奏调匀的一天。', description: '先完成眼前的一件小事，不用急着把所有计划一次做完。', categories: [['灵感','慢慢来'],['沟通','真诚表达'],['休息','留一点空白']] },
  { keyword: '新的小发现', headline: '给好奇心留个位置。', description: '熟悉的路线也可能遇见新东西，今天可以试着换个小方法。', categories: [['灵感','值得尝试'],['沟通','多听一点'],['休息','轻松一点']] },
  { keyword: '把注意力还给自己', headline: '适合整理和收尾。', description: '清理一个待办，收好一个角落，让接下来的时间更清楚。', categories: [['灵感','先做一件'],['沟通','说清楚'],['休息','早点放松']] },
  { keyword: '一点点好心情', headline: '今天可以认真享受小事。', description: '一顿喜欢的饭、一段喜欢的音乐，都值得被好好对待。', categories: [['灵感','轻盈开放'],['沟通','分享心情'],['休息','补充能量']] },
  { keyword: '稳稳地向前', headline: '不必赶路，方向更重要。', description: '把注意力放在自己能掌握的部分，慢慢推进就很好。', categories: [['灵感','保持专注'],['沟通','耐心回应'],['休息','适度停顿']] }
];
var state = { pools: clone(DEFAULT_POOLS), wheels: clone(DEFAULT_WHEELS), history: [], lotDrawMode: 'user' };
var roles = [];
var selectedRole = null;
var activePool = 'meal';
var activeWheel = 'lunch';
var wheelRotation = 0;
var wheelBusy = false;
var tarotDraw = null;
var roleRequestToken = 0;
var roleStartToken = 0;
var toastTimer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function randomIndex(length) {
  if (!length) return -1;
  if (window.crypto && window.crypto.getRandomValues) {
    var n = new Uint32Array(1);
    var limit = Math.floor(0x100000000 / length) * length;
    do { window.crypto.getRandomValues(n); } while (n[0] >= limit);
    return n[0] % length;
  }
  return Math.floor(Math.random() * length);
}
function shuffle(list) {
  var copy = list.slice();
  for (var i = copy.length - 1; i > 0; i--) {
    var j = randomIndex(i + 1), temp = copy[i]; copy[i] = copy[j]; copy[j] = temp;
  }
  return copy;
}
function readJSON(key, fallback) {
  try { var value = JSON.parse(localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
  catch (error) { return fallback; }
}
function saveState() {
  try {
    var serialized = JSON.stringify(state);
    localStorage.setItem(DATA_KEY, serialized);
    return localStorage.getItem(DATA_KEY) === serialized;
  } catch (error) {
    showToast('保存失败：浏览器空间可能不足，原有内容没有被主动清除。');
    return false;
  }
}
function loadState() {
  var saved = readJSON(DATA_KEY, null);
  if (!saved || typeof saved !== 'object') return;
  if (Array.isArray(saved.pools)) state.pools = saved.pools.filter(validTemplate);
  if (Array.isArray(saved.wheels)) state.wheels = saved.wheels.filter(validTemplate);
  if (Array.isArray(saved.history)) state.history = saved.history.slice(-100);
  if (['user', 'role', 'alternate'].indexOf(saved.lotDrawMode) >= 0) state.lotDrawMode = saved.lotDrawMode;
  if (!state.pools.length) state.pools = clone(DEFAULT_POOLS);
  if (!state.wheels.length) state.wheels = clone(DEFAULT_WHEELS);
}
function validTemplate(item) {
  return !!(item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.items));
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ roleId: selectedRole ? String(selectedRole.id) : '' }));
    return true;
  } catch (error) { return false; }
}
function loadRoles() {
  try {
    if (window.PhoneStorage && typeof PhoneStorage.getCharacters === 'function') roles = PhoneStorage.getCharacters() || [];
  } catch (error) { roles = []; }
  if (!Array.isArray(roles) || !roles.length) roles = readJSON('ai_custom_characters', []);
  roles = (Array.isArray(roles) ? roles : []).filter(function (role) { return role && role.id != null; });
  var settings = readJSON(SETTINGS_KEY, {});
  var currentId = settings.roleId || (window.PhoneStorage && PhoneStorage.getCurrentContactId ? PhoneStorage.getCurrentContactId() : '');
  selectedRole = roles.find(function (role) { return String(role.id) === String(currentId); }) || null;
  renderRoleOptions();
}
function roleName(role) {
  return role ? String(role.name || role.nickname || role.charName || '聊天角色') : '独自体验';
}
function nextLotActorType() {
  if (!selectedRole || state.lotDrawMode === 'user') return 'user';
  if (state.lotDrawMode === 'role') return 'role';
  var count = state.history.filter(function (entry) {
    return String(entry.roleId || '') === currentRoleId() && entry.game === '抽签';
  }).length;
  return count % 2 === 0 ? 'user' : 'role';
}
function updateLotDrawModeUI() {
  var select = $('lotDrawMode');
  if (!select) return;
  var roleOption = select.querySelector('option[value="role"]');
  var alternateOption = select.querySelector('option[value="alternate"]');
  if (roleOption) roleOption.disabled = !selectedRole;
  if (alternateOption) alternateOption.disabled = !selectedRole;
  select.value = selectedRole ? state.lotDrawMode : 'user';
  var hint = $('lotDrawHint');
  if (!selectedRole) {
    hint.textContent = '独自体验中。选择角色后，可开启角色代抽或轮流抽取。';
  } else if (state.lotDrawMode === 'role') {
    hint.textContent = '这一轮由' + roleName(selectedRole) + '代抽，结果仍由本地随机产生。';
  } else if (state.lotDrawMode === 'alternate') {
    var nextName = nextLotActorType() === 'role' ? roleName(selectedRole) : '你';
    hint.textContent = '下一次由' + nextName + '抽取，之后自动轮换。';
  } else {
    hint.textContent = '这一轮由你亲自抽取。';
  }
}
function getLotActor() {
  var type = nextLotActorType();
  return {
    type: type,
    name: type === 'role' && selectedRole ? roleName(selectedRole) : '你',
    roleId: currentRoleId(),
    roleName: roleName(selectedRole)
  };
}
function renderRoleOptions() {
  var select = $('roleSelect');
  select.textContent = '';
  var solo = document.createElement('option');
  solo.value = ''; solo.textContent = '独自体验'; select.appendChild(solo);
  roles.forEach(function (role) {
    var option = document.createElement('option');
    option.value = String(role.id);
    option.textContent = roleName(role);
    select.appendChild(option);
  });
  select.value = selectedRole ? String(selectedRole.id) : '';
  $('roleStatus').textContent = selectedRole ? '已邀请 ' + roleName(selectedRole) + ' 一起参与。' : '可以自己玩，也可以叫一个角色来陪你。';
  updateLotDrawModeUI();
  var avatar = $('companionAvatar'), fallback = $('companionFallback');
  var source = selectedRole ? roleAvatar(selectedRole) : '';
  if (source) {
    avatar.src = source; avatar.hidden = false; fallback.hidden = true;
  } else {
    avatar.removeAttribute('src'); avatar.hidden = true; fallback.hidden = false;
  }
}
function roleAvatar(role) {
  if (!role) return '';
  var source = String(role.avatar || role.avatarUrl || role.avatarData || role.image || role.icon || '').trim();
  if (!source) return '';
  return /^(?:https?:\/\/|data:image\/|blob:|\/|\.\/|\.\.\/)/i.test(source) ? source : '';
}
function showToast(message) {
  var toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2300);
}
function currentRoleId() { return selectedRole ? String(selectedRole.id) : ''; }
function addHistory(game, result, detail, actor) {
  var recordedRoleId = actor && typeof actor.roleId === 'string' ? actor.roleId : currentRoleId();
  var recordedRoleName = actor && typeof actor.roleName === 'string' ? actor.roleName : roleName(selectedRole);
  state.history.push({
    id: 'luck_' + Date.now() + '_' + randomIndex(99999),
    game: game,
    roleId: recordedRoleId,
    roleName: recordedRoleName,
    result: String(result || ''),
    detail: String(detail || ''),
    actorName: actor ? String(actor.name || '') : '',
    createdAt: Date.now()
  });
  state.history = state.history.slice(-100);
  saveState();
  if (game === '抽签') updateLotDrawModeUI();
  renderHistory();
}
function roleFallback(game) {
  var lines = [
    '我觉得这个结果挺有意思的。先收下它，剩下的我们慢慢来。',
    '结果已经出来啦。今天就把它当作一个轻松的小提示吧。',
    '嗯，那就这样决定？至少不用再纠结半天了。'
  ];
  return selectedRole ? roleName(selectedRole) + '：' + lines[randomIndex(lines.length)] : '';
}
function roleContextFor(role) {
  try {
    if (window.PhoneContext && typeof PhoneContext.buildPhoneRoleContext === 'function') {
      return PhoneContext.buildPhoneRoleContext(role.id, 'luck-room');
    }
  } catch (error) {}
  return '';
}
function requestRoleStart(game, actorType) {
  var target = $('rolePrompt');
  if (!target) return;
  if (!selectedRole) { target.hidden = true; target.textContent = ''; return; }
  var role = selectedRole;
  var roleId = String(role.id);
  var token = ++roleStartToken;
  var roleDraw = actorType === 'role';
  var fallback = roleName(role) + (roleDraw ? '：这次我来抽。' : '：我准备好了。来看看这次会遇到什么。');
  target.hidden = false;
  target.textContent = fallback;
  if (!window.PhoneAPI || typeof PhoneAPI.complete !== 'function') return;
  var context = roleContextFor(role);
  var system = '你正在 MAOMAO 的轻量娱乐互动应用里与用户一起参与小游戏。严格保持所选角色的人设、语气、称呼和表达习惯。现在是揭晓前的准备阶段，还没有产生任何随机结果。不要替用户做选择、猜测结果、操纵概率或提前编造牌面。只用一句简短自然的话表示你正在参与、准备好了，或向用户问一句轻松的话。不要输出分析报告。' + (context ? '\n\n' + context : '');
  var actionLine = roleDraw ? '这一轮由你代替用户抽签，请自然表达“我来抽”或类似意思，但不要选择、猜测或编造签文。' : '现在还没有结果，请以角色身份自然地说一句揭晓前的参与话语。';
  PhoneAPI.complete({
    system: system,
    user: '玩法：' + game + '\n' + actionLine,
    temperature: 0.85,
    timeoutMs: 9000
  }).then(function (reply) {
    if (token !== roleStartToken || !selectedRole || String(selectedRole.id) !== roleId) return;
    target.textContent = String(reply || '').trim() || fallback;
  }).catch(function () {
    if (token === roleStartToken && selectedRole && String(selectedRole.id) === roleId) target.textContent = fallback;
  });
}
function askRole(game, detail, targetId, actorType) {
  var target = $(targetId);
  if (!target) return;
  if (!selectedRole) { target.textContent = ''; return; }
  var role = selectedRole;
  var roleId = String(role.id);
  var localLine = roleFallback(game);
  target.textContent = localLine;
  if (!window.PhoneAPI || typeof PhoneAPI.complete !== 'function') return;
  var token = ++roleRequestToken;
  target.textContent = roleName(role) + ' 正在想怎么回应……';
  var context = roleContextFor(role);
  var system = '你正在 MAOMAO 的轻量娱乐互动应用里与用户一起玩。请严格保持所选角色的人设、语气、称呼和表达习惯。你只是在独立随机机制已经确定结果后自然回应，不得改变、质疑、重抽或操纵结果。不要把塔罗、运势、抽签说成真实预言，不对健康、法律、财务或重大人生决定作判断或指令。回复简短自然，像真实聊天，不要输出分析报告。' + (context ? '\n\n' + context : '');
  PhoneAPI.complete({
    system: system,
    user: '玩法：' + game + '\n已经由独立随机机制确定的结果：' + detail + (actorType === 'role' ? '\n这一轮由你代替用户抽取。' : actorType === 'user' ? '\n这一轮由用户亲自抽取。' : '') + '\n请以角色身份自然接一句话。',
    temperature: 0.85,
    timeoutMs: 12000
  }).then(function (reply) {
    if (token !== roleRequestToken || !selectedRole || String(selectedRole.id) !== roleId) return;
    var clean = String(reply || '').trim();
    target.textContent = clean || localLine;
  }).catch(function () {
    if (token === roleRequestToken && selectedRole && String(selectedRole.id) === roleId) target.textContent = localLine;
  });
}
function setTab(name) {
  document.querySelectorAll('.play-tab').forEach(function (button) {
    var active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.play-panel').forEach(function (panel) {
    var active = panel.dataset.panel === name;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (name === 'wheel') drawWheel();
}
function activePoolData() {
  return state.pools.find(function (pool) { return pool.id === activePool; }) || state.pools[0];
}
function activeWheelData() {
  return state.wheels.find(function (wheel) { return wheel.id === activeWheel; }) || state.wheels[0];
}
function renderPoolSelect() {
  var select = $('lotPoolSelect');
  select.textContent = '';
  state.pools.forEach(function (pool) {
    var option = document.createElement('option'); option.value = pool.id; option.textContent = pool.name; select.appendChild(option);
  });
  if (!state.pools.some(function (pool) { return pool.id === activePool; })) activePool = state.pools[0].id;
  select.value = activePool;
  $('lotPoolTitleInput').value = activePoolData() ? activePoolData().name : '';
  $('deleteLotPoolBtn').disabled = state.pools.length <= 1;
}
function renderLotItems() {
  var list = $('lotItems'), pool = activePoolData();
  list.textContent = '';
  $('lotPoolTitleInput').value = pool ? pool.name : '';
  if (!pool) return;
  pool.items.forEach(function (item, index) {
    var row = document.createElement('div'); row.className = 'item-row';
    var number = document.createElement('span'); number.className = 'item-index'; number.textContent = String(index + 1).padStart(2, '0');
    var text = document.createElement('input'); text.className = 'item-edit-input'; text.type = 'text'; text.maxLength = 36; text.value = item; text.setAttribute('aria-label', '编辑签文');
    text.addEventListener('change', function () {
      var value = text.value.trim(); if (!value) { text.value = pool.items[index]; return; }
      pool.items[index] = value; saveState(); renderLotItems();
    });
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除签文');
    remove.addEventListener('click', function () {
      pool.items.splice(index, 1); saveState(); renderLotItems(); $('lotResult').hidden = true;
    });
    row.append(number, text, remove); list.appendChild(row);
  });
  if (!pool.items.length) {
    var empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = '这个签筒还是空的，添加几条内容再来抽签吧。'; list.appendChild(empty);
  }
}
function createId(prefix) { return prefix + '_' + Date.now() + '_' + randomIndex(99999); }
function renderWheelSelect() {
  var select = $('wheelTemplateSelect'); select.textContent = '';
  state.wheels.forEach(function (wheel) {
    var option = document.createElement('option'); option.value = wheel.id; option.textContent = wheel.name; select.appendChild(option);
  });
  if (!state.wheels.some(function (wheel) { return wheel.id === activeWheel; })) activeWheel = state.wheels[0].id;
  select.value = activeWheel;
  $('deleteWheelBtn').disabled = state.wheels.length <= 1;
  renderWheelEditor();
}
function renderWheelEditor() {
  var wheel = activeWheelData(); if (!wheel) return;
  $('wheelTitleInput').value = wheel.name;
  $('deleteWheelBtn').disabled = state.wheels.length <= 1;
  var list = $('wheelItems'); list.textContent = '';
  wheel.items.forEach(function (item, index) {
    var row = document.createElement('div'); row.className = 'item-row';
    var number = document.createElement('span'); number.className = 'item-index'; number.textContent = String(index + 1).padStart(2, '0');
    var text = document.createElement('input'); text.className = 'item-edit-input'; text.type = 'text'; text.maxLength = 24; text.value = item; text.setAttribute('aria-label', '编辑转盘选项');
    text.addEventListener('change', function () {
      var value = text.value.trim(); if (!value) { text.value = wheel.items[index]; return; }
      wheel.items[index] = value; saveState(); drawWheel();
    });
    var remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '删除转盘选项');
    remove.addEventListener('click', function () {
      wheel.items.splice(index, 1); saveState(); renderWheelEditor(); drawWheel(); $('wheelResult').hidden = true;
    });
    row.append(number, text, remove); list.appendChild(row);
  });
  drawWheel();
}
function drawWheel() {
  var wheel = activeWheelData(), canvas = $('wheelCanvas');
  if (!wheel || !canvas) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  var size = canvas.width, center = size / 2, radius = size / 2 - 5, count = Math.max(1, wheel.items.length);
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.translate(center, center);
  var shades = ['#f5f5f6', '#e6e6e9', '#d8d8dc', '#eeeeef', '#e0e0e3', '#fafafa'];
  for (var i = 0; i < count; i++) {
    var start = -Math.PI / 2 + i * Math.PI * 2 / count;
    var end = start + Math.PI * 2 / count;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, start, end); ctx.closePath();
    ctx.fillStyle = shades[i % shades.length]; ctx.fill();
    ctx.strokeStyle = '#a5a5aa'; ctx.lineWidth = 2; ctx.stroke();
    var mid = (start + end) / 2;
    ctx.save(); ctx.rotate(mid); ctx.translate(radius * .65, 0); ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#333'; ctx.font = (count > 8 ? '22px' : '26px') + ' sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var label = String(wheel.items[i] || '').slice(0, 8);
    ctx.fillText(label, 0, 0, radius * .46);
    ctx.restore();
  }
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.strokeStyle = '#777'; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();
  canvas.style.transform = 'rotate(' + wheelRotation + 'deg)';
}
function saveWheelRotation() {
  var canvas = $('wheelCanvas');
  canvas.style.transition = 'none';
  canvas.style.transform = 'rotate(' + wheelRotation + 'deg)';
  void canvas.offsetWidth;
  canvas.style.transition = '';
}
function renderHistory() {
  var records = state.history.filter(function (entry) { return String(entry.roleId || '') === currentRoleId(); }).slice().reverse();
  $('historyCount').textContent = String(records.length);
  var list = $('historyList'); list.textContent = '';
  if (!records.length) {
    var empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = '这里还没有记录。每一次小小的随机，都可以留在这里。'; list.appendChild(empty);
    return;
  }
  records.forEach(function (entry) {
    var row = document.createElement('article'); row.className = 'history-entry';
    var title = document.createElement('strong'); title.textContent = entry.game + ' · ' + entry.result;
    var meta = document.createElement('p');
    var date = new Date(entry.createdAt);
    meta.textContent = entry.roleName + ' · ' + date.toLocaleString();
    if (entry.detail) meta.textContent += ' · ' + entry.detail;
    if (entry.actorName) meta.textContent += ' · 由' + entry.actorName + '抽取';
    row.append(title, meta); list.appendChild(row);
  });
}
function drawLot() {
  var pool = activePoolData();
  if (!pool || !pool.items.length) { showToast('先往签筒里添加至少一条内容。'); return; }
  var button = $('drawLotBtn');
  if (button.disabled) return;
  var actor = getLotActor();
  requestRoleStart('抽签', actor.type);
  var result = pool.items[randomIndex(pool.items.length)];
  $('lotResult').hidden = true;
  $('lotResultText').textContent = '';
  $('lotRoleReaction').textContent = '';
  $('lotVessel').classList.remove('shaking'); void $('lotVessel').offsetWidth; $('lotVessel').classList.add('shaking');
  button.disabled = true;
  setTimeout(function () {
    $('lotVessel').classList.remove('shaking');
    $('lotResultText').textContent = result;
    $('lotResult').hidden = false;
    button.disabled = false;
    addHistory('抽签', result, pool.name, actor);
    if (currentRoleId() === actor.roleId) askRole('抽签', result, 'lotRoleReaction', actor.type);
  }, 1250);
}
function spinWheel() {
  var wheel = activeWheelData();
  if (!wheel || wheel.items.length < 2) { showToast('转盘至少需要两个选项。'); return; }
  if (wheelBusy) return;
  wheelBusy = true; $('spinWheelBtn').disabled = true; $('wheelResult').hidden = true;
  requestRoleStart('大转盘');
  var index = randomIndex(wheel.items.length), step = 360 / wheel.items.length;
  var center = (index + .5) * step;
  var delta = (360 - ((wheelRotation + center) % 360) + 360) % 360;
  var target = wheelRotation + 360 * 6 + delta;
  var canvas = $('wheelCanvas');
  canvas.style.transition = 'transform 4.7s cubic-bezier(.12,.72,.08,1)';
  void canvas.offsetWidth;
  canvas.style.transform = 'rotate(' + target + 'deg)';
  var result = wheel.items[index];
  var settled = false;
  function finish() {
    if (settled) return; settled = true;
    wheelRotation = target; saveWheelRotation();
    $('wheelResultText').textContent = result; $('wheelResult').hidden = false;
    $('spinWheelBtn').disabled = false; wheelBusy = false;
    addHistory('大转盘', result, wheel.name);
    askRole('大转盘', result, 'wheelRoleReaction');
  }
  canvas.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 5200);
}
function addCardSvg() {
  return '<svg viewBox="0 0 160 270" aria-hidden="true"><polygon points="80,7 137,30 137,210 80,260 23,210 23,30"/><polygon points="80,19 126,38 126,204 80,244 34,204 34,38"/><path d="M80 19V244M34 38l46 52 46-52M34 204l46-61 46 61M80 90v53"/><circle cx="80" cy="132" r="23"/><path d="M80 98l9 34-9 36-9-36z"/></svg>';
}
function tarotPosition(index, count) { return count === 1 ? '此刻' : ['过去','现在','未来'][index]; }
function drawTarot() {
  var button = $('drawTarotBtn');
  if (button.disabled) return;
  button.disabled = true;
  requestRoleStart('塔罗牌');
  $('tarotDeckScene').hidden = false;
  $('tarotDeckScene').classList.remove('shuffling');
  void $('tarotDeckScene').offsetWidth;
  $('tarotDeckScene').classList.add('shuffling');
  $('tarotHint').textContent = '正在洗牌……';
  setTimeout(function () {
    var count = Number($('tarotSpreadSelect').value) === 3 ? 3 : 1;
    var selected = shuffle(TAROT).slice(0, count).map(function (card) {
      return { roman:card.roman || card[0], name:card.name || card[1], suit:card.suit || '大阿卡纳', keywords:card.keywords || card[2], upright:card.upright || card[3], reversed:card.reversed || card[4], glyph:card.glyph || card[5], reversedDraw:randomIndex(100)<30, revealed:false };
    });
    tarotDraw = selected;
    $('tarotDeckCount').textContent = '本次抽取 ' + selected.length + ' 张 · 全牌组 78 张';
    $('tarotDeckScene').classList.remove('shuffling');
    $('tarotDeckScene').hidden = true;
    $('tarotSpread').hidden = false;
    $('tarotReadings').hidden = false;
    $('tarotRoleReaction').hidden = true;
    $('tarotDisclaimer').hidden = false;
    $('tarotHint').textContent = '点击每一枚水晶牌，翻开它。';
    button.textContent = '重新洗牌抽取';
    button.disabled = false;
    renderTarotSpread();
    addHistory('塔罗', selected.map(function (card) { return card.name + (card.reversedDraw ? '（逆位）' : '（正位）'); }).join('、'), count === 1 ? '单张牌' : '过去 / 现在 / 未来');
  }, 780);
}
function renderTarotSpread() {
  var spread = $('tarotSpread'); spread.textContent = ''; spread.dataset.count = String(tarotDraw.length);
  tarotDraw.forEach(function (card, index) {
    var slot = document.createElement('div'); slot.className = 'tarot-card-slot';
    var position = document.createElement('p'); position.className = 'tarot-card-position'; position.textContent = tarotPosition(index, tarotDraw.length);
    var button = document.createElement('button'); button.type = 'button'; button.className = 'tarot-crystal-card' + (card.revealed ? ' is-flipped' : '');
    button.setAttribute('aria-label', card.revealed ? card.name : '翻开' + tarotPosition(index, tarotDraw.length) + '位置的水晶牌');
    var inner = document.createElement('span'); inner.className = 'tarot-flip-inner';
    var back = document.createElement('span'); back.className = 'tarot-face tarot-back'; back.innerHTML = addCardSvg();
    var front = document.createElement('span'); front.className = 'tarot-face tarot-front';
    var roman = document.createElement('span'); roman.className = 'tarot-roman'; roman.textContent = card.roman;
    var glyph = document.createElement('span'); glyph.className = 'tarot-glyph'; glyph.textContent = card.glyph;
    var name = document.createElement('span'); name.className = 'tarot-card-name'; name.textContent = card.name;
    var suit = document.createElement('span'); suit.className = 'tarot-card-suit'; suit.textContent = card.suit;
    var orientation = document.createElement('span'); orientation.className = 'tarot-orientation'; orientation.textContent = card.reversedDraw ? '逆位' : '正位';
    front.append(roman, glyph, name, suit, orientation); inner.append(back, front); button.appendChild(inner);
    button.addEventListener('click', function () {
      if (card.revealed) return;
      card.revealed = true; renderTarotSpread(); renderTarotReadings();
      if (tarotDraw.every(function (item) { return item.revealed; })) {
        $('tarotHint').textContent = '牌面已经全部翻开。把它当作一个思考角度就好。';
        $('tarotRoleReaction').hidden = false;
        askRole('塔罗牌', tarotDraw.map(function (item, i) { return tarotPosition(i, tarotDraw.length) + '：' + item.name + (item.reversedDraw ? '逆位' : '正位'); }).join('；'), 'tarotRoleReaction');
      }
    });
    slot.append(position, button); spread.appendChild(slot);
  });
}
function renderTarotReadings() {
  var box = $('tarotReadings'); box.textContent = '';
  tarotDraw.forEach(function (card, index) {
    if (!card.revealed) return;
    var section = document.createElement('section'); section.className = 'tarot-reading';
    var kicker = document.createElement('small'); kicker.textContent = tarotPosition(index, tarotDraw.length) + ' · ' + (card.reversedDraw ? '逆位' : '正位');
    var title = document.createElement('h3'); title.textContent = card.name;
    var suit = document.createElement('p'); suit.className = 'tarot-reading-suit'; suit.textContent = card.suit;
    var keywords = document.createElement('p'); keywords.textContent = '关键词：' + card.keywords;
    var meaning = document.createElement('p'); meaning.textContent = card.reversedDraw ? card.reversed : card.upright;
    section.append(kicker, title, suit, keywords, meaning); box.appendChild(section);
  });
}
function drawDaily() {
  var button = $('dailyDrawBtn');
  if (button.disabled) return;
  requestRoleStart('今日运势');
  var item = DAILY[randomIndex(DAILY.length)];
  var score = 60 + randomIndex(41);
  $('dailyResult').hidden = true;
  $('dailyScore').textContent = '—';
  button.disabled = true;
  button.textContent = '正在整理……';
  setTimeout(function () {
    $('dailyScore').textContent = String(score);
    $('dailyKeyword').textContent = '“' + item.keyword + '”';
    $('dailyHeadline').textContent = item.headline;
    $('dailyDescription').textContent = item.description;
    var categories = $('dailyCategories'); categories.textContent = '';
    item.categories.forEach(function (entry) {
      var node = document.createElement('div'); node.className = 'daily-category';
      var label = document.createElement('span'); label.textContent = entry[0];
      var value = document.createElement('strong'); value.textContent = entry[1];
      node.append(label, value); categories.appendChild(node);
    });
    $('dailyResult').hidden = false;
    $('dailyRoleReaction').textContent = selectedRole ? roleFallback('今日运势') : '';
    var resultText = score + ' · ' + item.keyword;
    addHistory('今日运势', resultText, item.headline);
    button.disabled = false;
    button.textContent = '测测今天的运气';
    askRole('今日运势', resultText + '；趣味提示：' + item.description, 'dailyRoleReaction');
  }, 560);
}
function renderInitial() {
  renderPoolSelect(); renderLotItems(); renderWheelSelect(); drawWheel(); renderHistory();
}
function toggleHistory(show) {
  $('historyDrawer').hidden = !show;
  if (show) renderHistory();
}
document.querySelectorAll('.play-tab').forEach(function (button) {
  button.addEventListener('click', function () { setTab(button.dataset.tab); });
});
$('roleSelect').addEventListener('change', function () {
  roleRequestToken++;
  roleStartToken++;
  $('rolePrompt').hidden = true;
  $('rolePrompt').textContent = '';
  selectedRole = roles.find(function (role) { return String(role.id) === this.value; }, this) || null;
  saveSettings(); renderRoleOptions(); renderHistory();
});
$('lotDrawMode').addEventListener('change', function () {
  var value = this.value;
  if (['user', 'role', 'alternate'].indexOf(value) < 0 || (!selectedRole && value !== 'user')) return;
  state.lotDrawMode = value;
  saveState();
  updateLotDrawModeUI();
});
$('lotPoolSelect').addEventListener('change', function () {
  activePool = this.value; renderLotItems(); $('lotResult').hidden = true;
});
$('lotPoolTitleInput').addEventListener('change', function () {
  var pool = activePoolData(), value = this.value.trim();
  if (!pool || !value) { this.value = pool ? pool.name : ''; return; }
  pool.name = value; saveState(); renderPoolSelect();
});
$('deleteLotPoolBtn').addEventListener('click', function () {
  if (state.pools.length <= 1) return;
  state.pools = state.pools.filter(function (pool) { return pool.id !== activePool; });
  activePool = state.pools[0].id; saveState(); renderPoolSelect(); renderLotItems();
  $('lotResult').hidden = true; showToast('签筒已删除。');
});
$('wheelTemplateSelect').addEventListener('change', function () {
  activeWheel = this.value; renderWheelEditor(); $('wheelResult').hidden = true;
});
$('deleteWheelBtn').addEventListener('click', function () {
  if (state.wheels.length <= 1) return;
  state.wheels = state.wheels.filter(function (wheel) { return wheel.id !== activeWheel; });
  activeWheel = state.wheels[0].id; wheelRotation = 0; saveState(); renderWheelSelect();
  $('wheelResult').hidden = true; showToast('转盘模板已删除。');
});
$('addLotForm').addEventListener('submit', function (event) {
  event.preventDefault(); var value = $('newLotItem').value.trim(), pool = activePoolData();
  if (!value || !pool) return;
  pool.items.push(value); $('newLotItem').value = ''; saveState(); renderLotItems();
});
$('newLotPoolForm').addEventListener('submit', function (event) {
  event.preventDefault(); var name = $('newLotPoolName').value.trim();
  if (!name) return;
  var pool = { id:createId('pool'), name:name, items:[] };
  state.pools.push(pool); activePool = pool.id; $('newLotPoolName').value = '';
  saveState(); renderPoolSelect(); renderLotItems(); showToast('新签筒已创建。');
});
$('drawLotBtn').addEventListener('click', drawLot);
$('wheelTitleInput').addEventListener('change', function () {
  var wheel = activeWheelData(); if (!wheel) return;
  var value = this.value.trim(); if (value) wheel.name = value;
  saveState(); renderWheelSelect();
});
$('addWheelForm').addEventListener('submit', function (event) {
  event.preventDefault(); var value = $('newWheelItem').value.trim(), wheel = activeWheelData();
  if (!value || !wheel) return;
  if (wheel.items.length >= 12) { showToast('为了保证转盘标签清晰，最多添加 12 项。'); return; }
  wheel.items.push(value); $('newWheelItem').value = ''; saveState(); renderWheelEditor();
});
$('newWheelForm').addEventListener('submit', function (event) {
  event.preventDefault(); var name = $('newWheelName').value.trim();
  if (!name) return;
  var wheel = { id:createId('wheel'), name:name, items:['选项一','选项二','选项三','选项四'] };
  state.wheels.push(wheel); activeWheel = wheel.id; $('newWheelName').value = '';
  saveState(); renderWheelSelect(); showToast('新转盘模板已创建。');
});
$('spinWheelBtn').addEventListener('click', spinWheel);
$('drawTarotBtn').addEventListener('click', drawTarot);
$('dailyDrawBtn').addEventListener('click', drawDaily);
$('historyToggle').addEventListener('click', function () { toggleHistory(true); });
$('closeHistory').addEventListener('click', function () { toggleHistory(false); });
$('historyDrawer').addEventListener('click', function (event) {
  if (event.target === $('historyDrawer')) toggleHistory(false);
});
$('clearHistoryBtn').addEventListener('click', function () {
  var roleId = currentRoleId();
  state.history = state.history.filter(function (entry) { return String(entry.roleId || '') !== roleId; });
  saveState(); updateLotDrawModeUI(); renderHistory(); showToast('当前视图的记录已清除。');
});
loadState(); loadRoles(); renderInitial();
})();