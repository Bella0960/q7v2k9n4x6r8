# MAOMAO 群聊分项开发执行账本（2026-11-25）

## 1. 执行规则与当前定位

关联原 PR #529；承接当前 integration/qa-group-529-on-v171-20261125（基线 22c9d9dee1e5a8285c06254f2ac14df4d801a107）。关联 GOV-004、QA-001、QA-002、DATA-003、DATA-005；不替代 main 最新 AGENTS.md / RELEASE_POLICY.md。每次先核对远端 HEAD、原 PR、线上候选与公共 QA。发布前必须重新整合当前线上基线；此前 #45627498729 因 qa-baseline-mismatch 失败，不能作为功能测试通过的证据。

用户已确认的主流程：需求 → 调研 → 架构 → 界面设计确认 → 分项开发 → 功能反推 → 审计与修复 → 整合 → 性能 → 发布验收 → 公共 QA → 用户体验验收 → 归档。发现缺陷复现、修复、复测；新增想法作为明确子任务插入，保留当前恢复点。每次只激活一个功能模块，不改未授权界面、不删除原功能；已登记 66 项问题保留原编号（12 项针对性修复待复验，其余未结项）。跨模块安全问题是发布门禁，不因新增功能而跳过。

| ID | 模块 | 状态 / 需求摘要 |
|---|---|---|
| GROUP-MUSIC-001 | 一起听歌 | M01–M07 已通过；M08 音乐专项修复已复验；M09 整合及设备验证待完成 |
| GROUP-CALL-001 | 群通话 | 待进入；沿用单人通话页面，多成员依次回应，记录与群身份隔离 |
| GROUP-REWARD-001 | 群红包及转账 | 待进入；免费模拟积分的普通、随机、专属、口令红包、领取详情和手气王；指定成员模拟转账；无真钱、提现或付费抽奖 |
| GROUP-GAME-001 | 秘密身份 | 待进入；在现有游戏权限和状态机上完善，私密信息严格隔离 |
| GROUP-HEART-001 | 成员心声 | 待进入；点击成员头像；按群和角色隔离 |
| GROUP-SEARCH-001 | 搜索 | 待进入；群记录、成员、日期、类型、稳定消息定位 |
| GROUP-ADMIN-001 | 群管理 | 待进入；群主转让及授权转回、管理员、禁言、头衔、专属头像，保留原功能 |
| GROUP-AUDIT-001 | 整合验收 | 持续记录；已登记缺陷尚未全部关闭，发布前必须满足安全标准 |

## 2. GROUP-MUSIC-001：阶段 03 架构契约（待实现）

### 已核实源码及复用边界

- music/music.html：约 1062 行起 music_local_tracks、music_playlists_v1、music_cover_assets_v1；约 1267 行起 maomao-media-store v2 / audio，记录 id/name/mimeType/size/blob；约 1642 行 playTrack 真实 audio.play()，playbackRevision 防异步切歌覆盖。约 1199 行 musicEmitPlayback、MAOMAOMusicPlayback.getState/subscribe 仅反映本机播放器，明确不承诺角色或好友听到。已有单角色邀请 music_listen_invites_v1，不复用为群会话。
- chat/chat/chat-detail.html：maomao-app-shortcuts 的 music-app 当前仅 location.href 到 music/music.html。群作用域使用 MAOGroupWriteGuard、GroupGovernance、账号隔离；不能新增无守卫的直接历史写入。
- shared/js/mao-account-scope.js：对账号隔离 localStorage、sessionStorage、IndexedDB；生产账号未知或未 ready 时拒绝操作。group-write-guard.js 提供 account/read/matches，需在异步操作前后检查，并与现有成员/身份规则一致。
- settings/js/backup.js：该候选已包含 DATA-003 音频 Blob 原子备份及缺失音频校验。main 文档中旧 metadata-only 描述与该候选不同；以实际候选代码为准，不宣称备份已通过真机验收。

### 模块职责和稳定接口（名称为计划，不是已实现）

1. MusicCatalogAdapter：listTracks/getTrack/resolveSource；使用原曲目 ID、现有曲库和音频 IndexedDB，不复制 Blob 或 Base64；封面沿用媒体引用。只使用已有可播放来源，缺失或不可用明确提示。
2. MusicPlaybackController：getState/subscribe/play/pause/seek/next/dispose，复用现有原生 audio、真实 play() 结果、修订号、URL 生命周期。DOM、歌词、收藏与既有播放器事件/格式保持兼容。单一活动播放所有者；同账号多标签播放协调使用 Web Locks 等实际支持机制，无可靠仲裁时不得宣称同步；控制失效应暂停并提示。异步切歌只允许最后一次请求生效。
3. GroupListeningSession：create/selectTrack/setQueue/play/pause/seek/join/leave/end/reconcile/getSnapshot/subscribe；会话绑定 accountId + groupId + sessionId + revision；参与者是合格成员 ID，不按名字匹配。会话生命周期为 idle → selecting → ready → playing ↔ paused → ended，错误仅从真实播放结果转入 error 或保留此前已确认状态。所有命令检查当前账户、唯一群及现有成员资格、会话修订；不新增云数据库，不写入现有群资料和聊天历史。成员移除、退群、解散、账号切换时立即停止/撤销过期操作。恢复不得自动播放或假报播放成功。
4. GroupListeningView：群聊内部曲库弹层及顶部播放条；只读播放器状态，不自行创建第二套播放器。群聊中发送消息、浏览历史、开合选歌弹层不停止播放。单聊原音乐入口保持不变。真正离开 MPA 文档后，音频可能暂停或卸载；跨页面不间断播放不纳入第一版承诺。重新进入仅允许用户主动恢复。
5. GroupListeningContext：仅向当前群、当前发言角色传递当前公开曲目名、播放状态以及明确允许参与的标识；角色参与是文本互动模拟，不宣称实际接收音频，不注入别群播放或私聊信息，不把歌词/音乐文件发送到 API，不因播放自动触发计费请求。推荐歌曲须用户确认才能切换。

### 数据与恢复

首版先使用受作用域守卫的内存会话，不新增永久存储键、数据库、消息类型或数据迁移。若后续确需刷新恢复，在实施前单独确定版本化、账号/群隔离的小型会话指针，备份与恢复语义、删除策略及锁；不直接写现有全局 music_playback_state_v1 为群会话，也不将真实播放状态从其他页面误认成群会话。离页、刷新、强杀不承诺音频连续；缺失源文件保留曲目元数据与收藏，不破坏旧数据。撤回本功能时仅解除新适配/入口，不删除曲库和历史。

### 阶段 04 界面设计草案（待视觉确认）

群聊加号内“一起听歌”使用现有细线 SVG；选歌弹层仅展示已有歌曲封面、曲名、歌手、勾选，底部“开始播放”。开始后聊天顶栏下方单行紧凑卡：小封面、曲名、少量参与成员头像、播放/暂停；其余控制（队列、进度、成员、结束）点击展开，主聊天页不新增厚工具栏。白/浅灰/黑，轻薄留白、无装饰箭头、无 Emoji。不改变已有聊天区域和原有单人音乐页面。空库、加载失败、播放受限、已结束均有清楚的非成功状态。AI 参与标识不代表音频送达。

### 后续分项开发及验收账本

| 子项 | 依赖 | 完成条件 | 状态 |
|---|---|---|---|
| M01 架构 | 需求及调研 | 接口、边界、回退及风险已记录 | 已记录 |
| M02 界面 | M01 | 375/390/430px 原风格视觉与交互确认 | 独立样机已实现；375/390/430px 及桌面 1280px 交互通过；用户要求继续，进入 M03 |
| M03 曲库适配 | M01/M02 | 原本地/可播放曲目、重复/损坏 ID、缺失 Blob、账号切换测试 | 已通过：固定 QA 45658330013，51/51，真实导入及双账号 IndexedDB |
| M04 播放器复用 | M03 | 真实播放、暂停、seek、快速切歌、拒绝播放、URL 回收、原音乐回归 | 已通过 45671593084 |
| M05 群会话 | M04 | 账号/群/成员校验、移除/退群/解散、双标签仲裁、异常处理 | 已通过 45671593084 |
| M06 群聊界面 | M05 | 加号选歌→顶部卡→播放控制→结束；发消息不中断 | 已通过 45677236722 |
| M07 角色互动 | M06 | 当前公开曲目上下文、角色人设、权限隔离、无额外自动调用 | 已通过 45681440014（16cd729） |
| M08 反推/审计 | M03–M07 | 所有故障有回归用例；既有 66 项缺陷保留并逐项处理 | 本轮音乐专项修复通过 45681440014；全群聊 66 项账本不宣称结清 |
| M09 整合与性能 | M08 | 音乐/聊天/备份/账号安全回归，375/390/430 与 Android/iPhone | 已验收候选保留；主线整合及真机未验收 |
| M10 QA | M09 | 当前线上基线整合、Node/Vite/Chromium、固定 verify、真实回执、用户授权 QA 发布 | 待 |

M02 历史记录：M02 独立原型：`previews/group-listening-preview.html`，使用合成歌曲/成员，原生 HTML/CSS/JS；没有真实音频、持久化、网络/API 或生产页面挂载。真实 Chromium（本地 Playwright + 系统 Chromium，set_content）375×812、390×844、430×932、1280×800 四档均通过选歌/勾选/播放状态/聊天/切歌/暂停/结束/横向溢出/JS 错误检查；截图为 390px 样机实际浏览器渲染。测试不等同产品端到端验收，账号隔离、真实音频、触屏及 Android/iPhone 尚未验证。原 UI/产品代码不变；未部署。

### M03 恢复点

- 基线 0a472e7a80f0411bbd0a0bc948aa357f81e43961。复用原曲库、音频 Blob、封面资源引用；仅本地真实导入曲目；不修改原音乐播放器、存储键、数据库或聊天 UI。
- 第六轮本地 Node v22.16.0 16/16，真实群权限守卫及模拟 Storage/IDB/DOM。新增 npm run test:group:music-catalog 与 npm run test:group:music-catalog:browser。真实浏览器未验收。
- 下一执行位置仍为 M03：执行真实 IndexedDB / 双账号隔离与必要集成验证，通过后进入 M04；保留 QA 基线冲突，不部署。

### M03 验收门禁接入

- 新增 `tests/group-listening-catalog-browser.test.mjs`，让现行标准 QA 已有的 `node --test --test-concurrency=1` 自动发现真实 Chromium/IndexedDB 专项测试；保留独立 npm 测试命令。未修改公共工作流、发布脚本或既有安全门禁。
- 本地 Node v22.16.0 对新增入口的语法检查、过滤测试发现检查通过（未执行浏览器断言）；冻结的三份核心文件与远端 Git blob 一致，沿用已确认的 16/16 单元测试证据。实际浏览器命令因缺少 Node Playwright 包返回 ERR_MODULE_NOT_FOUND，仍未完成真实 IndexedDB 验收。
- 本轮线上 QA 版本与源码回执未能读取；保留上次 QA 基线冲突，未发出发布或重复验证请求。M03 不结项；M04 不进入产品集成。

### M03 环境阻塞复核（2026-11-25）

- 冻结源文件及已通过的 Node 16/16 测试文件的 Git blob 与远端一致；未重复运行无变化的单元测试。现有 Python Playwright 自带 Node Playwright Core 1.57.0-beta，能够启动系统 Chromium 144.0.7559.96。用独立合成 HTML/本地临时 HTTP 服务进行正常导航烟雾测试，返回 `net::ERR_BLOCKED_BY_ADMINISTRATOR`；未执行任何真实 IndexedDB 断言。没有改变或规避浏览器管理策略。
- QA 站点的 qa-build-receipt.json 和 pwa-release.json 当前未能读取，公共 verify #45627498729 仍为失败；不凭旧候选部署，也不盲目重触发。
- 当前真正的恢复点：有正常浏览器权限、仓库依赖与相同候选的授权开发环境中，执行 `npm run test:group:music-catalog:browser`。保存真实结果；若通过，再进行集成验收、M04。若失败，先处理具体业务失败。无需重建候选，不新增工程包，不以环境问题假冒产品测试通过。


### 2026-11-25 · GROUP-MUSIC-001 M03a official music sources
Owner explicitly requested one shared music catalog and NetEase/QQ source channels. Existing import writes music_local_tracks and maomao-media-store/audio, exactly the existing adapter's inputs. Independent external handoff in existing music settings; full known official song/playlist URLs only, canonicalized, no credential handling, remote fetch, persistence, media extraction, or in-app playback claim. Short links, provider SDK licensing and authorized playback remain open. QQ official H5 SDK documented for IoT panels; general PWA eligibility not verified. No changes to local music library, data schema, chat, or QA. Inline script parsed; initial parser Node fixture 19/19 before final malformed-fragment hardening; final repository test added, not yet run. Container GitHub DNS failed; direct contents write failed, use Git tree commit. M03 actual IDB/browser gate remains open; M04 not started.

### M03 真实导入联动验收（2026-11-26）
- 在原有 `tests/music-mobile-browser.mjs` 中补齐真实文件选择器导入 → 刷新 → 独立同源曲库读取器 → 原始音频逐字节核对、封面归属与只读验证。两个不同合成 WAV 音频验证 ID 不串，375/390/430px；另保留独立双账号真实 IndexedDB 验收。不新增生产入口或播放器。代码已编写，实际 Chromium 未验证，M03 不结项。

### M03 结项与 M04a（2026-11-26）
- 固定 QA verify 45658330013 对 4a7d5520bad3e0e2f403be9ba9ac9613078261b4 全部通过（含 post-test-guard），M03 结项。无部署。
- M04a 先修原 music/music.html 的切歌失败与暂停并发，仍仅用原 audioPlayer。新增六项源归属测试，当前模拟音频运行通过；真实 Chromium 待复验。后续才抽取共享播放控制契约、单一所有者仲裁及群聊挂载。M04 未结项，不进入 M05。

### M04a 浏览器验收补强（2026-11-26）
- 原音乐页真实 Chromium 专项增加播放/暂停、原进度条 seek、受控播放拒绝后的恢复、真实 Blob 读取延迟期间取消、切歌及原 URL 释放验证（375/390/430px）。仅测试注入可控异常；正式页面不改。等待实际 QA 结果，不以语法检查代替通过。

### M04a 播放状态发布补强（2026-11-26）
- 现有播放器订阅补齐切换中、失败、seek 状态。真实音频归属未确认时不得继续显示旧歌曲正在播放，过期请求不得覆盖新状态。七项模拟执行及实际状态投影检查通过；真实浏览器复验待执行。不改变既有存储结构或页面外观。

### M04a 结项 / M04b 共享控制器（2026-11-26）
- 45662976123 完整 verify 成功；M04a 结项。
- `shared/js/phone/music-playback-controller.js` 由现有音乐页实际调用，单 audio 元素拥有者、真实播放结果、账号复核、取消、定位及资源回收集中，保留原 UI/历史/歌词/曲库。十项模拟执行通过，真实 Chromium 待验收。跨窗口唯一播放锁在 M04c 完成；群聊尚未挂载。

### M04b 结项 / M04c 多窗口仲裁（2026-11-26）
- 45666045629 verify 成功，M04b 结项。统一播放锁使用同源 Web Locks；不抢占其他窗口，需先暂停。拒绝方不覆盖活动窗口共享状态；缺失锁能力明确提示，不伪造仲裁。14项模拟测试通过，真实双窗口 Chromium 及手机验收待完成。M04c 未结项。

### M04c 播放进度保护（2026-11-26）
- 修复旧版仅 idx 记录在载入时被零秒覆盖；恢复只读，真实播放权确认后保留时间并升级，已删除 ID 不按下标误认。非拥有者不能写断点。17项模拟执行通过，真实复验待执行。

### 2026-11-26 · 验收节奏调整（用户确认）
- 阶段内连续开发及定向检查，同一阶段的小修集中提交；阶段末统一公共 QA，不反复触发。允许独立后续模块的内存逻辑/测试提前准备，但不提前接入、结项或部署。安全边界和最终回归不变。固定命令见 `docs/engineering/GROUP_MUSIC_DEV_CHECKS.md`。当前真实双窗口 QA 仍进行中，未取消。

### M05 独立会话引擎（2026-11-26）
- 依用户调整后的阶段批量流程，M04c 复验期间先准备独立 M05 逻辑。`shared/js/phone/group-listening-session.js` 使用原群守卫、成员权限及共享播放器，不挂载聊天页面。选曲、队列、参与成员、播放/暂停/进度/结束、过期请求、退群/解散/账号变更撤销已实现。12项模拟测试通过，真实集成及浏览器未验收；群角色参与不等于真实听到音频。M04、M05 均不提前结项。

### M04c 仲裁通过 / M05 联动候选（2026-11-26）
- 45668451512 对 c82cda9 完整 verify 成功；后续进度保护和 M05 一并验收。M05 `createForGroup` 绑定原曲库/原播放器，群资格变化时在异步音频读取与播放前拦截。14项模拟测试通过，真实三档浏览器新增群会话/原音乐竞争、成员移除回收验证；未执行实际浏览器，不提前挂载或结项。

### M04/M05 结项 / M06 实际群聊接入（2026-11-26）
- 固定 verify 45671593084 已成功，精确候选 2e5f84d。M06 新增 `group-listening-view.js` 与独立命名空间 CSS，原群聊内挂载入口、选歌、顶部播放条、详情、进度、参与与结束；现有音乐快捷入口保留。新增真实页面专项测试尚未执行；先补齐消息发送与异常复核再集中验收。当前仅内存会话，刷新/离开不自动恢复，角色参与不代表远程音频送达。不部署。

- M06 小修集中：每页24首、闲置不轮询、关闭弹层竞态保护；新增真实发送落库（无 API 的明确失败态）及音源不变检查、切歌原生源变化、刷新不自动播放。实际 Chromium 待验收，M07 尚未接入。

### M06 清理收尾 / M07 独立准备（2026-11-26）
- 修复群成员变动导致的会话失效后空播放器及轮询残留；过期进度条不能操作新歌曲，曲库扫描降频。新增真实群页面移除成员→停止/释放→重新开始→结束专项，尚未运行 Chromium。M07 独立上下文模块只允许当前参与角色读取本群曲名、歌手、真实状态；8项模拟运行通过，未挂载 AI 请求。M06 待集中验收。

- M06：自然播放结束时顺序接续队列，最后一首停止、不循环；11项结束条件模拟执行通过。新增实际聊天成功回复（本地拦截模拟 SSE）期间音源不变、原生结束事件顺序切歌测试；真实 Chromium 尚待执行。未接入 M07 提示词、未部署。

- M06 已通过固定入口提交集中 verify（7229bc9，45677236722，运行中）。M07 独立请求适配 `appendToMessages` 已开发，保留原身份、人设、世界书和消息，只追加当前合格参与者的公开曲名、歌手与状态，限制元数据指令及虚假音频送达。13项模拟运行通过；尚未挂载正式聊天，下一步 M06 验收后在原最终请求审计处接入。

### M06 结项 / M07 正式请求接入（2026-11-26）
- 45677236722 完成成功；M06 结项。M07 已挂载原最终请求边界，异步诊断后读取、复用原人设审计、发送前再次校验群权限；不加请求、不影响单聊。5项边界模拟通过，新增真实合成 SSE 参与/暂停/退出请求检查待运行。未部署。

### M07 诊断请求一致性修复（2026-11-26）
- 45679010085 在 gate 7/51 的提示词诊断契约失败；修复实际诊断原文与请求不一致问题。预览前组成并审计最终消息，预览期间状态变化则取消本轮并保留重试，不发送用户未确认的请求。8场景实际函数模拟及原诊断契约检查通过，正式复验待执行。不部署。

- M07 复验期间独立反推：首次加载取消不再虚报已暂停，暂停后音源丢失进入可重试错误；角色上下文不再读取这两类虚假状态。两个原缺陷已复现，16项实际模块模拟执行通过；待集中复验。未部署。

- 独立反推补齐曲库变动和大队列：重新选歌剔除已删除歌曲，确认时复核曲库并要求重新确认变更；100首队列只读一次曲库。17项会话模拟、3项界面辅助函数测试通过。当前正在运行的 M07 验收不变；此补丁待集中复验，未部署。

- 选歌事务反推：复现原分步操作先释放音源、后发现队列失效的问题；新增单次队列确认，先完整校验再更新，拒绝不影响正在播放；19项会话模拟通过，未触发新验收或部署。

- M07 复验 45679332628 在第49/51项旧人设交付契约失败。保留原始强制人设核验，再对诊断后真实发送的数组执行最终核验，失败不发送并保留重试。4项真实人设策略模拟、9项请求边界场景和原诊断契约通过；与前3轮独立修复集中复验，不提前结项或部署。

### M07 / 音乐专项 M08 复验结项
- 45681440014 精确候选 16cd729 完整 verify 成功，日志确认 post-test-guard；不宣称全部66项群聊缺陷已关闭。当前 Cloudflare QA Worker 版本号171（100%），与历史发布回执时间吻合，实际 HTTP 源码回执仍未取得。M09 保持主线整合及 Android/iPhone 真机待验收，不部署。

- M09 补充正式桌面页面 1280×800 Chromium 专项：真实导入、群选歌、卡片及弹层边界、曲库变动保留原播放、恢复后正常切换、草稿与播放锁清理。仅新增测试，语法检查通过，实际浏览器待最终集中执行；原 16cd729 功能回执有效，不为测试文件单独重复公共 QA。

- M09 主线相关行为对照：候选已有更严格的聊天历史/发送锁、错误响应超时及流式完整性、音乐写入保护、管理员及 API 缓存隔离。补入主线缺失的单聊请求准入和 HTTP 错误响应超时回归；3项实际函数模拟、3项流式模拟通过，真实 Node/桌面测试集中复验。未修改产品代码或部署；完整主线整合仍待完成。
