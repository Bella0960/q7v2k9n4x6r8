/* MAOMAO interactive guide.
 * Keep GUIDE_UPDATES in sync with every merged feature release.
 * Only label a feature verified after real browser/device acceptance.
 */
(function () {
  'use strict';

  var GUIDE_VERSION = '2026.11.11 · v3';
  var STORAGE_KEY = 'maomao_tutorial_progress_v1';

  var GUIDE_UPDATES = [
    {
      date: '2026-11-11',
      title: '教程全面补全',
      items: [
        '教程改为 API 入门优先：从 API Key、Base URL 和 /v1，到 HTTP 错误、温度、图片模型与 MiniMax 语音，按真实设置入口讲解。',
        '教程扩展到 50 项，覆盖全部 29 个桌面应用；聊天底部「＋」菜单 19 个入口单独说明，并增加常见问题。',
        '补正头像配对和表情收藏操作名称；角色自主挑图只使用标记为「公开」的图片，并补上对话设置直达兜底。'
      ]
    },
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
      "id": "api-first",
      "category": "设置",
      "title": "API 到底是什么？从哪里获取",
      "summary": "先弄懂模型服务、API Key、模型名称的区别，再去申请自己的访问凭证。",
      "location": "桌面 → 设置 → API 设置；API Key 需要到所选模型服务商的官方开发者平台获取。",
      "steps": [
        "API 可以理解为应用与 AI 服务通信的接口。MAOMAO 负责聊天界面和角色设定；实际生成文字或图片的是你选择的模型服务商。",
        "API Key 是访问凭证，作用类似只给程序使用的钥匙；它不是聊天账号密码，也不是模型名字。Base URL 是接口地址，模型名称决定调用哪一种 AI。",
        "先选支持所需功能的服务商，前往它的官方开发者控制台，按平台要求创建账号并开通 API 服务。部分服务需要验证、配额或计费，网页聊天订阅不一定包含 API 额度。",
        "在服务商控制台的 API Keys 或密钥管理中创建新密钥。通常只显示一次；复制后在 MAOMAO「设置 → API 设置」的 API Key 栏粘贴，不要公开分享。",
        "查服务商文档确认 Base URL、聊天模型 ID，以及该模型是否支持文字、识图和图片生成。每一种能力都需单独确认，不能看到同一品牌就默认全能。",
        "不需要把密钥发给任何人做排障。若怀疑泄露，立即到服务商控制台撤销旧密钥并创建新密钥。"
      ],
      "test": "不用填任何真实密钥，先指出三个概念：Key 是凭证、Base URL 是地址、模型 ID 是型号；正式填好后再去测试连接。",
      "href": "../settings/settings.html#api",
      "action": "打开 API 设置"
    },
    {
      "id": "api-url-v1",
      "category": "设置",
      "title": "Base URL、/v1、模型名怎么填",
      "summary": "按服务商文档核对地址；/v1 不是人人都要手动补，也不能把完整请求地址当作 Base URL。",
      "location": "桌面 → 设置 → API 设置 → 服务商 / Base URL / API Key / 默认模型。",
      "steps": [
        "服务商下拉框会为部分平台自动填入地址与默认模型，但仍要对照你所用服务商的最新开发者文档核实。",
        "Base URL 是接口前缀。例如部分 OpenAI 兼容服务用 https://服务商域名/v1；MAOMAO 会在它后面追加 chat/completions 进行聊天测试。",
        "不要把 /chat/completions 也填进 Base URL，否则可能重复拼接。不要盲目添加 /v1：不同服务商也可能使用 /api/paas/v4 等前缀，需以它自己的文档为准。",
        "API Key 粘贴来自所选服务商的真实有效密钥。不要在教程备注或问题截图里暴露它。",
        "默认模型填写服务商提供的准确聊天模型 ID，不是你给角色起的名字。可以点「拉取模型」尝试获取列表；列表失败不代表所有聊天接口都不能用。",
        "先保存配置，再点「测试连接」。当前实现会向 Base URL + /chat/completions 发送一条极短的聊天请求，成功只说明当前聊天接口响应，不代表图片或语音服务也成功。",
        "如果测试失败，展开下方故障排查，根据实际提示先查凭证、地址、模型、额度或跨域，不要一直反复点击。"
      ],
      "test": "不公开 Key 的前提下，核对 Base URL 只到接口前缀、模型名为真实 ID，并记录「测试连接」显示的状态文字。",
      "href": "../settings/settings.html#api",
      "action": "前往连接配置"
    },
    {
      "id": "api-errors",
      "category": "设置",
      "title": "连接测试失败：按报错解决",
      "summary": "从 HTTP 401 / 403 / 404 / 429、超时和跨域逐项排查，避免无方向反复重试。",
      "location": "桌面 → 设置 → API 设置 → 测试连接 → 查看状态提示。",
      "steps": [
        "先确认三项都已填写：API Key、Base URL、默认聊天模型。空字段会在发请求前直接提示；请先补齐。",
        "401 一般是 Key 无效、复制错误或已撤销；到相同服务商控制台核对，必要时创建新 Key。403 往往是账号、项目、地区或模型访问权限不满足。",
        "404 通常是接口地址拼错，或当前提供方不支持所填模型。检查 Base URL 是否已包含末尾路径，以及服务商是否提供 OpenAI 兼容的 /chat/completions。",
        "429 表示请求过于频繁或可用额度不足。先在服务商后台查看配额、账单或使用限制；不要靠不停重试解决。",
        "500 / 502 / 503 / 504 通常与服务端或网关故障有关，可以稍后重试并查看服务商状态。超时则检查网络、接口延迟及地址。",
        "浏览器提示 Failed to fetch、CORS 或网络错误时，可能是跨域限制、HTTPS/证书、拦截或网络问题。网页前端不能绕过服务商的跨域限制；选择支持浏览器调用的接口，或由可信后端代发。",
        "显示连接成功仍需要单独验证：发送一条真实聊天消息、生成一张测试图、再按 MiniMax 配置测试语音。不要把一个成功提示当成所有功能通过。"
      ],
      "test": "把实际提示与对应原因匹配；只记录状态码、服务商和现象，不上传 API Key 或包含个人数据的完整请求。",
      "href": "../settings/settings.html#api",
      "action": "检查报错"
    },
    {
      "id": "api-params",
      "category": "设置",
      "title": "温度、Top P、Tokens 到底调什么",
      "summary": "了解随机性、回复长度与概率采样；不必为了更会聊天把所有数值调到最大。",
      "location": "桌面 → 设置 → API 设置 → 高级参数。",
      "steps": [
        "温度 Temperature 控制生成时的随机性，数值低通常更稳定一致，数值高通常更灵活多变，但也可能更跑题；不是智商、情绪值或回复速度。",
        "MAOMAO 当前滑块显示 0～2，常见起点是 0.7。部分模型仅允许特定范围或不支持自行设置温度；若报参数错误，以服务商文档为准。",
        "Top P 是另一种控制候选词范围的采样参数。通常建议优先只调温度或 Top P 其中之一，先观察效果。",
        "最大回复 Tokens 控制可生成内容的长度上限，Token 不是汉字数量；上限太低可能让输出截断，过高也不保证模型一定说那么多。",
        "记忆条数决定 MAOMAO 传入多少近期对话，不等于模型永远记住所有内容；上下文长度和实际费用由服务商和模型决定。",
        "建议先用默认值完成文字聊天，再小幅改一个参数，并在同一角色、同类话题上比较。出现不支持的参数报错，先恢复默认。"
      ],
      "test": "保持其他参数不变，只小幅改变温度后测试；不必追求固定气泡数或一次输出非常长的答案。",
      "href": "../settings/settings.html#api",
      "action": "查看高级参数"
    },
    {
      "id": "api-images",
      "category": "图片",
      "title": "AI 生图：为什么聊天能用却画不出图",
      "summary": "图片生成模型、图片接口和文本聊天模型是分开的；先核对服务商是否支持。",
      "location": "桌面 → 设置 → API 设置 → 图片生成；再到「角色生图与图库」。",
      "steps": [
        "先在 API 设置中确保基础服务商与 API Key 有效；聊天连接成功只验证文字聊天，不验证图片生成功能。",
        "在「图片生成模型」填写服务商支持的准确生图模型 ID。聊天模型 ID 不能直接当作生图模型使用。",
        "图片接口 URL 可留空，让 MAOMAO 使用 Base URL + /images/generations；若服务商的图片端点不同，就必须按它的文档提供完整、正确的图片生成接口 URL。",
        "当前实现要求服务商提供兼容的图片生成接口，并能返回 Base64 图片或者可下载的图片 URL；不是所有模型或平台都满足。",
        "到「角色生图与图库」选定角色、填写所需角色外貌和场景后再点生成。生成记录应保存在当前角色名下；新图默认私密。",
        "若聊天成功而生图失败，先检查图片模型权限、配额、接口地址以及该模型返回格式。不要直接判定是角色图库坏了；还要确认当前角色是否已选中。",
        "需要角色自主发图时，先检查图库里是否有愿意公开的图片；私密图片不会被自主选取，也不保证每一轮聊天都发图。"
      ],
      "test": "用不涉及隐私的简单场景生成一张测试图，查看是否保存到正确角色，且默认私密；失败时记下提示文字。",
      "href": "../settings/image-generation.html",
      "action": "打开角色生图"
    },
    {
      "id": "minimax-voice-guide",
      "category": "设置",
      "title": "MiniMax 语音：API、Group ID 与 Voice ID",
      "summary": "这是独立的语音合成服务，和文字聊天 API 不是一回事；保存设置也不等于已能发声。",
      "location": "桌面 → 设置 → MiniMax 语音合成。",
      "steps": [
        "先区分三样东西：MiniMax API Key 用来授权语音请求；Group ID 是对应平台账户/项目标识；Voice ID 是具体要使用的声音标识。它们不能互相代替。",
        "打开「设置 → MiniMax 语音合成」，根据所注册的服务地区选择国际版或大陆版；在相应官方平台申请该地区的语音 API 凭证，并核实账户权限和额度。",
        "把 MiniMax 的 API Key 粘贴到语音页面，把控制台提供的 Group ID 填入 Group ID；这通常不是聊天模型的 API Key。",
        "选择当前页面提供的 speech-01 或 speech-02 模型，并开启页面顶部的「启用 MiniMax 语音合成」，点击「保存 TTS 设置」。具体模型可用性以服务商实际账户为准。",
        "当前这个设置页有「保存 TTS 设置」，但没有独立的「测试语音连接」按钮；保存只表示配置写到浏览器，不代表服务端认证、音色或音频播放成功。",
        "页面还要求为角色设置 Voice ID，并在该角色的对话设置中启用语音开关。如果手机里没找到 Voice ID 的真实编辑入口，应该记录为待核实，不要随意拿其他字段替代。",
        "要验收语音，需在角色聊天中真正触发一次语音输出，确认音色、播放和具体报错；文字聊天成功或 TTS 保存提示都不能代替这个测试。"
      ],
      "test": "核对地区版本、语音 Key、Group ID、模型、启用状态；不要在测试记录写 Key。真正发声需单独实机测试。",
      "href": "../settings/minimax-tts.html",
      "action": "打开语音设置"
    },

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
        '注意：已增加直接跳转兜底，并把对话设置页加入 PWA 缓存；此前的手机打不开反馈仍需在安装版和普通浏览器分别实测，暂不宣称已修复。'
      ],
      test: '连续打开两个不同角色的对话设置，确认页面能进入，且各角色设置不会串到另一个角色。',
      href: '../chat/chat/chat.html', action: '打开聊天', issue: true,
      defaultNote: '已增加直达跳转和 PWA 缓存；此前手机反馈尚未完成真机复测，请记录浏览器类型、是否安装 PWA、点击后地址栏变化和页面表现。'
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
        '切换上方的「角色表情」标签，可以查看该角色专属收藏；「全部表情」只用于浏览全部可用表情。',
        'AI 自主发送仅针对线上一对一的正常可见回复；每轮最多一张，也可能判断这轮不需要表情。',
        '需要添加新表情时，点面板底部「管理 / 添加表情包」，进入表情包管理页。'
      ],
      test: '给角色 A 收藏一张表情，再打开角色 B 的聊天，确认 B 的「角色表情」里不会出现 A 的收藏。注意点「收藏给TA」，不要点表情图片本身；点图片会直接把表情发送到聊天。',
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
        '在「配对头像」区域，点头像卡片上的「选择配对」，选满两张后点「建立配对」。已配对的卡片还可「保存名称」「交换 A/B」或「解除配对」。',
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
        '生成后到下方「角色图库」查看图片；可按「全部 / 私密 / 公开」筛选。每张图片还可设为私密或公开，也可删除；默认是私密图片。',
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
        '这是自主选择行为，不保证每一轮触发；群聊、旁白、静默回合和重生成不走这条自动发图路径。',
        '自主挑图只使用标记为「公开」的图片。新图默认私密。发图前会再次检查这张图的状态。',
      ],
      test: '先只放入可公开分享的测试图片，再用自然聊天语境检查是否能选对；不要把私人照片用于自动发图测试。',
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


  GUIDES = GUIDES.concat([
    {
      id:'composer-menu', category:'聊天', title:'聊天输入栏「＋」菜单：每个工具在哪',
      summary:'这是聊天输入栏旁边的功能菜单，不是右上角「对话设置」。把消息、媒体、互动和群聊工具分开说明。',
      location:'桌面 → 聊天 → 打开某个会话 → 底部输入栏左侧「＋」。',
      steps:[
        '打开一个聊天会话，找到屏幕底部输入栏左侧的「＋」，点一下展开功能面板。',
        '面板当前包含：表情包、奔赴、重玩、位置、纪念日、旁白动作、直播间、音乐、语音通话、视频通话、发红包、转账、图片、语音、名片、送礼物。',
        '群聊中还会出现群投票、群接龙、群通话等群聊专用入口；单聊里不会显示群聊专用工具。',
        '选中某个入口后按弹层提示完成操作；不确定某个入口用途时，先退出面板，不要用清空记录等设置项代替。'
      ],
      test:'依次打开「＋」面板，确认单聊和群聊可见项目不同；不发送任何消息也能正常关闭面板。',
      href:'../chat/chat/chat.html', action:'打开聊天'
    },
    {
      id:'stickers-manage', category:'角色', title:'表情包库：创建、导入和管理',
      summary:'表情包管理页维护可供聊天使用的表情库；角色专属收藏是在聊天表情库里另外完成的。',
      location:'聊天详情 → 底部「＋」→「表情包」→「管理 / 添加表情包」。',
      steps:[
        '在表情库面板底部点击「管理 / 添加表情包」，进入表情包库管理页。',
        '在管理页可创建新的表情包库；填写库名称后点「创建」。',
        '进入一个库，点添加表情；可从相册多选图片，也可粘贴图片 URL 导入。',
        '批量导入时，按页面要求为每张图片填写描述词；描述应说明表情含义，方便 AI 判断何时使用。',
        '返回聊天表情库，在「全部表情」中找到刚导入的图片，点「收藏给TA」才会放进当前角色的专属表情库。'
      ],
      test:'创建一个临时表情库，导入一张图片并填写描述；回到角色聊天收藏给角色 A，再确认角色 B 看不到 A 的收藏。',
      href:'../chat/sticker/sticker-manager.html', action:'打开表情包管理'
    },
    {
      id:'role-profile', category:'角色', title:'角色库：创建角色和进入角色档案',
      summary:'「角色库」是独立桌面应用；「世界书」不是角色库。角色档案里可以管理头像、说话习惯、基本资料和人物关系。',
      location:'桌面 →「角色库」。',
      steps:[
        '打开桌面上的「角色库」图标，先查看角色列表。',
        '点某个角色卡片进入「Character」档案页；顶部显示当前角色名称。',
        '在档案中可以查看「头像收藏」和「配对头像」，继续向下可进入「基本资料与人设」「说话与行为习惯」「人物关系网络」「个人生活线」。',
        '创建新主角色时，从角色列表页使用页面右上角的添加入口；完成资料后保存，再回到列表确认角色出现。',
        '多个主角色的档案和头像库必须分开测试，不要把不同角色的头像或人物关系混在一起。'
      ],
      test:'创建或选择两个角色，分别打开档案并确认标题、头像收藏和人物关系都对应当前角色。',
      href:'../worldbook/characters/characters.html', action:'打开角色库'
    },
    {
      id:'avatar-library-detail', category:'角色', title:'头像收藏：切换当前头像与移除旧头像',
      summary:'头像原图按角色独立存储。当前正在使用的头像不能直接移除，已配对头像也需要先解除配对。',
      location:'桌面 →「角色库」→ 角色档案 →「头像收藏」。',
      steps:[
        '在头像收藏标题旁点「添加头像」，从相册选择一张图片。',
        '等待图片加入当前角色的头像收藏；页面会显示已保存数量和当前头像状态。',
        '想更换头像时，在另一张头像卡片上选择设为当前头像。',
        '想移除头像时，先确认它不是当前头像，也不属于尚未解除的配对，然后再点「移除」。',
        '移除头像收藏不会删除已经发送到聊天里的图片消息。'
      ],
      test:'给角色添加第二张头像并切换当前头像，再检查旧头像是否仍留在收藏中；不要删除唯一头像。',
      href:'../worldbook/characters/characters.html', action:'打开角色档案'
    },
    {
      id:'image-privacy', category:'图片', title:'角色图库的私密、公开和删除',
      summary:'角色图库里的每张图片可单独设置可见状态；删除图库图片不会抹掉已发送到聊天里的消息图片。',
      location:'桌面 → 设置 →「角色生图与图库」→ 选择角色 →「角色图库」。',
      steps:[
        '先在顶部「选择角色」选中要管理的角色。',
        '使用「全部 / 私密 / 公开」筛选查看图片。',
        '每张图片旁边的隐私按钮会按当前状态显示「设为私密」或「设为公开」。',
        '删除图片前先确认选中的是正确角色和正确图片；页面会再次要求确认。',
        '生成图片时，场景补充会和最近 14 条文字聊天上下文一起发送给当前聊天 API 服务商，以组织画面。',
        '设为「私密」后，图片保留在图库里，角色不会自动选它发到聊天中。聊天里已经发出的图片可以在原会话中管理。',
      ],
      test:'使用测试图片核对公开与私密筛选。将测试图设为私密后，确认角色不会再自动发送这张图。',
      href:'../settings/image-generation.html', action:'打开角色图库'
    },
    {
      id:'chat-memory-limit', category:'聊天', title:'对话设置：记忆条数与时间感知',
      summary:'记忆条数和时间感知都是当前角色的对话级设置，不会替你编辑角色长期记忆。',
      location:'聊天 → 角色详情 → 右上角「⋯」→ 对话设置。',
      steps:[
        '进入「记忆条数」设置卡，点击展开选项。',
        '当前可选 10、20、30、50 条；点选后即保存，无需再找保存按钮。',
        '找到「时间感知」，可以选择关闭、真实时间或虚拟时间；虚拟时间需要按页面要求填写。',
        '改完设置返回当前角色聊天，观察新回复是否按选项使用上下文和时间。',
        '本项只改变新一轮聊天上下文与时间提示，不会自动删除历史聊天消息。'
      ],
      test:'把记忆条数切换到 10，再切换到 20，重新进入设置页确认选择已保存。',
      href:'../chat/chat/chat.html', action:'打开聊天'
    },
    {
      id:'chat-tools-settings', category:'聊天', title:'对话设置里的社交自动化与聊天工具',
      summary:'这里的「主动联系」「自然追问」「自动发动态」是不同功能；「足迹」「面具」「时刻」是跳转工具入口。',
      location:'聊天 → 角色详情 → 右上角「⋯」→ SOCIAL、CHAT TOOLS 分组。',
      steps:[
        '在 SOCIAL 分组查看「自动发动态」「主动联系」「自然追问」「自动评论我的动态」「自动互动」等选项。',
        '主动联系只在 MAOMAO 前台打开时检查，需要 API 额度；它不是锁屏后的系统推送。',
        '自然追问与主动联系独立：它是在你暂未回复时接续话题，你一回复便终止。',
        '在 CHAT TOOLS 分组可以打开「足迹」「面具」「时刻」等关联页面。',
        '设置保存不等于后台推送验收；关闭网页或锁屏后是否收到通知，需要单独做真实设备测试。'
      ],
      test:'只检查开关和间隔能否保存；不要为测试而开启不想使用的自动化功能，也不要把前台运行当作后台推送通过。',
      href:'../chat/chat/chat.html', action:'打开聊天'
    },

    // 桌面 29 个应用逐项说明：以每个应用当前真实页面结构为准。
    {id:'app-tutorial',category:'入门',title:'教程',summary:'从这里查功能入口、一步一步跟着真实页面操作，并保存测试记录。',location:'桌面 → 教程。',steps:['打开教程，先看「最近更新」了解当前版本增加了什么。','通过分类或搜索找到功能，点「一步一步跟着做」进入单步引导。','每一步可以打开真实页面，在新标签页完成操作后切回教程继续。','测试后勾选「我已经在手机上实际测试过这一项」，遇到问题写备注并导出测试记录。'],test:'启动任意一项分步教程，前进和后退，再勾选一条测试状态，刷新页面确认进度保留。',href:'../tutorial/tutorial.html',action:'打开教程'},
    {id:'app-inspect',category:'应用',title:'查手机',summary:'按角色查看其手机内容；先选角色，再查看该角色当前可访问的内容。',location:'桌面 → 查手机。',steps:['打开「查手机」，页面标题为「选择查看的角色」。','选择要查看的角色，再按页面显示的类别或记录查看信息。','退出后切换另一个角色，确认查看对象随选择改变。'],test:'切换两个角色分别打开，确认页面没有把角色 A 的内容误显示到角色 B。',href:'../inspect-phone/select.html',action:'打开查手机'},
    {id:'app-worldbook',category:'应用',title:'世界书',summary:'用于管理故事世界设定和可供角色引用的资料条目。',location:'桌面 → 世界书。',steps:['打开「世界书」，查看现有世界设定列表。','新增或编辑条目时，先写清条目标题、背景内容和触发线索，再保存。','返回角色聊天，用条目中明确的关键词验证上下文是否能引用该设定。'],test:'新增一条无敏感内容的测试设定，保存后重新进入世界书确认仍存在。',href:'../worldbook/worldbook/worldbook.html',action:'打开世界书'},
    {id:'app-memory',category:'应用',title:'记忆空间',summary:'查看和维护长期记忆；它与当前聊天窗口的最近消息条数不是同一设置。',location:'桌面 → 记忆。',steps:['打开「记忆空间」，确认当前所选角色。','查看当前角色已保存的记忆内容，再按页面提供的编辑入口维护记录。','切换到另一个角色，确认两者记忆不混用。'],test:'分别查看两个角色的记忆列表，确认当前角色切换后内容随角色变化。',href:'../worldbook/memory/memory.html',action:'打开记忆空间'},
    {id:'app-forum',category:'社交',title:'论坛',summary:'浏览帖子、话题和互动内容。',location:'桌面 → 论坛。',steps:['打开论坛首页，先认识顶部话题区和内容列表。','选择一条帖子进入详情，阅读正文和评论。','使用页面可见的发布或互动入口前，先确认当前账号/角色身份。'],test:'打开一条帖子详情再返回列表，确认详情正常显示且没有空白页。',href:'../forum/forum.html',action:'打开论坛'},
    {id:'app-wallet',category:'应用',title:'钱包',summary:'查看 MAOMAO 内的虚拟钱包和应用内模拟交易。',location:'桌面 → 钱包。',steps:['打开钱包，查看当前钱包页面显示的余额和交易信息。','在任何模拟交易前先阅读金额、用途和确认信息。','钱包是应用内模拟数据，不是真实银行账户，不会产生真实付款。'],test:'查看钱包首页及一条交易记录，不进行真实支付或输入银行卡信息。',href:'../wallet/wallet.html',action:'打开钱包'},
    {id:'app-music',category:'应用',title:'音乐',summary:'浏览音乐页面、推荐内容和最近播放。',location:'桌面 → 音乐。',steps:['打开音乐，查看推荐区域和「Recently played」等模块。','从页面可用的音乐条目进入播放或详情。','返回音乐页确认最近播放区域按页面实际数据更新。'],test:'打开音乐页并启动一个可用的示例条目，检查播放控件是否响应。',href:'../music/music.html',action:'打开音乐'},
    {id:'app-beauty',category:'外观',title:'聊天美化',summary:'单独管理聊天列表和聊天页面外观，不要把外观主题与角色数据设置混在一起。',location:'桌面 → 聊天美化。',steps:['打开「聊天美化」，查看「消息细节美化」和「聊天页面主题」入口。','一次只调整一个区域，预览后再保存。','返回聊天列表与聊天详情分别检查效果。'],test:'更换一项非破坏性的样式设置，确认列表和详情没有出现错位或文字遮挡。',href:'../beauty/beauty.html',action:'打开聊天美化'},
    {id:'app-theme-store',category:'外观',title:'主题商城',summary:'挑选并应用聊天列表主题、整套聊天主题、气泡预设和字体方案。',location:'桌面 → 主题商城。',steps:['打开主题商城，查看「聊天列表主题」「整套聊天主题」「聊天气泡预设」「字体方案」。','进入一个分类先预览，再选择需要的方案。','在「我的主题」里查看已保存或已应用的方案。'],test:'只切换一项主题方案，回到聊天列表和聊天详情检查；不满意就恢复原方案。',href:'../theme-store/theme-store.html',action:'打开主题商城'},
    {id:'app-characters',category:'角色',title:'角色库',summary:'创建和管理主角色，进入每个角色独立档案。',location:'桌面 → 角色库。',steps:['打开角色库，查看角色列表。','点开某个角色进入档案；可继续管理头像、基本资料、人设和说话习惯。','使用右上角添加入口创建新主角色，保存后回列表确认。'],test:'打开两位主角色档案，确认头像收藏和生活线数据各自独立。',href:'../worldbook/characters/characters.html',action:'打开角色库'},
    {id:'app-footprint',category:'角色',title:'角色足迹',summary:'按时间查看角色的行程和生活记录。',location:'桌面 → 角色足迹；也可从角色对话设置的 CHAT TOOLS → 足迹进入。',steps:['打开「角色足迹」，查看本周时间线和日期分组。','点开某条足迹记录，阅读当天行程和相关记忆。','切换角色或日期，查看对应记录是否更新。'],test:'打开一条足迹详情再返回时间线，确认页面导航和日期显示正常。',href:'../chat/footprint/footprint.html',action:'打开角色足迹'},
    {id:'app-settings',category:'设置',title:'设置',summary:'管理 API、图片生成、语音和手机外观等全局配置。',location:'桌面 → 设置。',steps:['打开设置，先查看 API 设置区域。','进入 API 设置，按服务商要求配置聊天模型；要生图还需单独配置图片模型。','回到设置，打开「角色生图与图库」可为某个角色保存外貌、生成图片和管理图库。'],test:'检查设置页和 API 设置能否打开；不要把 API Key 写入教程备注。',href:'../settings/settings.html',action:'打开设置'},
    {id:'app-finance',category:'应用',title:'记账',summary:'记录和回顾 MAOMAO 内的收支条目。',location:'桌面 → 记账。',steps:['打开记账页，查看最近交易列表。','按页面可见的新增入口填写一笔测试记录，再检查金额和分类。','确认新记录显示在最近交易中后再离开。'],test:'新增一笔可辨认的测试记录，确认列表出现；随后按页面功能清理测试数据。',href:'../wallet/finance.html',action:'打开记账'},
    {id:'app-takeout',category:'应用',title:'外卖',summary:'浏览菜单并体验应用内模拟点餐和结算。',location:'桌面 → 外卖。',steps:['打开外卖页面，先浏览店铺和菜品分类。','选一份测试商品，查看购物车的数量和金额变化。','结算前确认这是 MAOMAO 内模拟订单，不会向真实商家下单。'],test:'仅将商品加入购物车并核对金额；不填写真实地址、电话或支付信息。',href:'../wallet/takeout.html',action:'打开外卖'},
    {id:'app-couple',category:'社交',title:'情侣空间',summary:'查看共同资料、愿望清单、动态和私密留言等区域。',location:'桌面 → 情侣空间。',steps:['打开情侣空间，依次认识 Profile、Bucket List、Moments、Whispers、Today。','在对应区域查看资料、愿望和记录；保存前确认对象和内容。','返回首页确认各区域仍显示对应内容。'],test:'只新增一条不含隐私的测试愿望或记录，确认显示后再决定是否保留。',href:'../couple/couple.html',action:'打开情侣空间'},
    {id:'app-growth',category:'应用',title:'共同成长',summary:'查看成长清单和一起解锁的项目。',location:'桌面 → 共同成长。',steps:['打开共同成长，查看「成长清单」和「一起解锁」。','选择一项适合的清单内容，按页面现有控件更新进度。','回到页面确认进度状态已更新。'],test:'完成一项可撤销的测试清单项，确认状态变化并记录结果。',href:'../growth/growth.html',action:'打开共同成长'},
    {id:'app-companion',category:'应用',title:'陪伴日历',summary:'查看日历、今天想聊的话题和重要日子。',location:'桌面 → 陪伴日历。',steps:['打开陪伴日历，查看今天日期和日历区域。','浏览「今天想聊什么」的提示。','进入「记住重要日子」区域，查看已保存的日期或按页面入口添加新日期。'],test:'查看一个已有日期提醒，确认日期和文字正常显示。',href:'../companion/companion.html',action:'打开陪伴日历'},
    {id:'app-games',category:'应用',title:'游戏大厅',summary:'查看可玩的互动游戏和调查类工具。',location:'桌面 → 游戏大厅。',steps:['打开游戏大厅，查看默契猜词、调查工具箱等卡片。','选择一个游戏进入，先阅读页面规则再开始。','结束后返回大厅，确认进度或结果按页面提示保存。'],test:'打开一个游戏并完成一次非破坏性练习，确认入口和返回流程正常。',href:'../games/games.html',action:'打开游戏大厅'},
    {id:'app-cafe',category:'应用',title:'咖啡馆',summary:'体验小店经营页面及经营事件。',location:'桌面 → 咖啡馆。',steps:['打开咖啡馆，查看「把一家小店，慢慢经营好」的首页内容。','按页面卡片进入经营项目或事件，先读清楚操作说明。','返回首页检查店铺状态或记录是否发生变化。'],test:'只进行一次低风险经营操作，检查页面响应及状态显示。',href:'../cafe/cafe.html',action:'打开咖啡馆'},
    {id:'app-live',category:'应用',title:'直播间',summary:'进入直播间页面查看当前可用直播内容与互动入口。',location:'桌面 → 直播间。',steps:['打开直播间，确认页面加载。','查看当前直播内容、角色信息和页面上实际出现的互动控件。','若没有直播内容，先确认角色资料和相关数据是否已准备，不要把空状态当成已开播。'],test:'打开直播间并返回桌面，确认页面不白屏；未显示直播时记录空状态提示。',href:'../companion/live.html',action:'打开直播间'},
    {id:'app-poster',category:'应用',title:'视觉档案',summary:'浏览保存的视觉海报与档案展示。',location:'桌面 → 视觉档案。',steps:['打开视觉档案，查看 VISUAL Archive 页面。','浏览已有视觉作品，选择一项打开详情。','返回列表检查作品卡片和图片是否正常载入。'],test:'打开一张已有视觉作品并返回，确认图片资源可正常显示。',href:'../poster/poster.html',action:'打开视觉档案'},
    {id:'app-library',category:'应用',title:'阅读',summary:'在书架中浏览和阅读书籍，并查看阅读设置。',location:'桌面 → 阅读。',steps:['打开阅读页，先查看「书架」中的书目。','点一本书进入阅读内容，按页面操作翻页或继续阅读。','需要调整阅读体验时打开页面内「设置」，完成后返回书架。'],test:'打开一本已有书并返回书架，确认书目和阅读位置仍正常。',href:'../library/library.html',action:'打开阅读'},
    {id:'app-envelope',category:'应用',title:'信封',summary:'为选定角色写下私人信件并查看往来信笺。',location:'桌面 → 信封。',steps:['打开信封，先在页面的「选择通信对象」处选择收信角色。','进入写信界面，填写信件内容和标题，再按页面保存或发送。','返回信封列表，检查信件是否归属于正确通信对象。'],test:'给测试角色写一封不含隐私的短测试信，确认收件角色正确。',href:'../envelope/envelope.html',action:'打开信封'},
    {id:'app-diary',category:'应用',title:'日记',summary:'按日期写入和回顾日记记录。',location:'桌面 → 日记。',steps:['打开日记，查看日历和已有记录。','选择日期后查看当日条目；使用页面内编辑入口新建或修改记录。','若页面提供「让角色读读这一页」，先检查选定角色，再决定是否发送给角色阅读。'],test:'新增一条无隐私的测试日记，切换日期后再返回确认记录保留。',href:'../diary/diary.html',action:'打开日记'},
    {id:'app-novel',category:'应用',title:'小说工坊',summary:'从作品书架进入作品设定、故事资料库、章节策划和读者来信。',location:'桌面 → 小说工坊。',steps:['打开小说工坊，查看「书架」和「所有作品」。','进入一部作品后，先补充「作品设定」和「故事资料库」。','按创作需要打开「章节策划台」或「读者来信」，不同工具负责不同环节。'],test:'创建一部测试作品并返回书架，确认作品卡片出现。',href:'../novel/novel.html',action:'打开小说工坊'},
    {id:'app-travel',category:'应用',title:'触梦旅行',summary:'浏览目的地档案、即将出发和已经抵达的旅程。',location:'桌面 → 触梦旅行。',steps:['打开触梦旅行，查看「旅程档案」首页。','在目的地档案中浏览地点和介绍，再选择想查看的目的地。','在「即将出发」与「已经抵达」区域查看旅程状态。'],test:'打开一个目的地详情再返回，确认卡片和介绍都能显示。',href:'../travel/dream-travel.html',action:'打开触梦旅行'},
    {id:'app-date',category:'聊天',title:'线下模式',summary:'与选定角色进入线下剧情/赴约流程；它和线上聊天是不同场景。',location:'桌面 → 线下模式。',steps:['打开线下模式，先按页面提示选择一位角色。','阅读当前场景内容，再使用页面里的剧情输入区域继续。','退出时使用页面内返回，回到桌面或角色入口。'],test:'只进入一个测试角色的场景并返回，确认角色选择和当前场景没有串号。',href:'../chat/date/date.html',action:'打开线下模式'},
    {id:'app-chat',category:'聊天',title:'聊天列表与角色会话',summary:'从聊天列表进入角色会话；底部「＋」工具与顶部「⋯」对话设置是两个不同入口。',location:'桌面 Dock → 聊天。',steps:['打开聊天列表，点一位角色进入单聊；群聊则从群聊入口进入。','底部输入栏左侧「＋」打开发送和互动工具菜单。','右上角「⋯」打开当前会话的对话设置。','切换角色时确认顶部名称和头像同步变化，再发送测试消息。'],test:'在两个角色之间切换并分别发一条测试消息，确认消息和设置不串角色。',href:'../chat/chat/chat.html',action:'打开聊天'},
    {id:'app-shop',category:'应用',title:'店铺',summary:'浏览 MAOMAO 应用内商店商品和分类。',location:'桌面 Dock → 店铺。',steps:['打开店铺，查看「热销榜 · TOP 4」和「全部商品」。','选择商品查看名称、价格和详情。','如要模拟购买，先确认余额和订单信息；不要填写真实支付资料。'],test:'查看一个商品详情并返回列表，不进行真实支付。',href:'../wallet/shop.html',action:'打开店铺'}
  ]);

  var FAQS = [
    ["API 是什么？和 ChatGPT 网页会员一样吗？","API 是 MAOMAO 与模型服务商通信的接口。API Key 是单独的访问凭证；网页订阅通常不能直接当作 API 额度。需到所选服务商开发者平台核实。"],
    ["API Key 从哪里获取？","在选定服务商的官方开发者控制台创建密钥，按平台要求启用 API。通常只显示一次，请妥善保存，不要把它写在教程备注、截图或公开仓库里。"],
    ["Base URL 后面的 /v1 是什么？要不要加？","它通常是 API 路由版本前缀，不是账号编号；只有服务商文档要求时才添加。MAOMAO 会在 Base URL 后拼接 /chat/completions，别把完整接口地址重复填写。"],
    ["为什么「测试连接」成功却不能生成图片？","当前测试只发一个简短的聊天请求到 /chat/completions；图片还需要独立的图片模型与兼容的图片接口，语音也需要独立配置。"],
    ["401、403、404 是什么意思？","401 常见为 Key 无效；403 是没有相应权限；404 多为地址或模型名称错误。先核对服务商文档、控制台权限和具体接口前缀。"],
    ["429、超时、CORS 或 Failed to fetch 怎么办？","429 先检查频率与额度；超时先查网络与响应时间；CORS/Failed to fetch 可能涉及浏览器跨域、HTTPS、阻断或地址错误。不能仅靠反复重试解决。"],
    ["温度 Temperature、Top P 和最大 Tokens 怎么选？","温度较低一般更稳定，较高一般更随机；Top P 同样控制采样范围，通常先只调整其一。Tokens 是长度预算，不等于字数；模型能否调整依服务商而定。"],
    ["图片生成模型填写什么？","填写提供商支持的准确图片模型 ID，不是聊天模型 ID。可选图片接口 URL 留空时使用 Base URL + /images/generations；有自定义端点时按官方文档填写。"],
    ["MiniMax 的 Group ID 和 Voice ID 一样吗？","不一样。Group ID 标识服务商账户或项目，Voice ID 标识要合成的具体音色；MiniMax 语音 Key 也与其他聊天平台的 Key 分开。"],
    ["MiniMax 保存后为什么没有声音？","保存设置不是网络连接测试。需确认语音服务权限、Group ID、角色 Voice ID、对话语音开关与实际发声链路。目前语音设置页没有独立的测试连接按钮。"],
    ["角色图片为什么没有自动发送？","角色自主挑图只从当前角色已保存、标记为公开的图库图片中选择。私密图片不会自主发送；即使有公开图片，也不是每轮聊天都必须发送。"]
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
    ['教程', 'tutorial/tutorial.html', '逐步学习、练习与测试记录'],
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
    if ($('guideVersion')) $('guideVersion').textContent = GUIDE_VERSION;
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
  function targetLabel(raw) {
    var matches = String(raw || '').match(/[「“"]([^」”"]+)[」”"]/g);
    if (matches && matches.length) return matches[matches.length - 1].replace(/[「」“”"]/g, '');
    var words = String(raw || '').split(/[，。；：]/);
    return (words[0] || '当前操作').slice(0, 22);
  }
  function stepState(guide) {
    var state = entryState(guide.id);
    if (!Array.isArray(state.walked)) state.walked = [];
    return state;
  }
  var activeWalkthrough = null;
  var activeStepIndex = 0;

  function guideCard(guide) {
    var state = entryState(guide.id);
    var checked = state.done === true;
    var note = state.note == null ? (guide.defaultNote || '') : String(state.note);
    var walked = Array.isArray(state.walked) ? state.walked.length : 0;
    var open = guide.href
      ? '<a class="open-link" href="' + escapeHtml(guide.href) + '" target="_blank" rel="noopener">' + escapeHtml(guide.action || '打开功能') + '</a>'
      : '';
    return '<article class="guide-card" data-guide-id="' + escapeHtml(guide.id) + '">' +
      '<div class="guide-main"><div class="guide-title-wrap"><span class="guide-category">' + escapeHtml(guide.category) + '</span>' +
      '<h3 class="guide-title">' + escapeHtml(guide.title) + '</h3>' +
      '<p class="guide-summary">' + escapeHtml(guide.summary) + '</p></div>' +
      '<button class="start-guide" type="button" data-start-guide="' + escapeHtml(guide.id) + '">开始学习</button></div>' +
      '<details class="guide-extra"><summary>入口、操作步骤与测试记录</summary>' +
      '<div class="guide-location"><b>入口：</b>' + escapeHtml(guide.location) + '</div>' +
      '<div class="guide-mini-progress">' + (guide.steps || []).length + ' 步 · 当前走完 ' + walked + ' 步</div>' +
      '<div class="test-box"><div class="test-title">怎样确认成功</div><p class="test-description">' +
      escapeHtml(guide.test || '按步骤操作并观察真实页面结果。') + '</p>' +
      '<label class="test-mark"><input type="checkbox" data-done="' + escapeHtml(guide.id) + '"' + (checked ? ' checked' : '') +
      '> 已在手机上实际验证</label>' +
      '<textarea class="note" data-note="' + escapeHtml(guide.id) + '" rows="2" placeholder="可选：记录设备与现象（不要写 API Key）">' + escapeHtml(note) + '</textarea></div>' +
      '<div class="guide-actions">' + open + (guide.issue ? '<span class="guide-hint">仍需手机实测。</span>' : '') + '</div>' +
      '</details></article>';
  }
  function renderGuides() {
    var query = String($('guideSearch').value || '').trim().toLowerCase();
    var found = GUIDES.filter(function (guide) { return matchesGuide(guide, query); });
    $('visibleCount').textContent = found.length + ' 项教程';
    $('guideGrid').innerHTML = found.length
      ? found.map(guideCard).join('')
      : '<div class="empty">没有找到匹配的教程。试试功能名称或入口关键词。</div>';
    refreshProgress();
  }
  function renderApps() {
    var query = String($('guideSearch').value || '').trim().toLowerCase();
    var found = APPS.filter(function (app) {
      return !query || app.join(' ').toLowerCase().indexOf(query) !== -1;
    });
    $('appDirectory').innerHTML = found.map(function (app) {
      var guide = GUIDES.find(function (item) { return item.id.indexOf('app-') === 0 && item.href === '../' + app[1]; });
      var tutorialButton = guide
        ? '<button type="button" class="app-guide-btn" data-start-guide="' + escapeHtml(guide.id) + '">分步教程</button>'
        : '';
      return '<div class="app-link"><a class="app-open" href="../' + escapeHtml(app[1]) + '" target="_blank" rel="noopener"><strong>' + escapeHtml(app[0]) +
        '</strong><span>' + escapeHtml(app[2]) + '</span></a>' + tutorialButton + '</div>';
    }).join('') || '<div class="empty">没有匹配的桌面应用。</div>';
  }
  function renderFaqs() {
    var query = String($('guideSearch').value || '').trim().toLowerCase();
    var found = FAQS.filter(function (faq) { return !query || (faq[0] + ' ' + faq[1]).toLowerCase().indexOf(query) !== -1; });
    $('faqList').innerHTML = found.map(function (faq) {
      return '<details class="faq-item"><summary>' + escapeHtml(faq[0]) + '</summary><p>' + escapeHtml(faq[1]) + '</p></details>';
    }).join('') || '<div class="empty">没有匹配的常见问题。</div>';
  }
  function refreshProgress() {
    var done = GUIDES.filter(function (guide) { return progress[guide.id] && progress[guide.id].done === true; }).length;
    var total = GUIDES.length;
    $('testCount').textContent = done + ' / ' + total + ' 已测试';
    $('progressFill').style.width = (total ? (done / total * 100) : 0) + '%';
  }
  function saveWalkthroughState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch (error) {}
    refreshProgress();
  }
  // Technical lessons are continuous reference articles, not checkbox wizards.
  // This does not change the legacy lesson progress or its storage structure.
  var TECH_CHAPTERS = {
    'api-first': ['API 究竟帮你做什么', '区分三个容易混淆的东西', '选择服务商', '创建自己的 API Key', '核对模型能力', '保护访问凭证'],
    'api-url-v1': ['先选服务商', '理解 Base URL', '为什么有时要写 /v1', '填写 API Key', '填写正确模型 ID', '保存与测试各自做什么', '失败后先按提示排查'],
    'api-errors': ['缺少必填项', '401 与 403', '404', '429', '5xx 和超时', '网络与跨域', '连接成功之后还要测什么'],
    'api-params': ['Temperature：随机性', '范围与模型兼容性', 'Top P：采样范围', 'Tokens：最大长度', '上下文与记忆条数', '适合新用户的调整方法'],
    'api-images': ['先确认聊天 API', '单独选择图片模型', '填写图片生成接口', '确认返回格式', '选角色并生图', '遇到失败先查什么', '是否允许角色自主发送'],
    'minimax-voice-guide': ['三种凭证各是什么', '先分清大陆版和国际版', '准备语音专用凭证', '选模型并保存设置', '保存不代表语音已经连通', 'Voice ID 与角色开关', '如何验收真正发声']
  };
  var OFFICIAL_PORTALS = {
    'api-first': [
      ['OpenAI API 开发者平台', 'https://platform.openai.com/'],
      ['DeepSeek 开发者平台', 'https://platform.deepseek.com/'],
      ['Moonshot 开发者平台', 'https://platform.moonshot.cn/'],
      ['智谱开放平台', 'https://open.bigmodel.cn/'],
      ['硅基流动开放平台', 'https://cloud.siliconflow.cn/']
    ],
    'minimax-voice-guide': [
      ['MiniMax 大陆版开发者平台', 'https://platform.minimaxi.com/'],
      ['MiniMax 国际版开发者平台', 'https://platform.minimax.io/']
    ]
  };
  var TECH_EXTRAS = {
    'api-first': '申请提示：先找到开发者平台中的 API Keys / 密钥管理，再确认账户是否具备调用额度。网页聊天会员不等于 API 自动有余额。不同服务商的实际页面入口可能随版本变更。',
    'api-url-v1': '填写示例（虚构域名）：服务商给出 https://api.example.com/v1 → Base URL 就填 https://api.example.com/v1。MAOMAO 会继续访问 https://api.example.com/v1/chat/completions。不要把 /chat/completions 自己再加到输入框。',
    'api-errors': '看到 400 请求格式错误时，还应核对模型是否支持当前接口及请求参数。某些模型不接受 max_tokens 或 temperature 等字段；这不能直接判定 Key 已失效。',
    'api-params': '入门建议：先试 0.7，再按实际效果少量调整。设置页允许 0～2，但个别模型只允许固定值或不支持这些采样参数。0 是有效温度，不应在保存时被自动变为 0.7。',
    'api-images': '图片生成可能单独计费。用于角色图库的图片应先确认人物和场景归属；新图默认私密，只有主动改为公开后才可能被角色自主挑选发送。',
    'minimax-voice-guide': '重要现状：当前仓库能够核实 MiniMax 配置页面与本地保存逻辑，但尚未核实完整的远程语音合成请求、角色 Voice ID 编辑入口和声音播放闭环。教程不能写成“配置完成即可发声”，真正可用性需要独立开发与验收。'
  };
  function isTechnicalGuide(guide) {
    return !!(guide && Object.prototype.hasOwnProperty.call(TECH_CHAPTERS, guide.id));
  }
  function renderTechnicalGuide(guide) {
    var titles = TECH_CHAPTERS[guide.id] || [];
    var steps = guide.steps || [];
    var chapterHtml = steps.map(function (entry, index) {
      var body = typeof entry === 'string' ? entry : String(entry.text || entry.instruction || '');
      return '<section class="walk-article-section"><h3><span>' + String(index + 1).padStart(2, '0') +
        '</span>' + escapeHtml(titles[index] || '操作说明') +
        '</h3><p>' + escapeHtml(body) + '</p></section>';
    }).join('');
    var links = OFFICIAL_PORTALS[guide.id] || [];
    var linksHtml = links.length
      ? '<div class="walk-article-links"><h3>开发者平台参考入口</h3>' +
        links.map(function (entry) {
          return '<a href="' + escapeHtml(entry[1]) + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(entry[0]) + '<small>访问官网 ›</small></a>';
        }).join('') +
        '<p class="walk-article-note">以上为平台入口参考，当前未实时检查网站菜单及套餐信息。创建密钥前请核实域名与实际 API 计费规则。</p></div>'
      : '';
    $('walkArticle').innerHTML = '<p class="walk-article-intro">' + escapeHtml(guide.summary) + '</p>' +
      chapterHtml +
      '<aside class="walk-article-example"><strong>记住这一点</strong><p>' +
      escapeHtml(TECH_EXTRAS[guide.id] || '') + '</p></aside>' +
      linksHtml +
      '<p class="walk-article-note">对应功能入口：' + escapeHtml(guide.location) +
      '。本页是使用说明，不会读取或保存你的 API Key，也不会代替真实连接测试。</p>';
    $('walkArticle').hidden = false;
    $('walkStepperContent').hidden = true;
    $('walkProgressWrap').hidden = true;
    $('walkPrevious').hidden = true;
    $('walkNext').hidden = true;
    $('walkTitle').textContent = guide.title;
    $('walkOpenPage').href = guide.href || '../index.html';
    $('walkOpenPage').textContent = guide.action || '打开真实页面';
  }
  function renderWalkthrough() {
    if (!activeWalkthrough) return;
    var guide = activeWalkthrough;
    if (isTechnicalGuide(guide)) {
      renderTechnicalGuide(guide);
      return;
    }
    $('walkArticle').hidden = true;
    $('walkStepperContent').hidden = false;
    $('walkProgressWrap').hidden = false;
    $('walkPrevious').hidden = false;
    $('walkNext').hidden = false;
    $('walkOpenPage').textContent = guide.action || '打开真实页面';
    var steps = guide.steps || [];
    if (!steps.length) return;
    activeStepIndex = Math.max(0, Math.min(activeStepIndex, steps.length - 1));
    var raw = steps[activeStepIndex];
    var text = typeof raw === 'string' ? raw : String(raw.text || raw.instruction || '');
    var target = typeof raw === 'object' && raw.target ? raw.target : targetLabel(text);
    var route = String(guide.location || '').split(/\s*→\s*/).filter(Boolean);
    $('walkTitle').textContent = guide.title;
    $('walkStepCount').textContent = '第 ' + (activeStepIndex + 1) + ' 步 / 共 ' + steps.length + ' 步';
    $('walkPercent').textContent = Math.round((activeStepIndex + 1) / steps.length * 100) + '%';
    $('walkProgressBar').style.width = ((activeStepIndex + 1) / steps.length * 100) + '%';
    $('walkRoute').innerHTML = route.map(function (part, index) {
      return (index ? '<span class="walk-route-arrow">›</span>' : '') +
        '<span class="walk-route-chip">' + escapeHtml(part) + '</span>';
    }).join('');
    $('walkPhoneTarget').textContent = target.slice(0, 15);
    $('walkVisualTarget').textContent = target;
    $('walkStepTitle').textContent = '操作 ' + (activeStepIndex + 1);
    $('walkStepCopy').textContent = text;
    $('walkStepTip').textContent = typeof raw === 'object' && raw.tip
      ? String(raw.tip) : '按当前步骤操作真实页面。若页面上的按钮名称或布局与这里不同，先不要猜，记录差异并在对应教程卡片里备注。';
    $('walkPractice').textContent = guide.test || '按本教程的入口完成一次无风险检查，并确认页面能正常返回。';
    var state = stepState(guide);
    $('walkStepDone').checked = state.walked.indexOf(activeStepIndex) !== -1;
    $('walkPrevious').disabled = activeStepIndex === 0;
    $('walkNext').textContent = activeStepIndex === steps.length - 1 ? '完成引导' : '下一步';
    $('walkOpenPage').href = guide.href || '../index.html';
  }
  function startGuide(id) {
    var guide = GUIDES.find(function (item) { return item.id === id; });
    if (!guide) return;
    activeWalkthrough = guide;
    var state = stepState(guide);
    activeStepIndex = Number.isInteger(state.lastStep) ? state.lastStep : 0;
    $('walkthroughModal').hidden = false;
    renderWalkthrough();
    $('walkBody').scrollTop = 0;
  }
  function closeGuide() {
    if (activeWalkthrough) {
      var state = stepState(activeWalkthrough);
      state.lastStep = activeStepIndex;
      saveWalkthroughState();
    }
    $('walkthroughModal').hidden = true;
    activeWalkthrough = null;
  }
  function moveWalkthrough(delta) {
    if (!activeWalkthrough) return;
    var state = stepState(activeWalkthrough);
    if (delta > 0 && activeStepIndex >= activeWalkthrough.steps.length - 1) {
      state.learned = state.walked.length === activeWalkthrough.steps.length;
      state.lastStep = activeStepIndex;
      saveWalkthroughState();
      closeGuide();
      return;
    }
    activeStepIndex = Math.max(0, Math.min(activeWalkthrough.steps.length - 1, activeStepIndex + delta));
    state.lastStep = activeStepIndex;
    saveWalkthroughState();
    renderWalkthrough();
    $('walkBody').scrollTop = 0;
    renderGuides();
  }

  function exportProgress() {
    var lines = ['MAOMAO 手机测试记录', '指南版本：' + GUIDE_VERSION, '导出时间：' + new Date().toLocaleString(), ''];
    GUIDES.forEach(function (guide) {
      var state = progress[guide.id] || {};
      lines.push((state.done ? '[已测试] ' : '[待测试] ') + guide.title);
      lines.push('入口：' + guide.location);
      if (state.note) lines.push('备注：' + state.note);
      if (guide.issue) lines.push('状态：待真机复测（已加导航兜底，尚未验证结果）');
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

  // Overview shortcuts and a local-only error explanation panel; never submit or store API keys.
  $('topicGrid').addEventListener('click', function (event) {
    var button = event.target.closest('[data-open-guide]');
    if (button) startGuide(button.getAttribute('data-open-guide'));
  });
  var diagnosis = {
    '': '选一个实际出现的提示，即可看到原因和先检查什么。这里不会发送网络请求。',
    'missing': '先补齐 Key、Base URL 和默认聊天模型。填写后保存，再测试。',
    'success': '仅代表当前聊天测试请求成功。生图和 MiniMax 语音必须单独配置与验证。',
    '401': '优先检查 Key 是否来自当前服务商、是否过期或撤销。不要把 Key 发给别人检查。',
    '403': '检查账户、项目、地区和模型访问权限；有些服务需要单独开通 API 权限。',
    '404': '检查 Base URL 前缀（包括服务商要求的版本路径）和模型 ID；不要把 /chat/completions 重复填写。',
    '429': '检查服务商的频率限制和剩余额度；反复点击测试通常不会解决。',
    '5xx': '通常是服务端或网关异常。可稍后再试，并查看服务商状态。',
    'timeout': '检查网络、服务器响应与地址是否可访问，当前聊天测试超时阈值为 15 秒。',
    'network': '可能是 CORS、证书、HTTPS、网络屏蔽或接口地址错误。浏览器无法自行绕过服务端的跨域限制。'
  };
  $('diagnoseSelect').addEventListener('change', function () {
    $('diagnoseAnswer').textContent = diagnosis[this.value] || diagnosis[''];
  });

  $('guideFilters').addEventListener('click', function (event) {
    var button = event.target.closest('[data-category]');
    if (!button) return;
    activeCategory = button.getAttribute('data-category');
    renderFilters();
    renderGuides();
  });
  $('guideSearch').addEventListener('input', function () { if (this.value.trim()) $('catalogDetails').open = true; renderGuides(); renderApps(); renderFaqs(); });
  $('guideGrid').addEventListener('click', function (event) {
    var start = event.target.closest('[data-start-guide]');
    if (start) startGuide(start.getAttribute('data-start-guide'));
  });
  $('appDirectory').addEventListener('click', function (event) {
    var start = event.target.closest('[data-start-guide]');
    if (start) startGuide(start.getAttribute('data-start-guide'));
  });
  $('walkClose').addEventListener('click', closeGuide);
  $('walkPrevious').addEventListener('click', function () { moveWalkthrough(-1); });
  $('walkNext').addEventListener('click', function () { moveWalkthrough(1); });
  $('walkStepDone').addEventListener('change', function () {
    if (!activeWalkthrough) return;
    var state = stepState(activeWalkthrough);
    var index = state.walked.indexOf(activeStepIndex);
    if (this.checked && index === -1) state.walked.push(activeStepIndex);
    if (!this.checked && index !== -1) state.walked.splice(index, 1);
    saveWalkthroughState();
    renderGuides();
  });
  $('walkthroughModal').addEventListener('click', function (event) {
    if (event.target === $('walkthroughModal')) closeGuide();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !$('walkthroughModal').hidden) closeGuide();
  });
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
  renderFaqs();
  // Direct links from API, image and MiniMax settings open the matching chapter.
  var linkedGuide = /^#guide=([a-z0-9-]+)$/.exec(window.location.hash);
  if (linkedGuide) startGuide(linkedGuide[1]);
})();