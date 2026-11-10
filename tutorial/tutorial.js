/* MAOMAO interactive guide.
 * Keep GUIDE_UPDATES in sync with every merged feature release.
 * Only label a feature verified after real browser/device acceptance.
 */
(function () {
  'use strict';

  var GUIDE_VERSION = '2026.11.11 · v1';
  var STORAGE_KEY = 'maomao_tutorial_progress_v1';

  var GUIDE_UPDATES = [
    {
      date: '2026-11-11',
      title: '聊天多媒体功能更新',
      items: [
        'PR #241：多气泡回复、角色专属表情收藏与自动发送、角色头像收藏、配对头像和图片识别。',
        'PR #240：角色可以根据聊天语境，从自己的角色图片图库中自主挑图发送。',
        '对话设置的「单条 / 自动 / 连续多条」入口已写入教程；主动联系与真实后台推送仍分开验收。'
      ]
    }
  ];

  var GUIDES = [
    {
      id: 'desktop', category: '入门', title: '桌面、翻页与应用入口',
      summary: '先认识桌面图标、页面翻页和编辑模式。新应用会自动出现在桌面，不需要重新摆放旧图标。',
      location: '小手机首页桌面。每个图标都可以点击进入对应应用。',
      steps: [
        '点击桌面图标打开应用；左右滑动桌面可切换页面。',
        '长按桌面空白处或图标进入编辑状态，可以拖动应用、调整位置。',
        '完成后点击顶部「完成」退出编辑状态。不要误点图标上的移除标记。',
        '「教程」图标会固定加入桌面；旧的桌面排列会保留，新图标放到「设置」附近。'
      ],
      test: '打开两个不同桌面页面，再点开「教程」并返回桌面，确认原有图标和挂件位置没有被重置。',
      href: '../index.html', action: '返回桌面'
    },
    {
      id: 'chat-settings', category: '聊天', title: '打开单个角色的对话设置',
      summary: '聊天设置是按当前角色分别保存的，不是全局设置。右上角三个点进入当前会话的设置页。',
      location: '桌面 → 聊天 → 点开一个角色 → 聊天右上角「⋯」。',
      steps: [
        '先从桌面打开「聊天」，再点开一位角色的聊天详情。',
        '点聊天顶部右侧的三个点，页面应跳转到「对话设置」。',
        '设置页中可找到回复气泡模式、主动联系、自然追问、记忆条数、消息音效、表情包挂载等项目。',
        '注意：2026-11-11 已收到「三个点点了打不开对话设置」的手机反馈。此项当前标记为待修复，不要把打不开当成你的操作问题。'
      ],
      test: '连续打开两个不同角色的对话设置，确认页面能进入，且各角色设置不会串到另一个角色。',
      href: '../chat/chat/chat.html', action: '打开聊天', issue: true,
      defaultNote: '2026-11-11 用户反馈：聊天右上角三个点点不开对话设置，待修复并真机复测。'
    },
    {
      id: 'reply-bubbles', category: '聊天', title: '多气泡回复：单条 / 自动 / 连续多条',
      summary: '这项有明确设置入口，不是只能靠 AI 自己猜。每个角色可以单独选择回复形式。',
      location: '聊天 → 角色聊天详情 → 右上角「⋯」→ 对话设置 →「回复气泡模式」。',
      steps: [
        '「单条」：每轮回复合并为一条完整气泡。',
        '「自动」：由 AI 按语义和角色习惯自行决定 1–5 条。',
        '「连续多条」：AI 尽量拆成 2–5 条连续气泡。',
        '切换后返回该角色聊天，发一条包含多个自然信息点的消息观察效果。'
      ],
      test: '分别切换「单条」「自动」「连续多条」各测试一次，记录气泡数量和内容是否自然。',
      href: '../chat/chat/chat.html', action: '打开聊天'
    },
    {
      id: 'role-contact', category: '聊天', title: '角色主动联系与自然追问',
      summary: '两个开关用途不同：主动联系是角色在合适时机主动发消息；自然追问是在你暂未回复时续接话题。',
      location: '聊天 → 角色详情 →「⋯」→ 对话设置 → SOCIAL 区域。',
      steps: [
        '打开「主动联系」，可选最短联系间隔：24 / 48 / 72 小时。',
        '页面说明：主动联系只在 MAOMAO 前台打开时检查，需要 API；至少安静 8 小时，每天全局最多一次判断。',
        '「自然追问」是另一个独立开关，最多三次；你一回复就终止，默认关闭。',
        '这两个功能都不等于手机后台 Web Push。锁屏、关闭网页后的真实通知还需要单独完成推送链路和真机验收。'
      ],
      test: '先确认开关和间隔能保存；不要只凭页面显示「已开启」就认定后台主动消息或系统通知已通过。',
      href: '../chat/chat/chat.html', action: '打开聊天', issue: true
    },
    {
      id: 'stickers', category: '角色', title: '角色专属表情收藏与自动发送',
      summary: '表情先进入全局表情包库，再收藏给某个角色。每个角色只会使用自己的收藏。',
      location: '角色聊天详情 → 输入栏「＋」→「表情包」→「全部表情」→「收藏给 TA」。',
      steps: [
        '在聊天详情点输入栏旁边的「＋」，再选「表情包」。',
        '切换到「全部表情」，找到一张想让这个角色使用的表情。',
        '点图片下方「收藏给 TA」。收藏成功后按钮显示「已收藏」。',
        '切换上方的「角色表情」标签，可以查看该角色专属收藏。',
        '需要添加新表情时，点面板底部「管理 / 添加表情包」，进入表情包管理页。'
      ],
      test: '给角色 A 收藏一张表情，再打开角色 B 的聊天，确认 B 的「角色表情」里不会出现 A 的收藏。',
      href: '../chat/chat/chat.html', action: '打开聊天'
    },
    {
      id: 'avatars', category: '角色', title: '角色头像收藏与配对头像',
      summary: '头像收藏和聊天设置是两个独立入口；每个主角色的头像收藏分开保存。',
      location: '桌面 →「角色库」→ 点开一个角色 → 角色档案中的「头像收藏」和「配对头像」。',
      steps: [
        '从桌面打开单独的「角色库」应用，不是「世界书」。',
        '点进某个角色，进入这个角色自己的档案页。',
        '在「头像收藏」区域点「添加头像」，可以把图片加入该角色图库。',
        '在「配对头像」区域，按页面提示选择两张已有头像建立关联；也能调整配对名称或解除配对。',
        '头像切换和配对只作用于当前角色，不会把别的角色的图库合并进来。'
      ],
      test: '给两个角色分别添加头像，再检查两边的头像收藏；尝试建立一组配对，确认原图仍各自保留。',
      href: '../worldbook/characters/characters.html', action: '打开角色库'
    },
    {
      id: 'image-gallery', category: '图片', title: '角色生图与角色图片图库',
      summary: '这是角色的场景图片库，不是头像收藏。AI 自主挑图发送使用的是这里生成并保存的图片。',
      location: '桌面 →「设置」→「角色生图与图库」。',
      steps: [
        '打开「角色生图与图库」，先在「选择角色」里选中要编辑的角色。',
        '填写「固定外貌描述」和「画风关键词」，然后点「保存角色设定」。固定外貌只写稳定特征。',
        '在「生成一张图片」里填写场景补充，点「生成图片」。',
        '生成后到下方「角色图库」查看图片；可按全部、私密、公开筛选。默认会保存为私密图片。',
        '图片生成需要在「设置 → API 设置」配置可用的图片模型；图片模型与聊天模型分别配置，共用当前 API Key。'
      ],
      test: '选定一个角色生成一张图片，确认图库显示在该角色名下；切换到另一个角色，确认图库内容没有混在一起。',
      href: '../settings/image-generation.html', action: '打开角色生图'
    },
    {
      id: 'gallery-autosend', category: '图片', title: '角色从自己的图库自主挑图发送',
      summary: '有图库后，AI 可以在合适的聊天语境中挑选图片主动发送；不是每一轮都必须发图。',
      location: '先在「设置 → 角色生图与图库」生成图片，再回到该角色的线上单聊。',
      steps: [
        '先确认当前角色的「角色图库」里至少有一张已保存图片。',
        '打开这个角色的一对一线上聊天，正常聊与图片场景相关的话题。',
        '当语境适合时，角色可以从自己的图库中选择图片发送；最多两张。',
        '这是自主选择行为，不保证每一轮触发；群聊、旁白、静默回合和重生成不走这条自动发图路径。'
      ],
      test: '准备两张不同场景的角色图库图片，用自然的聊天语境测试是否能发送正确图片；记录是否选错角色或图片。',
      href: '../chat/chat/chat.html', action: '打开聊天'
    },
    {
      id: 'image-vision', category: '图片', title: '聊天图片识别',
      summary: '把图片作为聊天附件发送，并在同一条消息里说清楚希望角色看什么、回答什么。',
      location: '角色聊天详情 → 输入栏「＋」→「图片」，选择图片后发送。',
      steps: [
        '进入一对一角色聊天，点输入栏旁边的「＋」。',
        '选择「图片」，从相册选一张图片。',
        '在消息中补充清楚的问题，例如「帮我看看这张图里有什么」，再发送。',
        '能否识别取决于当前聊天 API / 模型是否支持图片输入；如果服务商不支持视觉输入，文字聊天仍可用，但识图不能算通过。'
      ],
      test: '发送一张内容明确的图片并提问，检查角色回答是否对应图片本身，而不是凭空猜测。',
      href: '../chat/chat/chat.html', action: '打开聊天'
    },
    {
      id: 'memory', category: '角色', title: '记忆与世界书',
      summary: '记忆用于保存角色关系和长期信息；世界书用于补充世界设定、背景资料和关键词条目。',
      location: '桌面 →「记忆」或「世界书」。',
      steps: [
        '点桌面「记忆」进入角色记忆页面，先确认当前选中的角色。',
        '点桌面「世界书」管理世界设定条目；按条目内容和触发词组织资料。',
        '聊天中的记忆条数另有角色级设置：聊天 →「⋯」→ 对话设置 → 记忆条数。',
        '不要把世界书条目、角色人设和聊天记录当成同一种数据；它们承担不同作用。'
      ],
      test: '分别打开记忆和世界书页面，确认可以看到角色对应的数据；换角色后确认内容隔离。',
      href: '../worldbook/worldbook/worldbook.html', action: '打开世界书'
    },
    {
      id: 'api-settings', category: '设置', title: 'API 设置与图片模型',
      summary: '聊天模型和图片模型需要分别配置。没有可用 API 配置时，相关 AI 功能不会正常执行。',
      location: '桌面 →「设置」→「API 设置」；图片生成入口在同页的「角色生图与图库」。',
      steps: [
        '打开桌面「设置」，进入「API 设置」。',
        '配置服务商、API Key 和聊天模型，并按页面提示测试连接。',
        '若要生成图片，还要配置图片模型名称；聊天模型与图片模型是两项配置。',
        'API Key 只保存在当前浏览器的本地配置中；不要把密钥写进测试备注或导出的反馈文件。'
      ],
      test: '确认聊天 API 测试连接结果；若没有配置图片模型，不要把图片生成失败误判为图库代码故障。',
      href: '../settings/settings.html', action: '打开设置'
    },
    {
      id: 'chat-style', category: '外观', title: '聊天美化与主题商城',
      summary: '聊天页面样式与主题方案在专门的美化入口管理，不和角色头像、图片图库混用。',
      location: '桌面 →「聊天美化」或「主题商城」。',
      steps: [
        '打开「聊天美化」，选择聊天列表或聊天详情相关的美化项目。',
        '调整后先预览，再保存；不同角色的聊天数据不应该因换主题而互相覆盖。',
        '打开「主题商城」可浏览并切换已有主题方案。',
        '聊天页面显示异常时，先记录具体页面、主题名称和操作步骤，再反馈问题。'
      ],
      test: '切换一套聊天主题，分别检查聊天列表与聊天详情；返回后确认主题选择仍然保留。',
      href: '../beauty/beauty.html', action: '打开聊天美化'
    },
    {
      id: 'forum-moments', category: '社交', title: '论坛与聊天时刻',
      summary: '论坛是独立社区应用；聊天相关动态和时刻从聊天设置中的工具入口进入。',
      location: '桌面 →「论坛」；聊天相关时刻可从聊天 →「⋯」→ 对话设置 → CHAT TOOLS 进入。',
      steps: [
        '点桌面「论坛」查看帖子、内容详情和个人相关页面。',
        '进入角色聊天的对话设置后，找到「时刻」等聊天工具入口。',
        '角色自动评论、自动互动等开关属于社交自动化，不等于角色在聊天窗口主动发消息。',
        '出现空白详情或内容不显示时，先记录帖子标题和页面入口。'
      ],
      test: '分别打开论坛列表和一条帖子详情，再从对话设置打开时刻工具，记录每个页面能否正常加载。',
      href: '../forum/forum.html', action: '打开论坛'
    },
    {
      id: 'other-apps', category: '应用', title: '其他桌面应用在哪里',
      summary: '生活、创作和工具类入口都在桌面应用图标中，不需要去对话设置里找。',
      location: '回到桌面，按应用名称打开：钱包、记账、外卖、情侣空间、共同成长、陪伴日历、游戏大厅、咖啡馆、直播间、视觉档案、阅读、信封、日记、小说工坊、触梦旅行、线下模式和店铺。',
      steps: [
        '返回桌面，左右滑动切换页面。',
        '找到对应应用名称并点击打开。',
        '如果桌面图标曾被手动移除，可进入桌面编辑模式检查应用仓库；不要为了找入口重置整个桌面布局。',
        '应用内如果有自己的返回按钮，优先用页面内返回，避免直接关闭整个小手机。'
      ],
      test: '任选两个不同页面的应用打开，再返回桌面，确认页面导航没有把你带到空白页。',
      href: '../index.html', action: '返回桌面'
    }
  ];

  var APPS = [
    ['查手机', 'inspect-phone/select.html', '查看和检查手机内容'],
    ['世界书', 'worldbook/worldbook/worldbook.html', '世界设定与条目'],
    ['记忆', 'worldbook/memory/memory.html', '角色长期记忆'],
    ['论坛', 'forum/forum.html', '社区帖子与互动'],
    ['钱包', 'wallet/wallet.html', '钱包与虚拟交易'],
    ['音乐', 'music/music.html', '音乐播放器'],
    ['聊天美化', 'beauty/beauty.html', '聊天界面美化'],
    ['主题商城', 'theme-store/theme-store.html', '主题方案'],
    ['角色库', 'worldbook/characters/characters.html', '角色资料、头像收藏与配对'],
    ['角色足迹', 'chat/footprint/footprint.html', '角色相关足迹'],
    ['设置', 'settings/settings.html', 'API 与应用设置'],
    ['记账', 'wallet/finance.html', '账目记录'],
    ['外卖', 'wallet/takeout.html', '外卖模拟应用'],
    ['情侣空间', 'couple/couple.html', '共同空间'],
    ['共同成长', 'growth/growth.html', '成长记录'],
    ['陪伴日历', 'companion/companion.html', '陪伴日历'],
    ['游戏大厅', 'games/games.html', '游戏入口'],
    ['咖啡馆', 'cafe/cafe.html', '咖啡馆'],
    ['直播间', 'companion/live.html', '直播间'],
    ['视觉档案', 'poster/poster.html', '视觉资料'],
    ['阅读', 'library/library.html', '阅读与书架'],
    ['信封', 'envelope/envelope.html', '私人信件'],
    ['日记', 'diary/diary.html', '日记记录'],
    ['小说工坊', 'novel/novel.html', '小说创作'],
    ['触梦旅行', 'travel/dream-travel.html', '旅行探索'],
    ['线下模式', 'chat/date/date.html', '线下剧情与赴约'],
    ['聊天', 'chat/chat/chat.html', '聊天列表与角色会话'],
    ['店铺', 'wallet/shop.html', '应用内商店']
  ];

  var categories = ['全部', '入门', '聊天', '角色', '图片', '设置', '外观', '社交', '应用'];
  var activeCategory = '全部';
  var progress = loadProgress();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char];
    });
  }
  function loadProgress() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) { return {}; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (error) {}
    refreshProgress();
  }
  function entryState(id) {
    if (!progress[id] || typeof progress[id] !== 'object') progress[id] = {};
    return progress[id];
  }
  function renderUpdates() {
    $('guideVersion').textContent = GUIDE_VERSION;
    $('footerVersion').textContent = GUIDE_VERSION;
    var latest = GUIDE_UPDATES[0];
    $('updatesDate').textContent = latest ? latest.date : '暂无记录';
    $('updateList').innerHTML = '';
    GUIDE_UPDATES.forEach(function (update) {
      update.items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'update-item';
        row.innerHTML = '<span class="update-dot"></span><span>' + escapeHtml(item) + '</span>';
        $('updateList').appendChild(row);
      });
    });
  }
  function renderFilters() {
    $('guideFilters').innerHTML = categories.map(function (name) {
      return '<button type="button" class="filter" data-category="' + escapeHtml(name) + '" aria-pressed="' +
        (name === activeCategory ? 'true' : 'false') + '">' + escapeHtml(name) + '</button>';
    }).join('');
  }
  function matchesGuide(guide, query) {
    if (activeCategory !== '全部' && guide.category !== activeCategory) return false;
    if (!query) return true;
    var haystack = [guide.title, guide.summary, guide.location, guide.test].concat(guide.steps || []).join(' ').toLowerCase();
    return haystack.indexOf(query) !== -1;
  }
  function guideCard(guide) {
    var state = entryState(guide.id);
    var checked = state.done === true;
    var note = state.note == null ? (guide.defaultNote || '') : String(state.note);
    var status = guide.issue ? '<span class="status issue">待修复 / 待验收</span>' : '<span class="status">操作指南</span>';
    var steps = (guide.steps || []).map(function (step) { return '<li>' + escapeHtml(step) + '</li>'; }).join('');
    var open = guide.href
      ? '<a class="open-link" href="' + escapeHtml(guide.href) + '">' + escapeHtml(guide.action || '打开功能') +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg></a>'
      : '';
    return '<article class="guide-card" data-guide-id="' + escapeHtml(guide.id) + '">' +
      '<div class="guide-top"><div class="guide-title-wrap"><div class="guide-category">' + escapeHtml(guide.category.toUpperCase()) +
      '</div><h3 class="guide-title">' + escapeHtml(guide.title) + '</h3><p class="guide-summary">' + escapeHtml(guide.summary) +
      '</p></div>' + status + '</div>' +
      '<div class="guide-location"><b>入口：</b>' + escapeHtml(guide.location) + '</div>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<div class="test-box"><div class="test-title">本项怎么测</div><p class="test-description">' + escapeHtml(guide.test) + '</p>' +
      '<label class="test-mark"><input type="checkbox" data-done="' + escapeHtml(guide.id) + '"' + (checked ? ' checked' : '') +
      '> 我已经在手机上试过这一项</label>' +
      '<textarea class="note" data-note="' + escapeHtml(guide.id) + '" rows="2" placeholder="测试备注 / 遇到的问题">' + escapeHtml(note) + '</textarea></div>' +
      '<div class="guide-actions">' + open + '<span class="guide-hint">' + (guide.issue ? '当前有待处理反馈，测试后请写下具体现象。' : '勾选状态和备注只保存在本浏览器。') + '</span></div>' +
      '</article>';
  }
  function renderGuides() {
    var query = String($('guideSearch').value || '').trim().toLowerCase();
    var found = GUIDES.filter(function (guide) { return matchesGuide(guide, query); });
    $('visibleCount').textContent = found.length + ' 项';
    $('guideGrid').innerHTML = found.length
      ? found.map(guideCard).join('')
      : '<div class="empty">没有找到匹配的教程。试试功能名称或入口关键词。</div>';
    refreshProgress();
  }
  function renderApps() {
    $('appDirectory').innerHTML = APPS.map(function (app) {
      return '<a class="app-link" href="../' + escapeHtml(app[1]) + '"><strong>' + escapeHtml(app[0]) +
        '</strong><span>' + escapeHtml(app[2]) + '</span></a>';
    }).join('');
  }
  function refreshProgress() {
    var done = GUIDES.filter(function (guide) { return progress[guide.id] && progress[guide.id].done === true; }).length;
    var total = GUIDES.length;
    $('testCount').textContent = done + ' / ' + total + ' 已测试';
    $('progressFill').style.width = (total ? (done / total * 100) : 0) + '%';
  }
  function exportProgress() {
    var lines = ['MAOMAO 手机测试记录', '指南版本：' + GUIDE_VERSION, '导出时间：' + new Date().toLocaleString(), ''];
    GUIDES.forEach(function (guide) {
      var state = progress[guide.id] || {};
      lines.push((state.done ? '[已测试] ' : '[待测试] ') + guide.title);
      lines.push('入口：' + guide.location);
      if (state.note) lines.push('备注：' + state.note);
      if (guide.issue) lines.push('状态：待修复 / 待验收');
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'MAOMAO-手机测试记录-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  $('guideFilters').addEventListener('click', function (event) {
    var button = event.target.closest('[data-category]');
    if (!button) return;
    activeCategory = button.getAttribute('data-category');
    renderFilters();
    renderGuides();
  });
  $('guideSearch').addEventListener('input', renderGuides);
  $('guideGrid').addEventListener('change', function (event) {
    var checkbox = event.target.closest('[data-done]');
    if (checkbox) {
      entryState(checkbox.getAttribute('data-done')).done = checkbox.checked;
      saveProgress();
      return;
    }
    var note = event.target.closest('[data-note]');
    if (note) {
      entryState(note.getAttribute('data-note')).note = note.value;
      saveProgress();
    }
  });
  $('guideGrid').addEventListener('input', function (event) {
    var note = event.target.closest('[data-note]');
    if (!note) return;
    entryState(note.getAttribute('data-note')).note = note.value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (error) {}
  });
  $('exportTests').addEventListener('click', exportProgress);
  $('resetTests').addEventListener('click', function () { $('resetModal').hidden = false; });
  $('cancelReset').addEventListener('click', function () { $('resetModal').hidden = true; });
  $('confirmReset').addEventListener('click', function () {
    progress = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) {}
    $('resetModal').hidden = true;
    renderGuides();
    refreshProgress();
  });
  $('resetModal').addEventListener('click', function (event) {
    if (event.target === $('resetModal')) $('resetModal').hidden = true;
  });

  renderUpdates();
  renderFilters();
  renderGuides();
  renderApps();
})();