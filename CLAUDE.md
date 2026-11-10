# CLAUDE.md

「小手机 (phone-simulator)」—— 纯原生 Web 项目，模拟一部手机：桌面浏览器显示带边框的手机机身（390×844），窄屏（≤480px）经 `shared/css/mobile-fit.css` 剥掉壳变全屏 PWA。内置聊天、论坛、钱包、咖啡馆、游戏等 App，全部围绕用户自定义的 **AI 角色** 运转（人设/世界书/记忆注入 prompt，调用 OpenAI 兼容 API 生成内容）。全站简体中文，黑白灰杂志风。

> 工程协作入口：所有 AI/开发者先读根目录 AGENTS.md，再读 docs/engineering/README.md 及其架构、储存、开发治理和任务文档。当前事实以源码与工程手册为准；历史审查报告须按日期复核。

## 技术栈与架构

- **纯原生 HTML/CSS/JS**：零框架（无 React/Vue/jQuery）、零运行时依赖、无 TypeScript。开发依赖包括 Vite 和 Playwright；项目没有 React/Vue 等前端运行时框架。
- **MPA 多页架构**：一个页面 = 一个自包含 HTML（内嵌 `<style>` 与 `<script>`）。导航 = 整页跳转 `window.location.href`，**无路由库、无 hash 路由、无 iframe**；参数走 query string（如 `chat-detail.html?id=xxx`）。
- **共享 JS = IIFE + 全局命名空间**（如 `global.PhoneStorage = {}`），无 import/export；`package.json` 的 `"type": "module"` 仅作用于 vite.config.js。
- **Vite 可选**：`vite.config.js` 自动扫描全部 HTML 作为多页入口；项目全用相对路径 + `?v=YYYYMMDD` 缓存参数，**静态托管仓库根目录即可运行**（nav.js 已适配 GitHub Pages 子路径部署）。
- **PWA**：`manifest.json`（standalone/竖屏/快捷方式）+ `sw.js`（缓存优先+后台更新，缓存名 `phone-app-pwa-vN`）。当前 `index.html` 会在 load 后注册 `./sw.js`；修改 Service Worker 或缓存策略前，必须检查注册、更新、controllerchange 和真机缓存行为。

## 常用命令

```bash
npm run dev       # vite dev server（0.0.0.0:3000）
npm run build     # vite build
npm run preview   # 预览构建产物
# 项目无构建产物依赖：任何静态服务器指向仓库根即可
```

## 目录结构（按功能划分；2026-11-11 main 快照共 89 个 HTML 页面）

```
index.html              # ★ 入口：手机主屏/启动器（状态栏 + 应用宫格 + Dock + ~1180 行拖拽引擎）
sw.js / manifest.json   # PWA（index.html 当前会注册 SW，见上）
vite.config.js          # 自动扫描全部 HTML 为多页入口
shared/
  css/mobile-fit.css    # ≤480px 真机适配（剥手机壳、隐藏滚动条）
  js/                   # 通用层：font-loader / native-feel / nav / sound-system /
                        #   statusbar-control / mask（面具）/ memory（记忆）/ custom-css（美化注入）
  js/phone/             # ★ AI 基础设施层（多模块，见下）
desktop/                # "手机桌面"本身：css/styles.css（机身/宫格/挂件样式）、
                        #   js/script.js（时钟、data-href 跳转代理）、widgets.html（挂件管理）
chat/                   # 聊天套件（16 页）：chat/（列表 + chat-detail 核心 + 搜索/设置/气泡主题）、
                        #   contacts/、moments/（空间 + 整机刷新入口）、call/（模拟通话）、
                        #   footprint/（足迹）、sticker/（贴纸库）
forum/                  # 论坛（8 页，含 forum-editorial 编辑控制）
worldbook/              # RP 设定中枢：characters/（角色库）、memory/（记忆空间）、
                        #   mask/（设定/面具）、settings/（正则过滤 + RP 协议）、worldbook/（世界书）
wallet/                 # wallet / finance（记账）/ shop（商店）/ shop-admin（店铺管理）
settings/               # settings（API 配置）/ appearance / font-settings / sound-settings
profile/                # profile（我的）/ edit-profile
cafe/ games/ diary/ travel/ beauty/ theme-store/ music/ library/ tools/ envelope/   # 单页 App
apps/settings/          # 历史样式候选目录；引用与打包范围仍待 GOV-003 核验，不得据此直接删除
```

**注意：`chat/chat/` 双层目录是重构后的真实路径，不是笔误。**

## 入口与核心模块

- **index.html** = 手机主屏：第一页默认组件优先（大时钟、图片、照片墙、待办、月历、倒数日、便签），第二/三页放应用图标，Dock 为聊天和商店。内嵌拖拽引擎（实时让位 + 跨页流转 + Dock 自由布局），布局存 `ds_layout_v13`；编辑模式 `body.home-editing` 抑制跳转。
- **chat/chat/chat-detail.html**（当前 main 快照 9,463 行；编辑前须重新测量，项目核心聊天页面）：AI 对话核心——流式响应、群聊、心形编辑器（`.bubble-heart`）、通话/图片消息、正则过滤、自动总结记忆。
- **shared/js/phone/**（AI 基础设施层，见下节）是模拟世界的"后端"。
- 复合 App：forum/（9 页）、wallet/（4 页）、settings/（4 页）；其余为单页 App。

## ★ 数据存储规则（混合储存，渐进迁移中）

**当前不是“只有 localStorage”的单一储存架构。** 项目已经混合使用 localStorage 与多个 IndexedDB 数据库，但各业务模块迁移程度不同。详细、权威的数据库清单和迁移规范见：
- `docs/engineering/STORAGE_AND_MIGRATION.md`
- `docs/engineering/PROJECT_ARCHITECTURE.md`
- `docs/engineering/REMEDIATION_BACKLOG.md`

### 当前事实（不要把目标当成已实现）

1. **聊天历史仍以 localStorage 为主**：`chat_history_<id>` 每个角色/群组保存一个完整消息数组，当前没有整体历史上限。富消息可能包含图片/贴纸 dataURL。这是主要容量风险。
2. **PhoneStorage 已存在，但并非所有页面都使用它**：`shared/js/phone/phone_storage.js` 提供安全读写、结果错误码和旧 key 兼容；部分旧页面仍直接读写 localStorage，修改存储前必须搜索所有读写调用方。
3. **phone_data_v2 不是所有数据的唯一主库**：它按 `phoneData[contactId][appId]` 保存部分角色级 App 数据。角色、群组、世界书、聊天等仍有不同的旧 key/独立域；不得假定所有数据都双读双写。
4. **IndexedDB 已用于部分大数据**：壁纸/本地音乐、日记照片、阅读书库、字体方案，以及新建的媒体仓库均有各自数据库。
5. **MediaRepository 尚未等于全站媒体迁移完成**：`shared/js/phone/storage/media-repository.js` 使用 `maomao-assets`（assets/blobs/refs），支持 Blob 与内容哈希去重；当前聊天图片主链路尚未完成迁移。
6. **MediaRepository 备份已接入，但本地音频文件仍有单独缺口**：当前 `settings/js/backup.js` 的 IDB_TARGETS 已包含 `maomao-assets` v2 的 `assets`、`blobs`、`refs`、`image_records`。Blob 使用 Base64 备份并受单条/整库体积限制；`atomicExport` 防止 Blob 超限时生成只有元数据、缺少二进制的残缺媒体库。`tests/media-backup.test.mjs` 已覆盖四个 store 的往返恢复、引用关系、字节一致性和超限整库排除，但本次仓库检查环境尚未实际运行该测试。`maomao-media-store` 的 audio store 仍排除 `blob`，本地音乐文件不在该备份目标中，见 DATA-003。
7. **禁止破坏性迁移**：不删除旧 key、不裁剪历史、不重写角色/群组 ID。迁移必须先备份、复制、校验数量/顺序/字段/媒体引用，再切换；旧数据要保留到验证与用户确认后。

### IndexedDB 当前数据库速查

| 数据库 | 当前 stores | 主要使用方 | 备份状态 |
|---|---|---|---|
| `maomao-media-store` v2 | `wallpapers`, `audio` | `wallpaper-store.js`, `music/music.html` | 已列入；audio 的 blob 字段目前被排除 |
| `maomao_diary_photo_store_v1` v1 | `photos` | `diary/diary.html` | 已列入 |
| `maomao-reading-library` v1 | `books`, `comments` | `library/library.html` | 已列入 |
| `maomao-font-presets` v1 | `presets` | `font-loader.js`, 字体设置、主题商城 | 已列入；Blob 有体积上限 |
| `maomao-assets` v2 | `assets`, `blobs`, `refs`, `image_records` | `MediaRepository` | 已列入；Blob 限额 + `atomicExport` 整库排除；往返恢复测试已编写，实际执行待验证 |
| `maomao-restore-point` v1 | 还原点辅助 store | `settings/js/backup.js` | 内部恢复安全机制，需在备份重构时一并核对 |

### 高频 localStorage key 速查

| key | 内容 / 结构 |
|---|---|
| `ai_custom_characters` | 全局角色列表；头像可能是 dataURL |
| `phone_current_contact` | 当前选中角色 ID |
| `phone_data_v2` | 部分角色 App 数据根 `phoneData[contactId][appId]`，不是所有域的唯一数据库 |
| `chat_history_<id>` | 单聊/群聊完整消息数组；线上/赴约模式共享，赴约消息带 `mode:'date'` / `scene` |
| `chat_memories_<id>` | 角色长期记忆；已有条目数治理，聊天历史本身仍无总量上限 |
| `phone_groups` / `phone_worldbooks` | 群组列表 / 全局世界书 |
| `myProfile` / `user_masks` | 玩家资料 / 面具 |
| `api_settings` / `api_profiles_v1` | API 设置镜像 / 多方案配置；密钥不得写入日志或默认导出 |
| `moments` / `forum_posts` | 朋友圈 / 论坛数据，检查其中的大图片字段 |
| `maomao_diary_entries_v1` | 日记条目；照片单独进入 diary IndexedDB |
| `music_local_tracks` | 本地音乐元数据；音频 Blob 存 IndexedDB |
| `active_font_preset_id` | 当前激活字体方案 ID；字体 Blob 在 IndexedDB |
| `home_custom_wallpaper` | 旧版桌面壁纸兼容 key；新路径使用 IndexedDB wallpaper store |

### 新代码储存规则

- 新的小型偏好可放 localStorage，并通过 PhoneStorage 或明确的设置仓储读写。
- 大型结构化数据（聊天消息、导入书籍、长列表）使用 IndexedDB 仓储。
- 图片、音频、附件使用 Blob 媒体仓储；消息记录只保留资源 ID。
- 每次写入都必须检查成功/失败；不得 catch 后静默继续或提示成功。
- 每个数据库/store 必须登记到统一数据库清单，并同步配置 export/import 与回归测试。
- 不允许新页面自行创建未登记的 IndexedDB 数据库。
- 所有迁移必须遵照 `docs/engineering/STORAGE_AND_MIGRATION.md`，不得删除或裁剪既有用户数据。

## ★ AI 基础设施层（shared/js/phone/）

6 个 IIFE 模块，页面按需用 `<script src>` 引入，通过全局名访问：

| 文件 | 全局名 | 职责 |
|---|---|---|
| phone_storage.js | `PhoneStorage` | 统一 localStorage 抽象（规则见上节） |
| phone_api.js | `PhoneAPI` | OpenAI 兼容 `POST <baseUrl>/chat/completions`（非流式/JSON 任务）、超时、调用写日志 |
| phone_stream.js | `PhoneStream` | **流式对话公共引擎**（chat-detail / 赴约 date.html 共用）：三段式超时、SSE 半包解析、残留收尾、rAF 节流、中断保文；结果对象永不 reject |
| phone_context.js | `PhoneContext` | 组装 system prompt：人设 + 世界书 + 长期记忆 + 近期聊天 + 其他 App 数据 |
| phone_apps.js | `PHONE_APPS` | App 注册表：`{id, name, icon, page, prompt, jsonSchema, getCount, getData}`；每个 App 的 prompt/jsonSchema 定义 AI 生成规则 |
| phone_engine.js | `PhoneEngine` | 角色切换、**整机刷新**（为选定角色一次性重新生成全部 App 数据；入口在 chat/moments/moments.html） |
| phone_ui.js | `PhoneUI` | 通用 toast / loading / confirm / 返回 |

AI 接口配置存 `api_settings`（默认 `https://api.openai.com/v1`，内置 DeepSeek / Moonshot / 智谱 / 硅基流动预设，见 settings/js/settings.js）。新增 App 接入 AI 时：在 `PHONE_APPS` 注册（写 prompt + jsonSchema），数据落 `phoneData[contactId][appId]`。

### 聊天主链路健壮性（chat-detail.html sendMsg）

- **流式引擎已抽离**：sendMsg 的流式核心在 `shared/js/phone/phone_stream.js`（`PhoneStream.chat(opts)`，永不 reject，结果对象 `{ok, fullText, error}`，`fullText` 中断时保留部分内容）；chat-detail 只传 `onPaint` 渲染回调与收尾处理。**新页面（如赴约 date.html）直接调 PhoneStream.chat 复用，不要重写流式代码**。
- **三段式超时**：连接 15s（等响应头）→ 流式「无数据看门狗」30s（每收到 chunk 重置）→ 120s 硬性总上限；中断时已生成内容保留落库，不丢弃。
- **上下文字符预算 `CTX_CAP`**：人设 5000 / 长期记忆 3000 / 用户记忆 2000 / 世界书 8000 / RP 协议原文 6000（变量替换后整段 16000），超限经 `capText` 静默截断降级，防 400 超长。
- **流式渲染 rAF 节流**：delta 只累计文本，正则清洗 + DOM 写入合并到每帧一次；流结束后补处理残留 SSE buffer，防丢尾字。
- **发送防重入**：`aiSending` 锁（sendMsg / regenerateReply 双入口检查，`finally` 统一解锁）；HTTP 错误经 `friendlyHttpError` 映射为中文提示（原始细节进 api-logs）。

### 长期记忆系统（chat-detail 总结 IIFE + 权重记忆）

- **触发**：开聊天页 1.5s 后检查一次（聊天中不触发）；条件 = 自动开关开 且 历史条数 ≥ 角色级间隔（`chat_summary_interval_<id>`，默认 20）且距上次总结 ≥8h；弹面板**人工确认**后才调 API（20s 超时，独立于主聊天链路，失败不阻塞聊天，提示走非阻塞 toast）。
- **注入防膨胀**：权重 = importance × 类别基准 × 2^(−天数/半衰期)（key/纪念日 365 天、plot 21 天、detail/preference 60 天），≤0.12 不注入、pending 不注入、fixed 钉住；再过 `CTX_CAP.memory` 3000 字符。`[记住:xxx]` 用户记忆存 200 条 / 注入 30 条 / 2000 字符。
- **M1 已修**：`chat_memories_<id>` 存储上限 **300 条**（`trimMemoriesByWeight` 按权重淘汰尾部，fixed 永不淘汰）；`saveWeightMemories` 是唯一写入口（doSummarize 已改走它，顺带补上 phone_data_v2 双写）。
- **M3 已修**：总结 transcript 上限 **4000 字符**（超长从头部截断保留最近，不切代理对）。
- **M2 暂缓（已知风险）**：`chat_history_<id>` 无上限（含 base64 贴纸/图片消息），是 localStorage 5MB 配额的长期最大威胁；注入端只取 10-50 条不受影响，存储侧靠设置页 DATA 分组的全量备份兜底。

## 项目字典

### 业务术语

| 术语 | 含义 |
|---|---|
| 角色 / 人设 | 用户创建的 AI 人物及其 `persona` 设定文本；一切 App 数据按角色隔离 |
| 角色库 | worldbook/characters/，角色增删改（characters-manager.js） |
| 世界书 | lorebook：世界设定条目，注入 AI 上下文 |
| 记忆 / 记忆空间 | 角色长期记忆 + 聊天自动总结（memory.js、worldbook/memory/） |
| 设定 / 面具 | 玩家在扮演中的身份切换（mask.js MaskSystem） |
| 空间 / 朋友圈 | chat/moments/ 的动态 feed；也是"整机刷新"入口 |
| 整机刷新 | PhoneEngine 一键重新生成某角色的全部 App 数据 |
| 挂件 / 元素仓库 | 主屏 `.ds-widget` 小组件；被移除的项目进隐藏仓库，经 desktop/widgets.html 恢复 |
| 聊天美化中心 | beauty.html：「可视化调节」（ChatBeauty 结构化参数 + 实时预览）、「深度自定义」（手写 CSS 预设）与整页主题切换；结构化气泡预设存于 `beauty_visual_presets_v1` |
| 主题商城 | `theme-store/theme-store.html`：整页聊天主题、聊天气泡预设、字体方案与我的主题；气泡应用写回 `ChatBeauty.save` 的全局/角色配置，字体复用 `maomao-font-presets`，内置主题调用 `ChatBeauty.setThemePreset` |
| 咖啡馆经营 / 游戏大厅 / 触梦旅行 | cafe、games（6 款 AI 伴玩小游戏）、travel 三个单页模拟 App |
| 赴约 / 线下剧情 | `chat/date/journey.html` 短线下路线模拟（动态地图、ETA 分阶段推进、途中消息写回同一角色历史）；`chat/date/date.html` 长线下小说叙事（serif 排版、`PhoneStream.chat` 流式续写）。聊天记录统一写入 `chat_history_<id>`；`mode:'date'` 只在小说页展示，线上与线下记忆互通 |
| 正则过滤 / RP 协议 | AI 输出正则替换规则 / 角色扮演协议（worldbook/settings/） |
| 群组 / 贴纸库 | 多角色群聊（群 id 以 `g` 开头）/ chat/sticker/ 表情包管理 |
| 信封 / 私人信件 | `envelope/envelope.html`；按角色隔离保存寄件、收件和草稿，支持编辑发件人/收件人、附图，以及用户主动邀请角色写信或回信 |
| 编辑控制 | forum-editorial 等页面的内容精选控制 |

### UI 约定

**开始任何 UI 设计或改造前，必须先阅读 docs/MAOMAO_VISUAL_DESIGN_CONSTITUTION.md。** 该文件记录用户明确的长期视觉偏好、参考图解读和禁止项；通用模板审美不得覆盖用户规范。


- 手机壳三层：`.simulator-stage` > `.phone` > `.phone-screen`；真机下由 mobile-fit.css 重置为全屏。
- 主屏部件：`.status-bar`（`#status-time` 实时时钟）、`.home-page` 宫格、`.app-card .app-tile`（`data-href` 跳转 + `data-drag` 拖拽 id）、`.ds-widget` 挂件、`.dock-wrapper`/`#dockBar`、`.gesture-bar`。
- **底部导航由 shared/js/nav.js 自动注入**（`.floating-nav`，聊天/联系人/空间/我的四 tab）：从 `document.currentScript.src` 推导站点根（兼容子路径），`SKIP_PAGES` 数组按 pathname 子串匹配决定跳过页；高亮 = `currentPage.indexOf(tab.key)`。页面只需引脚本，无需写 HTML。
- 页内视图切换用 `data-route`（library）、游戏分发用 `data-game`（games）；聊天页扩展面板在 chat/chat/js/chat-extras.js。
- 暗色模式 `html.dark`（settings/css/settings.css）；每页内嵌自己的 `:root` 变量（`--bg/--ink/--muted/--line`…），**无全局 token 文件**。
- 通用弹层/提示用 `PhoneUI`。

## 注意事项 / 已知坑

- 共享脚本加载顺序惯例：`font-loader.js` → `native-feel.js` →（数据页）`phone/phone_storage.js` + `phone/phone_api.js` → 页面脚本。
- JS 里的相对路径按**页面 URL**（而非脚本位置）解析；跨目录跳转统一用相对路径（如 characters-manager.js 的 `../../index.html`），nav.js 用动态 appBase 兼容子路径部署。PHONE_APPS 注册表的 `page` 字段是根绝对路径，但目前无任何消费方（纯元数据）。
- 改完 HTML/CSS/JS 若走静态托管缓存，记得 bump 页面引用的 `?v=` 参数。
- 全量备份/恢复在设置页 DATA 分组（settings/js/backup.js）：JSON 带 `__backup.schema` 版本校验（当前 1，拒收更高版本），排除 `api_call_logs`；导入前自动下载当前数据作安全备份，写入失败自动回滚。
- 仓库包含 `docs/engineering/README.md` 工程手册与 `tests/` 测试目录；`package.json` 提供多个 Node/Playwright 测试入口。`npm run lint` 当前仍只是打印固定的 “Lint passed”，不是真正的 lint 检查。`.trae/` 是 IDE 配置（git-ignored）。`docs/audit-report.html` 是历史审计报告，其中的旧路径已因目录重构失效，仅作参考。
